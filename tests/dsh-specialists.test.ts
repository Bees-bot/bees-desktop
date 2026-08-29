import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { itemContext } from "../dsh-runtime/plugin/lib/product-database.js";
import { resolveStageAgent } from "../dsh-runtime/plugin/lib/product-routing.js";
import { NodeDatabase } from "./node-database.js";

describe("recurring-work specialists", () => {
  it("learns inside one recurring work without changing the base agent or another schedule", () => {
    const database = new NodeDatabase().connection;
    database.exec("CREATE TABLE execution_links (execution_id TEXT PRIMARY KEY, status TEXT)");
    const process = database.prepare(`
      SELECT id, workspace_id AS workspaceId FROM processes WHERE kind = 'goals'
    `).get() as any;
    const stage = database.prepare(`
      SELECT id FROM stages WHERE process_id = ? AND driver = 'agent'
    `).get(process.id) as any;
    const agent = database.prepare(`
      SELECT id FROM agent_assignments WHERE workspace_id = ? AND system_role = 'worker'
    `).get(process.workspaceId) as any;
    database.prepare("UPDATE agent_assignments SET instructions = 'General research standards' WHERE id = ?").run(agent.id);
    const at = new Date().toISOString();
    const insertItem = database.prepare(`
      INSERT INTO work_items
        (id, process_id, stage_id, kind, title, recurring_work_id, created_at, updated_at)
      VALUES (?, ?, ?, 'run', ?, ?, ?, ?)
    `);
    const schedules: Array<[string, string]> = [["news", "Daily news"], ["competitors", "Competitor pulse"]];
    for (const [id, name] of schedules) {
      database.prepare(`
        INSERT INTO recurring_work
          (id, workspace_id, process_id, source_work_item_id, name, schedule_kind,
           schedule_json, temporal_schedule_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'interval', '{"everyMinutes":60,"anchorUtc":"2026-01-01T00:00:00.000Z"}',
          ?, 'active', ?, ?)
      `).run(id, process.workspaceId, process.id, `source-${id}`, name, `bees/recurring/${id}`, at, at);
      insertItem.run(`first-${id}`, process.id, stage.id, name, id, at, at);
    }

    const first = resolveStageAgent(database, {
      executionId: randomUUID(), item: itemContext(database, "first-news"),
      stageId: stage.id, purpose: "worker"
    });
    expect(first.instructions).toBe("General research standards");
    database.prepare(`
      UPDATE agent_specializations SET playbook = '- Prefer primary local sources', revision = 1 WHERE id = ?
    `).run(first.specializationId);
    insertItem.run("second-news", process.id, stage.id, "Daily news", "news", at, at);
    const learned = resolveStageAgent(database, {
      executionId: randomUUID(), item: itemContext(database, "second-news"),
      stageId: stage.id, purpose: "worker"
    });
    const separate = resolveStageAgent(database, {
      executionId: randomUUID(), item: itemContext(database, "first-competitors"),
      stageId: stage.id, purpose: "worker"
    });

    expect(learned.instructions).toContain("Prefer primary local sources");
    expect(separate.instructions).toBe("General research standards");
    expect(separate.specializationId).not.toBe(learned.specializationId);
    expect(database.prepare("SELECT instructions FROM agent_assignments WHERE id = ?").get(agent.id))
      .toEqual({ instructions: "General research standards" });
  });
});
