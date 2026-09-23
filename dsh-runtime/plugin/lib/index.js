import { join } from "node:path";
import { LOCAL_MEMORY_URL, LocalMemory } from "./local-memory.js";
import { timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import z from "@deepseek-ai/schemastery";
import { testOnboardingModel, testPlanningModels } from "./onboarding.js";
import { AgentRuntime } from "./agent-runtime.js";
import { Capabilities } from "./capabilities.js";
import { ConnectedAccount } from "./connected-account.js";
import { appDirectory, sharedFolder } from "./data-folder.js";
import { mountEvidenceCapture } from "./evidence-capture.js";
import { GoogleDriveConnection } from "./google-drive.js";
import { ProcessRuntime } from "./process-runtime.js";
import { userMessage } from "./product-database.js";
import { BeesProduct, initializeProductDatabase } from "./product.js";
import { AppPlatform } from "./app-platform.js";
import { AppCatalog } from './app-catalog.js';
import { mark, step } from "./startup.js";

export const name = "bees";
export const inject = [
  "webServer", "connection", "agents", "agentPresets", "sessionPersistence", "approval",
  "workspaceRegistry", "settings", "credentials", "agentDefaultModel", "llm",
  "skills", "tools", "userQuestions", "agentTeams", "tokenMeter", "sessions", "web", "attachments"
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

// DSH keeps a plugin's settings in its own Config schema. Every field the UI writes is volatile,
// which is what makes a write land live instead of restarting the plugin.
export const Config = z.object({
  onboardingAiFocus: z.string().default("").volatile(),
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
  }).default({}).volatile(),
  lastScope: z.string().default("").volatile(),
  lastConnectionId: z.string().default("").volatile(),
  systemInstructions: z.string().default("").volatile(),
  activeDashboardId: z.string().default("home").volatile(),
  dashboards: z.array(DashboardPreference).default([]).volatile(),
  workItemLayout: z.array(DashboardWidget).default([]).volatile(),
  pageLayouts: z.dict(z.array(DashboardWidget)).default({}).volatile(),
  seenFiles: z.dict(z.array(z.string())).default({}).volatile(),
  memoryModel: z.string().default("").volatile(),
  localModelWantedIds: z.array(z.string()).default([]).volatile(),
  removedLocalModelIds: z.array(z.string()).default([]).volatile(),
  themePreset: z.string().default("forest").volatile(),
  colorMode: z.string().default("dark").volatile(),
  darkThemePreset: z.string().default("forest").volatile(),
  lightThemePreset: z.string().default("emerald").volatile(),
  organizationColors: z.dict(z.string()).default({}).volatile(),
  freeAiProviders: z.array(z.string()).default([]).volatile(),
  generalAiProviders: z.array(z.string()).default([]).volatile(),
  generalAiModels: z.dict(z.array(ModelPreference)).default({}).volatile(),
  codexModels: z.array(ModelPreference).default([]).volatile(),
  externalLocalAiProfile: z.object({
    displayName: z.string(),
    api: z.string(),
    baseURL: z.string(),
    models: z.array(ModelPreference).default([])
  }).default({}).volatile(),
  localModels: z.array(z.object({
    id: z.string(),
    name: z.string(),
    fileName: z.string(),
    url: z.string(),
    bytes: z.number().default(0)
  })).default([]).volatile()
});

function equalSecret(left, right) {
  const offered = Buffer.from(String(left ?? ""));
  const expected = Buffer.from(String(right ?? ""));
  return offered.length === expected.length && offered.length > 0 && timingSafeEqual(offered, expected);
}

// Cookies are not scoped by port, so naming this per port left one dead cookie on 127.0.0.1 for
// every launch the app ever made. They all get sent, and once the header outgrew the server's
// limit every request came back 431 and the window went blank. One name, overwritten each launch.
const COOKIE_NAME = "bees_dsh";

function tokenFrom(req) {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (bearer) return bearer;
  const cookie = String(req.headers.cookie ?? "").split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === COOKIE_NAME)?.[1];
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

