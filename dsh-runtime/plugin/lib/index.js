import { timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AgentRuntime } from "./agent-runtime.js";
import { openSite, showExecution } from "./browser.js";
import { ProcessRuntime } from "./process-runtime.js";

export const name = "bees";
export const inject = ["webServer", "agents", "agentPresets", "sessionPersistence", "approval"];

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

function equalSecret(left, right) {
  const offered = Buffer.from(String(left ?? ""));
  const expected = Buffer.from(String(right ?? ""));
  return offered.length === expected.length && offered.length > 0 && timingSafeEqual(offered, expected);
}

function tokenFrom(req) {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (bearer) return bearer;
  const cookie = String(req.headers.cookie ?? "").split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === "bees_dsh")?.[1];
  return cookie ? decodeURIComponent(cookie) : "";
}

function reply(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

async function body(req) {
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 6_000_000) throw new Error("Request body is too large");
  }
  return value ? JSON.parse(value) : {};
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function register(ctx, route) {
  ctx.effect(() => ctx.webServer.register(route), `bees route ${route.path}`);
}

function mime(path) {
  const extension = path.slice(path.lastIndexOf("."));
  return MIME[extension] ?? "application/octet-stream";
}

function serveUi(root, req, res) {
  if (!["GET", "HEAD"].includes(req.method ?? "GET")) return reply(res, 405, { error: "method not allowed" });
  const url = new URL(req.url ?? "/bees/", "http://127.0.0.1");
  let relative = decodeURIComponent(url.pathname.slice("/bees".length)).replace(/^\/+/, "");
  if (!relative || relative.endsWith("/")) relative += "index.html";
  let path = resolve(root, relative);
  const canonicalRoot = resolve(root);
  if (path !== canonicalRoot && !path.startsWith(`${canonicalRoot}${sep}`)) return reply(res, 404, { error: "not found" });
  if (!existsSync(path) || !statSync(path).isFile()) path = resolve(canonicalRoot, "index.html");
  if (!existsSync(path)) return reply(res, 503, { error: "Bees UI is not built" });
  const size = statSync(path).size;
  res.writeHead(200, {
    "content-type": mime(path),
    "content-length": size,
    "cache-control": path.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable"
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(path).pipe(res);
}

function referenceRows(database, query) {
  const like = `%${String(query ?? "").slice(0, 120)}%`;
  const at = [
    { id: "bees-run", label: "Bees work agent", kind: "agent" },
    { id: "bees-assistant", label: "Bees assistant", kind: "agent" },
    { id: "bees-curator", label: "Bees skill curator", kind: "agent" },
    ...database.prepare(`
      SELECT id, name AS label, 'team' AS kind FROM teams
      WHERE archived_at IS NULL AND name LIKE ? ORDER BY name LIMIT 20
    `).all(like),
    ...database.prepare(`
      SELECT id, title AS label, 'work-item' AS kind FROM work_items
      WHERE deleted_at IS NULL AND title LIKE ? ORDER BY updated_at DESC LIMIT 30
    `).all(like)
  ];
  const locations = database.prepare(`
    SELECT id, name AS label, 'location' AS kind FROM file_locations
    WHERE deleted_at IS NULL AND name LIKE ? ORDER BY name LIMIT 30
  `).all(like);
  const connections = database.prepare(`
    SELECT value_json AS valueJson FROM settings
    WHERE key LIKE 'mcp_connections:%'
    ORDER BY key LIMIT 30
  `).all();
  const mcp = connections.flatMap(({ valueJson }) => {
    try {
      const values = JSON.parse(valueJson);
      return Array.isArray(values) ? values.flatMap((value) => value?.id ? [{
        id: String(value.id),
        label: String(value.name ?? value.id),
        kind: "mcp"
      }] : []) : [];
    } catch { return []; }
  });
  const skills = database.prepare(`
    SELECT id, files_json AS filesJson FROM registries ORDER BY updated_at DESC LIMIT 30
  `).all().flatMap(({ id, filesJson }) => {
    try {
      const files = JSON.parse(filesJson);
      return Array.isArray(files) ? files.flatMap((file) => file?.kind === "skill" && file?.ref ? [{
        id: String(file.ref),
        label: String(file.name ?? file.ref),
        kind: "skill",
        registryId: String(id)
      }] : []) : [];
    } catch { return []; }
  });
  const lower = String(query ?? "").toLocaleLowerCase();
  return {
    at: at.filter(({ label }) => String(label).toLocaleLowerCase().includes(lower)).slice(0, 50),
    dollar: [...locations, ...skills, ...mcp]
      .filter(({ label }) => String(label).toLocaleLowerCase().includes(lower)).slice(0, 50)
  };
}

async function discoverMcp(input) {
  if (!input.url || !input.name || !input.id || !input.teamId)
    throw new Error("name, url, id, and teamId are required");
  if (input.transport === "sse") throw new Error("Legacy MCP SSE is unsupported; use Streamable HTTP");
  const headers = { ...(input.headers ?? {}) };
  if (input.secretRef) {
    const broker = new URL(`/secrets/${encodeURIComponent(input.secretRef)}`, process.env.BEES_CREDENTIAL_BROKER_URL);
    broker.searchParams.set("teamId", input.teamId);
    broker.searchParams.set("connectionId", input.id);
    broker.searchParams.set("purpose", "discovery");
    const response = await fetch(broker, {
      headers: { authorization: `Bearer ${process.env.BEES_CREDENTIAL_BROKER_TOKEN ?? ""}` },
      redirect: "error"
    });
    if (!response.ok) throw new Error("The MCP credential is unavailable");
    const token = String((await response.json()).token ?? "");
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const client = new Client({ name: "bees-discovery", version: "1" }, { capabilities: {} });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(input.url), {
      requestInit: { headers, redirect: "error" }
    }));
    const result = await client.listTools();
    return { tools: result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      readOnly: Boolean(tool.annotations?.readOnlyHint)
    })) };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function apply(ctx) {
  const databasePath = process.env.BEES_DATABASE_PATH;
  const token = process.env.BEES_DSH_TOKEN ?? "";
  const uiRoot = process.env.BEES_UI_ROOT;
  const appUrl = process.env.BEES_APP_URL;
  if (!databasePath || !token || !uiRoot || !appUrl) throw new Error("bees: missing desktop launch configuration");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL");
  ctx.effect(() => () => database.close(), "bees database");
  const agents = new AgentRuntime(ctx, database);
  const processes = new ProcessRuntime(database);
  processes.catchUpAll();
  const timer = setInterval(() => {
    try { processes.catchUpAll(); } catch (error) { ctx.logger.warn(error); }
  }, 15_000);
  timer.unref();
  ctx.effect(() => () => clearInterval(timer), "bees schedule catch-up");

  // The upstream Web profile has a Host-header trust fence but intentionally no local
  // authentication seam. This compatibility fence runs before its dispatcher and rewrites
  // unauthenticated requests onto an exact 401 route; it neither forks nor patches DSH.
  const server = ctx.webServer.server;
  if (!server?.prependListener) throw new Error("bees: DSH webserver authentication seam changed");
  const guard = (req) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (["/bees-auth", "/healthz", "/_bees_unauthorized"].includes(path)) return;
    if (!equalSecret(tokenFrom(req), token)) req.url = "/_bees_unauthorized";
  };
  server.prependListener("request", guard);
  server.prependListener("upgrade", guard);
  ctx.effect(() => () => {
    server.off("request", guard);
    server.off("upgrade", guard);
  }, "bees loopback auth");

  register(ctx, { kind: "exact", path: "/_bees_unauthorized", handler: (_req, res) =>
    reply(res, 401, { error: { message: "unauthorized" } }) });
  register(ctx, { kind: "exact", path: "/healthz", handler: (_req, res) =>
    reply(res, 200, { status: "ok", runtime: "dsh", persistence: "sqlite" }) });
  register(ctx, { kind: "exact", path: "/bees-auth", handler: (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const offered = url.searchParams.get("token");
    if (!equalSecret(offered, token)) return reply(res, 401, { error: { message: "unauthorized" } });
    const next = url.searchParams.get("next") === "/bees/?dsh-host=1" ? "/bees/?dsh-host=1" : "/";
    res.writeHead(302, {
      location: `http://127.0.0.1:${req.socket.localPort}${next}`,
      "set-cookie": `bees_dsh=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`,
      "cache-control": "no-store"
    });
    res.end();
  } });
  register(ctx, { kind: "exact", path: "/bees-return", handler: (_req, res) => {
    res.writeHead(302, { location: appUrl, "cache-control": "no-store" });
    res.end();
  } });
  register(ctx, { kind: "prefix", path: "/bees", handler: (req, res) => serveUi(uiRoot, req, res) });

  register(ctx, { kind: "exact", path: "/bees-api/references", handler: (req, res) => {
    const query = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("q") ?? "";
    reply(res, 200, referenceRows(database, query));
  } });
  register(ctx, { kind: "exact", path: "/bees-api/recovery", handler: (_req, res) => reply(res, 200, {
    runs: database.prepare(`
      SELECT execution_id AS executionId, current_session_id AS currentSessionId,
             previous_session_id AS previousSessionId, status, recovery_count AS recoveryCount,
             updated_at AS updatedAt FROM dsh_runs ORDER BY updated_at DESC LIMIT 100
    `).all(),
    checkpoints: database.prepare(`
      SELECT execution_id AS executionId, session_id AS sessionId, transition, created_at AS createdAt
      FROM bees_run_checkpoints ORDER BY created_at DESC LIMIT 100
    `).all(),
    processCheckpoints: database.prepare(`
      SELECT execution_id AS executionId, work_item_id AS workItemId, transition, created_at AS createdAt
      FROM bees_process_checkpoints ORDER BY created_at DESC LIMIT 100
    `).all()
  }) });

  register(ctx, { kind: "exact", path: "/connections/discover", handler: async (req, res) => {
    try { reply(res, 200, await discoverMcp(await body(req))); }
    catch (error) { reply(res, 502, { error: errorMessage(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/browser/open", handler: async (req, res) => {
    try {
      const input = await body(req);
      reply(res, 200, await openSite(input.profileKey, input.url));
    } catch (error) { reply(res, 409, { error: errorMessage(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/browser/show", handler: async (req, res) => {
    try {
      const input = await body(req);
      reply(res, 200, await showExecution(input.instanceId, input.url));
    } catch (error) { reply(res, 409, { error: errorMessage(error) }); }
  } });

  register(ctx, { kind: "prefix", path: "/organizations", handler: async (req, res) => {
    try {
      const match = /^\/organizations\/([^/]+)\/work-items\/([^/]+)\/runtime$/.exec(
        new URL(req.url ?? "/", "http://127.0.0.1").pathname);
      if (!match) return reply(res, 404, { error: "not found" });
      const organizationId = decodeURIComponent(match[1]);
      const workItemId = decodeURIComponent(match[2]);
      if (req.method === "GET") return reply(res, 200, { runtime: processes.state(organizationId, workItemId) });
      if (req.method === "POST") return reply(res, 200, {
        runtime: processes.command(organizationId, workItemId, await body(req))
      });
      reply(res, 405, { error: "method not allowed" });
    } catch (error) { reply(res, 409, { error: errorMessage(error) }); }
  } });

  register(ctx, { kind: "prefix", path: "/agents", handler: async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      const match = /^\/agents\/([^/]+)\/([^/]+)(\/abort)?$/.exec(path);
      if (!match) return reply(res, 404, { error: { message: "not found" } });
      const agentName = decodeURIComponent(match[1]);
      const executionId = decodeURIComponent(match[2]);
      if (!['bees-run', 'bees-assistant', 'bees-curator'].includes(agentName))
        return reply(res, 404, { error: { message: "agent not found" } });
      if (match[3] === "/abort" && req.method === "POST")
        return reply(res, agents.abort(executionId) ? 202 : 404, { accepted: true });
      if (req.method === "POST") return reply(res, 202, await agents.admit(agentName, executionId, await body(req)));
      if (req.method === "GET") {
        const value = await agents.history(executionId);
        return value ? reply(res, 200, value) : reply(res, 404, { error: { message: "conversation not found" } });
      }
      if (req.method === "DELETE") {
        await agents.purge(executionId);
        return reply(res, 204, {});
      }
      reply(res, 405, { error: { message: "method not allowed" } });
    } catch (error) {
      reply(res, 409, { error: { message: errorMessage(error) } });
    }
  } });
}
