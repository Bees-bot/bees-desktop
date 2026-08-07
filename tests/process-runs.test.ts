import { describe, expect, it } from "vitest";
import { processRuns } from "../src/domain.js";
import type { Execution, WorkItem } from "../src/domain.js";

const item = (id: string): WorkItem => ({ id, processId: "process-1", title: id }) as WorkItem;

const step = (id: string, workItemId: string, startedAt: string | null, createdAt: string): Execution =>
  ({ id, workItemId, startedAt, createdAt, config: { prompt: "" } }) as Execution;

describe("processRuns", () => {
  const items = [item("older"), item("newer")];
  // Executions arrive newest first, the order the repository lists them in.
  const executions = [
    step("c", "newer", "2026-08-02T09:30:00.000Z", "2026-08-02T09:29:00.000Z"),
    step("b", "newer", "2026-08-02T09:00:00.000Z", "2026-08-02T08:59:00.000Z"),
    step("a", "older", "2026-08-01T12:00:00.000Z", "2026-08-01T11:59:00.000Z")
  ];

  it("groups runs by work item, newest run first, steps oldest first", () => {
    const runs = processRuns(items, executions);
    expect(runs.map(({ item: run }) => run.id)).toEqual(["newer", "older"]);
    expect(runs[0]!.steps.map(({ id }) => id)).toEqual(["b", "c"]);
    expect(runs[0]!.startedAt).toBe("2026-08-02T09:00:00.000Z");
  });

  it("dates a step that never started by when it was created", () => {
    const queued = step("queued", "older", null, "2026-08-01T11:00:00.000Z");
    const runs = processRuns(items, [...executions, queued]);
    const older = runs.find(({ item: run }) => run.id === "older")!;
    expect(older.steps.map(({ id }) => id)).toEqual(["queued", "a"]);
    expect(older.startedAt).toBe("2026-08-01T11:00:00.000Z");
  });

  // The item whose first agent never started is the one someone opens this page to explain,
  // and it is the normal state of a studio item, which only runs when a person presses something.
  it("lists an item that has not run yet, dated by when it was created", () => {
    const fresh = { ...item("fresh"), createdAt: "2026-08-03T08:00:00.000Z" } as WorkItem;
    const runs = processRuns([...items, fresh], executions);
    expect(runs.map(({ item: run }) => run.id)).toEqual(["fresh", "newer", "older"]);
    expect(runs[0]!.steps).toEqual([]);
    expect(runs[0]!.startedAt).toBe("2026-08-03T08:00:00.000Z");
  });

  it("ignores executions of another process's items", () => {
    expect(processRuns([item("older")], executions).map(({ item: run }) => run.id)).toEqual(["older"]);
  });
});
