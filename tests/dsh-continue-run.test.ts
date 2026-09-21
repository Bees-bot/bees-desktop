import { expect, it, vi } from "vitest";
// @ts-expect-error Plain JavaScript command boundary.
import { executeProductCommand } from "../dsh-runtime/plugin/lib/product-commands.js";
import { NodeDatabase } from "./node-database.js";

it("turns a message to a failed process into a retry with that message", async () => {
  const database = new NodeDatabase();
  try {
    const stage = database.connection.prepare(`
      SELECT s.id AS stageId, s.process_id AS processId, p.workspace_id AS workspaceId
      FROM stages s JOIN processes p ON p.id = s.process_id
      WHERE p.kind = 'goals' ORDER BY s.position LIMIT 1
    `).get() as any;
    database.connection.prepare(`
      INSERT INTO work_items
        (id, process_id, stage_id, title, description, runtime_phase, runtime_error, created_at, updated_at)
      VALUES ('failed-item', ?, ?, 'Failed item', '', 'failed', 'Provider unavailable', 'now', 'now')
    `).run(stage.processId, stage.stageId);
    database.connection.exec(`CREATE TABLE execution_links (
      execution_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, work_item_id TEXT,
      agent_name TEXT NOT NULL, current_session_id TEXT NOT NULL, instance_uid TEXT NOT NULL,
      run_directory TEXT NOT NULL, config_json TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT`);
    database.connection.prepare(`
      INSERT INTO execution_links
        (execution_id, workspace_id, work_item_id, agent_name, current_session_id, instance_uid,
         run_directory, config_json, status, created_at, updated_at)
      VALUES ('failed-run', ?, 'failed-item', 'agent', 'session', 'uid', '/tmp', ?, 'failed', 'now', 'now')
    `).run(stage.workspaceId, JSON.stringify({ workspaceId: stage.workspaceId }));
    const signal = vi.fn(async () => ({ id: "failed-item", runtimePhase: "running" }));
    const admit = vi.fn();

    await executeProductCommand.call({ database: database.connection, processes: { signal }, agents: { admit } },
      "continue_run", { executionId: "failed-run", text: "Use the backup provider" });

    expect(signal).toHaveBeenCalledWith("failed-item", "retry", "Use the backup provider");
    expect(admit).not.toHaveBeenCalled();
  } finally { database.connection.close(); }
});
