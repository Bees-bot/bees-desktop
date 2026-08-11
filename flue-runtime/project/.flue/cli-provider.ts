// Agent runs backed by the Claude Code, Codex and opencode CLIs the user already has
// installed.
//
// Each CLI owns its own login and its own agent loop, so they cannot be driven as
// plain chat models. This shim exposes each one as an OpenAI-completions endpoint that
// Flue's provider registration points at: one request in, one CLI process out, the CLI's
// final message returned as a single assistant chunk. The CLI does its own tool calls
// inside the run's workspace directory, so nothing comes back as an OpenAI tool call.
//
// ponytail: no streaming of partial output, no tool-call passthrough, no multi-turn
// session reuse — the CLI is re-run with the whole transcript each turn. Add
// `--output-format stream-json` (claude) / event forwarding (codex) if live token
// output in the UI becomes the thing people ask for.

import { execFile, spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { Hono } from "hono";
import { instancePointer } from "./state.ts";

export const CLI_PROVIDERS = ["claude-cli", "codex-cli", "opencode-cli"] as const;
export type CliProvider = (typeof CLI_PROVIDERS)[number];

/** Minutes a single CLI turn may take before it is killed. */
const TIMEOUT_MS = Number(process.env.BEES_CLI_TIMEOUT_MS ?? 15 * 60 * 1000);
const execFileAsync = promisify(execFile);

/** Claude Code first enforced `sandbox.network.strictAllowlist` in this release. */
const MINIMUM_CLAUDE_VERSION = [2, 1, 219] as const;
const checkedVersions = new Map<string, Promise<void>>();

interface ChatMessage {
  role: string;
  content: unknown;
}

interface ChatRequest {
  model?: string;
  messages?: ChatMessage[];
  /** pi-ai maps the agent's thinkingLevel through the model's map into this field. */
  reasoning_effort?: string;
  stream_options?: { include_usage?: boolean };
}

/** What one CLI turn produced: the answer, and the thinking that led to it when the CLI reports any. */
interface CliOutput {
  text: string;
  reasoning: string;
}

/**
 * Both CLIs take the effort level as a bare word, and both reject anything they do not
 * recognise, so a malformed value from a request body must never reach the argument list.
 */
function safeEffort(value: string | undefined): string {
  return value && /^[a-z]+$/.test(value) ? value : "";
}

/** OpenAI content is a string or a list of typed parts; only text survives the trip to a CLI. */
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

/**
 * Flatten the transcript into one prompt. `/workspace` is the virtual path Bees agents
 * are told to use; the CLI works on real files, so rewrite it to the run's directory.
 */
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

/**
 * Bees passes the run's instance id on the model name (`sonnet@agent-123`) because an
 * OpenAI request carries nothing else a workspace could be resolved from.
 */
export function parseModel(model: string): { model: string; instanceId: string } {
  const separator = model.lastIndexOf("@");
  const name = separator === -1 ? model : model.slice(0, separator);
  return {
    // `default` means "no --model flag": the CLI then uses whatever it is configured for.
    // A pinned name goes stale between CLI releases, and Codex rejects the whole run when
    // the account cannot use the model it was handed.
    model: name === "default" ? "" : name,
    instanceId: separator === -1 ? "" : model.slice(separator + 1)
  };
}

/** The run's real directory. Missing or stale pointers fail closed. */
async function workspaceFor(instanceId: string): Promise<string> {
  if (!instanceId) throw new Error("The CLI request has no execution identity");
  try {
    const parsed = JSON.parse(await readFile(instancePointer(instanceId), "utf8")) as {
      workspace?: string;
    };
    if (!parsed.workspace) throw new Error("The execution pointer has no workspace");
    return await realpath(parsed.workspace);
  } catch {
    throw new Error("The CLI request does not belong to an active Bees execution");
  }
}

interface CliSpec {
  /** Absolute path resolved by the desktop app, or the bare name for a PATH lookup. */
  command: () => string;
  args: (model: string, system: string, effort: string, workspace: string) => string[];
  minimumVersion?: readonly [number, number, number];
  env?: Record<string, string>;
  /** Set when the CLI has no system-prompt flag and it has to ride along on stdin. */
  systemOnStdin?: boolean;
  /** Final assistant text out of the CLI's own output format. */
  parse: (stdout: string) => CliOutput;
}

/** Settings owned by Bees, not by the workspace or the user's Claude configuration. */
function claudeSettings(workspace: string): string {
  return JSON.stringify({
    permissions: {
      disableBypassPermissionsMode: "disable",
      // Nobody is watching a run, so a prompt is a dead end: the CLI reports it as a
      // request for approval and the run settles with no output. The sandbox below is the
      // real boundary — it is what keeps writes inside the workspace — so file edits are
      // allowed outright instead of leaning on the permission mode to wave them through.
      allow: ["Write", "Edit"]
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        // Block the user's home; re-open the run workspace if it lives underneath it.
        denyRead: ["~/"],
        allowRead: [workspace],
        // Writable without relying on the sandbox's default working-directory rule.
        allowWrite: [workspace]
      },
      network: {
        allowedDomains: [],
        strictAllowlist: true
      }
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

/** Unknown Claude settings are silently ignored in print mode, so gate strict settings by version. */
async function checkVersion(
  command: string,
  minimum: readonly [number, number, number],
  env: NodeJS.ProcessEnv
): Promise<void> {
  let check = checkedVersions.get(command);
  if (!check) {
    check = execFileAsync(command, ["--version"], { encoding: "utf8", env, timeout: 5_000 })
      .then(({ stdout }) => {
        const match = stdout.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
        const actual = match?.slice(1).map(Number) ?? [];
        if (!match || !atLeast(actual, minimum)) {
          throw new Error(
            `${command} ${match?.[0] ?? "has an unknown version"} is too old; Bees requires ${minimum.join(".")} or newer for enforced sandboxing`
          );
        }
      })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") throw new Error(`${command} is not installed on this computer`);
        throw error;
      });
    checkedVersions.set(command, check);
  }
  await check;
}

/**
 * Codex reports API failures as a JSON string inside its own error event, e.g.
 * `{"type":"error","status":400,"error":{"message":"..."}}`. Unwrap it so the run shows the
 * sentence a person can act on instead of a nested blob.
 */
function codexMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    return parsed.error?.message ?? parsed.message ?? raw;
  } catch {
    return raw;
  }
}

