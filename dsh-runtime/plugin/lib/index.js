import { timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import z from "@deepseek-ai/schemastery";
import { testOnboardingModel, testPlanningModels } from "./onboarding.js";
import { AgentRuntime } from "./agent-runtime.js";
import { Capabilities } from "./capabilities.js";
import { ConnectedAccount } from "./connected-account.js";
import { GoogleDriveConnection } from "./google-drive.js";
import { ProcessRuntime } from "./process-runtime.js";
import { userMessage } from "./product-database.js";
import { BeesProduct, initializeProductDatabase } from "./product.js";
import { AppPlatform } from "./app-platform.js";

export const name = "bees";
export const inject = [
  "webServer", "connection", "agents", "agentPresets", "sessionPersistence", "approval",
  "workspaceRegistry", "settings", "credentials", "agentDefaultModel", "llm",
  "skills", "tools", "userQuestions", "agentTeams"
];

const ModelPreference = z.object({
  id: z.string(),
  name: z.string(),
  contextWindow: z.number(),
  maxTokens: z.number()
});

const DashboardWidget = z.object({
  kind: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number()
});

const DashboardPreference = z.object({
  id: z.string(),
  name: z.string(),
  widgets: z.array(DashboardWidget).default([])
});

const BeesUiSettings = z.object({
  onboardingAiFocus: z.string().default(""),
  onboarding: z.object({
    version: z.number().default(0),
    active: z.boolean().default(false),
    step: z.number().default(0),
    filesChoice: z.string().default(""),
    workItemId: z.string().default(""),
    teamId: z.string().default(""),
    connectionId: z.string().default(""),
    task: z.string().default("plan"),
    prompt: z.string().default(""),
    inputLocationIds: z.array(z.string()).default([])
  }).default({}),
  lastScope: z.string().default(""),
  systemInstructions: z.string().default(""),
  activeDashboardId: z.string().default("home"),
  dashboards: z.array(DashboardPreference).default([]),
  workItemLayout: z.array(DashboardWidget).default([]),
  pageLayouts: z.dict(z.array(DashboardWidget)).default({}),
  localModelWantedId: z.string().default(""),
  localModelWantedIds: z.array(z.string()).default([]),
  removedLocalModelIds: z.array(z.string()).default([]),
  themePreset: z.string().default("forest"),
  colorMode: z.string().default("dark"),
  darkThemePreset: z.string().default("forest"),
  lightThemePreset: z.string().default("emerald"),
  organizationColors: z.dict(z.string()).default({}),
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

function replyPage(res, ok, detail = "") {
  const safe = String(detail).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>Bees</title>
<style>body{font-family:system-ui,sans-serif;max-width:30rem;margin:5rem auto;padding:0 1rem;text-align:center}</style>
</head><body><h2>${ok ? "Connected" : "Connection failed"}</h2><p>${safe || (ok ? "You can close this window and return to Bees." : "Return to Bees and try again.")}</p>
<script>history.replaceState(null,"","/bees-social-callback")</script></body></html>`;
  res.writeHead(ok ? 200 : 400, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
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

function register(ctx, route) {
  ctx.effect(() => ctx.webServer.register(route), `bees route ${route.path}`);
}

export async function apply(ctx, _config = {}, internals = {}) {
  const databasePath = process.env.BEES_DATABASE_PATH;
  const token = process.env.BEES_DSH_TOKEN;
  const workspace = process.env.BEES_DEFAULT_WORKSPACE;
  if (!databasePath || !token || !workspace) throw new Error("bees: missing desktop launch configuration");

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL");
  const changeSubscribers = new Set();
  let changeRevision = 0;
  const notify = (change = {}) => {
    const event = { revision: ++changeRevision, at: new Date().toISOString(), ...change };
    for (const subscriber of changeSubscribers) {
      try { subscriber(event); }
      catch { changeSubscribers.delete(subscriber); }
    }
  };
  const subscribe = (subscriber) => {
    changeSubscribers.add(subscriber);
    return () => changeSubscribers.delete(subscriber);
  };
  // Cordis disposes effects in parallel, so the database is taken down by hand once its users are down.
  let agents, processes, capabilities, connected, googleDrive;
  ctx.effect(() => async () => {
    agents?.close();
    googleDrive?.close();
    await connected?.close();
    await processes?.close();
    await capabilities?.close();
    database.close();
  }, "bees shutdown");
  const beesSettings = ctx.settings.register("bees-ui", BeesUiSettings);
  initializeProductDatabase(database);
  capabilities = new Capabilities(ctx, database, workspace);
  agents = new AgentRuntime(ctx, database, beesSettings, notify, subscribe, capabilities);
  connected = new ConnectedAccount(database, ctx.credentials, undefined, ctx.logger);
  googleDrive = new GoogleDriveConnection(ctx.credentials, workspace);
  void connected.authConfig().then((config) =>
    googleDrive.configure(config.googleDriveDesktopClientId));
  processes = new ProcessRuntime(database, {
    client: internals.temporalClient, logger: ctx.logger, claims: connected.executionClaims(), notify
  });
  const product = new BeesProduct(database, agents, processes, workspace, {
    workspaceRegistry: ctx.workspaceRegistry,
    agentPresets: ctx.agentPresets,
    tools: ctx.tools,
    googleDrive, notify, capabilities
  });
  // A run that needs a process, an agent or an MCP server builds it through the commands the screens use.
  agents.command = (input) => product.command(input);
  const apps = new AppPlatform(product);
  agents.apps = apps;
  await product.initialize();
  await capabilities.initialize();
  await product.recoverRuns();
  await processes.start((stage, signal) => product.runProcessStage(stage, signal));
  const syncTick = async () => {
    await connected.sync();
    await product.initialize();
    await processes.reconcile();
    notify({ type: "team-sync" });
  };
  const syncTimer = setInterval(() => void syncTick().catch((error) =>
    ctx.logger.warn?.(`bees: background team sync failed: ${userMessage(error)}`)), 15_000);
  syncTimer.unref();
  ctx.effect(() => () => clearInterval(syncTimer), "bees team sync");
  void syncTick().catch((error) => ctx.logger.warn?.(`bees: initial team sync failed: ${userMessage(error)}`));

  const server = ctx.webServer.server;
  if (!server?.prependListener) throw new Error("bees: agent runtime webserver seam changed");
  const guard = (req) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if ([
      "/bees-auth", "/bees-social-callback",
      "/healthz", "/_bees_unauthorized"
    ].includes(path)) return;
    if (!equalSecret(tokenFrom(req), token)) req.url = "/_bees_unauthorized";
  };
  // An upgrade has no response to redirect, so an unauthorized socket is dropped instead.
  const guardUpgrade = (req, socket) => {
    if (!equalSecret(tokenFrom(req), token)) socket.destroy();
  };
  server.prependListener("request", guard);
  server.prependListener("upgrade", guardUpgrade);
  ctx.effect(() => () => {
    server.off("request", guard);
    server.off("upgrade", guardUpgrade);
  }, "bees loopback auth");

  register(ctx, { kind: "exact", path: "/_bees_unauthorized", handler: (_req, res) =>
    reply(res, 401, { error: "unauthorized" }) });
  register(ctx, { kind: "exact", path: "/healthz", handler: (_req, res) =>
    reply(res, 200, { status: "ok", runtime: "dsh", product: "bees" }) });
  register(ctx, { kind: "exact", path: "/bees-api/events", handler: (req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive"
    });
    res.write("retry: 1000\n\n");
    const send = (event) => res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
    changeSubscribers.add(send);
    send({ revision: changeRevision, at: new Date().toISOString(), type: "ready" });
    const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15_000);
    heartbeat.unref();
    req.once("close", () => { clearInterval(heartbeat); changeSubscribers.delete(send); });
  } });
  register(ctx, { kind: "exact", path: "/bees-auth", handler: (req, res) => {
    const offered = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("token");
    if (!equalSecret(offered, token)) return reply(res, 401, { error: "unauthorized" });
    // dsh gates its own index on a launch-token cookie, so send the browser the URL it hands
    // out rather than a bare /, which lands on "dsh web authentication required".
    const base = `http://127.0.0.1:${req.socket.localPort}`;
    res.writeHead(302, {
      location: ctx.connection?.authenticatedUrl?.(base) ?? `${base}/`,
      "set-cookie": `${cookieName(req)}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`,
      "cache-control": "no-store"
    });
    res.end();
  } });
  register(ctx, { kind: "exact", path: "/bees-social-callback", handler: async (req, res) => {
    try {
      await connected.completeBrowserSignIn(
        new URL(req.url ?? "/", "http://127.0.0.1").searchParams
      );
      replyPage(res, true, "Signed in. You can close this window and return to Bees.");
    } catch (error) { replyPage(res, false, userMessage(error)); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/snapshot", handler: async (_req, res) => {
    try { reply(res, 200, { ...await product.snapshot(), systemDefaultModel: ctx.agentDefaultModel.currentSelection() }); }
    catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
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
    } catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
  // The model catalog the agent editor picks from. dsh 0.1.2 dropped the client-side llm.models()
  // that used to build this in the browser; the runtime service is server-side only now.
  register(ctx, { kind: "exact", path: "/bees-api/onboarding/test-ai", handler: async (req, res) => {
    if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" });
    try {
      const input = await body(req);
      reply(res, 200, Object.hasOwn(input, "plannerModel")
        ? await testPlanningModels(ctx, input) : await testOnboardingModel(ctx));
    }
    catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/llm-models", handler: async (_req, res) => {
    const groups = [];
    const failures = [];
    for (const provider of ctx.llm.listProviders()) {
      try {
        groups.push({ ...provider, models: await ctx.llm.listModels(provider.id) });
      } catch (error) {
        // One unreachable provider must not cost the editor every other model.
        failures.push({ provider: provider.id, error: userMessage(error) });
      }
    }
    reply(res, 200, { groups, failures });
  } });
  register(ctx, { kind: "exact", path: "/bees-api/capabilities", handler: async (req, res) => {
    try {
      if (req.method === "GET") return reply(res, 200, await capabilities.snapshot());
      if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" });
      reply(res, 200, await capabilities.command(await body(req)));
    } catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/connections", handler: async (req, res) => {
    try {
      const config = await connected.authConfig();
      googleDrive.configure(config.googleDriveDesktopClientId);
      if (req.method === "GET") return reply(res, 200, { googleDrive: await googleDrive.status() });
      if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" });
      const input = await body(req);
      if (input.action === "connect_google_drive") {
        return reply(res, 200, await googleDrive.start());
      }
      if (input.action === "disconnect_google_drive") {
        return reply(res, 200, { googleDrive: await googleDrive.disconnect() });
      }
      throw new Error("Unknown connection action");
    } catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/references", handler: async (req, res) => {
    const query = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("q") ?? "";
    const workspaceId = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("workspaceId") ?? "";
    try { reply(res, 200, await product.references(query, workspaceId)); }
    catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/search", handler: async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const query = url.searchParams.get("q") ?? "";
      reply(res, 200, { results: await product.search(query, url.searchParams.get("workspaceId") ?? "") });
    } catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/audit", handler: (_req, res) =>
    reply(res, 200, { events: product.audit() }) });
  register(ctx, { kind: "exact", path: "/bees-api/run-history", handler: async (req, res) => {
    try {
      const executionId = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("executionId") ?? "";
      reply(res, 200, { history: await product.runHistory(executionId) });
    } catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/location-file", handler: (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      reply(res, 200, product.locationFile(url.searchParams.get("locationId") ?? "", url.searchParams.get("path") ?? ""));
    } catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/run-file", handler: (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      reply(res, 200, product.runFile(url.searchParams.get("executionId") ?? "", url.searchParams.get("path") ?? ""));
    } catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/apps", handler: async (req, res) => {
    try {
      if (req.method === "GET") {
        const url = new URL(req.url, "http://127.0.0.1");
        return reply(res, 200, apps.snapshot(url.searchParams.get("workspaceId")));
      }
      if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" });
      const result = await apps.command(await body(req));
      notify({ type: "apps-changed" });
      reply(res, 200, result);
    } catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/command", handler: async (req, res) => {
    if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" });
    try {
      reply(res, 200, await product.command(await body(req)));
      void connected.syncCoordination().catch((error) =>
        ctx.logger.warn?.(`bees: team sync after change failed: ${userMessage(error)}`));
    }
    catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/collaboration", handler: async (req, res) => {
    try {
      if (req.method === "GET") {
        const result = await connected.summary();
        await product.initialize();
        await processes.reconcile();
        return reply(res, 200, result);
      }
      if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" });
      const input = await body(req);
      if (["social_start", "sso_start"].includes(input.action)) input.callbackPort = req.socket.localPort;
      const result = await connected.command(input);
      await product.initialize();
      await processes.reconcile();
      reply(res, 200, result);
    } catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
}
