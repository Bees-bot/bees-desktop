import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workspace creation", () => {
  it("keeps private creation collapsed and requires both acknowledgements", () => {
    const views = readFileSync(new URL("../src/app-views.ts", import.meta.url), "utf8");
    const actions = readFileSync(new URL("../src/app-actions.ts", import.meta.url), "utf8");
    const session = readFileSync(new URL("../src/session-controller.ts", import.meta.url), "utf8");

    expect(views).toContain('data-action="create-workspace"');
    expect(views).not.toContain('data-action="create-local-org"');
    expect(views).not.toContain('data-action="create-connected-org"');
    expect(views).toContain("<div data-workspace-privacy");
    expect(views).toContain("Make this workspace private");
    expect(views).toContain("Keep it on this device only. You cannot add members later.");
    expect(session).toContain('type: "workspace-privacy"');
    expect(session).toContain('data.get("deviceOnly") === "true"');
  });
});
