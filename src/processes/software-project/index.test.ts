import { describe, expect, it } from "vitest";
import type { WorkItem } from "../../domain.js";
import {
  SOFTWARE_PROJECT_QUESTIONS,
  emptySoftwareProjectState,
  parseImplementationPlan,
  routeSoftwareProject,
  softwareProjectView
} from "./index.js";
import {
  SoftwareProjectController,
  type SoftwareProjectHost
} from "./controller.js";

describe("software project router", () => {
  it("requires each approval gate", () => {
    expect(routeSoftwareProject("Requirements", "requirements-approved")).toBe("Architecture");
    expect(routeSoftwareProject("Architecture", "architecture-approved")).toBe("Plan");
    expect(routeSoftwareProject("Plan", "plan-approved")).toBe("Implement");
    expect(routeSoftwareProject("Implement", "tests-passed")).toBe("Phase Review");
    expect(routeSoftwareProject("Phase Review", "phase-approved", true)).toBe("Implement");
    expect(routeSoftwareProject("Phase Review", "phase-approved", false)).toBe("Final Review");
    expect(routeSoftwareProject("Final Review", "final-tests-passed")).toBe("Done");
  });

  it("rejects impossible transitions", () => {
    expect(() => routeSoftwareProject("Requirements", "plan-approved")).toThrow();
  });
});

describe("software project module contract", () => {
  it("claims only its own process and Studio forms", () => {
    const controller = new SoftwareProjectController({} as SoftwareProjectHost);
    const form = {
      matches: (selector: string) => selector.includes("form[data-project-plan]")
    } as HTMLFormElement;
    expect(controller.matches("Software Project")).toBe(true);
    expect(controller.matches("Goals")).toBe(false);
    expect(controller.handlesSubmit(form)).toBe(true);
  });

  it("collects requirements for new and continued software work", () => {
    const changeType = SOFTWARE_PROJECT_QUESTIONS.find(({ id }) => id === "changeType");
    expect(changeType && "options" in changeType ? changeType.options : []).toEqual(
      expect.arrayContaining(["New project", "Bug fix", "New feature", "Refactor"])
    );
    expect(SOFTWARE_PROJECT_QUESTIONS.some(({ id }) => id === "preserve")).toBe(true);
  });

  it("requires one local project folder before requirements", () => {
    const view = softwareProjectView({
      item: { title: "Change the app" } as WorkItem,
      stage: "Requirements",
      state: emptySoftwareProjectState(),
      runs: [],
      mapping: null,
      git: null
    });
    expect(view).toContain('data-action="project-select-folder"');
    expect(view).not.toContain("data-project-requirements");
  });
});

describe("implementation plan parser", () => {
  it("accepts reviewable structured phases", () => {
    expect(
      parseImplementationPlan(JSON.stringify({
        phases: [{
          id: "phase-01",
          title: "Foundation",
          outcome: "The app starts",
          acceptanceCriteria: ["Build passes"],
          estimatedChangedLines: 700
        }]
      }))[0]
    ).toMatchObject({ id: "phase-01", estimatedChangedLines: 700 });
  });

  it("rejects phases a human cannot verify", () => {
    expect(() => parseImplementationPlan('{"phases":[{"title":"Mystery"}]}')).toThrow();
  });
});
