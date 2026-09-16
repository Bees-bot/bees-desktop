import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";

export const LOCAL_MEMORY_URL = "http://127.0.0.1:8898";
const version = "0.10.0";

/** One device-local service; workspace banks and delivery queues remain separate. */
export class LocalMemory {
  constructor(settings, preferences, directory) {
    this.settings = settings;
    this.preferences = preferences;
    this.directory = directory;
    this.status = "Preparing local memory";
    this.stop = new AbortController();
    this.retryAt = 0;
  }

  models() {
    return Object.entries(this.settings.get("llm-pi-ai")?.providers ?? {}).flatMap(([provider, profile]) => {
      if (!(provider === "local-openai" || provider.startsWith("local-openai-") || provider === "external-local-ai")) return [];
      let url;
      try { url = new URL(profile.baseURL); } catch { return []; }
      // Names alone are not a trust boundary. Never forward memories to a hosted model.
      if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
          url.username || url.password || url.search || url.hash) return [];
      return (profile.models ?? []).map((model) => ({
        id: JSON.stringify([provider, model.id]), name: model.name || model.id,
        model: model.id, base: url.href.replace(/\/+$/, "")
      }));
    });
  }

  view() {
    return { managed: true, localStatus: this.status, model: this.preferences.get().memoryModel || "",
      models: this.models().map(({ id, name }) => ({ id, name })), activeModel: this.activeModel || "" };
  }

  async select(model) {
    if (typeof model !== "string" || (model && model !== this.preferences.get().memoryModel && !this.models().some(({ id }) => id === model)))
      throw new Error("Choose an available local model for memory");
    await this.preferences.update({ memoryModel: model });
    this.retryAt = 0;
  }

  async target() {
    const selected = this.preferences.get().memoryModel;
    const candidates = this.models().filter(({ id }) => !selected || id === selected);
    const available = new Map();
    for (const candidate of candidates) {
      try {
        if (!available.has(candidate.base)) {
          const result = await fetch(`${candidate.base}/models`, { redirect: "error",
            signal: AbortSignal.any([this.stop.signal, AbortSignal.timeout(2000)]) });
          available.set(candidate.base, result.ok ? (await result.json()).data ?? [] : []);
        }
        if (available.get(candidate.base).some(({ id }) => id === candidate.model)) {
          this.activeModel = candidate.name;
          return candidate;
        }
      } catch { available.set(candidate.base, []); }
    }
    this.activeModel = "";
    throw new Error(selected ? "Waiting for the selected local model. Start it in AI settings." : "Waiting for a local model. Memory will resume when your local AI is running.");
  }

  ensure() {
    if (this.stop.signal.aborted || this.pending || Date.now() < this.retryAt) return;
    this.pending = this.launch().catch(async (error) => {
      if (!this.stop.signal.aborted) {
        this.status = error.message;
        this.retryAt = Date.now() + 60000;
      }
      this.ready = false;
      await this.release();
    }).finally(() => { this.pending = undefined; });
  }

  environment() {
    // Do not inherit provider keys, Hindsight overrides or the Bees authentication token.
    const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "LANG"]
      .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    return { ...env, HOME: this.directory, USERPROFILE: this.directory,
      UV_TOOL_DIR: join(this.directory, `tools-${version}`), UV_TOOL_BIN_DIR: join(this.directory, `bin-${version}`),
      UV_PYTHON_INSTALL_DIR: join(this.directory, "python"), UV_CACHE_DIR: join(this.directory, "cache"),
      UV_PYTHON_PREFERENCE: "only-managed", UV_NO_CONFIG: "1", PYTHONUNBUFFERED: "1" };
  }

  spawn(command, args, env) {
    const child = spawn(command, args, { env, cwd: this.directory, windowsHide: true,
      detached: process.platform !== "win32", stdio: ["ignore", "ignore", "ignore"] });
    this.child = child;
    this.exit = new Promise((resolve) => {
      child.once("error", (error) => resolve({ error }));
      child.once("exit", (code) => resolve({ code }));
    });
    return child;
  }

  healthy() {
    return fetch(`${LOCAL_MEMORY_URL}/health`, { redirect: "error", signal: AbortSignal.any([this.stop.signal, AbortSignal.timeout(2000)]) })
      .then((response) => response.ok, () => false);
  }

  listeners() {
    return new Promise((resolve) => execFile("lsof", ["-t", "-i", "tcp:8898", "-sTCP:LISTEN"], (error, stdout) =>
      resolve(error ? [] : [...new Set(stdout.split("\n").map(Number).filter(Boolean))])));
  }

  // a server orphaned (parent 1) by an earlier launch still holds the port; retire it or ours can never bind
  async retire() {
    const [pid, ...more] = await this.listeners();
    if (!pid || more.length) return;
    const parent = await new Promise((resolve) => execFile("ps", ["-o", "ppid=", "-p", String(pid)], (error, stdout) => resolve(error ? "" : stdout.trim())));
    if (parent !== "1") return;
    const kill = (signal) => { try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* gone */ } } };
    kill("SIGTERM");
    for (let i = 0; i < 100 && (await this.listeners()).length; i++) await delay(200);
    kill("SIGKILL");
    for (let i = 0; i < 50 && (await this.listeners()).length; i++) await delay(100);
  }

  async launch() {
    if (this.ready) {
      await this.target();
      if (!(await this.healthy())) throw new Error("Local memory stopped; restarting automatically");
      return;
    }
    await mkdir(this.directory, { recursive: true });
    const env = this.environment();
    const suffix = process.platform === "win32" ? ".exe" : "";
    const executable = join(env.UV_TOOL_BIN_DIR, `hindsight-api${suffix}`);
    if (!existsSync(executable)) {
      this.status = "Installing local memory dependencies (first launch requires internet)";
      const uv = fileURLToPath(new URL(`../../memory-runtime/uv${suffix}`, import.meta.url));
      if (!existsSync(uv)) throw new Error("Local memory installer is missing. Rebuild or reinstall Bees.");
      this.spawn(uv, ["tool", "install", "--python", "3.12", "--with", "flashrank", `hindsight-api-slim[local-onnx,embedded-db]==${version}`], env);
      const result = await this.exit;
      this.child = undefined;
      if (result.error || result.code !== 0) throw new Error("Local memory installation failed; check internet access. Bees will retry automatically.");
    }
    this.stop.signal.throwIfAborted();
    await this.target();
    this.status = "Starting local Hindsight and its embedding model";
    const token = randomBytes(32).toString("hex");
    this.bridge = createServer((request, response) => { void this.forward(request, response, token); });
    await new Promise((resolve, reject) => {
      this.bridge.once("error", reject);
      this.bridge.listen(0, "127.0.0.1", resolve);
    });
    const llm = { PROVIDER: "openai", MODEL: "bees-active", API_KEY: token,
      BASE_URL: `http://127.0.0.1:${this.bridge.address().port}/v1` };
    for (const stage of ["", "RETAIN_", "REFLECT_", "CONSOLIDATION_"])
      for (const [key, value] of Object.entries(llm)) env[`HINDSIGHT_API_${stage}LLM_${key}`] = value;
    for (const [key, value] of Object.entries({ DATABASE_URL: "pg0://bees-desktop", WORKER_ID: "bees-desktop-memory",
      LLM_MAX_CONCURRENT: "1", LLM_TIMEOUT: "300", EMBEDDINGS_PROVIDER: "onnx",
      EMBEDDINGS_ONNX_MODEL_ID: "sentence-transformers/all-MiniLM-L6-v2",
      EMBEDDINGS_ONNX_QUERY_PREFIX: "", EMBEDDINGS_ONNX_PASSAGE_PREFIX: "", RERANKER_PROVIDER: "flashrank" }))
      env[`HINDSIGHT_API_${key}`] = value;
    await this.retire();
    this.spawn(executable, ["--host", "127.0.0.1", "--port", "8898"], env);
    let exited = false;
    void this.exit.then(() => { exited = true; this.ready = false; });
    for (let attempt = 0; attempt < 300; attempt++) {
      await delay(1000, undefined, { signal: this.stop.signal });
      if (exited) throw new Error("Local Hindsight could not start. Check available disk space and port 8898; Bees will retry.");
      // Dependencies and embeddings can take time on first launch, so an unreachable port is not fatal here.
      if (await this.healthy()) { this.ready = true; this.status = "Local Hindsight running"; return; }
    }
    throw new Error("Local memory startup timed out; Bees will retry automatically.");
  }

  async forward(request, response, token) {
    if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end(); return; }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") { response.writeHead(404).end(); return; }
    const controller = new AbortController();
    response.on("close", () => controller.abort());
    try {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { response.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { response.writeHead(400).end(); return; }
      if (!body || typeof body !== "object" || Array.isArray(body)) { response.writeHead(400).end(); return; }
      const target = await this.target();
      const upstream = await fetch(`${target.base}/chat/completions`, { method: "POST", redirect: "error",
        signal: AbortSignal.any([this.stop.signal, controller.signal, AbortSignal.timeout(300000)]),
        headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, model: target.model }) });
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json" });
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response); else response.end();
    } catch (error) {
      if (response.headersSent) response.destroy();
      else response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: error.message } }));
    }
  }

  async release() {
    this.bridge?.closeAllConnections();
    if (this.bridge?.listening) await new Promise((resolve) => this.bridge.close(resolve));
    this.bridge = undefined;
    if (this.child?.pid) {
      const child = this.child;
      const kill = (signal) => {
        try {
          if (process.platform === "win32") child.kill(signal);
          else process.kill(-child.pid, signal);
        } catch { /* The process may already have exited. */ }
      };
      kill("SIGTERM");
      const timer = setTimeout(() => kill("SIGKILL"), 10000);
      await this.exit;
      clearTimeout(timer);
    }
    this.child = undefined;
  }

  async close() {
    this.stop.abort();
    await this.release();
    await this.pending;
  }
}
