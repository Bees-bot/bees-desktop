import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { LlmAdapter, LlmError } from "@deepseek-ai/dsh-llm";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";

export const name = "bees-subscriptions";
export const inject = ["webServer", "credentials", "llm"];

const CODEX_OAUTH_REF = "BEES_CODEX_OAUTH";
const CODEX_ACCESS_REF = "BEES_CODEX_ACCESS_TOKEN";
const CLAUDE_PATH_REF = "BEES_CLAUDE_CODE_PATH";
const CLAUDE_ENABLED_REF = "BEES_CLAUDE_CODE_ENABLED";
const CLAUDE_MODELS_REF = "BEES_CLAUDE_CODE_MODELS";
const DEFAULT_CLAUDE_MODELS = ["default", "sonnet", "opus", "haiku"];
// Signing in to Codex used to leave it with no models at all, so it never reached the picker and
// the only way through was typing a model id by hand. pi-ai already ships the catalog.
const DEFAULT_CODEX_MODELS = Object.values(OPENAI_CODEX_MODELS)
  .map(({ id, name, contextWindow, maxTokens }) => ({ id, name, contextWindow, maxTokens }));
const CLAUDE_REASONING = { efforts: ["low", "medium", "high", "xhigh", "max"].map((id) => ({
  id, name: `${id[0].toUpperCase()}${id.slice(1)}`
})) };
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const OUTPUT_LIMIT = 2 * 1024 * 1024;
const REQUIRED_TOOL_NAMES = new Set(["bees_propose_changes", "bees_submit_stage_result"]);

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

export function normalizeClaudeModels(value) {
  if (!Array.isArray(value) || !value.length) throw new Error("Choose at least one Claude Code model");
  if (value.some((model) => typeof model !== "string")) throw new Error("Claude Code model IDs must be strings");
  const models = [...new Set(value.map((model) => String(model).trim()))];
  if (models.some((model) => !model || model.length > 200)) throw new Error("Claude Code model IDs must be 1–200 characters");
  if (models.length > 50) throw new Error("Claude Code supports up to 50 configured models");
  return models;
}

async function configuredClaudeModels(ctx) {
  const value = (await ctx.credentials.resolve(CLAUDE_MODELS_REF))?.value;
  if (!value) return DEFAULT_CLAUDE_MODELS;
  try { return normalizeClaudeModels(JSON.parse(value)); }
  catch { return DEFAULT_CLAUDE_MODELS; }
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
    if (block?.type === "tool-call") return `DSH tool call ${block.name}: ${block.arguments}`;
    if (block?.type === "tool-result") return block.content?.map((part) => part.text ?? "").join("\n") ?? "";
    return "";
  }).filter(Boolean).join("\n");
}

export function claudeProtocolMode(options) {
  if (!(options.tools ?? []).some((tool) => REQUIRED_TOOL_NAMES.has(tool.name))) return "either";
  const requiredCalls = new Set();
  for (const message of options.messages ?? []) for (const block of message.content ?? []) {
    if (block?.type === "tool-call" && REQUIRED_TOOL_NAMES.has(block.name))
      requiredCalls.add(String(block.id));
    if (block?.type === "tool-result" && !block.isError && requiredCalls.has(String(block.toolCallId)))
      return "finish";
  }
  return "tool";
}

export function claudeResponseSchema(tools, mode = "either") {
  const names = [...new Set(tools.map((tool) => String(tool.name)).filter(Boolean))];
  return {
    type: "object",
    properties: {
      tool: { type: "string", enum: mode === "tool" ? names : mode === "finish" ? [""] : ["", ...names] },
      arguments: { type: "object" },
      text: { type: "string" }
    },
    required: ["tool", "arguments", "text"],
    additionalProperties: false
  };
}

function claudePrompt(options, mode) {
  const rows = [];
  if (options.system) rows.push(`System:\n${options.system}`);
  for (const message of options.messages ?? []) {
    const text = messageText(message.content);
    if (text) rows.push(`${message.role === "assistant" ? "Assistant" : "User"}:\n${text}`);
  }
  const tools = options.tools ?? [];
  if (tools.length) rows.push([
    "DSH tool protocol:",
    mode === "tool"
      ? "Choose exactly one DSH tool. A text-only response is not allowed; use the required completion tool when finished."
      : mode === "finish"
        ? "The required completion tool succeeded. Do not call another tool; return a concise final answer with an empty tool name."
        : "Choose one DSH tool, or answer with an empty tool name and put the answer in text.",
    "These are virtual DSH tools, not Claude Code native tools. Select one only through this structured JSON response; never try to invoke its name directly.",
    "For a tool call, set text to an empty string and provide its JSON arguments.",
    `Available DSH tools:\n${JSON.stringify(tools)}`
  ].join("\n"));
  return rows.join("\n\n");
}

