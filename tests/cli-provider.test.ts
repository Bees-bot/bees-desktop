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

function bindRun(workspace: string, id: string): string {
  const state = mkdtempSync(join(tmpdir(), "bees-state-"));
  mkdirSync(join(state, "instances"), { recursive: true });
  writeFileSync(join(state, "instances", `${id}.json`), JSON.stringify({ workspace }));
  process.env.BEES_STATE_DIR = state;
  process.env.BEES_CODEX_HOME = join(state, "codex-home");
  return state;
}

function firstTextChunk(raw: string): string {
  const chunks = raw
    .split("\n\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.replace("data: ", "")));
  return chunks.find((chunk) => chunk.choices[0]?.delta?.content)?.choices[0].delta.content ?? "";
}

describe("native agent providers", () => {
  it("carries the run identity on the model name and splits it back off", () => {
    expect(parseModel("claude-cli/sonnet@agent-7-item-3")).toEqual({
      model: "claude-cli/sonnet",
      instanceId: "agent-7-item-3"
    });
    expect(parseModel("sonnet")).toEqual({ model: "sonnet", instanceId: "" });
    expect(parseModel("default@run-1")).toEqual({ model: "", instanceId: "run-1" });
  });

  it("refuses a request without a bound execution workspace", async () => {
    const response = await cliProviderRoutes.request("/cli/codex-cli/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "default", messages: [{ role: "user", content: "hi" }] })
    });
    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toContain("execution identity");
  });

  it("rewrites the virtual workspace path", () => {
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

  it("streams reasoning before text and optionally reports usage", () => {
    const stream = completionStream("codex-cli/default", {
      text: "done",
      reasoning: "weighed it"
    }, true);
    const events = stream.split("\n\n").filter(Boolean).map((line) => line.replace("data: ", ""));
    expect(JSON.parse(events[0]!).choices[0].delta.reasoning_content).toBe("weighed it");
    expect(JSON.parse(events[1]!).choices[0].delta.content).toBe("done");
    expect(stream).toContain('"usage"');
    expect(events.at(-1)).toBe("[DONE]");
  });

  it("runs an explicitly chosen Claude binary with its strict sandbox", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "bees-work-"));
    bindRun(workspace, "run-claude");
    const stub = join(workspace, "fake-claude");
    writeFileSync(
      stub,
      `#!${process.execPath}\nif (process.argv[2] === "--version") { console.log("2.1.219 (Claude Code)"); process.exit(); }\nprocess.stdin.resume(); process.stdin.on("end", () => console.log(JSON.stringify({ result: JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), secret: process.env.RUNNER_SECRET_TOKEN ?? null, home: process.env.HOME }) })));\n`
    );
    chmodSync(stub, 0o755);
    process.env.BEES_CLAUDE_CLI = stub;
    process.env.RUNNER_SECRET_TOKEN = "must-not-leak";

    const response = await cliProviderRoutes.request("/cli/claude-cli/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "sonnet@run-claude",
        reasoning_effort: "xhigh",
        messages: [{ role: "user", content: "hello" }]
      })
    });
    const launch = JSON.parse(firstTextChunk(await response.text())) as {
      cwd: string;
      args: string[];
      secret: string | null;
      home: string;
    };
    expect(response.status).toBe(200);
    expect(launch.cwd).toBe(realpathSync(workspace));
    expect(launch.secret).toBeNull();
    expect(launch.home).toBe(realpathSync(workspace));
    expect(launch.args).toEqual(expect.arrayContaining([
      "--safe-mode",
      "--no-session-persistence",
      "--strict-mcp-config",
      "Bash,Edit,Write",
      "--effort",
      "xhigh"
    ]));
    const settings = JSON.parse(launch.args[launch.args.indexOf("--settings") + 1]!);
    expect(settings.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [], strictAllowlist: true }
    });
    delete process.env.RUNNER_SECRET_TOKEN;
  });

  it("uses the official Codex SDK with its pinned sandbox and scrubbed environment", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "bees-codex-work-"));
    const state = bindRun(workspace, "run-codex");
    const stub = join(workspace, "fake-codex");
    writeFileSync(
      stub,
      `#!${process.execPath}\nlet input = ""; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => {\nconsole.log(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }));\nconsole.log(JSON.stringify({ type: "item.completed", item: { id: "r", type: "reasoning", text: "checked the workspace" } }));\nconsole.log(JSON.stringify({ type: "item.completed", item: { id: "a", type: "agent_message", text: JSON.stringify({ args: process.argv.slice(2), input, secret: process.env.RUNNER_SECRET_TOKEN ?? null, ssh: process.env.SSH_AUTH_SOCK ?? null, codexHome: process.env.CODEX_HOME, home: process.env.HOME }) } }));\nconsole.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 1 } }));\n});\n`
    );
    chmodSync(stub, 0o755);
    process.env.BEES_CODEX_TEST_PATH = stub;
    process.env.RUNNER_SECRET_TOKEN = "must-not-leak";
    process.env.SSH_AUTH_SOCK = "/tmp/must-not-leak.sock";

    const response = await cliProviderRoutes.request("/cli/codex-cli/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "default@run-codex",
        reasoning_effort: "high",
        messages: [
          { role: "system", content: "Stay in /workspace." },
          { role: "user", content: "inspect it" }
        ]
      })
    });
    const raw = await response.text();
    const launch = JSON.parse(firstTextChunk(raw)) as {
      args: string[];
      input: string;
      secret: string | null;
      ssh: string | null;
      codexHome: string;
      home: string;
    };
    expect(response.status).toBe(200);
    expect(launch.args).toEqual(expect.arrayContaining([
      "exec",
      "--experimental-json",
      "--sandbox",
      "workspace-write",
      "--cd",
      realpathSync(workspace),
      "--skip-git-repo-check",
      "--config",
      'approval_policy="never"',
      "--config",
      "sandbox_workspace_write.network_access=false",
      "--config",
      'web_search="disabled"',
      "--config",
      'model_reasoning_effort="high"'
    ]));
    expect(launch.args).toEqual(expect.arrayContaining([
      "--config",
      "mcp_servers={}",
      "--config",
      "plugins={}"
    ]));
    expect(launch.input).toContain(`Stay in ${realpathSync(workspace)}.`);
    expect(launch).toMatchObject({
      secret: null,
      ssh: null,
      codexHome: join(state, "codex-home"),
      home: realpathSync(workspace)
    });
    expect(raw).toContain("checked the workspace");
    delete process.env.RUNNER_SECRET_TOKEN;
    delete process.env.SSH_AUTH_SOCK;
  });

  it("surfaces a Codex turn failure", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "bees-codex-fail-"));
    bindRun(workspace, "run-failure");
    const stub = join(workspace, "failing-codex");
    writeFileSync(
      stub,
      `#!${process.execPath}\nprocess.stdin.resume(); process.stdin.on("end", () => { console.log(JSON.stringify({ type: "thread.started", thread_id: "thread-2" })); console.log(JSON.stringify({ type: "turn.failed", error: { message: "That model is not available." } })); });\n`
    );
    chmodSync(stub, 0o755);
    process.env.BEES_CODEX_TEST_PATH = stub;

    const response = await cliProviderRoutes.request("/cli/codex-cli/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "default@run-failure", messages: [{ role: "user", content: "hi" }] })
    });
    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toContain("That model is not available.");
  });
});
