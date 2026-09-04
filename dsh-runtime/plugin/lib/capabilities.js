import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { browserStatePath, saveBrowserState } from "./agent-browser.js";
import { BROWSER_CATALOG } from "./mcp-catalog.js";
import { iso, message, required, stateDirectory, transaction } from "./product-database.js";
import { catalogEntry, MCP_CATALOG } from "./mcp-catalog.js";
import { installSkill, listPack, removeSkill, SKILL_CATALOG, skillsRoot } from "./skill-packs.js";
import { discoverApi } from "./api-discovery.js";
import { namePreset } from "./preset-names.js";
import { specFromCurl } from "./spec-from-curl.js";

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

function rowToServer(row) {
  return {
    id: row.id, serverName: row.server_name, label: row.label, transport: row.transport,
    command: row.command, url: row.url, catalogId: row.catalog_id, source: row.source,
    createdAt: row.created_at, enabled: Boolean(row.enabled),
    args: JSON.parse(row.args_json),
    envNames: JSON.parse(row.env_names_json),
    headerNames: JSON.parse(row.header_names_json)
  };
}

/** Skills and tools come from DSH. MCP servers are ours: one mounted fiber per enabled row,
 *  except the browser, which mounts per run. */
export class Capabilities {
  constructor(ctx, database, defaultWorkspace) {
    this.ctx = ctx;
    this.database = database;
    this.defaultWorkspace = defaultWorkspace;
    /** serverId -> { fiber, error } for every row we have tried to mount. */
    this.mounted = new Map();
    /** serverId -> the mutation currently in flight for it. */
    this.queued = new Map();
  }

  async initialize() {
    await Promise.all(this.servers()
      .filter(({ enabled, catalogId }) => enabled && catalogId !== BROWSER_CATALOG)
      .map((row) => this.mount(row)));
  }

  /**
   * The browser is the one server that cannot be shared. Playwright's own docs say concurrent
   * clients on one profile conflict, and they do: two runs browsing at once landed on each other's
   * pages, so a run asked for a calendar and read a news site. Each run mounts its own on its agent
   * context, which dies with the run, and they stay signed in through the shared cookie file.
   */
  async mountBrowserFor(agentCtx) {
    const row = this.servers().find(({ enabled, catalogId }) => enabled && catalogId === BROWSER_CATALOG);
    if (!row) return;
    // Whatever a person has signed into since the last run is what this one inherits.
    await saveBrowserState().catch((error) =>
      this.ctx.logger.warn(`bees: this run starts signed out, cookies could not be read: ${message(error)}`));
    const fiber = agentCtx.plugin(mcpClient, await this.configFor(row));
    await started(fiber, row.serverName);
  }

  async close() {
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
  async configFor(server) {
    if (server.transport === "stdio") {
      const env = {};
      for (const name of server.envNames) {
        const hit = await this.ctx.credentials.resolve(secretRef(server, name));
        if (hit?.value) env[name] = hit.value;
      }
      // Filled in on connect rather than at install: the cookie file is written by whichever
      // browser the person last signed in to.
      return {
        transport: "stdio",
        serverName: server.serverName,
        command: server.command,
        args: server.args.map((arg) => arg === "{browserState}" ? browserStatePath() : arg),
        env,
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
    if (this.mounted.has(server.id)) return this.mounted.get(server.id);
    // Reserve before the first await, or a second enable leaves an undisposable fiber.
    const entry = { fiber: null, error: "", ready: false };
    this.mounted.set(server.id, entry);
    try {
      const fiber = this.ctx.plugin(mcpClient, await this.configFor(server));
      entry.fiber = fiber;
      await started(fiber, server.serverName);
      entry.ready = true;
    } catch (error) {
      const reason = message(error);
      // The client names the server but never what it tried, which is what you need.
      const attempted = server.transport === "stdio"
        ? `Bees tried to run: ${[server.command, ...server.args].join(" ")}`
        : `Bees tried to reach ${server.url}`;
      entry.error = `${reason}. ${attempted}`;
    }
    // A row removed while its fiber was starting must not leave the child process behind.
    if (!this.mounted.has(server.id) && entry.fiber) await stop(this.ctx, entry.fiber, server.serverName);
    return entry;
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
        const scope = await this.ctx.agentPresets.standingKeyFor(preset.id);
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
        return {
          ...server,
          toolCount,
          error: state?.error ?? "",
          status: !server.enabled ? "off" : state?.error ? "failed" : state?.ready ? "connected" : "starting"
        };
      }),
      catalog: MCP_CATALOG.map(({ env, headers, ...entry }) => ({
        ...entry,
        installedAs: servers.find(({ catalogId }) => catalogId === entry.id)?.id ?? "",
        secrets: [...env, ...headers].map(({ name, label, help, optional }) => ({ name, label, help, optional: Boolean(optional) }))
      }))
    };
  }

