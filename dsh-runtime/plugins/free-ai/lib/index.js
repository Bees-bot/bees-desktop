import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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
