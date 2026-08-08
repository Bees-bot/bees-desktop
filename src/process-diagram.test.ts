import { describe, expect, it } from "vitest";
import { processDiagram } from "./process-diagram.js";
import {
  SOFTWARE_PROJECT_STAGES,
  softwareProjectTransitions
} from "./processes/software-project/index.js";

describe("process diagram", () => {
  it("walks a process that declared no transitions forward in board order", () => {
    const diagram = processDiagram(["Plan", "Work", "Done"]);
    expect(diagram.startsWith("stateDiagram-v2")).toBe(true);
    expect(diagram).toContain('state "Plan" as s0');
    expect(diagram).toContain("[*] --> s0");
    expect(diagram).toContain("  s0 --> s1");
    expect(diagram).toContain("  s1 --> s2");
    expect(diagram).not.toContain("s2 --> ");
  });

  it("draws declared transitions instead of the board order, and labels them", () => {
    const diagram = processDiagram(
      ["Plan", "Work", "Review"],
      [
        { from: "Plan", on: "approved", to: "Work" },
        { from: "Review", on: "rejected", to: "Plan" }
      ]
    );
    expect(diagram).toContain("  s0 --> s1 : approved");
    expect(diagram).toContain("  s2 --> s0 : rejected");
    // Board order is not drawn once transitions exist, so Work -> Review is absent.
    expect(diagram).not.toContain("  s1 --> s2");
  });

  it("skips an edge naming a stage the process no longer has", () => {
    const diagram = processDiagram(
      ["Plan", "Work"],
      [
        { from: "Plan", on: "approved", to: "Work" },
        { from: "Work", on: "archived", to: "Retired" }
      ]
    );
    expect(diagram).toContain("  s0 --> s1 : approved");
    expect(diagram).not.toContain("archived");
  });

  it("keeps user stage names from breaking the diagram", () => {
    const diagram = processDiagram(
      ['He said "go"', "Work"],
      [{ from: 'He said "go"', on: "on: two\nlines", to: "Work" }]
    );
    expect(diagram).toContain("state \"He said 'go'\" as s0");
    expect(diagram).toContain("  s0 --> s1 : on two lines");
    expect(diagram.split("\n").every((line) => !line.includes("\r"))).toBe(true);
  });

  it("matches stage names case-insensitively, the way stage lookup already does", () => {
    const diagram = processDiagram(["Plan", "Work"], [{ from: "plan", on: "go", to: "WORK" }]);
    expect(diagram).toContain("  s0 --> s1 : go");
  });

  it("renders empty for a process with no usable stages", () => {
    expect(processDiagram([])).toBe("");
    expect(processDiagram(["   "])).toBe("");
  });

  it("draws the Code process from its router table, guarded edge included", () => {
    const diagram = processDiagram(SOFTWARE_PROJECT_STAGES, softwareProjectTransitions());
    const index = (name: string) => SOFTWARE_PROJECT_STAGES.indexOf(name as never);
    const phaseReview = `s${index("Phase Review")}`;
    expect(diagram).toContain(`  s${index("Plan")} --> s${index("Implement")} : plan-approved`);
    expect(diagram).toContain(
      `  ${phaseReview} --> s${index("Final Review")} : phase-approved [last phase]`
    );
    expect(diagram).toContain(`  ${phaseReview} --> s${index("Implement")} : phase-approved`);
    expect(diagram).toContain(`  s${index("Done")} --> s${index("Blocked")} : blocked`);
    expect(diagram).toContain(`  s${index("Blocked")} --> s${index("Implement")} : resume`);
  });
});
