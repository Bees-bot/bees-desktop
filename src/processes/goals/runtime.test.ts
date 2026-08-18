import { describe, expect, it } from "vitest";
import type { Process, WorkItem } from "../../domain.js";
import {
  completedTaskPlanParentsReadyForReview,
  requireTaskPlanAgentStage,
  taskPlanAgentStages,
  taskPlanContextForRun
} from "./runtime.js";
import { goalsProcess } from "./definition.js";
import { persistProcessDefinition } from "../types.js";

const stages = goalsProcess.definition.states.map((state, position) => ({
  id: `${state.key}-id`,
  key: state.key,
  processId: "goals",
  name: state.name,
  position,
  completionRules: "",
  isTerminal: "terminal" in state && state.terminal === true,
  archivedAt: null
}));
const goals = {
  id: "goals",
  name: "Goals",
  tags: [],
  updatedAt: "2026-01-01T00:00:00.000Z",
  definition: persistProcessDefinition(
    goalsProcess.definition,
    Object.fromEntries(stages.map(({ key, id }) => [key, id]))
  ),
  stages
} as unknown as Process;
const item = (value: Partial<WorkItem>): WorkItem =>
  ({
    id: "parent",
    processId: "goals",
    stageId: "waiting-id",
    parentId: null,
    title: "Goal",
    description: "",
    owner: null,
    isTerminal: false,
    waits: [],
    logicalFiles: [],
    syncVersion: 0,
    checkpointStageId: null,
    checkpointAt: null,
    archivedAt: null,
    deletedAt: null,
    createdAt: "",
    updatedAt: "",
    ...value
  }) as WorkItem;

describe("Goals process runtime", () => {
  it("resumes a waiting goal only after every child is done", () => {
    const parent = item({});
    const done = item({ id: "child-1", parentId: parent.id, isTerminal: true, logicalFiles: ["a.md"] });
    expect(completedTaskPlanParentsReadyForReview([parent, done], [goals])).toEqual([
      expect.objectContaining({ parent, review: stages[3], logicalFiles: ["a.md"] })
    ]);
    expect(completedTaskPlanParentsReadyForReview([parent, { ...done, isTerminal: false }], [goals])).toEqual([]);
  });

  it("builds the run contract from the task-plan capability", () => {
    expect(taskPlanContextForRun(goals, stages[0]!)).toEqual({
      state: "plan-id",
      output: ".tasks.json",
      outputBlockedStates: ["waiting-id", "done-id"]
    });
    expect(taskPlanContextForRun({
      ...goals,
      definition: persistProcessDefinition()
    }, stages[0]!)).toBeUndefined();
  });

  it("keeps Waiting system-managed while allowing recursive planning", () => {
    expect(taskPlanAgentStages(goals).map(({ name }) => name)).toEqual([
      "Plan",
      "Work",
      "Review",
      "Done"
    ]);
    expect(requireTaskPlanAgentStage(goals, stages[0])).toBe(stages[0]);
    expect(() => requireTaskPlanAgentStage(goals, stages[2])).toThrow(
      "Waiting is managed by Bees"
    );
  });
});