const CLIS: Record<CliProvider, CliSpec> = {
  "claude-cli": {
    command: () => process.env.BEES_CLAUDE_CLI || "claude",
    minimumVersion: MINIMUM_CLAUDE_VERSION,
    env: { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" },
    // acceptEdits, not bypassPermissions: file edits in the workspace go through, and a
    // command the CLI is not allowed to run comes back as a denial instead of a prompt
    // nobody is there to answer.
    args: (model, system, effort, workspace) => [
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
      // Read/search go through Bash so the OS sandbox, not Claude's path checks, enforces access.
      "Bash,Edit,Write",
      "--settings",
      claudeSettings(workspace),
      "--permission-mode",
      "acceptEdits",
      ...(model ? ["--model", model] : []),
      // `--effort` is how the agent's reasoning setting reaches Claude Code. The CLI keeps
      // the thinking to itself either way: `--output-format json` reports only the result.
      ...(effort ? ["--effort", effort] : []),
      ...(system ? ["--append-system-prompt", system] : [])
    ],
    parse: (stdout) => {
      const parsed = JSON.parse(stdout) as { result?: string; is_error?: boolean };
      if (parsed.is_error) throw new Error(parsed.result || "Claude Code reported an error");
      return { text: parsed.result ?? "", reasoning: "" };
    }
  },
  "codex-cli": {
    command: () => process.env.BEES_CODEX_CLI || "codex",
    // workspace-write sandbox, the closest match to what acceptEdits gives the Claude CLI
    // (`codex exec` never prompts for approval anyway). The system prompt has no flag, so
    // it is prepended to the prompt on stdin instead.
    args: (model, _system, effort) => [
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--strict-config",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "-c",
      "approval_policy=never",
      "-c",
      "allow_login_shell=false",
      "-c",
      "web_search=disabled",
      "-c",
      "sandbox_workspace_write.network_access=false",
      "-c",
      "sandbox_workspace_write.exclude_slash_tmp=true",
      "-c",
      "sandbox_workspace_write.exclude_tmpdir_env_var=true",
      "-c",
      "shell_environment_policy.inherit=core",
      "-c",
      "shell_environment_policy.ignore_default_excludes=false",
      ...(model ? ["--model", model] : []),
      // Keep reasoning effort explicit and request-scoped.
      ...(effort ? ["-c", `model_reasoning_effort=${effort}`] : []),
      "-"
    ],
    systemOnStdin: true,
    parse: (stdout) => {
      // JSONL events; the last agent message is the answer. Shapes differ across codex
      // versions, so read both the `item`/`msg` wrappers and fall back to raw output.
      // Failures are reported here too, not on stderr — a rejected model or a refused
      // request leaves stderr empty, so without this the run failed with only an exit code.
      let text = "";
      let failure = "";
      const reasoning: string[] = [];
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }
        const item = (event.item ?? event.msg ?? event) as {
          type?: string;
          text?: string;
          message?: string;
          error?: { message?: string };
        };
        if (item.type === "agent_message") text = item.text ?? item.message ?? text;
        // Codex is the one CLI that reports its own thinking. `agent_reasoning` is the
        // summary; `reasoning` is the same thing under the newer `item` wrapper. Sections
        // arrive as separate events, so they accumulate rather than overwrite.
        if (item.type === "agent_reasoning" || item.type === "agent_reasoning_raw_content" || item.type === "reasoning") {
          const thought = (item.text ?? item.message ?? "").trim();
          if (thought) reasoning.push(thought);
        }
        if (item.type === "error" || item.type === "turn.failed") {
          failure = item.error?.message ?? item.message ?? failure;
        }
      }
      if (!text && failure) throw new Error(codexMessage(failure));
      return { text: text || stdout.trim(), reasoning: reasoning.join("\n\n") };
    }
  },
  "opencode-cli": {
    command: () => process.env.BEES_OPENCODE_CLI || "opencode",
    // opencode has no OS-level sandbox of its own — its permission rules are the whole
    // boundary, and `bash` runs unconfined in the run's workspace. That is weaker than the
    // other two CLIs, which hand their tool commands to seatbelt. `OPENCODE_PERMISSION` is
    // merged last, after the user's global config and the workspace's own `opencode.json`,
    // so these denials are the one part of the posture a run cannot talk its way out of.
    //
    // ponytail: unconfined bash, accepted — the CLI runs as the user who launched Bees and
    // can reach anything they can. Wrap the spawn in `sandbox-exec` (macOS) if a run ever
    // needs to be untrusted rather than merely unattended.
    env: {
      OPENCODE_PERMISSION: JSON.stringify({
        external_directory: "deny",
        webfetch: "deny",
        websearch: "deny"
      }),
      // A run can write `opencode.json` into its own workspace; without this it would be
      // read back on the next turn and merged in ahead of everything but the denials above.
      OPENCODE_DISABLE_PROJECT_CONFIG: "true",
      OPENCODE_DISABLE_AUTOUPDATE: "true"
    },
    // `--auto` approves anything not explicitly denied: nobody is watching, and the default
    // is to auto-reject, which would settle the run with no output. `--thinking` is what
    // makes opencode emit `reasoning` events at all under `--format json`. No system-prompt
    // flag, so it rides in on stdin, which is also where the prompt goes — `opencode run`
    // with no message argument reads the piped text as the message.
    args: (model, _system, effort) => [
      "run",
      "--format",
      "json",
      "--auto",
      "--thinking",
      ...(model ? ["--model", model] : []),
      // Reasoning effort is per-model in opencode, so this is only sent when the model map
      // in models.ts names a variant the model actually declares.
      ...(effort ? ["--variant", effort] : [])
    ],
    systemOnStdin: true,
    parse: (stdout) => {
      // JSONL, one event per line. A turn emits a `text` part per segment the assistant
      // writes around its tool calls, so they are joined rather than overwritten — unlike
      // codex, where the last `agent_message` is the whole answer.
      const text: string[] = [];
      const reasoning: string[] = [];
      let failure = "";
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        let event: {
          type?: string;
          part?: { text?: string };
          error?: { name?: string; data?: { message?: string } };
        };
        try {
          event = JSON.parse(trimmed) as typeof event;
        } catch {
          continue;
        }
        const thought = event.part?.text?.trim();
        if (event.type === "text" && thought) text.push(thought);
        if (event.type === "reasoning" && thought) reasoning.push(thought);
        // Failures arrive as an event and leave stderr empty, same as codex.
        if (event.type === "error") {
          failure = event.error?.data?.message ?? event.error?.name ?? failure;
        }
      }
      if (!text.length && failure) throw new Error(failure);
      return { text: text.join("\n\n") || stdout.trim(), reasoning: reasoning.join("\n\n") };
    }
  }
};

