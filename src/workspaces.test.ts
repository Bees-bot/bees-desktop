import { describe, expect, it } from "vitest";
import { inputAliases, stagedInputPath } from "./workspaces.js";

const location = { id: "3f0c1d2e-4a5b-4c6d-8e9f-0a1b2c3d4e5f", name: "Shared Drive" };

describe("Approved input aliases", () => {
  it("resolves every spelling a run shows an agent", () => {
    const aliases = inputAliases(["counter.txt"]);

    for (const spelling of [
      "counter.txt",
      "inputs/counter.txt",
      ".bees/inputs/counter.txt",
      "/workspace/inputs/counter.txt",
      "/workspace/.bees/inputs/counter.txt"
    ]) {
      expect(aliases.get(spelling)).toBe("counter.txt");
    }
  });

  it("resolves a linked file by the folder it is staged in", () => {
    const reference = `${location.id}::report.csv`;
    const staged = stagedInputPath(reference, [location]);

    expect(staged).toBe("locations/shared-drive-3f0c1d2e/report.csv");
    expect(inputAliases([reference], [location]).get(`inputs/${staged}`)).toBe(reference);
  });

  it("refuses a spelling two approved files share", () => {
    const linked = `${location.id}::report.csv`;
    const collision = "locations/shared-drive-3f0c1d2e/report.csv";
    const aliases = inputAliases([collision, linked], [location]);

    // Both files stage to the same path: resolving it either way could hand a task the wrong
    // file, so the planner is made to name one exactly.
    expect(aliases.has(collision)).toBe(false);
    expect(aliases.get(`inputs/${collision}`)).toBeUndefined();
  });
});
