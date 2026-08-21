import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { ProcessRuntime } from "../dsh-runtime/plugin/lib/process-runtime.js";
import { NodeDatabase } from "./node-database.js";

function runtime(): { runtime: ProcessRuntime; database: NodeDatabase } {
  const database = new NodeDatabase();
  new AgentRuntime({ on: () => () => undefined }, database.connection);
  const at = "2026-01-01T00:00:00.000Z";
  database.connection.exec(`
    INSERT INTO workspaces (id, team_id, name, created_at, updated_at)
      SELECT 'org', id, 'Workspace', '${at}', '${at}' FROM teams ORDER BY created_at LIMIT 1;
    INSERT INTO processes (id, workspace_id, name, description, kind, created_at, updated_at)
      VALUES ('process', 'org', 'Process', '', 'standard', '${at}', '${at}');
    INSERT INTO stages VALUES ('ready', 'process', 'Ready', 0, '', 0, NULL);
    INSERT INTO stages VALUES ('done', 'process', 'Done', 1, '', 1, NULL);
    INSERT INTO work_items
      (id, process_id, stage_id, title, created_at, updated_at)
      VALUES ('one', 'process', 'ready', 'One', '${at}', '${at}');
    INSERT INTO work_items
      (id, process_id, stage_id, title, created_at, updated_at)
      VALUES ('two', 'process', 'ready', 'Two', '${at}', '${at}');
  `);
  return { runtime: new ProcessRuntime(database.connection), database };
}

describe("Bees process domain plugin", () => {
  it("moves work exactly once and rejects a stage from another process", () => {
    const { runtime: process, database } = runtime();
    const moved = process.command("org", "one", {
      type: "move", targetStageId: "done", idempotencyKey: "move-once"
    });
    expect(moved).toMatchObject({ stageId: "done", phase: "ready" });
    expect(process.command("org", "one", {
      type: "move", targetStageId: "ready", idempotencyKey: "move-once"
    })).toMatchObject({ stageId: "done" });

    database.connection.exec(`
      INSERT INTO processes (id, workspace_id, name, description, kind, created_at, updated_at)
        VALUES ('other', 'org', 'Other', '', 'standard', '2026-01-01', '2026-01-01');
      INSERT INTO stages VALUES ('other-stage', 'other', 'Other', 0, '', 0, NULL);
    `);
    expect(() => process.command("org", "one", {
      type: "move", targetStageId: "other-stage"
    })).toThrow("does not belong");
  });

  it("admits only the latest overdue occurrence and persists it until acknowledged", () => {
    const { runtime: process } = runtime();
    process.command("org", "two", {
      type: "upsert_schedule",
      schedule: {
        id: "hourly", name: "Hourly", recurrence: "hourly", timezone: "UTC",
        enabled: true, nextRunAt: "2026-01-01T00:00:00.000Z"
      }
    });
    const now = Date.parse("2026-01-01T03:30:00.000Z");
    const first = process.catchUpAll(now);
    expect(first).toHaveLength(1);
    const occurrence = first[0]!;
    expect(occurrence).toMatchObject({
      id: "hourly", workItemId: "two", occurrenceId: "hourly:2026-01-01T03:00:00.000Z"
    });
    expect(process.catchUpAll(now)[0]).toMatchObject({ occurrenceId: occurrence.occurrenceId });
    expect(Date.parse(String(process.state("org", "two").schedules[0].nextRunAt))).toBeGreaterThan(now);

    process.command("org", "two", {
      type: "ack_schedule", scheduleId: "hourly", occurrenceId: occurrence.occurrenceId,
      idempotencyKey: `schedule-ack:${occurrence.occurrenceId}`
    });
    expect(process.state("org", "two").schedules[0]).toMatchObject({
      pending: false, lastAdmittedOccurrenceId: occurrence.occurrenceId
    });
  });

  it("archives descendants, disables their schedules, and restores explicitly", () => {
    const { runtime: process, database } = runtime();
    database.connection.prepare("UPDATE work_items SET parent_id = 'one' WHERE id = 'two'").run();
    process.command("org", "two", {
      type: "upsert_schedule",
      schedule: {
        id: "daily", name: "Daily", recurrence: "daily", timezone: "UTC",
        enabled: true, nextRunAt: "2026-02-01T00:00:00.000Z"
      }
    });
    process.command("org", "one", { type: "archive" });
    expect(database.connection.prepare(
      "SELECT id FROM work_items WHERE archived_at IS NOT NULL ORDER BY id"
    ).all()).toEqual([{ id: "one" }, { id: "two" }]);
    expect(process.state("org", "two")).toMatchObject({
      phase: "archived", schedules: [expect.objectContaining({ enabled: false })]
    });

    process.command("org", "one", { type: "restore" });
    expect(process.state("org", "one").phase).toBe("ready");
    expect(process.state("org", "two").phase).toBe("archived");
  });

  it("skips a manual schedule trigger while that work item already has an active run", () => {
    const { runtime: process, database } = runtime();
    process.command("org", "two", {
      type: "upsert_schedule",
      schedule: {
        id: "daily", name: "Daily", recurrence: "daily", timezone: "UTC",
        enabled: true, nextRunAt: "2026-02-01T00:00:00.000Z"
      }
    });
    database.connection.prepare(`
      INSERT INTO execution_links
        (execution_id, workspace_id, work_item_id, agent_name, current_session_id,
         instance_uid, run_directory, config_json, status, created_at, updated_at)
      VALUES ('active', 'org', 'two', 'bees-run', 'active', 'uid', '/tmp/active', ?,
        'running', '2026-01-01', '2026-01-01')
    `).run(JSON.stringify({ workItemId: "two" }));

    const state = process.command("org", "two", { type: "trigger_schedule", scheduleId: "daily" });
    expect(state.schedules[0]).toMatchObject({ pending: false, pendingOccurrenceId: null });
  });

  it("persists process schedules as process targets and catches up the latest occurrence", () => {
    const { runtime: process } = runtime();
    process.scheduleCommand("org", "process", "process", {
      type: "upsert_schedule",
      schedule: {
        id: "process-daily", name: "Daily process", recurrence: "daily", timezone: "UTC",
        enabled: true, nextRunAt: "2026-01-01T00:00:00.000Z"
      }
    });
    expect(process.allSchedules(["org"])).toContainEqual(expect.objectContaining({
      id: "process-daily", targetKind: "process", processId: "process", workspaceId: "org"
    }));
    expect(process.catchUpAll(Date.parse("2026-01-03T12:00:00.000Z"))).toContainEqual(
      expect.objectContaining({
        id: "process-daily", targetKind: "process", targetId: "process",
        occurrenceId: "process-daily:2026-01-03T00:00:00.000Z"
      })
    );
  });
});
