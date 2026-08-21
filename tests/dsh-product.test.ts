import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { ProcessRuntime } from "../dsh-runtime/plugin/lib/process-runtime.js";
import { BeesProduct, initializeProductDatabase } from "../dsh-runtime/plugin/lib/product.js";
import { NodeDatabase } from "./node-database.js";

describe("Bees DSH product plugin", () => {
  it("recreates old metadata with the final local ownership hierarchy", () => {
    const database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE teams (id TEXT PRIMARY KEY); INSERT INTO teams VALUES ('old-team')");
    initializeProductDatabase(database);
    expect(database.prepare(`
      SELECT o.name AS organization, t.name AS team, w.name AS workspace
      FROM organizations o JOIN teams t ON t.organization_id = o.id
      JOIN workspaces w ON w.team_id = t.id
    `).get()).toEqual({ organization: "Personal", team: "Personal", workspace: "My workspace" });
    expect(database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
        ('organization_memberships','team_memberships','team_locations','device_location_mappings')
      ORDER BY name
    `).all()).toEqual([
      { name: "device_location_mappings" }, { name: "organization_memberships" },
      { name: "team_locations" }, { name: "team_memberships" }
    ]);
    expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: 4 });
  });

  it("shares team locations across workspaces and owns private work, proposals, and schedules", async () => {
    const files = mkdtempSync(join(tmpdir(), "bees-product-"));
    const runRoot = mkdtempSync(join(tmpdir(), "bees-runs-"));
    writeFileSync(join(files, "brief.md"), "Honey launch requirements and milestones");
    const database = new NodeDatabase();
    const agents = new AgentRuntime({ on: () => () => undefined }, database.connection);
    const admissions: any[] = [];
    (agents as any).admit = async (...args: any[]) => { admissions.push(args); return { submissionId: "submission", uid: "uid" }; };
    const processes = new ProcessRuntime(database.connection);
    const product = new BeesProduct(database.connection, agents, processes, runRoot);
    await product.initialize();
    const initial = await product.snapshot();
    const workspace = initial.workspaces[0];
    const team = initial.teams[0];
    const goals = initial.processes.find(({ workspaceId, kind }: any) => workspaceId === workspace.id && kind === "goals");
    const plan = initial.stages.find(({ processId, name }: any) => processId === goals.id && name === "Plan");
    const doing = initial.stages.find(({ processId, name }: any) => processId === goals.id && name === "Doing");

    const created = await product.command({
      action: "create_goal", workspaceId: workspace.id, title: "Ship Stage 1",
      description: "Make DSH the product runtime"
    });
    expect((await product.snapshot()).items).toContainEqual(expect.objectContaining({
      id: created.id, stageId: plan.id, kind: "goal", title: "Ship Stage 1"
    }));

    await product.command({ action: "move_item", itemId: created.id, stageId: doing.id });
    await product.command({
      action: "upsert_schedule", itemId: created.id, name: "Daily follow-up",
      recurrence: "daily", timezone: "UTC", nextRunAt: "2099-01-01T00:00:00.000Z"
    });
    const location = await product.command({
      action: "add_location", teamId: team.id, name: "Work", kind: "folder", path: files
    });
    await expect(product.command({
      action: "attach_location", itemId: created.id, locationId: location.id, relativePath: "../outside"
    })).rejects.toThrow("cannot leave");
    await product.command({ action: "attach_location", itemId: created.id, locationId: location.id });

    const secondWorkspace = await product.command({ action: "create_workspace", teamId: team.id, name: "Campaigns" });
    const secondSnapshot = await product.snapshot();
    const secondGoals = secondSnapshot.processes.find(({ workspaceId, kind }: any) =>
      workspaceId === secondWorkspace.id && kind === "goals");
    const secondItem = await product.command({
      action: "create_goal", workspaceId: secondWorkspace.id, title: "Reuse team files"
    });
    await product.command({ action: "attach_location", itemId: secondItem.id, locationId: location.id });
    expect((await product.snapshot()).attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ workItemId: created.id, locationId: location.id }),
      expect.objectContaining({ workItemId: secondItem.id, locationId: location.id })
    ]));
    expect(secondGoals).toBeTruthy();

    const after = await product.snapshot();
    expect(after.schedules).toContainEqual(expect.objectContaining({
      workItemId: created.id, name: "Daily follow-up"
    }));
    expect(after.locations).toContainEqual(expect.objectContaining({
      teamId: team.id, name: "Work", localPath: realpathSync(files), mapped: true
    }));
    expect(product.search("Stage", workspace.id)).toContainEqual(expect.objectContaining({ id: created.id }));
    expect(product.search("Honey", workspace.id)).toContainEqual(expect.objectContaining({
      kind: "file", title: "Work/brief.md"
    }));

    const run = await product.command({ action: "run_item", itemId: created.id, model: "local-openai/default" });
    expect(admissions.at(-1)[0]).toBe("bees-run");
    expect(admissions.at(-1)[2].initialData.grants).toEqual([location.id]);
    expect(readFileSync(join(
      runRoot, "runs", run.executionId, "inputs", `Work-${location.id.slice(0, 8)}`, "brief.md"
    ), "utf8")).toContain("Honey launch");

    const newProcess = await product.command({
      action: "create_process", workspaceId: workspace.id, name: "Publishing", stages: ["Draft", "Published"]
    });
    const processSchedule = await product.command({
      action: "upsert_schedule", processId: newProcess.id, name: "Weekday publishing",
      recurrence: "weekdays", timezone: "UTC", nextRunAt: "2099-01-01T00:00:00.000Z"
    });
    await product.command({ action: "attach_location", processId: newProcess.id, locationId: location.id });
    await product.command({
      action: "edit_process", processId: newProcess.id, name: "Editorial",
      description: "Publish reviewed work", stages: ["Published", "Draft", "Review"]
    });
    expect((await product.snapshot()).processes).toContainEqual(expect.objectContaining({
      id: newProcess.id, workspaceId: workspace.id, name: "Editorial"
    }));
    expect((await product.snapshot()).schedules).toContainEqual(expect.objectContaining({
      targetKind: "process", processId: newProcess.id, name: "Weekday publishing"
    }));
    const scheduledRun = await product.command({
      action: "trigger_schedule", processId: newProcess.id,
      scheduleId: processSchedule.schedules[0].id
    });
    expect((await product.snapshot()).processAttachments).toContainEqual(expect.objectContaining({
      processId: newProcess.id, locationId: location.id
    }));
    expect(readFileSync(join(
      runRoot, "runs", scheduledRun.executionId, "inputs", `Work-${location.id.slice(0, 8)}`, "brief.md"
    ), "utf8")).toContain("Honey launch");

    const proposal = product.storeProposal({
      workspaceId: workspace.id, sessionId: "planning-session", title: "Launch plan", summary: "Visible work",
      changes: [
        { action: "create_goal", title: "Launch safely", description: "Review every handoff" },
        { action: "create_process", name: "Launch", description: "Repeatable release", stages: ["Plan", "Release"] }
      ]
    });
    await product.command({ action: "apply_proposal", proposalId: proposal.id });
    const applied = await product.snapshot();
    expect(applied.proposals).toContainEqual(expect.objectContaining({ id: proposal.id, status: "applied" }));
    expect(applied.items).toContainEqual(expect.objectContaining({ title: "Launch safely", kind: "goal" }));
    expect(applied.processes).toContainEqual(expect.objectContaining({ name: "Launch" }));

    rmSync(files, { recursive: true });
    rmSync(runRoot, { recursive: true });
  });
});
