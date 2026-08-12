import { describe, expect, it } from "vitest";
import { runTimeline } from "./domain.js";
import type { Execution, ProcessRun, WorkItem } from "./domain.js";

const item = {
  id: "item-1",
  stageId: "review",
  createdAt: "2026-08-01T09:00:00.000Z"
} as unknown as WorkItem;

const step = (id: string, startedAt: string, endedAt: string | null): Execution => ({
  id,
  workItemId: item.id,
  status: "completed",
  startedAt,
  endedAt,
  createdAt: startedAt
} as unknown as Execution);

const run = (steps: Execution[]): ProcessRun => ({
  item,
  steps,
  startedAt: steps[0]?.startedAt ?? item.createdAt
});

describe("runTimeline", () => {
  it("dates the run from creation, each step, and every checkpoint after it", () => {
    const events = runTimeline(
      run([
        step("run-1", "2026-08-01T10:00:00.000Z", "2026-08-01T10:05:00.000Z"),
        step("run-2", "2026-08-01T11:00:00.000Z", "2026-08-01T11:02:00.000Z")
      ]),
      (execution) => (execution.id === "run-1" ? "plan" : "review"),
      (execution) => (execution.id === "run-1" ? "review" : "done")
    );
    expect(events.map(({ kind, stageId, toStageId, at }) => [kind, stageId, toStageId ?? null, at])).toEqual([
      ["created", "plan", null, "2026-08-01T09:00:00.000Z"],
      ["ran", "plan", null, "2026-08-01T10:00:00.000Z"],
      ["moved", "plan", "review", "2026-08-01T10:05:00.000Z"],
      ["ran", "review", null, "2026-08-01T11:00:00.000Z"],
      ["moved", "review", "done", "2026-08-01T11:02:00.000Z"]
    ]);
  });

  it("records no move for a run that has not ended, or that checkpointed in place", () => {
    const events = runTimeline(
      run([
        step("run-1", "2026-08-01T10:00:00.000Z", null),
        step("run-2", "2026-08-01T11:00:00.000Z", "2026-08-01T11:02:00.000Z")
      ]),
      () => "plan",
      () => "plan"
    );
    expect(events.filter(({ kind }) => kind === "moved")).toEqual([]);
  });

  it("falls back to the item's current status for a run whose agent never started", () => {
    const events = runTimeline(run([]), () => "plan", () => null);
    expect(events).toEqual([
      { at: item.createdAt, kind: "created", stageId: "review" }
    ]);
  });
});
