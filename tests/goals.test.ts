import { describe, expect, it } from "vitest";
import {
  parseTaskPlan
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
});
