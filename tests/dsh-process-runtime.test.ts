import { describe, expect, it } from "vitest";
import { ProcessRuntime } from "../dsh-runtime/plugin/lib/process-runtime.js";
import { NodeDatabase } from "./node-database.js";

function runtime(): { runtime: ProcessRuntime; database: NodeDatabase } {
  const database = new NodeDatabase();
  const at = "2026-01-01T00:00:00.000Z";
  database.connection.exec(`
    INSERT INTO organizations VALUES ('org', 'Org', '${at}', '${at}');
    INSERT INTO teams VALUES ('team', 'org', 'Team', NULL, '${at}', '${at}');
    INSERT INTO processes VALUES ('process', 'team', 'Process', '', NULL, '${at}', '${at}');
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

describe("DSH process runtime", () => {
  it("persists claims, waits, exact-once commands, and terminal moves", () => {
    const { runtime: process } = runtime();
    const claimed = process.command("org", "one", {
      type: "claim", machineId: "machine", executionId: "run"
    }) as { claim: { token: string }; phase: string };
    expect(claimed.phase).toBe("running");

    const waiting = process.command("org", "one", {
      type: "wait",
      kind: "external_event",
      reason: "approval",
      correlationKey: "approval-1",
      claimToken: claimed.claim.token,
      idempotencyKey: "wait-once"
    }) as { phase: string; revision: number };
    expect(waiting.phase).toBe("waiting");
    expect(process.command("org", "one", {
      type: "wait", kind: "external_event", reason: "duplicate", correlationKey: "approval-1",
      idempotencyKey: "wait-once"
    })).toMatchObject({ revision: waiting.revision });

    process.command("org", "one", { type: "external_event", correlationKey: "approval-1" });
    process.command("org", "one", { type: "move", targetStageId: "done" });
    expect(process.state("org", "one")).toMatchObject({ stageId: "done", phase: "ready" });
  });

  it("rejects dependency cycles and catches up one pending scheduled occurrence", () => {
    const { runtime: process } = runtime();
    process.command("org", "one", {
      type: "wait", kind: "dependency", reason: "two", dependencyWorkItemId: "two"
    });
    expect(() => process.command("org", "two", {
      type: "wait", kind: "dependency", reason: "one", dependencyWorkItemId: "one"
    })).toThrow("cycle");

    process.command("org", "two", {
      type: "upsert_schedule",
      schedule: {
        id: "hourly", name: "Hourly", recurrence: "hourly", mode: "run",
        timezone: "UTC", enabled: true, nextRunAt: "2026-01-01T00:00:00.000Z"
      }
    });
    const schedule = (process.state("org", "two") as { schedules: Array<{
      pending: boolean;
      nextRunAt: string;
      pendingOccurrenceId: string | null;
      concurrencyRule: string;
      catchUpBehavior: string;
    }> }).schedules[0]!;
    expect(schedule.pending).toBe(true);
    expect(schedule.pendingOccurrenceId).toMatch(/^hourly:/);
    expect(schedule.concurrencyRule).toBe("skip_if_running");
    expect(schedule.catchUpBehavior).toBe("latest");
    expect(Date.parse(schedule.nextRunAt)).toBeGreaterThan(Date.now());
  });

  it("persists archive state and archives descendants with their run", () => {
    const { runtime: process, database } = runtime();
    database.connection.prepare("UPDATE work_items SET parent_id = 'one' WHERE id = 'two'").run();
    process.command("org", "two", { type: "wait", kind: "manual", reason: "hold" });

    process.command("org", "one", { type: "archive" });

    expect(process.state("org", "one")).toMatchObject({ phase: "archived" });
    expect(process.state("org", "two")).toMatchObject({ phase: "archived" });
    expect(database.connection.prepare(
      "SELECT id FROM work_items WHERE archived_at IS NOT NULL ORDER BY id"
    ).all()).toEqual([{ id: "one" }, { id: "two" }]);

    process.command("org", "one", { type: "restore" });
    expect(process.state("org", "one")).toMatchObject({ phase: "ready" });
    expect(process.state("org", "two")).toMatchObject({ phase: "archived" });

    process.command("org", "two", { type: "restore" });
    expect(process.state("org", "two")).toMatchObject({ phase: "ready", waits: [] });
  });

  it("backfills archived runs created before archive state moved onto work items", () => {
    const { runtime: process, database } = runtime();
    database.connection.prepare("UPDATE work_items SET parent_id = 'one' WHERE id = 'two'").run();
    process.command("org", "one", { type: "archive" });
    database.connection.prepare("UPDATE work_items SET archived_at = NULL").run();

    new ProcessRuntime(database.connection);

    expect(database.connection.prepare(
      "SELECT id FROM work_items WHERE archived_at IS NOT NULL ORDER BY id"
    ).all()).toEqual([{ id: "one" }, { id: "two" }]);
  });
});
