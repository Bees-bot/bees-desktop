import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { applyTeamRecords, teamRecords } from "../dsh-runtime/plugin/lib/team-sync.js";
import { NodeDatabase } from "./node-database.js";

function addTeam(database: NodeDatabase, organizationId: string, teamId: string, workspaceId?: string) {
  const at = "2026-08-29T12:00:00.000Z";
  const userId = String(database.connection.prepare("SELECT id FROM users LIMIT 1").get()!.id);
  database.connection.prepare(`INSERT INTO organizations VALUES (?, 'Acme', 0, ?, 'active', ?, ?)`)
    .run(organizationId, userId, at, at);
  database.connection.prepare("INSERT INTO organization_memberships VALUES (?, ?, 'owner', 'active', ?)")
    .run(userId, organizationId, at);
  database.connection.prepare(`INSERT INTO teams VALUES (?, ?, 'Executive', 0, ?, 'active', ?, ?)`)
    .run(teamId, organizationId, userId, at, at);
  database.connection.prepare("INSERT INTO team_memberships VALUES (?, ?, 'admin', 'active', ?)")
    .run(userId, teamId, at);
  if (workspaceId) database.connection.prepare(`
    INSERT INTO workspaces VALUES (?, ?, NULL, 'Default workspace', 'connected', 'device', 'active', ?, ?)
  `).run(workspaceId, teamId, at, at);
}

