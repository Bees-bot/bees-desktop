import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const name = "bees-free-ai";
export const inject = ["webServer", "credentials"];

const API_KEY_REF = "BEES_FREELLMAPI_API_KEY";

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function requestBody(req) {
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 10_000) throw new Error("Request body is too large");
  }
  return value ? JSON.parse(value) : {};
}

function upstreamError(value, fallback) {
  return value?.error?.message ?? value?.error ?? value?.message ?? fallback;
}

async function freeRequest(runtime, path, options = {}) {
  const response = await fetch(`${runtime.origin}${path}`, {
    method: options.method ?? "GET",
    headers: {
      accept: "application/json",
      "x-dashboard-token": runtime.sessionToken,
      ...(options.body === undefined ? {} : { "content-type": "application/json" })
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(30_000)
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(upstreamError(value, `FreeLLMAPI returned HTTP ${response.status}`));
  return value;
}

async function snapshot(runtime) {
  const [checklist, keys] = await Promise.all([
    freeRequest(runtime, "/api/keys/providers"),
    freeRequest(runtime, "/api/keys")
  ]);
  return {
    baseUrl: `${runtime.origin}/v1`,
    providers: checklist.providers ?? [],
    summary: checklist.summary ?? {},
    keys: Array.isArray(keys) ? keys : []
  };
}

async function omniRouteSecrets(dataRoot) {
  const path = join(dataRoot, "bees-secrets.json");
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (
      typeof value.JWT_SECRET !== "string" || value.JWT_SECRET.length < 32 ||
      !/^[a-f0-9]{64}$/i.test(value.API_KEY_SECRET) ||
      !/^[a-f0-9]{64}$/i.test(value.STORAGE_ENCRYPTION_KEY) ||
      typeof value.INITIAL_PASSWORD !== "string" || value.INITIAL_PASSWORD.length < 16
    ) throw new Error("invalid secret data");
    await chmod(path, 0o600);
    return value;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error("Embedded OmniRoute's private secret file is invalid");
    }
  }

  const value = {
    JWT_SECRET: randomBytes(48).toString("base64url"),
    API_KEY_SECRET: randomBytes(32).toString("hex"),
    STORAGE_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    INITIAL_PASSWORD: randomBytes(32).toString("base64url")
  };
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
  return value;
}

function bindPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, () => resolve(server));
  });
}

