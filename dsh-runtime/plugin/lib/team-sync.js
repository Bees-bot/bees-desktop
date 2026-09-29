import { normalizeRunSettings, stableUuid, transaction } from "./product-database.js";

const TYPES = [
  "team_location", "agent", "team_process", "process_template",
  "recurring_work", "team_work_item", "team_run"
];
const ORDER = new Map(TYPES.map((type, index) => [type, index]));

const json = (value, fallback = []) => {
  try { return value == null ? fallback : JSON.parse(value) ?? fallback; }
  catch { return fallback; }
};
const timestamp = (value) => value ? new Date(value).toISOString() : null;
const versionOf = (value) => Math.max(0, Date.parse(value) || 0);
// cut to the server's limit without splitting an emoji, postgres refuses half of one
const clip = (text, max) => text?.slice(0, max).replace(/[\ud800-\udbff]$/, "");
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
  // Always present, null when no app owns it: a key that comes and goes drifts off the contract.
  const owner = (table, key, id) => {
    const row = database.prepare(`SELECT installation_id FROM ${table} WHERE ${key}=?`).get(id);
    return { appInstallationId: row?.installation_id ?? null };
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
           a.system_role AS systemRole, a.capabilities_json AS capabilities, a.enabled, a.archived_at AS archivedAt,
           a.max_concurrency AS maxConcurrency, a.mcp_access AS mcpAccess,
           a.mcp_servers_json AS mcpServers, a.created_at AS createdAt, a.updated_at AS updatedAt
    FROM agent_assignments a JOIN workspaces w ON w.id = a.workspace_id
    JOIN teams t ON t.id = w.team_id WHERE t.organization_id = ?
  `).all(organizationId)) records.push(record("agent", row, {
    ...owner('app_agent_owners', 'agent_id', row.id),
    teamId: row.teamId, name: row.name, description: row.description, instructions: row.instructions,
    presetId: row.presetId, model: row.model, reasoningEffort: row.reasoningEffort,
    systemRole: row.systemRole, capabilities: json(row.capabilities), enabled: Boolean(row.enabled), archivedAt: timestamp(row.archivedAt),
    maxConcurrency: row.maxConcurrency, mcpAccess: row.mcpAccess, mcpServers: json(row.mcpServers),
    inputLocations: inputLocations(database, "agent_locations", "agent_assignment_id", row.id),
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt)
  }));

  for (const row of database.prepare(`
    SELECT p.id, w.team_id AS teamId, p.name, p.description, p.kind,
           p.output_location_id AS outputLocationId, p.mcp_access AS mcpAccess,
           p.mcp_servers_json AS mcpServers, p.archived_at AS archivedAt,
           p.created_at AS createdAt, p.updated_at AS updatedAt
    FROM processes p JOIN workspaces w ON w.id = p.workspace_id
    JOIN teams t ON t.id = w.team_id WHERE t.organization_id = ?
  `).all(organizationId)) {
    const stages = database.prepare(`
      SELECT s.id, s.name, s.position, s.driver,
             s.requires_human_approval AS requiresHumanApproval, s.is_terminal AS isTerminal,
             r.agent_assignment_id AS agentId,
             r.agent_ids_json AS agentIds,
             r.required_capabilities_json AS requiredCapabilities, r.updated_at AS routeUpdatedAt
      FROM stages s LEFT JOIN stage_routes r ON r.stage_id = s.id
      WHERE s.process_id = ? AND s.archived_at IS NULL ORDER BY s.position
    `).all(row.id).map((stage) => {
      // product-routing falls back to the scalar when the list is empty, so the list has to carry
      // it or the assignment does not survive the trip.
      const routeIds = json(stage.agentIds).length ? json(stage.agentIds)
        : stage.agentId ? [stage.agentId] : [];
      return {
      id: stage.id, name: stage.name, position: stage.position, driver: stage.driver,
      requiresHumanApproval: Boolean(stage.requiresHumanApproval),
      isTerminal: Boolean(stage.isTerminal), archivedAt: null,
      route: routeIds.length || stage.requiredCapabilities
        ? {
            agentId: routeIds[0] ?? null,
            agentIds: routeIds,
            requiredCapabilities: json(stage.requiredCapabilities),
            updatedAt: timestamp(stage.routeUpdatedAt ?? row.updatedAt)
          }
        : null
    };});
    records.push(record("team_process", row, {
      ...owner('app_process_owners', 'process_id', row.id),
      teamId: row.teamId, name: row.name, description: row.description, kind: row.kind,
      outputLocationId: row.outputLocationId, mcpAccess: row.mcpAccess, mcpServers: json(row.mcpServers),
      inputLocations: inputLocations(database, "process_locations", "process_id", row.id),
      stages, archivedAt: timestamp(row.archivedAt), createdAt: timestamp(row.createdAt),
      updatedAt: timestamp(row.updatedAt)
    }));
  }

  for (const row of database.prepare(`
    SELECT pt.id, w.team_id AS teamId, pt.name, pt.description, pt.stages_json AS stages,
           pt.account_user_id AS accountUserId,
           pt.archived_at AS archivedAt, pt.created_at AS createdAt, pt.updated_at AS updatedAt
    FROM process_templates pt JOIN workspaces w ON w.id = pt.workspace_id
    JOIN teams t ON t.id = w.team_id WHERE t.organization_id = ?
  `).all(organizationId)) records.push(record("process_template", row, {
    teamId: row.teamId, name: row.name, description: row.description, stages: json(row.stages),
    accountUserId: row.accountUserId,
    archivedAt: timestamp(row.archivedAt), createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt)
  }));

  for (const row of database.prepare(`
    SELECT r.id, w.team_id AS teamId, r.process_id AS processId,
           r.source_work_item_id AS sourceWorkItemId, r.origin_work_item_id AS originWorkItemId,
           r.name, r.schedule_kind AS scheduleKind,
           r.schedule_json AS schedule, r.timezone, r.status,
           r.created_at AS createdAt, r.updated_at AS updatedAt
    FROM recurring_work r JOIN workspaces w ON w.id = r.workspace_id
    JOIN teams t ON t.id = w.team_id WHERE t.organization_id = ?
  `).all(organizationId)) records.push(record("recurring_work", row, {
    teamId: row.teamId, processId: row.processId, sourceWorkItemId: row.sourceWorkItemId,
    originWorkItemId: row.originWorkItemId,
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
    // the server refuses a title over 180, and a refused item never gets a lease to start
    kind: row.kind, title: clip(row.title, 180), description: row.description, owner: row.owner,
    agentId: json(row.agentIds)[0] ?? null, agentIds: json(row.agentIds),
    priority: row.priority, runtimePhase: row.runtimePhase,
    runtimeAttempt: row.runtimeAttempt, runtimeReviewCycle: row.runtimeReviewCycle,
    runtimeError: row.runtimeError, outputLocationId: row.outputLocationId,
    recurringWorkId: row.recurringWorkId, accountUserId: row.accountUserId,
    runSettings: json(row.runSettingsJson, {}),
    inputLocations: inputLocations(database, "work_item_locations", "work_item_id", row.id),
    archivedAt: timestamp(row.archivedAt), deletedAt: timestamp(row.deletedAt),
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt)
  }, Boolean(row.deletedAt)));
  // The agent runtime owns these tables and creates them when it starts. No runtime yet, no runs.
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'execution_links'").get())
  for (const row of database.prepare(`
    SELECT e.execution_id AS id, w.team_id AS teamId, e.work_item_id AS workItemId, e.status,
           json_extract(e.config_json, '$.mode') AS mode,
           e.created_at AS createdAt, e.updated_at AS updatedAt,
           d.stage_id AS stageId, d.agent_assignment_id AS agentId, d.agent_ids_json AS agentIds,
           d.reason, d.agent_revision AS agentRevision, r.outcome, r.summary,
           starts.startedAt
    FROM execution_links e
    JOIN workspaces w ON w.id = e.workspace_id JOIN teams t ON t.id = w.team_id
    LEFT JOIN agent_dispatches d ON d.execution_id = e.execution_id
    LEFT JOIN bees_stage_results r ON r.execution_id = e.execution_id
    LEFT JOIN (SELECT execution_id, MIN(created_at) AS startedAt FROM dsh_audit_events
               WHERE event_type = 'run-started' GROUP BY execution_id) starts
      ON starts.execution_id = e.execution_id
    WHERE t.organization_id = ?
  `).all(organizationId)) records.push(record("team_run", { ...row, id: stableUuid(`run:${row.id}`) }, {
    executionId: row.id,
    teamId: row.teamId, workItemId: row.workItemId, stageId: row.stageId,
    agentId: row.agentId, agentIds: json(row.agentIds), status: row.status,
    mode: row.mode, reason: row.reason, agentRevision: row.agentRevision,
    outcome: row.outcome, summary: clip(row.summary, 20_000) ?? null,
    startedAt: timestamp(row.startedAt),
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt)
  }));

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

function newer(database, table, id, version, key = "id") {
  const row = database.prepare(`SELECT updated_at AS updatedAt FROM ${table} WHERE ${key} = ?`).get(id);
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
       created_at, updated_at, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET preset_id = excluded.preset_id, name = excluded.name,
      description = excluded.description, instructions = excluded.instructions, model = excluded.model,
      reasoning_effort = excluded.reasoning_effort, system_role = excluded.system_role,
      capabilities_json = excluded.capabilities_json, enabled = excluded.enabled,
      max_concurrency = excluded.max_concurrency, mcp_access = excluded.mcp_access,
      mcp_servers_json = excluded.mcp_servers_json, updated_at = excluded.updated_at, archived_at = excluded.archived_at
  `).run(record.recordId, workspaceId, p.presetId, p.name, p.description, p.instructions,
    p.model, p.reasoningEffort, p.systemRole, JSON.stringify(p.capabilities), p.enabled ? 1 : 0,
    p.maxConcurrency, p.mcpAccess, JSON.stringify(p.mcpServers), p.createdAt, p.updatedAt, p.archivedAt ?? null);
  for (const { id } of collisions) {
    database.prepare(`
      INSERT OR IGNORE INTO agent_locations
      SELECT ?, location_id, relative_path FROM agent_locations WHERE agent_assignment_id = ?
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

function applyProcess(database, record, authoritativeApps = false) {
  if (record.payload.appInstallationId) database.prepare('INSERT OR IGNORE INTO app_process_owners VALUES (?,?)').run(record.recordId, record.payload.appInstallationId);
  if (!(authoritativeApps && record.payload.appInstallationId) && !newer(database, "processes", record.recordId, record.version)) return;
  const p = record.payload;
  const workspaceId = workspaceFor(database, p.teamId, p.createdAt);
  if (p.kind === "goals") database.prepare(`
    DELETE FROM processes WHERE workspace_id = ? AND kind = 'goals' AND id <> ?
      AND NOT EXISTS (SELECT 1 FROM work_items WHERE process_id = processes.id)
  `).run(workspaceId, record.recordId);
  const policy = normalizeRunSettings({ mcpAccess: p.mcpAccess ?? "none", mcpServers: p.mcpServers ?? [] });
  database.prepare(`
    INSERT INTO processes
      (id, workspace_id, name, description, kind, output_location_id, mcp_access, mcp_servers_json, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
      kind = excluded.kind, output_location_id = excluded.output_location_id,
      mcp_access = excluded.mcp_access, mcp_servers_json = excluded.mcp_servers_json,
      archived_at = excluded.archived_at, updated_at = excluded.updated_at
  `).run(record.recordId, workspaceId, p.name, p.description, p.kind, p.outputLocationId,
    policy.mcpAccess, JSON.stringify(policy.mcpServers), p.archivedAt, p.createdAt, p.updatedAt);
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
      const ids = stage.route.agentIds?.length ? stage.route.agentIds
        : stage.route.agentId ? [stage.route.agentId] : [];
      database.prepare(`
        INSERT INTO stage_routes
          (stage_id, agent_assignment_id, required_capabilities_json,
           created_at, updated_at, agent_ids_json)
        VALUES (?, ?, ?, ?, ?, ?)
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

function applyTemplate(database, record) {
  if (!newer(database, "process_templates", record.recordId, record.version)) return;
  const p = record.payload;
  const workspaceId = workspaceFor(database, p.teamId, p.createdAt);
  database.prepare(`
    INSERT INTO process_templates
      (id, workspace_id, name, description, stages_json, account_user_id, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
      stages_json = excluded.stages_json, account_user_id = excluded.account_user_id,
      archived_at = excluded.archived_at,
      updated_at = excluded.updated_at
  `).run(record.recordId, workspaceId, p.name, p.description, JSON.stringify(p.stages),
    p.accountUserId ?? null, p.archivedAt, p.createdAt, p.updatedAt);
}

function applyRecurring(database, record) {
  if (!newer(database, "recurring_work", record.recordId, record.version)) return;
  const p = record.payload;
  const workspaceId = workspaceFor(database, p.teamId, p.createdAt);
  database.prepare(`
    INSERT INTO recurring_work
      (id, workspace_id, process_id, source_work_item_id, origin_work_item_id, name, schedule_kind, schedule_json,
       timezone, temporal_schedule_id, status, next_run_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET process_id = excluded.process_id,
      source_work_item_id = excluded.source_work_item_id, name = excluded.name,
      origin_work_item_id = COALESCE(excluded.origin_work_item_id, recurring_work.origin_work_item_id),
      schedule_kind = excluded.schedule_kind, schedule_json = excluded.schedule_json,
      timezone = excluded.timezone, status = excluded.status, next_run_at = NULL,
      updated_at = excluded.updated_at
  `).run(record.recordId, workspaceId, p.processId, p.sourceWorkItemId, p.originWorkItemId ?? null, p.name, p.scheduleKind,
    JSON.stringify(p.schedule), p.timezone, `bees/recurring/${record.recordId}`, p.status,
    p.createdAt, p.updatedAt);
}

function applyItem(database, record) {
  if (!newer(database, "work_items", record.recordId, record.version)) return;
  const p = record.payload;
  // A new row starts unparented because the parent may arrive later in this batch; the pass in
  // applyTeamRecords links it once the parent is confirmed. An update must leave an existing
  // link alone, or any later metadata change would orphan a child that was already correct.
  // An older desktop sends neither and the server still accepts it, so a missing field must not
  // read as "clear it".
  const prior = database.prepare("SELECT run_settings_json AS settings FROM work_items WHERE id = ?")
    .get(record.recordId)?.settings;
  const settings = normalizeRunSettings(p.runSettings ?? json(prior, {}));
  const ids = p.agentIds ?? (p.agentId ? [p.agentId] : []);
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

function applyRun(database, record) {
  const p = record.payload;
  if (!newer(database, "bees_remote_runs", p.executionId, record.version, "execution_id")) return;
  database.prepare(`
    INSERT INTO bees_remote_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(execution_id) DO UPDATE SET work_item_id = excluded.work_item_id,
      stage_id = excluded.stage_id, agent_assignment_id = excluded.agent_assignment_id,
      agent_ids_json = excluded.agent_ids_json, status = excluded.status, mode = excluded.mode,
      reason = excluded.reason, agent_revision = excluded.agent_revision,
      outcome = excluded.outcome, summary = excluded.summary, started_at = excluded.started_at,
      updated_at = excluded.updated_at
  `).run(p.executionId, p.workItemId, p.stageId, p.agentId, JSON.stringify(p.agentIds), p.status,
    p.mode, p.reason, p.agentRevision, p.outcome, p.summary, p.startedAt,
    p.createdAt, p.updatedAt);
}

export function applyTeamRecords(database, organizationId, records, authoritativeApps = false, connectionId = null) {
  // A deleted team publishes tombstones carrying only a teamId. Only work items have a local
  // delete path; feeding the rest to their apply functions throws and takes the whole batch down.
  const applicable = records.filter(({ recordType, deleted, payload }) => ORDER.has(recordType)
    && (!deleted || recordType === "team_work_item")
    && database.prepare(`
      SELECT 1 FROM teams WHERE id = ? AND organization_id = ? AND status = 'active'
    `).get(payload.teamId, organizationId)
    // Push only sends this connection's teams, so pulling the whole org built workspaces for teams you were never on.
    && (!connectionId || database.prepare(
      "SELECT 1 FROM bees_connection_teams WHERE connection_id = ? AND team_id = ?"
    ).get(connectionId, payload.teamId))).sort(
    (left, right) => ORDER.get(left.recordType) - ORDER.get(right.recordType)
  );
  let deferred = false;
  // The server can refuse one record and keep its neighbours, so a record can arrive before, or
  // without, the rows it points at. Every reference here is a foreign key, so let SQLite say which
  // ones are not ready rather than listing them, and leave those for a later pass.
  const attempt = (work) => {
    database.exec("SAVEPOINT record");
    try { work(); database.exec("RELEASE record"); return; }
    catch (error) {
      database.exec("ROLLBACK TO record");
      database.exec("RELEASE record");
      // Only a missing reference is worth waiting for. Anything else will fail again next pass and
      // has to stay loud rather than pin the cursor for good.
      if (!/FOREIGN KEY constraint failed/i.test(String(error?.message ?? error))) throw error;
      deferred = true;
    }
  };
  transaction(database, () => {
    for (const entry of applicable) attempt(() => {
      if (entry.recordType === "team_location") applyLocation(database, entry);
      else if (entry.recordType === "agent") applyAgent(database, entry, authoritativeApps);
      else if (entry.recordType === "team_process") applyProcess(database, entry, authoritativeApps);
      else if (entry.recordType === "process_template") applyTemplate(database, entry);
      else if (entry.recordType === "recurring_work") applyRecurring(database, entry);
      else if (entry.recordType === "team_work_item") applyItem(database, entry);
      else if (entry.recordType === "team_run") applyRun(database, entry);
    });
    for (const entry of applicable.filter(({ recordType }) => recordType === "team_work_item")) {
      if (!entry.payload.parentId) continue;
      if (database.prepare(
        "SELECT 1 FROM work_items WHERE id = ? AND process_id = ?"
      ).get(entry.payload.parentId, entry.payload.processId)) database.prepare(
        "UPDATE work_items SET parent_id = ? WHERE id = ?"
      ).run(entry.payload.parentId, entry.recordId);
      // The parent was refused, so this child is not finished arriving.
      else deferred = true;
    }
  });
  return deferred;
}

/** Applies everything past `cursor` and commits it, whatever the push after it does. */
async function pull(database, request, organizationId, connectionId, cursor) {
  const records = [];
  let next = cursor;
  let more = true;
  while (more) {
    const page = await request(
      `/api/sync/pull?cursor=${encodeURIComponent(next)}&capabilities=apps-v1`, { organizationId }
    );
    // Applied as one batch: a work item and the process it needs can fall either side of a page
    // boundary, and applyTeamRecords only orders what it is handed.
    records.push(...page.records);
    next = page.cursor;
    more = page.more;
  }
  // A record whose rows are missing keeps its version, so a cursor moved past it never offers it
  // again. Hold the cursor until the batch applies whole.
  if (applyTeamRecords(database, organizationId, records, false, connectionId)) return { cursor, count: records.length };
  database.prepare(`
    INSERT INTO bees_connection_sync_cursors VALUES (?, ?, ?)
    ON CONFLICT(connection_id) DO UPDATE SET cursor = excluded.cursor, synced_at = excluded.synced_at
  `).run(connectionId, next, new Date().toISOString());
  return { cursor: next, count: records.length };
}

const PUSH_LIMIT = 500;

export async function syncTeamRecords(database, request, organizationId, connectionId) {
  const saved = database.prepare(
    "SELECT cursor FROM bees_connection_sync_cursors WHERE connection_id = ?"
  ).get(connectionId)?.cursor ?? "0";
  const incoming = await pull(database, request, organizationId, connectionId, saved);
  // a plan's items wait for their owner's Start, and once shared a teammate's device started them first
  const waiting = new Set(database.prepare(`SELECT w.id FROM work_items w JOIN bees_work_receipts r ON r.work_item_id = w.id
    WHERE w.runtime_phase = 'ready' AND w.deleted_at IS NULL AND w.archived_at IS NULL AND r.idempotency_key LIKE 'proposal:%'`)
    .all().map(({ id }) => id));
  const outgoing = teamRecords(database, organizationId, connectionId)
    .filter(({ recordType, recordId }) => recordType !== "team_work_item" || !waiting.has(recordId));
  const rejected = [];
  for (let index = 0; index < outgoing.length; index += PUSH_LIMIT) {
    const result = await request("/api/sync/push", {
      method: "POST", organizationId, body: { records: outgoing.slice(index, index + PUSH_LIMIT) }
    });
    rejected.push(...(result.rejected ?? []));
  }
  const settled = await pull(database, request, organizationId, connectionId, incoming.cursor);
  return {
    pushed: outgoing.length - rejected.length,
    rejected,
    pulled: incoming.count + settled.count,
    cursor: settled.cursor
  };
}

export { teamRecords };
