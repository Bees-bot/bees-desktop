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
    SELECT id, preset_id AS presetId, name, description, instructions, model,
           system_role AS systemRole, capabilities_json AS capabilities,
           enabled, max_concurrency AS maxConcurrency, updated_at AS updatedAt
    FROM agent_assignments WHERE workspace_id = ? AND system_role = ? LIMIT 1
  `).get(workspaceId, role);
}

function capabilities(value, label = "Capabilities") {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");
  const normalized = [...new Set(values.map((entry) => String(entry).trim().toLocaleLowerCase()).filter(Boolean))];
  if (normalized.length > 20 || normalized.some((entry) => !/^[a-z0-9][a-z0-9-]{0,39}$/.test(entry)))
    throw new Error(`${label} must contain at most 20 lowercase names using letters, numbers, and hyphens`);
  return normalized;
}

function agentCapabilities(agent) {
  try { return capabilities(JSON.parse(agent.capabilities || "[]")); }
  catch { return []; }
}

function assignment(database, id, workspaceId) {
  return database.prepare(`
    SELECT id, workspace_id AS workspaceId, preset_id AS presetId, name, description,
           instructions, model, system_role AS systemRole, capabilities_json AS capabilities,
           enabled, max_concurrency AS maxConcurrency, updated_at AS updatedAt
    FROM agent_assignments WHERE id = ? AND workspace_id = ?
  `).get(id, workspaceId);
}

function activeAgentRuns(database, agentId) {
  return Number(database.prepare(`
    SELECT count(*) AS count FROM agent_dispatches d
    LEFT JOIN execution_links e ON e.execution_id = d.execution_id
    WHERE d.agent_assignment_id = ? AND (
      e.status IN ('queued', 'running', 'waiting_for_input', 'waiting_for_approval', 'interrupted')
      OR (e.execution_id IS NULL AND d.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes'))
    )
  `).get(agentId)?.count ?? 0);
}

class AgentCapacityError extends Error {}

function ensureAgentCapacity(database, agent, label) {
  const activeRuns = activeAgentRuns(database, agent.id);
  if (agent.maxConcurrency && activeRuns >= agent.maxConcurrency)
    throw new AgentCapacityError(`${label} is at its concurrency limit`);
  return activeRuns;
}

function resolveStageAgent(database, { executionId, item, stageId, purpose, candidateExecutionId }) {
  const prior = database.prepare(`
    SELECT d.agent_assignment_id AS agentAssignmentId, d.target_type AS targetType,
           d.target_id AS targetId, d.reason, d.agent_revision AS agentRevision,
           d.agent_config_json AS agentConfig
    FROM agent_dispatches d WHERE d.execution_id = ?
  `).get(executionId);
  if (prior) return { ...JSON.parse(prior.agentConfig), ...prior };

  const stage = database.prepare(`
    SELECT s.id, s.name, s.driver, p.workspace_id AS workspaceId,
           r.agent_assignment_id AS routeAgentId, r.agent_pool_id AS routePoolId,
           r.required_capabilities_json AS requiredCapabilities
    FROM stages s JOIN processes p ON p.id = s.process_id
    LEFT JOIN stage_routes r ON r.stage_id = s.id
    WHERE s.id = ? AND s.process_id = ? AND s.archived_at IS NULL
  `).get(stageId, item.processId);
  if (!stage) throw new Error("The process stage is unavailable");
  const requiredCapabilities = capabilities(JSON.parse(stage.requiredCapabilities || "[]"), "Stage capabilities");
  const excludedAgentId = purpose === "reviewer" && candidateExecutionId ? database.prepare(`
    SELECT agent_assignment_id AS agentAssignmentId FROM agent_dispatches WHERE execution_id = ?
  `).get(candidateExecutionId)?.agentAssignmentId : null;
  const accepts = (agent) => agent && Boolean(agent.enabled) && agent.id !== excludedAgentId &&
    requiredCapabilities.every((requiredCapability) => agentCapabilities(agent).includes(requiredCapability));

  return transaction(database, () => {
    let selected;
    let targetType;
    let targetId;
    let reason;
    if (purpose !== "reviewer" && item.agentAssignmentId) {
      selected = assignment(database, item.agentAssignmentId, stage.workspaceId);
      targetType = "item";
      targetId = item.id;
      reason = "Work-item override";
      if (!accepts(selected)) throw new Error("The work-item agent override is disabled or missing required capabilities");
      ensureAgentCapacity(database, selected, selected.name);
    } else if (stage.routeAgentId) {
      selected = assignment(database, stage.routeAgentId, stage.workspaceId);
      targetType = "agent";
      targetId = stage.routeAgentId;
      reason = `Direct stage assignment for ${stage.name}`;
      if (!accepts(selected)) throw new Error(`The agent assigned to ${stage.name} is disabled, incompatible, or not independent`);
      ensureAgentCapacity(database, selected, selected.name);
    } else if (stage.routePoolId) {
      const pool = database.prepare(`
        SELECT id, name FROM agent_pools WHERE id = ? AND workspace_id = ? AND archived_at IS NULL
      `).get(stage.routePoolId, stage.workspaceId);
      if (!pool) throw new Error(`The agent pool assigned to ${stage.name} is unavailable`);
      const eligible = database.prepare(`
        SELECT a.id, a.workspace_id AS workspaceId, a.preset_id AS presetId, a.name,
               a.instructions, a.model, a.capabilities_json AS capabilities, a.enabled,
               a.max_concurrency AS maxConcurrency, a.updated_at AS updatedAt,
               m.priority, m.last_assigned_at AS lastAssignedAt
        FROM agent_pool_members m JOIN agent_assignments a ON a.id = m.agent_assignment_id
        WHERE m.pool_id = ? AND m.enabled = 1
        ORDER BY m.priority, m.last_assigned_at IS NOT NULL, m.last_assigned_at, a.id
      `).all(pool.id).filter(accepts).map((agent) => ({
        ...agent, activeRuns: activeAgentRuns(database, agent.id)
      }));
      const candidates = eligible.filter((agent) => !agent.maxConcurrency || agent.activeRuns < agent.maxConcurrency);
      selected = candidates[0];
      if (!selected && eligible.length) throw new AgentCapacityError(`The ${pool.name} pool is at capacity`);
      if (!selected) throw new Error(`The ${pool.name} pool has no enabled, compatible, independent agent`);
      targetType = "pool";
      targetId = pool.id;
      reason = `${pool.name}: priority ${selected.priority}; ${selected.activeRuns} active; least recently assigned`;
      database.prepare(`
        UPDATE agent_pool_members SET last_assigned_at = ? WHERE pool_id = ? AND agent_assignment_id = ?
      `).run(iso(), pool.id, selected.id);
    } else {
      const role = purpose === "reviewer" ? "reviewer" : "worker";
      selected = defaultAssignment(database, stage.workspaceId, role);
      targetType = "workspace-default";
      targetId = role;
      reason = `Workspace ${role} fallback`;
      if (!accepts(selected)) throw new Error(`The workspace ${role} agent is disabled, incompatible, or not independent`);
      ensureAgentCapacity(database, selected, selected.name);
    }
    const agentConfig = JSON.stringify({
      id: selected.id, workspaceId: selected.workspaceId, presetId: selected.presetId,
      name: selected.name, instructions: selected.instructions, model: selected.model,
      capabilities: selected.capabilities, enabled: selected.enabled,
      maxConcurrency: selected.maxConcurrency, updatedAt: selected.updatedAt
    });
    database.prepare(`
      INSERT INTO agent_dispatches
        (execution_id, work_item_id, stage_id, target_type, target_id,
         agent_assignment_id, reason, agent_revision, agent_config_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(executionId, item.id, stage.id, targetType, targetId, selected.id, reason,
      selected.updatedAt, agentConfig, iso());
    return {
      ...selected, agentAssignmentId: selected.id, targetType, targetId, reason,
      agentRevision: selected.updatedAt
    };
  });
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

