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
    expect(views).toContain("<details data-workspace-privacy");
    expect(views).not.toContain("<details open data-workspace-privacy");
    expect(views).toContain("I acknowledge I won’t be able to add team members.");
    expect(views).toContain("I acknowledge I won’t be able to convert this workspace later.");
    expect(actions).toContain("saveButton.disabled = enabled && !acknowledgementBoxes.every");
    expect(session).toContain('type: "workspace-privacy"');
    expect(session).toContain('data.get("deviceOnly") === "true"');
    expect(session).toContain('data.get("acknowledgeNoMembers") !== "true"');
    expect(session).toContain('data.get("acknowledgeNoConversion") !== "true"');
  });
});