  /** The public MCP registry, remote servers only: a stdio row would mean installing a package. */
  async searchRegistry(query) {
    const search = String(query ?? "").trim();
    const response = await fetch(
      `https://registry.modelcontextprotocol.io/v0/servers?limit=40${search ? `&search=${encodeURIComponent(search)}` : ""}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!response.ok) throw new Error(`The MCP registry answered ${response.status}`);
    const { servers = [] } = await response.json();
    const seen = new Set();
    return servers.flatMap(({ server }) => {
      const remote = server?.remotes?.find(({ type }) => type === "streamable-http");
      if (!remote || !server.name || seen.has(server.name)) return [];
      seen.add(server.name);
      return [{
        name: server.name,
        title: server.title || server.name,
        description: server.description ?? "",
        url: remote.url,
        // Reverse-domain names carry dots and slashes the namespace pattern refuses.
        serverName: server.name.split("/").pop().replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32)
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
    const directory = join(stateDirectory(), "api-specs");
    await mkdir(directory, { recursive: true });
    const stamp = createHash("sha256").update(spec).digest("hex").slice(0, 12);
    const file = join(directory, `${host.replace(/[^a-z0-9.-]/gi, "-")}-${stamp}.json`);
    await writeFile(file, spec);
    return file;
  }

  /** For an API that publishes nothing: one request that already works describes one endpoint. */
  async specFromRequest(command) {
    const { spec, request, host } = specFromCurl(command);
    return {
      kind: "from-curl",
      specUrl: await this.writeSpec(host, spec),
      apiBaseUrl: request.origin,
      how: `described ${request.method.toUpperCase()} ${request.path} from your request`,
      endpointCount: 1
    };
  }

  async command(input) {
    const action = String(input.action ?? "");
    if (action === "search_mcp_registry") return { results: await this.searchRegistry(input.query) };
    if (action === "list_skill_pack") return { skills: await listPack(String(input.repo ?? "")) };
    if (action === "install_skill") return installSkill(String(input.repo ?? ""), String(input.directory ?? ""));
    if (action === "remove_skill") return removeSkill(String(input.name ?? ""));
    if (action === "install_mcp_server") return this.install(input);
    if (action === "add_mcp_server") return this.add(input);
    if (action === "set_mcp_server_enabled") return this.setEnabled(input);
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
    const at = iso();
    transaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO mcp_servers (id, server_name, label, transport, command, args_json, url,
          env_names_json, header_names_json, catalog_id, source, enabled, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(server.id, server.serverName, server.label, server.transport, server.command,
        JSON.stringify(server.args), server.url, JSON.stringify(server.envNames),
        JSON.stringify(server.headerNames), server.catalogId, server.source, at);
    });
    // After the row lands, so a rejected write leaves a fixable server not an orphan secret.
    for (const [name, value] of Object.entries(secrets)) {
      if (value) await this.ctx.credentials.set(secretRef(server, name), value);
    }
    await this.serialize(server.id, () => this.mount({ ...server, enabled: true }));
    return { id: server.id };
  }

  async install(input) {
    const entry = catalogEntry(required(input.catalogId, "Catalog entry"));
    if (!entry) throw new Error("That catalog entry is unavailable");
    const directory = String(input.directory ?? "").trim();
    if (entry.requiresDirectory && !directory) throw new Error(`${entry.label} needs a folder`);
    const secrets = {};
    for (const secret of [...entry.env, ...entry.headers]) {
      const value = String(input.secrets?.[secret.name] ?? "").trim();
      if (!value && !secret.optional) throw new Error(`${entry.label} needs ${secret.label}`);
      if (value) secrets[secret.name] = value;
    }
    const given = { ...(input.inputs ?? {}) };
    // Nobody knows their spec URL. Ask the API, or read one working request.
    if (entry.inputs.some(({ name }) => name === "openapiSpec") && !String(given.openapiSpec ?? "").trim()) {
      const curl = String(given.curl ?? "").trim();
      const found = curl ? await this.specFromRequest(curl) : await this.discoverSpec(given.apiBaseUrl);
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
    if (directory) args.push(directory);
    return this.insert({
      id: randomUUID(),
      serverName: this.freeServerName(
        (entry.nameFrom && this.hostServerName(given[entry.nameFrom])) || entry.serverName
      ),
      label: entry.label,
      transport: entry.transport,
      command: entry.command,
      args,
      url: entry.url,
      envNames: entry.env.map(({ name }) => name),
      headerNames: entry.headers.map(({ name }) => name),
      catalogId: entry.id,
      source: "catalog"
    }, secrets);
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
    // A pasted "npx -y pkg" means all of it; unsplit it spawns one absurd program name.
    const typed = String(input.args ?? "").split("\n").map((part) => part.trim()).filter(Boolean);
    const words = transport === "stdio"
      ? (required(input.command, "Command").match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^["']|["']$/g, ""))
      : [];
    return this.insert({
      id: randomUUID(),
      serverName,
      label: String(input.label ?? "").trim() || serverName,
      transport,
      command: transport === "stdio" ? (words[0] ?? "") : "",
      args: transport === "stdio" ? [...words.slice(1), ...typed] : [],
      url: transport === "streamable-http" ? required(input.url, "Server URL") : "",
      envNames: transport === "stdio" ? names : [],
      headerNames: transport === "streamable-http" ? names : [],
      catalogId: "",
      source: "manual"
    }, secrets);
  }

  row(serverId) {
    const row = this.servers().find(({ id }) => id === required(serverId, "Server"));
    if (!row) throw new Error("Server not found");
    return row;
  }

  async setEnabled(input) {
    const server = this.row(input.serverId);
    const enabled = input.enabled ? 1 : 0;
    this.database.prepare("UPDATE mcp_servers SET enabled = ? WHERE id = ?").run(enabled, server.id);
    await this.serialize(server.id, () => this.remount({ ...server, enabled: Boolean(enabled) }));
    return { id: server.id, enabled: Boolean(enabled) };
  }

  async setSecret(input) {
    const server = this.row(input.serverId);
    const name = String(input.name ?? "").trim();
    if (!server.envNames.includes(name) && !server.headerNames.includes(name))
      throw new Error(`${server.label} has no ${name || "such"} setting`);
    const value = String(input.value ?? "").trim();
    if (!value) throw new Error(`${name} cannot be blank`);
    await this.ctx.credentials.set(secretRef(server, name), value);
    await this.serialize(server.id, () => this.remount(server));
    return { id: server.id };
  }

  async remove(input) {
    const server = this.row(input.serverId);
    await this.serialize(server.id, () => this.unmount(server.id));
    for (const name of [...server.envNames, ...server.headerNames]) {
      await this.ctx.credentials.unset(secretRef(server, name));
    }
    this.database.prepare("DELETE FROM mcp_servers WHERE id = ?").run(server.id);
    return { id: server.id, removed: true };
  }
}
