import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync
} from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";

const iso = () => new Date().toISOString();
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml",
  ".html", ".css", ".js", ".ts", ".py", ".rs", ".toml"
]);

function stableUuid(value) {
  const hex = createHash("sha256").update(String(value)).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  const text = hex.join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

function required(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function transaction(database, work) {
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

function currentIdentity(database) {
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

function requireTeam(database, teamId, roles = ["admin", "member", "viewer"]) {
  const row = membership(database, required(teamId, "Team"));
  const role = row?.role ?? (row && ["owner", "admin"].includes(row.organizationRole) ? "admin" : null);
  if (!row || !roles.includes(role)) throw new Error("You do not have permission for this team");
  return { ...row, role };
}

function workspaceContext(database, workspaceId, roles = ["admin", "member", "viewer"]) {
  const row = database.prepare(`
    SELECT id, team_id AS teamId, name, dsh_workspace_id AS dshWorkspaceId,
           authority, hosting, status
    FROM workspaces WHERE id = ? AND status = 'active'
  `).get(required(workspaceId, "Workspace"));
  if (!row) throw new Error("Workspace not found");
  return { ...row, membership: requireTeam(database, row.teamId, roles) };
}

function itemContext(database, itemId, roles = ["admin", "member", "viewer"]) {
  const row = database.prepare(`
    SELECT w.id, w.title, w.description, w.process_id AS processId, w.stage_id AS stageId,
           w.kind, w.agent_assignment_id AS agentAssignmentId, p.workspace_id AS workspaceId
    FROM work_items w JOIN processes p ON p.id = w.process_id
    WHERE w.id = ? AND w.deleted_at IS NULL
  `).get(required(itemId, "Work item"));
  if (!row) throw new Error("Work item not found");
  workspaceContext(database, row.workspaceId, roles);
  return row;
}

function processContext(database, processId, roles = ["admin", "member", "viewer"]) {
  const row = database.prepare(`
    SELECT id, workspace_id AS workspaceId, name, description, kind
    FROM processes WHERE id = ? AND archived_at IS NULL
  `).get(required(processId, "Process"));
  if (!row) throw new Error("Process not found");
  workspaceContext(database, row.workspaceId, roles);
  return row;
}

function parentFor(database, itemId, processId, parentId) {
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

function defaultAssignment(database, workspaceId, role = "worker") {
  return database.prepare(`
    SELECT id, preset_id AS presetId, name, description, instructions, model, system_role AS systemRole
    FROM agent_assignments WHERE workspace_id = ? AND system_role = ? LIMIT 1
  `).get(workspaceId, role);
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

function mappedLocation(database, locationId) {
  const { deviceId } = currentIdentity(database);
  return database.prepare(`
    SELECT l.id, l.name, l.kind, l.team_id AS teamId, m.absolute_path AS localPath
    FROM team_locations l
    LEFT JOIN device_location_mappings m ON m.location_id = l.id AND m.device_id = ?
    WHERE l.id = ? AND l.archived_at IS NULL
  `).get(deviceId, locationId);
}

function canonicalMapping(path, kind) {
  const canonical = realpathSync(required(path, kind === "file" ? "File" : "Folder"));
  const stat = lstatSync(canonical);
  if (stat.isSymbolicLink() || (kind === "file" ? !stat.isFile() : !stat.isDirectory()))
    throw new Error(`The selected path is not a ${kind}`);
  return canonical;
}

function logicalRelativePath(value) {
  const raw = String(value ?? "").trim().replaceAll("\\", "/");
  if (!raw) return "";
  if (raw.startsWith("/") || /^[a-zA-Z]:\//.test(raw) || raw.includes("\0"))
    throw new Error("A location reference must be a relative path");
  const parts = raw.split("/").filter((part) => part && part !== ".");
  if (parts.includes("..")) throw new Error("A location reference cannot leave its mapped location");
  return parts.join("/");
}

function walkLocation(location, onFile) {
  const root = realpathSync(location.localPath);
  const rootStat = lstatSync(root);
  if (location.kind === "file") {
    if (!rootStat.isFile()) throw new Error(`${location.name} is not available as a file on this device`);
    onFile(root, basename(root));
    return;
  }
  if (!rootStat.isDirectory()) throw new Error(`${location.name} is not available as a folder on this device`);
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) onFile(path, relative(root, path));
    }
  }
}

function indexLocation(database, location) {
  database.prepare("DELETE FROM bees_search WHERE kind = 'file' AND ref_id LIKE ?")
    .run(`${location.id}:%`);
  const insert = database.prepare(
    "INSERT INTO bees_search(kind, ref_id, title, body) VALUES ('file', ?, ?, ?)"
  );
  let seen = 0;
  walkLocation(location, (path, logical) => {
    if (seen >= 2_000 || !TEXT_EXTENSIONS.has(extname(path).toLowerCase())) return;
    const stat = lstatSync(path);
    if (stat.size > 1_000_000 || !logical || logical === ".." || logical.startsWith(`..${sep}`)) return;
    insert.run(`${location.id}:${logical}`, `${location.name}/${logical}`, readFileSync(path, "utf8"));
    seen += 1;
  });
}

function stageLocation(location, destination) {
  let files = 0;
  let bytes = 0;
  walkLocation(location, (source, logical) => {
    if (files >= 1_000 || bytes >= 250_000_000) return;
    const stat = lstatSync(source);
    const target = resolve(destination, logical);
    if (!logical || logical === ".." || logical.startsWith(`..${sep}`) || !target.startsWith(`${destination}${sep}`)) return;
    if (stat.size > 20_000_000 || bytes + stat.size > 250_000_000) return;
    mkdirSync(resolve(target, ".."), { recursive: true });
    copyFileSync(source, target);
    files += 1;
    bytes += stat.size;
  });
}

function stagedLocation(location, relativePath) {
  const relativeName = String(relativePath ?? "").trim();
  if (!relativeName) return location;
  if (location.kind === "file") throw new Error(`${location.name} is already a file and cannot use a child path`);
  const root = realpathSync(location.localPath);
  const selected = realpathSync(resolve(root, relativeName));
  if (selected !== root && !selected.startsWith(`${root}${sep}`))
    throw new Error(`The reference for ${location.name} escaped its mapped folder`);
  const stat = lstatSync(selected);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error(`The reference for ${location.name} is unavailable`);
  return { ...location, localPath: selected, kind: stat.isFile() ? "file" : "folder" };
}

function stageInputs(database, itemId, runDirectory) {
  const inputRoot = resolve(runDirectory, "inputs");
  mkdirSync(inputRoot, { recursive: true });
  mkdirSync(resolve(runDirectory, "outputs"), { recursive: true });
  const { deviceId } = currentIdentity(database);
  const locations = database.prepare(`
    WITH refs(location_id, relative_path) AS (
      SELECT location_id, relative_path FROM work_item_locations WHERE work_item_id = ?
      UNION
      SELECT pl.location_id, pl.relative_path FROM process_locations pl
      JOIN work_items wi ON wi.process_id = pl.process_id WHERE wi.id = ?
    )
    SELECT l.id, l.name, l.kind, r.relative_path AS relativePath, m.absolute_path AS localPath
    FROM refs r
    JOIN team_locations l ON l.id = r.location_id
    JOIN work_items w ON w.id = ?
    JOIN processes p ON p.id = w.process_id
    JOIN workspaces ws ON ws.id = p.workspace_id AND ws.team_id = l.team_id
    LEFT JOIN device_location_mappings m ON m.location_id = l.id AND m.device_id = ?
    WHERE l.archived_at IS NULL ORDER BY l.name
  `).all(itemId, itemId, itemId, deviceId);
  for (const location of locations) {
    if (!location.localPath) throw new Error(`${location.name} is not mapped on this device`);
    const selected = stagedLocation(location, location.relativePath);
    const suffix = location.relativePath
      ? `-${createHash("sha256").update(location.relativePath).digest("hex").slice(0, 8)}`
      : "";
    const directory = resolve(inputRoot, `${location.name.replace(/[^a-zA-Z0-9._-]+/g, "-")}-${location.id.slice(0, 8)}${suffix}`);
    mkdirSync(directory, { recursive: true });
    stageLocation(selected, directory);
  }
  return locations;
}

function outputFiles(runDirectory) {
  const root = resolve(runDirectory, "outputs");
  try {
    const canonical = realpathSync(root);
    const files = [];
    const stack = [canonical];
    while (stack.length && files.length < 100) {
      const directory = stack.pop();
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) stack.push(path);
        else if (entry.isFile()) files.push(relative(canonical, path));
        if (files.length >= 100) break;
      }
    }
    return files;
  } catch {
    return [];
  }
}

function insertProcess(database, workspaceId, name, description, stages, kind = "standard", id = randomUUID()) {
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

function insertWorkspaceDefaults(database, workspaceId) {
  insertProcess(database, workspaceId, "Goals", "Autonomous outcomes executed and reviewed by DSH", [
    {
      name: "Work", driver: "agent",
      instructions: "Own the outcome, plan the work, use todos, and delegate independent subtasks to DSH subagents. Continue until the deliverable is genuinely ready for review."
    },
    {
      name: "Review", driver: "review",
      instructions: "Independently inspect the candidate deliverables and evidence. Pass only when the requested outcome is actually complete; otherwise return specific revision feedback."
    },
    { name: "Done", driver: "terminal" }
  ], "goals");
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
    DROP TABLE IF EXISTS work_item_locations;
    DROP TABLE IF EXISTS process_locations;
    DROP TABLE IF EXISTS device_location_mappings;
    DROP TABLE IF EXISTS team_locations;
    DROP TABLE IF EXISTS execution_links;
    DROP TABLE IF EXISTS dsh_runs;
    DROP TABLE IF EXISTS work_items;
    DROP TABLE IF EXISTS stages;
    DROP TABLE IF EXISTS processes;
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
      instructions TEXT NOT NULL DEFAULT '', model TEXT,
      system_role TEXT CHECK (system_role IN ('worker', 'reviewer')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, name)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS processes (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard', 'goals')),
      archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS stages (
      id TEXT PRIMARY KEY, process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
      name TEXT NOT NULL, position INTEGER NOT NULL,
      driver TEXT NOT NULL DEFAULT 'manual' CHECK (driver IN ('manual', 'agent', 'review', 'terminal')),
      completion_rules TEXT NOT NULL DEFAULT '',
      is_terminal INTEGER NOT NULL DEFAULT 0, archived_at TEXT, UNIQUE(process_id, position)
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
    CREATE INDEX IF NOT EXISTS bees_locations_team ON team_locations(team_id, name);
  `);
  const assignmentColumns = new Set(database.prepare("PRAGMA table_info(agent_assignments)").all().map(({ name }) => name));
  if (!assignmentColumns.has("instructions")) database.exec("ALTER TABLE agent_assignments ADD COLUMN instructions TEXT NOT NULL DEFAULT ''");
  if (!assignmentColumns.has("model")) database.exec("ALTER TABLE agent_assignments ADD COLUMN model TEXT");
  if (!assignmentColumns.has("system_role")) database.exec("ALTER TABLE agent_assignments ADD COLUMN system_role TEXT");
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS bees_assignment_system_role
      ON agent_assignments(workspace_id, system_role) WHERE system_role IS NOT NULL;
    UPDATE stages SET driver = CASE
      WHEN is_terminal = 1 THEN 'terminal'
      WHEN lower(name) LIKE '%review%' THEN 'review'
      ELSE 'agent'
    END;
    PRAGMA user_version = 6;
  `);
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

export class BeesProduct {
  constructor(database, agents, processes, defaultWorkspace, services = {}) {
    this.database = database;
    this.agents = agents;
    this.processes = processes;
    this.defaultWorkspace = defaultWorkspace;
    this.workspaceRegistry = services.workspaceRegistry;
    this.agentPresets = services.agentPresets;
    initializeProductDatabase(database);
    this.agents?.setProposalStore?.((proposal) => this.storeProposal(proposal));
    this.agents?.setSubitemStore?.((input) => this.createSubitems(input));
  }

  async initialize() {
    mkdirSync(resolve(this.defaultWorkspace, "workspaces"), { recursive: true });
    mkdirSync(resolve(this.defaultWorkspace, "runs"), { recursive: true });
    if (!this.workspaceRegistry) return;
    for (const workspace of this.database.prepare(`
      SELECT id, name, dsh_workspace_id AS dshWorkspaceId FROM workspaces WHERE status = 'active'
    `).all()) {
      const path = resolve(this.defaultWorkspace, "workspaces", workspace.id);
      mkdirSync(path, { recursive: true });
      let record = workspace.dshWorkspaceId ? this.workspaceRegistry.get(workspace.dshWorkspaceId) : undefined;
      if (!record) record = await this.workspaceRegistry.create(path, workspace.name);
      if (String(record.id) !== workspace.dshWorkspaceId) this.database.prepare(`
        UPDATE workspaces SET dsh_workspace_id = ?, updated_at = ? WHERE id = ?
      `).run(String(record.id), iso(), workspace.id);
    }
  }

  async runProcessStage(stage, signal) {
    const item = itemContext(this.database, stage.workItemId, ["admin", "member"]);
    const executionId = required(stage.executionId, "Execution");
    const runDirectory = resolve(this.defaultWorkspace, "runs", executionId);
    const locations = stageInputs(this.database, item.id, runDirectory);
    if (stage.candidateExecutionId) {
      const candidate = this.database.prepare(`
        SELECT run_directory AS runDirectory FROM execution_links
        WHERE execution_id = ? AND work_item_id = ?
      `).get(stage.candidateExecutionId, item.id);
      if (!candidate) throw new Error("The review candidate is unavailable");
      const name = stage.purpose === "reviewer" ? "candidate" : "previous-candidate";
      const destination = resolve(runDirectory, "inputs", name);
      mkdirSync(destination, { recursive: true });
      stageLocation({ name, kind: "folder", localPath: resolve(candidate.runDirectory, "outputs") }, destination);
    }
    const reviewer = stage.purpose === "reviewer";
    const assignment = reviewer
      ? defaultAssignment(this.database, item.workspaceId, "reviewer")
      : item.agentAssignmentId ? this.database.prepare(`
        SELECT preset_id AS presetId, name, instructions, model
        FROM agent_assignments WHERE id = ? AND workspace_id = ?
      `).get(item.agentAssignmentId, item.workspaceId) : defaultAssignment(this.database, item.workspaceId);
    const feedback = stage.feedback ? `\n\nPrior review feedback:\n${stage.feedback}` : "";
    const body = reviewer
      ? `Independently review the candidate under inputs/candidate. Verify the real deliverables and run relevant checks. Call bees_submit_stage_result with pass or revise and concise evidence.\n\nGoal: ${item.title}\n\n${item.description}\n\nStage instructions: ${stage.instructions || "Review the completed work."}`
      : `Own this goal through a review-ready result. Plan with DSH goals/todos and delegate independent subtasks to subagents when useful. Put every deliverable under outputs/. Call bees_submit_stage_result with candidate only when the outcome is genuinely ready for independent review.\n\nGoal: ${item.title}\n\n${item.description}\n\nStage instructions: ${stage.instructions || "Complete the goal."}${feedback}`;
    return this.agents.executeStage(executionId, {
      idempotencyKey: `process:${executionId}:start`,
      workspace: runDirectory,
      body,
      initialData: {
        version: 1, mode: reviewer ? "review" : "work", stagePurpose: stage.purpose,
        executionId, workItemId: item.id,
        agentId: reviewer ? "bees-reviewer" : item.agentAssignmentId || "bees-run",
        agentName: reviewer ? "Bees reviewer" : assignment?.name || "Bees work agent",
        purpose: item.title, model: assignment?.model || null,
        instructions: [assignment?.instructions, stage.instructions].filter(Boolean).join("\n\n"),
        workspaceId: item.workspaceId, agentPresetId: assignment?.presetId || "standard",
        grants: reviewer ? [] : [...new Set(locations.map(({ id }) => id))]
      }
    }, signal);
  }

  async snapshot() {
    const { userId, deviceId } = currentIdentity(this.database);
    const organizations = this.database.prepare(`
      SELECT o.id, o.name, o.personal, om.role,
             connected.organization_id IS NOT NULL AS connected
      FROM organizations o JOIN organization_memberships om ON om.organization_id = o.id
      LEFT JOIN bees_connected_organizations connected ON connected.organization_id = o.id
      WHERE om.user_id = ? AND om.status = 'active' AND o.status = 'active' ORDER BY o.created_at
    `).all(userId).map((row) => ({
      ...row, personal: Boolean(row.personal), connected: Boolean(row.connected)
    }));
    const teams = this.database.prepare(`
      SELECT DISTINCT t.id, t.organization_id AS organizationId, t.name, t.personal,
             CASE WHEN connected.organization_id IS NOT NULL THEN tm.role
               ELSE coalesce(tm.role, CASE WHEN om.role IN ('owner','admin') THEN 'admin' END)
             END AS role
      FROM teams t JOIN organization_memberships om ON om.organization_id = t.organization_id
      LEFT JOIN team_memberships tm ON tm.team_id = t.id AND tm.user_id = ? AND tm.status = 'active'
      LEFT JOIN bees_connected_organizations connected ON connected.organization_id = t.organization_id
      WHERE om.user_id = ? AND om.status = 'active' AND t.status = 'active'
        AND (tm.user_id IS NOT NULL OR om.role IN ('owner','admin'))
      ORDER BY t.created_at
    `).all(userId, userId).map((row) => ({ ...row, personal: Boolean(row.personal) }));
    const allowedTeams = teams.map(({ id }) => id);
    const workspaces = allowedTeams.length ? this.database.prepare(`
      SELECT id, team_id AS teamId, dsh_workspace_id AS dshWorkspaceId, name, authority, hosting, status
      FROM workspaces WHERE team_id IN (SELECT value FROM json_each(?)) AND status = 'active'
      ORDER BY created_at
    `).all(JSON.stringify(allowedTeams)) : [];
    const workspaceIds = workspaces.map(({ id }) => id);
    const processes = workspaceIds.length ? this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, name, description, kind FROM processes
      WHERE workspace_id IN (SELECT value FROM json_each(?)) AND archived_at IS NULL ORDER BY created_at
    `).all(JSON.stringify(workspaceIds)) : [];
    const processIds = processes.map(({ id }) => id);
    const stages = processIds.length ? this.database.prepare(`
      SELECT id, process_id AS processId, name, position, driver,
             completion_rules AS instructions, is_terminal AS isTerminal
      FROM stages WHERE process_id IN (SELECT value FROM json_each(?)) AND archived_at IS NULL
      ORDER BY process_id, position
    `).all(JSON.stringify(processIds)).map((row) => ({ ...row, isTerminal: Boolean(row.isTerminal) })) : [];
    const items = processIds.length ? this.database.prepare(`
      SELECT w.id, w.process_id AS processId, w.stage_id AS stageId, w.parent_id AS parentId,
             w.kind, w.title, w.description, w.owner, w.agent_assignment_id AS agentAssignmentId,
             w.priority, w.runtime_phase AS runtimePhase, w.runtime_attempt AS runtimeAttempt,
             w.runtime_review_cycle AS runtimeReviewCycle,
             w.runtime_execution_id AS runtimeExecutionId, w.runtime_error AS runtimeError,
             w.archived_at AS archivedAt, w.updated_at AS updatedAt,
             s.is_terminal AS completed
      FROM work_items w JOIN stages s ON s.id = w.stage_id
      WHERE w.process_id IN (SELECT value FROM json_each(?)) AND w.deleted_at IS NULL
      ORDER BY w.updated_at DESC
    `).all(JSON.stringify(processIds)).map((row) => ({ ...row, completed: Boolean(row.completed) })) : [];
    const locations = allowedTeams.length ? this.database.prepare(`
      SELECT l.id, l.team_id AS teamId, l.logical_id AS logicalId, l.name, l.kind, l.description,
             l.archived_at AS archivedAt, m.absolute_path AS localPath
      FROM team_locations l
      LEFT JOIN device_location_mappings m ON m.location_id = l.id AND m.device_id = ?
      WHERE l.team_id IN (SELECT value FROM json_each(?)) ORDER BY l.name
    `).all(deviceId, JSON.stringify(allowedTeams)).map((row) => ({ ...row, mapped: Boolean(row.localPath) })) : [];
    const attachments = this.database.prepare(`
      SELECT work_item_id AS workItemId, location_id AS locationId, relative_path AS relativePath
      FROM work_item_locations ORDER BY work_item_id, location_id
    `).all();
    const processAttachments = this.database.prepare(`
      SELECT process_id AS processId, location_id AS locationId, relative_path AS relativePath
      FROM process_locations ORDER BY process_id, location_id
    `).all();
    const assignments = workspaceIds.length ? this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, preset_id AS presetId, name, description,
             instructions, model, system_role AS systemRole
      FROM agent_assignments WHERE workspace_id IN (SELECT value FROM json_each(?)) ORDER BY name
    `).all(JSON.stringify(workspaceIds)) : [];
    const runs = workspaceIds.length ? this.database.prepare(`
      SELECT execution_id AS id, workspace_id AS workspaceId, work_item_id AS workItemId,
             current_session_id AS sessionId, previous_session_id AS previousSessionId,
             status, run_directory AS runDirectory, updated_at AS updatedAt
      FROM execution_links WHERE workspace_id IN (SELECT value FROM json_each(?))
      ORDER BY updated_at DESC LIMIT 200
    `).all(JSON.stringify(workspaceIds)).map(({ runDirectory, ...run }) => ({
      ...run, outputs: outputFiles(runDirectory)
    })) : [];
    const schedules = [];
    const proposals = workspaceIds.length ? this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, dsh_session_id AS sessionId, title, summary,
             changes_json AS changes, status, created_at AS createdAt
      FROM bees_proposals WHERE workspace_id IN (SELECT value FROM json_each(?))
      ORDER BY created_at DESC LIMIT 100
    `).all(JSON.stringify(workspaceIds)).map((row) => ({ ...row, changes: JSON.parse(row.changes) })) : [];
    let presets = [];
    try {
      presets = this.agentPresets ? (await this.agentPresets.list()).map(({ id, name, description, broken, trust }) => ({
        id, name: name || id, description: description || "", broken: broken || null, trust
      })) : [];
    } catch { /* the Agents page reports the empty roster honestly */ }
    return {
      currentUserId: userId, currentDeviceId: deviceId, organizations, teams, workspaces,
      processes, stages, items, locations, attachments, processAttachments,
      assignments, presets, runs, schedules, proposals
    };
  }

  async references(query, workspaceId) {
    const workspace = workspaceContext(this.database, workspaceId);
    const term = `%${String(query ?? "").slice(0, 120)}%`;
    const lower = String(query ?? "").toLocaleLowerCase();
    const at = [
      ...this.database.prepare(`
        SELECT id, name AS label, 'agent' AS kind FROM agent_assignments
        WHERE workspace_id = ? AND name LIKE ? ORDER BY name LIMIT 20
      `).all(workspace.id, term),
      ...this.database.prepare(`SELECT id, name AS label, 'team' AS kind FROM teams WHERE id = ?`).all(workspace.teamId),
      ...this.database.prepare(`
        SELECT w.id, w.title AS label, 'work-item' AS kind
        FROM work_items w JOIN processes p ON p.id = w.process_id
        WHERE p.workspace_id = ? AND w.deleted_at IS NULL AND w.title LIKE ?
        ORDER BY w.updated_at DESC LIMIT 30
      `).all(workspace.id, term)
    ];
    const dollar = this.database.prepare(`
      SELECT id, name AS label, 'location' AS kind FROM team_locations
      WHERE team_id = ? AND archived_at IS NULL AND name LIKE ? ORDER BY name LIMIT 30
    `).all(workspace.teamId, term);
    return {
      at: at.filter(({ label }) => String(label).toLocaleLowerCase().includes(lower)).slice(0, 50),
      dollar: dollar.filter(({ label }) => String(label).toLocaleLowerCase().includes(lower)).slice(0, 50)
    };
  }

  search(query, workspaceId) {
    const workspace = workspaceContext(this.database, workspaceId);
    const normalized = String(query ?? "").trim().replace(/["*]/g, "");
    if (!normalized) return [];
    const { deviceId } = currentIdentity(this.database);
    for (const location of this.database.prepare(`
      SELECT l.id, l.name, l.kind, m.absolute_path AS localPath
      FROM team_locations l JOIN device_location_mappings m ON m.location_id = l.id
      WHERE l.team_id = ? AND l.archived_at IS NULL AND m.device_id = ?
    `).all(workspace.teamId, deviceId)) {
      try { indexLocation(this.database, location); } catch { /* unavailable mappings stay out of results */ }
    }
    const allowedItems = this.database.prepare(`
      SELECT w.id FROM work_items w JOIN processes p ON p.id = w.process_id
      WHERE p.workspace_id = ? AND w.deleted_at IS NULL
    `).all(workspace.id).map(({ id }) => id);
    const allowedLocations = this.database.prepare(`
      SELECT id FROM team_locations WHERE team_id = ? AND archived_at IS NULL
    `).all(workspace.teamId).map(({ id }) => id);
    return this.database.prepare(`
      SELECT kind, ref_id AS id, title, snippet(bees_search, 3, '', '', ' … ', 18) AS excerpt
      FROM bees_search WHERE bees_search MATCH ? ORDER BY bm25(bees_search) LIMIT 100
    `).all(`${normalized}*`).filter((row) => row.kind === "item"
      ? allowedItems.includes(row.id)
      : allowedLocations.some((id) => row.id.startsWith(`${id}:`))).slice(0, 50);
  }

  audit() {
    return this.database.prepare(`
      SELECT id, event_type AS type, execution_id AS executionId, metadata_json AS metadata,
             created_at AS createdAt FROM dsh_audit_events ORDER BY created_at DESC LIMIT 100
    `).all().map((row) => ({ ...row, metadata: JSON.parse(row.metadata) }));
  }

  async runHistory(executionId) {
    const id = required(executionId, "Run");
    const row = this.database.prepare(`
      SELECT workspace_id AS workspaceId FROM execution_links WHERE execution_id = ?
    `).get(id);
    if (!row) throw new Error("Run not found");
    workspaceContext(this.database, row.workspaceId);
    return this.agents.history(id);
  }

  storeProposal({ workspaceId, sessionId, title, summary, changes }) {
    workspaceContext(this.database, workspaceId, ["admin", "member"]);
    if (!Array.isArray(changes) || !changes.length || changes.length > 20)
      throw new Error("A proposal needs between 1 and 20 changes");
    const normalized = changes.map((change) => {
      if (!change || typeof change !== "object" || Array.isArray(change)) throw new Error("Proposal changes must be objects");
      if (change.action === "create_goal") return {
        action: "create_goal", title: required(change.title, "Goal title"),
        description: String(change.description ?? "")
      };
      if (change.action === "create_process") {
        const stages = Array.isArray(change.stages) ? change.stages.map((stage) => required(stage, "Stage")) : [];
        if (stages.length < 2 || stages.length > 12) throw new Error("A proposed process needs 2 to 12 stages");
        return {
          action: "create_process", name: required(change.name, "Process name"),
          description: String(change.description ?? ""), stages
        };
      }
      throw new Error(`Unsupported proposed action: ${change.action}`);
    });
    const id = randomUUID();
    const at = iso();
    this.database.prepare(`
      INSERT INTO bees_proposals VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, workspaceId, sessionId || null, required(title, "Proposal title"), String(summary ?? ""), JSON.stringify(normalized), at, at);
    return { id, changes: normalized.length };
  }

  async createSubitems({ parentId, items }) {
    const parent = itemContext(this.database, parentId, ["admin", "member"]);
    if (!Array.isArray(items) || !items.length || items.length > 25)
      throw new Error("A run can create between 1 and 25 sub-items at once");
    const created = [];
    for (const item of items) created.push(await this.command({ action: "create_item",
      processId: parent.processId,
      parentId: parent.id,
      title: required(item?.title, "Sub-item title"),
      description: String(item?.description ?? ""),
      agentAssignmentId: parent.agentAssignmentId
    }));
    return created;
  }

  async command(input) {
    const action = required(input?.action, "Action");
    try {
      const result = await this.execute(action, input);
      this.record(action, input, result, "ok");
      return result;
    } catch (error) {
      this.record(action, input, null, "error");
      throw error;
    }
  }

  record(action, input, result, outcome) {
    const metadata = { action, outcome };
    for (const key of ["organizationId", "teamId", "workspaceId", "processId", "stageId", "itemId", "parentId", "agentAssignmentId", "locationId", "scheduleId", "proposalId"])
      if (input[key]) metadata[key] = String(input[key]);
    if (result?.id) metadata.resultId = String(result.id);
    const executionId = result?.executionId ? String(result.executionId) : null;
    this.database.prepare(`
      INSERT INTO dsh_audit_events (id, event_type, execution_id, session_id, metadata_json, created_at)
      VALUES (?, ?, ?, NULL, ?, ?)
    `).run(randomUUID(), `domain-${action}`, executionId, JSON.stringify(metadata), iso());
  }

  async execute(action, input) {
    const at = iso();
    if (action === "create_organization") return transaction(this.database, () => {
      const { userId } = currentIdentity(this.database);
      const id = randomUUID();
      this.database.prepare(`INSERT INTO organizations VALUES (?, ?, 0, ?, 'active', ?, ?)`)
        .run(id, required(input.name, "Organization name"), userId, at, at);
      this.database.prepare("INSERT INTO organization_memberships VALUES (?, ?, 'owner', 'active', ?)")
        .run(userId, id, at);
      return { id };
    });
    if (action === "create_team") return transaction(this.database, () => {
      const { userId } = currentIdentity(this.database);
      const organizationId = required(input.organizationId, "Organization");
      if (!this.database.prepare(`
        SELECT 1 FROM organization_memberships WHERE user_id = ? AND organization_id = ? AND status = 'active'
      `).get(userId, organizationId)) throw new Error("You are not a member of this organization");
      const id = randomUUID();
      this.database.prepare(`INSERT INTO teams VALUES (?, ?, ?, 0, ?, 'active', ?, ?)`)
        .run(id, organizationId, required(input.name, "Team name"), userId, at, at);
      this.database.prepare("INSERT INTO team_memberships VALUES (?, ?, 'admin', 'active', ?)")
        .run(userId, id, at);
      return { id };
    });
    if (action === "create_workspace") {
      const teamId = required(input.teamId, "Team");
      requireTeam(this.database, teamId, ["admin", "member"]);
      const id = randomUUID();
      const name = required(input.name, "Workspace name");
      const path = resolve(this.defaultWorkspace, "workspaces", id);
      mkdirSync(path, { recursive: true });
      const dshWorkspace = this.workspaceRegistry ? await this.workspaceRegistry.create(path, name) : null;
      return transaction(this.database, () => {
        this.database.prepare(`
          INSERT INTO workspaces VALUES (?, ?, ?, ?, 'local', 'device', 'active', ?, ?)
        `).run(id, teamId, dshWorkspace ? String(dshWorkspace.id) : null, name, at, at);
        insertWorkspaceDefaults(this.database, id);
        return { id, dshWorkspaceId: dshWorkspace ? String(dshWorkspace.id) : null };
      });
    }
    if (["create_item", "create_run", "create_goal"].includes(action)) {
      const created = transaction(this.database, () => {
      let processId = input.processId ? required(input.processId, "Process") : null;
      if (action === "create_goal") {
        const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
        processId = this.database.prepare(`
          SELECT id FROM processes WHERE workspace_id = ? AND kind = 'goals' AND archived_at IS NULL LIMIT 1
        `).get(workspace.id)?.id;
      }
      const process = this.database.prepare(`
        SELECT id, workspace_id AS workspaceId FROM processes WHERE id = ? AND archived_at IS NULL
      `).get(processId);
      if (!process) throw new Error("Process not found");
      workspaceContext(this.database, process.workspaceId, ["admin", "member"]);
      const stageId = input.stageId || this.database.prepare(`
        SELECT id FROM stages WHERE process_id = ? AND archived_at IS NULL ORDER BY position LIMIT 1
      `).get(processId)?.id;
      if (!stageId || !this.database.prepare(`
        SELECT 1 FROM stages WHERE id = ? AND process_id = ? AND archived_at IS NULL
      `).get(stageId, processId)) throw new Error("Process has no matching stage");
      const assignmentId = input.agentAssignmentId || defaultAssignment(this.database, process.workspaceId)?.id;
      if (!assignmentId) throw new Error("A work item requires an agent");
      if (assignmentId && !this.database.prepare(`
        SELECT 1 FROM agent_assignments WHERE id = ? AND workspace_id = ?
      `).get(assignmentId, process.workspaceId)) throw new Error("Agent assignment is not in this workspace");
      const id = randomUUID();
      const parentId = action === "create_run" ? null : parentFor(this.database, id, processId, input.parentId);
      const kind = action === "create_goal" ? "goal" : action === "create_run" ? "run" : "work";
      this.database.prepare(`
        INSERT INTO work_items (id, process_id, stage_id, parent_id, kind, title, description, owner,
          agent_assignment_id, priority, archived_at, deleted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      `).run(id, processId, stageId, parentId, kind, required(input.title, "Title"), String(input.description ?? ""),
        input.owner ? String(input.owner) : null, assignmentId, String(input.priority ?? "normal"), at, at);
        return { id };
      });
      await this.processes.startItem(created.id);
      return created;
    }
    if (action === "edit_item") return transaction(this.database, () => {
      const item = itemContext(this.database, input.itemId, ["admin", "member"]);
      const parentId = parentFor(this.database, item.id, item.processId, input.parentId);
      const assignmentId = input.agentAssignmentId || item.agentAssignmentId || defaultAssignment(this.database, item.workspaceId)?.id;
      if (!assignmentId) throw new Error("A work item requires an agent");
      if (assignmentId && !this.database.prepare(`
        SELECT 1 FROM agent_assignments WHERE id = ? AND workspace_id = ?
      `).get(assignmentId, item.workspaceId)) throw new Error("Agent assignment is not in this workspace");
      this.database.prepare(`
        UPDATE work_items SET title = ?, description = ?, owner = ?, agent_assignment_id = ?,
          priority = ?, parent_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL
      `).run(required(input.title, "Title"), String(input.description ?? ""), input.owner ? String(input.owner) : null,
        assignmentId, String(input.priority ?? "normal"), parentId, at, item.id);
      return {};
    });
    if (action === "move_item") {
      const item = itemContext(this.database, input.itemId, ["admin", "member"]);
      return this.processes.move(item.id, required(input.stageId, "Stage"));
    }
    if (action === "archive_item") {
      const item = itemContext(this.database, input.itemId, ["admin", "member"]);
      return this.processes.archive(item.id, Boolean(input.restore));
    }
    if (["pause_item", "resume_item", "retry_item", "cancel_item"].includes(action)) {
      const item = itemContext(this.database, input.itemId, ["admin", "member"]);
      return this.processes.signal(item.id, action.replace("_item", ""));
    }
    if (action === "create_process") return transaction(this.database, () => {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      const stages = Array.isArray(input.stages) ? input.stages.map((value) => required(value, "Stage")) : [];
      if (stages.length < 2 || stages.length > 12) throw new Error("A process needs 2 to 12 stages");
      if (new Set(stages.map((name) => name.toLocaleLowerCase())).size !== stages.length)
        throw new Error("Stage names must be unique");
      return { id: insertProcess(this.database, workspace.id, input.name, input.description, stages) };
    });
    if (action === "edit_process") return transaction(this.database, () => {
      const processId = required(input.processId, "Process");
      const process = this.database.prepare(`SELECT workspace_id AS workspaceId FROM processes WHERE id = ?`).get(processId);
      if (!process) throw new Error("Process not found");
      workspaceContext(this.database, process.workspaceId, ["admin", "member"]);
      if (this.processes.isAutomatic(processId) && this.database.prepare(`
        SELECT 1 FROM work_items WHERE process_id = ? AND deleted_at IS NULL
          AND runtime_phase NOT IN ('completed', 'cancelled') LIMIT 1
      `).get(processId)) throw new Error("Finish or cancel active automatic work before editing this process");
      const names = Array.isArray(input.stages) ? input.stages.map((value) => required(value, "Stage")) : [];
      if (names.length < 2 || names.length > 12) throw new Error("A process needs 2 to 12 stages");
      if (new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length)
        throw new Error("Stage names must be unique");
      const existing = this.database.prepare(`
        SELECT id, name FROM stages WHERE process_id = ? AND archived_at IS NULL ORDER BY position
      `).all(processId);
      const assigned = Array(names.length).fill(null);
      const used = new Set();
      names.forEach((name, index) => {
        const stage = existing.find((row) => !used.has(row.id) && row.name.toLocaleLowerCase() === name.toLocaleLowerCase());
        if (stage) { assigned[index] = stage; used.add(stage.id); }
      });
      names.forEach((_name, index) => {
        if (assigned[index]) return;
        const stage = existing.find(({ id }) => !used.has(id));
        if (stage) { assigned[index] = stage; used.add(stage.id); }
      });
      for (const stage of existing.filter(({ id }) => !used.has(id))) {
        if (this.database.prepare("SELECT 1 FROM work_items WHERE stage_id = ? AND deleted_at IS NULL").get(stage.id))
          throw new Error(`Move work out of “${stage.name}” before removing it`);
      }
      this.database.prepare("UPDATE stages SET position = -position - 1 WHERE process_id = ? AND archived_at IS NULL").run(processId);
      existing.filter(({ id }) => !used.has(id)).forEach(({ id }) =>
        this.database.prepare("DELETE FROM stages WHERE id = ?").run(id));
      names.forEach((name, position) => {
        const driver = position === names.length - 1 ? "terminal" : /review/i.test(name) ? "review" : "agent";
        if (assigned[position]) this.database.prepare(`
          UPDATE stages SET name = ?, position = ?, driver = ?, is_terminal = ? WHERE id = ?
        `).run(name, position, driver, position === names.length - 1 ? 1 : 0, assigned[position].id);
        else this.database.prepare(`
          INSERT INTO stages VALUES (?, ?, ?, ?, ?, '', ?, NULL)
        `).run(randomUUID(), processId, name, position, driver, position === names.length - 1 ? 1 : 0);
      });
      this.database.prepare(`UPDATE processes SET name = ?, description = ?, updated_at = ? WHERE id = ?`)
        .run(required(input.name, "Name"), String(input.description ?? ""), at, processId);
      return { id: processId };
    });
    if (action === "add_agent_assignment") {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      const presetId = required(input.presetId, "DSH preset");
      if (this.agentPresets) {
        const presets = await this.agentPresets.list();
        const preset = presets.find(({ id }) => id === presetId);
        if (!preset || preset.broken) throw new Error("The DSH preset is unavailable");
      }
      return transaction(this.database, () => {
        const id = randomUUID();
        this.database.prepare(`
          INSERT INTO agent_assignments
            (id, workspace_id, preset_id, name, description, instructions, model, system_role, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `).run(id, workspace.id, presetId, required(input.name, "Agent name"),
          String(input.description ?? ""), String(input.instructions ?? ""), input.model || null, at, at);
        return { id };
      });
    }
    if (action === "edit_agent_assignment") {
      const id = required(input.agentAssignmentId, "Agent");
      const assignment = this.database.prepare(`
        SELECT workspace_id AS workspaceId, name, system_role AS systemRole
        FROM agent_assignments WHERE id = ?
      `).get(id);
      if (!assignment) throw new Error("Agent not found");
      workspaceContext(this.database, assignment.workspaceId, ["admin", "member"]);
      const presetId = required(input.presetId, "DSH preset");
      if (this.agentPresets) {
        const preset = (await this.agentPresets.list()).find(({ id }) => id === presetId);
        if (!preset || preset.broken) throw new Error("The DSH preset is unavailable");
      }
      this.database.prepare(`
        UPDATE agent_assignments SET preset_id = ?, name = ?, description = ?, instructions = ?,
          model = ?, updated_at = ? WHERE id = ?
      `).run(presetId, assignment.systemRole ? assignment.name : required(input.name, "Agent name"),
        String(input.description ?? ""), String(input.instructions ?? ""), input.model || null, at, id);
      return { id };
    }
    if (action === "add_location") {
      const teamId = required(input.teamId, "Team");
      requireTeam(this.database, teamId, ["admin"]);
      const kind = input.kind === "file" ? "file" : "folder";
      const canonical = input.path ? canonicalMapping(input.path, kind) : null;
      return transaction(this.database, () => {
        const id = randomUUID();
        const { deviceId } = currentIdentity(this.database);
        this.database.prepare(`
          INSERT INTO team_locations VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `).run(id, teamId, stableUuid(`${teamId}:${id}`), required(input.name, "Name"), kind, String(input.description ?? ""), at, at);
        if (canonical) this.database.prepare(`INSERT INTO device_location_mappings VALUES (?, ?, ?, ?)`)
          .run(id, deviceId, canonical, at);
        return { id };
      });
    }
    if (action === "map_location") {
      const location = mappedLocation(this.database, required(input.locationId, "Location"));
      if (!location) throw new Error("Location not found");
      requireTeam(this.database, location.teamId);
      const path = canonicalMapping(input.path, location.kind);
      const { deviceId } = currentIdentity(this.database);
      this.database.prepare(`
        INSERT INTO device_location_mappings VALUES (?, ?, ?, ?)
        ON CONFLICT(location_id, device_id) DO UPDATE SET absolute_path = excluded.absolute_path,
          updated_at = excluded.updated_at
      `).run(location.id, deviceId, path, at);
      return {};
    }
    if (action === "unmap_location") {
      const location = mappedLocation(this.database, required(input.locationId, "Location"));
      if (!location) throw new Error("Location not found");
      requireTeam(this.database, location.teamId);
      const { deviceId } = currentIdentity(this.database);
      this.database.prepare("DELETE FROM device_location_mappings WHERE location_id = ? AND device_id = ?")
        .run(location.id, deviceId);
      return {};
    }
    if (action === "archive_location") {
      const location = mappedLocation(this.database, required(input.locationId, "Location"));
      if (!location) throw new Error("Location not found");
      requireTeam(this.database, location.teamId, ["admin"]);
      this.database.prepare("UPDATE team_locations SET archived_at = ?, updated_at = ? WHERE id = ?")
        .run(at, at, location.id);
      return {};
    }
    if (action === "attach_location") return transaction(this.database, () => {
      const target = input.processId
        ? { ...processContext(this.database, input.processId, ["admin", "member"]), targetKind: "process" }
        : { ...itemContext(this.database, input.itemId, ["admin", "member"]), targetKind: "work_item" };
      const workspace = workspaceContext(this.database, target.workspaceId, ["admin", "member"]);
      const locationId = required(input.locationId, "Location");
      if (!this.database.prepare(`
        SELECT 1 FROM team_locations WHERE id = ? AND team_id = ? AND archived_at IS NULL
      `).get(locationId, workspace.teamId)) throw new Error("Location is unavailable to this workspace's team");
      const table = target.targetKind === "process" ? "process_locations" : "work_item_locations";
      this.database.prepare(`INSERT OR IGNORE INTO ${table} VALUES (?, ?, ?)`)
        .run(target.id, locationId, logicalRelativePath(input.relativePath));
      return {};
    });
    if (action === "detach_location") return transaction(this.database, () => {
      if (input.processId) {
        const process = processContext(this.database, input.processId, ["admin", "member"]);
        this.database.prepare("DELETE FROM process_locations WHERE process_id = ? AND location_id = ?")
          .run(process.id, required(input.locationId, "Location"));
      } else {
        const item = itemContext(this.database, input.itemId, ["admin", "member"]);
        this.database.prepare("DELETE FROM work_item_locations WHERE work_item_id = ? AND location_id = ?")
          .run(item.id, required(input.locationId, "Location"));
      }
      return {};
    });
    if (action === "apply_proposal") {
      const proposalId = required(input.proposalId, "Proposal");
      const proposal = this.database.prepare(`
        SELECT workspace_id AS workspaceId, changes_json AS changes FROM bees_proposals
        WHERE id = ? AND status = 'pending'
      `).get(proposalId);
      if (!proposal) throw new Error("Proposal is no longer pending");
      workspaceContext(this.database, proposal.workspaceId, ["admin", "member"]);
      const results = [];
      for (const change of JSON.parse(proposal.changes))
        results.push(await this.execute(change.action, { ...change, workspaceId: proposal.workspaceId }));
      this.database.prepare("UPDATE bees_proposals SET status = 'applied', updated_at = ? WHERE id = ?")
        .run(iso(), proposalId);
      return { id: proposalId, results };
    }
    if (action === "reject_proposal") {
      const proposal = this.database.prepare("SELECT workspace_id AS workspaceId FROM bees_proposals WHERE id = ? AND status = 'pending'")
        .get(required(input.proposalId, "Proposal"));
      if (!proposal) throw new Error("Proposal is no longer pending");
      workspaceContext(this.database, proposal.workspaceId, ["admin", "member"]);
      this.database.prepare("UPDATE bees_proposals SET status = 'rejected', updated_at = ? WHERE id = ?")
        .run(at, input.proposalId);
      return {};
    }
    if (action === "ask_bees") {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      const executionId = randomUUID();
      const runDirectory = resolve(this.defaultWorkspace, "runs", executionId);
      await this.agents.admit("bees-run", executionId, {
        idempotencyKey: `start:${executionId}`, workspace: runDirectory,
        body: `Plan this outcome for the current Bees workspace. Propose reviewable changes with bees_propose_changes; do not apply them yourself.\n\nOutcome: ${required(input.outcome, "Outcome")}`,
        initialData: {
          version: 1, mode: "planning", executionId, workItemId: null, agentId: "bees-plan",
          agentName: "Ask Bees", purpose: String(input.outcome), model: input.model || null,
          instructions: "Propose a goal and/or visible process. Keep the proposal concise and executable.",
          workspaceId: workspace.id, agentPresetId: input.agentPresetId || "standard",
          grants: []
        }
      });
      return { executionId, sessionId: this.agents.run(executionId)?.currentSessionId };
    }
    if (action === "run_item") {
      const item = itemContext(this.database, input.itemId, ["admin", "member"]);
      if (this.processes.isAutomatic(item.processId))
        throw new Error("Temporal runs this process automatically");
      const executionId = input.scheduleOccurrenceId ? stableUuid(input.scheduleOccurrenceId) : randomUUID();
      if (this.database.prepare("SELECT 1 FROM execution_links WHERE execution_id = ?").get(executionId))
        return { executionId };
      const runDirectory = resolve(this.defaultWorkspace, "runs", executionId);
      const grants = [...new Set(stageInputs(this.database, item.id, runDirectory).map(({ id }) => id))];
      const assignment = item.agentAssignmentId ? this.database.prepare(`
        SELECT preset_id AS presetId, name, instructions, model
        FROM agent_assignments WHERE id = ? AND workspace_id = ?
      `).get(item.agentAssignmentId, item.workspaceId) : defaultAssignment(this.database, item.workspaceId);
      await this.agents.admit("bees-run", executionId, {
        idempotencyKey: `start:${executionId}`, workspace: runDirectory,
        body: `Complete this work item.\n\nTitle: ${item.title}\n\n${item.description}`,
        initialData: {
          version: 1, mode: "work", executionId, workItemId: item.id,
          agentId: item.agentAssignmentId || "bees-run", agentName: assignment?.name || "Bees work agent",
          purpose: item.title, model: input.model || assignment?.model || null,
          instructions: [assignment?.instructions, item.description].filter(Boolean).join("\n\n"),
          workspaceId: item.workspaceId, agentPresetId: assignment?.presetId || "standard",
          grants
        }
      });
      return { executionId };
    }
    if (action === "stop_run") return { stopped: this.agents.abort(required(input.executionId, "Execution")) };
    if (action === "recover_run") {
      const executionId = required(input.executionId, "Execution");
      const run = this.database.prepare(`
        SELECT work_item_id AS workItemId, config_json AS configJson FROM execution_links WHERE execution_id = ?
      `).get(executionId);
      if (!run) throw new Error("Execution not found");
      if (!run.workItemId) {
        const data = JSON.parse(run.configJson);
        workspaceContext(this.database, data.workspaceId, ["admin", "member"]);
        return this.agents.admit("bees-run", executionId, {
          idempotencyKey: `recover:${executionId}:${Date.now()}`,
          body: `Resume this ${data.mode === "planning" ? "Bees planning run" : "run"} from the last safe checkpoint.`
        });
      }
      const item = itemContext(this.database, run.workItemId, ["admin", "member"]);
      return this.agents.admit("bees-run", executionId, {
        idempotencyKey: `recover:${executionId}:${Date.now()}`,
        body: `Resume this work item from the last safe checkpoint.\n\nTitle: ${item.title}\n\n${item.description}`
      });
    }
    if (action === "publish_run") {
      const executionId = required(input.executionId, "Execution");
      const run = this.database.prepare(`
        SELECT instance_uid AS uid, config_json AS configJson FROM execution_links WHERE execution_id = ?
      `).get(executionId);
      if (!run) throw new Error("Execution not found");
      const data = JSON.parse(run.configJson);
      const locationId = required(input.locationId, "Location");
      if (!data.grants.includes(locationId)) throw new Error("That location was not granted to this run");
      return this.agents.admit("bees-run", executionId, {
        idempotencyKey: `publish:${executionId}:${locationId}:${randomUUID()}`, uid: run.uid,
        body: `Publish the finished files under outputs/ to the granted location ${locationId}. Use bees_publish_outputs and do not modify the deliverables.`
      });
    }
    throw new Error(`Unknown action: ${action}`);
  }
}
