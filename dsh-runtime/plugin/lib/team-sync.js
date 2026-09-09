import { normalizeRunSettings, stableUuid, transaction } from "./product-database.js";

const TYPES = ["team_location", "agent", "agent_pool", "team_process", "recurring_work", "team_work_item"];
const ORDER = new Map(TYPES.map((type, index) => [type, index]));

const json = (value, fallback = []) => {
  try { return JSON.parse(value) ?? fallback; }
  catch { return fallback; }
};
const timestamp = (value) => value ? new Date(value).toISOString() : null;
const versionOf = (value) => Math.max(0, Date.parse(value) || 0);
const record = (recordType, row, payload, deleted = false) => ({
  recordType, recordId: row.id, version: versionOf(row.updatedAt), deleted, payload
});

function inputLocations(database, table, owner, id) {
  return database.prepare(`
    SELECT location_id AS locationId, relative_path AS relativePath
    FROM ${table} WHERE ${owner} = ? ORDER BY location_id, relative_path
  `).all(id);
}

function teamRecords(database, organizationId, connectionId = "", includeAppDefinitions = false) {
  const records = [];
  const owner = (table, key, id) => {
    const row = database.prepare(`SELECT installation_id FROM ${table} WHERE ${key}=?`).get(id);
    return row ? { appInstallationId: row.installation_id } : {};
  };
  for (const row of database.prepare(`
    SELECT l.id, l.team_id AS teamId, l.logical_id AS logicalId, l.name, l.kind, l.description,
           l.archived_at AS archivedAt, l.created_at AS createdAt, l.updated_at AS updatedAt
    FROM team_locations l JOIN teams t ON t.id = l.team_id WHERE t.organization_id = ?
  `).all(organizationId)) records.push(record("team_location", row, {
    teamId: row.teamId, logicalId: row.logicalId, name: row.name, kind: row.kind,
    description: row.description, archivedAt: timestamp(row.archivedAt),
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt)
  }));

  for (const row of database.prepare(`
    SELECT a.id, w.team_id AS teamId, a.name, a.description, a.instructions,
           a.preset_id AS presetId, a.model, a.reasoning_effort AS reasoningEffort,
           a.system_role AS systemRole, a.capabilities_json AS capabilities, a.enabled,
           a.max_concurrency AS maxConcurrency, a.mcp_access AS mcpAccess,
           a.mcp_servers_json AS mcpServers, a.created_at AS createdAt, a.updated_at AS updatedAt
    FROM agent_assignments a JOIN workspaces w ON w.id = a.workspace_id
    JOIN teams t ON t.id = w.team_id WHERE t.organization_id = ?
  `).all(organizationId)) records.push(record("agent", row, {
    ...owner('app_agent_owners', 'agent_id', row.id),
    teamId: row.teamId, name: row.name, description: row.description, instructions: row.instructions,
    presetId: row.presetId, model: row.model, reasoningEffort: row.reasoningEffort,
    systemRole: row.systemRole, capabilities: json(row.capabilities), enabled: Boolean(row.enabled),
    maxConcurrency: row.maxConcurrency, mcpAccess: row.mcpAccess, mcpServers: json(row.mcpServers),
    inputLocations: inputLocations(database, "agent_locations", "agent_assignment_id", row.id),
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt)
  }));

  for (const row of database.prepare(`
    SELECT p.id, w.team_id AS teamId, p.name, p.description, p.kind,
           p.output_location_id AS outputLocationId, p.archived_at AS archivedAt,
           p.created_at AS createdAt, p.updated_at AS updatedAt
    FROM processes p JOIN workspaces w ON w.id = p.workspace_id
    JOIN teams t ON t.id = w.team_id WHERE t.organization_id = ?
  `).all(organizationId)) {
    const stages = database.prepare(`
      SELECT s.id, s.name, s.position, s.driver,
             s.requires_human_approval AS requiresHumanApproval, s.is_terminal AS isTerminal,
             r.agent_assignment_id AS agentId, r.agent_pool_id AS agentPoolId,
             r.agent_ids_json AS agentIds,
             r.required_capabilities_json AS requiredCapabilities, r.updated_at AS routeUpdatedAt
      FROM stages s LEFT JOIN stage_routes r ON r.stage_id = s.id
      WHERE s.process_id = ? AND s.archived_at IS NULL ORDER BY s.position
    `).all(row.id).map((stage) => ({
      id: stage.id, name: stage.name, position: stage.position, driver: stage.driver,
      requiresHumanApproval: Boolean(stage.requiresHumanApproval),
      isTerminal: Boolean(stage.isTerminal), archivedAt: null,
      route: json(stage.agentIds).length || stage.agentId || stage.agentPoolId || stage.requiredCapabilities
        ? {
            agentId: stage.agentId ?? null, agentPoolId: stage.agentPoolId ?? null,
            agentIds: json(stage.agentIds),
            requiredCapabilities: json(stage.requiredCapabilities),
            updatedAt: timestamp(stage.routeUpdatedAt ?? row.updatedAt)
          }
        : null
    }));
    records.push(record("team_process", row, {
      ...owner('app_process_owners', 'process_id', row.id),
      teamId: row.teamId, name: row.name, description: row.description, kind: row.kind,
      outputLocationId: row.outputLocationId,
      inputLocations: inputLocations(database, "process_locations", "process_id", row.id),
      stages, archivedAt: timestamp(row.archivedAt), createdAt: timestamp(row.createdAt),
      updatedAt: timestamp(row.updatedAt)
    }));
  }

  for (const row of database.prepare(`
    SELECT r.id, w.team_id AS teamId, r.process_id AS processId,
           r.source_work_item_id AS sourceWorkItemId, r.name, r.schedule_kind AS scheduleKind,
           r.schedule_json AS schedule, r.timezone, r.status,
           r.created_at AS createdAt, r.updated_at AS updatedAt
    FROM recurring_work r JOIN workspaces w ON w.id = r.workspace_id
    JOIN teams t ON t.id = w.team_id WHERE t.organization_id = ?
  `).all(organizationId)) records.push(record("recurring_work", row, {
    teamId: row.teamId, processId: row.processId, sourceWorkItemId: row.sourceWorkItemId,
    name: row.name, scheduleKind: row.scheduleKind, schedule: json(row.schedule, {}),
    timezone: row.timezone, status: row.status,
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt)
  }));

  for (const row of database.prepare(`
    SELECT i.id, w.team_id AS teamId, i.process_id AS processId, i.stage_id AS stageId,
           i.parent_id AS parentId, i.kind, i.title, i.description, i.owner,
           i.agent_assignment_id AS agentId, i.agent_ids_json AS agentIds,
           i.priority, i.runtime_phase AS runtimePhase,
           i.runtime_attempt AS runtimeAttempt, i.runtime_review_cycle AS runtimeReviewCycle,
           i.runtime_error AS runtimeError, i.output_location_id AS outputLocationId,
           i.recurring_work_id AS recurringWorkId, i.run_settings_json AS runSettingsJson,
           i.account_user_id AS accountUserId, i.archived_at AS archivedAt,
           i.deleted_at AS deletedAt, i.created_at AS createdAt, i.updated_at AS updatedAt
    FROM work_items i JOIN processes p ON p.id = i.process_id
    JOIN workspaces w ON w.id = p.workspace_id JOIN teams t ON t.id = w.team_id
    WHERE t.organization_id = ?
  `).all(organizationId)) records.push(record("team_work_item", row, {
    ...owner('app_process_owners', 'process_id', row.processId),
    teamId: row.teamId, processId: row.processId, stageId: row.stageId, parentId: row.parentId,
    kind: row.kind, title: row.title, description: row.description, owner: row.owner,
    agentId: row.agentId, agentIds: json(row.agentIds),
    priority: row.priority, runtimePhase: row.runtimePhase,
    runtimeAttempt: row.runtimeAttempt, runtimeReviewCycle: row.runtimeReviewCycle,
    runtimeError: row.runtimeError, outputLocationId: row.outputLocationId,
    recurringWorkId: row.recurringWorkId, accountUserId: row.accountUserId,
    ...(row.runSettingsJson !== "{}" ? { runSettings: json(row.runSettingsJson, {}) } : {}),
    inputLocations: inputLocations(database, "work_item_locations", "work_item_id", row.id),
    archivedAt: timestamp(row.archivedAt), deletedAt: timestamp(row.deletedAt),
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt)
  }, Boolean(row.deletedAt)));
  // App definitions are published atomically with app state, not by the background LWW sync.
  const visible = records.filter((r) => includeAppDefinitions || !r.payload.appInstallationId || !['agent', 'team_process'].includes(r.recordType));
  if (!connectionId) return visible;
  const teamIds = new Set(database.prepare(`
    SELECT team_id AS teamId FROM bees_connection_teams WHERE connection_id = ?
  `).all(connectionId).map(({ teamId }) => teamId));
  return visible.filter(({ payload }) => teamIds.has(payload.teamId));
}

