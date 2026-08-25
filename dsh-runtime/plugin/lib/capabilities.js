import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { iso, required, transaction } from "./product-database.js";
import { catalogEntry, MCP_CATALOG, SKILL_CATALOG } from "./mcp-catalog.js";
import { installSkill, listPack, removeSkill, skillsRoot } from "./skill-packs.js";
import { discoverApi } from "./api-discovery.js";
import { specFromCurl } from "./spec-from-curl.js";

/** DSH's own limit on an MCP namespace; a longer or odd name fails at plugin load, not here. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Secrets never go in the product database. Each one is stored under a DSH credential reference
 * derived from the server and the variable, so removing a server can also remove exactly its own.
 */
function secretRef(serverName, name) {
  return credentialRef(`BEES_MCP_${serverName}_${name}`.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase());
}

function parseJson(text, fallback) {
  try {
    const value = JSON.parse(text);
    return value ?? fallback;
  } catch { return fallback; }
}

function rowToServer(row) {
  return {
    id: row.id,
    serverName: row.server_name,
    label: row.label,
    transport: row.transport,
    command: row.command,
    args: parseJson(row.args_json, []),
    url: row.url,
    envNames: parseJson(row.env_names_json, []),
    headerNames: parseJson(row.header_names_json, []),
    catalogId: row.catalog_id,
    source: row.source,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at
  };
}

/**
 * Skills, tools and MCP servers as one surface.
 *
 * Skills and tools are read straight from DSH, which owns them. MCP servers are the part Bees
 * owns: the rows live in the product database and each enabled one is mounted as its own
 * `dsh-mcp-client` fiber, so adding a server publishes its tools without restarting the app.
 */
export class Capabilities {
  constructor(ctx, database, defaultWorkspace) {
    this.ctx = ctx;
    this.database = database;
    this.defaultWorkspace = defaultWorkspace;
    /** serverId -> { fiber, error } for every row we have tried to mount. */
    this.mounted = new Map();
  }

  async initialize() {
    for (const row of this.servers().filter(({ enabled }) => enabled)) await this.mount(row);
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

  /** Resolve a row's secrets and hand `dsh-mcp-client` the config shape it validates. */
  async configFor(server) {
    if (server.transport === "stdio") {
      const env = {};
      for (const name of server.envNames) {
        const hit = await this.ctx.credentials.resolve(secretRef(server.serverName, name));
        if (hit?.value) env[name] = hit.value;
      }
      return {
        transport: "stdio",
        serverName: server.serverName,
        command: server.command,
        args: server.args,
        env,
        // Without this a missing command or a refused connection activates with no tools and no
        // error, and the server sits on "Starting…" forever with nothing to tell the user.
        failOnStartupError: true
      };
    }
    const headers = {};
    for (const name of server.headerNames) {
      const entry = catalogEntry(server.catalogId)?.headers.find((row) => row.name === name);
      const hit = await this.ctx.credentials.resolve(secretRef(server.serverName, name));
      if (hit?.value) headers[name] = `${entry?.prefix ?? ""}${hit.value}`;
    }
    return {
      transport: "streamable-http", serverName: server.serverName, url: server.url, headers,
      failOnStartupError: true
    };
  }

  /**
   * Mount one server. A server that will not start is a normal, reportable state — a bad command
   * or an expired token must leave the rest of Bees running, so the failure is recorded, not thrown.
   */
  async mount(server) {
    if (this.mounted.has(server.id)) return this.mounted.get(server.id);
    // Reserve the slot before the first await: two quick enables of the same row would otherwise
    // both pass the check above and leave one fiber unreachable and undisposable.
    const entry = { fiber: null, error: "", ready: false };
    this.mounted.set(server.id, entry);
    try {
      const fiber = this.ctx.plugin(mcpClient, await this.configFor(server));
      entry.fiber = fiber;
      await fiber;
      entry.ready = true;
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
    }
    // A row removed while its fiber was starting must not leave the child process behind.
    if (!this.mounted.has(server.id) && entry.fiber) await entry.fiber.dispose().catch(() => {});
    return entry;
  }

  async unmount(serverId) {
    const entry = this.mounted.get(serverId);
    this.mounted.delete(serverId);
    if (entry?.fiber) await entry.fiber.dispose().catch(() => {});
  }

  async remount(server) {
    await this.unmount(server.id);
    if (server.enabled) await this.mount(server);
  }

  /**
   * The tools each preset hands an agent.
   *
   * DSH keeps every model-facing tool on the agent plane, so the global registry holds only what
   * Bees itself mounted (the MCP servers). Reading a preset's own scope is the only way to show
   * what a run will actually be able to do.
   */
  async presetTools() {
    let presets = [];
    try { presets = await this.ctx.agentPresets.list(); } catch { return []; }
    const rows = [];
    for (const preset of presets) {
      const row = { id: preset.id, name: preset.name ?? preset.id, broken: preset.broken ?? "", tools: [], skills: [] };
      rows.push(row);
      if (preset.broken) continue;
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
        row.broken = error instanceof Error ? error.message : String(error);
      }
    }
    return rows;
  }

