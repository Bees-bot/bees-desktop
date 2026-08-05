import { describe, expect, it } from "vitest";
import {
  parseTaskPlan,
  recoverGoalPlannerOutput
} from "../src/processes/goals/index.js";

const task = {
  key: "draft:v1",
  title: "Create the draft",
  description: "Write the approved draft.",
  role: "goal-worker",
  effect: "prepare" as const,
  inputs: ["brief.md"]
};

describe("goal task plans", () => {
  it("accepts only the strict executable-wave schema", () => {
    expect(parseTaskPlan(JSON.stringify({ tasks: [task] }))).toEqual([task]);
    expect(() => parseTaskPlan(JSON.stringify({ tasks: ["Create the draft"] }))).toThrow(
      "must be an object"
    );
    expect(() => parseTaskPlan(JSON.stringify({ tasks: [{ ...task, legacy: true }] }))).toThrow(
      "not supported"
    );
  });

  it("rejects invalid, duplicate, empty, and runaway plans", () => {
    expect(() => parseTaskPlan("not json")).toThrow("valid JSON");
    expect(() => parseTaskPlan('{"tasks":[]}')).toThrow("non-empty");
    expect(() => parseTaskPlan(JSON.stringify({ tasks: [task, task] }))).toThrow("unique");
    expect(() =>
      parseTaskPlan(JSON.stringify({ tasks: Array.from({ length: 26 }, (_, index) => ({
        ...task,
        key: String(index)
      })) }))
    ).toThrow("at most 25");
  });

  it("recovers only strict JSON or the exact Work control value", () => {
    expect(
      recoverGoalPlannerOutput({ text: `\`\`\`json\n${JSON.stringify({ tasks: [task] })}\n\`\`\`` })
    ).toEqual({ taskPlan: `${JSON.stringify({ tasks: [task] }, null, 2)}\n` });
    expect(recoverGoalPlannerOutput({ text: "Work" })).toEqual({ statusName: "Work" });
    expect(recoverGoalPlannerOutput({ text: "Here is a plan." })).toBeNull();
  });

  it("does not reinterpret Markdown as authorized work", () => {
    expect(recoverGoalPlannerOutput({
      text: "1. **Develop Strategy:** Define the audience and approach."
    })).toBeNull();
  });
});