function workspaceFor(database, teamId, at) {
  const existing = database.prepare(
    "SELECT id FROM workspaces WHERE team_id = ? AND status = 'active' ORDER BY created_at LIMIT 1"
  ).get(teamId);
  if (existing) return existing.id;
  const id = stableUuid(`connected-workspace:${teamId}`);
  database.prepare(`
    INSERT INTO workspaces
      (id, team_id, dsh_workspace_id, name, authority, hosting, status, created_at, updated_at)
    VALUES (?, ?, NULL, 'Default workspace', 'connected', 'device', 'active', ?, ?)
  `).run(id, teamId, at, at);
  return id;
}

function newer(database, table, id, version) {
  const row = database.prepare(`SELECT updated_at AS updatedAt FROM ${table} WHERE id = ?`).get(id);
  return !row || version > versionOf(row.updatedAt);
}

function replaceLocations(database, table, owner, id, references) {
  database.prepare(`DELETE FROM ${table} WHERE ${owner} = ?`).run(id);
  const insert = database.prepare(`INSERT OR IGNORE INTO ${table} VALUES (?, ?, ?)`);
  for (const reference of references) {
    if (database.prepare("SELECT 1 FROM team_locations WHERE id = ? AND archived_at IS NULL").get(reference.locationId))
      insert.run(id, reference.locationId, reference.relativePath);
  }
}

