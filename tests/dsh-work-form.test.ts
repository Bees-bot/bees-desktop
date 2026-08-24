import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const client = readFileSync(new URL("../dsh-runtime/plugin/lib/client.js", import.meta.url), "utf8");

describe("New work form", () => {
  it("offers every process in the selected workspace", () => {
    expect(client).toContain(
      'const processes = data.processes.filter((process) => process.workspaceId === workspaceId);'
    );
  });
});
