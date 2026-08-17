import { describe, expect, it } from "vitest";
import { PROCESS_LIBRARY, PROCESS_MODULES } from "./registry.js";
import { softwareProjectProcess } from "./software-project/definition.js";

describe("bundled process library", () => {
  it("contains complete, internally consistent process definitions", () => {
    expect(PROCESS_LIBRARY.some(({ id }) => id === "goals")).toBe(true);
    expect(PROCESS_MODULES.map(({ definition }) => definition)).toEqual(PROCESS_LIBRARY);
    expect(PROCESS_MODULES.filter(({ starter }) => starter)).toHaveLength(1);
    expect(new Set(PROCESS_LIBRARY.map(({ id }) => id)).size).toBe(PROCESS_LIBRARY.length);

    for (const entry of PROCESS_LIBRARY) {
      expect(entry.name.trim()).not.toBe("");
      expect(entry.version).toBeGreaterThan(0);
      expect(entry.states.length).toBeGreaterThan(0);
      expect(new Set(entry.states.map(({ key }) => key)).size).toBe(entry.states.length);
      for (const agent of entry.agents) {
        expect(entry.states.some(({ key }) => key === agent.state)).toBe(true);
        expect(agent.prompt.trim()).not.toBe("");
        expect(agent.provider.trim()).not.toBe("");
        expect(agent.model.trim()).not.toBe("");
      }
    }
  });

  it("enables Ponytail for the coding stages of the Code workflow", () => {
    const [requirements, ...codingAgents] = softwareProjectProcess.definition.agents;
    expect(requirements.skills).not.toContain("ponytail");
    expect(codingAgents.every(({ skills }) => skills.includes("ponytail"))).toBe(true);
  });
});
