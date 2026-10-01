import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { isDeepStrictEqual } from "node:util";
import { LlmAdapter, LlmError, QUOTA_EXCEEDED_CODE } from "@deepseek-ai/dsh-llm";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import z from "@deepseek-ai/schemastery";

export const name = "bees-subscriptions";
export const inject = ["webServer", "credentials", "llm", "settings"];

const CODEX_OAUTH_REF = "BEES_CODEX_OAUTH";
const CODEX_ACCESS_REF = "BEES_CODEX_ACCESS_TOKEN";
const CLAUDE_PATH_REF = "BEES_CLAUDE_CODE_PATH";
const CLAUDE_ENABLED_REF = "BEES_CLAUDE_CODE_ENABLED";
const CLAUDE_MODELS_REF = "BEES_CLAUDE_CODE_MODELS";
const DEFAULT_CLAUDE_MODELS = ["default", "sonnet", "opus", "haiku"];
export const Config = z.object({
  models: z.array(z.string()).default(DEFAULT_CLAUDE_MODELS).volatile(),
  codexExcludedModels: z.array(z.string()).default([]).volatile()
});
// The bundled catalog is only a fallback; the signed-in account discovers new models at runtime.
const DEFAULT_CODEX_MODELS = Object.values(OPENAI_CODEX_MODELS)
  .map(({ id, name, contextWindow, maxTokens }) => ({ id, name, contextWindow, maxTokens }));
const CODEX_MODEL_REFRESH_MS = 15 * 60_000;
const CODEX_MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/;
// These are the effort levels supported by the installed pi-ai transport (Ultra needs Codex's agent harness).
const CODEX_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);