function safeEnvironment() {
  const secret = /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)(?:_|$)/i;
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
    value !== undefined && !key.startsWith("BEES_") && !secret.test(key) &&
    !["NODE_OPTIONS", "BASH_ENV", "ENV"].includes(key)));
}

function structuredOutput(parsed) {
  if (parsed.structured_output && typeof parsed.structured_output === "object")
    return parsed.structured_output;
  try {
    const value = JSON.parse(parsed.result);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function runClaude(command, model, effort, prompt, signal, schema) {
  const args = [
    "--print", "--output-format", "stream-json", "--verbose", "--safe-mode", "--no-session-persistence",
    "--setting-sources", "", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}",
    "--tools", "", "--permission-mode", "dontAsk",
    ...(schema ? ["--json-schema", JSON.stringify(schema)] : []),
    ...(model && model !== "default" ? ["--model", model] : []),
    ...(effort ? ["--effort", effort] : [])
  ];
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LlmError("Claude Code was cancelled", "ABORTED"));
    const child = spawn(command, args, {
      cwd: process.env.BEES_DEFAULT_WORKSPACE,
      env: safeEnvironment(),
      stdio: ["pipe", "pipe", "pipe"]
    });
    const decoder = new StringDecoder("utf8");
    let pending = "", bytes = 0, early = null, final = null;
    let stderr = "";
    let overflow = false;
    let timedOut = false;
    // the cli keeps its loop going after a structured answer, so the first one is the answer
    const consume = (line) => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === "result") final = event;
      const block = event.type === "assistant" && event.message?.content?.find?.((part) => part.type === "tool_use" && part.name === "StructuredOutput" && typeof part.input?.tool === "string");
      if (block && !early) { early = { structured: block.input, usage: event.message.usage ?? {} }; stop(); }
    };
    const stop = () => child.kill("SIGKILL");
    const timer = setTimeout(() => { timedOut = true; stop(); }, 15 * 60 * 1000);
    const abort = () => stop();
    signal?.addEventListener("abort", abort, { once: true });
    // "close" may never arrive after "error", so the timer and listener are cleared on both.
    const settled = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    child.stdout.on("data", (chunk) => {
      if ((bytes += chunk.byteLength) > OUTPUT_LIMIT) { overflow = true; return stop(); }
      const lines = (pending + decoder.write(chunk)).split("\n");
      pending = lines.pop();
      lines.forEach(consume);
    });
    child.stderr.on("data", (chunk) => { if ((bytes += chunk.byteLength) > OUTPUT_LIMIT) { overflow = true; stop(); } else stderr += chunk.toString(); });
    child.on("error", (error) => { settled(); reject(error); });
    child.on("close", (code) => {
      settled();
      consume(pending + decoder.end());
      if (early) return resolve({ text: String(early.structured.text ?? ""), structured: early.structured, usage: early.usage });
      if (signal?.aborted) return reject(new LlmError("Claude Code was cancelled", "ABORTED"));
      if (overflow) return reject(new LlmError("Claude Code returned too much output", "OUTPUT_LIMIT"));
      if (timedOut) return reject(new LlmError("Claude Code timed out after 15 minutes", "TIMEOUT"));
      try {
        if (!final) throw new Error(stderr.trim() || `Claude Code exited with code ${code} without JSON output`);
        const structured = schema ? structuredOutput(final) : null;
        if (code !== 0 || final.is_error || (schema ? !structured : !String(final.result ?? "").trim())) {
          throw new Error(final.result || stderr.trim() || `Claude Code exited with code ${code}`);
        }
        resolve({ text: String(final.result ?? ""), structured, usage: final.usage ?? {} });
      } catch (error) {
        reject(error instanceof LlmError ? error : new LlmError(error.message, "CLAUDE_CODE"));
      }
    });
    child.stdin.end(prompt);
  });
}

