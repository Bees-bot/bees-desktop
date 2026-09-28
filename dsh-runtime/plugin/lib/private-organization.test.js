import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { ConnectedAccount } from "./connected-account.js";
import { ProcessRuntime } from "./process-runtime.js";
import { executionAccount } from "./product-commands.js";

test("private organizations run without accounts or team access grants", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`
      CREATE TABLE organizations (id TEXT PRIMARY KEY, personal INTEGER);
      CREATE TABLE teams (id TEXT PRIMARY KEY, organization_id TEXT);
      CREATE TABLE bees_connections (id TEXT, organization_id TEXT, account_user_id TEXT);
      CREATE TABLE bees_connection_teams (connection_id TEXT, team_id TEXT);
      CREATE TABLE bees_accounts (user_id TEXT, enabled INTEGER);
      CREATE TABLE workspaces (id TEXT, team_id TEXT, authority TEXT, status TEXT);
      CREATE TABLE recurring_work (id TEXT, workspace_id TEXT, source_work_item_id TEXT);
      CREATE TABLE work_items (id TEXT, account_user_id TEXT);
      INSERT INTO organizations VALUES ('private', 0), ('regular', 0);
      INSERT INTO teams VALUES ('private-team', 'private'), ('regular-team', 'regular');
      INSERT INTO workspaces VALUES ('private-space', 'private-team', 'local', 'active');
      INSERT INTO workspaces VALUES ('regular-space', 'regular-team', 'connected', 'active');
      INSERT INTO recurring_work VALUES ('private-schedule', 'private-space', NULL);
      INSERT INTO bees_accounts VALUES ('account', 1);
      INSERT INTO bees_connections VALUES ('connection', 'regular', 'account');
      INSERT INTO bees_connection_teams VALUES ('connection', 'regular-team');
    `);
    const connected = new ConnectedAccount(db, {});
    const runtime = Object.create(ProcessRuntime.prototype);
    runtime.database = db;
    assert.equal(executionAccount(db, "private-team", {}), null);
    assert.deepEqual(connected.claimScope("private-team"), { organizationId: "private", connectionId: null });
    assert.deepEqual(runtime.executorAccounts("private-schedule"), [""]);
    assert.equal(executionAccount(db, "regular-team", { connectionId: "connection" }), "account");
    assert.equal(connected.claimScope("regular-team"), null);
    db.prepare("DELETE FROM bees_connections").run();
    assert.throws(() => executionAccount(db, "regular-team", {}), /Choose an account/);
    assert.equal(connected.claimScope("regular-team"), null);
  } finally {
    db.close();
  }
});
