import { describe, expect, it, vi } from "vitest";
import type { Execution, ExecutionOutput, Process, WorkItem } from "../../domain.js";
import { goalsProcess } from "./definition.js";
import { TaskPlanController, type TaskPlanHost } from "./controller.js";

describe("Goals process controller", () => {
  it("owns task-plan approval", async () => {
    const stages = goalsProcess.definition.states.map(({ name }, position) => ({
      id: name.toLowerCase(),
      processId: "goals",
      name,
      position,
      completionRules: "",
      archivedAt: null
    }));
    const item = { id: "goal", processId: "goals", stageId: "plan" } as WorkItem;
    const process = {
      id: "goals",
      name: "Goals",
      tags: ["module:goals"],
      updatedAt: "2026-01-01T00:00:00.000Z",
      stages
    } as Process;
    const host = {
      findWorkItem: vi.fn(() => item),
      findProcess: vi.fn(() => process),
      readOutput: vi.fn().mockResolvedValue(JSON.stringify({ tasks: [{
        key: "first",
        title: "First task",
        description: "Do the work",
        role: "goal-worker",
        effect: "prepare",
        inputs: []
      }] })),
      approveTaskPlan: vi.fn().mockResolvedValue(["child"]),
      workerRoles: vi.fn(() => ["goal-worker"]),
      syncCheckpoint: vi.fn(),
      finishOutputReview: vi.fn()
    } satisfies TaskPlanHost;
    const controller = new TaskPlanController(host);
    const output = { id: "output", logicalOutput: ".tasks.json" } as ExecutionOutput;
    const execution = { workItemId: item.id } as Execution;

    await expect(controller.approveTaskPlan(output, execution, "/team")).resolves.toBe(1);
    expect(host.approveTaskPlan).toHaveBeenCalledWith(
      output.id,
      item.id,
      "plan",
      "work",
      "waiting",
      "review",
      [{
        key: "first",
        title: "First task",
        description: "Do the work",
        role: "goal-worker",
        effect: "prepare",
        inputs: []
      }]
    );
    expect(host.syncCheckpoint).toHaveBeenCalledWith(item.id);
    expect(host.finishOutputReview).toHaveBeenCalledWith(execution);
  });
});
