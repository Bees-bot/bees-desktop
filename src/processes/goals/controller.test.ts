import { describe, expect, it, vi } from "vitest";
import type { Execution, ExecutionOutput, Process, WorkItem } from "../../domain.js";
import { goalsProcess } from "./definition.js";
import { GoalsController, type GoalsHost } from "./controller.js";

describe("Goals process controller", () => {
  it("owns task-plan approval", async () => {
    const stages = goalsProcess.definition.stages.map((name, position) => ({
      id: name.toLowerCase(),
      processId: "goals",
      name,
      position,
      completionRules: "",
      archivedAt: null
    }));
    const item = { id: "goal", processId: "goals" } as WorkItem;
    const process = { id: "goals", name: "Goals", stages } as Process;
    const host = {
      findWorkItem: vi.fn(() => item),
      findProcess: vi.fn(() => process),
      readOutput: vi.fn().mockResolvedValue('{"tasks":["First task"]}'),
      approveTaskPlan: vi.fn(),
      syncCheckpoint: vi.fn(),
      finishOutputReview: vi.fn()
    } satisfies GoalsHost;
    const controller = new GoalsController(host);
    const output = { id: "output", logicalOutput: ".tasks.json" } as ExecutionOutput;
    const execution = { workItemId: item.id } as Execution;

    await expect(controller.approveTaskPlan(output, execution, "/team")).resolves.toBe(1);
    expect(host.approveTaskPlan).toHaveBeenCalledWith(
      output.id,
      item.id,
      "plan",
      "waiting",
      [{ title: "First task", description: "" }]
    );
    expect(host.syncCheckpoint).toHaveBeenCalledWith(item.id);
    expect(host.finishOutputReview).toHaveBeenCalledWith(execution);
  });
});
