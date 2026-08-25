import { randomUUID } from "node:crypto";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { iso, required, transaction } from "./product-database.js";
import { catalogEntry, MCP_CATALOG } from "./mcp-catalog.js";

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

  async snapshot() {
    const servers = this.servers();
    let tools = [];
    try { tools = this.ctx.tools.schemas(); } catch { tools = []; }
    let skills = [];
    let skillsComplete = true;
    try {
      const found = await this.ctx.skills.list({ cwd: this.defaultWorkspace });
      skills = found.map((skill) => ({
        name: skill.name,
        description: skill.description ?? "",
        whenToUse: skill.whenToUse ?? "",
        provider: skill.provider ?? "",
        source: skill.source ?? skill.root ?? ""
      }));
    } catch (error) {
      skillsComplete = false;
      skills = [];
      this.ctx.logger?.warn?.(`bees: skill catalog unavailable: ${error}`);
    }
    const byServer = new Map(servers.map((server) => [server.serverName, server]));
    return {
      skills,
      skillsComplete,
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
        secrets: [...env, ...headers].map(({ name, label, help }) => ({ name, label, help }))
      }))
    };
  }

  async command(input) {
    const action = String(input.action ?? "");
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
      if (!value) throw new Error(`${entry.label} needs ${secret.label}`);
      secrets[secret.name] = value;
    }
    return this.insert({
      id: randomUUID(),
      serverName: this.freeServerName(entry.serverName),
      label: entry.label,
      transport: entry.transport,
      command: entry.command ?? "",
      args: directory ? [...(entry.args ?? []), directory] : [...(entry.args ?? [])],
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
