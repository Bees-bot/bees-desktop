import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("task actions", () => {
  it("keeps edit and archive on task cards and uses an archived switch", () => {
    const views = readFileSync(new URL("../src/app-views.ts", import.meta.url), "utf8");
    const actions = readFileSync(new URL("../src/app-actions.ts", import.meta.url), "utf8");
    const workspace = readFileSync(new URL("../src/workspace-controller.ts", import.meta.url), "utf8");
    const runtime = readFileSync(new URL("../flue-runtime/project/workflow/start.mjs", import.meta.url), "utf8");
    const workflow = readFileSync(new URL("../flue-runtime/project/workflow/work-item-workflow.ts", import.meta.url), "utf8");

    expect(views).toContain('actionIconButton("edit-item"');
    expect(views).toContain('actionIconButton("archive-item"');
    expect(views).toContain('icon("edit-item", `Edit ${item.title}`');
    expect(views).toContain('icon("archive-item", `Archive ${item.title}`');
    expect(actions).toContain('label: "Archived"');
    expect(actions).toContain('type: "switch"');
    expect(views).toContain("Active tasks");
    expect(views).not.toContain("Archived tasks (${archived.length})");
    expect(workspace).toContain(".filter(({ parentId }) => !parentId)");
    expect(actions).toContain('command(item.id, { type: "archive" })');
    expect(actions).toContain('activeExecutions.length ? "Stop and archive" : "Archive"');
    expect(actions).toContain("await host.runCoordinator.stop(execution.id)");
    expect(actions).toContain("The task will appear in Completed Runs with an Archived outcome.");
    expect(runtime).toContain("handle.signal(archiveStateSignal");
    expect(runtime).toContain("await handle.terminate(\"Recovering a task with invalid workflow history\")");
    expect(workflow).toContain("await condition(allHandlersFinished);\n    const now = Date.now();");
    expect(workflow).toContain("commands = CONTINUE_AFTER_COMMANDS");
  });

  it("adds dashboard tasks to the run currently being displayed", () => {
    const actions = readFileSync(new URL("../src/app-actions.ts", import.meta.url), "utf8");
    const views = readFileSync(new URL("../src/app-views.ts", import.meta.url), "utf8");

    expect(actions).toContain("await createItem(button.dataset.stage, host.shell.boardRootItemId)");
    expect(actions).toContain("createItem(rootId ? firstTaskStage : undefined, rootId)");
    expect(actions).toContain("...(parent ? { parentId: parent.id } : {})");
    expect(actions).toContain("host.shell.boardRootItemId = parent?.id ?? itemId");
    expect(actions).toContain("role: worker.role");
    expect(actions).toContain("effect: \"prepare\"");
    expect(views).toContain('name="workerRole"');
    expect(views).toContain("This process has no available worker");
  });

  it("shows claim ownership without editable owner fields", () => {
    const views = readFileSync(new URL("../src/app-views.ts", import.meta.url), "utf8");
    const actions = readFileSync(new URL("../src/app-actions.ts", import.meta.url), "utf8");

    expect(views).toContain("item.runtime?.claim");
    expect(views).toContain("Claimed by");
    expect(views).toContain("Human on another device");
    expect(views).not.toContain('name="owner"');
    expect(actions).not.toContain('name: "owner", label: "Owner"');
    expect(actions).not.toContain('owner: String(data.get("owner")');
  });

  it("offers library processes directly when creating a task", () => {
    const views = readFileSync(new URL("../src/app-views.ts", import.meta.url), "utf8");
    const actions = readFileSync(new URL("../src/app-actions.ts", import.meta.url), "utf8");

    expect(views).toContain('<optgroup label="Process Library">');
    expect(views).toContain("Team's custom processes");
    expect(actions).toContain("workflowId.startsWith(PROCESS_LIBRARY_SELECTION_PREFIX)");
    expect(actions).not.toContain('action === "add-library-process"');
    expect(views).not.toContain("Open board");
    expect(views).not.toContain("Bundled");
  });
});
