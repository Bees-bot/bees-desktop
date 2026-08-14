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

function bindRun(workspace: string, id: string): void {
  const state = mkdtempSync(join(tmpdir(), "bees-state-"));
  mkdirSync(join(state, "instances"), { recursive: true });
  writeFileSync(join(state, "instances", `${id}.json`), JSON.stringify({ workspace }));
  process.env.BEES_STATE_DIR = state;
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
    const response = await cliProviderRoutes.request("/cli/claude-cli/v1/chat/completions", {
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
    const stream = completionStream("claude-cli/default", {
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
    const srt = join(workspace, "fake-srt");
    writeFileSync(
      srt,
      `#!${process.execPath}\nconst { spawnSync } = require("node:child_process"); const a = process.argv.slice(2); const i = a.indexOf("--"); const child = spawnSync(a[i + 1], a.slice(i + 2), { stdio: "inherit", env: { ...process.env, BEES_SRT_WRAPPED: "1" } }); process.exit(child.status ?? 1);\n`
    );
    chmodSync(srt, 0o755);
    const stub = join(workspace, "fake-claude");
    writeFileSync(
      stub,
      `#!${process.execPath}\nif (process.argv[2] === "--version") { console.log("2.1.219 (Claude Code)"); process.exit(); }\nprocess.stdin.resume(); process.stdin.on("end", () => console.log(JSON.stringify({ result: JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), secret: process.env.RUNNER_SECRET_TOKEN ?? null, home: process.env.HOME, wrapped: process.env.BEES_SRT_WRAPPED ?? null }) })));\n`
    );
    chmodSync(stub, 0o755);
    process.env.BEES_SRT_TEST_PATH = srt;
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
      wrapped: string | null;
    };
    expect(response.status).toBe(200);
    expect(launch.cwd).toBe(realpathSync(workspace));
    expect(launch.secret).toBeNull();
    expect(launch.home).toBe(realpathSync(workspace));
    expect(launch.wrapped).toBe("1");
    expect(launch.args).toEqual(expect.arrayContaining([
      "--safe-mode",
      "--no-session-persistence",
      "--strict-mcp-config",
      "Bash,Edit,Write",
      "--effort",
      "xhigh"
    ]));
    const settings = JSON.parse(launch.args[launch.args.indexOf("--settings") + 1]!);
    expect(settings.sandbox).toBeUndefined();
    expect(settings.permissions.disableBypassPermissionsMode).toBe("disable");
    delete process.env.BEES_SRT_TEST_PATH;
    delete process.env.RUNNER_SECRET_TOKEN;
  });
});
