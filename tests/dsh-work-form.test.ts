import { describe, expect, it } from "vitest";
import { clientSource as client } from "./client-source.js";

describe("New work form", () => {
  it("offers every process in the selected workspace", () => {
    expect(client).toContain(
      'const processes = data.processes.filter((process) => process.workspaceId === workspaceId);'
    );
  });

  it("creates work with multiple inputs and one optional output folder", () => {
    expect(client).toContain("inputLocationIds, outputLocationId");
    expect(client).toContain('h(ResourceFields, { ctx, data, teamId, act');
    expect(client).toContain('"Keep results in Bees only"');
    expect(client).toContain('Use process result folder');
    expect(client).toContain('"Save outputs to folder…"');
  });
});