export async function fetchCodexModels(stored) {
  // Codex's catalog protocol version, independent of Bees' version or an installed Codex CLI.
  const response = await fetch("https://chatgpt.com/backend-api/codex/models?client_version=0.155.0", {
    headers: { authorization: `Bearer ${stored.access}`, "chatgpt-account-id": stored.accountId, originator: "pi" },
    signal: AbortSignal.timeout(10_000), redirect: "error"
  });
  if (!response.ok) throw new Error(`Codex model discovery returned HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body?.models)) throw new Error("Codex returned an invalid model catalog");
  const models = new Map();
  for (const model of body.models) {
    if (model?.visibility !== "list" || typeof model.slug !== "string" || !CODEX_MODEL_ID.test(model.slug)) continue;
    const efforts = Object.fromEntries((Array.isArray(model.supported_reasoning_levels) ? model.supported_reasoning_levels : [])
      .filter((level) => CODEX_EFFORTS.has(level?.effort)).map(({ effort }) => [effort, effort]));
    const input = Array.isArray(model.input_modalities) ? model.input_modalities.filter((value) => ["text", "image"].includes(value)) : [];
    models.set(model.slug, {
      id: model.slug,
      name: typeof model.display_name === "string" && model.display_name.trim() ? model.display_name : model.slug,
      ...(Number.isSafeInteger(model.context_window) && model.context_window > 0 ? { contextWindow: model.context_window } : {}),
      ...(input.length ? { input } : {}),
      ...(Object.keys(efforts).length ? { reasoningEfforts: efforts } : {})
    });
  }
  if (!models.size) throw new Error("Codex returned no visible models; keeping the saved catalog");
  return [...models.values()];
}

function mergeCodexModels(saved, discovered, excluded) {
  const models = new Map(saved.map((model) => [model.id, model]));
  for (const model of discovered) models.set(model.id, { ...models.get(model.id), ...model });
  return [...models.values()].filter(({ id }) => !excluded.includes(id));
}

async function syncCodexModels(ctx, discovered, excluded) {
  const settings = ctx.settings.describe().find(({ ns }) => ns === "llm-pi-ai");
  const profile = settings?.value?.providers?.["openai-codex"];
  // A refresh must never enable a disabled connection or change a separately configured provider.
  if (profile?.apiKeyEnv !== CODEX_ACCESS_REF) return;
  const models = mergeCodexModels(profile.models ?? DEFAULT_CODEX_MODELS, discovered, excluded);
  if (!isDeepStrictEqual(models, profile.models)) await ctx.settings.mutate(settings.ns, [
    { op: "set", path: ["providers", "openai-codex", "models"], value: models }
  ], settings.revision);
}
const CLAUDE_REASONING = { efforts: ["low", "medium", "high", "xhigh", "max"].map((id) => ({
  id, name: `${id[0].toUpperCase()}${id.slice(1)}`
})) };
const claudeModel = (id) => ({ provider: "claude-code", id, name: id === "default" ? "Claude Code (default)" : `Claude ${id}`,
  inputModalities: ["text"], context: { contextWindow: 200_000 }, reasoning: CLAUDE_REASONING });
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
      // must fail on timeout, or the login waits here forever and blocks every retry
      if (prompt.type === "manual_code") return abort.signal.aborted ? Promise.reject(abort.signal.reason)
        : new Promise((_, fail) => abort.signal.addEventListener("abort", () => fail(abort.signal.reason), { once: true }));
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

async function configuredClaudeModels(ctx, defaults = DEFAULT_CLAUDE_MODELS) {
  const value = (await ctx.credentials.resolve(CLAUDE_MODELS_REF))?.value;
  if (!value) return defaults;
  try { return normalizeClaudeModels(JSON.parse(value)); }
  catch { return defaults; }
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
    return "";
  }).filter(Boolean).join("\n");
}

export function claudeProtocolMode(options) {
  if (!(options.tools ?? []).some((tool) => REQUIRED_TOOL_NAMES.has(tool.name))) return "either";
  const requiredCalls = new Set();
  let mode = "tool";
  for (const message of options.messages ?? []) {
    if (message.role === "tool" && !message.isError && requiredCalls.has(String(message.toolCallId))) mode = "finish";
    // a follow-up sent after the result reopens the run, injected context does not
    else if (mode === "finish" && message.source?.kind === "user") mode = "either";
    for (const block of message.content ?? [])
      if (block?.type === "tool-call" && REQUIRED_TOOL_NAMES.has(block.name)) requiredCalls.add(String(block.id));
  }
  return mode;
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

// argv tops out near 1 MB on macOS, so a huge system prompt rides in the message instead
const claudeSystemInArgv = (system) => Boolean(system) && Buffer.byteLength(system) < 256_000;

// the mode line rides in the system prompt, so the cli's own marker lands on the last transcript row and the next turn reads it from cache
const claudeModeLine = (tools, mode) => !tools.length ? "" : mode === "tool"
  ? "Choose exactly one DSH tool. A text-only response is not allowed; use the required completion tool when finished."
  : mode === "finish"
    ? "The required completion tool succeeded. Do not call another tool; return a concise final answer with an empty tool name."
    : "Choose one DSH tool, or answer with an empty tool name and put the answer in text.";

// one block per row
function claudeInput(options) {
  const rows = [];
  if (!claudeSystemInArgv(options.system) && options.system) rows.push(`System:\n${options.system}`);
  const tools = options.tools ?? [];
  // tools go before the transcript because they rarely change
  if (tools.length) rows.push([
    "DSH tool protocol:",
    "These are virtual DSH tools, not Claude Code native tools. Select one only through this structured JSON response; never try to invoke its name directly.",
    "For a tool call, set text to an empty string and provide its JSON arguments.",
    `Available DSH tools:\n${JSON.stringify(tools)}`
  ].join("\n"));
  for (const message of options.messages ?? []) {
    const text = messageText(message.content);
    const label = { assistant: "Assistant", tool: "DSH tool result", system: "System", developer: "System" }[message.role] ?? "User";
    if (text) rows.push(`${label}:\n${text}`);
  }
  if (!rows.length) rows.push("User:\nContinue.");
  // no marker of our own: the cli already sets up to 4, and one more after a tool round is a 400 that kills the run
  const content = rows.map((text) => ({ type: "text", text }));
  return `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`;
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

// a dsh tool called by its own name often gets the StructuredOutput shape instead of its own arguments
function directArguments(input) {
  if (typeof input !== "object" || !input || !("arguments" in input) || Object.keys(input).some((key) => !["tool", "arguments", "text"].includes(key))) return input ?? {};
  let inner = input.arguments;
  if (typeof inner === "string") try { inner = JSON.parse(inner); } catch { return input; }
  return inner && typeof inner === "object" && !Array.isArray(inner) ? inner : input;
}

function runClaude(command, model, effort, input, signal, schema, system) {
  const args = [
    "--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--safe-mode", "--no-session-persistence",
    "--setting-sources", "", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}",
    "--tools", "", "--permission-mode", "dontAsk",
    ...(claudeSystemInArgv(system) ? ["--system-prompt", system] : []),
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
      const block = event.type === "assistant" && event.message?.content?.find?.((part) => part.type === "tool_use");
      // a dsh tool called by its own name gets "No such tool available" from the cli, and the model then reports every tool as down
      const structured = block?.name === "StructuredOutput" ? typeof block.input?.tool === "string" && block.input
        : block && schema?.properties.tool.enum.some(Boolean) && { tool: block.name, arguments: directArguments(block.input), text: "" };
      if (structured && !early) { early = { structured, usage: event.message.usage ?? {} }; stop(); }
    };
    const stop = () => child.kill("SIGKILL");
    const timer = setTimeout(() => { timedOut = true; stop(); }, 15 * 60 * 1000);
    const abort = () => stop();
    signal?.addEventListener("abort", abort, { once: true });
    // "close" may never arrive after "error", so the timer and listener are cleared on both.
    const settled = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    child.stdout.on("data", (chunk) => {
      const lines = (pending + decoder.write(chunk)).split("\n");
      pending = lines.pop();
      lines.forEach(consume);
      if (!early && (bytes += chunk.byteLength) > OUTPUT_LIMIT) { overflow = true; stop(); }
    });
    child.stderr.on("data", (chunk) => { if ((bytes += chunk.byteLength) > OUTPUT_LIMIT) { overflow = true; stop(); } else stderr += chunk.toString(); });
    child.on("error", (error) => { settled(); reject(error); });
    child.on("close", (code) => {
      settled();
      consume(pending + decoder.end());
      if (signal?.aborted) return reject(new LlmError("Claude Code was cancelled", "ABORTED"));
      if (early) return resolve({ text: String(early.structured.text ?? ""), structured: early.structured, usage: early.usage });
      if (overflow) return reject(new LlmError("Claude Code returned too much output", "OUTPUT_LIMIT"));
      if (timedOut) return reject(new LlmError("Claude Code timed out after 15 minutes", "CLAUDE_CODE_TIMEOUT"));
      try {
        if (!final) throw new Error(stderr.trim() || `Claude Code exited with code ${code} without JSON output`);
        const structured = schema ? structuredOutput(final) : null;
        const said = String(final.result ?? "").trim();
        // a plan limit arrives as a short plain result, so it must not be stored as an answer
        if (/hit your[\w\s-]*limit|usage limit reached/i.test(said) && (final.is_error || said.length < 300))
          throw new LlmError(said, QUOTA_EXCEEDED_CODE);
        if (code !== 0 || final.is_error || (schema ? !structured : !String(final.result ?? "").trim())) {
          throw new Error(final.result || stderr.trim() || `Claude Code exited with code ${code}`);
        }
        resolve({ text: String(final.result ?? ""), structured, usage: final.usage ?? {}, stopReason: final.stop_reason });
      } catch (error) {
        reject(error instanceof LlmError ? error : new LlmError(error.message, "CLAUDE_CODE"));
      }
    });
    // a cli that exits before reading its input breaks the pipe, and close reports why it exited
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

// a dsh tool called by its own name has no schema behind it, so the model often sends "1" for 1 or a list as json text
function typedArguments(args, parameters) {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => {
    const schema = parameters?.properties?.[key];
    // a parameter that may be empty is written as oneOf [its type, null]
    const choices = (schema?.oneOf ?? schema?.anyOf ?? []).filter((choice) => choice.type !== "null");
    const type = schema?.type ?? (choices.length === 1 ? choices[0].type : undefined);
    if (typeof value !== "string") return [key, value];
    // only text that reads back the same, so a zip like "02134" or a 19 digit id stays exact
    if ((type === "number" || type === "integer") && /^-?\d+(\.\d+)?$/.test(value) && String(Number(value)) === value)
      return [key, Number(value)];
    if (type === "boolean" && (value === "true" || value === "false")) return [key, value === "true"];
    if (type === "array" || type === "object") try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed) === (type === "array")) return [key, parsed];
    } catch {}
    return [key, value];
  }));
}

export function claudeChunks(result, tools = []) {
  const usage = { type: "usage", usage: {
    inputTokens: Number(result.usage.input_tokens ?? 0),
    outputTokens: Number(result.usage.output_tokens ?? 0),
    ...result.usage.cache_read_input_tokens > 0 ? { cacheReadTokens: Number(result.usage.cache_read_input_tokens) } : {},
    ...result.usage.cache_creation_input_tokens > 0 ? { cacheWriteTokens: Number(result.usage.cache_creation_input_tokens) } : {}
  } };
  if (result.structured?.tool) {
    // a name outside this turn's list is not fatal: tool discovery hides schemas it evicted but the
    // registry still runs them, and a made-up name comes back as a tool error the model can recover from
    const name = String(result.structured.tool);
    const args = result.structured.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new LlmError("Claude Code returned invalid DSH tool arguments", "CLAUDE_CODE");
    const id = randomUUID();
    const argumentsText = JSON.stringify(typedArguments(args, tools.find((tool) => tool.name === name)?.parameters));
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
    { type: "finish", reason: { kind: result.stopReason === "max_tokens" ? "max-tokens" : "stop" } }
  ];
}

class ClaudeCodeAdapter extends LlmAdapter {
  constructor(ctx, config) { super(); this.ctx = ctx; this.config = config; }
  providerInfo() { return { id: "claude-code", name: "Claude Code subscription" }; }
  async listModels() {
    return (await configuredClaudeModels(this.ctx, this.config.models.get())).map(claudeModel);
  }
  resolveModel(_provider, model) {
    return Promise.resolve(claudeModel(model));
  }
  async *stream(request) {
    const command = (await this.ctx.credentials.resolve(CLAUDE_PATH_REF))?.value;
    if (!command) throw new LlmError("Choose Claude Code under Settings → AI connections", "MISSING_CREDENTIAL");
    // the agent loop sends its prompt as a leading system message, only one-shot callers set system
    const [first, ...rest] = request.messages ?? [];
    const prompt = request.system === undefined && first?.role === "system"
      ? { ...request, system: messageText(first.content), messages: rest } : request;
    const tools = prompt.tools ?? [];
    const mode = claudeProtocolMode(prompt);
    const options = { ...prompt, system: [prompt.system, claudeModeLine(tools, mode)].filter(Boolean).join("\n\n") };
    const schema = tools.length ? claudeResponseSchema(tools, mode) : undefined;
    const result = await runClaude(
      command, options.model, options.reasoningEffort, claudeInput(options), options.signal, schema, options.system
    );
    for (const chunk of claudeChunks(result, tools)) yield chunk;
  }
}

async function executable(path) {
  try { await access(path, constants.X_OK); return true; } catch { return false; }
}

function claudeStdout(path, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(path, args, { env: safeEnvironment(), stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error("That file is not a working Claude Code program"));
      else resolve(output.trim());
    });
  });
}

const claudeVersion = async (path) => (await claudeStdout(path, ["--version"])).split("\n")[0] || "Claude Code";

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

export async function apply(ctx, config) {
  const time = globalThis.__beesStartup?.step ?? ((_phase, run) => run());
  let pending = null;
  let claudeRegistration = null;
  let refreshingCodex = null;
  let codexModels = DEFAULT_CODEX_MODELS;
  let codexCatalogLoaded = false;
  let codexModelError = "";
  let codexSyncError = "";
  let nextCodexModelRefresh = 0;
  let codexAccountId;
  let claudeSync = Promise.resolve();
  const adapter = new ClaudeCodeAdapter(ctx, config);
  const ensureCodex = (force = false) => {
    refreshingCodex ??= (async () => {
      if (!await refreshCodex(ctx)) return false;
      const stored = credential((await ctx.credentials.resolve(CODEX_OAUTH_REF))?.value);
      if (stored.accountId !== codexAccountId) {
        codexAccountId = stored.accountId;
        codexModels = DEFAULT_CODEX_MODELS;
        codexCatalogLoaded = false;
        nextCodexModelRefresh = 0;
      }
      if (force || Date.now() >= nextCodexModelRefresh) {
        try {
          codexModels = await fetchCodexModels(stored);
          codexCatalogLoaded = true;
          codexModelError = "";
          nextCodexModelRefresh = Date.now() + CODEX_MODEL_REFRESH_MS;
        } catch (error) {
          codexModelError = "Could not refresh Codex models. Your saved models are still available; Bees will retry automatically.";
          nextCodexModelRefresh = Date.now() + 60_000;
          ctx.logger.warn(`Codex model refresh failed: ${error.message}`);
        }
      }
      // Updating the shared provider also updates agent runs and Latest Sol/Luna, not just Settings.
      if (codexCatalogLoaded) {
        try {
          await syncCodexModels(ctx, codexModels, config.codexExcludedModels.get());
          codexSyncError = "";
        } catch (error) {
          codexSyncError = "Could not update the available Codex models. Bees will retry automatically.";
          ctx.logger.warn(`Codex model settings update failed: ${error.message}`);
        }
      }
      return true;
    })().finally(() => { refreshingCodex = null; });
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
  // Settings edits wait for the whole Loader tree. Awaiting one inside apply() deadlocks startup.
  void time("subscriptions.codex.refresh", ensureCodex).catch((error) => ctx.logger.warn(`Codex token refresh failed: ${error.message}`));
  await time("subscriptions.claude.configure", syncClaude);
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
        const models = await configuredClaudeModels(ctx, config.models.get());
        let version = "";
        if (path) version = await claudeVersion(path).catch(() => "Unavailable");
        return json(res, 200, { codex, codexModels: codexModels.filter(({ id }) => !config.codexExcludedModels.get().includes(id)), codexModelError: codexModelError || codexSyncError,
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
          await ensureCodex(true);
          return json(res, 200, { connected: true, models: codexModels.filter(({ id }) => !config.codexExcludedModels.get().includes(id)) });
        } finally {
          current.abort.abort();
          if (pending === current) pending = null;
        }
      }
      if (input.action === "codex_test") {
        if (!await ensureCodex(true)) throw new Error("Sign in to Codex first");
        return json(res, 200, { ok: true });
      }
      if (input.action === "codex_models") {
        if (!Array.isArray(input.models) || !input.models.length || input.models.length > 100 || input.models.some((id) => typeof id !== "string" || !CODEX_MODEL_ID.test(id)))
          throw new Error("Choose between 1 and 100 valid Codex model IDs");
        const selected = new Set(input.models);
        const excluded = [...new Set([...config.codexExcludedModels.get(), ...codexModels.map(({ id }) => id)])].filter((id) => !selected.has(id));
        await ctx.settings.update(ctx.fiber.entry?.options.id ?? name, { codexExcludedModels: excluded });
        return json(res, 200, { models: mergeCodexModels(input.models.map((id) => ({ id })), codexModels, excluded) });
      }
      if (input.action === "codex_logout") {
        await refreshingCodex?.catch(() => {});
        await ctx.credentials.unset(CODEX_OAUTH_REF);
        await ctx.credentials.unset(CODEX_ACCESS_REF);
        codexModels = DEFAULT_CODEX_MODELS;
        codexCatalogLoaded = false;
        codexModelError = "";
        codexSyncError = "";
        codexAccountId = undefined;
        nextCodexModelRefresh = 0;
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
        const status = await claudeStdout(path, ["auth", "status"]).then(JSON.parse).catch(() => ({}));
        if (!status.loggedIn) throw new Error("Claude Code is not signed in. Open Terminal, run claude, sign in, then test again.");
        return json(res, 200, { ok: true });
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
