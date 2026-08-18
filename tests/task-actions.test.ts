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
    expect(views).toContain('data-action="archive-item" data-id="${host.shell.escapeHtml(root.id)}"');
    expect(actions).toContain('label: "Archived"');
    expect(actions).toContain('type: "switch"');
    expect(actions).toContain('name: "stageId"');
    expect(actions).toContain('label: "Status"');
    expect(actions).toContain('{ type: "move", targetStageId: stageId }');
    expect(views).toContain('data-action="edit-item" data-id="${host.shell.escapeHtml(item.id)}">Change</button>');
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
    expect(actions).toContain("host.shell.newItemStageId = stageId ?? \"\"");
    expect(actions).toContain("createItem(rootId ? process?.stages[0]?.id : undefined, rootId)");
    expect(actions).not.toContain("plannedWorkStage");
    expect(actions).toContain("...(parent ? { parentId: parent.id } : {})");
    expect(actions).toContain("host.shell.boardRootItemId = parent?.id ?? itemId");
    expect(actions).toContain("role: worker.role");
    expect(actions).toContain("effect: \"prepare\"");
    expect(views).toContain("plannedStages?.work.id === host.shell.newItemStageId");
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

  it("keeps rejection feedback explicit and scoped", () => {
    const actions = readFileSync(new URL("../src/app-actions.ts", import.meta.url), "utf8");
    const runs = readFileSync(new URL("../src/run-controller.ts", import.meta.url), "utf8");

    expect(actions).toContain('label: "What should be different next time?"');
    expect(actions).toContain('"Retry this task"');
    expect(actions).toContain('label: "Standing rule for future tasks"');
    expect(actions).toContain('edit("Make a standing rule"');
    expect(actions).toContain('await host.runs.rememberRejection(item, standingRule)');
    expect(actions).toContain('Archive the task instead if it should not run again.');
    expect(actions).toContain('it will not repeat automatically.');
    expect(runs).toContain("async function attachTeamSkill");
    expect(runs).toContain("output.logicalDestination.slice(TEAM_SKILLS_OUTPUT_PREFIX.length)");
  });

  it("edits an existing schedule without resetting its identity or paused state", () => {
    const actions = readFileSync(new URL("../src/app-actions.ts", import.meta.url), "utf8");

    expect(actions).toContain('action === "new-schedule" || action === "edit-schedule"');
    expect(actions).toContain('id: schedule?.id ?? crypto.randomUUID()');
    expect(actions).toContain('enabled: schedule?.enabled ?? true');
    expect(actions).toContain('schedule.workItemId !== workItemId');
    expect(actions).toContain('type: "delete_schedule"');
  });

  it("schedules the current board run again without occurrence choices", () => {
    const views = readFileSync(new URL("../src/app-views.ts", import.meta.url), "utf8");
    const actions = readFileSync(new URL("../src/app-actions.ts", import.meta.url), "utf8");

    expect(views).toContain("Schedule new recurring run");
    expect(views).toContain('data-action="new-schedule"${root ? ` data-id="${host.shell.escapeHtml(root.id)}"`');
    expect(views).toContain('<span>Scheduled tasks</span>');
    expect(views).not.toContain('<span>Schedules</span>');
    expect(actions).toContain('value: schedule?.workItemId ?? requestedItem?.id');
    expect(actions).toContain('mode: "run"');
    expect(actions).not.toContain('label: "On each occurrence"');
    expect(actions).not.toContain('label: "Occurrence worker role"');
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
