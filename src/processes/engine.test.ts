import { describe, expect, it } from "vitest";
import type { Agent, Process, WorkItem } from "../domain.js";
import { processEngine } from "./registry.js";
import { softwareProjectProcess } from "./software-project/definition.js";
import { persistProcessDefinition } from "./types.js";

const stateIds = {
  requirements: "requirements-id",
  architecture: "architecture-id",
  plan: "plan-id",
  implement: "implement-id",
  "phase-review": "phase-review-id",
  "final-review": "final-review-id",
  done: "done-id"
};

const process = {
  id: "installed-code",
  name: "Renamed code process",
  tags: [],
  updatedAt: "2026-01-01T00:00:00.000Z",
  definition: persistProcessDefinition(softwareProjectProcess.definition, stateIds),
  stages: [
    { id: "requirements-id", name: "Intake", position: 0 },
    { id: "architecture-id", name: "Design", position: 1 },
    { id: "plan-id", name: "Outline", position: 2 },
    { id: "implement-id", name: "Build", position: 3 },
    { id: "phase-review-id", name: "Phase signoff", position: 4 },
    { id: "final-review-id", name: "Launch signoff", position: 5 },
    { id: "done-id", name: "Shipped", position: 6 }
  ]
} as unknown as Process;

describe("process engine", () => {
  it("uses database IDs while allowing any installed state as the target", () => {
    expect(processEngine.definition(process).stateIds).toEqual(stateIds);
    expect(processEngine.target(process, "requirements")).toBeUndefined();
    expect(processEngine.target(process, "requirements-id")?.id).toBe("requirements-id");
    expect(processEngine.target(process, "Shipped")).toBeUndefined();
    expect(processEngine.target(process, "missing")).toBeUndefined();
  });

  it("uses board order only when no state was requested", () => {
    const item = { stageId: "requirements-id" } as WorkItem;
    expect(processEngine.resolveTarget(process, item)?.id).toBe("architecture-id");
    expect(processEngine.resolveTarget(process, item, "done-id")?.id).toBe("done-id");
  });

  it("uses installed agent bindings when users customize them", () => {
    const agent = {
      id: "custom-architect",
      name: "Custom architect",
      purpose: "Test customized bindings",
      description: "",
      triggerStageId: "requirements-id",
      config: { role: "custom-role", prompt: "" },
      updatedAt: "2026-01-01T00:00:00.000Z"
    } satisfies Agent;
    expect(processEngine.definition(process, [agent]).roleBindings).toEqual([
      { role: "custom-role", stageId: "requirements-id" }
    ]);
  });

  it("allows several agents only on statuses with several roles", () => {
    expect(processEngine.allowsMultipleAgents(process, "requirements-id")).toBe(false);
    expect(processEngine.allowsMultipleAgents(process, "architecture-id")).toBe(true);
    expect(processEngine.allowsMultipleAgents(process, "missing")).toBe(false);
  });
});
