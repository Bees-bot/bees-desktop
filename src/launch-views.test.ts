import { describe, expect, it } from "vitest";
import { inboxView, runView, stageProgressStrip, workItemView } from "./launch-views.js";
import type { BeesConversationSnapshotV1 } from "./conversation-snapshot.js";
import type { Execution, ExecutionOutput, Process, WorkItem } from "./domain.js";
import type { EscalationGroup } from "./supervision.js";

const STAGES = [
  { id: "plan", name: "Plan" },
  { id: "review", name: "Review" }
];

describe("stageProgressStrip", () => {
  it("marks the current stage and leaves the rest ghosted", () => {
    const html = stageProgressStrip(STAGES, "review");
    expect(html).toContain('badge-primary">Review<');
    expect(html).toContain('badge-ghost">Plan<');
  });
});

describe("workItemView", () => {
  const item = {
    id: "item-1",
    title: "Ship it",
    description: "",
    processId: "process-1",
    stageId: "review",
    logicalFiles: [],
    checkpointAt: null,
    waits: []
  } as unknown as WorkItem;

  const run = (id: string, status: string): Execution => ({
    id,
    agentId: "agent-1",
    config: {} as Execution["config"],
    workItemId: item.id,
    runtime: "dsh",
    status: status as Execution["status"],
    conversationId: id,
    instanceUid: null,
    conversationSnapshot: null,
    restartedFromExecutionId: null,
    submissionId: null,
    workspaceRef: null,
    result: null,
    usage: null,
    model: null,
    logs: "",
    error: null,
    startedAt: "2026-08-09T00:00:00.000Z",
    endedAt: status === "completed" ? "2026-08-09T00:01:00.000Z" : null,
    createdAt: "2026-08-09T00:00:00.000Z"
  });

  const pendingOutput = { id: "out-1", executionId: "run-pending", status: "pending" } as unknown as ExecutionOutput;
  const browserSnapshot: BeesConversationSnapshotV1 = {
    version: 1,
    capturedAt: "2026-08-09T00:00:30.000Z",
    messages: [{
      id: "message-1",
      role: "assistant",
      parts: [{
        kind: "tool",
        name: "browser_read",
        state: "output-available",
        output: { url: "https://example.com/task" }
      }]
    }]
  };

  it("renders no tab buttons — one page, not three", () => {
    const html = workItemView({
      item,
      stages: STAGES,
      runs: [run("run-done", "completed")],
      outputsByExecution: new Map(),
      snapshotsByExecution: new Map(),
      previews: new Map()
    });
    expect(html).not.toContain("data-item-tab");
  });

  it("auto-opens the run holding a pending approval, and only that one", () => {
    const html = workItemView({
      item,
      stages: STAGES,
      runs: [run("run-done", "completed"), run("run-pending", "completed")],
      outputsByExecution: new Map([["run-pending", [pendingOutput]]]),
      snapshotsByExecution: new Map(),
      previews: new Map()
    });
    const openCount = (html.match(/<details[^>]*\bopen\b/g) ?? []).length;
    expect(openCount).toBe(1);
    expect(html).toContain("Needs you");
  });

  it("puts View Browser before the run control only when that run used a browser", () => {
    const execution = run("run-browser", "running");
    const html = runView({
      execution,
      item,
      outputs: [],
      snapshot: browserSnapshot,
      previews: new Map()
    });
    expect(html).toContain('data-action="view-browser"');
    expect(html).toContain('data-url="https://example.com/task"');
    expect(html.indexOf("view-browser")).toBeLessThan(html.indexOf("stop-run"));

    expect(runView({ execution, item, outputs: [], snapshot: null, previews: new Map() }))
      .not.toContain("view-browser");
  });

  it("offers View Browser directly in the waiting-on-you inbox", () => {
    const execution = { ...run("run-browser", "completed"), conversationSnapshot: browserSnapshot };
    const groups = [{
      escalations: [{
        item,
        state: { kind: "waiting", reason: "approval", label: "Waiting on you", detail: "Review it" }
      }]
    }] as unknown as EscalationGroup[];
    const processes = [{ id: "process-1", name: "Launch" }] as unknown as Process[];
    const html = inboxView(groups, [execution], [], processes);
    expect(html).toContain('data-action="view-browser"');
    expect(html).toContain("View Browser");
  });
});
