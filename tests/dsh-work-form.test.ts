import { describe, expect, it } from "vitest";
import { clientSource as client } from "./client-source.js";

describe("New work form", () => {
  it("offers every process in the selected workspace", () => {
    expect(client).toContain(
      'const processes = data.processes.filter((process) => process.workspaceId === workspaceId);'
    );
  });
});