function replaceAgentInLists(database, table, key, oldId, newId) {
  for (const row of database.prepare(`
    SELECT ${key} AS id, agent_ids_json AS agentIds FROM ${table}
    WHERE EXISTS (SELECT 1 FROM json_each(agent_ids_json) WHERE value = ?)
  `).all(oldId)) {
    const ids = [...new Set(json(row.agentIds).map((id) => id === oldId ? newId : id))];
    database.prepare(`UPDATE ${table} SET agent_ids_json = ? WHERE ${key} = ?`)
      .run(JSON.stringify(ids), row.id);
  }
}

function mergeLocation(database, fromId, toId) {
  database.prepare(`
    INSERT OR IGNORE INTO device_location_mappings
    SELECT ?, device_id, absolute_path, updated_at FROM device_location_mappings WHERE location_id = ?
  `).run(toId, fromId);
  for (const [table, owner] of [
    ["agent_locations", "agent_assignment_id"],
    ["process_locations", "process_id"],
    ["work_item_locations", "work_item_id"]
  ]) {
    database.prepare(`
      INSERT OR IGNORE INTO ${table}
      SELECT ${owner}, ?, relative_path FROM ${table} WHERE location_id = ?
    `).run(toId, fromId);
    database.prepare(`DELETE FROM ${table} WHERE location_id = ?`).run(fromId);
  }
  database.prepare("UPDATE processes SET output_location_id = ? WHERE output_location_id = ?")
    .run(toId, fromId);
  database.prepare("UPDATE work_items SET output_location_id = ? WHERE output_location_id = ?")
    .run(toId, fromId);
  database.prepare("DELETE FROM team_locations WHERE id = ?").run(fromId);
}