  async snapshot() {
    const servers = this.servers();
    let tools = [];
    try { tools = this.ctx.tools.schemas(); } catch { tools = []; }
    const presets = await this.presetTools();
    // Skills, like tools, are registered per preset. The page lists them once, and says which
    // presets can reach each one.
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

  /**
   * Find an API's OpenAPI document from its base address, so bridging one is a single field.
   *
   * An API that lists its resources but publishes no document gets one written from that listing
   * and saved beside the app's state, because the bridge takes a path or a URL, not a blob.
   */
  async discoverSpec(apiBaseUrl) {
    const address = required(apiBaseUrl, "API base URL");
    const found = await discoverApi(address);
    if (found.kind !== "endpoint-list") return found;
    return { ...found, specUrl: await this.writeSpec(new URL(address).hostname, found.spec) };
  }

  /** A written document needs somewhere to live; the bridge takes a path or a URL, not a blob. */
  async writeSpec(host, spec) {
    const directory = join(process.env.BEES_STATE_DIR || tmpdir(), "api-specs");
    await mkdir(directory, { recursive: true });
    const file = join(directory, `${host.replace(/[^a-z0-9.-]/gi, "-")}.json`);
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
    if (action === "discover_api_spec") return this.discoverSpec(input.apiBaseUrl);
    if (action === "spec_from_curl") return this.specFromRequest(input.curl);
    if (action === "list_skill_pack") return { skills: await listPack(String(input.repo ?? "")) };
    if (action === "install_skill") return installSkill(String(input.repo ?? ""), String(input.directory ?? ""));
    if (action === "remove_skill") return removeSkill(String(input.name ?? ""));
    if (action === "install_mcp_server") return this.install(input);
    if (action === "add_mcp_server") return this.add(input);
    if (action === "set_mcp_server_enabled") return this.setEnabled(input);
    if (action === "set_mcp_server_secret") return this.setSecret(input);
    if (action === "remove_mcp_server") return this.remove(input);
    throw new Error(`Unknown capability action ${action || "(none)"}`);
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
    // Secrets are written after the row lands so a rejected write leaves a visible, fixable server
    // rather than an orphan credential under a name nothing points at.
    for (const [name, value] of Object.entries(secrets)) {
      if (value) await this.ctx.credentials.set(secretRef(server.serverName, name), value);
    }
    await this.mount({ ...server, enabled: true });
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
    // The spec is the one field a person usually does not know. The API can normally be asked, and
    // an API that publishes nothing can still be described by one request that already works.
    if (entry.inputs?.some(({ name }) => name === "openapiSpec") && !String(given.openapiSpec ?? "").trim()) {
      const curl = String(given.curl ?? "").trim();
      const found = curl ? await this.specFromRequest(curl) : await this.discoverSpec(given.apiBaseUrl);
      if (!found.specUrl) throw new Error(`${found.how}. Paste its OpenAPI spec URL instead.`);
      given.openapiSpec = found.specUrl;
      if (found.apiBaseUrl && !String(given.apiBaseUrl ?? "").trim()) given.apiBaseUrl = found.apiBaseUrl;
    }
    const args = [...(entry.args ?? [])];
    for (const field of entry.inputs ?? []) {
      const value = String(given[field.name] ?? "").trim();
      if (!value && !field.optional) throw new Error(`${entry.label} needs ${field.label}`);
      // A field with no flag is consumed here rather than passed to the command.
      if (value && field.flag) args.push(field.flag, value);
    }
    if (directory) args.push(directory);
    return this.insert({
      id: randomUUID(),
      serverName: this.freeServerName(entry.serverName),
      label: entry.label,
      transport: entry.transport,
      command: entry.command ?? "",
      args,
      url: entry.url ?? "",
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
    return this.insert({
      id: randomUUID(),
      serverName,
      label: String(input.label ?? "").trim() || serverName,
      transport,
      command: transport === "stdio" ? required(input.command, "Command") : "",
      args: transport === "stdio"
        ? String(input.args ?? "").split("\n").map((part) => part.trim()).filter(Boolean)
        : [],
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
    await this.remount({ ...server, enabled: Boolean(enabled) });
    return { id: server.id, enabled: Boolean(enabled) };
  }

  async setSecret(input) {
    const server = this.row(input.serverId);
    const name = String(input.name ?? "").trim();
    if (!server.envNames.includes(name) && !server.headerNames.includes(name))
      throw new Error(`${server.label} has no ${name || "such"} setting`);
    const value = String(input.value ?? "").trim();
    if (!value) throw new Error(`${name} cannot be blank`);
    await this.ctx.credentials.set(secretRef(server.serverName, name), value);
    await this.remount(server);
    return { id: server.id };
  }

  async remove(input) {
    const server = this.row(input.serverId);
    await this.unmount(server.id);
    for (const name of [...server.envNames, ...server.headerNames]) {
      await this.ctx.credentials.unset(secretRef(server.serverName, name)).catch(() => {});
    }
    this.database.prepare("DELETE FROM mcp_servers WHERE id = ?").run(server.id);
    return { id: server.id, removed: true };
  }
}
