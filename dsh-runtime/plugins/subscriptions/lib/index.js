import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import { LlmAdapter, LlmError } from "@deepseek-ai/dsh-llm";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

export const name = "bees-subscriptions";
export const inject = ["webServer", "credentials", "llm"];

const CODEX_OAUTH_REF = "BEES_CODEX_OAUTH";
const CODEX_ACCESS_REF = "BEES_CODEX_ACCESS_TOKEN";
const CLAUDE_PATH_REF = "BEES_CLAUDE_CODE_PATH";
const CLAUDE_ENABLED_REF = "BEES_CLAUDE_CODE_ENABLED";
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const OUTPUT_LIMIT = 2 * 1024 * 1024;

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
    if (value.length > 20_000) throw new Error("Request body is too large");
  }
  return value ? JSON.parse(value) : {};
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function beginCodexLogin() {
  const oauth = openaiCodexProvider().auth.oauth;
  if (!oauth) throw new Error("This Bees runtime has no Codex sign-in provider");
  const ready = deferred();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error("Codex sign-in timed out")), LOGIN_TIMEOUT_MS);
  const result = oauth.login({
    signal: abort.signal,
    prompt: async (prompt) => {
      if (prompt.type === "select") return "browser";
      if (prompt.type === "manual_code") return new Promise(() => {});
      throw new Error(`Unexpected Codex sign-in prompt: ${prompt.type}`);
    },
    notify: (event) => {
      if (event.type === "auth_url") ready.resolve({ authUrl: event.url });
    }
  }).finally(() => clearTimeout(timer));
  void result.catch(ready.reject);
  return { ready: ready.promise, result, abort };
}

function credential(value) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed?.type === "oauth" && parsed.access && parsed.refresh && parsed.expires ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function refreshCodex(ctx) {
  const stored = credential((await ctx.credentials.resolve(CODEX_OAUTH_REF))?.value);
  if (!stored) return false;
  const oauth = openaiCodexProvider().auth.oauth;
  if (!oauth) return false;
  let current = stored;
  if (stored.expires <= Date.now() + 60_000) {
    current = await oauth.refresh(stored);
    await ctx.credentials.set(CODEX_OAUTH_REF, JSON.stringify(current));
  }
  if ((await ctx.credentials.resolve(CODEX_ACCESS_REF))?.value !== current.access) {
    await ctx.credentials.set(CODEX_ACCESS_REF, current.access);
  }
  return true;
}

function messageText(content) {
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    if (block?.type === "text" || block?.type === "reasoning") return block.text ?? "";
    if (block?.type === "tool-result") return block.content?.map((part) => part.text ?? "").join("\n") ?? "";
    return "";
  }).filter(Boolean).join("\n");
}

function claudePrompt(options) {
  const rows = [];
  if (options.system) rows.push(`System:\n${options.system}`);
  for (const message of options.messages ?? []) {
    const text = messageText(message.content);
    if (text) rows.push(`${message.role === "assistant" ? "Assistant" : "User"}:\n${text}`);
  }
  return rows.join("\n\n");
}

function safeEnvironment() {
  const secret = /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)(?:_|$)/i;
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
    value !== undefined && !key.startsWith("BEES_") && !secret.test(key) &&
    !["NODE_OPTIONS", "BASH_ENV", "ENV"].includes(key)));
}

