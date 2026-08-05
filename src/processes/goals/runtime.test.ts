import { describe, expect, it } from "vitest";
import type { Process, WorkItem } from "../../domain.js";
import { completedGoalsReadyForReview, goalStageForRun } from "./runtime.js";

const stages = ["Plan", "Work", "Waiting", "Review", "Done"].map((name, position) => ({
  id: name.toLowerCase(),
  processId: "goals",
  name,
  position,
  completionRules: "",
  archivedAt: null
}));
const goals = { id: "goals", name: "Goals", stages } as Process;
const item = (value: Partial<WorkItem>): WorkItem =>
  ({
    id: "parent",
    processId: "goals",
    stageId: "waiting",
    parentId: null,
    title: "Goal",
    description: "",
    owner: null,
    status: "open",
    logicalFiles: [],
    syncVersion: 0,
    checkpointStageId: null,
    checkpointAt: null,
    deletedAt: null,
    createdAt: "",
    updatedAt: "",
    ...value
  }) as WorkItem;

describe("Goals process runtime", () => {
  it("resumes a waiting goal only after every child is done", () => {
    const parent = item({});
    const done = item({ id: "child-1", parentId: parent.id, status: "done", logicalFiles: ["a.md"] });
    expect(completedGoalsReadyForReview([parent, done], [goals])).toEqual([
      expect.objectContaining({ parent, review: stages[3], logicalFiles: ["a.md"] })
    ]);
    expect(completedGoalsReadyForReview([parent, { ...done, status: "open" }], [goals])).toEqual([]);
  });

  it("adds the goal-stage contract only to the Goals process", () => {
    expect(goalStageForRun(goals, stages[0]!)).toBe("Plan");
    expect(goalStageForRun({ ...goals, name: "Other" }, stages[0]!)).toBeUndefined();
  });
});
