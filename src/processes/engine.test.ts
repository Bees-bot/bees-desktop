import { describe, expect, it } from "vitest";
import type { Agent, Process, WorkItem } from "../domain.js";
import { processEngine } from "./registry.js";

const process = {
  id: "installed-code",
  name: "Renamed code process",
  tags: ["module:software-project"],
  updatedAt: "2026-01-01T00:00:00.000Z",
  stages: [
    { id: "requirements-id", name: "Intake", position: 0 },
    { id: "architecture-id", name: "Design", position: 1 },
    { id: "plan-id", name: "Outline", position: 2 },
    { id: "implement-id", name: "Build", position: 3 },
    { id: "phase-review-id", name: "Phase signoff", position: 4 },
    { id: "final-review-id", name: "Launch signoff", position: 5 },
    { id: "done-id", name: "Shipped", position: 6 },
    { id: "blocked-id", name: "Stuck", position: 7 }
  ]
} as Process;

describe("process engine", () => {
  it("keeps semantic keys while allowing any installed state as the target", () => {
    expect(processEngine.definition(process).states.map(({ key }) => key)).toEqual([
      "requirements",
      "architecture",
      "plan",
      "implement",
      "phase-review",
      "final-review",
      "done",
      "blocked"
    ]);
    expect(processEngine.target(process, "requirements")?.id).toBe("requirements-id");
    expect(processEngine.target(process, "Shipped")?.id).toBe("done-id");
    expect(processEngine.target(process, "missing")).toBeUndefined();
  });

  it("uses board order only when no state was requested", () => {
    const item = { stageId: "requirements-id" } as WorkItem;
    expect(processEngine.resolveTarget(process, item)?.id).toBe("architecture-id");
    expect(processEngine.resolveTarget(process, item, "Shipped")?.id).toBe("done-id");
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
      { role: "custom-role", stateKey: "requirements" }
    ]);
  });
});