function applyLocation(database, record) {
  if (!newer(database, "team_locations", record.recordId, record.version)) return;
  const p = record.payload;
  const collisions = database.prepare(`
    SELECT id FROM team_locations
    WHERE team_id = ? AND id <> ? AND (logical_id = ? OR name = ?)
  `).all(p.teamId, record.recordId, p.logicalId, p.name);
  for (const { id } of collisions) database.prepare(`
    UPDATE team_locations SET logical_id = ?, name = ? WHERE id = ?
  `).run(stableUuid(`merged-location:${id}`), `__bees_merge__${id}`, id);
  database.prepare(`
    INSERT INTO team_locations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET logical_id = excluded.logical_id, name = excluded.name,
      kind = excluded.kind, description = excluded.description, archived_at = excluded.archived_at,
      updated_at = excluded.updated_at
  `).run(record.recordId, p.teamId, p.logicalId, p.name, p.kind, p.description,
    p.archivedAt, p.createdAt, p.updatedAt);
  for (const { id } of collisions) mergeLocation(database, id, record.recordId);
}

function applyAgent(database, record, authoritativeApps = false) {
  if (record.payload.appInstallationId) database.prepare('INSERT OR IGNORE INTO app_agent_owners VALUES (?,?)').run(record.recordId, record.payload.appInstallationId);
  if (!(authoritativeApps && record.payload.appInstallationId) && !newer(database, "agent_assignments", record.recordId, record.version)) return;
  const p = record.payload;
  const workspaceId = workspaceFor(database, p.teamId, p.createdAt);
  const collisions = database.prepare(`
    SELECT id FROM agent_assignments
    WHERE workspace_id = ? AND id <> ?
      AND (name = ? OR (? IS NOT NULL AND system_role = ?))
  `).all(workspaceId, record.recordId, p.name, p.systemRole, p.systemRole);
  for (const { id } of collisions) database.prepare(`
    UPDATE agent_assignments SET name = ?, system_role = NULL WHERE id = ?
  `).run(`__bees_merge__${id}`, id);
  database.prepare(`
    INSERT INTO agent_assignments
      (id, workspace_id, preset_id, name, description, instructions, model, reasoning_effort,
       system_role, capabilities_json, enabled, max_concurrency, mcp_access, mcp_servers_json,
       created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET preset_id = excluded.preset_id, name = excluded.name,
      description = excluded.description, instructions = excluded.instructions, model = excluded.model,
      reasoning_effort = excluded.reasoning_effort, system_role = excluded.system_role,
      capabilities_json = excluded.capabilities_json, enabled = excluded.enabled,
      max_concurrency = excluded.max_concurrency, mcp_access = excluded.mcp_access,
      mcp_servers_json = excluded.mcp_servers_json, updated_at = excluded.updated_at
  `).run(record.recordId, workspaceId, p.presetId, p.name, p.description, p.instructions,
    p.model, p.reasoningEffort, p.systemRole, JSON.stringify(p.capabilities), p.enabled ? 1 : 0,
    p.maxConcurrency, p.mcpAccess, JSON.stringify(p.mcpServers), p.createdAt, p.updatedAt);
  for (const { id } of collisions) {
    database.prepare(`
      INSERT OR IGNORE INTO agent_locations
      SELECT ?, location_id, relative_path FROM agent_locations WHERE agent_assignment_id = ?
    `).run(record.recordId, id);
    database.prepare(`
      INSERT OR IGNORE INTO agent_pool_members
      SELECT pool_id, ?, priority, enabled, last_assigned_at
      FROM agent_pool_members WHERE agent_assignment_id = ?
    `).run(record.recordId, id);
    database.prepare("UPDATE stage_routes SET agent_assignment_id = ? WHERE agent_assignment_id = ?")
      .run(record.recordId, id);
    database.prepare("UPDATE work_items SET agent_assignment_id = ? WHERE agent_assignment_id = ?")
      .run(record.recordId, id);
    replaceAgentInLists(database, "stage_routes", "stage_id", id, record.recordId);
    replaceAgentInLists(database, "work_items", "id", id, record.recordId);
    replaceAgentInLists(database, "agent_dispatches", "execution_id", id, record.recordId);
    for (const specialization of database.prepare(`
      SELECT id, recurring_work_id AS recurringWorkId FROM agent_specializations
      WHERE agent_assignment_id = ?
    `).all(id)) {
      const target = database.prepare(`
        SELECT id FROM agent_specializations
        WHERE recurring_work_id = ? AND agent_assignment_id = ?
      `).get(specialization.recurringWorkId, record.recordId);
      if (target) {
        database.prepare("UPDATE agent_dispatches SET specialization_id = ? WHERE specialization_id = ?")
          .run(target.id, specialization.id);
        database.prepare("DELETE FROM agent_specializations WHERE id = ?").run(specialization.id);
      } else database.prepare(`
        UPDATE agent_specializations SET agent_assignment_id = ? WHERE id = ?
      `).run(record.recordId, specialization.id);
    }
    database.prepare("UPDATE agent_dispatches SET agent_assignment_id = ? WHERE agent_assignment_id = ?")
      .run(record.recordId, id);
    database.prepare(`
      UPDATE agent_dispatches SET target_id = ? WHERE target_type = 'agent' AND target_id = ?
    `).run(record.recordId, id);
    database.prepare("DELETE FROM agent_assignments WHERE id = ?").run(id);
  }
  replaceLocations(database, "agent_locations", "agent_assignment_id", record.recordId, p.inputLocations);
}