export function claudeChunks(result, tools) {
  const usage = { type: "usage", usage: {
    inputTokens: Number(result.usage.input_tokens ?? 0),
    outputTokens: Number(result.usage.output_tokens ?? 0),
    ...result.usage.cache_read_input_tokens > 0 ? { cacheReadTokens: Number(result.usage.cache_read_input_tokens) } : {},
    ...result.usage.cache_creation_input_tokens > 0 ? { cacheWriteTokens: Number(result.usage.cache_creation_input_tokens) } : {}
  } };
  if (result.structured?.tool) {
    const name = String(result.structured.tool);
    if (!tools.some((tool) => tool.name === name))
      throw new LlmError(`Claude Code selected unknown DSH tool ${name}`, "CLAUDE_CODE");
    const args = result.structured.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new LlmError("Claude Code returned invalid DSH tool arguments", "CLAUDE_CODE");
    const id = randomUUID();
    const argumentsText = JSON.stringify(args);
    return [
      { type: "block-start", index: 0, blockType: "tool-call" },
      { type: "tool-call-delta", index: 0, id, name, argumentsDelta: argumentsText },
      { type: "block-end", index: 0, block: { type: "tool-call", id, name, arguments: argumentsText } },
      usage,
      { type: "finish", reason: { kind: "tool-calls" } }
    ];
  }
  const text = String(result.structured?.text ?? result.text ?? "").trim();
  if (!text) throw new LlmError("Claude Code returned an empty response", "CLAUDE_CODE");
  return [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text },
    { type: "block-end", index: 0, block: { type: "text", text } },
    usage,
    { type: "finish", reason: { kind: "stop" } }
  ];
}

class ClaudeCodeAdapter extends LlmAdapter {
  constructor(ctx) { super(); this.ctx = ctx; }
  providerInfo() { return { id: "claude-code", name: "Claude Code subscription" }; }
  async listModels() {
    return (await configuredClaudeModels(this.ctx)).map((id) => ({
      provider: "claude-code", id, name: id === "default" ? "Claude Code (default)" : `Claude ${id}`,
      inputModalities: ["text"]
    }));
  }
  resolveModel(provider, model) {
    return Promise.resolve({ provider, id: model, name: model === "default" ? "Claude Code (default)" : `Claude ${model}`,
      inputModalities: ["text"], context: { contextWindow: 200_000 }, reasoning: CLAUDE_REASONING });
  }
  async *stream(options) {
    const command = (await this.ctx.credentials.resolve(CLAUDE_PATH_REF))?.value;
    if (!command) throw new LlmError("Choose Claude Code under Settings → AI", "MISSING_CREDENTIAL");
    const tools = options.tools ?? [];
    const mode = claudeProtocolMode(options);
    const schema = tools.length ? claudeResponseSchema(tools, mode) : undefined;
    const result = await runClaude(
      command, options.model, options.reasoningEffort, claudePrompt(options, mode), options.signal, schema
    );
    for (const chunk of claudeChunks(result, tools)) yield chunk;
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
  const updateClaude = async (reset = false) => {
    const enabled = Boolean((await ctx.credentials.resolve(CLAUDE_ENABLED_REF))?.value);
    const path = (await ctx.credentials.resolve(CLAUDE_PATH_REF))?.value;
    if (reset && claudeRegistration) { claudeRegistration(); claudeRegistration = null; }
    if (enabled && path && !claudeRegistration) claudeRegistration = ctx.llm.registerAdapter(["claude-code"], adapter);
    if ((!enabled || !path) && claudeRegistration) { claudeRegistration(); claudeRegistration = null; }
  };
  const syncClaude = (reset = false) => { claudeSync = claudeSync.then(() => updateClaude(reset), () => updateClaude(reset)); return claudeSync; };
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
        const models = await configuredClaudeModels(ctx);
        let version = "";
        if (path) version = await claudeVersion(path).catch(() => "Unavailable");
        return json(res, 200, { codex, codexModels: DEFAULT_CODEX_MODELS,
          claude: { configured: Boolean(path), enabled, path, version, models } });
      }
      if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
      const input = await requestBody(req);
      if (input.action === "codex_start") {
        if (!pending) {
          const started = beginCodexLogin();
          // An abandoned sign-in must not park a dead url here until the app restarts.
          void started.result.catch(() => {}).finally(() => { if (pending === started) pending = null; });
          pending = started;
        }
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
      if (input.action === "codex_test") {
        if (!await ensureCodex()) throw new Error("Sign in to Codex first");
        return json(res, 200, { ok: true });
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
      if (input.action === "claude_models") {
        const models = normalizeClaudeModels(input.models);
        await ctx.credentials.set(CLAUDE_MODELS_REF, JSON.stringify(models));
        await syncClaude(true);
        return json(res, 200, { models });
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
