import { createHash, randomUUID } from "node:crypto";
import { EXECUTIVE_AGENTS } from "./executive-agents.js";

export const DEFAULT_WORKSPACE_NAME = "Default workspace";

export const iso = () => new Date().toISOString();
export const message = (error) => error instanceof Error ? error.message : String(error);
/** Same thing for a person: SQLite names tables and columns, which means nothing in a form. */
export function userMessage(error) {
  const text = message(error);
  if (!text.startsWith("UNIQUE constraint failed:")) return text;
  return text.includes(".name") ? "That name is already taken here" : "That already exists";
}
// Tauri always sets this before it starts the harness, so a missing value is a broken launch,
// not a case to fall back on. Falling back put the browser profile somewhere that does not survive.
export function stateDirectory() {
  const directory = process.env.BEES_STATE_DIR;
  if (!directory) throw new Error("Bees did not provide its state directory");
  return directory;
}
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
  `).get(required(workspaceId, "Team"));
  if (!row) throw new Error("Team not found");
  return { ...row, membership: requireTeam(database, row.teamId, roles) };
}

export function itemContext(database, itemId, roles = ["admin", "member", "viewer"]) {
  const row = database.prepare(`
    SELECT w.id, w.title, w.description, w.process_id AS processId, w.stage_id AS stageId,
           w.parent_id AS parentId, w.kind, w.agent_assignment_id AS agentAssignmentId,
           w.agent_ids_json AS agentIds,
           w.owner, w.priority, w.run_settings_json AS runSettingsJson,
           w.account_user_id AS accountUserId,
           w.output_location_id AS outputLocationId, w.recurring_work_id AS recurringWorkId,
           p.workspace_id AS workspaceId, p.kind AS processKind
    FROM work_items w JOIN processes p ON p.id = w.process_id
    WHERE w.id = ? AND w.deleted_at IS NULL
  `).get(required(itemId, "Work item"));
  if (!row) throw new Error("Work item not found");
  workspaceContext(database, row.workspaceId, roles);
  return {
    ...row,
    agentIds: agentIds(JSON.parse(row.agentIds || "[]")),
    runSettings: JSON.parse(row.runSettingsJson || "{}")
  };
}

export function processContext(database, processId, roles = ["admin", "member", "viewer"]) {
  const row = database.prepare(`
    SELECT id, workspace_id AS workspaceId, name, description, kind,
           output_location_id AS outputLocationId
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

export function agentIds(value, label = "Agents") {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
  const ids = value.map((id) => required(id, "Agent"));
  if (ids.length > 8) throw new Error(`${label} can contain at most eight agents`);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} cannot contain the same agent twice`);
  return ids;
}

export function optionalReasoningEffort(value) {
  const effort = String(value ?? "").trim();
  if (effort.length > 100) throw new Error("Reasoning effort must be at most 100 characters");
  return effort || null;
}

/** A model is a provider/model route. Saving a bare name stored fine and then failed every run
 *  it was used for, which is a long way from where the mistake was made. */
export function optionalModelRoute(value) {
  const route = String(value ?? "").trim();
  if (route && !route.includes("/")) throw new Error(`"${route}" is not a provider/model route`);
  return route || null;
}

export function agentCapabilities(agent) {
  return capabilities(Array.isArray(agent?.capabilities)
    ? agent.capabilities : JSON.parse(agent?.capabilities || "[]"));
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
    WHERE EXISTS (SELECT 1 FROM json_each(d.agent_ids_json) WHERE value = ?) AND (
      e.status IN ('queued', 'running', 'waiting_for_input', 'waiting_for_approval')
      OR (e.execution_id IS NULL AND d.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes'))
    )
  `).get(agentId).count);
}

