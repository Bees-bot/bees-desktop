import { describe, expect, it } from "vitest";
import {
  parseTaskPlan,
  recoverGoalPlannerOutput
} from "../src/processes/goals/index.js";

describe("goal task plans", () => {
  it("accepts concise strings and detailed tasks", () => {
    expect(
      parseTaskPlan(
        JSON.stringify({
          tasks: [
            "Create the draft",
            { title: "Review the draft", description: "Check every acceptance criterion." }
          ]
        })
      )
    ).toEqual([
      { title: "Create the draft", description: "" },
      { title: "Review the draft", description: "Check every acceptance criterion." }
    ]);
  });

  it("rejects invalid, empty, and runaway plans", () => {
    expect(() => parseTaskPlan("not json")).toThrow("valid JSON");
    expect(() => parseTaskPlan('{"tasks":[]}')).toThrow("non-empty");
    expect(() =>
      parseTaskPlan(JSON.stringify({ tasks: Array.from({ length: 26 }, () => "Task") }))
    ).toThrow("at most 25");
  });

  it("recovers planner control output returned as final text", () => {
    expect(
      recoverGoalPlannerOutput({
        text: '```json\n{"tasks":[{"title":"Draft","description":"Write it."}]}\n```'
      })
    ).toEqual({
      taskPlan:
        '{\n  "tasks": [\n    {\n      "title": "Draft",\n      "description": "Write it."\n    }\n  ]\n}\n'
    });
    expect(recoverGoalPlannerOutput({ text: "Work" })).toEqual({ statusName: "Work" });
    expect(recoverGoalPlannerOutput({ text: "Here is a plan." })).toBeNull();
  });

  it("recovers a clearly structured Markdown task breakdown", () => {
    const recovered = recoverGoalPlannerOutput({
      text: `### Proposed Task Breakdown

1.  **Develop Strategy:** Define the audience and approach.
2.  **Write Campaign:** Produce the approved campaign assets.

Please review this proposed breakdown.`
    });
    expect(JSON.parse(recovered?.taskPlan ?? "")).toEqual({
      tasks: [
        { title: "Develop Strategy", description: "Define the audience and approach." },
        { title: "Write Campaign", description: "Produce the approved campaign assets." }
      ]
    });
    expect(
      recoverGoalPlannerOutput({
        text: "1. **Valid:** First task.\n2. Missing bold structure."
      })
    ).toBeNull();
  });
});