function applyPool(database, record) {
  if (!newer(database, "agent_pools", record.recordId, record.version)) return;
  const p = record.payload;
  const workspaceId = workspaceFor(database, p.teamId, p.createdAt);
  database.prepare(`
    INSERT INTO agent_pools VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
      archived_at = excluded.archived_at, updated_at = excluded.updated_at
  `).run(record.recordId, workspaceId, p.name, p.description, p.archivedAt, p.createdAt, p.updatedAt);
  database.prepare("DELETE FROM agent_pool_members WHERE pool_id = ?").run(record.recordId);
  const insert = database.prepare("INSERT INTO agent_pool_members VALUES (?, ?, ?, ?, ?)");
  for (const member of p.members) if (database.prepare(
    "SELECT 1 FROM agent_assignments WHERE id = ? AND workspace_id = ?"
  ).get(member.agentId, workspaceId)) insert.run(record.recordId, member.agentId,
    member.priority, member.enabled ? 1 : 0, member.lastAssignedAt);
}

function applyProcess(database, record, authoritativeApps = false) {
  if (record.payload.appInstallationId) database.prepare('INSERT OR IGNORE INTO app_process_owners VALUES (?,?)').run(record.recordId, record.payload.appInstallationId);
  if (!(authoritativeApps && record.payload.appInstallationId) && !newer(database, "processes", record.recordId, record.version)) return;
  const p = record.payload;
  const workspaceId = workspaceFor(database, p.teamId, p.createdAt);
  if (p.kind === "goals") database.prepare(`
    DELETE FROM processes WHERE workspace_id = ? AND kind = 'goals' AND id <> ?
      AND NOT EXISTS (SELECT 1 FROM work_items WHERE process_id = processes.id)
  `).run(workspaceId, record.recordId);
  database.prepare(`
    INSERT INTO processes
      (id, workspace_id, name, description, kind, output_location_id, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
      kind = excluded.kind, output_location_id = excluded.output_location_id,
      archived_at = excluded.archived_at, updated_at = excluded.updated_at
  `).run(record.recordId, workspaceId, p.name, p.description, p.kind, p.outputLocationId,
    p.archivedAt, p.createdAt, p.updatedAt);
  database.prepare("UPDATE stages SET position = -rowid WHERE process_id = ? AND archived_at IS NULL")
    .run(record.recordId);
  const stageIds = [];
  for (const stage of p.stages) {
    stageIds.push(stage.id);
    database.prepare(`
      INSERT INTO stages (id, process_id, name, position, driver, requires_human_approval, is_terminal, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, position = excluded.position,
        driver = excluded.driver, requires_human_approval = excluded.requires_human_approval,
        is_terminal = excluded.is_terminal, archived_at = NULL
    `).run(stage.id, record.recordId, stage.name, stage.position, stage.driver,
      stage.requiresHumanApproval ? 1 : 0, stage.isTerminal ? 1 : 0);
    database.prepare("DELETE FROM stage_routes WHERE stage_id = ?").run(stage.id);
    if (stage.route) {
      let ids = Array.isArray(stage.route.agentIds) ? stage.route.agentIds : [];
      if (!ids.length && stage.route.agentId) ids = [stage.route.agentId];
      if (!ids.length && stage.route.agentPoolId) {
        ids = database.prepare(`
          SELECT a.id FROM agent_pool_members m JOIN agent_assignments a ON a.id = m.agent_assignment_id
          WHERE m.pool_id = ? AND m.enabled = 1 AND a.enabled = 1 ORDER BY m.priority, a.id LIMIT 8
        `).all(stage.route.agentPoolId).map(({ id }) => id);
        if (stage.driver !== "discussion") ids = ids.slice(0, 1);
      }
      database.prepare(`
        INSERT INTO stage_routes
          (stage_id, agent_assignment_id, agent_pool_id, required_capabilities_json,
           created_at, updated_at, agent_ids_json)
        VALUES (?, ?, NULL, ?, ?, ?, ?)
      `).run(stage.id, ids[0] ?? null, JSON.stringify(stage.route.requiredCapabilities),
        stage.route.updatedAt, stage.route.updatedAt, JSON.stringify(ids));
    }
  }
  for (const stale of database.prepare(`
    SELECT id FROM stages WHERE process_id = ? AND id NOT IN (SELECT value FROM json_each(?))
  `).all(record.recordId, JSON.stringify(stageIds))) database.prepare(
    "UPDATE stages SET archived_at = ? WHERE id = ?"
  ).run(p.updatedAt, stale.id);
  replaceLocations(database, "process_locations", "process_id", record.recordId, p.inputLocations);
}

