// The explicitly configured Claude Code runtime exposed as an OpenAI-completions endpoint.
// Codex is a direct pi-ai OAuth provider and does not pass through this shim.

import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { Hono } from "hono";
import {
  DEVELOPMENT_NETWORK_DOMAINS,
  sandboxArgvLaunch
} from "./sandbox-runtime.ts";
import { instancePointer } from "./state.ts";

export const CLI_PROVIDERS = ["claude-cli"] as const;
export type CliProvider = (typeof CLI_PROVIDERS)[number];

const TIMEOUT_MS = Number(process.env.BEES_CLI_TIMEOUT_MS ?? 15 * 60 * 1000);
const OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const MINIMUM_CLAUDE_VERSION = [2, 1, 219] as const;
const checkedVersions = new Map<string, Promise<void>>();
const CLAUDE_NETWORK_DOMAINS = [
  ...DEVELOPMENT_NETWORK_DOMAINS,
  "api.anthropic.com",
  "*.anthropic.com"
] as const;

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

function claudeSettings(): string {
  return JSON.stringify({
    permissions: {
      disableBypassPermissionsMode: "disable",
      allow: ["Write", "Edit"]
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

async function checkClaudeVersion(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const key = `${command}\0${cwd}`;
  let check = checkedVersions.get(key);
  if (!check) {
    check = sandboxArgvLaunch(command, ["--version"], cwd, cwd, env, CLAUDE_NETWORK_DOMAINS)
      .then((launch) => execFileAsync(launch.command, launch.args, {
        cwd: launch.cwd,
        encoding: "utf8",
        env: launch.env,
        timeout: 5_000
      }))
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
    checkedVersions.set(key, check);
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
  if (!command) throw new Error("Claude Code is not configured. Choose its binary under Settings → AI CLI.");
  const env = agentEnvironment();
  Object.assign(env, {
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
    HOME: cwd,
    TMPDIR: cwd,
    TMP: cwd,
    TEMP: cwd
  });
  await checkClaudeVersion(command, cwd, env);
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
    claudeSettings(),
    "--permission-mode",
    "acceptEdits",
    ...(model ? ["--model", model] : []),
    ...(effort ? ["--effort", effort] : []),
    ...(system ? ["--append-system-prompt", system] : [])
  ];
  const launch = await sandboxArgvLaunch(
    command,
    args,
    cwd,
    cwd,
    env,
    CLAUDE_NETWORK_DOMAINS
  );
  await mkdir(launch.env.TMPDIR!, { recursive: true });

  return new Promise((resolvePromise, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let overflow = false;
    let timedOut = false;
    const kill = () => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
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

export const cliProviderRoutes = new Hono();

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
    const output = await runClaude(model, system, prompt, workspace, effort, context.req.raw.signal);
    return new Response(
      completionStream(body.model ?? model, output, !!body.stream_options?.include_usage),
      { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } }
    );
  } catch (error) {
    return context.json({ error: { message: (error as Error).message, type: "native_agent_error" } }, 502);
  }
});
