// Native agent runtimes exposed as OpenAI-completions endpoints for Flue.
//
// Codex runs through OpenAI's official SDK and its pinned, bundled runtime. Claude Code
// remains an optional external adapter because its subscription login belongs to that CLI.

import { Codex, type ModelReasoningEffort } from "@openai/codex-sdk";
import { execFile, spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { instancePointer } from "./state.ts";

export const CLI_PROVIDERS = ["claude-cli", "codex-cli"] as const;
export type CliProvider = (typeof CLI_PROVIDERS)[number];

const TIMEOUT_MS = Number(process.env.BEES_CLI_TIMEOUT_MS ?? 15 * 60 * 1000);
const OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const MINIMUM_CLAUDE_VERSION = [2, 1, 219] as const;
const checkedVersions = new Map<string, Promise<void>>();

interface ChatMessage {
  role: string;
  content: unknown;
}

interface ChatRequest {
  model?: string;
  messages?: ChatMessage[];
  reasoning_effort?: string;
  stream_options?: { include_usage?: boolean };
}

interface CliOutput {
  text: string;
  reasoning: string;
}

function safeEffort(value: string | undefined): string {
  return value && /^[a-z]+$/.test(value) ? value : "";
}

function codexEffort(value: string): ModelReasoningEffort | undefined {
  return (["minimal", "low", "medium", "high", "xhigh"] as const).find(
    (candidate) => candidate === value
  );
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const value = part as { type?: string; text?: string };
      return value.type === "text" && value.text ? value.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Flatten the OpenAI transcript and translate Bees' virtual workspace path. */
export function flattenPrompt(
  messages: ChatMessage[],
  workspace: string
): { system: string; prompt: string } {
  const real = (value: string): string => value.replaceAll("/workspace", workspace);
  const system = messages
    .filter(({ role }) => role === "system" || role === "developer")
    .map(({ content }) => messageText(content))
    .filter(Boolean)
    .join("\n\n");
  const prompt = messages
    .filter(({ role }) => role !== "system" && role !== "developer")
    .map(({ role, content }) => {
      const text = messageText(content);
      if (!text) return "";
      const label = role === "user" ? "User" : role === "assistant" ? "Assistant" : role;
      return `${label}: ${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
  return { system: real(system), prompt: real(prompt) };
}

export function parseModel(model: string): { model: string; instanceId: string } {
  const separator = model.lastIndexOf("@");
  const name = separator === -1 ? model : model.slice(0, separator);
  return {
    model: name === "default" ? "" : name,
    instanceId: separator === -1 ? "" : model.slice(separator + 1)
  };
}

async function workspaceFor(instanceId: string): Promise<string> {
  if (!instanceId) throw new Error("The native-agent request has no execution identity");
  try {
    const parsed = JSON.parse(await readFile(instancePointer(instanceId), "utf8")) as {
      workspace?: string;
    };
    if (!parsed.workspace) throw new Error("The execution pointer has no workspace");
    return await realpath(parsed.workspace);
  } catch {
    throw new Error("The native-agent request does not belong to an active Bees execution");
  }
}

/** No provider keys, broker tokens, SSH agents, or user startup hooks reach an agent process. */
export function agentEnvironment(): NodeJS.ProcessEnv {
  const secretName = /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)(?:_|$)/i;
  const blocked = new Set([
    "GPG_AGENT_INFO",
    "KUBECONFIG",
    "SSH_AUTH_SOCK",
    "NODE_OPTIONS",
    "BASH_ENV",
    "ENV"
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined &&
        !key.startsWith("BEES_") &&
        !key.startsWith("DYLD_") &&
        !key.startsWith("LD_") &&
        !secretName.test(key) &&
        !blocked.has(key)
    )
  );
}

function claudeSettings(workspace: string): string {
  return JSON.stringify({
    permissions: {
      disableBypassPermissionsMode: "disable",
      allow: ["Write", "Edit"]
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        denyRead: ["~/"],
        allowRead: [workspace],
        allowWrite: [workspace]
      },
      network: { allowedDomains: [], strictAllowlist: true }
    }
  });
}

function atLeast(actual: readonly number[], required: readonly number[]): boolean {
  for (let index = 0; index < required.length; index += 1) {
    if (actual[index]! > required[index]!) return true;
    if (actual[index]! < required[index]!) return false;
  }
  return true;
}

async function checkClaudeVersion(command: string, env: NodeJS.ProcessEnv): Promise<void> {
  let check = checkedVersions.get(command);
  if (!check) {
    check = execFileAsync(command, ["--version"], { encoding: "utf8", env, timeout: 5_000 })
      .then(({ stdout }) => {
        const match = stdout.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
        const actual = match?.slice(1).map(Number) ?? [];
        if (!match || !atLeast(actual, MINIMUM_CLAUDE_VERSION)) {
          throw new Error(
            `${command} ${match?.[0] ?? "has an unknown version"} is too old; Bees requires ${MINIMUM_CLAUDE_VERSION.join(".")} or newer for enforced sandboxing`
          );
        }
      })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") throw new Error("The configured Claude Code binary is missing");
        throw error;
      });
    checkedVersions.set(command, check);
  }
  await check;
}

function appendBounded(current: string, chunk: Buffer): { value: string; overflow: boolean } {
  const remaining = OUTPUT_LIMIT_BYTES - Buffer.byteLength(current);
  if (remaining <= 0) return { value: current, overflow: true };
  const value = current + chunk.subarray(0, remaining).toString();
  return { value, overflow: chunk.byteLength > remaining };
}

async function runClaude(
  model: string,
  system: string,
  prompt: string,
  cwd: string,
  effort: string,
  signal?: AbortSignal
): Promise<CliOutput> {
  const command = process.env.BEES_CLAUDE_CLI;
  if (!command) throw new Error("Claude Code is not configured. Choose its binary in Preferences.");
  const env = agentEnvironment();
  Object.assign(env, {
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
    HOME: cwd,
    TMPDIR: cwd,
    TMP: cwd,
    TEMP: cwd
  });
  await checkClaudeVersion(command, env);
  const args = [
    "--print",
    "--output-format",
    "json",
    "--safe-mode",
    "--no-session-persistence",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--tools",
    "Bash,Edit,Write",
    "--settings",
    claudeSettings(cwd),
    "--permission-mode",
    "acceptEdits",
    ...(model ? ["--model", model] : []),
    ...(effort ? ["--effort", effort] : []),
    ...(system ? ["--append-system-prompt", system] : [])
  ];

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let overflow = false;
    let timedOut = false;
    const kill = () => child.kill("SIGKILL");
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, TIMEOUT_MS);
    const abort = () => kill();
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      const next = appendBounded(stdout, chunk);
      stdout = next.value;
      overflow ||= next.overflow;
      if (overflow) kill();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const next = appendBounded(stderr, chunk);
      stderr = next.value;
      overflow ||= next.overflow;
      if (overflow) kill();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(error.code === "ENOENT" ? new Error("The configured Claude Code binary is missing") : error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(new Error("Claude Code was cancelled"));
      if (timedOut) return reject(new Error(`Claude Code timed out after ${Math.round(TIMEOUT_MS / 1000)}s`));
      if (overflow) return reject(new Error(`Claude Code exceeded the ${OUTPUT_LIMIT_BYTES} byte output limit`));
      let parsed: { result?: string; is_error?: boolean };
      try {
        parsed = JSON.parse(stdout) as typeof parsed;
      } catch {
        return reject(new Error(stderr.trim() || `Claude Code exited with code ${code}`));
      }
      if (parsed.is_error || code !== 0) {
        return reject(new Error(parsed.result || stderr.trim() || `Claude Code exited with code ${code}`));
      }
      resolvePromise({ text: parsed.result ?? "", reasoning: "" });
    });
    child.stdin.end(prompt);
  });
}

function codexHome(): string {
  return process.env.BEES_CODEX_HOME ?? join(process.env.BEES_STATE_DIR ?? ".", "codex-home");
}

function codexClient(workspace: string): Codex {
  const env = agentEnvironment() as Record<string, string>;
  env.CODEX_HOME = codexHome();
  env.HOME = workspace;
  env.TMPDIR = workspace;
  env.TMP = workspace;
  env.TEMP = workspace;
  return new Codex({
    // Tests inject a fixture binary; production always resolves the SDK's pinned runtime.
    ...(process.env.VITEST && process.env.BEES_CODEX_TEST_PATH
      ? { codexPathOverride: process.env.BEES_CODEX_TEST_PATH }
      : {}),
    env,
    config: {
      allow_login_shell: false,
      web_search: "disabled",
      notify: [],
      mcp_servers: {},
      plugins: {},
      sandbox_workspace_write: {
        network_access: false,
        exclude_slash_tmp: true,
        exclude_tmpdir_env_var: true
      },
      shell_environment_policy: {
        inherit: "core",
        ignore_default_excludes: false
      }
    }
  });
}

async function runCodex(
  model: string,
  system: string,
  prompt: string,
  cwd: string,
  effort: string,
  callerSignal?: AbortSignal
): Promise<CliOutput> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Codex timed out"));
  }, TIMEOUT_MS);
  try {
    const reasoningEffort = codexEffort(effort);
    const thread = codexClient(cwd).startThread({
      ...(model ? { model } : {}),
      workingDirectory: cwd,
      skipGitRepoCheck: true,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      ...(reasoningEffort ? { modelReasoningEffort: reasoningEffort } : {})
    });
    const turn = await thread.run(system ? `${system}\n\n${prompt}` : prompt, {
      signal: controller.signal
    });
    const reasoning = turn.items
      .filter((item): item is Extract<typeof item, { type: "reasoning" }> => item.type === "reasoning")
      .map(({ text }) => text.trim())
      .filter(Boolean)
      .join("\n\n");
    return { text: turn.finalResponse, reasoning };
  } catch (error) {
    if (timedOut) throw new Error(`Codex timed out after ${Math.round(TIMEOUT_MS / 1000)}s`);
    if (callerSignal?.aborted) throw new Error("Codex was cancelled");
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abort);
  }
}

/** The whole answer as one chunk, in the shape pi-ai's OpenAI client expects. */
export function completionStream(
  model: string,
  output: CliOutput,
  includeUsage: boolean
): string {
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model };
  const chunks = [
    ...(output.reasoning
      ? [{ ...base, choices: [{ index: 0, delta: { role: "assistant", reasoning_content: output.reasoning }, finish_reason: null }] }]
      : []),
    { ...base, choices: [{ index: 0, delta: { role: "assistant", content: output.text }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ...(includeUsage
      ? [{ ...base, choices: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }]
      : [])
  ];
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
}

async function runBundledCodexLogin(): Promise<void> {
  const script = require.resolve("@openai/codex/bin/codex.js");
  const env = agentEnvironment();
  env.CODEX_HOME = codexHome();
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, "login"], {
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const kill = () => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      kill();
      reject(new Error("Codex sign-in timed out"));
    }, 10 * 60 * 1000);
    const collect = (chunk: Buffer) => {
      const remaining = 128 * 1024 - Buffer.byteLength(output);
      if (remaining > 0) output += chunk.subarray(0, remaining).toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(output.trim() || `Codex login exited with code ${code}`));
    });
  });
}

let login: Promise<void> | null = null;

export const cliProviderRoutes = new Hono();

cliProviderRoutes.post("/codex/login", async (context) => {
  login ??= runBundledCodexLogin().finally(() => (login = null));
  try {
    await login;
    return context.json({ ok: true });
  } catch (error) {
    return context.json({ error: (error as Error).message }, 502);
  }
});

cliProviderRoutes.post("/cli/:provider/v1/chat/completions", async (context) => {
  const provider = context.req.param("provider") as CliProvider;
  if (!(CLI_PROVIDERS as readonly string[]).includes(provider)) {
    return context.json({ error: { message: `Unknown native provider: ${provider}` } }, 404);
  }
  const body = await context.req.json<ChatRequest>();
  const { model, instanceId } = parseModel(body.model ?? "");
  try {
    const workspace = await workspaceFor(instanceId);
    const { system, prompt } = flattenPrompt(body.messages ?? [], workspace);
    const effort = safeEffort(body.reasoning_effort);
    const output = provider === "codex-cli"
      ? await runCodex(model, system, prompt, workspace, effort, context.req.raw.signal)
      : await runClaude(model, system, prompt, workspace, effort, context.req.raw.signal);
    return new Response(
      completionStream(body.model ?? model, output, !!body.stream_options?.include_usage),
      { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } }
    );
  } catch (error) {
    return context.json({ error: { message: (error as Error).message, type: "native_agent_error" } }, 502);
  }
});
