import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";
import { scopeOf } from "@deepseek-ai/dsh-scope";
import { assertFolderOutsideBees } from "./product-commands.js";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { browserPort, browserStatePath, closeAgentBrowser, saveBrowserState, showAgentBrowser, startAgentBrowser } from "./agent-browser.js";
import { dataDirectory } from "./data-folder.js";
import { serverFolder, setServerFolder } from "./folder-roots.js";
import { iso, message, required, transaction } from "./product-database.js";
import { catalogEntry, isBrowserCatalog, MCP_CATALOG } from "./mcp-catalog.js";
import { googleConsent } from "./google-consent.js";
import { installSkill, listPack, removeSkill, SKILL_CATALOG, skillsRoot } from "./skill-packs.js";
import { parse as parseYaml } from "yaml";
import { discoverApi, privateAddress } from "./api-discovery.js";
import { namePreset } from "./preset-names.js";
import { specFromCurl } from "./spec-from-curl.js";
import { startStep } from "./startup.js";

/** DSH's own limit on an MCP namespace; a longer or odd name fails at plugin load, not here. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A server that hangs instead of failing would never let the app finish loading. */
function started(fiber, what) {
  let timer;
  return Promise.race([
    Promise.resolve(fiber).finally(() => clearTimeout(timer)),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out while starting`)), 30_000).unref();
    })
  ]);
}

/** Stopping can fail when the child is already gone, which must not pass unnoticed. */
async function stop(ctx, fiber, what) {
  try { await fiber.dispose(); }
  catch (error) { ctx.logger.warn(`bees: could not stop ${what}: ${message(error)}`); }
}

/** Secrets live in the DSH credential store, never in the product database. */
function secretRef(server, name) {
  return credentialRef(`BEES_MCP_${server.id}_${name}`.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase());
}
const PASTED = /\{\{credential:(BEES_PASTED_[A-Z0-9_]+)\}\}/g;
// a planner wrote -H 'freelancer-oauth-v1: API_HEADERS', and that word went out as the key on every call
const PLACEHOLDER = /^(?:[Bb]earer\s+)?(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|\$\{?\w+\}?|<[^<>]*>|\{\{(?!credential:BEES_PASTED_)[^{}]*\}\})$/;
// rows keep placeholders so one server definition works wherever Bees and its state directory live,
// and the browser pair resolves differently per run: two teams can browse in two different profiles
const placed = (value, mode = "own") => value === "{node}" ? process.execPath
  : value === "{browserState}" ? browserStatePath(mode)
    : value === "{browserUrl}" ? `http://127.0.0.1:${browserPort(mode)}`
      : value.replace("{lib}", () => dirname(fileURLToPath(import.meta.url))).replace("{data}", dataDirectory);
// a bridge's spec is a saved file or, when the person gave one, a url
const readSpec = async (source) => {
  const text = /^https?:/.test(source)
    ? await fetch(source, { signal: AbortSignal.timeout(8000) }).then((response) => response.text())
    : await readFile(placed(source), "utf8");
  // the bridge reads yaml too, so a yaml spec must not look unreadable here
  try { return JSON.parse(text); } catch { return parseYaml(text); }
};

/** A folder-bound server takes its folder as its last argument, and that folder belongs to this computer. */
const FOLDER = "{folder}";
const needsFolder = (catalogId) => Boolean(catalogEntry(catalogId)?.requiresDirectory);
const argsFor = (server, mode = "own") => server.args.map((arg) => arg === FOLDER ? serverFolder(server.id) || arg : placed(arg, mode));

/** A folder-bound server runs only while it has a folder here: one picked on another computer is not ours. */
const noFolderReason = (server) => {
  if (!needsFolder(server.catalogId)) return "";
  const folder = serverFolder(server.id);
  if (!folder) return `${server.label} has no folder on this computer. Choose one on the Add-ons page.`;
  if (!existsSync(folder)) return `${folder} is the folder you gave ${server.label}, and it is not on this computer. `
    + "Reconnect it, or choose another on the Add-ons page.";
  return "";
};

function rowToServer(row) {
  const args = JSON.parse(row.args_json);
  // the slot holds its place, never a path: a folder named in a row written on another computer is not ours
  if (needsFolder(row.catalog_id)) args[args.length - 1] = FOLDER;
  return {
    id: row.id, serverName: row.server_name, label: row.label, transport: row.transport,
    command: row.command, url: row.url, catalogId: row.catalog_id, source: row.source,
    createdAt: row.created_at, enabled: Boolean(row.enabled),
    args,
    envNames: JSON.parse(row.env_names_json),
    headerNames: JSON.parse(row.header_names_json)
  };
}

/** Skills and tools come from DSH. MCP servers are ours: one mounted fiber per enabled row,
 *  except the browser, which mounts per run. */
export class Capabilities {
  constructor(ctx, database, defaultWorkspace, connected) {
    this.ctx = ctx;
    this.database = database;
    this.defaultWorkspace = defaultWorkspace;
    this.connected = connected;
    /** serverId -> { fiber, error } for every row we have tried to mount. */
    this.mounted = new Map();
    /** serverId -> the mutation currently in flight for it. */
    this.queued = new Map();
  }

  async initialize() {
    await Promise.all(this.servers().filter(({ enabled }) => enabled).map((row) => this.mount(row)));
  }

  /** True while a browser server is enabled, so a run has a signed-in profile a person can reach. */
  browserEnabled() {
    return this.servers().some(({ enabled, catalogId }) => enabled && isBrowserCatalog(catalogId));
  }

  /**
   * The browser is the one server that cannot be shared. Two runs browsing at once landed on each
   * other's pages, so a run asked for a calendar and read a news site. Each run mounts its own on
   * its agent context, which dies with the run: either a headless session signed in from the one
   * Chrome a person signs into, or the DevTools chip attached to that same Chrome.
   */
  async mountBrowserFor(agentCtx, granted, mode, runId) {
    // only one browser add-on is on at a time, and a run whose grant leaves it out browses nothing
    const row = this.servers().find(({ enabled, catalogId, serverName }) => enabled && isBrowserCatalog(catalogId)
      && (!granted || granted.includes(serverName)));
    if (!row) return;
    await this.mountFor(agentCtx, row, mode);
    const tool = `mcp__${row.serverName}__`;
    // Chrome starts on the first browser call, not with the run, since most runs never browse.
    let synced, lastUrl, reopen = false;
    agentCtx.on("tools/result", (exec, result) => {
      if (!exec.name.startsWith(tool)) return;
      const url = result.content?.map(({ text }) => text ?? "").join("\n").match(/Page URL: (\S+)/)?.[1] ?? exec.arguments?.url;
      if (/^https?:\/\//.test(url)) lastUrl = url;
    });
    agentCtx.on("tools/pre-execute", async (exec, next) => {
      // a run that has browsed and needs a person shows them its page; the runtime hides it once they answer
      if (exec.name === "ask_user_question" && lastUrl) {
        showAgentBrowser(mode, runId, lastUrl).catch((error) => this.ctx.logger.warn(`bees: could not show the browser: ${message(error)}`));
        // the answer may be a sign-in, so the next browser call copies the cookies again
        synced = null;
        // playwright's own session read its cookies once, devtools drives that browser itself
        reopen = row.catalogId === "playwright";
        return next();
      }
      if (!exec.name.startsWith(tool)) return next();
      try {
        // it has to be up before its sign-ins are read; devtools drives it on every call, so a crashed one comes back
        if (!synced || row.catalogId === "chrome-devtools") await startAgentBrowser(mode);
        // shared, so a second call landing mid-copy waits for the cookies instead of starting without them
        await (synced ??= saveBrowserState(mode));
        if (reopen) {
          reopen = false;
          // closing drops the old session, the next one reads the fresh cookies, and the agent is put back on its page
          await agentCtx.tools.get(`${tool}browser_close`, exec.agent)?.execute({}, exec);
          if (lastUrl && exec.name !== `${tool}browser_navigate`)
            await agentCtx.tools.get(`${tool}browser_navigate`, exec.agent)?.execute({ url: lastUrl }, exec);
        }
      } catch (error) {
        synced = null;
        // browsing on regardless would quietly sign the person out of every site
        return { kind: "deny", reason: `The browser did not start: ${message(error)}. Tell the owner this exact error with ask_user_question.` };
      }
      return next();
    });
    return row.serverName;
  }


  /** On the run's own context, which dies with the run. */
  async mountFor(agentCtx, row, mode = "own") {
    if (!row.enabled) return;
    const finish = startStep(`mcp.per-run:${row.serverName}`);
    try {
      // a connected tool resolves a relative path against its own process, so give it the run's folder
      const agent = scopeOf(agentCtx);
      await started(agentCtx.plugin(mcpClient, await this.configFor(row, mode, agent?.session?.header?.cwd)), row.serverName);
      finish();
    } catch (error) { finish("failed"); throw error; }
  }

  async close() {
    closeAgentBrowser();
    this.consent?.close();
    const fibers = [...this.mounted.values()].map(({ fiber }) => fiber).filter(Boolean);
    this.mounted.clear();
    // One bad teardown must not strand the rest, and disposal is best-effort during shutdown.
    await Promise.allSettled(fibers.map((fiber) => fiber.dispose()));
  }

  servers() {
    return this.database.prepare("SELECT * FROM mcp_servers ORDER BY created_at").all().map(rowToServer);
  }

  /** Two toggles at once had the second dispose the fiber the first was still starting. */
  serialize(serverId, work) {
    const previous = this.queued.get(serverId) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.queued.set(serverId, next.then(() => {}, () => {}));
    return next;
  }

  /** Resolve a row's secrets and hand `dsh-mcp-client` the config shape it validates. */
  async configFor(server, mode = "own", cwd) {
    const missing = noFolderReason(server);
    if (missing) throw new Error(missing);
    if (server.transport === "stdio") {
      const env = {};
      for (const name of server.envNames) {
        const hit = await this.ctx.credentials.resolve(secretRef(server, name));
        if (hit?.value) env[name] = hit.value;
      }
      // the openapi bridge takes request headers as one env value; args are stored, so no secret goes there
      const headers = (await Promise.all(server.headerNames.map(async (name) =>
        [name, (await this.ctx.credentials.resolve(secretRef(server, name)))?.value ?? ""])))
        .filter(([, value]) => value && !PLACEHOLDER.test(value)).map(([name, value]) => `${name}:${value}`);
      // the saved auth header and the pasted request's headers both go out, one must not replace the other,
      // and a saved Bearer YOUR_TOKEN is dropped rather than sent next to the real key
      if (env.API_HEADERS || headers.length) env.API_HEADERS = [...(env.API_HEADERS ?? "").split(/,(?=\s*[\w-]+\s*:)/)
        .filter((pair) => pair.includes(":") && !PLACEHOLDER.test(pair.slice(pair.indexOf(":") + 1).trim())), ...headers].join(",");
      return {
        transport: "stdio",
        serverName: server.serverName,
        command: placed(server.command, mode),
        args: argsFor(server, mode),
        env,
        ...(cwd ? { cwd } : {}),
        // Without this a dead command activates with no tools and no error, stuck on Starting.
        failOnStartupError: true
      };
    }
    const headers = {};
    for (const name of server.headerNames) {
      const prefix = catalogEntry(server.catalogId)?.headers.find((row) => row.name === name)?.prefix ?? "";
      const hit = await this.ctx.credentials.resolve(secretRef(server, name));
      if (hit?.value) headers[name] = `${prefix}${hit.value}`;
    }
    return {
      transport: "streamable-http", serverName: server.serverName, url: server.url, headers,
      failOnStartupError: true
    };
  }

  /** A server that will not start is reportable state, not a reason to take the app down. */
  async mount(server) {
    // The browser mounts per run in mountBrowserFor, never on the shared context.
    if (isBrowserCatalog(server.catalogId)) return;
    if (this.mounted.has(server.id)) return this.mounted.get(server.id);
    // Reserve before the first await, or a second enable leaves an undisposable fiber.
    const entry = { fiber: null, error: "", ready: false, at: Date.now() };
    this.mounted.set(server.id, entry);
    const noFolder = noFolderReason(server);
    const finish = startStep(`mcp.shared:${server.serverName}`);
    try {
      if (noFolder) throw new Error(noFolder);
      const fiber = this.ctx.plugin(mcpClient, await this.configFor(server));
      entry.fiber = fiber;
      await started(fiber, server.serverName);
      entry.ready = true;
      finish();
    } catch (error) {
      finish("failed");
      const reason = message(error);
      // The client names the server but never what it tried, which is what you need.
      const attempted = server.transport === "stdio"
        ? `Bees tried to run: ${[placed(server.command), ...argsFor(server)].join(" ")}`
        : `Bees tried to reach ${server.url}`;
      entry.error = noFolder ? noFolder : `${reason}. ${attempted}`;
    }
    // A row removed while its fiber was starting must not leave the child process behind.
    if (!this.mounted.has(server.id) && entry.fiber) await stop(this.ctx, entry.fiber, server.serverName);
    return entry;
  }

  /** The memory launcher comes up after the plugin, so its boot mount fails and nothing ever tried again:
   *  an agent listed on it ran without one mcp__memory__ tool. A run that may use a failed server retries it. */
  async retryFailed(names = null) {
    const rows = this.servers().filter(({ id, enabled, serverName, catalogId }) => enabled && !isBrowserCatalog(catalogId)
      && (!names || names.includes(serverName)) && this.mounted.get(id)?.error && Date.now() - this.mounted.get(id).at > 60_000);
    await Promise.all(rows.map((row) => this.serialize(row.id, () => this.remount(row))));
  }

  /** the local memory server was just started, so every session opened on the old process is gone */
  async remountUrl(url) {
    const rows = this.servers().filter((row) => row.enabled && row.transport === "streamable-http" && URL.parse(row.url)?.origin === url);
    await Promise.all(rows.map((row) => this.serialize(row.id, () => this.remount(row))));
  }

  async unmount(serverId) {
    const entry = this.mounted.get(serverId);
    this.mounted.delete(serverId);
    if (entry?.fiber) await stop(this.ctx, entry.fiber, serverId);
  }

  async remount(server) {
    await this.unmount(server.id);
    if (server.enabled && this.servers().some(({ id }) => id === server.id)) await this.mount(server);
  }

  /** DSH keeps tools on the agent plane, so only a preset's own scope knows what a run gets. */
  async presetTools() {
    const presets = await this.ctx.agentPresets.list();
    const rows = [];
    for (const raw of presets) {
      const preset = namePreset(raw);
      const row = { id: preset.id, name: preset.name, broken: raw.broken ?? "", tools: [], skills: [] };
      rows.push(row);
      if (raw.broken) continue;
      try {
        await using lease = await this.ctx.agentPresets.acquireScope(preset.id);
        const scope = lease.key;
        row.tools = this.ctx.tools.schemas(scope)
          .map(({ name, description }) => ({ name, description: description ?? "" }))
          .sort((left, right) => left.name.localeCompare(right.name));
        row.skills = (await this.ctx.skills.list({ cwd: this.defaultWorkspace, scope })).map((skill) => ({
          name: skill.name,
          description: skill.description ?? "",
          whenToUse: skill.whenToUse ?? "",
          provider: skill.provider ?? "",
          source: skill.source ?? "",
          // user-dsh is <DSH_HOME>/skills, the one root Bees installs into and may delete from.
          removable: skill.source === "user-dsh"
        }));
      } catch (error) {
        row.broken = message(error);
      }
    }
    return rows;
  }

  async snapshot() {
    const servers = this.servers();
    const tools = this.ctx.tools.schemas();
    const presets = await this.presetTools();
    // Skills are per preset too; list each once and say which presets reach it.
    const merged = new Map();
    for (const preset of presets) {
      for (const skill of preset.skills) {
        const seen = merged.get(skill.name) ?? { ...skill, presets: [] };
        seen.presets.push(preset.name);
        merged.set(skill.name, seen);
      }
    }
    const skills = [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
    const skillsComplete = presets.some(({ broken }) => !broken);
    const byServer = new Map(servers.map((server) => [server.serverName, server]));
    return {
      skills,
      skillsComplete,
      skillsRoot: skillsRoot(),
      skillPacks: SKILL_CATALOG,
      presets,
      tools: tools.map(({ name, description }) => {
        const match = /^mcp__([A-Za-z0-9_-]{1,32})__(.+)$/.exec(name);
        return {
          name,
          description: description ?? "",
          serverName: match ? match[1] : "",
          serverLabel: match ? byServer.get(match[1])?.label ?? match[1] : ""
        };
      }),
      servers: servers.map((server) => {
        const state = this.mounted.get(server.id);
        const toolCount = tools.filter(({ name }) => name.startsWith(`mcp__${server.serverName}__`)).length;
        const perRun = isBrowserCatalog(server.catalogId);
        return {
          ...server,
          command: placed(server.command),
          args: argsFor(server),
          // null for a server that takes no folder, so the page shows a picker only where one belongs
          folder: needsFolder(server.catalogId) ? serverFolder(server.id) : null,
          toolCount,
          perRun,
          error: state?.error ?? "",
          status: !server.enabled ? "off" : perRun ? "per run" : state?.error ? "failed" : state?.ready ? "connected" : "starting"
        };
      }),
      catalog: MCP_CATALOG.map(({ env, headers, ...entry }) => ({
        ...entry,
        installedAs: servers.find(({ catalogId }) => catalogId === entry.id)?.id ?? "",
        secrets: [...env, ...headers].map(({ name, label, help, optional }) => ({ name, label, help, optional: Boolean(optional) }))
      }))
    };
  }

  /** The public MCP registry: a package Bees runs here with npx or uvx, else a hosted server by its url. */
  async searchRegistry(query) {
    const search = String(query ?? "").trim();
    const response = await fetch(
      `https://registry.modelcontextprotocol.io/v0/servers?limit=40&version=latest${search ? `&search=${encodeURIComponent(search)}` : ""}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!response.ok) throw new Error(`The MCP registry answered ${response.status}`);
    const { servers = [] } = await response.json().catch(() => { throw new Error("The MCP registry did not answer with JSON"); });
    const seen = new Set();
    const runners = { npm: "npx -y", pypi: "uvx" };
    return servers.flatMap(({ server }) => {
      const pkg = server?.packages?.find(({ registryType, transport }) => runners[registryType] && transport?.type === "stdio");
      const remote = server?.remotes?.find(({ type }) => type === "streamable-http");
      if ((!pkg && !remote) || !server.name || seen.has(server.name)) return [];
      seen.add(server.name);
      return [{
        name: server.name,
        title: server.title || server.name,
        description: server.description ?? "",
        website: server.websiteUrl ?? server.repository?.url ?? "",
        // Reverse-domain names carry dots and slashes the namespace pattern refuses.
        serverName: server.name.split("/").pop().replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32),
        // pinned, so an approved plan runs the version the owner saw
        ...(pkg ? { transport: "stdio", command: `${runners[pkg.registryType]} ${pkg.identifier}${pkg.version ? `@${pkg.version}` : ""}`,
          settings: (pkg.environmentVariables ?? []).map(({ name, description }) => ({ name, description })) }
          : { transport: "streamable-http", url: remote.url })
      }];
    });
  }

  /** Ask the API where its document is, so bridging one is a single field. */
  async discoverSpec(apiBaseUrl) {
    const address = required(apiBaseUrl, "API base URL");
    const found = await discoverApi(address);
    if (found.kind !== "endpoint-list") return found;
    const { spec, ...rest } = found;
    // The spec's paths are whole pathnames, so the bridge has to call the origin or it doubles the prefix.
    return { ...rest, apiBaseUrl: new URL(address).origin, specUrl: await this.writeSpec(new URL(address).hostname, spec) };
  }

  /** Hashed name, or a second endpoint on one host would overwrite the first server's spec. */
  async writeSpec(host, spec) {
    const directory = join(dataDirectory(), "api-specs");
    await mkdir(directory, { recursive: true });
    const stamp = createHash("sha256").update(spec).digest("hex").slice(0, 12);
    const name = `${host.replace(/[^a-z0-9.-]/gi, "-")}-${stamp}.json`;
    await writeFile(join(directory, name), spec);
    return `{data}/api-specs/${name}`;
  }

  /** For an API that publishes nothing: each working request describes one endpoint, several describe several. */
  specFromRequest(command) {
    const parsed = String(command).split(/(?=^\s*curl\b)/m).map((one) => one.trim()).filter(Boolean).map(specFromCurl);
    const [{ request, host }] = parsed;
    if (parsed.some((entry) => entry.request.origin !== request.origin))
      throw new Error("Paste requests to one API at a time; each host gets its own server");
    const spec = JSON.parse(parsed[0].spec);
    for (const entry of parsed.slice(1))
      for (const [path, ops] of Object.entries(JSON.parse(entry.spec).paths)) spec.paths[path] = { ...spec.paths[path], ...ops };
    const secret = /auth|token|key|secret|cookie|session|oauth/i;
    const headers = Object.fromEntries(parsed.flatMap(({ request: one }) => Object.entries(one.headers)).filter(([name, value]) => secret.test(name) && !PLACEHOLDER.test(value)));
    const count = Object.keys(spec.paths).length;
    return { kind: "from-curl", spec, host, headers, apiBaseUrl: request.origin, endpointCount: count,
      how: `described ${count} endpoint${count === 1 ? "" : "s"} from your request${parsed.length === 1 ? "" : "s"}` };
  }

  async command(input) {
    const action = String(input.action ?? "");
    if (action === "search_mcp_registry") return { results: await this.searchRegistry(input.query) };
    if (action === "list_skill_pack") return { skills: await listPack(String(input.repo ?? "")) };
    if (action === "install_skill") return installSkill(String(input.repo ?? ""), String(input.directory ?? ""));
    if (action === "remove_skill") return removeSkill(String(input.name ?? ""));
    if (action === "install_mcp_server") return this.install(input);
    if (action === "connect_mcp_server") return this.connect(input);
    if (action === "add_mcp_server") return this.add(input);
    if (action === "set_mcp_server_enabled") return this.setEnabled(input);
    if (action === "set_mcp_server_folder") return this.setFolder(input);
    if (action === "remove_mcp_server") return this.remove(input);
    throw new Error(`Unknown capability action ${action || "(none)"}`);
  }

  /**
   * A server named after the API it talks to. `https://www.freelancer.com` becomes `freelancer`,
   * `https://api.open-meteo.com` becomes `open-meteo`. Anything that does not reduce to a usable
   * name, an IP address included, falls back to the catalog's own name.
   */
  hostServerName(url) {
    let host;
    try { host = new URL(String(url)).hostname; } catch { return ""; }
    if (!host || /^[\d.]+$/.test(host) || host.includes(":")) return "";
    const labels = host.replace(/^(www|api)\./i, "").split(".");
    const name = (labels.length > 1 ? labels.slice(0, -1) : labels).join("-")
      .replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
    return SERVER_NAME.test(name) ? name : "";
  }

  /** A free server name: the catalog's own, or that name with a counter when it is taken. */
  freeServerName(wanted) {
    const taken = new Set(this.servers().map(({ serverName }) => serverName));
    if (!taken.has(wanted)) return wanted;
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = `${wanted.slice(0, 29)}-${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
    throw new Error(`Too many servers already named ${wanted}`);
  }

  async insert(server, secrets) {
    // Before the row, so a folder that is not on this computer leaves no server behind.
    if (server.folder) setServerFolder(server.id, server.folder);
    const at = iso();
    transaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO mcp_servers (id, server_name, label, transport, command, args_json, url,
          env_names_json, header_names_json, catalog_id, source, enabled, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(server.id, server.serverName, server.label, server.transport, server.command,
        JSON.stringify(server.args), server.url, JSON.stringify(server.envNames),
        JSON.stringify(server.headerNames), server.catalogId, server.source, at);
      this.onlyBrowser(server);
      // a process whose add-on check wanted this one before it was connected gets it ticked now;
      // a bridge is made per API, so a later one for another API is not the one it wanted
      if (!catalogEntry(server.catalogId)?.nameFrom) this.database.prepare(`
        UPDATE processes SET mcp_servers_json = json_insert(mcp_servers_json, '$[#]', ?), updated_at = ?
        WHERE mcp_access = 'listed' AND archived_at IS NULL AND id IN (
          SELECT json_extract(c.value, '$.addonsFor') FROM bees_proposals p, json_each(p.changes_json) c
          WHERE p.status = 'applied' AND json_extract(c.value, '$.needsConnect') AND json_extract(c.value, '$.catalogId') = ?)
          AND NOT EXISTS (SELECT 1 FROM json_each(mcp_servers_json) WHERE value = ?)
      `).run(server.serverName, at, server.catalogId ?? "", server.serverName);
    });
    // After the row lands, so a rejected write leaves a fixable server not an orphan secret.
    await this.storeSecrets(server, secrets);
    await this.serialize(server.id, () => this.mount({ ...server, enabled: true }));
    return { id: server.id, serverName: server.serverName };
  }

  async storeSecrets(server, secrets) {
    for (const [name, raw] of Object.entries(secrets)) {
      let value = String(raw ?? "").trim();
      // the planner hands a header as "Name: {{credential:KEY}}", so every reference is swapped, not only a bare one
      for (const [whole, key] of [...value.matchAll(PASTED)]) {
        const stored = (await this.ctx.credentials.resolve(credentialRef(key)))?.value;
        if (!stored) throw new Error(`${name} was pasted earlier but its stored value is gone. Paste the header again.`);
        value = value.replace(whole, () => stored);
      }
      if (value) await this.ctx.credentials.set(secretRef(server, name), value);
    }
  }

  /** A request for a host the bridge already serves adds its endpoints there: one server per API. */
  async mergeIntoHost(entry, found, secrets) {
    const server = this.servers().find((row) => row.catalogId === entry.id && row.args[row.args.indexOf("--api-base-url") + 1] === found.apiBaseUrl);
    if (!server) return null;
    const at = server.args.indexOf("--openapi-spec");
    // a spec that can't be read as json any more gets its own server rather than a failed install
    const spec = await readSpec(server.args[at + 1]).catch(() => null);
    if (!spec?.paths) return null;
    for (const [path, ops] of Object.entries(found.spec.paths))
      for (const [verb, op] of Object.entries(ops)) {
        const before = spec.paths[path]?.[verb]?.parameters ?? [];
        // a later bare paste must not wipe the parameters an earlier fuller one found
        const byName = new Map(before.concat(op.parameters ?? []).map((one) => [one.name, one]));
        spec.paths[path] = { ...spec.paths[path], [verb]: { ...op, parameters: [...byName.values()] } };
      }
    server.args[at + 1] = await this.writeSpec(found.host, JSON.stringify(spec, null, 2));
    await this.typedTools(server.args, server.args[at + 1]);
    await this.verifyEndpoints(server.args[at + 1]);
    server.headerNames = [...new Set([...server.headerNames, ...Object.keys(secrets)])];
    this.database.prepare("UPDATE mcp_servers SET args_json = ?, header_names_json = ? WHERE id = ?")
      .run(JSON.stringify(server.args), JSON.stringify(server.headerNames), server.id);
    await this.storeSecrets(server, secrets);
    await this.serialize(server.id, () => this.remount(server));
    return { id: server.id, serverName: server.serverName };
  }

  // a pasted credential header moves to the credential store; the text keeps a reference insert() resolves
  async stash(value) {
    if (Array.isArray(value)) return Promise.all(value.map((entry) => this.stash(entry)));
    if (value && typeof value === "object")
      return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, entry]) => [key, await this.stash(entry)])));
    if (typeof value !== "string") return value;
    let text = value;
    for (const [whole, flag, quote, name, secret] of [...value.matchAll(/((?:-H|--header)\s*)(['"])([^'":]*(?:auth|token|key|secret|cookie|session|oauth)[^'":]*:\s*)(.+?)\2/gi)]) {
      if (secret.includes("{{credential:")) continue;
      const key = `BEES_PASTED_${name.split(":")[0]}_${createHash("sha256").update(secret.trim()).digest("hex").slice(0, 8)}`
        .replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
      await this.ctx.credentials.set(credentialRef(key), secret.trim());
      text = text.replace(whole, `${flag}${quote}${name}{{credential:${key}}}${quote} (stored in Bees; call this API through its MCP server)`);
    }
    return text;
  }

  /** Dynamic mode hides every parameter behind an empty `params` object, and a small local model
   *  fills that with nothing. A short spec drives far better as one typed tool per endpoint. */
  async typedTools(args, specFile) {
    const at = args.indexOf("--tools");
    if (at < 0 || !specFile || /^https?:/.test(specFile)) return args;
    try {
      const { paths = {} } = JSON.parse(await readFile(placed(specFile), "utf8"));
      if (Object.keys(paths).length <= 12) args[at + 1] = "all";
    } catch { /* an unreadable spec keeps the mode it was installed with */ }
    return args;
  }

  /** Catches a spec that names a route the API refuses, before a run dies on it. Only a GET goes out:
   *  a replayed POST or DELETE with no credential still fires a webhook or changes an open API.
   *  A 405 counts, a 404 does not: APIs answer 404 to hide a resource from a caller with no session. */
  async verifyEndpoints(specSource) {
    const spec = specSource ? await readSpec(specSource).catch(() => null) : null;
    const origin = spec?.servers?.[0]?.url;
    const paths = Object.entries(spec?.paths ?? {});
    if (!origin || paths.length > 12 || await privateAddress(origin)) return;
    // a server url may carry a prefix like /v1, and joining it must not drop that
    const base = String(origin).replace(/\/+$/, "");
    for (const [path, operations] of paths) {
      // a templated path has no single address to probe
      if (path.includes("{") || !operations?.get) continue;
      let status;
      try {
        status = (await fetch(`${base}/${path.replace(/^\/+/, "")}`, { redirect: "manual", signal: AbortSignal.timeout(5000) })).status;
      } catch { continue; }
      if (status === 405)
        throw new Error(`${origin} refuses GET ${path}. Describe that endpoint the way the API really serves it, then install it again.`);
    }
  }

  /** `signIn` only ever comes from connect, so no request or agent can hand a sign-in entry made-up secrets. */
  async install(input, signIn) {
    const entry = catalogEntry(required(input.catalogId, "Catalog entry"));
    if (!entry) throw new Error("That catalog entry is unavailable");
    if (entry.scopes && !signIn) throw new Error(`${entry.label} needs the owner to click Connect with Google on the Add-ons page`);
    // Which folder a server may reach is a person's choice on the machine it runs on, so a run cannot make it
    if (input.viaAgent && entry.requiresDirectory) throw new Error(`${entry.label} is added on the Add-ons page, where the person picks the folder it may reach`);
    const directory = String(input.directory ?? "").trim();
    if (entry.requiresDirectory && !directory) throw new Error(`${entry.label} needs a folder`);
    assertFolderOutsideBees(directory, this.defaultWorkspace, entry.label);
    const secrets = {};
    for (const secret of [...entry.env, ...entry.headers]) {
      const value = String((signIn ?? input).secrets?.[secret.name] ?? "").trim();
      if (!value && !secret.optional) throw new Error(`${entry.label} needs ${secret.label}`);
      if (value) secrets[secret.name] = value;
    }
    const given = { ...(input.inputs ?? {}) };
    // a run could aim a bridge at this computer's own ports or the router, so only the person adds one of those
    const personOnly = async (address) => {
      if (input.viaAgent && await privateAddress(address)) throw new Error(`${address} is on this computer or a private network, so the person adds it on the Add-ons page`);
    };
    await personOnly(given.apiBaseUrl);
    await personOnly(given.openapiSpec);
    const headerNames = entry.headers.map(({ name }) => name);
    // Nobody knows their spec URL. Ask the API, or read the working requests.
    if (entry.inputs.some(({ name }) => name === "openapiSpec") && !String(given.openapiSpec ?? "").trim()) {
      const curl = String(given.curl ?? "").trim();
      const found = curl ? this.specFromRequest(curl) : await this.discoverSpec(given.apiBaseUrl);
      if (found.kind === "from-curl") {
        await personOnly(found.apiBaseUrl);
        Object.assign(secrets, found.headers);
        headerNames.push(...Object.keys(found.headers));
        // the person's own typed header counts too: passing only the curl's headers dropped it here
        const merged = await this.mergeIntoHost(entry, found, secrets);
        if (merged) return merged;
        found.specUrl = await this.writeSpec(found.host, JSON.stringify(found.spec, null, 2));
      }
      if (!found.specUrl) throw new Error(`${found.how}. Paste its OpenAPI spec URL instead.`);
      given.openapiSpec = found.specUrl;
      if (found.apiBaseUrl) given.apiBaseUrl = found.apiBaseUrl;
    }
    const args = [...entry.args];
    for (const field of entry.inputs) {
      const value = String(given[field.name] ?? "").trim();
      if (!value && !field.optional) throw new Error(`${entry.label} needs ${field.label}`);
      // A field with no flag is consumed here rather than passed to the command.
      if (value && field.flag) args.push(field.flag, value);
    }
    // The folder is the person's on this computer, so the row keeps its place rather than its path.
    if (entry.requiresDirectory) args.push(FOLDER);
    await this.typedTools(args, given.openapiSpec);
    await this.verifyEndpoints(given.openapiSpec);
    const api = entry.nameFrom && this.hostServerName(given[entry.nameFrom]);
    return this.insert({
      id: randomUUID(),
      folder: directory,
      serverName: this.freeServerName(api || entry.serverName),
      label: signIn?.label ?? (api ? `${api[0].toUpperCase()}${api.slice(1)} API` : entry.label),
      transport: entry.transport,
      command: entry.command,
      args,
      url: entry.url,
      envNames: entry.env.map(({ name }) => name),
      headerNames,
      catalogId: entry.id,
      source: "catalog"
    }, secrets);
  }

  /** Only a person can start a sign-in, so this action stays out of bees_control. The server is
   *  installed once Google redirects back; the page picks it up on its next poll. */
  async connect(input) {
    const entry = catalogEntry(required(input.catalogId, "Catalog entry"));
    if (!entry?.scopes) throw new Error("That catalog entry has no sign-in");
    const { googleDesktopClientId: clientId, googleDesktopClientSecret: clientSecret } = await this.connected.authConfig();
    const scopes = [...entry.scopes, "openid", "https://www.googleapis.com/auth/userinfo.email"];
    const consent = await googleConsent({ clientId, clientSecret }, scopes, async (client) => {
      // the id token came straight from Google over TLS, so its email needs no signature check
      const { email } = JSON.parse(Buffer.from(client.credentials.id_token.split(".")[1], "base64url"));
      const signIn = {
        label: `${entry.label} (${email})`,
        secrets: { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REFRESH_TOKEN: client.credentials.refresh_token }
      };
      // signing in to the same account again renews that server, so agents listed on it keep it
      const known = this.servers().find((row) => row.catalogId === entry.id && row.label === signIn.label);
      if (!known) return this.install({ catalogId: entry.id }, signIn);
      await this.storeSecrets(known, signIn.secrets);
      await this.serialize(known.id, () => this.remount(known));
    });
    this.consent?.close();
    this.consent = consent;
    return { url: consent.url };
  }

  async add(input) {
    const serverName = required(input.serverName, "Server name");
    if (!SERVER_NAME.test(serverName))
      throw new Error("A server name may use letters, digits, dash and underscore, up to 32 characters");
    if (this.servers().some((row) => row.serverName === serverName))
      throw new Error(`A server named ${serverName} already exists`);
    const transport = input.transport === "streamable-http" ? "streamable-http" : "stdio";
    const secrets = {};
    for (const [name, value] of Object.entries(input.secrets ?? {})) {
      if (!ENV_NAME.test(name)) throw new Error(`${name} is not a usable variable name`);
      if (String(value ?? "").trim()) secrets[name] = String(value).trim();
    }
    const names = Object.keys(secrets);
    if (input.args !== undefined && !Array.isArray(input.args))
      throw new Error("Arguments must be a list, not one pasted string");
    const typed = (input.args ?? []).map((part) => String(part).trim()).filter(Boolean);
    const words = transport === "stdio"
      ? required(input.command, "Command").match(/"[^"]*"|'[^']*'|\S+/g).map((w) => w.replace(/^["']|["']$/g, ""))
      : [];
    const command = transport === "stdio" ? (words[0] ?? "") : "";
    const args = transport === "stdio" ? [...words.slice(1), ...typed] : [];
    const url = transport === "streamable-http" ? required(input.url, "Server URL") : "";
    // a catalog server added by hand is still that server, or the picker offers it twice and a plan installs it again
    const catalogId = MCP_CATALOG.find((entry) => !entry.requiresDirectory && entry.transport === transport
      && entry.command === command && entry.url === url && JSON.stringify(entry.args) === JSON.stringify(args))?.id ?? "";
    return this.insert({
      id: randomUUID(),
      serverName,
      label: String(input.label ?? "").trim() || serverName,
      transport,
      command,
      args,
      url,
      envNames: transport === "stdio" ? names : [],
      headerNames: transport === "streamable-http" ? names : [],
      catalogId,
      source: "manual"
    }, secrets);
  }

  /** A run holds one browser, so turning one on turns the other off rather than leaving a run to guess. */
  onlyBrowser(server) {
    if (!isBrowserCatalog(server.catalogId)) return;
    for (const other of this.servers()) if (other.id !== server.id && isBrowserCatalog(other.catalogId))
      this.database.prepare("UPDATE mcp_servers SET enabled = 0 WHERE id = ?").run(other.id);
  }

  row(serverId) {
    const row = this.servers().find(({ id }) => id === required(serverId, "Server"));
    if (!row) throw new Error("Server not found");
    return row;
  }

  async setEnabled(input) {
    const server = this.row(input.serverId);
    const enabled = Boolean(input.enabled);
    if (server.enabled === enabled) return { id: server.id, enabled };
    this.database.prepare("UPDATE mcp_servers SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, server.id);
    if (enabled) this.onlyBrowser(server);
    await this.serialize(server.id, () => this.remount({ ...server, enabled }));
    return { id: server.id, enabled };
  }

  /** The folder a folder-bound server may reach, picked on this computer and kept out of the database. */
  async setFolder(input) {
    const server = this.row(input.serverId);
    if (!needsFolder(server.catalogId)) throw new Error(`${server.label} does not take a folder`);
    assertFolderOutsideBees(input.directory, this.defaultWorkspace, server.label);
    setServerFolder(server.id, input.directory);
    // a row from another computer still names its folder, and the slot is all this one keeps
    this.database.prepare("UPDATE mcp_servers SET args_json = ? WHERE id = ?")
      .run(JSON.stringify(server.args), server.id);
    await this.serialize(server.id, () => this.remount(server));
    return { id: server.id, folder: serverFolder(server.id) };
  }

  async remove(input) {
    const server = this.row(input.serverId);
    await this.serialize(server.id, () => this.unmount(server.id));
    for (const name of [...server.envNames, ...server.headerNames]) {
      await this.ctx.credentials.unset(secretRef(server, name));
    }
    this.database.prepare("DELETE FROM mcp_servers WHERE id = ?").run(server.id);
    setServerFolder(server.id, "");
    return { id: server.id, removed: true };
  }
}