describe("team coordination projection", () => {
  it("moves runnable team metadata without local paths or document content", () => {
    const source = new NodeDatabase();
    const target = new NodeDatabase();
    const organizationId = randomUUID();
    const teamId = randomUUID();
    const workspaceId = randomUUID();
    const targetWorkspaceId = randomUUID();
    const locationId = randomUUID();
    const agentId = randomUUID();
    const poolId = randomUUID();
    const processId = randomUUID();
    const workStageId = randomUUID();
    const doneStageId = randomUUID();
    const recurringId = randomUUID();
    const itemId = randomUUID();
    const at = "2026-08-29T12:00:00.000Z";
    addTeam(source, organizationId, teamId, workspaceId);
    addTeam(target, organizationId, teamId, targetWorkspaceId);

    source.connection.prepare("INSERT INTO team_locations VALUES (?, ?, ?, 'Drive', 'folder', '', NULL, ?, ?)")
      .run(locationId, teamId, randomUUID(), at, at);
    const deviceId = String(source.connection.prepare("SELECT id FROM devices LIMIT 1").get()!.id);
    source.connection.prepare("INSERT INTO device_location_mappings VALUES (?, ?, '/secret/company', ?)")
      .run(locationId, deviceId, at);
    const targetLocationId = randomUUID();
    const targetDeviceId = String(target.connection.prepare("SELECT id FROM devices LIMIT 1").get()!.id);
    target.connection.prepare("INSERT INTO team_locations VALUES (?, ?, ?, 'Drive', 'folder', '', NULL, ?, ?)")
      .run(targetLocationId, teamId, randomUUID(), at, at);
    target.connection.prepare("INSERT INTO device_location_mappings VALUES (?, ?, '/local/company', ?)")
      .run(targetLocationId, targetDeviceId, at);
    source.connection.prepare(`
      INSERT INTO agent_assignments
        (id, workspace_id, preset_id, name, description, instructions, model, reasoning_effort,
         system_role, capabilities_json, enabled, max_concurrency, mcp_access, mcp_servers_json,
         created_at, updated_at)
      VALUES (?, ?, 'standard', 'Bees work agent', '', 'Use approved sources', NULL, NULL, 'worker',
        '["research"]', 1, 1, 'none', '[]', ?, ?)
    `).run(agentId, workspaceId, at, at);
    const targetAgentId = randomUUID();
    const targetProcessId = randomUUID();
    const targetStageId = randomUUID();
    target.connection.prepare(`
      INSERT INTO agent_assignments
        (id, workspace_id, preset_id, name, description, instructions, model, reasoning_effort,
         system_role, capabilities_json, enabled, max_concurrency, mcp_access, mcp_servers_json,
         created_at, updated_at)
      VALUES (?, ?, 'standard', 'Bees work agent', '', 'Local default', NULL, NULL, 'worker',
        '[]', 1, 1, 'none', '[]', ?, ?)
    `).run(targetAgentId, targetWorkspaceId, at, at);
    target.connection.prepare("INSERT INTO processes VALUES (?, ?, 'Local', '', 'standard', NULL, NULL, ?, ?)")
      .run(targetProcessId, targetWorkspaceId, at, at);
    target.connection.prepare("INSERT INTO stages VALUES (?, ?, 'Work', 0, 'agent', 0, 0, NULL)")
      .run(targetStageId, targetProcessId);
    target.connection.prepare("INSERT INTO stage_routes VALUES (?, ?, NULL, '[]', ?, ?)")
      .run(targetStageId, targetAgentId, at, at);
    source.connection.prepare("INSERT INTO agent_locations VALUES (?, ?, '')").run(agentId, locationId);
    source.connection.prepare("INSERT INTO agent_pools VALUES (?, ?, 'Researchers', '', NULL, ?, ?)")
      .run(poolId, workspaceId, at, at);
    source.connection.prepare("INSERT INTO agent_pool_members VALUES (?, ?, 10, 1, NULL)")
      .run(poolId, agentId);
    source.connection.prepare(`
      INSERT INTO processes VALUES (?, ?, 'Daily brief', '', 'standard', ?, NULL, ?, ?)
    `).run(processId, workspaceId, locationId, at, at);
    source.connection.prepare("INSERT INTO stages VALUES (?, ?, 'Research', 0, 'agent', 0, 0, NULL)")
      .run(workStageId, processId);
    source.connection.prepare("INSERT INTO stages VALUES (?, ?, 'Done', 1, 'terminal', 0, 1, NULL)")
      .run(doneStageId, processId);
    source.connection.prepare("INSERT INTO stage_routes VALUES (?, NULL, ?, '[]', ?, ?)")
      .run(workStageId, poolId, at, at);
    source.connection.prepare("INSERT INTO process_locations VALUES (?, ?, '')").run(processId, locationId);
    source.connection.prepare(`
      INSERT INTO recurring_work
        (id, workspace_id, process_id, source_work_item_id, name, schedule_kind, schedule_json,
         timezone, temporal_schedule_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'Morning', 'calendar', '{"frequency":"daily","hour":9,"minute":0}',
        'America/Los_Angeles', ?, 'active', ?, ?)
    `).run(recurringId, workspaceId, processId, itemId, `bees/recurring/${recurringId}`, at, at);
    source.connection.prepare(`
      INSERT INTO work_items
        (id, process_id, stage_id, kind, title, description, agent_assignment_id,
         output_location_id, recurring_work_id, created_at, updated_at)
      VALUES (?, ?, ?, 'work', 'Write brief', '', ?, ?, ?, ?, ?)
    `).run(itemId, processId, workStageId, agentId, locationId, recurringId, at, at);
    source.connection.prepare("INSERT INTO work_item_locations VALUES (?, ?, '')").run(itemId, locationId);
    const runSettings = { model: "test/careful", reasoningEffort: "high", mcpAccess: "none", mcpServers: [] };
    source.connection.prepare("UPDATE work_items SET run_settings_json = ? WHERE id = ?").run(JSON.stringify(runSettings), itemId);

    const records = teamRecords(source.connection, organizationId);
    expect(records.map(({ recordType }) => recordType)).toEqual(expect.arrayContaining([
      "team_location", "agent", "agent_pool", "team_process", "recurring_work", "team_work_item"
    ]));
    expect(JSON.stringify(records)).not.toContain("/secret/company");
    applyTeamRecords(target.connection, organizationId, records);

    expect(target.connection.prepare("SELECT name FROM team_locations WHERE id = ?").get(locationId))
      .toEqual({ name: "Drive" });
    expect(target.connection.prepare(`
      SELECT location_id AS locationId, absolute_path AS path FROM device_location_mappings
    `).get()).toEqual({ locationId, path: "/local/company" });
    expect(target.connection.prepare("SELECT instructions FROM agent_assignments WHERE id = ?").get(agentId))
      .toEqual({ instructions: "Use approved sources" });
    expect(target.connection.prepare("SELECT agent_assignment_id AS agentId FROM stage_routes WHERE stage_id = ?")
      .get(targetStageId)).toEqual({ agentId });
    expect(target.connection.prepare("SELECT output_location_id AS outputLocationId FROM processes WHERE id = ?").get(processId))
      .toEqual({ outputLocationId: locationId });
    expect(target.connection.prepare("SELECT schedule_kind AS kind FROM recurring_work WHERE id = ?").get(recurringId))
      .toEqual({ kind: "calendar" });
    expect(target.connection.prepare("SELECT title FROM work_items WHERE id = ?").get(itemId))
      .toEqual({ title: "Write brief" });
    expect(JSON.parse(String(target.connection.prepare("SELECT run_settings_json AS settings FROM work_items WHERE id = ?").get(itemId)!.settings)))
      .toEqual(runSettings);
    const legacy = structuredClone(records.find((record) => record.recordType === "team_work_item")!);
    delete (legacy.payload as any).runSettings;
    legacy.version += 1000;
    legacy.payload.updatedAt = new Date(legacy.version).toISOString();
    applyTeamRecords(target.connection, organizationId, [legacy]);
    expect(JSON.parse(String(target.connection.prepare("SELECT run_settings_json AS settings FROM work_items WHERE id = ?").get(itemId)!.settings)))
      .toEqual(runSettings);
    const invalid = structuredClone(legacy);
    invalid.version += 1000;
    (invalid.payload as any).runSettings = { mcpAccess: "everything" };
    expect(() => applyTeamRecords(target.connection, organizationId, [invalid])).toThrow("Choose all, none, or listed");
  });
});
