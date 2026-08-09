import { describe, expect, it } from "vitest";
import { stageProgressStrip, workItemView } from "./launch-views.js";
import type { Execution, ExecutionOutput, WorkItem } from "./domain.js";

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
    runtime: "flue",
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
});
