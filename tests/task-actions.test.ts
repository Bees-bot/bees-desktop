import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("task actions", () => {
  it("keeps edit and archive on task cards and uses an archived switch", () => {
    const views = readFileSync(new URL("../src/app-views.ts", import.meta.url), "utf8");
    const actions = readFileSync(new URL("../src/app-actions.ts", import.meta.url), "utf8");
    const workspace = readFileSync(new URL("../src/workspace-controller.ts", import.meta.url), "utf8");

    expect(views).toContain('actionIconButton("edit-item"');
    expect(views).toContain('actionIconButton("archive-item"');
    expect(views).toContain('icon("edit-item", `Edit ${item.title}`');
    expect(views).toContain('icon("archive-item", `Archive ${item.title}`');
    expect(views).toContain('type="checkbox" name="archived" value="archived"');
    expect(views).toContain('type="checkbox" name="${host.shell.escapeHtml(name)}" value="archived"');
    expect(actions).toContain('label: "Archived"');
    expect(actions).toContain('type: "switch"');
    expect(views).toContain("Archived tasks (${archived.length})");
    expect(workspace).toContain(".filter(({ parentId }) => !parentId)");
    expect(actions).toContain('command(item.id, { type: "archive" })');
  });
});
