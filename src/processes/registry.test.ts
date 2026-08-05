import { describe, expect, it } from "vitest";
import { PROCESS_LIBRARY, PROCESS_MODULES } from "./registry.js";

describe("bundled process library", () => {
  it("contains complete, internally consistent process definitions", () => {
    expect(PROCESS_LIBRARY.some(({ id }) => id === "goals")).toBe(true);
    expect(PROCESS_MODULES.map(({ definition }) => definition)).toEqual(PROCESS_LIBRARY);
    expect(PROCESS_MODULES.filter(({ starter }) => starter)).toHaveLength(1);
    expect(new Set(PROCESS_LIBRARY.map(({ id }) => id)).size).toBe(PROCESS_LIBRARY.length);

    for (const entry of PROCESS_LIBRARY) {
      expect(entry.name.trim()).not.toBe("");
      expect(entry.stages.length).toBeGreaterThan(0);
      expect(new Set(entry.stages).size).toBe(entry.stages.length);
      for (const agent of entry.agents) {
        expect(entry.stages).toContain(agent.stage);
        expect(agent.prompt.trim()).not.toBe("");
        expect(agent.provider.trim()).not.toBe("");
        expect(agent.model.trim()).not.toBe("");
      }
    }
  });
});
