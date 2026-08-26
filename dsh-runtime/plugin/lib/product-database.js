import { createHash, randomUUID } from "node:crypto";

const GOALS_WORK_INSTRUCTIONS = "Decide first whether the outcome needs a plan. If one run can finish it, do the work directly. Otherwise execute only the next safe wave, use todos, and delegate one self-contained subitem at a time when sequencing or approval matters. Do not plan dependent future waves before current evidence is available. Continue until the outcome and any explicit stop condition are genuinely satisfied, then submit the deliverable for review.";
const GOALS_REVIEW_INSTRUCTIONS = "Independently inspect the candidate deliverables and evidence against the requested outcome, parent goal, and any explicit stop condition. Pass only when the outcome is actually complete; never pass an ongoing campaign whose stop condition is unmet. Otherwise return specific revision feedback.";

export const iso = () => new Date().toISOString();
export function stableUuid(value) {
  const hex = createHash("sha256").update(String(value)).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  const text = hex.join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

export function required(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

export function transaction(database, work) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function currentIdentity(database) {
  const identity = database.prepare(`
    SELECT u.id AS userId, d.id AS deviceId FROM users u CROSS JOIN devices d
    ORDER BY u.created_at, d.created_at LIMIT 1
  `).get();
  if (!identity) throw new Error("The local Bees identity is unavailable");
  return identity;
}

function membership(database, teamId) {
  const { userId } = currentIdentity(database);
  return database.prepare(`
    SELECT t.id AS teamId, t.organization_id AS organizationId, tm.role,
           om.role AS organizationRole
    FROM teams t
    JOIN organizations o ON o.id = t.organization_id AND o.status = 'active'
    JOIN organization_memberships om ON om.organization_id = o.id AND om.user_id = ? AND om.status = 'active'
    LEFT JOIN team_memberships tm ON tm.team_id = t.id AND tm.user_id = ? AND tm.status = 'active'
    WHERE t.id = ? AND t.status = 'active'
      AND (tm.user_id IS NOT NULL OR om.role IN ('owner', 'admin'))
  `).get(userId, userId, teamId);
}

export function requireTeam(database, teamId, roles = ["admin", "member", "viewer"]) {
  const row = membership(database, required(teamId, "Team"));
  const role = row?.role ?? (row && ["owner", "admin"].includes(row.organizationRole) ? "admin" : null);
  if (!row || !roles.includes(role)) throw new Error("You do not have permission for this team");
  return { ...row, role };
}

export function workspaceContext(database, workspaceId, roles = ["admin", "member", "viewer"]) {
  const row = database.prepare(`
    SELECT id, team_id AS teamId, name, dsh_workspace_id AS dshWorkspaceId,
           authority, hosting, status
    FROM workspaces WHERE id = ? AND status = 'active'
  `).get(required(workspaceId, "Workspace"));
  if (!row) throw new Error("Workspace not found");
  return { ...row, membership: requireTeam(database, row.teamId, roles) };
}

export function itemContext(database, itemId, roles = ["admin", "member", "viewer"]) {
  const row = database.prepare(`
    SELECT w.id, w.title, w.description, w.process_id AS processId, w.stage_id AS stageId,
           w.parent_id AS parentId, w.kind, w.agent_assignment_id AS agentAssignmentId,
           p.workspace_id AS workspaceId
    FROM work_items w JOIN processes p ON p.id = w.process_id
    WHERE w.id = ? AND w.deleted_at IS NULL
  `).get(required(itemId, "Work item"));
  if (!row) throw new Error("Work item not found");
  workspaceContext(database, row.workspaceId, roles);
  return row;
}

export function processContext(database, processId, roles = ["admin", "member", "viewer"]) {
  const row = database.prepare(`
    SELECT id, workspace_id AS workspaceId, name, description, kind
    FROM processes WHERE id = ? AND archived_at IS NULL
  `).get(required(processId, "Process"));
  if (!row) throw new Error("Process not found");
  workspaceContext(database, row.workspaceId, roles);
  return row;
}

export function parentFor(database, itemId, processId, parentId) {
  if (!parentId) return null;
  let current = String(parentId);
  for (let depth = 0; depth < 100; depth += 1) {
    if (current === itemId) throw new Error("A work item cannot be its own ancestor");
    const row = database.prepare(`
      SELECT parent_id AS parentId FROM work_items
      WHERE id = ? AND process_id = ? AND deleted_at IS NULL
    `).get(current, processId);
    if (!row) throw new Error("Parent work is not in this process");
    if (!row.parentId) return String(parentId);
    current = String(row.parentId);
  }
  throw new Error("The work hierarchy is too deep");
}

export function defaultAssignment(database, workspaceId, role = "worker") {
  return database.prepare(`
    SELECT id, preset_id AS presetId, name, description, instructions, model,
           reasoning_effort AS reasoningEffort,
           system_role AS systemRole, capabilities_json AS capabilities,
           enabled, max_concurrency AS maxConcurrency, updated_at AS updatedAt
    FROM agent_assignments WHERE workspace_id = ? AND system_role = ? LIMIT 1
  `).get(workspaceId, role);
}

export function capabilities(value, label = "Capabilities") {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");
  const normalized = [...new Set(values.map((entry) => String(entry).trim().toLocaleLowerCase()).filter(Boolean))];
  if (normalized.length > 20 || normalized.some((entry) => !/^[a-z0-9][a-z0-9-]{0,39}$/.test(entry)))
    throw new Error(`${label} must contain at most 20 lowercase names using letters, numbers, and hyphens`);
  return normalized;
}

export function optionalReasoningEffort(value) {
  const effort = String(value ?? "").trim();
  if (effort.length > 100) throw new Error("Reasoning effort must be at most 100 characters");
  return effort || null;
}

export function agentCapabilities(agent) {
  try { return capabilities(JSON.parse(agent.capabilities || "[]")); }
  catch { return []; }
}

export function assignment(database, id, workspaceId) {
  return database.prepare(`
    SELECT id, workspace_id AS workspaceId, preset_id AS presetId, name, description,
           instructions, model, reasoning_effort AS reasoningEffort,
           system_role AS systemRole, capabilities_json AS capabilities,
           enabled, max_concurrency AS maxConcurrency, updated_at AS updatedAt,
           mcp_access AS mcpAccess, mcp_servers_json AS mcpServers
    FROM agent_assignments WHERE id = ? AND workspace_id = ?
  `).get(id, workspaceId);
}

export function activeAgentRuns(database, agentId) {
  return Number(database.prepare(`
    SELECT count(*) AS count FROM agent_dispatches d
    LEFT JOIN execution_links e ON e.execution_id = d.execution_id
    WHERE d.agent_assignment_id = ? AND (
      e.status IN ('queued', 'running', 'waiting_for_input', 'waiting_for_approval')
      OR (e.execution_id IS NULL AND d.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes'))
    )
  `).get(agentId)?.count ?? 0);
}

function ensureAgentDefaults(database, workspaceId) {
  const at = iso();
  if (!defaultAssignment(database, workspaceId, "worker")) {
    const existing = database.prepare(`
      SELECT id FROM agent_assignments WHERE workspace_id = ? AND name = 'Bees work agent' LIMIT 1
    `).get(workspaceId);
    if (existing) database.prepare(`
      UPDATE agent_assignments SET system_role = 'worker', updated_at = ? WHERE id = ?
    `).run(at, existing.id);
    else database.prepare(`
      INSERT INTO agent_assignments
        (id, workspace_id, preset_id, name, description, instructions, model, system_role, created_at, updated_at)
      VALUES (?, ?, 'standard', 'Bees work agent', 'Default agent for completing work', '', NULL, 'worker', ?, ?)
    `).run(stableUuid(`${workspaceId}:bees-work-agent`), workspaceId, at, at);
  }
  if (!defaultAssignment(database, workspaceId, "reviewer")) {
    const existing = database.prepare(`
      SELECT id FROM agent_assignments WHERE workspace_id = ? AND name = 'Bees reviewer' LIMIT 1
    `).get(workspaceId);
    if (existing) database.prepare(`
      UPDATE agent_assignments SET system_role = 'reviewer', updated_at = ? WHERE id = ?
    `).run(at, existing.id);
    else database.prepare(`
      INSERT INTO agent_assignments
        (id, workspace_id, preset_id, name, description, instructions, model, system_role, created_at, updated_at)
      VALUES (?, ?, 'standard', 'Bees reviewer', 'Default independent reviewer', '', NULL, 'reviewer', ?, ?)
    `).run(stableUuid(`${workspaceId}:bees-reviewer`), workspaceId, at, at);
  }
}

export function insertProcess(database, workspaceId, name, description, stages, kind = "standard", id = randomUUID()) {
  const at = iso();
  database.prepare(`
    INSERT INTO processes (id, workspace_id, name, description, kind, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(id, workspaceId, required(name, "Name"), String(description ?? ""), kind, at, at);
  const insert = database.prepare(`
    INSERT INTO stages (id, process_id, name, position, driver, completion_rules, is_terminal, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  stages.forEach((stage, position) => {
    const stageName = typeof stage === "string" ? stage : stage.name;
    const definition = typeof stage === "string" ? {
      name: stageName,
      driver: position === stages.length - 1 ? "terminal" : /review/i.test(stageName) ? "review" : "agent"
    } : stage;
    insert.run(
      randomUUID(), id, required(definition.name, "Stage"), position,
      definition.driver ?? "manual", String(definition.instructions ?? ""),
      definition.driver === "terminal" || position === stages.length - 1 ? 1 : 0
    );
  });
  return id;
}

export function processStageNames(value, label = "process") {
  const names = Array.isArray(value) ? value.map((entry) => required(entry, "Stage")) : [];
  if (names.length < 2 || names.length > 12) throw new Error(`A ${label} needs 2 to 12 stages`);
  if (new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length)
    throw new Error("Stage names must be unique");
  return names;
}

/** An empty Templates screen gives a new user nowhere to start, so ship a few worth copying. */
const STARTER_TEMPLATES = [
  ["Research and report", "Gather sources, draft the findings, get them checked",
    ["Research", "Draft", "Review", "Done"]],
  ["Fix a bug", "Reproduce it before touching anything, then prove the fix",
    ["Reproduce", "Fix", "Verify", "Done"]],
  ["Write and publish", "Take a rough idea through to something shipped",
    ["Outline", "Write", "Edit", "Publish"]]
];

export function insertWorkspaceDefaults(database, workspaceId) {
  insertProcess(database, workspaceId, "Goals", "Autonomous outcomes executed and reviewed by DSH", [
    {
      name: "Work", driver: "agent",
      instructions: GOALS_WORK_INSTRUCTIONS
    },
    {
      name: "Review", driver: "review",
      instructions: GOALS_REVIEW_INSTRUCTIONS
    },
    { name: "Done", driver: "terminal" }
  ], "goals");
  const at = iso();
  for (const [name, description, stages] of STARTER_TEMPLATES)
    database.prepare("INSERT INTO process_templates VALUES (?, ?, ?, ?, ?, NULL, ?, ?)")
      .run(randomUUID(), workspaceId, name, description, JSON.stringify(stages), at, at);
  ensureAgentDefaults(database, workspaceId);
}

export function initializeProductDatabase(database) {
  const version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
  if (version < 5) database.exec(`
    DROP TRIGGER IF EXISTS bees_item_search_insert;
    DROP TRIGGER IF EXISTS bees_item_search_update;
    DROP TRIGGER IF EXISTS bees_item_search_delete;
    DROP TABLE IF EXISTS bees_search;
    DROP TABLE IF EXISTS bees_proposals;
    DROP TABLE IF EXISTS bees_connected_organizations;
    DROP TABLE IF EXISTS bees_account;
    DROP TABLE IF EXISTS bees_run_checkpoints;
    DROP TABLE IF EXISTS bees_stage_results;
    DROP TABLE IF EXISTS dsh_deliveries;
    DROP TABLE IF EXISTS dsh_audit_events;
    DROP TABLE IF EXISTS bees_domain_receipts;
    DROP TABLE IF EXISTS bees_schedules;
    DROP TABLE IF EXISTS agent_dispatches;
    DROP TABLE IF EXISTS work_item_locations;
    DROP TABLE IF EXISTS process_locations;
    DROP TABLE IF EXISTS device_location_mappings;
    DROP TABLE IF EXISTS team_locations;
    DROP TABLE IF EXISTS execution_links;
    DROP TABLE IF EXISTS dsh_runs;
    DROP TABLE IF EXISTS work_items;
    DROP TABLE IF EXISTS stage_routes;
    DROP TABLE IF EXISTS stages;
    DROP TABLE IF EXISTS processes;
    DROP TABLE IF EXISTS agent_pool_members;
    DROP TABLE IF EXISTS agent_pools;
    DROP TABLE IF EXISTS agent_assignments;
    DROP TABLE IF EXISTS file_locations;
    DROP TABLE IF EXISTS workspaces;
    DROP TABLE IF EXISTS team_memberships;
    DROP TABLE IF EXISTS teams;
    DROP TABLE IF EXISTS organization_memberships;
    DROP TABLE IF EXISTS organizations;
    DROP TABLE IF EXISTS devices;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS settings;
    PRAGMA user_version = 5;
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, personal INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS organization_memberships (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'auditor')),
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, organization_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL, personal INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS team_memberships (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, team_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS bees_account (
      slot INTEGER PRIMARY KEY CHECK (slot = 1), user_id TEXT NOT NULL,
      email TEXT NOT NULL, name TEXT NOT NULL, token TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS bees_connected_organizations (
      organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      account_user_id TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      dsh_workspace_id TEXT UNIQUE, name TEXT NOT NULL,
      authority TEXT NOT NULL DEFAULT 'local' CHECK (authority IN ('local', 'connected')),
      hosting TEXT NOT NULL DEFAULT 'device' CHECK (hosting IN ('device', 'bees-cloud', 'company')),
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS agent_assignments (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      preset_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '', model TEXT, reasoning_effort TEXT,
      system_role TEXT CHECK (system_role IN ('worker', 'reviewer')),
      capabilities_json TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1,
      max_concurrency INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, name)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS agent_pools (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', archived_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(workspace_id, name)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS agent_pool_members (
      pool_id TEXT NOT NULL REFERENCES agent_pools(id) ON DELETE CASCADE,
      agent_assignment_id TEXT NOT NULL REFERENCES agent_assignments(id) ON DELETE CASCADE,
      priority INTEGER NOT NULL DEFAULT 100, enabled INTEGER NOT NULL DEFAULT 1,
      last_assigned_at TEXT, PRIMARY KEY (pool_id, agent_assignment_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS processes (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard', 'goals')),
      archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS process_templates (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', stages_json TEXT NOT NULL,
      archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS stages (
      id TEXT PRIMARY KEY, process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
      name TEXT NOT NULL, position INTEGER NOT NULL,
      driver TEXT NOT NULL DEFAULT 'manual' CHECK (driver IN ('manual', 'agent', 'review', 'terminal')),
      completion_rules TEXT NOT NULL DEFAULT '',
      is_terminal INTEGER NOT NULL DEFAULT 0, archived_at TEXT, UNIQUE(process_id, position)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS stage_routes (
      stage_id TEXT PRIMARY KEY REFERENCES stages(id) ON DELETE CASCADE,
      agent_assignment_id TEXT REFERENCES agent_assignments(id) ON DELETE RESTRICT,
      agent_pool_id TEXT REFERENCES agent_pools(id) ON DELETE RESTRICT,
      required_capabilities_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      CHECK (agent_assignment_id IS NULL OR agent_pool_id IS NULL)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS work_items (
      id TEXT PRIMARY KEY, process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL REFERENCES stages(id), parent_id TEXT REFERENCES work_items(id),
      kind TEXT NOT NULL DEFAULT 'work' CHECK (kind IN ('goal', 'run', 'work')),
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', owner TEXT,
      agent_assignment_id TEXT REFERENCES agent_assignments(id), priority TEXT NOT NULL DEFAULT 'normal',
      runtime_phase TEXT NOT NULL DEFAULT 'ready'
        CHECK (runtime_phase IN ('ready', 'running', 'waiting', 'paused', 'failed', 'completed', 'cancelled')),
      runtime_attempt INTEGER NOT NULL DEFAULT 0, runtime_review_cycle INTEGER NOT NULL DEFAULT 0,
      runtime_execution_id TEXT, runtime_error TEXT,
      archived_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS agent_dispatches (
      execution_id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL REFERENCES stages(id),
      target_type TEXT NOT NULL CHECK (target_type IN ('item', 'agent', 'pool', 'workspace-default')),
      target_id TEXT NOT NULL,
      agent_assignment_id TEXT NOT NULL REFERENCES agent_assignments(id),
      reason TEXT NOT NULL, agent_revision TEXT NOT NULL,
      agent_config_json TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS team_locations (
      id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      logical_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('file', 'folder')), description TEXT NOT NULL DEFAULT '',
      archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(team_id, name)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS device_location_mappings (
      location_id TEXT NOT NULL REFERENCES team_locations(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      absolute_path TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (location_id, device_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS work_item_locations (
      work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      location_id TEXT NOT NULL REFERENCES team_locations(id),
      relative_path TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (work_item_id, location_id, relative_path)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS process_locations (
      process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
      location_id TEXT NOT NULL REFERENCES team_locations(id),
      relative_path TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (process_id, location_id, relative_path)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS bees_proposals (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      dsh_session_id TEXT, title TEXT NOT NULL, summary TEXT NOT NULL,
      changes_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE VIRTUAL TABLE IF NOT EXISTS bees_search USING fts5(kind UNINDEXED, ref_id UNINDEXED, title, body);
    CREATE TRIGGER IF NOT EXISTS bees_item_search_insert AFTER INSERT ON work_items BEGIN
      INSERT INTO bees_search(kind, ref_id, title, body) VALUES ('item', new.id, new.title, new.description);
    END;
    CREATE TRIGGER IF NOT EXISTS bees_item_search_update AFTER UPDATE OF title, description ON work_items BEGIN
      DELETE FROM bees_search WHERE kind = 'item' AND ref_id = old.id;
      INSERT INTO bees_search(kind, ref_id, title, body) VALUES ('item', new.id, new.title, new.description);
    END;
    CREATE TRIGGER IF NOT EXISTS bees_item_search_delete AFTER DELETE ON work_items BEGIN
      DELETE FROM bees_search WHERE kind = 'item' AND ref_id = old.id;
    END;
    CREATE INDEX IF NOT EXISTS bees_workspaces_team ON workspaces(team_id, created_at);
    CREATE INDEX IF NOT EXISTS bees_processes_workspace ON processes(workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS bees_stages_process ON stages(process_id, position);
    CREATE INDEX IF NOT EXISTS bees_items_stage ON work_items(stage_id, updated_at);
    CREATE INDEX IF NOT EXISTS bees_pool_members_agent ON agent_pool_members(agent_assignment_id, pool_id);
    CREATE INDEX IF NOT EXISTS bees_dispatches_item ON agent_dispatches(work_item_id, created_at);
    CREATE INDEX IF NOT EXISTS bees_locations_team ON team_locations(team_id, name);
  `);
  const assignmentColumns = new Set(database.prepare("PRAGMA table_info(agent_assignments)").all().map(({ name }) => name));
  if (!assignmentColumns.has("instructions")) database.exec("ALTER TABLE agent_assignments ADD COLUMN instructions TEXT NOT NULL DEFAULT ''");
  if (!assignmentColumns.has("model")) database.exec("ALTER TABLE agent_assignments ADD COLUMN model TEXT");
  if (!assignmentColumns.has("reasoning_effort")) database.exec("ALTER TABLE agent_assignments ADD COLUMN reasoning_effort TEXT");
  if (!assignmentColumns.has("system_role")) database.exec("ALTER TABLE agent_assignments ADD COLUMN system_role TEXT");
  if (!assignmentColumns.has("capabilities_json")) database.exec("ALTER TABLE agent_assignments ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]'");
  if (!assignmentColumns.has("enabled")) database.exec("ALTER TABLE agent_assignments ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
  if (!assignmentColumns.has("max_concurrency")) database.exec("ALTER TABLE agent_assignments ADD COLUMN max_concurrency INTEGER NOT NULL DEFAULT 0");
  // Which MCP servers this agent may use: 'all' (every connected one), 'none', or 'listed'.
  // Existing agents default to 'all', which is what they already had.
  if (!assignmentColumns.has("mcp_access")) database.exec("ALTER TABLE agent_assignments ADD COLUMN mcp_access TEXT NOT NULL DEFAULT 'all'");
  if (!assignmentColumns.has("mcp_servers_json")) database.exec("ALTER TABLE agent_assignments ADD COLUMN mcp_servers_json TEXT NOT NULL DEFAULT '[]'");
  const dispatchColumns = new Set(database.prepare("PRAGMA table_info(agent_dispatches)").all().map(({ name }) => name));
  if (!dispatchColumns.has("agent_config_json")) database.exec("ALTER TABLE agent_dispatches ADD COLUMN agent_config_json TEXT NOT NULL DEFAULT '{}'");
  database.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      server_name TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      transport TEXT NOT NULL,
      command TEXT NOT NULL DEFAULT '',
      args_json TEXT NOT NULL DEFAULT '[]',
      url TEXT NOT NULL DEFAULT '',
      env_names_json TEXT NOT NULL DEFAULT '[]',
      header_names_json TEXT NOT NULL DEFAULT '[]',
      catalog_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS bees_assignment_system_role
      ON agent_assignments(workspace_id, system_role) WHERE system_role IS NOT NULL;
    UPDATE stages SET driver = CASE
      WHEN is_terminal = 1 THEN 'terminal'
      WHEN lower(name) LIKE '%review%' THEN 'review'
      ELSE 'agent'
    END;
    PRAGMA user_version = 8;
  `);
  if (version < 8) {
    database.prepare(`
      UPDATE stages SET completion_rules = ? WHERE name = 'Work' AND archived_at IS NULL
        AND process_id IN (SELECT id FROM processes WHERE kind = 'goals' AND archived_at IS NULL)
    `).run(GOALS_WORK_INSTRUCTIONS);
    database.prepare(`
      UPDATE stages SET completion_rules = ? WHERE name = 'Review' AND archived_at IS NULL
        AND process_id IN (SELECT id FROM processes WHERE kind = 'goals' AND archived_at IS NULL)
    `).run(GOALS_REVIEW_INSTRUCTIONS);
  }
  if (database.prepare("SELECT 1 FROM users LIMIT 1").get()) {
    database.exec(`
      UPDATE organizations SET name = 'Personal Org' WHERE personal = 1 AND name = 'Personal';
      UPDATE teams SET name = 'Team1' WHERE personal = 1 AND name = 'Personal';
    `);
    for (const { id } of database.prepare("SELECT id FROM workspaces WHERE status = 'active'").all())
      ensureAgentDefaults(database, id);
    database.exec(`
      UPDATE work_items SET agent_assignment_id = (
        SELECT a.id FROM processes p JOIN agent_assignments a
          ON a.workspace_id = p.workspace_id AND a.system_role = 'worker'
        WHERE p.id = work_items.process_id
      ) WHERE agent_assignment_id IS NULL;
    `);
    return;
  }
  transaction(database, () => {
    const at = iso();
    const userId = randomUUID();
    const deviceId = randomUUID();
    const organizationId = randomUUID();
    const teamId = randomUUID();
    const workspaceId = randomUUID();
    database.prepare("INSERT INTO users VALUES (?, 'You', ?, ?)").run(userId, at, at);
    database.prepare("INSERT INTO devices VALUES (?, 'This device', ?, ?)").run(deviceId, at, at);
    database.prepare(`INSERT INTO organizations VALUES (?, 'Personal Org', 1, ?, 'active', ?, ?)`)
      .run(organizationId, userId, at, at);
    database.prepare("INSERT INTO organization_memberships VALUES (?, ?, 'owner', 'active', ?)")
      .run(userId, organizationId, at);
    database.prepare(`INSERT INTO teams VALUES (?, ?, 'Team1', 1, ?, 'active', ?, ?)`)
      .run(teamId, organizationId, userId, at, at);
    database.prepare("INSERT INTO team_memberships VALUES (?, ?, 'admin', 'active', ?)")
      .run(userId, teamId, at);
    database.prepare(`
      INSERT INTO workspaces VALUES (?, ?, NULL, 'My workspace', 'local', 'device', 'active', ?, ?)
    `).run(workspaceId, teamId, at, at);
    insertWorkspaceDefaults(database, workspaceId);
  });
}
/**
 * The MCP servers one agent may use, as the names its tools are prefixed with.
 *
 * Read by id at dispatch, not carried through routing: a rerun reuses its recorded agent config,
 * which would pin a policy the owner has since changed.
 */
export function mcpGrantFor(database, agentAssignmentId) {
  const row = database.prepare(`
    SELECT mcp_access AS access, mcp_servers_json AS servers FROM agent_assignments WHERE id = ?
  `).get(required(agentAssignmentId, "Agent"));
  if (!row) throw new Error("Agent not found");
  if (row.access !== "listed") return { mcpAccess: row.access, mcpServers: [] };
  return {
    mcpAccess: "listed",
    mcpServers: database.prepare(`
      SELECT server_name AS name FROM mcp_servers
      WHERE id IN (SELECT value FROM json_each(?)) AND enabled = 1
    `).all(row.servers).map(({ name }) => name)
  };
}