function runClaude(command, model, effort, prompt, signal) {
  const args = [
    "--print", "--output-format", "json", "--safe-mode", "--no-session-persistence",
    "--setting-sources", "", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}",
    "--tools", "", "--permission-mode", "dontAsk",
    ...(model && model !== "default" ? ["--model", model] : []),
    ...(effort ? ["--effort", effort] : [])
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.env.BEES_DEFAULT_WORKSPACE,
      env: safeEnvironment(),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let overflow = false;
    const append = (current, chunk) => {
      const left = OUTPUT_LIMIT - Buffer.byteLength(current);
      if (left <= 0) { overflow = true; return current; }
      if (chunk.byteLength > left) overflow = true;
      return current + chunk.subarray(0, Math.max(0, left)).toString();
    };
    const stop = () => child.kill("SIGKILL");
    const timer = setTimeout(stop, 15 * 60 * 1000);
    const abort = () => stop();
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); if (overflow) stop(); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); if (overflow) stop(); });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(new LlmError("Claude Code was cancelled", "ABORTED"));
      if (overflow) return reject(new LlmError("Claude Code returned too much output", "OUTPUT_LIMIT"));
      try {
        const parsed = JSON.parse(stdout);
        if (code !== 0 || parsed.is_error || !String(parsed.result ?? "").trim()) {
          throw new Error(parsed.result || stderr.trim() || `Claude Code exited with code ${code}`);
        }
        resolve({ text: String(parsed.result), usage: parsed.usage ?? {} });
      } catch (error) {
        reject(error instanceof LlmError ? error : new LlmError(error.message, "CLAUDE_CODE"));
      }
    });
    child.stdin.end(prompt);
  });
}

class ClaudeCodeAdapter extends LlmAdapter {
  constructor(ctx) { super(); this.ctx = ctx; }
  providerInfo() { return { id: "claude-code", name: "Claude Code subscription" }; }
  listModels() {
    return Promise.resolve([
      { provider: "claude-code", id: "default", name: "Claude Code (default)", inputModalities: ["text"] },
      { provider: "claude-code", id: "sonnet", name: "Claude Sonnet", inputModalities: ["text"] },
      { provider: "claude-code", id: "opus", name: "Claude Opus", inputModalities: ["text"] },
      { provider: "claude-code", id: "haiku", name: "Claude Haiku", inputModalities: ["text"] }
    ]);
  }
  resolveModel(provider, model) {
    return Promise.resolve({ provider, id: model, name: model === "default" ? "Claude Code (default)" : `Claude ${model}`,
      inputModalities: ["text"], context: { contextWindow: 200_000 } });
  }
  async *stream(options) {
    const command = (await this.ctx.credentials.resolve(CLAUDE_PATH_REF))?.value;
    if (!command) throw new LlmError("Choose Claude Code under Settings → AI", "MISSING_CREDENTIAL");
    const result = await runClaude(command, options.model, options.reasoningEffort, claudePrompt(options), options.signal);
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text: result.text };
    yield { type: "block-end", index: 0, block: { type: "text", text: result.text } };
    yield { type: "usage", usage: {
      inputTokens: Number(result.usage.input_tokens ?? 0), outputTokens: Number(result.usage.output_tokens ?? 0)
    } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

async function executable(path) {
  try { await access(path, constants.X_OK); return true; } catch { return false; }
}

async function claudeVersion(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(path, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error("That file is not a working Claude Code program"));
      else resolve(output.trim().split("\n")[0] || "Claude Code");
    });
  });
}