function previewFiles(runDirectory) {
  const files = [];
  for (const rootName of ["inputs", "outputs"]) {
    try {
      const root = realpathSync(resolve(runDirectory, rootName));
      const stack = [root];
      while (stack.length && files.length < 200) {
        const directory = stack.pop();
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) continue;
          const path = resolve(directory, entry.name);
          if (entry.isDirectory()) stack.push(path);
          else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(path).toLowerCase()) && lstatSync(path).size <= 1_000_000)
            files.push(`${rootName}/${relative(root, path)}`);
          if (files.length >= 200) break;
        }
      }
    } catch { /* a run may not have created this directory yet */ }
  }
  return files.sort();
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

function processStageNames(value, label = "process") {
  const names = Array.isArray(value) ? value.map((entry) => required(entry, "Stage")) : [];
  if (names.length < 2 || names.length > 12) throw new Error(`A ${label} needs 2 to 12 stages`);
  if (new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length)
    throw new Error("Stage names must be unique");
  return names;
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
      instructions TEXT NOT NULL DEFAULT '', model TEXT,
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
  if (!assignmentColumns.has("system_role")) database.exec("ALTER TABLE agent_assignments ADD COLUMN system_role TEXT");
  if (!assignmentColumns.has("capabilities_json")) database.exec("ALTER TABLE agent_assignments ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]'");
  if (!assignmentColumns.has("enabled")) database.exec("ALTER TABLE agent_assignments ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
  if (!assignmentColumns.has("max_concurrency")) database.exec("ALTER TABLE agent_assignments ADD COLUMN max_concurrency INTEGER NOT NULL DEFAULT 0");
  const dispatchColumns = new Set(database.prepare("PRAGMA table_info(agent_dispatches)").all().map(({ name }) => name));
  if (!dispatchColumns.has("agent_config_json")) database.exec("ALTER TABLE agent_dispatches ADD COLUMN agent_config_json TEXT NOT NULL DEFAULT '{}'");
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS bees_assignment_system_role
      ON agent_assignments(workspace_id, system_role) WHERE system_role IS NOT NULL;
    UPDATE stages SET driver = CASE
      WHEN is_terminal = 1 THEN 'terminal'
      WHEN lower(name) LIKE '%review%' THEN 'review'
      ELSE 'agent'
    END;
    PRAGMA user_version = 7;
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
    let assignment;
    try {
      assignment = resolveStageAgent(this.database, {
        executionId, item, stageId: required(stage.stageId, "Stage"), purpose: stage.purpose,
        candidateExecutionId: stage.candidateExecutionId
      });
    } catch (error) {
      if (error instanceof AgentCapacityError) return { outcome: "waiting", summary: error.message };
      throw error;
    }
    const runDirectory = resolve(this.defaultWorkspace, "runs", executionId);
    const locations = stageInputs(this.database, item.id, runDirectory);
    const reviewer = stage.purpose === "reviewer";
    let candidateSummary = "";
    if (stage.candidateExecutionId) {
      const candidate = this.database.prepare(`
        SELECT e.run_directory AS runDirectory, r.summary
        FROM execution_links e
        LEFT JOIN bees_stage_results r ON r.execution_id = e.execution_id
        WHERE e.execution_id = ? AND e.work_item_id = ?
      `).get(stage.candidateExecutionId, item.id);
      if (!candidate) throw new Error("The review candidate is unavailable");
      candidateSummary = candidate.summary || "";
      const destination = reviewer
        ? resolve(runDirectory, "inputs", "candidate")
        : resolve(runDirectory, "outputs");
      mkdirSync(destination, { recursive: true });
      stageLocation({ name: "candidate", kind: "folder", localPath: resolve(candidate.runDirectory, "outputs") }, destination);
    }
    const feedback = stage.feedback ? `\n\nPrior review feedback:\n${stage.feedback}` : "";
    const handoff = stage.candidateExecutionId && !reviewer
      ? `\n\nPrior-stage handoff: the previous deliverables are already copied into outputs/. Continue from them; do not recreate completed work or repeat approvals/actions already recorded. If they already satisfy this stage, preserve them and submit the candidate without redoing the goal.${candidateSummary ? `\n\nPrior-stage summary:\n${candidateSummary}` : ""}`
      : "";
    const body = reviewer
      ? `Independently review the candidate under inputs/candidate. Verify the real deliverables and run relevant checks. Call bees_submit_stage_result with pass or revise and concise evidence.\n\nGoal: ${item.title}\n\n${item.description}\n\nStage instructions: ${stage.instructions || "Review the completed work."}`
      : `Complete only the ${stage.stageName || "current"} stage of this goal; do not perform later stages. Plan with DSH goals/todos and delegate independent subtasks to subagents when useful. Put every deliverable under outputs/. Call bees_submit_stage_result with candidate only when this stage is genuinely ready for the next stage.\n\nGoal: ${item.title}\n\n${item.description}\n\nStage instructions: ${stage.instructions || `Complete only the ${stage.stageName || "current"} stage.`}${handoff}${feedback}`;
    return this.agents.executeStage(executionId, {
      idempotencyKey: `process:${executionId}:start`,
      workspace: runDirectory,
      body,
      initialData: {
        version: 1, mode: reviewer ? "review" : "work", stagePurpose: stage.purpose,
        executionId, workItemId: item.id,
        agentId: assignment.id, agentName: assignment.name,
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
    const templates = workspaceIds.length ? this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, name, description, stages_json AS stages
      FROM process_templates
      WHERE workspace_id IN (SELECT value FROM json_each(?)) AND archived_at IS NULL
      ORDER BY created_at
    `).all(JSON.stringify(workspaceIds)).map((row) => ({ ...row, stages: JSON.parse(row.stages) })) : [];
    const processIds = processes.map(({ id }) => id);
    const stages = processIds.length ? this.database.prepare(`
      SELECT id, process_id AS processId, name, position, driver,
             completion_rules AS instructions, is_terminal AS isTerminal,
             CASE WHEN r.agent_assignment_id IS NOT NULL THEN 'agent'
                  WHEN r.agent_pool_id IS NOT NULL THEN 'pool' END AS routeType,
             coalesce(r.agent_assignment_id, r.agent_pool_id) AS routeTargetId,
             r.required_capabilities_json AS requiredCapabilities
      FROM stages s LEFT JOIN stage_routes r ON r.stage_id = s.id
      WHERE process_id IN (SELECT value FROM json_each(?)) AND archived_at IS NULL
      ORDER BY process_id, position
    `).all(JSON.stringify(processIds)).map((row) => ({
      ...row, isTerminal: Boolean(row.isTerminal),
      requiredCapabilities: JSON.parse(row.requiredCapabilities || "[]")
    })) : [];
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
             instructions, model, system_role AS systemRole, capabilities_json AS capabilities,
             enabled, max_concurrency AS maxConcurrency, updated_at AS updatedAt
      FROM agent_assignments WHERE workspace_id IN (SELECT value FROM json_each(?)) ORDER BY name
    `).all(JSON.stringify(workspaceIds)).map((row) => ({
      ...row, enabled: Boolean(row.enabled), capabilities: JSON.parse(row.capabilities || "[]")
    })) : [];
    const pools = workspaceIds.length ? this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, name, description
      FROM agent_pools WHERE workspace_id IN (SELECT value FROM json_each(?)) AND archived_at IS NULL
      ORDER BY name
    `).all(JSON.stringify(workspaceIds)) : [];
    const poolMembers = pools.length ? this.database.prepare(`
      SELECT pool_id AS poolId, agent_assignment_id AS agentAssignmentId,
             priority, enabled, last_assigned_at AS lastAssignedAt
      FROM agent_pool_members WHERE pool_id IN (SELECT value FROM json_each(?))
      ORDER BY pool_id, priority, agent_assignment_id
    `).all(JSON.stringify(pools.map(({ id }) => id))).map((row) => ({
      ...row, enabled: Boolean(row.enabled)
    })) : [];
    const runs = workspaceIds.length ? this.database.prepare(`
      SELECT e.execution_id AS id, e.workspace_id AS workspaceId, e.work_item_id AS workItemId,
             e.current_session_id AS sessionId, e.previous_session_id AS previousSessionId,
             e.status, e.run_directory AS runDirectory, e.updated_at AS updatedAt,
             d.stage_id AS dispatchStageId, d.agent_assignment_id AS resolvedAgentId,
             d.target_type AS dispatchTargetType, d.target_id AS dispatchTargetId,
             d.reason AS dispatchReason, d.agent_revision AS agentRevision
      FROM execution_links e LEFT JOIN agent_dispatches d ON d.execution_id = e.execution_id
      WHERE workspace_id IN (SELECT value FROM json_each(?))
      ORDER BY updated_at DESC LIMIT 200
    `).all(JSON.stringify(workspaceIds)).map(({ runDirectory, ...run }) => ({
      ...run, outputs: outputFiles(runDirectory),
      files: ["waiting_for_input", "waiting_for_approval", "interrupted"].includes(run.status)
        ? previewFiles(runDirectory) : []
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
      processes, templates, stages, items, locations, attachments, processAttachments,
      assignments, pools, poolMembers, presets, runs, schedules, proposals
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

  runFile(executionId, filePath) {
    const id = required(executionId, "Run");
    const row = this.database.prepare(`
      SELECT workspace_id AS workspaceId, run_directory AS runDirectory
      FROM execution_links WHERE execution_id = ?
    `).get(id);
    if (!row) throw new Error("Run not found");
    workspaceContext(this.database, row.workspaceId);
    const logical = logicalRelativePath(required(filePath, "File"));
    const [rootName] = logical.split("/");
    if (!["inputs", "outputs"].includes(rootName)) throw new Error("Only run inputs and outputs can be previewed");
    if (!TEXT_EXTENSIONS.has(extname(logical).toLowerCase())) throw new Error("This file type cannot be previewed as text");
    const runsRoot = realpathSync(resolve(this.defaultWorkspace, "runs"));
    const runDirectory = realpathSync(row.runDirectory);
    if (runDirectory !== runsRoot && !runDirectory.startsWith(`${runsRoot}${sep}`))
      throw new Error("The run directory is outside the Bees workspace");
    const root = realpathSync(resolve(runDirectory, rootName));
    const path = realpathSync(resolve(runDirectory, logical));
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error("The file escaped its run directory");
    const stat = lstatSync(path);
    if (!stat.isFile()) throw new Error("The run file is unavailable");
    if (stat.size > 1_000_000) throw new Error("The run file is too large to preview");
    const extension = extname(path).toLowerCase();
    return {
      name: basename(path), path: logical,
      format: [".md", ".markdown"].includes(extension) ? "markdown" : "text",
      content: readFileSync(path, "utf8")
    };
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
    for (const key of ["organizationId", "teamId", "workspaceId", "processId", "templateId", "stageId", "itemId", "parentId", "agentAssignmentId", "agentPoolId", "locationId", "scheduleId", "proposalId"])
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
      const assignmentId = input.agentAssignmentId ? required(input.agentAssignmentId, "Agent") : null;
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
      const assignmentId = Object.hasOwn(input, "agentAssignmentId")
        ? input.agentAssignmentId ? required(input.agentAssignmentId, "Agent") : null
        : item.agentAssignmentId;
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
      const stages = processStageNames(input.stages);
      return { id: insertProcess(this.database, workspace.id, input.name, input.description, stages) };
    });
    if (action === "create_process_template") return transaction(this.database, () => {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      const id = randomUUID();
      const stages = processStageNames(input.stages, "process template");
      this.database.prepare(`
        INSERT INTO process_templates VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(id, workspace.id, required(input.name, "Template name"), String(input.description ?? ""),
        JSON.stringify(stages), at, at);
      return { id };
    });
    if (action === "save_process_template") return transaction(this.database, () => {
      const process = processContext(this.database, input.processId, ["admin", "member"]);
      const source = this.database.prepare("SELECT name, description FROM processes WHERE id = ?").get(process.id);
      const stages = this.database.prepare(`
        SELECT name FROM stages WHERE process_id = ? AND archived_at IS NULL ORDER BY position
      `).all(process.id).map(({ name }) => name);
      const id = randomUUID();
      this.database.prepare(`
        INSERT INTO process_templates VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(id, process.workspaceId, required(input.name || source.name, "Template name"),
        source.description, JSON.stringify(stages), at, at);
      return { id };
    });
    if (action === "archive_process_template") return transaction(this.database, () => {
      const template = this.database.prepare(`
        SELECT workspace_id AS workspaceId FROM process_templates WHERE id = ? AND archived_at IS NULL
      `).get(required(input.templateId, "Template"));
      if (!template) throw new Error("Process template not found");
      workspaceContext(this.database, template.workspaceId, ["admin", "member"]);
      this.database.prepare("UPDATE process_templates SET archived_at = ?, updated_at = ? WHERE id = ?")
        .run(at, at, input.templateId);
      return {};
    });
    if (action === "archive_process") return transaction(this.database, () => {
      const process = processContext(this.database, input.processId, ["admin", "member"]);
      const row = this.database.prepare("SELECT kind FROM processes WHERE id = ?").get(process.id);
      if (row.kind === "goals") throw new Error("The built-in Goals process cannot be archived");
      if (this.processes.isAutomatic(process.id) && this.database.prepare(`
        SELECT 1 FROM work_items WHERE process_id = ? AND deleted_at IS NULL
          AND runtime_phase NOT IN ('completed', 'cancelled') LIMIT 1
      `).get(process.id)) throw new Error("Finish or cancel active work before archiving this process");
      this.database.prepare("UPDATE processes SET archived_at = ?, updated_at = ? WHERE id = ?")
        .run(at, at, process.id);
      return {};
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
      const names = processStageNames(input.stages);
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
    if (action === "set_stage_route") return transaction(this.database, () => {
      const stageId = required(input.stageId, "Stage");
      const stage = this.database.prepare(`
        SELECT s.id, s.process_id AS processId, s.driver, p.workspace_id AS workspaceId
        FROM stages s JOIN processes p ON p.id = s.process_id
        WHERE s.id = ? AND s.archived_at IS NULL
      `).get(stageId);
      if (!stage) throw new Error("Stage not found");
      workspaceContext(this.database, stage.workspaceId, ["admin", "member"]);
      if (stage.driver === "terminal") throw new Error("A terminal stage does not run an agent");
      if (this.processes.isAutomatic(stage.processId) && this.database.prepare(`
        SELECT 1 FROM work_items WHERE process_id = ? AND deleted_at IS NULL
          AND runtime_phase NOT IN ('completed', 'cancelled') LIMIT 1
      `).get(stage.processId)) throw new Error("Finish or cancel active automatic work before changing stage routing");
      const requiredCapabilities = capabilities(input.requiredCapabilities, "Stage capabilities");
      const targetType = input.targetType || null;
      const targetId = input.targetId ? required(input.targetId, "Route target") : null;
      let agentId = null;
      let poolId = null;
      if (targetType === "agent") {
        if (!assignment(this.database, targetId, stage.workspaceId)) throw new Error("Agent is not in this workspace");
        agentId = targetId;
      } else if (targetType === "pool") {
        if (!this.database.prepare(`
          SELECT 1 FROM agent_pools WHERE id = ? AND workspace_id = ? AND archived_at IS NULL
        `).get(targetId, stage.workspaceId)) throw new Error("Agent pool is not in this workspace");
        poolId = targetId;
      } else if (targetType) throw new Error("Stage routing must use an agent or pool");
      if (!targetType && !requiredCapabilities.length) {
        this.database.prepare("DELETE FROM stage_routes WHERE stage_id = ?").run(stage.id);
        return { id: stage.id };
      }
      this.database.prepare(`
        INSERT INTO stage_routes
          (stage_id, agent_assignment_id, agent_pool_id, required_capabilities_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(stage_id) DO UPDATE SET agent_assignment_id = excluded.agent_assignment_id,
          agent_pool_id = excluded.agent_pool_id,
          required_capabilities_json = excluded.required_capabilities_json,
          updated_at = excluded.updated_at
      `).run(stage.id, agentId, poolId, JSON.stringify(requiredCapabilities), at, at);
      return { id: stage.id };
    });
    if (action === "add_agent_pool") return transaction(this.database, () => {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      const id = randomUUID();
      this.database.prepare(`
        INSERT INTO agent_pools (id, workspace_id, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, workspace.id, required(input.name, "Pool name"), String(input.description ?? ""), at, at);
      return { id };
    });
    if (action === "edit_agent_pool") return transaction(this.database, () => {
      const id = required(input.agentPoolId, "Agent pool");
      const pool = this.database.prepare(`
        SELECT workspace_id AS workspaceId FROM agent_pools WHERE id = ? AND archived_at IS NULL
      `).get(id);
      if (!pool) throw new Error("Agent pool not found");
      workspaceContext(this.database, pool.workspaceId, ["admin", "member"]);
      this.database.prepare(`UPDATE agent_pools SET name = ?, description = ?, updated_at = ? WHERE id = ?`)
        .run(required(input.name, "Pool name"), String(input.description ?? ""), at, id);
      return { id };
    });
    if (action === "set_agent_pool_member") return transaction(this.database, () => {
      const poolId = required(input.agentPoolId, "Agent pool");
      const agentId = required(input.agentAssignmentId, "Agent");
      const pool = this.database.prepare(`
        SELECT workspace_id AS workspaceId FROM agent_pools WHERE id = ? AND archived_at IS NULL
      `).get(poolId);
      if (!pool) throw new Error("Agent pool not found");
      workspaceContext(this.database, pool.workspaceId, ["admin", "member"]);
      if (!assignment(this.database, agentId, pool.workspaceId)) throw new Error("Agent is not in this pool's workspace");
      if (input.remove) {
        this.database.prepare(`DELETE FROM agent_pool_members WHERE pool_id = ? AND agent_assignment_id = ?`)
          .run(poolId, agentId);
        return { id: poolId };
      }
      const priority = Number(input.priority ?? 100);
      if (!Number.isInteger(priority) || priority < 1 || priority > 1000)
        throw new Error("Pool priority must be an integer from 1 to 1000");
      this.database.prepare(`
        INSERT INTO agent_pool_members (pool_id, agent_assignment_id, priority, enabled)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(pool_id, agent_assignment_id) DO UPDATE SET
          priority = excluded.priority, enabled = excluded.enabled
      `).run(poolId, agentId, priority, input.enabled === false ? 0 : 1);
      return { id: poolId };
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
        const maxConcurrency = Number(input.maxConcurrency ?? 0);
        if (!Number.isInteger(maxConcurrency) || maxConcurrency < 0 || maxConcurrency > 1000)
          throw new Error("Agent concurrency must be an integer from 0 to 1000");
        this.database.prepare(`
          INSERT INTO agent_assignments
            (id, workspace_id, preset_id, name, description, instructions, model, system_role,
             capabilities_json, enabled, max_concurrency, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
        `).run(id, workspace.id, presetId, required(input.name, "Agent name"),
          String(input.description ?? ""), String(input.instructions ?? ""), input.model || null,
          JSON.stringify(capabilities(input.capabilities)), input.enabled === false ? 0 : 1,
          maxConcurrency, at, at);
        return { id };
      });
    }
    if (action === "edit_agent_assignment") {
      const id = required(input.agentAssignmentId, "Agent");
      const assignment = this.database.prepare(`
        SELECT workspace_id AS workspaceId, name, system_role AS systemRole,
               capabilities_json AS capabilities, enabled, max_concurrency AS maxConcurrency
        FROM agent_assignments WHERE id = ?
      `).get(id);
      if (!assignment) throw new Error("Agent not found");
      workspaceContext(this.database, assignment.workspaceId, ["admin", "member"]);
      const presetId = required(input.presetId, "DSH preset");
      if (this.agentPresets) {
        const preset = (await this.agentPresets.list()).find(({ id }) => id === presetId);
        if (!preset || preset.broken) throw new Error("The DSH preset is unavailable");
      }
      const nextCapabilities = Object.hasOwn(input, "capabilities")
        ? capabilities(input.capabilities) : JSON.parse(assignment.capabilities || "[]");
      const enabled = Object.hasOwn(input, "enabled") ? input.enabled !== false : Boolean(assignment.enabled);
      const maxConcurrency = Number(Object.hasOwn(input, "maxConcurrency")
        ? input.maxConcurrency : assignment.maxConcurrency);
      if (!Number.isInteger(maxConcurrency) || maxConcurrency < 0 || maxConcurrency > 1000)
        throw new Error("Agent concurrency must be an integer from 0 to 1000");
      this.database.prepare(`
        UPDATE agent_assignments SET preset_id = ?, name = ?, description = ?, instructions = ?,
          model = ?, capabilities_json = ?, enabled = ?, max_concurrency = ?, updated_at = ? WHERE id = ?
      `).run(presetId, assignment.systemRole ? assignment.name : required(input.name, "Agent name"),
        String(input.description ?? ""), String(input.instructions ?? ""), input.model || null,
        JSON.stringify(nextCapabilities), enabled ? 1 : 0, maxConcurrency, at, id);
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
      const stage = this.database.prepare(`SELECT driver FROM stages WHERE id = ? AND process_id = ?`)
        .get(item.stageId, item.processId);
      const stagePurpose = stage?.driver === "review" ? "reviewer" : "worker";
      const assignment = resolveStageAgent(this.database, {
        executionId, item, stageId: item.stageId, purpose: stagePurpose
      });
      const runDirectory = resolve(this.defaultWorkspace, "runs", executionId);
      const grants = [...new Set(stageInputs(this.database, item.id, runDirectory).map(({ id }) => id))];
      await this.agents.admit("bees-run", executionId, {
        idempotencyKey: `start:${executionId}`, workspace: runDirectory,
        body: `Complete this work item.\n\nTitle: ${item.title}\n\n${item.description}`,
        initialData: {
          version: 1, mode: "work", executionId, workItemId: item.id,
          agentId: assignment.id, agentName: assignment.name,
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
