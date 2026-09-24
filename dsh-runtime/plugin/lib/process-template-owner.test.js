import Database from "better-sqlite3";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeProductDatabase } from "./product-database.js";
import { executeProductCommand } from "./product-commands.js";

test("process templates retain their owner", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "bees-template-owner-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  process.env.BEES_APP_DATA = process.env.BEES_DATA_DIR = process.env.BEES_STATE_DIR = directory;
  process.env.BEES_DATABASE_PATH = join(directory, "bees.sqlite");
  writeFileSync(join(directory, "device-id"), "test-device");
  const database = new Database(":memory:");
  initializeProductDatabase(database);
  const { id: workspaceId } = database.prepare("SELECT id FROM workspaces LIMIT 1").get();
  const { id } = await executeProductCommand.call({ database }, "create_process_template", {
    workspaceId, name: "Owned template", stages: ["Draft", "Done"], accountUserId: "owner-1"
  });

  assert.equal(database.prepare("SELECT account_user_id FROM process_templates WHERE id = ?").get(id).account_user_id, "owner-1");
  database.close();
});