async function findClaude(ctx) {
  const configured = (await ctx.credentials.resolve(CLAUDE_PATH_REF))?.value;
  const candidates = [
    configured,
    process.env.BEES_CLAUDE_CLI,
    ...String(process.env.PATH ?? "").split(delimiter).map((path) => join(path, "claude")),
    join(homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude"
  ].filter(Boolean);
  for (const path of [...new Set(candidates)]) if (await executable(path)) return path;
  return "";
}

export async function apply(ctx) {
  let pending = null;
  let claudeRegistration = null;
  let refreshingCodex = null;
  let claudeSync = Promise.resolve();
  const adapter = new ClaudeCodeAdapter(ctx);
  const ensureCodex = () => {
    refreshingCodex ??= refreshCodex(ctx).finally(() => { refreshingCodex = null; });
    return refreshingCodex;
  };
  const updateClaude = async () => {
    const enabled = Boolean((await ctx.credentials.resolve(CLAUDE_ENABLED_REF))?.value);
    const path = (await ctx.credentials.resolve(CLAUDE_PATH_REF))?.value;
    if (enabled && path && !claudeRegistration) claudeRegistration = ctx.llm.registerAdapter(["claude-code"], adapter);
    if ((!enabled || !path) && claudeRegistration) { claudeRegistration(); claudeRegistration = null; }
  };
  const syncClaude = () => { claudeSync = claudeSync.then(updateClaude, updateClaude); return claudeSync; };
  await ensureCodex().catch((error) => ctx.logger.warn(`Codex token refresh failed: ${error.message}`));
  await syncClaude();
  ctx.on("credentials/updated", (ref) => {
    if (ref === CLAUDE_PATH_REF || ref === CLAUDE_ENABLED_REF) void syncClaude();
  });
  const refreshTimer = setInterval(() => {
    void ensureCodex().catch((error) => ctx.logger.warn(`Codex token refresh failed: ${error.message}`));
  }, 60_000);
  refreshTimer.unref();
  ctx.effect(() => () => clearInterval(refreshTimer), "bees subscriptions: Codex refresh");
  ctx.effect(() => () => claudeRegistration?.(), "bees subscriptions: Claude adapter");
  ctx.effect(() => ctx.webServer.register({ kind: "exact", path: "/bees-api/subscriptions", handler: async (req, res) => {
    try {
      if (req.method === "GET") {
        const codex = await ensureCodex().catch(() => false);
        const path = (await ctx.credentials.resolve(CLAUDE_PATH_REF))?.value ?? "";
        const enabled = Boolean((await ctx.credentials.resolve(CLAUDE_ENABLED_REF))?.value);
        let version = "";
        if (path) version = await claudeVersion(path).catch(() => "Unavailable");
        return json(res, 200, { codex, claude: { configured: Boolean(path), enabled, path, version } });
      }
      if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
      const input = await requestBody(req);
      if (input.action === "codex_start") {
        pending ??= beginCodexLogin();
        return json(res, 200, await pending.ready);
      }
      if (input.action === "codex_await") {
        if (!pending) throw new Error("No Codex sign-in is in progress");
        const current = pending;
        try {
          const value = await current.result;
          await ctx.credentials.set(CODEX_OAUTH_REF, JSON.stringify(value));
          await ctx.credentials.set(CODEX_ACCESS_REF, value.access);
          return json(res, 200, { connected: true });
        } finally {
          current.abort.abort();
          if (pending === current) pending = null;
        }
      }
      if (input.action === "codex_logout") {
        await ctx.credentials.unset(CODEX_OAUTH_REF);
        await ctx.credentials.unset(CODEX_ACCESS_REF);
        return json(res, 200, { connected: false });
      }
      if (input.action === "claude_configure") {
        const path = String(input.path ?? "").trim() || await findClaude(ctx);
        if (!path) throw new Error("Claude Code was not found. Install it, then click Connect again.");
        const version = await claudeVersion(path);
        await ctx.credentials.set(CLAUDE_PATH_REF, path);
        await ctx.credentials.set(CLAUDE_ENABLED_REF, "1");
        await syncClaude();
        return json(res, 200, { configured: true, enabled: true, path, version });
      }
      if (input.action === "claude_test") {
        const path = (await ctx.credentials.resolve(CLAUDE_PATH_REF))?.value;
        if (!path) throw new Error("Connect Claude Code first");
        return json(res, 200, { ok: true, version: await claudeVersion(path) });
      }
      if (input.action === "claude_toggle") {
        if (input.enabled) {
          if (!(await ctx.credentials.resolve(CLAUDE_PATH_REF))?.value) throw new Error("Choose Claude Code first");
          await ctx.credentials.set(CLAUDE_ENABLED_REF, "1");
        } else await ctx.credentials.unset(CLAUDE_ENABLED_REF);
        await syncClaude();
        return json(res, 200, { enabled: Boolean(input.enabled) });
      }
      if (input.action === "claude_disconnect") {
        await ctx.credentials.unset(CLAUDE_ENABLED_REF);
        await ctx.credentials.unset(CLAUDE_PATH_REF);
        await syncClaude();
        return json(res, 200, { configured: false, enabled: false });
      }
      throw new Error("Unknown subscription action");
    } catch (error) {
      json(res, 409, { error: error instanceof Error ? error.message : String(error) });
    }
  } }), "bees subscriptions route");
}
