import { describe, expect, it } from "vitest";
import { processDiagram } from "./process-diagram.js";

describe("process diagram", () => {
  it("shows every state without implying forced edges", () => {
    const diagram = processDiagram(["Plan", "Work", "Done"]);
    expect(diagram.startsWith("stateDiagram-v2")).toBe(true);
    expect(diagram).toContain('state "Plan" as s0');
    expect(diagram).toContain("[*] --> s0");
    expect(diagram).toContain("Any status may move to any valid status");
    expect(diagram).not.toContain("s0 --> s1");
  });

  it("keeps user stage names from breaking the diagram", () => {
    const diagram = processDiagram(['He said "go"', "Work"]);
    expect(diagram).toContain("state \"He said 'go'\" as s0");
    expect(diagram.split("\n").every((line) => !line.includes("\r"))).toBe(true);
  });

  it("renders empty for a process with no usable stages", () => {
    expect(processDiagram([])).toBe("");
    expect(processDiagram(["   "])).toBe("");
  });
});