function ensureAgentDefaults(database, workspaceId, at = iso()) {
  for (const agent of EXECUTIVE_AGENTS) {
    // Stable identities preserve edits (including renames and disabling) on restart and sync.
    database.prepare(`INSERT OR IGNORE INTO agent_assignments
      (id, workspace_id, preset_id, name, description, instructions, capabilities_json, created_at, updated_at)
      SELECT ?, ?, 'standard', ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM agent_assignments WHERE workspace_id = ? AND name = ? COLLATE NOCASE
      )`).run(stableUuid(`${workspaceId}:executive:${agent.name}`), workspaceId,
        agent.name, agent.description, agent.instructions, JSON.stringify(agent.capabilities), at, at,
        workspaceId, agent.name);
  }
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

/** The default Work roster plans together, then its lead executes. Preserve custom routing. */
function ensureGoalDiscussion(database, workspaceId, at = iso()) {
  const stage = database.prepare(`
    SELECT s.id, p.id AS processId FROM stages s JOIN processes p ON p.id = s.process_id
    WHERE p.workspace_id = ? AND p.kind = 'goals' AND p.archived_at IS NULL
      AND s.position = 0 AND s.name = 'Work' AND s.driver = 'agent' AND s.archived_at IS NULL
  `).get(workspaceId);
  if (!stage) return;
  const worker = defaultAssignment(database, workspaceId);
  const reviewer = defaultAssignment(database, workspaceId, "reviewer");
  const route = database.prepare("SELECT * FROM stage_routes WHERE stage_id = ?").get(stage.id);
  if (route && (route.required_capabilities_json !== "[]" ||
      route.agent_assignment_id !== worker.id || !["[]", JSON.stringify([worker.id])].includes(route.agent_ids_json))) return;
  database.prepare(`INSERT INTO stage_routes
    (stage_id, agent_assignment_id, agent_ids_json, required_capabilities_json, created_at, updated_at)
    VALUES (?, ?, ?, '[]', ?, ?)
    ON CONFLICT(stage_id) DO UPDATE SET agent_ids_json = excluded.agent_ids_json, updated_at = excluded.updated_at
  `).run(stage.id, worker.id, JSON.stringify([worker.id, reviewer.id]), at, at);
  database.prepare("UPDATE processes SET updated_at = ? WHERE id = ?").run(at, stage.processId);
}

export function insertProcess(
  database, workspaceId, name, description, stages, kind = "standard", id = randomUUID(), at = iso(), accountUserId = null
) {
  database.prepare(`
    INSERT INTO processes (id, workspace_id, name, description, kind, output_location_id, account_user_id, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)
  `).run(id, workspaceId, required(name, "Name"), String(description ?? ""), kind, accountUserId || null, at, at);
  const insert = database.prepare(`
    INSERT INTO stages (id, process_id, name, position, driver, requires_human_approval, is_terminal, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  stages.forEach((stage, position) => {
    const name = required(typeof stage === "string" ? stage : stage.name, "Stage");
    const driver = stageDriver(stage, position, stages.length);
    const requiresApproval = typeof stage === "object" && stage?.requiresHumanApproval !== undefined
      ? Boolean(stage.requiresHumanApproval) : /\b(?:approval|sign[- ]?off)\b/i.test(name);
    insert.run(stableUuid(`${id}:stage:${position}`), id, name, position, driver,
      requiresApproval ? 1 : 0, driver === "terminal" ? 1 : 0);
  });
  return id;
}

/** Stages describe process structure. Agent guidance belongs to agents and specialists. */
export function processStages(value, label = "process") {
  const entries = Array.isArray(value) ? value : [];
  const stages = entries.map((entry, position) => ({
    name: required(typeof entry === "string" ? entry : entry?.name, "Stage"),
    driver: stageDriver(entry, position, entries.length),
    requiresHumanApproval: typeof entry === "object" && entry?.requiresHumanApproval !== undefined
      ? Boolean(entry.requiresHumanApproval)
      : /\b(?:approval|sign[- ]?off)\b/i.test(String(typeof entry === "string" ? entry : entry?.name))
  }));
  if (stages.length < 2 || stages.length > 12) throw new Error(`A ${label} needs 2 to 12 stages`);
  if (new Set(stages.map(({ name }) => name.toLocaleLowerCase())).size !== stages.length)
    throw new Error("Stage names must be unique");
  return stages;
}

function stageDriver(stage, position, count) {
  const explicit = typeof stage === "object" ? stage?.driver : null;
  if (explicit && !["manual", "agent", "discussion", "review", "terminal"].includes(explicit))
    throw new Error(`Unsupported stage driver: ${explicit}`);
  const name = String(typeof stage === "string" ? stage : stage?.name ?? "");
  // An approval gate is agent work that waits for a person, which requires_human_approval already
  // does. Reading it as a manual step instead makes the whole process non-automatic, so a pipeline
  // with a stage called "Human approval" sits at ready and never runs a thing.
  return explicit ?? (position === count - 1 ? "terminal"
    : /\b(?:discuss|discussion|debate|roundtable)\b/i.test(name) ? "discussion"
      : /\b(?:approval|sign[- ]?off)\b/i.test(name) ? "agent"
        : /\b(?:human|inbox|manual)\b/i.test(name) ? "manual"
          : position > 0 && /review/i.test(name) ? "review" : "agent");
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

function insertWorkspaceDefaults(database, workspaceId, at = iso()) {
  insertProcess(database, workspaceId, "Goals", "Autonomous outcomes executed and independently reviewed by agents", [
    { name: "Work", driver: "agent" },
    { name: "Review", driver: "review" },
    { name: "Done", driver: "terminal" }
  ], "goals", stableUuid(`${workspaceId}:goals`), at);
  for (const [name, description, stages] of STARTER_TEMPLATES)
    database.prepare("INSERT INTO process_templates VALUES (?, ?, ?, ?, ?, NULL, ?, ?)")
      .run(stableUuid(`${workspaceId}:template:${name}`), workspaceId, name, description,
        JSON.stringify(processStages(stages, "starter template")), at, at);
  ensureAgentDefaults(database, workspaceId, at);
  ensureGoalDiscussion(database, workspaceId, at);
}

export function insertDefaultWorkspace(database, teamId, {
  id = randomUUID(), dshWorkspaceId = null, authority = "local", at = iso()
} = {}) {
  database.prepare(`
    INSERT INTO workspaces
      (id, team_id, dsh_workspace_id, name, authority, hosting, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'device', 'active', ?, ?)
  `).run(id, teamId, dshWorkspaceId, DEFAULT_WORKSPACE_NAME, authority, at, at);
  insertWorkspaceDefaults(database, id, at);
  return { id, dshWorkspaceId };
}

export function assertMcpAccess(access) {
  if (!["all", "none", "listed"].includes(access)) throw new Error("Choose all, none, or listed MCP servers");
  return access;
}

export function initializeProductDatabase(database) {
  const version = Number(database.prepare("PRAGMA user_version").get().user_version);
  if (version < 17) database.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TRIGGER IF EXISTS bees_item_search_insert;
    DROP TRIGGER IF EXISTS bees_item_search_update;
    DROP TRIGGER IF EXISTS bees_item_search_delete;
    DROP TABLE IF EXISTS bees_search;
    DROP TABLE IF EXISTS bees_proposals;
    DROP TABLE IF EXISTS bees_connected_organizations;
    DROP TABLE IF EXISTS bees_account;
    DROP TABLE IF EXISTS bees_sign_in_attempts;
    DROP TABLE IF EXISTS bees_run_checkpoints;
    DROP TABLE IF EXISTS bees_stage_results;
    DROP TABLE IF EXISTS dsh_deliveries;
    DROP TABLE IF EXISTS dsh_audit_events;
    DROP TABLE IF EXISTS bees_domain_receipts;
    DROP TABLE IF EXISTS bees_work_receipts;
    DROP TABLE IF EXISTS bees_schedules;
    DROP TABLE IF EXISTS agent_dispatches;
    DROP TABLE IF EXISTS work_item_locations;
    DROP TABLE IF EXISTS process_locations;
    DROP TABLE IF EXISTS agent_locations;
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
    DROP TABLE IF EXISTS bees_recurring_executors;
    DROP TABLE IF EXISTS agent_specialization_versions;
    DROP TABLE IF EXISTS agent_specializations;
    DROP TABLE IF EXISTS recurring_work;
    DROP TABLE IF EXISTS process_templates;
    DROP TABLE IF EXISTS bees_connection_sync_cursors;
    DROP TABLE IF EXISTS bees_connection_teams;
    DROP TABLE IF EXISTS bees_connections;
    DROP TABLE IF EXISTS bees_accounts;
    DROP TABLE IF EXISTS mcp_servers;
    PRAGMA user_version = 17;
    PRAGMA foreign_keys = ON;
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
    CREATE TABLE IF NOT EXISTS bees_accounts (
      user_id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
    ) STRICT;
    -- Runs that happened on someone else's device. Kept out of execution_links on purpose: the
    -- runtime scans that table on boot and would try to recover a run it never started.
    CREATE TABLE IF NOT EXISTS bees_remote_runs (
      execution_id TEXT PRIMARY KEY, work_item_id TEXT, stage_id TEXT,
      agent_assignment_id TEXT, agent_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL, mode TEXT, reason TEXT, agent_revision TEXT,
      outcome TEXT, summary TEXT, started_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS bees_directory (
      user_id TEXT PRIMARY KEY, email TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS bees_sign_in_attempts (
      state TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS bees_connections (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      account_user_id TEXT NOT NULL REFERENCES bees_accounts(user_id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(organization_id, account_user_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS bees_connection_teams (
      connection_id TEXT NOT NULL REFERENCES bees_connections(id) ON DELETE CASCADE,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(connection_id, team_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS bees_connection_sync_cursors (
      connection_id TEXT PRIMARY KEY REFERENCES bees_connections(id) ON DELETE CASCADE,
      cursor TEXT NOT NULL DEFAULT '0', synced_at TEXT NOT NULL
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
    CREATE TABLE IF NOT EXISTS processes (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard', 'goals')),
      output_location_id TEXT REFERENCES team_locations(id),
      account_user_id TEXT,
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
      driver TEXT NOT NULL DEFAULT 'manual' CHECK (driver IN ('manual', 'agent', 'discussion', 'review', 'terminal')),
      requires_human_approval INTEGER NOT NULL DEFAULT 0,
      is_terminal INTEGER NOT NULL DEFAULT 0, archived_at TEXT, UNIQUE(process_id, position)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS stage_routes (
      stage_id TEXT PRIMARY KEY REFERENCES stages(id) ON DELETE CASCADE,
      agent_assignment_id TEXT REFERENCES agent_assignments(id) ON DELETE RESTRICT,
      required_capabilities_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      agent_ids_json TEXT NOT NULL DEFAULT '[]'
    ) STRICT;
    CREATE TABLE IF NOT EXISTS recurring_work (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
      source_work_item_id TEXT NOT NULL, name TEXT NOT NULL,
      schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('interval', 'calendar', 'cron')),
      schedule_json TEXT NOT NULL, timezone TEXT,
      temporal_schedule_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
      next_run_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, name)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS bees_recurring_executors (
      recurring_work_id TEXT NOT NULL REFERENCES recurring_work(id) ON DELETE CASCADE,
      account_user_id TEXT NOT NULL,
      temporal_schedule_id TEXT NOT NULL UNIQUE, next_run_at TEXT,
      PRIMARY KEY(recurring_work_id, account_user_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS work_items (
      id TEXT PRIMARY KEY, process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL REFERENCES stages(id), parent_id TEXT REFERENCES work_items(id),
      kind TEXT NOT NULL DEFAULT 'work' CHECK (kind IN ('goal', 'run', 'work')),
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', owner TEXT,
      agent_assignment_id TEXT REFERENCES agent_assignments(id),
      agent_ids_json TEXT NOT NULL DEFAULT '[]', priority TEXT NOT NULL DEFAULT 'normal',
      runtime_phase TEXT NOT NULL DEFAULT 'ready'
        CHECK (runtime_phase IN ('ready', 'running', 'waiting', 'paused', 'failed', 'completed', 'cancelled')),
      runtime_attempt INTEGER NOT NULL DEFAULT 0, runtime_review_cycle INTEGER NOT NULL DEFAULT 0,
      runtime_execution_id TEXT, runtime_error TEXT,
      output_location_id TEXT REFERENCES team_locations(id),
      recurring_work_id TEXT REFERENCES recurring_work(id),
      account_user_id TEXT,
      archived_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS agent_specializations (
      id TEXT PRIMARY KEY, recurring_work_id TEXT NOT NULL REFERENCES recurring_work(id) ON DELETE CASCADE,
      agent_assignment_id TEXT NOT NULL REFERENCES agent_assignments(id) ON DELETE CASCADE,
      name TEXT NOT NULL, playbook TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(recurring_work_id, agent_assignment_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS agent_specialization_versions (
      id TEXT PRIMARY KEY,
      specialization_id TEXT NOT NULL REFERENCES agent_specializations(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, playbook TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('feedback', 'manual', 'undo', 'reset')),
      feedback TEXT, execution_id TEXT, created_at TEXT NOT NULL,
      UNIQUE(specialization_id, revision)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS agent_dispatches (
      execution_id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL REFERENCES stages(id),
      target_type TEXT NOT NULL CHECK (target_type IN ('item', 'agent', 'workspace-default')),
      target_id TEXT NOT NULL,
      agent_assignment_id TEXT NOT NULL REFERENCES agent_assignments(id),
      agent_ids_json TEXT NOT NULL DEFAULT '[]',
      specialization_id TEXT REFERENCES agent_specializations(id),
      reason TEXT NOT NULL, agent_revision TEXT NOT NULL,
      agent_config_json TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS bees_work_receipts (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, idempotency_key)
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
    CREATE TABLE IF NOT EXISTS app_process_owners (process_id TEXT PRIMARY KEY, installation_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS app_agent_owners (agent_id TEXT PRIMARY KEY, installation_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_locations (
      agent_assignment_id TEXT NOT NULL REFERENCES agent_assignments(id) ON DELETE CASCADE,
      location_id TEXT NOT NULL REFERENCES team_locations(id),
      relative_path TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (agent_assignment_id, location_id, relative_path)
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
    CREATE INDEX IF NOT EXISTS bees_dispatches_item ON agent_dispatches(work_item_id, created_at);
    CREATE INDEX IF NOT EXISTS bees_recurring_source ON recurring_work(source_work_item_id);
    CREATE INDEX IF NOT EXISTS bees_specializations_recurring ON agent_specializations(recurring_work_id);
    CREATE INDEX IF NOT EXISTS bees_locations_team ON team_locations(team_id, name);
  `);
  const accountColumns = new Set(database.prepare("PRAGMA table_info(bees_accounts)").all().map(({ name }) => name));
  if (!accountColumns.has("enabled")) database.exec(
    "ALTER TABLE bees_accounts ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1"
  );
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
  const processColumns = new Set(database.prepare("PRAGMA table_info(processes)").all().map(({ name }) => name));
  if (!processColumns.has("output_location_id")) database.exec(
    "ALTER TABLE processes ADD COLUMN output_location_id TEXT REFERENCES team_locations(id)"
  );
  if (!processColumns.has("account_user_id")) database.exec(
    "ALTER TABLE processes ADD COLUMN account_user_id TEXT"
  );
  const itemColumns = new Set(database.prepare("PRAGMA table_info(work_items)").all().map(({ name }) => name));
  if (!itemColumns.has("agent_ids_json")) database.exec(
    "ALTER TABLE work_items ADD COLUMN agent_ids_json TEXT NOT NULL DEFAULT '[]'"
  );
  if (!itemColumns.has("run_settings_json")) database.exec(
    "ALTER TABLE work_items ADD COLUMN run_settings_json TEXT NOT NULL DEFAULT '{}'"
  );
  if (!itemColumns.has("output_location_id")) database.exec(
    "ALTER TABLE work_items ADD COLUMN output_location_id TEXT REFERENCES team_locations(id)"
  );
  if (!itemColumns.has("recurring_work_id")) database.exec(
    "ALTER TABLE work_items ADD COLUMN recurring_work_id TEXT REFERENCES recurring_work(id)"
  );
  if (!itemColumns.has("account_user_id")) database.exec(
    "ALTER TABLE work_items ADD COLUMN account_user_id TEXT"
  );
  const dispatchColumns = new Set(database.prepare("PRAGMA table_info(agent_dispatches)").all().map(({ name }) => name));
  if (!dispatchColumns.has("agent_ids_json")) database.exec(
    "ALTER TABLE agent_dispatches ADD COLUMN agent_ids_json TEXT NOT NULL DEFAULT '[]'"
  );
  if (!dispatchColumns.has("agent_config_json")) database.exec("ALTER TABLE agent_dispatches ADD COLUMN agent_config_json TEXT NOT NULL DEFAULT '{}'");
  if (!dispatchColumns.has("specialization_id")) database.exec(
    "ALTER TABLE agent_dispatches ADD COLUMN specialization_id TEXT REFERENCES agent_specializations(id)"
  );
  const stageColumns = new Set(database.prepare("PRAGMA table_info(stages)").all().map(({ name }) => name));
  if (stageColumns.has("completion_rules")) database.exec("ALTER TABLE stages DROP COLUMN completion_rules");
  const routeColumns = new Set(database.prepare("PRAGMA table_info(stage_routes)").all().map(({ name }) => name));
  if (!routeColumns.has("agent_ids_json")) database.exec(
    "ALTER TABLE stage_routes ADD COLUMN agent_ids_json TEXT NOT NULL DEFAULT '[]'"
  );
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
  `);
  if (version < 18) {
    // A stage that named a pool has to keep its roster before version 23 drops the pool tables.
    if (database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'agent_pool_members'").get())
      for (const route of database.prepare(`
        SELECT r.stage_id AS stageId, r.agent_pool_id AS poolId, s.driver
        FROM stage_routes r JOIN stages s ON s.id = r.stage_id
        WHERE r.agent_assignment_id IS NULL AND r.agent_pool_id IS NOT NULL
      `).all()) {
        const members = database.prepare(`
          SELECT a.id FROM agent_pool_members m JOIN agent_assignments a ON a.id = m.agent_assignment_id
          WHERE m.pool_id = ? AND m.enabled = 1 AND a.enabled = 1 ORDER BY m.priority, a.id LIMIT 8
        `).all(route.poolId).map(({ id }) => id);
        const ids = route.driver === "discussion" ? members : members.slice(0, 1);
        database.prepare("UPDATE stage_routes SET agent_assignment_id = ?, agent_ids_json = ? WHERE stage_id = ?")
          .run(ids[0] ?? null, JSON.stringify(ids), route.stageId);
      }
    database.exec(`
      UPDATE stage_routes SET agent_ids_json = json_array(agent_assignment_id)
      WHERE agent_assignment_id IS NOT NULL AND agent_ids_json = '[]';
      UPDATE work_items SET agent_ids_json = json_array(agent_assignment_id)
      WHERE agent_assignment_id IS NOT NULL AND agent_ids_json = '[]';
      UPDATE agent_dispatches SET agent_ids_json = json_array(agent_assignment_id)
      WHERE agent_ids_json = '[]';
      PRAGMA user_version = 18;
    `);
  }
  // An installed browser server still carries the arguments that shared one profile across runs.
  if (version < 19) database.exec(`
    UPDATE mcp_servers
      SET args_json = '["-y","@playwright/mcp@latest","--headless","--isolated","--storage-state","{browserState}"]'
      WHERE catalog_id = 'playwright';
    PRAGMA user_version = 19;
  `);
  // The code preset is called ptc now, and an assignment naming the old key resolves to nothing.
  if (version < 20) database.exec(`
    UPDATE agent_assignments SET preset_id = 'ptc' WHERE preset_id = 'code';
    PRAGMA user_version = 20;
  `);
  if (version < 22) transaction(database, () => {
    for (const { id } of database.prepare("SELECT id FROM workspaces WHERE status = 'active'").all()) {
      ensureAgentDefaults(database, id);
      ensureGoalDiscussion(database, id);
    }
    database.exec("PRAGMA user_version = 22");
  });
  if (version < 24) database.exec(`
    DROP TABLE IF EXISTS bees_run_limit_requests;
    DROP TABLE IF EXISTS bees_run_limit_sessions;
    PRAGMA user_version = 24;
  `);
  // Agent pools are gone: a stage names its agents directly, so the column, the tables and the
  // dispatch target they supported go with them.
  if (version < 23) {
    database.exec("PRAGMA foreign_keys = OFF");
    transaction(database, () => database.exec(`
    CREATE TABLE stage_routes_next (
      stage_id TEXT PRIMARY KEY REFERENCES stages(id) ON DELETE CASCADE,
      agent_assignment_id TEXT REFERENCES agent_assignments(id) ON DELETE RESTRICT,
      required_capabilities_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      agent_ids_json TEXT NOT NULL DEFAULT '[]'
    ) STRICT;
    INSERT INTO stage_routes_next
      SELECT stage_id, agent_assignment_id, required_capabilities_json, created_at, updated_at, agent_ids_json
      FROM stage_routes;
    DROP TABLE stage_routes;
    ALTER TABLE stage_routes_next RENAME TO stage_routes;
    CREATE TABLE agent_dispatches_next (
      execution_id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL REFERENCES stages(id),
      target_type TEXT NOT NULL CHECK (target_type IN ('item', 'agent', 'workspace-default')),
      target_id TEXT NOT NULL,
      agent_assignment_id TEXT NOT NULL REFERENCES agent_assignments(id),
      agent_ids_json TEXT NOT NULL DEFAULT '[]',
      specialization_id TEXT REFERENCES agent_specializations(id),
      reason TEXT NOT NULL, agent_revision TEXT NOT NULL,
      agent_config_json TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO agent_dispatches_next
      SELECT execution_id, work_item_id, stage_id,
             CASE target_type WHEN 'pool' THEN 'agent' ELSE target_type END,
             target_id, agent_assignment_id, agent_ids_json, specialization_id,
             reason, agent_revision, agent_config_json, created_at
      FROM agent_dispatches;
    DROP TABLE agent_dispatches;
    ALTER TABLE agent_dispatches_next RENAME TO agent_dispatches;
    CREATE INDEX IF NOT EXISTS bees_dispatches_item ON agent_dispatches(work_item_id, created_at);
    DROP TABLE IF EXISTS agent_pool_members;
    DROP TABLE IF EXISTS agent_pools;
    PRAGMA user_version = 23;
  `));
    database.exec("PRAGMA foreign_keys = ON");
  }
  // Starter templates stored bare stage names; every other template stored shaped ones. The
  // rewrite has to move updated_at too, or the server keeps the old shape at the newer version.
  if (version < 25) transaction(database, () => {
    for (const row of database.prepare(
      "SELECT id, stages_json AS stages, updated_at AS updatedAt FROM process_templates"
    ).all()) {
      let shaped;
      // A row this cannot convert keeps what it has. Throwing here would fail the boot.
      try {
        const stages = JSON.parse(row.stages);
        if (!Array.isArray(stages) || !stages.some((stage) => typeof stage === "string")) continue;
        shaped = JSON.stringify(processStages(stages, "process template"));
      } catch { continue; }
      // The push reads a version off updated_at, and the server only takes a strictly newer one.
      const previous = Date.parse(row.updatedAt);
      const at = new Date(Math.max(Date.now(), (previous || 0) + 1)).toISOString();
      database.prepare("UPDATE process_templates SET stages_json = ?, updated_at = ? WHERE id = ?")
        .run(shaped, at, row.id);
    }
    // No marker means no connection ever proved it finished the apps-v1 replay, so they all owe it.
    const proven = database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'bees_app_sync_versions'").get()
      ? "SELECT connection_id FROM bees_app_sync_versions" : "SELECT NULL WHERE 0";
    database.exec(`
      DELETE FROM bees_connection_sync_cursors WHERE connection_id NOT IN (${proven});
      DROP TABLE IF EXISTS bees_app_sync_versions;
      PRAGMA user_version = 25;
    `);
  });
  if (database.prepare("SELECT 1 FROM users LIMIT 1").get()) {
    database.exec(`
      UPDATE organizations SET name = 'Personal Org' WHERE personal = 1 AND name = 'Personal';
      UPDATE teams SET name = 'Team1' WHERE personal = 1 AND name = 'Personal';
    `);
    for (const { id } of database.prepare(`
      SELECT id FROM teams WHERE status = 'active' AND NOT EXISTS (
        SELECT 1 FROM workspaces WHERE team_id = teams.id AND status = 'active'
      )
    `).all()) insertDefaultWorkspace(database, id);
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
    insertDefaultWorkspace(database, teamId, { id: workspaceId, at });
  });
}
/**
 * The MCP servers one agent may use, as the names its tools are prefixed with.
 *
 * Read by id at dispatch, not carried through routing: a rerun reuses its recorded agent config,
 * which would pin a policy the owner has since changed.
 */
export function mcpGrantFor(database, agentAssignmentId, runSettings = {}) {
  const row = database.prepare(`
    SELECT mcp_access AS access, mcp_servers_json AS servers FROM agent_assignments WHERE id = ?
  `).get(required(agentAssignmentId, "Agent"));
  if (!row) throw new Error("Agent not found");
  if (row.access === "none" || runSettings.mcpAccess === "none") return { mcpAccess: "none", mcpServers: [] };
  if (row.access !== "listed" && runSettings.mcpAccess !== "listed") return { mcpAccess: row.access, mcpServers: [] };
  // A goal can narrow an agent's tool access, never widen its configured policy.
  const servers = row.access === "listed" ? JSON.parse(row.servers) : runSettings.mcpServers;
  const allowed = runSettings.mcpAccess === "listed"
    ? servers.filter((id) => runSettings.mcpServers.includes(id)) : servers;
  return {
    mcpAccess: "listed",
    mcpServers: database.prepare(`
      SELECT server_name AS name FROM mcp_servers
      WHERE id IN (SELECT value FROM json_each(?)) AND enabled = 1
    `).all(JSON.stringify(allowed)).map(({ name }) => name)
  };
}

/** Goal overrides travel with work; validate remote metadata as well as local commands. */
export function normalizeRunSettings(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Run settings must be an object");
  for (const key of Object.keys(value))
    if (!["model", "reasoningEffort", "mcpAccess", "mcpServers"].includes(key)) throw new Error(`Unknown run setting: ${key}`);
  const settings = {};
  if (Object.hasOwn(value, "model")) {
    if (value.model !== null && (typeof value.model !== "string" || value.model.length > 512 || !/^[^/\s]+\/\S+$/.test(value.model)))
      throw new Error("Choose a valid provider/model or the system default");
    settings.model = value.model;
    settings.reasoningEffort = optionalReasoningEffort(value.reasoningEffort);
  } else if (value.reasoningEffort) throw new Error("Choose a model before setting reasoning effort");
  if (Object.hasOwn(value, "mcpAccess")) {
    assertMcpAccess(value.mcpAccess);
    if (value.mcpServers !== undefined && (!Array.isArray(value.mcpServers) || value.mcpServers.length > 128 ||
        value.mcpServers.some((id) => typeof id !== "string" || !id || id.length > 128)))
      throw new Error("Choose valid MCP server identifiers");
    settings.mcpAccess = value.mcpAccess;
    settings.mcpServers = value.mcpAccess === "listed" ? [...new Set(value.mcpServers ?? [])] : [];
    if (value.mcpAccess === "listed" && !settings.mcpServers.length) throw new Error("Choose at least one MCP server, or pick none");
  } else if (value.mcpServers !== undefined) throw new Error("Choose a tool access policy");
  return settings;
}
