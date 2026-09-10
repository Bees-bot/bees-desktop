import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

it("counts each provider response once across streamed samples and recovered sessions", () => {
  const directory = mkdtempSync(join(tmpdir(), "bees-token-usage-"));
  const usage = { inputTokens: 100, outputTokens: 5, cacheReadTokens: 20 };
  const message = (responseId: string, step: number) => ({
    type: "assistant/message", time: step,
    data: { turn: 1, step, usage, message: {
      role: "assistant", source: { provider: "test", model: "test",
        replayState: { response: { responseId } } },
      content: [{ type: "tool-call", name: "test_tool", arguments: "PRIVATE TOOL ARGUMENTS" }]
    } }
  });
  const first = [
    { type: "session", id: "original", cwd: "/test/runs/example-stage-0-work-1" },
    { type: "request/header", data: { header: { system: "PRIVATE SYSTEM PROMPT",
      tools: [{ name: "test_tool", description: "PRIVATE TOOL DESCRIPTION" }] } } },
    { type: "step/start", data: { turn: 1, step: 1 } },
    ...[1, 3, 5].map((outputTokens) => ({ type: "assistant/chunk", time: outputTokens,
      data: { turn: 1, step: 1, chunk: { type: "usage", usage: { ...usage, outputTokens } } } })),
    message("response-1", 1),
    { type: "step/end", data: { turn: 1, step: 1 } }
  ];
  const recovered = [
    { ...first[0], id: "recovered" }, ...first.slice(1),
    { type: "step/start", data: { turn: 1, step: 2 } }, message("response-2", 2)
  ];
  try {
    for (const [name, events] of [["original", first], ["recovered", recovered]] as const) {
      mkdirSync(join(directory, name));
      writeFileSync(join(directory, name, "session.jsonl"), events.map((event) => JSON.stringify(event)).join("\n"));
    }
    const output = execFileSync(process.execPath, [fileURLToPath(new URL(
      "../scripts/inspect-token-usage.mjs", import.meta.url)), directory], { encoding: "utf8" });
    const [report] = JSON.parse(output);
    expect(report).toMatchObject({ sessionCount: 2, reportedTokens: 250,
      uncachedInputTokens: 200, cachedInputTokens: 40, outputTokens: 10,
      successfulModelCalls: 2, callsWithoutUsage: 0, toolCalls: { test_tool: 2 } });
    expect(report.sessions.map((session: { reportedTokens: number }) => session.reportedTokens)).toEqual([250, 125]);
    expect(output).not.toContain("PRIVATE");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
