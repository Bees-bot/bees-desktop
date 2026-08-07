import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cliProviderRoutes,
  completionStream,
  flattenPrompt,
  parseModel
} from "../flue-runtime/project/.flue/cli-provider.js";

describe("CLI-backed providers", () => {
  it("carries the run's instance id on the model name and splits it back off", () => {
    expect(parseModel("claude-cli/sonnet@agent-7-item-3")).toEqual({
      model: "claude-cli/sonnet",
      instanceId: "agent-7-item-3"
    });
    expect(parseModel("sonnet")).toEqual({ model: "sonnet", instanceId: "" });
    // "default" is the absence of a model: the CLI falls back to its own configuration.
    expect(parseModel("default@run-1")).toEqual({ model: "", instanceId: "run-1" });
  });

  // Codex reports a rejected model on stdout as JSONL and exits 1 with an empty stderr, so
  // without this the run failed with nothing but "exited with code 1".
  it("surfaces a CLI failure reported on stdout", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-cli-"));
    const state = mkdtempSync(join(tmpdir(), "bees-state-"));
    mkdirSync(join(state, "instances"), { recursive: true });
    writeFileSync(join(state, "instances", "run-failure.json"), JSON.stringify({ workspace: root }));
    const stub = join(root, "fake-codex");
    const failure = JSON.stringify({
      type: "error",
      message: JSON.stringify({ error: { message: "That model is not available." } })
    });
    writeFileSync(stub, `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '${failure}'\nexit 1\n`);
    chmodSync(stub, 0o755);
    process.env.BEES_FLUE_ROOT = root;
    process.env.BEES_STATE_DIR = state;
    process.env.BEES_CODEX_CLI = stub;

    const response = await cliProviderRoutes.request("/cli/codex-cli/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "default@run-failure",
          messages: [{ role: "user", content: "hi" }]
        })
    });

    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toContain("That model is not available.");
  });

  it("refuses to run a CLI without a bound execution workspace", async () => {
    const response = await cliProviderRoutes.request("/cli/codex-cli/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "default", messages: [{ role: "user", content: "hi" }] })
    });

    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toContain("execution identity");
  });

  it("rewrites the virtual workspace path the agent was told to use", () => {
    const { system, prompt } = flattenPrompt(
      [
        { role: "system", content: "Write outputs under /workspace/outputs." },
        { role: "user", content: [{ type: "text", text: "Read /workspace/inputs/task.md" }] },
        { role: "assistant", content: "On it." }
      ],
      "/tmp/run-1"
    );
    expect(system).toBe("Write outputs under /tmp/run-1/outputs.");
    expect(prompt).toBe("User: Read /tmp/run-1/inputs/task.md\n\nAssistant: On it.");
  });

  it("streams the CLI answer as one OpenAI chunk followed by a stop", () => {
    const events = completionStream("claude-cli/sonnet", { text: "done", reasoning: "" }, false)
      .split("\n\n")
      .filter(Boolean)
      .map((line) => line.replace("data: ", ""));
    expect(JSON.parse(events[0]!).choices[0].delta.content).toBe("done");
    expect(JSON.parse(events[1]!).choices[0].finish_reason).toBe("stop");
    expect(events.at(-1)).toBe("[DONE]");
    expect(completionStream("m", { text: "x", reasoning: "" }, true).includes('"usage"')).toBe(true);
  });

  // pi-ai turns `reasoning_content` into a thinking block, and closes that block as soon as
  // text arrives — so the thinking has to lead or it is dropped.
  it("puts a CLI's own reasoning ahead of the answer", () => {
    const events = completionStream("codex-cli/default", { text: "done", reasoning: "weighed it" }, false)
      .split("\n\n")
      .filter(Boolean)
      .map((line) => line.replace("data: ", ""));
    expect(JSON.parse(events[0]!).choices[0].delta.reasoning_content).toBe("weighed it");
    expect(JSON.parse(events[1]!).choices[0].delta.content).toBe("done");
  });

  // Stands in for the real `claude` binary: same argv shape, same JSON output format.
  it("spawns the CLI in the run's workspace and returns its answer", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-cli-"));
    const workspace = mkdtempSync(join(tmpdir(), "bees-work-"));
    const state = mkdtempSync(join(tmpdir(), "bees-state-"));
    mkdirSync(join(state, "instances"), { recursive: true });
    writeFileSync(join(state, "instances", "run-1.json"), JSON.stringify({ workspace }));
    const stub = join(root, "fake-claude");
    // Echoes back the directory it ran in and the prompt it was handed on stdin.
    writeFileSync(
      stub,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.219 (Claude Code)"; exit; fi\nprintf \'{"result":"%s %s"}\' "$(pwd -P)" "$(cat)"\n'
    );
    chmodSync(stub, 0o755);
    process.env.BEES_FLUE_ROOT = root;
    process.env.BEES_STATE_DIR = state;
    process.env.BEES_CLAUDE_CLI = stub;

    const response = await cliProviderRoutes.request("/cli/claude-cli/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "sonnet@run-1",
        messages: [{ role: "user", content: "hello" }]
      })
    });

    const chunk = JSON.parse((await response.text()).split("\n\n")[0]!.replace("data: ", ""));
    expect(response.status).toBe(200);
    expect(chunk.choices[0].delta.content).toBe(`${realpathSync(workspace)} User: hello`);
  });

  it("passes the requested effort and hardens each CLI launch", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-cli-"));
    const state = mkdtempSync(join(tmpdir(), "bees-state-"));
    mkdirSync(join(state, "instances"), { recursive: true });
    writeFileSync(join(state, "instances", "run-2.json"), JSON.stringify({ workspace: root }));
    process.env.BEES_FLUE_ROOT = root;
    process.env.BEES_STATE_DIR = state;

    // Each stub reports its own argv as the answer, in that CLI's output format.
    const claude = join(root, "argv-claude");
    writeFileSync(
      claude,
      `#!${process.execPath}\nif (process.argv[2] === "--version") { console.log("2.1.219 (Claude Code)"); process.exit(); }\nprocess.stdin.resume(); process.stdin.on("end", () => console.log(JSON.stringify({ result: JSON.stringify({ args: process.argv.slice(2), secret: process.env.RUNNER_SECRET_TOKEN ?? null, ssh: process.env.SSH_AUTH_SOCK ?? null, scrub: process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB ?? null }) })));\n`
    );
    chmodSync(claude, 0o755);
    process.env.BEES_CLAUDE_CLI = claude;
    const codex = join(root, "argv-codex");
    writeFileSync(
      codex,
      `#!${process.execPath}\nprocess.stdin.resume(); process.stdin.on("end", () => console.log(JSON.stringify({ msg: { type: "agent_message", text: JSON.stringify({ args: process.argv.slice(2), secret: process.env.RUNNER_SECRET_TOKEN ?? null, ssh: process.env.SSH_AUTH_SOCK ?? null }) } })));\n`
    );
    chmodSync(codex, 0o755);
    process.env.BEES_CODEX_CLI = codex;
    process.env.RUNNER_SECRET_TOKEN = "must-not-leak";
    process.env.SSH_AUTH_SOCK = "/tmp/must-not-leak.sock";

    interface Launch {
      args: string[];
      secret: string | null;
      ssh: string | null;
      scrub?: string | null;
    }
    const launchFor = async (provider: string, effort: string): Promise<Launch> => {
      const response = await cliProviderRoutes.request(`/cli/${provider}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "default@run-2",
          reasoning_effort: effort,
          messages: [{ role: "user", content: "hi" }]
        })
      });
      const chunk = JSON.parse((await response.text()).split("\n\n")[0]!.replace("data: ", ""));
      return JSON.parse(chunk.choices[0].delta.content) as Launch;
    };

    const claudeLaunch = await launchFor("claude-cli", "xhigh");
    const claudeArgs = claudeLaunch.args;
    expect(claudeArgs).toEqual(
      expect.arrayContaining([
        "--safe-mode",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--tools",
        "Bash,Edit,Write",
        "--effort",
        "xhigh"
      ])
    );
    expect(
      claudeArgs.slice(
        claudeArgs.indexOf("--setting-sources"),
        claudeArgs.indexOf("--setting-sources") + 2
      )
    ).toEqual(["--setting-sources", ""]);
    const claudeSettings = JSON.parse(claudeArgs[claudeArgs.indexOf("--settings") + 1]!) as {
      sandbox: Record<string, unknown>;
      permissions: Record<string, unknown>;
    };
    expect(claudeSettings.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        denyRead: ["~/"],
        allowRead: [realpathSync(root)],
        allowWrite: [realpathSync(root)]
      },
      network: { allowedDomains: [], strictAllowlist: true }
    });
    // Writing an output must never come back as a request for approval nobody can answer.
    expect(claudeSettings.permissions).toMatchObject({ allow: ["Write", "Edit"] });
    expect(claudeLaunch).toMatchObject({ secret: null, ssh: null, scrub: "1" });

    const codexLaunch = await launchFor("codex-cli", "high");
    expect(codexLaunch.args).toEqual(
      expect.arrayContaining([
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--strict-config",
        "-c",
        "allow_login_shell=false",
        "-c",
        "web_search=disabled",
        "-c",
        "sandbox_workspace_write.network_access=false",
        "-c",
        "model_reasoning_effort=high"
      ])
    );
    expect(codexLaunch).toMatchObject({ secret: null, ssh: null });
    // A value neither CLI would accept is dropped rather than handed to the process.
    expect((await launchFor("claude-cli", "very; rm -rf /")).args).not.toContain("--effort");
    delete process.env.RUNNER_SECRET_TOKEN;
    delete process.env.SSH_AUTH_SOCK;
  });

  it("refuses a Claude Code version that cannot enforce the strict network sandbox", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-cli-"));
    const state = mkdtempSync(join(tmpdir(), "bees-state-"));
    mkdirSync(join(state, "instances"), { recursive: true });
    writeFileSync(join(state, "instances", "run-old.json"), JSON.stringify({ workspace: root }));
    const stub = join(root, "old-claude");
    writeFileSync(stub, '#!/bin/sh\necho "2.1.217 (Claude Code)"\n');
    chmodSync(stub, 0o755);
    process.env.BEES_FLUE_ROOT = root;
    process.env.BEES_STATE_DIR = state;
    process.env.BEES_CLAUDE_CLI = stub;

    const response = await cliProviderRoutes.request("/cli/claude-cli/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "default@run-old", messages: [{ role: "user", content: "hi" }] })
    });

    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toContain("requires 2.1.219 or newer");
  });

  it("keeps the reasoning codex reports alongside its answer", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-cli-"));
    const state = mkdtempSync(join(tmpdir(), "bees-state-"));
    mkdirSync(join(state, "instances"), { recursive: true });
    writeFileSync(join(state, "instances", "run-3.json"), JSON.stringify({ workspace: root }));
    const stub = join(root, "thinking-codex");
    const events = [
      { msg: { type: "agent_reasoning", text: "first I checked the tests" } },
      { item: { type: "reasoning", text: "then the config" } },
      { msg: { type: "agent_message", text: "all green" } }
    ]
      .map((event) => JSON.stringify(event))
      .join("\\n");
    writeFileSync(stub, `#!/bin/sh\ncat >/dev/null\nprintf '${events}\\n'\n`);
    chmodSync(stub, 0o755);
    process.env.BEES_FLUE_ROOT = root;
    process.env.BEES_STATE_DIR = state;
    process.env.BEES_CODEX_CLI = stub;

    const response = await cliProviderRoutes.request("/cli/codex-cli/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "default@run-3", messages: [{ role: "user", content: "hi" }] })
    });
    const chunks = (await response.text())
      .split("\n\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.replace("data: ", "")));
    expect(chunks[0].choices[0].delta.reasoning_content).toBe(
      "first I checked the tests\n\nthen the config"
    );
    expect(chunks[1].choices[0].delta.content).toBe("all green");
  });
});
