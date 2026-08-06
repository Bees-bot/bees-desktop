import { describe, expect, it } from "vitest";
import { firstTriggerConflict } from "../src/agent-files.js";

describe("agent trigger conflicts", () => {
  it("accepts a swap of two agents' statuses", () => {
    expect(
      firstTriggerConflict([
        { name: "Planner", triggerStageId: "build" },
        { name: "Coder", triggerStageId: "backlog" }
      ])
    ).toBeNull();
  });

  it("names both agents left on one status", () => {
    expect(
      firstTriggerConflict([
        { name: "Planner", triggerStageId: "backlog" },
        { name: "Coder", triggerStageId: "backlog" }
      ])
    ).toEqual({ first: "Planner", second: "Coder", triggerStageId: "backlog" });
  });

  it("ignores agents without a status and studio assignments", () => {
    expect(
      firstTriggerConflict([
        { name: "Planner", triggerStageId: null },
        { name: "Coder", triggerStageId: null },
        { name: "Architect", triggerStageId: "design", exempt: true },
        { name: "Reviewer", triggerStageId: "design", exempt: true }
      ])
    ).toBeNull();
  });
});