async function reserveOmniRoutePorts() {
  const reservations = [];
  try {
    for (const preferred of [20128, 20131, 20132]) {
      try {
        reservations.push(await bindPort(preferred));
      } catch (error) {
        if (error?.code !== "EADDRINUSE") throw error;
        reservations.push(await bindPort(0));
      }
    }
    return reservations.map((server) => server.address().port);
  } finally {
    await Promise.all(reservations.map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

function stopOmniRoute(runtime) {
  if (!runtime || runtime.child.exitCode !== null) return Promise.resolve();
  runtime.stopping = true;
  return new Promise((resolve) => {
    const force = setTimeout(() => runtime.child.kill("SIGKILL"), 5_000);
    force.unref?.();
    runtime.child.once("exit", () => {
      clearTimeout(force);
      resolve();
    });
    runtime.child.kill("SIGTERM");
  });
}

async function waitForOmniRoute(runtime) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (runtime.spawnError) throw runtime.spawnError;
    if (runtime.child.exitCode !== null) {
      throw new Error(`Embedded OmniRoute exited during startup (code ${runtime.child.exitCode})`);
    }
    try {
      const response = await fetch(`${runtime.baseUrl}/models`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(2_000)
      });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error("Embedded OmniRoute did not become ready within 60 seconds");
}

async function omniRouteLogin(runtime, force = false) {
  if (runtime.authCookie && !force) return runtime.authCookie;
  const response = await fetch(`${runtime.origin}/api/auth/login`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ password: runtime.password }),
    signal: AbortSignal.timeout(12_000)
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(upstreamError(value, `OmniRoute login returned HTTP ${response.status}`));
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error("OmniRoute login did not create a management session");
  runtime.browserCookie = cookie;
  runtime.authCookie = cookie.split(";", 1)[0];
  return runtime.authCookie;
}

async function omniRouteRequest(runtime, path) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${runtime.origin}${path}`, {
      headers: { accept: "application/json", cookie: await omniRouteLogin(runtime, attempt > 0) },
      signal: AbortSignal.timeout(30_000)
    });
    const value = await response.json().catch(() => ({}));
    if (response.status === 401 && attempt === 0) continue;
    if (!response.ok) throw new Error(upstreamError(value, `OmniRoute returned HTTP ${response.status}`));
    return value;
  }
  throw new Error("OmniRoute management login failed");
}

async function startOmniRoute(runtimeRoot, stateRoot, logger) {
  const root = join(runtimeRoot, "omniroute");
  const server = join(root, "server-ws.mjs");
  const dataRoot = join(stateRoot, "omniroute");
  await access(server);
  await mkdir(dataRoot, { recursive: true });
  const [port, embedWsPort, liveWsPort] = await reserveOmniRoutePorts();
  const origin = `http://127.0.0.1:${port}`;
  const secrets = await omniRouteSecrets(dataRoot);
  const childHost = fileURLToPath(new URL("./omniroute-child.mjs", import.meta.url));
  const child = spawn(process.execPath, [childHost, server], {
    cwd: root,
    env: {
      ...process.env,
      ...secrets,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      DASHBOARD_PORT: String(port),
      API_PORT: String(port),
      OMNIROUTE_PORT: String(port),
      OMNIROUTE_BASE_URL: origin,
      OMNIROUTE_PUBLIC_BASE_URL: origin,
      BASE_URL: origin,
      NEXT_PUBLIC_BASE_URL: origin,
      EMBED_WS_PROXY_PORT: String(embedWsPort),
      LIVE_WS_PORT: String(liveWsPort),
      LIVE_WS_ALLOWED_ORIGINS: origin,
      DATA_DIR: dataRoot,
      REQUIRE_API_KEY: "false",
      AUTH_COOKIE_SECURE: "false",
      PRICING_SYNC_ENABLED: "false",
      DISABLE_SQLITE_AUTO_BACKUP: "true",
      OMNIROUTE_SKIP_DB_HEALTHCHECK: "1"
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  const runtime = {
    child, origin, baseUrl: `${origin}/v1`, password: secrets.INITIAL_PASSWORD,
    ready: false, stopping: false, spawnError: undefined
  };
  child.stdout?.resume();
  child.stderr?.resume();
  child.once("error", (error) => { runtime.spawnError = error; });
  child.once("exit", (code, signal) => {
    if (runtime.ready && !runtime.stopping) logger.warn(`Embedded OmniRoute stopped (${signal ?? `code ${code}`})`);
  });
  try {
    await waitForOmniRoute(runtime);
    runtime.ready = true;
    return runtime;
  } catch (error) {
    await stopOmniRoute(runtime);
    throw error;
  }
}

function omniRouteState(runtime, startupError) {
  const running = Boolean(runtime?.ready && runtime.child.exitCode === null);
  return {
    embedded: true,
    running,
    ...(running ? { baseUrl: runtime.baseUrl } : {}),
    ...(running ? {} : { error: startupError?.message ?? "Embedded OmniRoute stopped; restart Bees to start it again" })
  };
}

async function omniRouteSnapshot(runtime, startupError) {
  const state = omniRouteState(runtime, startupError);
  if (!state.running) return state;
  try {
    const value = await omniRouteRequest(runtime, "/api/providers");
    const connections = Array.isArray(value.connections) ? value.connections : [];
    const catalogs = await Promise.all(connections.filter(({ isActive }) => isActive).map(async ({ id }) => {
      try { return await omniRouteRequest(runtime, `/api/providers/${encodeURIComponent(id)}/models`); }
      catch { return { models: [] }; }
    }));
    const seen = new Set();
    const models = [];
    for (const model of catalogs.flatMap((catalog) => Array.isArray(catalog.models) ? catalog.models : [])) {
      if (!model?.id || ["embeddings", "audio", "image", "images"].includes(model.apiFormat) || seen.has(model.id)) continue;
      seen.add(model.id);
      models.push({ id: model.id, name: model.name || model.id });
    }
    return {
      ...state,
      providers: connections.map(({ id, provider, name, isActive, testStatus }) => ({ id, provider, name, isActive, testStatus })),
      models
    };
  } catch (error) {
    return { ...state, providers: [], models: [], managementError: error instanceof Error ? error.message : String(error) };
  }
}

async function testOmniRoute(runtime, startupError) {
  if (!runtime?.ready || runtime.child.exitCode !== null) {
    throw startupError ?? new Error("Embedded OmniRoute is unavailable; restart Bees and try again");
  }
  let response;
  try {
    response = await fetch(`${runtime.baseUrl}/models`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000)
    });
  } catch {
    throw new Error("Embedded OmniRoute is not responding; restart Bees and try again");
  }
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Embedded OmniRoute returned HTTP ${response.status}`);
  return { ok: true, message: "Embedded OmniRoute is ready" };
}

function keyId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Choose a valid Free LLM provider row");
  return id;
}

async function hideBootstrapKey(work) {
  const write = process.stdout.write;
  process.stdout.write = function (chunk, ...args) {
    if (/Your unified API key:\s+freellmapi-/i.test(String(chunk))) return true;
    return write.call(this, chunk, ...args);
  };
  try { return await work(); }
  finally { process.stdout.write = write; }
}

async function runCommand(runtime, input) {
  if (input.action === "add") {
    const platform = String(input.platform ?? "");
    if (!/^[a-z0-9-]{1,40}$/.test(platform)) throw new Error("Choose a Free LLM provider");
    const added = await freeRequest(runtime, "/api/keys", {
      method: "POST",
      body: { platform, key: String(input.key ?? "").trim(), label: String(input.label ?? "").trim() }
    });
    const test = await freeRequest(runtime, `/api/health/check/${keyId(added.id)}`, { method: "POST" });
    return { ...(await snapshot(runtime)), test, notice: added.notice };
  }
  if (input.action === "test") {
    const test = await freeRequest(runtime, `/api/health/check/${keyId(input.id)}`, { method: "POST" });
    return { ...(await snapshot(runtime)), test };
  }
  if (input.action === "toggle") {
    await freeRequest(runtime, `/api/keys/${keyId(input.id)}`, {
      method: "PATCH", body: { enabled: Boolean(input.enabled) }
    });
    return snapshot(runtime);
  }
  if (input.action === "remove") {
    await freeRequest(runtime, `/api/keys/${keyId(input.id)}`, { method: "DELETE" });
    return snapshot(runtime);
  }
  throw new Error("Unknown Free LLM action");
}

export async function apply(ctx) {
  let runtime;
  let startupError;
  let omniRuntime;
  let omniStartupError;
  let omniStart;
  const omniManagerTokens = new Map();
  try {
    const runtimeRoot = process.env.BEES_RUNTIME_ROOT;
    const stateRoot = process.env.BEES_STATE_DIR;
    if (!runtimeRoot || !stateRoot) throw new Error("Bees did not provide the embedded runtime directories");
    const dataRoot = join(stateRoot, "freellmapi");
    const modulePath = join(runtimeRoot, "freellmapi", "server.mjs");
    await mkdir(dataRoot, { recursive: true });
    process.env.FREEAPI_ENV_PATH = join(dataRoot, ".env");
    process.env.FREEAPI_DB_DIR_HARDENING = "1";
    const { embedded, handle } = await hideBootstrapKey(async () => {
      const embedded = await import(pathToFileURL(modulePath).href);
      const handle = await embedded.startServer({
        dbPath: join(dataRoot, "freeapi.db"),
        clientDist: join(runtimeRoot, "freellmapi"),
        host: "127.0.0.1",
        preferredPort: 31415
      });
      return { embedded, handle };
    });
    runtime = {
      ...handle,
      origin: `http://127.0.0.1:${handle.port}`,
      sessionToken: embedded.ensureSessionToken()
    };
    ctx.effect(() => () => new Promise((resolve) => runtime.server.close(resolve)), "bees free AI: embedded server");
    await ctx.credentials.set(API_KEY_REF, embedded.getUnifiedApiKey());
  } catch (error) {
    startupError = error instanceof Error ? error : new Error(String(error));
    ctx.logger.warn(`Embedded FreeLLMAPI could not start: ${startupError.message}`);
  }

  const ensureOmniRoute = async () => {
    if (omniRuntime?.ready && omniRuntime.child.exitCode === null) return omniRuntime;
    if (omniStart) return omniStart;
    const runtimeRoot = process.env.BEES_RUNTIME_ROOT;
    const stateRoot = process.env.BEES_STATE_DIR;
    const starting = (async () => {
      try {
        if (!runtimeRoot || !stateRoot) throw new Error("Bees did not provide the embedded runtime directories");
        omniRuntime = await startOmniRoute(runtimeRoot, stateRoot, ctx.logger);
        omniStartupError = undefined;
        return omniRuntime;
      } catch (error) {
        omniStartupError = error instanceof Error ? error : new Error(String(error));
        ctx.logger.warn(`Embedded OmniRoute could not start: ${omniStartupError.message}`);
        throw omniStartupError;
      }
    })();
    omniStart = starting;
    try { return await starting; }
    finally { if (omniStart === starting) omniStart = undefined; }
  };
  ctx.effect(() => () => stopOmniRoute(omniRuntime), "bees free AI: embedded OmniRoute server");
  try { await ensureOmniRoute(); } catch {}

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/bees-api/free-ai/state",
    handler: async (req, res) => {
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
      try {
        if (!runtime) throw startupError ?? new Error("Embedded FreeLLMAPI is unavailable");
        json(res, 200, await snapshot(runtime));
      } catch (error) {
        json(res, 503, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }), "bees free AI: state route");

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/bees-api/free-ai/omniroute/state",
    handler: async (req, res) => {
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
      try { await ensureOmniRoute(); } catch {}
      json(res, 200, await omniRouteSnapshot(omniRuntime, omniStartupError));
    }
  }), "bees free AI: OmniRoute state route");

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/bees-api/free-ai/omniroute/manage-session",
    handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
      const token = randomBytes(32).toString("hex");
      const now = Date.now();
      for (const [value, expiresAt] of omniManagerTokens) if (expiresAt <= now) omniManagerTokens.delete(value);
      omniManagerTokens.set(token, now + 60_000);
      json(res, 200, { url: `http://127.0.0.1:${req.socket.localPort}/bees-omniroute-auth?token=${token}` });
    }
  }), "bees free AI: OmniRoute manager session route");

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/bees-omniroute-auth",
    handler: async (req, res) => {
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
      const token = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("token") ?? "";
      const expiresAt = omniManagerTokens.get(token);
      omniManagerTokens.delete(token);
      if (!expiresAt || expiresAt <= Date.now()) return json(res, 401, { error: "OmniRoute management link expired" });
      try {
        const current = await ensureOmniRoute();
        await omniRouteLogin(current);
        res.writeHead(302, {
          location: `${current.origin}/dashboard/providers`,
          "set-cookie": current.browserCookie,
          "cache-control": "no-store"
        });
        res.end();
      } catch (error) {
        json(res, 409, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }), "bees free AI: OmniRoute manager authentication route");

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/bees-api/free-ai/omniroute/test",
    handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
      try {
        await ensureOmniRoute();
        json(res, 200, await testOmniRoute(omniRuntime, omniStartupError));
      } catch (error) {
        json(res, 409, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }), "bees free AI: OmniRoute test route");

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/bees-api/free-ai/command",
    handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
      try {
        if (!runtime) throw startupError ?? new Error("Embedded FreeLLMAPI is unavailable");
        json(res, 200, await runCommand(runtime, await requestBody(req)));
      } catch (error) {
        json(res, 409, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }), "bees free AI: command route");
}