function applyRecurring(database, record) {
  if (!newer(database, "recurring_work", record.recordId, record.version)) return;
  const p = record.payload;
  const workspaceId = workspaceFor(database, p.teamId, p.createdAt);
  database.prepare(`
    INSERT INTO recurring_work
      (id, workspace_id, process_id, source_work_item_id, name, schedule_kind, schedule_json,
       timezone, temporal_schedule_id, status, next_run_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET process_id = excluded.process_id,
      source_work_item_id = excluded.source_work_item_id, name = excluded.name,
      schedule_kind = excluded.schedule_kind, schedule_json = excluded.schedule_json,
      timezone = excluded.timezone, status = excluded.status, next_run_at = NULL,
      updated_at = excluded.updated_at
  `).run(record.recordId, workspaceId, p.processId, p.sourceWorkItemId, p.name, p.scheduleKind,
    JSON.stringify(p.schedule), p.timezone, `bees/recurring/${record.recordId}`, p.status,
    p.createdAt, p.updatedAt);
}

function applyItem(database, record) {
  if (!newer(database, "work_items", record.recordId, record.version)) return;
  const p = record.payload;
  // A new row starts unparented because the parent may arrive later in this batch; the pass in
  // applyTeamRecords links it once the parent is confirmed. An update must leave an existing
  // link alone, or any later metadata change would orphan a child that was already correct.
  // Older clients omit settings. Do not let their metadata updates erase a goal's restrictions.
  const priorSettings = database.prepare("SELECT run_settings_json AS settings FROM work_items WHERE id = ?")
    .get(record.recordId)?.settings;
  const settings = normalizeRunSettings(p.runSettings ?? json(priorSettings, {}));
  const ids = Array.isArray(p.agentIds) ? p.agentIds : p.agentId ? [p.agentId] : [];
  database.prepare(`
    INSERT INTO work_items
      (id, process_id, stage_id, parent_id, kind, title, description, owner, agent_assignment_id,
       agent_ids_json, priority, runtime_phase, runtime_attempt, runtime_review_cycle, runtime_error,
       output_location_id, recurring_work_id, account_user_id, archived_at, deleted_at, created_at, updated_at, run_settings_json)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET process_id = excluded.process_id, stage_id = excluded.stage_id,
      kind = excluded.kind, title = excluded.title, description = excluded.description,
      owner = excluded.owner, agent_assignment_id = excluded.agent_assignment_id,
      agent_ids_json = excluded.agent_ids_json,
      priority = excluded.priority, runtime_phase = excluded.runtime_phase,
      runtime_attempt = excluded.runtime_attempt, runtime_review_cycle = excluded.runtime_review_cycle,
      runtime_error = excluded.runtime_error, output_location_id = excluded.output_location_id,
      recurring_work_id = excluded.recurring_work_id, account_user_id = excluded.account_user_id,
      archived_at = excluded.archived_at,
      deleted_at = excluded.deleted_at, updated_at = excluded.updated_at, run_settings_json = excluded.run_settings_json       
  `).run(record.recordId, p.processId, p.stageId, p.kind, p.title, p.description, p.owner,
    ids[0] ?? null, JSON.stringify(ids), p.priority, p.runtimePhase, p.runtimeAttempt, p.runtimeReviewCycle, p.runtimeError,
    p.outputLocationId, p.recurringWorkId, p.accountUserId ?? null, p.archivedAt,         
    record.deleted ? (p.deletedAt ?? p.updatedAt) : p.deletedAt, p.createdAt, p.updatedAt, JSON.stringify(settings));      
  replaceLocations(database, "work_item_locations", "work_item_id", record.recordId, p.inputLocations);
}

