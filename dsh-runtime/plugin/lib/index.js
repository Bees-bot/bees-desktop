import { timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
import { AgentRuntime } from "./agent-runtime.js";
import { ConnectedAccount } from "./connected-account.js";
import { ProcessRuntime } from "./process-runtime.js";
import { BeesProduct, initializeProductDatabase } from "./product.js";

export const name = "bees";
export const inject = [
  "webServer", "agents", "agentPresets", "sessionPersistence", "approval",
  "workspaceRegistry", "settings", "credentials", "agentDefaultModel", "llm"
];

const ModelPreference = z.object({
  id: z.string(),
  name: z.string(),
  contextWindow: z.number(),
  maxTokens: z.number()
});

const BeesUiSettings = z.object({
  pins: z.array(z.string()).default([]),
  lastScope: z.string().default(""),
  localModelWantedId: z.string().default(""),
  freeAiProviders: z.array(z.string()).default([]),
  generalAiProviders: z.array(z.string()).default([]),
  generalAiModels: z.dict(z.array(ModelPreference)).default({}),
  codexModels: z.array(ModelPreference).default([]),
  externalLocalAiProfile: z.object({
    displayName: z.string(),
    api: z.string(),
    baseURL: z.string(),
    models: z.array(ModelPreference).default([])
  }).default({}),
  localModels: z.array(z.object({
    id: z.string(),
    name: z.string(),
    fileName: z.string(),
    url: z.string(),
    bytes: z.number().default(0)
  })).default([])
});

function equalSecret(left, right) {
  const offered = Buffer.from(String(left ?? ""));
  const expected = Buffer.from(String(right ?? ""));
  return offered.length === expected.length && offered.length > 0 && timingSafeEqual(offered, expected);
}

function cookieName(req) {
  return `bees_dsh_${req.socket.localPort}`;
}

function tokenFrom(req) {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (bearer) return bearer;
  const cookie = String(req.headers.cookie ?? "").split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === cookieName(req))?.[1];
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
    if (value.length > 1_000_000) throw new Error("Request body is too large");
  }
  return value ? JSON.parse(value) : {};
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function register(ctx, route) {
  ctx.effect(() => ctx.webServer.register(route), `bees route ${route.path}`);
}

export async function apply(ctx, _config = {}, internals = {}) {
  const databasePath = process.env.BEES_DATABASE_PATH;
  const token = process.env.BEES_DSH_TOKEN ?? "";
  const workspace = process.env.BEES_DEFAULT_WORKSPACE;
  if (!databasePath || !token || !workspace) throw new Error("bees: missing desktop launch configuration");

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL");
  ctx.effect(() => () => database.close(), "bees database");
  ctx.settings.register(settingsNamespace("bees-ui"), BeesUiSettings);
  initializeProductDatabase(database);
  const agents = new AgentRuntime(ctx, database);
  const processes = new ProcessRuntime(database, { client: internals.temporalClient, logger: ctx.logger });
  const product = new BeesProduct(database, agents, processes, workspace, {
    workspaceRegistry: ctx.workspaceRegistry,
    agentPresets: ctx.agentPresets
  });
  const connected = new ConnectedAccount(database, ctx.credentials);
  await product.initialize();
  await processes.start((stage, signal) => product.runProcessStage(stage, signal));
  ctx.effect(() => () => processes.close(), "bees Temporal worker");

  const server = ctx.webServer.server;
  if (!server?.prependListener) throw new Error("bees: DSH webserver seam changed");
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
    reply(res, 401, { error: "unauthorized" }) });
  register(ctx, { kind: "exact", path: "/healthz", handler: (_req, res) =>
    reply(res, 200, { status: "ok", runtime: "dsh", product: "bees" }) });
  register(ctx, { kind: "exact", path: "/bees-auth", handler: (req, res) => {
    const offered = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("token");
    if (!equalSecret(offered, token)) return reply(res, 401, { error: "unauthorized" });
    res.writeHead(302, {
      location: `http://127.0.0.1:${req.socket.localPort}/`,
      "set-cookie": `${cookieName(req)}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`,
      "cache-control": "no-store"
    });
    res.end();
  } });
  register(ctx, { kind: "exact", path: "/bees-api/snapshot", handler: async (_req, res) =>
    reply(res, 200, { ...await product.snapshot(), systemDefaultModel: ctx.agentDefaultModel.currentSelection() }) });
  register(ctx, { kind: "exact", path: "/bees-api/system-default-model", handler: async (req, res) => {
    if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" });
    try {
      const value = await body(req);
      const provider = String(value.provider ?? "").trim();
      const model = String(value.model ?? "").trim();
      const reasoningEffort = String(value.reasoningEffort ?? "").trim();
      if (!provider || !model) throw new Error("Choose a provider and model");
      await ctx.agentDefaultModel.saveSelection({ provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) });
      reply(res, 200, { systemDefaultModel: ctx.agentDefaultModel.currentSelection() });
    } catch (error) { reply(res, 409, { error: message(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/references", handler: async (req, res) => {
    const query = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("q") ?? "";
    const workspaceId = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("workspaceId") ?? "";
    try { reply(res, 200, await product.references(query, workspaceId)); }
    catch (error) { reply(res, 409, { error: message(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/search", handler: (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const query = url.searchParams.get("q") ?? "";
      reply(res, 200, { results: product.search(query, url.searchParams.get("workspaceId") ?? "") });
    } catch (error) { reply(res, 409, { error: message(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/audit", handler: (_req, res) =>
    reply(res, 200, { events: product.audit() }) });
  register(ctx, { kind: "exact", path: "/bees-api/run-history", handler: async (req, res) => {
    try {
      const executionId = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("executionId") ?? "";
      reply(res, 200, { history: await product.runHistory(executionId) });
    } catch (error) { reply(res, 409, { error: message(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/run-file", handler: (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      reply(res, 200, product.runFile(url.searchParams.get("executionId") ?? "", url.searchParams.get("path") ?? ""));
    } catch (error) { reply(res, 409, { error: message(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/command", handler: async (req, res) => {
    if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" });
    try { reply(res, 200, await product.command(await body(req))); }
    catch (error) { reply(res, 409, { error: message(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/collaboration", handler: async (req, res) => {
    try {
      if (req.method === "GET") return reply(res, 200, await connected.summary());
      if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" });
      reply(res, 200, await connected.command(await body(req)));
    } catch (error) { reply(res, 409, { error: message(error) }); }
  } });
}