// A tab that was open at quit, or a bookmarked port, arrives with no cookie. A bare "unauthorized"
// tells the person nothing and the launch token it wants is not something they can find.
function replyLocked(res) {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>Open Bees again</title>
<style>body{font-family:system-ui,sans-serif;max-width:30rem;margin:5rem auto;padding:0 1rem;text-align:center}</style>
</head><body><h2>Open Bees again</h2><p>This tab is not signed in. Bees only answers the app on this computer, and the link this tab was opened with has expired.</p><p>Open Bees from the Dock or the menu bar, or quit it and open it again. The new window will work.</p></body></html>`;
  res.writeHead(401, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

const unauthorized = (req, res) => String(req.headers.accept ?? "").includes("text/html")
  ? replyLocked(res) : reply(res, 401, { error: "unauthorized" });

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

// Read the live settings and write them back through DSH's settings service, so a change here and
// a change from the browser land in the same profile document.
function liveSettings(ctx, config, logger) {
  const current = () => Object.fromEntries(Object.entries(config ?? {})
    .map(([key, field]) => [key, typeof field?.get === "function" ? field.get() : field]));
  return {
    get: current,
    update: (patch) => ctx.settings.update("bees", patch)
      .catch((error) => logger.warn(`bees: settings were not saved: ${userMessage(error)}`))
  };
}

export async function apply(ctx, config = {}, internals = {}) {
  const databasePath = process.env.BEES_DATABASE_PATH;
  const token = process.env.BEES_DSH_TOKEN;
  const workspace = process.env.BEES_DEFAULT_WORKSPACE;
  if (!databasePath || !token || !workspace) throw new Error("bees: missing desktop launch configuration");

  const database = step("bees.database.open", () => new DatabaseSync(databasePath));
  // a sync service carries WAL sidecars apart from the database and splices two computers' work
  database.exec(`PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = ${sharedFolder() ? "DELETE" : "WAL"}`);
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
  let agents, processes, capabilities, connected, googleDrive, memory;
  ctx.effect(() => async () => {
    agents?.close();
    googleDrive?.close();
    await connected?.close();
    await processes?.close();
    await memory?.close();
    await capabilities?.close();
    database.close();
  }, "bees shutdown");
  const beesSettings = liveSettings(ctx, config, ctx.logger);
  // Bees owns these screens; without this, DSH also generates a settings page from the same fields.
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber), "bees settings presentation");
  step("bees.database.initialize", () => initializeProductDatabase(database));
  connected = new ConnectedAccount(database, ctx.credentials, undefined, ctx.logger);
  capabilities = new Capabilities(ctx, database, workspace, connected);
  agents = step("bees.agents.initialize", () => new AgentRuntime(ctx, database, beesSettings, notify, subscribe, capabilities));
  agents.connected = connected;
  mountEvidenceCapture(ctx, database, ctx.logger);
  googleDrive = new GoogleDriveConnection(ctx.credentials, workspace);
  void connected.authConfig().then((config) => googleDrive.configure(config));
  processes = new ProcessRuntime(database, {
    client: internals.temporalClient, logger: ctx.logger, claims: connected.executionClaims(), notify,
    abortAgent: (executionId) => agents.abort(executionId),
    needsRecovery: (executionId) => agents.needsRecovery(executionId),
    pendingInteraction: (executionId) => agents.pendingInteraction(executionId)
  });
  ctx.effect(() => subscribe((change) => {
    if (change.executionId && (change.type === "stage-wait-resolved" ||
      change.type === "run/status" && ["running", "completed", "failed", "cancelled"].includes(change.status)))
      void processes.wakeStage(change.executionId).catch((error) =>
        ctx.logger.warn(`bees: workflow wake will be retried: ${userMessage(error)}`));
  }), "bees durable stage wakeups");
  const product = new BeesProduct(database, agents, processes, workspace, {
    workspaceRegistry: ctx.workspaceRegistry,
    agentPresets: ctx.agentPresets,
    tools: ctx.tools, connected,
    googleDrive, notify, capabilities
  });
  processes.canStart = (workItemId) => product.canStartItem(workItemId);
  memory = product.memory;
  // gigabytes built for this machine, so it stays here when the work moves to a shared folder
  memory.local = new LocalMemory(ctx.settings, beesSettings, join(appDirectory(), "memory"));
  memory.local.onStart = () => capabilities.remountUrl(LOCAL_MEMORY_URL).catch((error) =>
    ctx.logger.warn(`bees: memory server remount failed: ${userMessage(error)}`));
  memory.start();
  // A run that needs a process, an agent or an MCP server builds it through the commands the screens use.
  agents.command = (input) => product.command(input);
  const catalog = new AppCatalog(database);
  const apps = new AppPlatform(product, undefined, { connected, catalog });
  agents.apps = apps;
  await step("bees.workspaces.initialize", () => product.initialize());
  await step("bees.integrations.initialize", () => capabilities.initialize());
  await step("bees.runs.recover", () => product.recoverRuns());
  await step("bees.processes.start", () => processes.start((stage, signal) => product.runProcessStage(stage, signal)));
  const syncTick = async () => {
    await connected.sync();
    const teamIds = database.prepare(`SELECT DISTINCT team_id AS id FROM bees_connection_teams`).all();
    await Promise.allSettled(teamIds.flatMap(({ id }) => [
      connected.listProcessQuestions(id), connected.listProcessExecutions(id)
    ]));
    await product.initialize();
    await processes.reconcile();
    notify({ type: "team-sync" });
  };
  const syncTimer = setInterval(() => void syncTick().catch((error) =>
    ctx.logger.warn?.(`bees: background team sync failed: ${userMessage(error)}`)), 15_000);
  syncTimer.unref();
  ctx.effect(() => () => clearInterval(syncTimer), "bees team sync");
  void step("background.team-sync.initial", syncTick).catch((error) => ctx.logger.warn?.(`bees: initial team sync failed: ${userMessage(error)}`));

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

  register(ctx, { kind: "exact", path: "/_bees_unauthorized", handler: unauthorized });
  register(ctx, { kind: "exact", path: "/healthz", handler: (_req, res) =>
    reply(res, 200, { status: "ok", runtime: "dsh", product: "bees" }) });
  mark("bees.health-route.registered");
  const startupMarkers = new Set(["ui.module-loaded", "ui.shell-mounted", "ui.data-rendered"]);
  register(ctx, { kind: "exact", path: "/bees-api/startup", handler: (req, res) => {
    if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" });
    const phase = new URL(req.url, "http://127.0.0.1").searchParams.get("phase");
    // One fixed marker per boot; no arbitrary browser data is written to the log.
    if (startupMarkers.delete(phase)) mark(phase);
    reply(res, 200, { ok: true });
  } });
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
  register(ctx, { kind: "exact", path: "/bees-auth", handler: async (req, res) => {
    const offered = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("token");
    if (!equalSecret(offered, token)) return unauthorized(req, res);
    const base = `http://127.0.0.1:${req.socket.localPort}`;
    const session = [`${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`,
      ...String(req.headers.cookie ?? "").split(";")
        .map((part) => part.trim().split("=")[0])
        .filter((name) => /^bees_dsh_\d+$/.test(name))
        .map((name) => `${name}=; Max-Age=0; Path=/`)];
    const handoff = ctx.connection?.authenticatedUrl?.(base);
    // dsh hands its cookie back on a redirect and the webview does not have it stored for the request
    // that follows, so the exchange happens here and both cookies ride the one response.
    if (handoff) {
      try {
        // the guard sits in front of these fetches too, so they carry its own token
        const auth = { authorization: `Bearer ${token}` };
        const ticket = await fetch(handoff, { redirect: "manual", signal: AbortSignal.timeout(5_000), headers: auth });
        const granted = ticket.headers.getSetCookie();
        await ticket.body?.cancel();
        if (!granted.length) throw new Error(`dsh answered ${ticket.status} to its own token`);
        const page = await fetch(`${base}/`, {
          signal: AbortSignal.timeout(5_000),
          headers: { ...auth, cookie: granted.map((cookie) => cookie.split(";")[0]).join("; ") }
        });
        if (!page.ok) throw new Error(`the app index answered ${page.status}`);
        const html = Buffer.from((await page.text())
          .replace("</head>", '<script>history.replaceState(null,"","/")</script></head>'));
        res.writeHead(200, {
          "content-type": page.headers.get("content-type") ?? "text/html; charset=utf-8",
          "content-length": html.length,
          "cache-control": "no-store",
          "set-cookie": [...session, ...granted]
        });
        return res.end(html);
      } catch (error) {
        ctx.logger.warn(`bees: dsh session handoff failed, falling back to a redirect: ${userMessage(error)}`);
        // a throw after the 200 has gone out must not try to write a second set of headers
        if (res.headersSent) return;
      }
    }
    res.writeHead(302, { location: handoff ?? `${base}/`, "set-cookie": session, "cache-control": "no-store" });
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
        const models = await ctx.llm.listModels(provider.id);
        groups.push({ ...provider, models: await Promise.all(models.map(async (model) => {
          try { return await ctx.llm.resolveModelInfo(provider.id, model.id); }
          catch { return model; }
        })) });
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
      reply(res, 200, await capabilities.command(await capabilities.stash(await body(req))));
    } catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/connections", handler: async (req, res) => {
    try {
      googleDrive.configure(await connected.authConfig());
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
      reply(res, 200, product.runFile(url.searchParams.get("executionId") ?? "", url.searchParams.get("path") ?? "", url.searchParams.get("native") === "1"));
    } catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/apps", handler: async (req, res) => {
    try {
      if (req.method === "GET") {
        const url = new URL(req.url, "http://127.0.0.1");
        return reply(res, 200, await apps.view(url.searchParams.get("workspaceId"), url.searchParams.get('connectionId') ?? ''));
      }
      if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" });
      const result = await apps.command(await body(req));
      notify({ type: "apps-changed" });
      reply(res, 200, result);
    } catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
  register(ctx, { kind: 'exact', path: '/bees-api/app-catalog', handler: async (req, res) => {
    if (req.method !== 'GET') return reply(res, 405, { error: 'method not allowed' });
    try { reply(res, 200, await catalog.list()); }
    catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
  register(ctx, { kind: "exact", path: "/bees-api/command", handler: async (req, res) => {
    if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" });
    try {
      reply(res, 200, await product.command(await capabilities.stash(await body(req))));
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
      if (["accounts", "organization_people", "organization_sso", "team_people"].includes(input.action)) {
        return reply(res, 200, result);
      }
      await product.initialize();
      await processes.reconcile();
      reply(res, 200, result);
    } catch (error) { reply(res, 409, { error: userMessage(error) }); }
  } });
}