/** Run the CLI to completion in `cwd`, prompt on stdin. */
async function runCli(
  spec: CliSpec,
  model: string,
  system: string,
  prompt: string,
  cwd: string,
  effort: string
): Promise<CliOutput> {
  const command = spec.command();
  const secretName = /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)(?:_|$)/i;
  const blocked = new Set(["GPG_AGENT_INFO", "KUBECONFIG", "SSH_AUTH_SOCK"]);
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined &&
        !key.startsWith("BEES_") &&
        !secretName.test(key) &&
        !blocked.has(key)
    )
  );
  Object.assign(env, spec.env, { TMPDIR: cwd, TMP: cwd, TEMP: cwd });
  if (spec.minimumVersion) await checkVersion(command, spec.minimumVersion, env);

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, spec.args(model, system, effort, cwd), {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${Math.round(TIMEOUT_MS / 1000)}s`));
    }, TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        error.code === "ENOENT"
          ? new Error(`${command} is not installed on this computer`)
          : error
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const output = spec.parse(stdout);
        // A CLI that failed still exits nonzero even when `parse` found readable output,
        // so the exit code decides; `parse` only supplies the reason. Both CLIs report
        // failures on stdout and leave stderr empty, which is why stderr is the last resort.
        if (code !== 0) {
          reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
          return;
        }
        resolvePromise(output);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reject(new Error(code === 0 ? message : `${message} (exit code ${code})`));
      }
    });
    child.stdin.end(system && spec.systemOnStdin ? `${system}\n\n${prompt}` : prompt);
  });
}

/** The whole answer as one chunk, in the shape the OpenAI streaming client expects. */
export function completionStream(
  model: string,
  output: CliOutput,
  includeUsage: boolean
): string {
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model };
  const chunks = [
    // `reasoning_content` is the field llama.cpp and DeepSeek use and the one pi-ai reads
    // back into a thinking block, so a CLI's thinking shows in the transcript and stays in
    // context on later turns. It has to lead: pi-ai closes the thinking block once text starts.
    ...(output.reasoning
      ? [{ ...base, choices: [{ index: 0, delta: { role: "assistant", reasoning_content: output.reasoning }, finish_reason: null }] }]
      : []),
    { ...base, choices: [{ index: 0, delta: { role: "assistant", content: output.text }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    // The CLIs bill the user's own subscription, so token counts are not ours to report.
    ...(includeUsage
      ? [{ ...base, choices: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }]
      : [])
  ];
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
}

export const cliProviderRoutes = new Hono();

cliProviderRoutes.post("/cli/:provider/v1/chat/completions", async (context) => {
  const provider = context.req.param("provider") as CliProvider;
  const spec = CLIS[provider];
  if (!spec) return context.json({ error: { message: `Unknown CLI provider: ${provider}` } }, 404);
  const body = await context.req.json<ChatRequest>();
  const { model, instanceId } = parseModel(body.model ?? "");
  try {
    const workspace = await workspaceFor(instanceId);
    const { system, prompt } = flattenPrompt(body.messages ?? [], workspace);
    const output = await runCli(spec, model, system, prompt, workspace, safeEffort(body.reasoning_effort));
    return new Response(completionStream(body.model ?? model, output, !!body.stream_options?.include_usage), {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }
    });
  } catch (error) {
    return context.json({ error: { message: (error as Error).message, type: "cli_error" } }, 502);
  }
});
