import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = mkdtempSync(join(tmpdir(), "bees-schedule-check-"));
for (const name of ["BEES_APP_DATA", "BEES_DATA_DIR", "BEES_STATE_DIR"]) process.env[name] = root;
process.env.BEES_DEFAULT_WORKSPACE = root;
writeFileSync(join(root, "device-id"), "schedule-check-device");

try {
  const { initializeProductDatabase } = await import("../dsh-runtime/plugin/lib/product-database.js");
  const { executeProductCommand } = await import("../dsh-runtime/plugin/lib/product-commands.js");
  const migrated = new DatabaseSync(":memory:");
  migrated.exec(`
    PRAGMA user_version = 17;
    CREATE TABLE recurring_work (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, process_id TEXT NOT NULL,
      source_work_item_id TEXT NOT NULL, name TEXT NOT NULL,
      schedule_kind TEXT NOT NULL, schedule_json TEXT NOT NULL, timezone TEXT,
      temporal_schedule_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
      next_run_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, name)
    ) STRICT;
  `);
  initializeProductDatabase(migrated);
  assert(migrated.prepare("PRAGMA table_info(recurring_work)").all().some(({ name }) => name === "origin_work_item_id"));
  migrated.close();

  const database = new DatabaseSync(":memory:");
  initializeProductDatabase(database);
  const process = database.prepare("SELECT id, workspace_id AS workspaceId FROM processes WHERE kind = 'goals'").get();
  const stage = database.prepare("SELECT id FROM stages WHERE process_id = ? ORDER BY position LIMIT 1").get(process.id);
  const itemId = "schedule-origin";
  const at = new Date().toISOString();
  database.prepare(`
    INSERT INTO work_items (id, process_id, stage_id, kind, title, description, created_at, updated_at)
    VALUES (?, ?, ?, 'goal', 'Morning brief', 'Prepare the brief.', ?, ?)
  `).run(itemId, process.id, stage.id, at, at);

  const created = await executeProductCommand.call({
    database,
    processes: { isAutomatic: () => true, createRecurring: async () => ({ nextRunAt: "2026-09-24T03:15:00.000Z" }) }
  }, "create_recurring_work", {
    workspaceId: process.workspaceId, itemId, name: "Daily brief",
    frequency: "daily", hour: 9, minute: 0, timezone: "Asia/Kathmandu"
  });

  const recurring = database.prepare("SELECT origin_work_item_id AS originWorkItemId FROM recurring_work WHERE id = ?").get(created.id);
  const definition = database.prepare("SELECT recurring_work_id AS recurringWorkId FROM work_items WHERE id = ?").get(created.sourceWorkItemId);
  assert.equal(recurring.originWorkItemId, itemId);
  assert.equal(definition.recurringWorkId, created.id);
  console.log("Schedule consistency check passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