export function applyTeamRecords(database, organizationId, records, authoritativeApps = false) {
  const applicable = records.filter(({ recordType, payload }) => ORDER.has(recordType) && database.prepare(`
    SELECT 1 FROM teams WHERE id = ? AND organization_id = ? AND status = 'active'
  `).get(payload.teamId, organizationId)).sort(
    (left, right) => ORDER.get(left.recordType) - ORDER.get(right.recordType)
  );
  transaction(database, () => {
    for (const entry of applicable) {
      if (entry.recordType === "team_location") applyLocation(database, entry);
      else if (entry.recordType === "agent") applyAgent(database, entry, authoritativeApps);
      else if (entry.recordType === "agent_pool") applyPool(database, entry);
      else if (entry.recordType === "team_process") applyProcess(database, entry, authoritativeApps);
      else if (entry.recordType === "recurring_work") applyRecurring(database, entry);
      else if (entry.recordType === "team_work_item") applyItem(database, entry);
    }
    for (const entry of applicable.filter(({ recordType }) => recordType === "team_work_item")) {
      if (entry.payload.parentId && database.prepare(
        "SELECT 1 FROM work_items WHERE id = ? AND process_id = ?"
      ).get(entry.payload.parentId, entry.payload.processId)) database.prepare(
        "UPDATE work_items SET parent_id = ? WHERE id = ?"
      ).run(entry.payload.parentId, entry.recordId);
    }
  });
}

async function pullAll(request, organizationId, cursor) {
  const records = [];
  let next = cursor;
  do {
    const page = await request(`/api/sync/pull?cursor=${encodeURIComponent(next)}&capabilities=apps-v1`, { organizationId });
    records.push(...page.records);
    const previous = next;
    next = page.cursor;
    if (page.records.length < 1_000 || next === previous) break;
  } while (true);
  return { cursor: next, records };
}

export async function syncTeamRecords(database, request, organizationId, connectionId) {
  const hasApps = database.prepare('SELECT 1 FROM bees_app_sync_versions WHERE connection_id=?').get(connectionId);
  const saved = hasApps ? database.prepare(
    "SELECT cursor FROM bees_connection_sync_cursors WHERE connection_id = ?"
  ).get(connectionId)?.cursor ?? "0" : "0";
  const incoming = await pullAll(request, organizationId, saved);
  applyTeamRecords(database, organizationId, incoming.records);
  const outgoing = teamRecords(database, organizationId, connectionId);
  for (let index = 0; index < outgoing.length; index += 500) await request("/api/sync/push", {
    method: "POST", organizationId, body: { records: outgoing.slice(index, index + 500) }
  });
  const settled = await pullAll(request, organizationId, saved);
  applyTeamRecords(database, organizationId, settled.records);
  database.prepare(`
    INSERT INTO bees_connection_sync_cursors VALUES (?, ?, ?)
    ON CONFLICT(connection_id) DO UPDATE SET cursor = excluded.cursor, synced_at = excluded.synced_at
  `).run(connectionId, settled.cursor, new Date().toISOString());
  database.prepare('INSERT OR IGNORE INTO bees_app_sync_versions VALUES (?)').run(connectionId);
  return { pushed: outgoing.length, pulled: settled.records.length, cursor: settled.cursor };
}

export { teamRecords };
