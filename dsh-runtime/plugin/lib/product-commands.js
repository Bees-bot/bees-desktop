import { catalogEntry } from "./mcp-catalog.js";
import { appDirectory, useDataFolder } from "./data-folder.js";
import { rootForWorkspace, setFolderRoot, workspaceRoot } from "./folder-roots.js";
import { randomUUID } from "node:crypto";
import { hideAgentBrowser, navigateAgentBrowser, showAgentBrowser } from "./agent-browser.js";

import { existsSync, mkdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  agentIds as normalizeAgentIds, assertMcpAccess, assignment, capabilities, currentIdentity, DEFAULT_WORKSPACE_NAME, insertDefaultWorkspace, insertProcess, iso,
  itemContext, normalizeRunSettings, optionalModelRoute, optionalReasoningEffort,
  parentFor, processContext, processStages,
  message, requireTeam, required, stableUuid, transaction, workspaceContext, workRunItems
} from "./product-database.js";
import {
  canonicalMapping, inputManifest, logicalRelativePath, mappedLocation, outputLocation, stageInputLocations
} from "./product-files.js";
import { authorizeReferences, leadingAgentInvocation, referenceInputs, resolveReference, resolveReferences } from "./product-references.js";

/** The three the UI offers. Anything else is a typo or a client that has drifted. */
function priorityOf(value) {
  const priority = String(value ?? "normal");
  if (!["low", "normal", "high"].includes(priority)) throw new Error("Priority must be low, normal or high");
  return priority;
}

/** An agent's MCP policy: every connected server, none of them, or a named few. */
/** Proposal changes that belong to Capabilities, not the product database. */
const CAPABILITY_CHANGES = ["install_mcp_server", "add_mcp_server", "install_skill"];

/** An MCP server's API keys ride in the change list; nothing outside apply needs them. */
export const withoutSecrets = (changes) => changes.map(({ secrets, ...change }) => change);

/** An agent with no server has no mcp__ tool at all, so it cannot read a file, open a page or call
 *  an API. A person may still choose that in the Agents screen; a model proposing it may not. */
/** Bees keeps its runs, databases and workspaces here; a server bound to any of it reads a folder
 *  that belongs to the machine, not to the person's work. */
export function assertFolderOutsideBees(directory, root, label) {
  if (!directory) return;
  const path = resolve(String(directory).trim());
  if (path === root || path.startsWith(root + sep))
    throw new Error(`${label} needs a folder the person named, not one inside Bees`);
}

export function assertAgentHasTools({ mcpAccess, name }) {
  if (mcpAccess === "none")
    throw new Error(`${name || "That agent"} would have no tool at all; list the servers its work needs, or all`);
}

/** A role description is not an instruction. An agent earns its place by naming the material it
 *  reads, what it leaves behind, and when it stops or asks; without that it repeats the prompt. */
export function assertUsableInstructions({ name, instructions, description }) {
  const text = String(instructions ?? "").trim();
  if (text.length < 80 || text === String(description ?? "").trim())
    throw new Error(`${name || "That agent"} needs instructions of its own: what it reads, what it writes, and when it asks the owner or stops`);
}

function mcpPolicy(input, current = { access: "all", servers: [] }) {
  if (!Object.hasOwn(input, "mcpAccess")) return current;
  const access = assertMcpAccess(String(input.mcpAccess ?? "all"));
  const servers = access === "listed"
    ? [...new Set((Array.isArray(input.mcpServers) ? input.mcpServers : []).map(String).filter(Boolean))]
    : [];
  return { access, servers };
}

/** Work that is still moving; a schedule's definition item only describes future runs. */
const hasActiveWork = (database, processId, settled = ["completed", "cancelled"]) => Boolean(database.prepare(`
  SELECT 1 FROM work_items WHERE process_id = ? AND deleted_at IS NULL AND archived_at IS NULL
    AND runtime_phase NOT IN (${settled.map(() => "?").join(", ")})
    AND id NOT IN (SELECT source_work_item_id FROM recurring_work) LIMIT 1
`).get(processId, ...settled));

function inheritedRunSettings(database, parent) {
  const settings = parent?.runSettings && typeof parent.runSettings === "object"
    ? { ...parent.runSettings }
    : {};
  if (Object.hasOwn(settings, "model")) return settings;
  const execution = parent?.id ? database.prepare(`
    SELECT json_extract(config_json, '$.model') AS model,
           json_extract(config_json, '$.reasoningEffort') AS reasoningEffort
    FROM execution_links
    WHERE work_item_id = ? AND json_extract(config_json, '$.model') IS NOT NULL
    ORDER BY updated_at DESC LIMIT 1
  `).get(parent.id) : null;
  if (execution?.model) {
    settings.model = execution.model;
    if (execution.reasoningEffort) settings.reasoningEffort = execution.reasoningEffort;
    return settings;
  }
  if (!parent?.agentAssignmentId) return settings;
  const agent = assignment(database, parent.agentAssignmentId, parent.workspaceId);
  if (!agent?.model) return settings;
  settings.model = agent.model;
  if (agent.reasoningEffort) settings.reasoningEffort = agent.reasoningEffort;
  return settings;
}

/** An agent may name a server by its id, its server name, its label or its catalog id. */
export function enabledServers(database) {
  return database.prepare("SELECT id, server_name AS name, label, catalog_id AS catalogId FROM mcp_servers WHERE enabled = 1")
    .all().map(({ id, name, label, catalogId }) => ({
      id, name, names: [id, name, label, catalogId].filter(Boolean).map((value) => String(value).toLocaleLowerCase())
    }));
}

/**
 * A name that resolves to nothing would silently grant the agent nothing at all.
 *
 * Stores the server name, not its row id: ids are per device, so an agent shared with a teammate
 * used to name servers their computer could not find. `keep` is the agent's current list, which
 * passes through unresolved so editing an agent here does not drop a server only they installed.
 */
export function checkMcpServers(database, policy, keep = []) {
  if (policy.access !== "listed") return policy;
  const rows = enabledServers(database);
  const kept = new Set(keep.map((name) => String(name).toLocaleLowerCase()));
  const servers = policy.servers.map((wanted) => {
    const row = rows.find(({ names }) => names.includes(String(wanted).toLocaleLowerCase()));
    if (row) return row.name;
    if (kept.has(String(wanted).toLocaleLowerCase())) return String(wanted);
    throw new Error(`No MCP server matches ${wanted}`);
  });
  return { access: policy.access, servers: [...new Set(servers)] };
}

/** Proposals can reuse active resources, but only within their own workspace. */
export function proposalResource(database, workspaceId, kind, reference) {
  if (/^[$@]/.test(reference)) {
    const resolved = resolveReferences(database, workspaceId, reference);
    const row = resolved.references[0];
    if (resolved.references.length !== 1 || row.kind !== kind) throw new Error(`Choose one ${kind} reference`);
    return { id: row.id, name: row.label };
  }
  const table = kind === "process" ? "processes" : "agent_assignments";
  const active = kind === "process" ? "archived_at IS NULL" : "enabled = 1";
  const rows = database.prepare(`
    SELECT id, name FROM ${table} WHERE workspace_id = ? AND ${active}
      AND (id = ? OR lower(name) = lower(?)) ORDER BY id = ? DESC
  `).all(workspaceId, reference, reference, reference);
  if (rows.length > 1 && rows[0].id !== reference)
    throw new Error(`More than one ${kind} is called "${reference}"; use its id`);
  if (!rows.length) throw new Error(`The ${kind} "${reference}" must be active in this workspace or created earlier in the same proposal`);
  return rows[0];
}

function locationIds(database, workspaceId, values, foldersOnly = false) {
  const workspace = workspaceContext(database, workspaceId, ["admin", "member"]);
  const ids = [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
  if (ids.length > 32) throw new Error("Choose at most 32 input locations");
  if (!ids.length) return [];
  const rows = database.prepare(`
    SELECT id, kind FROM team_locations
    WHERE team_id = ? AND archived_at IS NULL AND id IN (SELECT value FROM json_each(?))
  `).all(workspace.teamId, JSON.stringify(ids));
  if (rows.length !== ids.length) throw new Error("A selected location is unavailable to this team");
  if (foldersOnly && rows.some(({ kind }) => kind !== "folder")) throw new Error("Results must be saved to a folder");
  return ids;
}

function replaceLocations(database, table, ownerColumn, ownerId, ids) {
  database.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`).run(ownerId);
  const insert = database.prepare(`INSERT INTO ${table} VALUES (?, ?, '')`);
  ids.forEach((id) => insert.run(ownerId, id));
}

/** A proposal names team folders the way a person does; the store and apply both resolve them here. */
export function proposedFolder(database, workspaceId, name) {
  const row = database.prepare(`
    SELECT l.id, l.name FROM team_locations l JOIN workspaces w ON w.team_id = l.team_id
    WHERE w.id = ? AND lower(l.name) = lower(?) AND l.archived_at IS NULL
  `).get(workspaceId, String(name ?? ""));
  if (!row) throw new Error(`No team folder is named "${name}"; use an exact name from the brief`);
  return row;
}

/** Work is owned by the active org+identity connection, not by whichever account was added first. */
function executionAccount(database, teamId, input) {
  const local = database.prepare(`
    SELECT o.personal FROM teams t JOIN organizations o ON o.id = t.organization_id
    WHERE t.id = ?
  `).get(teamId);
  if (!local) throw new Error("Team not found");
  if (local.personal) return null;
  const row = input.connectionId
    ? database.prepare(`
        SELECT c.account_user_id AS accountUserId FROM bees_connections c
        JOIN bees_connection_teams ct ON ct.connection_id = c.id
        WHERE c.id = ? AND ct.team_id = ?
      `).get(input.connectionId, teamId)
    // a teammate's run picked up here acts through this device's account, the owner's is not signed in here
    : database.prepare(`
        SELECT c.account_user_id AS accountUserId FROM bees_connections c
        JOIN bees_connection_teams ct ON ct.connection_id = c.id
        WHERE ct.team_id = ? AND (c.account_user_id = ? OR ?) ORDER BY c.account_user_id = ? DESC LIMIT 1
      `).get(teamId, input.accountUserId ?? "", input.viaAgent ? 1 : 0, input.accountUserId ?? "");
  if (!row) throw new Error("Choose an account that can access this team");
  return row.accountUserId;
}

/** A run is only reachable through the work item or workspace that owns it. */
function runContext(database, executionId, roles = ["admin", "member"]) {
  const run = database.prepare(`
    SELECT e.work_item_id AS workItemId, e.instance_uid AS uid, e.config_json AS configJson,
           e.status, w.runtime_phase AS runtimePhase
    FROM execution_links e LEFT JOIN work_items w ON w.id = e.work_item_id
    WHERE e.execution_id = ?
  `).get(executionId);
  if (!run) throw new Error("Execution not found");
  const item = run.workItemId ? itemContext(database, run.workItemId, roles) : null;
  const data = JSON.parse(run.configJson);
  if (!item) workspaceContext(database, data.workspaceId, roles);
  return { ...run, data, item };
}

function timezoneOf(value) {
  const timezone = required(value, "Timezone");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); }
  catch { throw new Error(`"${timezone}" is not a timezone Bees knows. Pick one from the list, such as Asia/Kathmandu or America/Los_Angeles.`); }
  return timezone;
}

function scheduleName(database, workspaceId, value, id = "") {
  const name = required(value, "Recurring work name").slice(0, 120);
  if (database.prepare("SELECT 1 FROM recurring_work WHERE workspace_id = ? AND name = ? AND id != ?").get(workspaceId, name, id))
    throw new Error(`A schedule named "${name}" already exists; pick another name`);
  return name;
}

export function recurringSchedule(input) {
  if (!input.frequency && input.cronExpression && input.everyMinutes) throw new Error("Give cronExpression or everyMinutes, not both");
  const frequency = String(input.frequency ?? (input.cronExpression ? "advanced" : input.everyMinutes ? "hourly"
    : required(input.frequency, "Schedule frequency")));
  if (frequency === "hourly") {
    const everyMinutes = Number(input.everyMinutes ?? 60);
    if (!Number.isInteger(everyMinutes) || everyMinutes < 1 || everyMinutes > 525_600)
      throw new Error("Interval must be between 1 minute and 1 year");
    const anchorUtc = new Date(input.anchorUtc || Date.now()).toISOString();
    return { kind: "interval", timezone: null, value: { everyMinutes, anchorUtc } };
  }
  // an agent writing "every weekday at 8am" means this device's 8am, not UTC's
  const timezone = timezoneOf(input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  if (frequency === "advanced") {
    const expression = required(input.cronExpression, "Cron expression");
    const fields = expression.split(/\s+/);
    if (fields.length < 5 || fields.length > 7)
      throw new Error("Advanced schedules need a 5, 6, or 7 field cron expression");
    return { kind: "cron", timezone, value: { expression } };
  }
  if (!["daily", "weekly", "monthly"].includes(frequency)) throw new Error("Schedule frequency must be hourly, daily, weekly, monthly or advanced");
  const hour = Number(input.hour);
  const minute = Number(input.minute ?? 0);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 ||
      !Number.isInteger(minute) || minute < 0 || minute > 59)
    throw new Error(`${frequency} schedules take hour 0-23 and minute 0-59; there is no scheduleTime field, cron goes in cronExpression with frequency advanced`);
  const value = { frequency, hour, minute };
  if (frequency === "weekly") {
    const dayOfWeek = required(input.dayOfWeek, "Schedule weekday, and a schedule change resends the whole schedule").toUpperCase();
    if (!new Set(["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]).has(dayOfWeek))
      throw new Error("Schedule weekday must be a day name such as friday");
    value.dayOfWeek = dayOfWeek;
  }
  if (frequency === "monthly") {
    const dayOfMonth = Number(required(input.dayOfMonth, "Schedule day of month, and a schedule change resends the whole schedule"));
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)
      throw new Error("Schedule day must be between 1 and 31");
    value.dayOfMonth = dayOfMonth;
  }
  return { kind: "calendar", timezone, value };
}

function specializationContext(database, specializationId) {
  const row = database.prepare(`
    SELECT s.id, s.name, s.playbook, s.revision, s.recurring_work_id AS recurringWorkId,
           r.workspace_id AS workspaceId
    FROM agent_specializations s JOIN recurring_work r ON r.id = s.recurring_work_id
    WHERE s.id = ?
  `).get(required(specializationId, "Specialist"));
  if (!row) throw new Error("Specialist not found");
  workspaceContext(database, row.workspaceId, ["admin", "member"]);
  return row;
}

function savePlaybook(database, specialization, playbook, source, feedback = null, executionId = null) {
  const next = Number(specialization.revision) + 1;
  const text = String(playbook ?? "").trim();
  if (text.length > 6_000) throw new Error("Consolidate the playbook to at most 6000 characters; existing guidance will not be silently dropped");
  if (feedback && String(feedback).length > 2_000) throw new Error("Rejection feedback must be at most 2000 characters");
  const at = iso();
  database.prepare(`
    UPDATE agent_specializations SET playbook = ?, revision = ?, updated_at = ? WHERE id = ?
  `).run(text, next, at, specialization.id);
  database.prepare(`
    INSERT INTO agent_specialization_versions
      (id, specialization_id, revision, playbook, source, feedback, execution_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), specialization.id, next, text, source,
    feedback ? String(feedback) : null, executionId, at);
  return { id: specialization.id, name: specialization.name, revision: next, playbook: text };
}

function producerSpecialization(database, executionId, itemId) {
  const current = database.prepare(`
    SELECT d.specialization_id AS specializationId, d.created_at AS createdAt,
           json_extract(e.config_json, '$.stagePurpose') AS purpose,
           json_extract(e.config_json, '$.candidateExecutionId') AS candidateExecutionId
    FROM agent_dispatches d JOIN execution_links e ON e.execution_id = d.execution_id
    WHERE d.execution_id = ? AND d.work_item_id = ?
  `).get(executionId, itemId);
  if (!current) throw new Error("This run has no agent assignment");
  if (current.purpose !== "reviewer") return current.specializationId;
  if (!current.candidateExecutionId) throw new Error("The reviewed candidate could not be identified");
  return database.prepare("SELECT specialization_id AS specializationId FROM agent_dispatches WHERE work_item_id = ? AND execution_id = ?")
    .get(itemId, current.candidateExecutionId)?.specializationId;
}

export async function executeProductCommand(action, input) {
    const at = iso();
    if (action === "set_data_folder") return useDataFolder(this.database, input.directory, this.agents?.live);
    if (action === "set_folder_root") {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin"]);
      // a folder is set on this team's own organization, team or workspace, never on someone else's
      const own = { organization: workspace.membership.organizationId, team: workspace.teamId, workspace: workspace.id };
      if (own[input.level] !== input.id) throw new Error("This team cannot set that folder");
      // Removing Bees deletes its own folder whole, and a root inside it would go with it
      assertFolderOutsideBees(input.directory, appDirectory(), "Runs");
      setFolderRoot(this.database, { level: input.level, id: input.id, directory: input.directory, live: this.agents?.live });
      return { level: input.level, folder: input.directory };
    }
    if (action === "create_organization") return transaction(this.database, () => {
      const { userId } = currentIdentity(this.database);
      const id = randomUUID();
      this.database.prepare(`INSERT INTO organizations VALUES (?, ?, 0, ?, 'active', ?, ?)`)
        .run(id, required(input.name, "Organization name"), userId, at, at);
      this.database.prepare("INSERT INTO organization_memberships VALUES (?, ?, 'owner', 'active', ?)")
        .run(userId, id, at);
      return { id };
    });
    if (action === "delete_organization") return transaction(this.database, () => {
      const { userId } = currentIdentity(this.database);
      const id = required(input.organizationId, "Organization");
      const organization = this.database.prepare(`
        SELECT om.role, EXISTS (
          SELECT 1 FROM bees_connections WHERE organization_id = o.id
        ) AS connected
        FROM organizations o JOIN organization_memberships om ON om.organization_id = o.id
        WHERE o.id = ? AND om.user_id = ? AND om.status = 'active'
      `).get(id, userId);
      if (!organization) throw new Error("Organization not found");
      if (organization.connected) throw new Error("Delete connected organizations through their owner account");
      if (organization.role !== "owner") throw new Error("Only the organization owner can delete it");
      this.database.prepare("DELETE FROM organizations WHERE id = ?").run(id);
      return { id };
    });
    if (action === "delete_team") return transaction(this.database, () => {
      const { userId } = currentIdentity(this.database);
      const id = required(input.teamId, "Team");
      const team = this.database.prepare(`
        SELECT t.organization_id AS organizationId, om.role, EXISTS (
          SELECT 1 FROM bees_connections WHERE organization_id = t.organization_id
        ) AS connected
        FROM teams t JOIN organization_memberships om ON om.organization_id = t.organization_id
        WHERE t.id = ? AND om.user_id = ? AND om.status = 'active'
      `).get(id, userId);
      if (!team) throw new Error("Team not found");
      if (team.connected) throw new Error("Delete connected teams through their workspace account");
      if (!["owner", "admin"].includes(team.role)) throw new Error("Only workspace owners and admins can delete teams");
      this.database.prepare("DELETE FROM teams WHERE id = ?").run(id);
      return { id, organizationId: team.organizationId };
    });
    if (action === "create_team") {
      const { userId } = currentIdentity(this.database);
      const organizationId = required(input.organizationId, "Organization");
      const organization = this.database.prepare(`
        SELECT o.name FROM organizations o JOIN organization_memberships om ON om.organization_id = o.id
        WHERE om.user_id = ? AND om.organization_id = ? AND om.status = 'active'
      `).get(userId, organizationId);
      if (!organization) throw new Error("You are not a member of this organization");
      const name = required(input.name, "Team name");
      const id = randomUUID();
      const workspaceId = randomUUID();
      // the folder comes first so the workspace already has one the moment it appears in the list
      const path = resolve(rootForWorkspace({
        id: workspaceId, name: DEFAULT_WORKSPACE_NAME, organizationId, organizationName: organization.name,
        teamId: id, teamName: name
      }), "workspaces", workspaceId);
      mkdirSync(path, { recursive: true });
      const dshWorkspace = this.workspaceRegistry
        ? await this.workspaceRegistry.create(path, DEFAULT_WORKSPACE_NAME)
        : null;
      return transaction(this.database, () => {
        this.database.prepare(`INSERT INTO teams VALUES (?, ?, ?, 0, ?, 'active', ?, ?)`)
          .run(id, organizationId, name, userId, at, at);
        this.database.prepare("INSERT INTO team_memberships VALUES (?, ?, 'admin', 'active', ?)")
          .run(userId, id, at);
        const workspace = insertDefaultWorkspace(this.database, id, {
          id: workspaceId,
          dshWorkspaceId: dshWorkspace ? String(dshWorkspace.id) : null,
          at
        });
        return { id, workspaceId: workspace.id, dshWorkspaceId: workspace.dshWorkspaceId };
      });
    }
    if (["create_item", "create_run", "create_goal"].includes(action)) {
      const created = transaction(this.database, () => {
      // a watcher knows its pipeline by name only, and an empty pipeline shows up nowhere else
      let processId = input.processId ? required(input.processId, "Process")
        : input.process ? proposalResource(this.database, input.workspaceId, "process", String(input.process).trim()).id : null;
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
      const workspace = workspaceContext(this.database, process.workspaceId, ["admin", "member"]);
      const receiptKey = input.idempotencyKey ? required(input.idempotencyKey, "Idempotency key") : null;
      if (receiptKey) {
        const receipt = this.database.prepare(`
          SELECT work_item_id AS id FROM bees_work_receipts WHERE workspace_id = ? AND idempotency_key = ?
        `).get(workspace.id, receiptKey);
        if (receipt) return { ...receipt, reused: true };
      }
      const accountUserId = executionAccount(this.database, workspace.teamId, input);
      const inputLocationIds = locationIds(this.database, process.workspaceId, input.inputLocationIds);
      const outputLocationId = locationIds(this.database, process.workspaceId,
        input.outputLocationId ? [input.outputLocationId] : [], true)[0] ?? null;
      const stageId = input.stageId || this.database.prepare(`
        SELECT id FROM stages WHERE process_id = ? AND archived_at IS NULL ORDER BY position LIMIT 1
      `).get(processId)?.id;
      if (!stageId || !this.database.prepare(`
        SELECT 1 FROM stages WHERE id = ? AND process_id = ? AND archived_at IS NULL
      `).get(stageId, processId)) throw new Error("Process has no matching stage");
      const resolvedTitle = resolveReferences(this.database, process.workspaceId, required(input.title, "Title"));
      const resolvedDescription = resolveReferences(this.database, process.workspaceId, input.description);
      const invocationText = resolvedDescription.text.trim() ? resolvedDescription.text : resolvedTitle.text;
      const invocation = leadingAgentInvocation(invocationText);
      const explicitIds = Array.isArray(input.agentIds) ? normalizeAgentIds(input.agentIds)
        : input.agentAssignmentId ? [required(input.agentAssignmentId, "Agent")] : [];
      const mentionedIds = invocation?.agents.map(({ id }) => id) ?? [];
      if (mentionedIds.length && explicitIds.length && JSON.stringify(mentionedIds) !== JSON.stringify(explicitIds))
        throw new Error("The referenced agents do not match the selected agents");
      const selectedAgentIds = mentionedIds.length ? mentionedIds : explicitIds;
      for (const agentId of selectedAgentIds) if (!assignment(this.database, agentId, process.workspaceId))
        throw new Error("Agent assignment is not in this team");
      const assignmentId = selectedAgentIds[0] ?? null;
      const id = randomUUID();
      const parentId = action === "create_run" ? null : parentFor(this.database, id, processId, input.parentId);
      const parent = parentId ? itemContext(this.database, parentId, ["admin", "member"]) : null;
      const recurringWorkId = parent && (parent.kind === "run" || parent.parentId)
        ? parent.recurringWorkId : null;
      if (input.runSettings !== undefined && (!input.runSettings || typeof input.runSettings !== "object" || Array.isArray(input.runSettings)))
        throw new Error("Run settings must be an object");
      const settings = normalizeRunSettings({ ...inheritedRunSettings(this.database, parent), ...(input.runSettings ?? {}) });
      if (settings.mcpAccess) checkMcpServers(this.database, { access: settings.mcpAccess, servers: settings.mcpServers });
      const kind = action === "create_goal" ? "goal" : action === "create_run" ? "run" : "work";
      const rawTitle = resolvedTitle.text;
      const titleInvocation = invocation && /^\s*[$@]/u.test(rawTitle)
        ? leadingAgentInvocation(rawTitle)
        : null;
      const title = titleInvocation?.request.split("\n")[0].trim() || rawTitle;
      const description = invocation ? `${invocation.reference} ${invocation.request}` : resolvedDescription.text;
      this.database.prepare(`
        INSERT INTO work_items (id, process_id, stage_id, parent_id, kind, title, description, owner,
          agent_assignment_id, agent_ids_json, priority, output_location_id, recurring_work_id, account_user_id,
          archived_at, deleted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      `).run(id, processId, stageId, parentId, kind, required(title, "Title"), description,
        input.owner ? String(input.owner) : null, assignmentId, JSON.stringify(selectedAgentIds), priorityOf(input.priority), parent ? null : outputLocationId,
        recurringWorkId, accountUserId, at, at);
      replaceLocations(this.database, "work_item_locations", "work_item_id", id, inputLocationIds);
      for (const location of referenceInputs(this.database, workspace.id, [...resolvedTitle.references, ...resolvedDescription.references]))
        this.database.prepare("INSERT OR IGNORE INTO work_item_locations VALUES (?, ?, ?)").run(id, location.id, location.relativePath);
      this.database.prepare("UPDATE work_items SET run_settings_json = ? WHERE id = ?")
        .run(JSON.stringify(settings), id);
      if (parent && outputLocationId) this.database.prepare("UPDATE work_items SET output_location_id = ?, updated_at = ? WHERE id = ?")
        .run(outputLocationId, at, this.workContext.lineage(parent.id)[0].id);
      if (receiptKey) this.database.prepare("INSERT INTO bees_work_receipts VALUES (?, ?, ?, ?)")
        .run(workspace.id, receiptKey, id, at);
      return { id };
      });
      // an applied plan only sets work up, the owner presses Start
      if (created.reused || input.idempotencyKey?.startsWith("proposal:")) return created;
      // the server leases only an item it has seen; a peer may still start it once the owner goes offline
      await this.processes.claims?.publish(created.id);
      // The row is already committed; throwing here would have the caller retry and create a second item.
      return { ...created, ...await this.processes.startItem(created.id).catch((error) => ({ error: message(error) })) };
    }
    if (action === "edit_item") return transaction(this.database, () => {
      const item = itemContext(this.database, input.itemId, ["admin", "member"]);
      const parentId = parentFor(this.database, item.id, item.processId, input.parentId === undefined ? item.parentId : input.parentId);
      const rootId = this.workContext.lineage(item.id)[0].id;
      if ((parentId ? this.workContext.lineage(parentId)[0].id : item.id) !== rootId)
        throw new Error("A work item must remain in its process run");
      const titleReferences = resolveReferences(this.database, item.workspaceId, required(input.title, "Title"));
      const descriptionReferences = resolveReferences(this.database, item.workspaceId, input.description);
      const rawTitle = titleReferences.text;
      const rawDescription = descriptionReferences.text;
      const invocationText = rawDescription.trim() ? rawDescription : rawTitle;
      const invocation = leadingAgentInvocation(invocationText);
      const explicitIds = Array.isArray(input.agentIds) ? normalizeAgentIds(input.agentIds)
        : input.agentAssignmentId ? [required(input.agentAssignmentId, "Agent")] : [];
      const selectedAgentIds = invocation?.agents.map(({ id }) => id) ?? explicitIds;
      for (const agentId of selectedAgentIds) if (!assignment(this.database, agentId, item.workspaceId))
        throw new Error("Agent assignment is not in this team");
      const titleInvocation = invocation && /^\s*[$@]/u.test(rawTitle)
        ? leadingAgentInvocation(rawTitle) : null;
      const title = titleInvocation?.request.split("\n")[0].trim() || rawTitle;
      const description = invocation ? `${invocation.reference} ${invocation.request}` : rawDescription;
      this.database.prepare(`
        UPDATE work_items SET title = ?, description = ?, owner = ?, agent_assignment_id = ?, agent_ids_json = ?,
          priority = ?, parent_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL
      `).run(title, description, input.owner ? String(input.owner) : null,
        selectedAgentIds[0] ?? null, JSON.stringify(selectedAgentIds), priorityOf(input.priority ?? item.priority), parentId, at, item.id);
      for (const location of referenceInputs(this.database, item.workspaceId, [...titleReferences.references, ...descriptionReferences.references]))
        this.database.prepare("INSERT OR IGNORE INTO work_item_locations VALUES (?, ?, ?)").run(item.id, location.id, location.relativePath);
      return {};
    });
    if (action === "archive_item") {
      const item = itemContext(this.database, input.itemId, ["admin", "member"]);
      return this.processes.archive(item.id, Boolean(input.restore));
    }
    if (action === "create_recurring_work") {
      const item = itemContext(this.database, input.itemId, ["admin", "member"]);
      if (item.parentId) throw new Error("Delegated child work cannot be scheduled; schedule its primary work item instead");
      // a scheduled run keeps the "every weekday" wording, so scheduling it again would copy the schedule every run
      if (item.recurringWorkId) throw new Error("This run was started by its schedule, which already exists; do the work now");
      if (!this.processes.isAutomatic(item.processId))
        throw new Error("Recurring work requires an automatic process");
      // an item has one schedule, like the screen shows it, so scheduling it again corrects that one
      const existing = this.database.prepare(`SELECT r.id FROM recurring_work r JOIN work_items w ON w.id = r.source_work_item_id
        WHERE r.origin_work_item_id = ? AND w.archived_at IS NULL AND w.deleted_at IS NULL`).get(item.id);
      if (existing) return this.execute("edit_recurring_work", { ...input, recurringWorkId: existing.id });
      const name = scheduleName(this.database, item.workspaceId, input.name);
      const schedule = recurringSchedule(input);
      const id = randomUUID();
      const sourceWorkItemId = randomUUID();
      const temporalScheduleId = `bees/recurring/${id}`;
      transaction(this.database, () => {
        const stageId = this.database.prepare(`
          SELECT id FROM stages WHERE process_id = ? AND archived_at IS NULL ORDER BY position LIMIT 1
        `).get(item.processId)?.id;
        if (!stageId) throw new Error("Process has no starting stage");
        this.database.prepare(`
          INSERT INTO recurring_work
            (id, workspace_id, process_id, source_work_item_id, origin_work_item_id, name, schedule_kind,
             schedule_json, timezone, temporal_schedule_id, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, item.workspaceId, item.processId, sourceWorkItemId, item.id, name, schedule.kind,
          JSON.stringify(schedule.value), schedule.timezone, temporalScheduleId, input.paused ? "paused" : "active", at, at);
        this.database.prepare(`
          INSERT INTO work_items
            (id, process_id, stage_id, parent_id, kind, title, description, owner,
             agent_assignment_id, agent_ids_json, priority, output_location_id, recurring_work_id,
             account_user_id, archived_at, deleted_at, created_at, updated_at)
          VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
        `).run(sourceWorkItemId, item.processId, stageId, item.kind === "goal" ? "goal" : "work",
          item.title, String(input.description ?? "").trim() || item.description, item.owner, item.agentAssignmentId, JSON.stringify(item.agentIds), item.priority,
          item.outputLocationId, id, item.accountUserId ?? null, at, at);
        this.database.prepare(`
          INSERT INTO work_item_locations
          SELECT DISTINCT ?, location_id, relative_path FROM work_item_locations
          WHERE work_item_id IN (SELECT value FROM json_each(?))
        `).run(sourceWorkItemId, JSON.stringify(workRunItems(this.database, item.id)));
        this.database.prepare("UPDATE work_items SET run_settings_json = ? WHERE id = ?")
          .run(JSON.stringify(item.runSettings), sourceWorkItemId);
      });
      try {
        const runtime = await this.processes.createRecurring(id);
        return { id, sourceWorkItemId, timezone: schedule.timezone, ...runtime };
      } catch (error) {
        transaction(this.database, () => {
          this.database.prepare("DELETE FROM work_items WHERE id = ?").run(sourceWorkItemId);
          this.database.prepare("DELETE FROM recurring_work WHERE id = ?").run(id);
        });
        throw error;
      }
    }
    if (action === "edit_recurring_work") {
      const id = required(input.recurringWorkId, "Recurring work");
      const current = this.database.prepare(`
        SELECT r.*, p.workspace_id AS workspaceId FROM recurring_work r
        JOIN processes p ON p.id = r.process_id WHERE r.id = ?
      `).get(id);
      if (!current) throw new Error("Recurring work not found");
      workspaceContext(this.database, current.workspaceId, ["admin", "member"]);
      const schedule = recurringSchedule(input);
      const name = scheduleName(this.database, current.workspaceId, input.name, id);
      transaction(this.database, () => {
        this.database.prepare(`
          UPDATE recurring_work SET name = ?, schedule_kind = ?, schedule_json = ?, timezone = ?, updated_at = ?
          WHERE id = ?
        `).run(name, schedule.kind, JSON.stringify(schedule.value), schedule.timezone, at, id);
        this.database.prepare(`
          UPDATE agent_specializations SET name = ? || ' · ' || (
            SELECT name FROM agent_assignments WHERE id = agent_assignment_id
          ), updated_at = ? WHERE recurring_work_id = ?
        `).run(name, at, id);
        const description = String(input.description ?? "").trim();
        if (description) this.database.prepare("UPDATE work_items SET description = ?, updated_at = ? WHERE id = ?").run(description, at, current.source_work_item_id);
      });
      try { return { id, ...await this.processes.updateRecurring(id) }; }
      catch (error) {
        transaction(this.database, () => {
          this.database.prepare(`
            UPDATE recurring_work SET name = ?, schedule_kind = ?, schedule_json = ?, timezone = ?, updated_at = ?
            WHERE id = ?
          `).run(current.name, current.schedule_kind, current.schedule_json, current.timezone, current.updated_at, id);
          this.database.prepare(`
            UPDATE agent_specializations SET name = ? || ' · ' || (
              SELECT name FROM agent_assignments WHERE id = agent_assignment_id
            ) WHERE recurring_work_id = ?
          `).run(current.name, id);
        });
        throw error;
      }
    }
    if (["pause_recurring_work", "resume_recurring_work"].includes(action)) {
      const id = required(input.recurringWorkId, "Recurring work");
      const recurring = this.database.prepare("SELECT workspace_id AS workspaceId FROM recurring_work WHERE id = ?").get(id);
      if (!recurring) throw new Error("Recurring work not found");
      workspaceContext(this.database, recurring.workspaceId, ["admin", "member"]);
      const paused = action === "pause_recurring_work";
      await this.processes.setRecurringPaused(id, paused);
      this.database.prepare("UPDATE recurring_work SET status = ?, updated_at = ? WHERE id = ?")
        .run(paused ? "paused" : "active", iso(), id);
      return { id, status: paused ? "paused" : "active" };
    }
    if (["specialist_feedback_context", "apply_specialist_feedback"].includes(action)) return transaction(this.database, () => {
      if (input.viaAgent) throw new Error("Only a human can approve future-run guidance");
      const executionId = required(input.executionId, "Execution");
      const { item } = runContext(this.database, executionId);
      if (!item?.recurringWorkId) throw new Error("Future-run feedback is only available for scheduled runs");
      const specializationId = producerSpecialization(this.database, executionId, item.id);
      if (!specializationId) throw new Error("The producing specialist could not be identified");
      const specialization = specializationContext(this.database, specializationId);
      if (specialization.recurringWorkId !== item.recurringWorkId)
        throw new Error("The specialist does not belong to this recurring work");
      if (action === "specialist_feedback_context") return {
        id: specialization.id, name: specialization.name, revision: specialization.revision,
        playbook: specialization.playbook, recurringWorkId: specialization.recurringWorkId
      };
      if (input.applyToFuture !== true) throw new Error("Explicitly choose to apply guidance to future runs");
      const feedback = required(input.feedback, "Rejection reason");
      const playbook = required(input.playbook, "Reusable future-run guidance");
      if (feedback.length < 3 || feedback.length > 2000) throw new Error("Provide 3 to 2000 characters of rejection feedback");
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
        throw new Error("Load the current playbook before editing future guidance");
      // Retrying the same human action must not create duplicate playbook revisions.
      if (playbook.trim() === specialization.playbook) return {
        id: specialization.id, name: specialization.name, revision: specialization.revision,
        playbook: specialization.playbook, learnedChange: specialization.playbook
      };
      if (input.expectedRevision !== specialization.revision)
        throw new Error("The playbook changed while you were editing. Reload its latest version before saving");
      const result = savePlaybook(this.database, specialization, playbook, "feedback", feedback, executionId);
      return { ...result, learnedChange: result.playbook };
    });
    if (action === "edit_specialist_playbook") return transaction(this.database, () => {
      const specialization = specializationContext(this.database, input.specializationId);
      return savePlaybook(this.database, specialization, input.playbook, "manual");
    });
    if (action === "reset_specialist_playbook") return transaction(this.database, () => {
      const specialization = specializationContext(this.database, input.specializationId);
      return savePlaybook(this.database, specialization, "", "reset");
    });
    if (action === "undo_specialist_playbook") return transaction(this.database, () => {
      const specialization = specializationContext(this.database, input.specializationId);
      const prior = this.database.prepare(`
        SELECT playbook FROM agent_specialization_versions
        WHERE specialization_id = ? AND revision < ? ORDER BY revision DESC LIMIT 1
      `).get(specialization.id, specialization.revision);
      return savePlaybook(this.database, specialization, prior?.playbook ?? "", "undo");
    });
    if (["start_item", "pause_item", "resume_item", "retry_item", "cancel_item"].includes(action)) {
      const item = itemContext(this.database, input.itemId, ["admin", "member"]);
      return this.processes.signal(item.id, action.replace("_item", ""));
    }
    if (action === "create_process") return transaction(this.database, () => {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      // Home sends only the template. The form also sends the stages it showed, so it still works if the template goes.
      const template = input.templateId ? this.database.prepare(`
        SELECT workspace_id AS workspaceId, description, stages_json AS stages
        FROM process_templates WHERE id = ? AND archived_at IS NULL
      `).get(input.templateId) : null;
      if (input.templateId && !template && !input.stages) throw new Error("Process template not found");
      if (template && template.workspaceId !== workspace.id)
        throw new Error("That process template belongs to another team");
      const templateStages = template ? JSON.parse(template.stages) : [];
      const stages = processStages(input.stages ?? templateStages, "process", templateStages);
      const inputLocationIds = locationIds(this.database, workspace.id, input.inputLocationIds);
      const outputLocationId = locationIds(this.database, workspace.id,
        input.outputLocationId ? [input.outputLocationId] : [], true)[0] ?? null;
      const id = insertProcess(this.database, workspace.id, input.name,
        input.description ?? template?.description, stages,
        "standard", undefined, undefined, input.accountUserId || null);
      const policy = checkMcpServers(this.database, mcpPolicy(input, { access: "none", servers: [] }));
      this.database.prepare("UPDATE processes SET output_location_id = ?, mcp_access = ?, mcp_servers_json = ? WHERE id = ?")
        .run(outputLocationId, policy.access, JSON.stringify(policy.servers), id);
      replaceLocations(this.database, "process_locations", "process_id", id, inputLocationIds);
      return { id };
    });
    if (action === "create_process_template") return transaction(this.database, () => {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      const id = randomUUID();
      const stages = processStages(input.stages, "process template");
      this.database.prepare(`
        INSERT INTO process_templates
          (id, workspace_id, name, description, stages_json, account_user_id, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(id, workspace.id, required(input.name, "Template name"), String(input.description ?? ""),
        JSON.stringify(stages), input.accountUserId || null, at, at);
      return { id };
    });
    if (action === "copy_process") return transaction(this.database, () => {
      const processId = required(input.processId, "Process");
      const process = processContext(this.database, processId, ["admin", "member"]);
      if (this.agents?.apps?.ownsProcess(processId))
        throw new Error("App processes cannot be copied without their permission boundary. Install the package through Apps instead.");
      const workspaceId = process.workspaceId;
      const name = required(input.name, "New process name");

      // Duplicate process agents assigned to stages
      const stages = this.database.prepare(`SELECT * FROM stages WHERE process_id = ? AND archived_at IS NULL ORDER BY position`).all(processId);
      const stageRoutes = this.database.prepare(`SELECT * FROM stage_routes WHERE stage_id IN (SELECT id FROM stages WHERE process_id = ? AND archived_at IS NULL)`).all(processId);
      
      const routeAgentIds = (route) => {
        const ids = normalizeAgentIds(JSON.parse(route.agent_ids_json || "[]"));
        return ids.length ? ids : route.agent_assignment_id ? [route.agent_assignment_id] : [];
      };
      const uniqueAgentIds = [...new Set(stageRoutes.flatMap(routeAgentIds))];
      const oldToNewAgentId = {};
      for (const oldAgentId of uniqueAgentIds) {
        const agent = this.database.prepare(`SELECT * FROM agent_assignments WHERE id = ?`).get(oldAgentId);
        if (!agent) continue;
        
        // Don't duplicate workspace-wide default agents (they must be unique per role)
        if (agent.system_role !== null) {
          oldToNewAgentId[oldAgentId] = oldAgentId;
          continue;
        }

        const newAgentId = randomUUID();
        let newName = agent.name + " (Copy)";
        let counter = 1;
        while (this.database.prepare("SELECT 1 FROM agent_assignments WHERE workspace_id = ? AND name = ?").get(workspaceId, newName)) {
          counter++;
          newName = `${agent.name} (Copy ${counter})`;
        }
        
        this.database.prepare(`
          INSERT INTO agent_assignments (id, workspace_id, preset_id, name, description, instructions, model, reasoning_effort, system_role, capabilities_json, enabled, max_concurrency, created_at, updated_at, mcp_access, mcp_servers_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(newAgentId, workspaceId, agent.preset_id, newName, agent.description, agent.instructions, agent.model, agent.reasoning_effort, agent.system_role, agent.capabilities_json, agent.enabled, agent.max_concurrency, at, at, agent.mcp_access, agent.mcp_servers_json);
        this.database.prepare(`INSERT INTO agent_locations (agent_assignment_id, location_id, relative_path) SELECT ?, location_id, relative_path FROM agent_locations WHERE agent_assignment_id = ?`).run(newAgentId, oldAgentId);
        oldToNewAgentId[oldAgentId] = newAgentId;
      }

      // Duplicate the process
      const newProcessId = randomUUID();
      this.database.prepare(`INSERT INTO processes (id, workspace_id, kind, name, description, output_location_id, mcp_access, mcp_servers_json, account_user_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(newProcessId, workspaceId, "standard", name, process.description, process.outputLocationId, process.mcpAccess, JSON.stringify(process.mcpServers), input.accountUserId || null, at, at);
      this.database.prepare(`INSERT INTO process_locations (process_id, location_id, relative_path) SELECT ?, location_id, relative_path FROM process_locations WHERE process_id = ?`).run(newProcessId, processId);

      // Duplicate the stages and routes
      for (const stage of stages) {
        const newStageId = randomUUID();
        this.database.prepare(`INSERT INTO stages (id, process_id, name, position, driver, requires_human_approval, is_terminal, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`).run(newStageId, newProcessId, stage.name, stage.position, stage.driver, stage.requires_human_approval, stage.is_terminal);
        const route = stageRoutes.find(r => r.stage_id === stage.id);
        if (route) {
          const mappedAgentIds = routeAgentIds(route).map((id) => oldToNewAgentId[id] || id);
          this.database.prepare(`
            INSERT INTO stage_routes
              (stage_id, agent_assignment_id, required_capabilities_json,
               created_at, updated_at, agent_ids_json)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(newStageId, mappedAgentIds[0] ?? null, route.required_capabilities_json,
            at, at, JSON.stringify(mappedAgentIds));
        }
      }

      return { id: newProcessId };
    });
    if (["restore_process", "restore_process_template"].includes(action)) return transaction(this.database, () => {
      const template = action === "restore_process_template";
      const table = template ? "process_templates" : "processes";
      const id = required(template ? input.templateId : input.processId, "Process template");
      const row = this.database.prepare(`SELECT workspace_id AS workspaceId FROM ${table} WHERE id = ?`).get(id);
      if (!row) throw new Error("Process template not found");
      workspaceContext(this.database, row.workspaceId, ["admin", "member"]);
      this.database.prepare(`UPDATE ${table} SET archived_at = NULL, updated_at = ? WHERE id = ?`).run(at, id);
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
      if (this.database.prepare("SELECT 1 FROM recurring_work WHERE process_id = ? AND status = 'active' LIMIT 1").get(process.id))
        throw new Error("Pause this process's schedules before archiving it");
      // archiving keeps runs and history, so only work in flight blocks it; a failed run is not
      if (this.processes.isAutomatic(process.id) && hasActiveWork(this.database, process.id, ["completed", "cancelled", "failed"]))
        throw new Error("Finish or cancel active work before archiving this process");
      this.database.prepare("UPDATE processes SET archived_at = ?, updated_at = ? WHERE id = ?").run(at, at, process.id);
      // A schedule's definition item goes with its process, or the Schedules screen keeps listing it.
      this.database.prepare(`
        UPDATE work_items SET archived_at = ?, updated_at = ? WHERE process_id = ? AND archived_at IS NULL
          AND id IN (SELECT source_work_item_id FROM recurring_work)
      `).run(at, at, process.id);
      return {};
    });
    if (action === "edit_process") return transaction(this.database, () => {
      const processId = required(input.processId, "Process");
      processContext(this.database, processId, ["admin", "member"]);
      const existing = this.database.prepare(`
        SELECT id, name, driver, requires_human_approval AS requiresHumanApproval
        FROM stages WHERE process_id = ? AND archived_at IS NULL ORDER BY position
      `).all(processId);
      const names = processStages(input.stages, "process", existing);
      // only a changed stage list can strand a run mid-way, so the rules text stays editable while teammates run it
      const restaged = names.length !== existing.length || names.some((stage, index) => stage.name !== existing[index].name
        || stage.driver !== existing[index].driver || stage.requiresHumanApproval !== Boolean(existing[index].requiresHumanApproval));
      // a failed run is not in flight, same rule as archiving
      if (restaged && this.processes.isAutomatic(processId) && hasActiveWork(this.database, processId, ["completed", "cancelled", "failed"]))
        throw new Error("Finish or cancel active automatic work before changing this process's stages");
      const assigned = Array(names.length).fill(null);
      const used = new Set();
      names.forEach(({ name }, index) => {
        const stage = existing.find((row) => !used.has(row.id) && row.name.toLocaleLowerCase() === name.toLocaleLowerCase());
        if (stage) { assigned[index] = stage; used.add(stage.id); }
      });
      names.forEach((_stage, index) => {
        if (assigned[index]) return;
        const stage = existing.find(({ id }) => !used.has(id));
        if (stage) { assigned[index] = stage; used.add(stage.id); }
      });
      for (const stage of existing.filter(({ id }) => !used.has(id))) {
        if (this.database.prepare("SELECT 1 FROM work_items WHERE stage_id = ? AND deleted_at IS NULL").get(stage.id))
          throw new Error(`Move work out of “${stage.name}” before removing it`);
      }
      this.database.prepare("UPDATE stages SET position = -rowid WHERE process_id = ? AND archived_at IS NULL").run(processId);
      existing.filter(({ id }) => !used.has(id)).forEach(({ id }) =>
        this.database.prepare("UPDATE stages SET archived_at = ? WHERE id = ?").run(at, id));
      names.forEach(({ name, driver, requiresHumanApproval }, position) => {
        // a name typed over a stage in the same spot is a rename, so that stage keeps its approval gate
        const renamed = typeof input.stages[position] === "string" && existing.indexOf(assigned[position]) === position;
        if (assigned[position]) this.database.prepare(`
          UPDATE stages SET name = ?, position = ?, driver = ?, requires_human_approval = ?, is_terminal = ? WHERE id = ?
        `).run(name, position, driver, requiresHumanApproval || (renamed && assigned[position].requiresHumanApproval) ? 1 : 0,
          driver === "terminal" ? 1 : 0, assigned[position].id);
        else this.database.prepare(`
          INSERT INTO stages (id, process_id, name, position, driver, requires_human_approval, is_terminal, archived_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
        `).run(randomUUID(), processId, name, position, driver, requiresHumanApproval ? 1 : 0,
          driver === "terminal" ? 1 : 0);
      });
      this.database.prepare(`UPDATE processes SET name = ?, description = ?, updated_at = ? WHERE id = ?`)
        .run(required(input.name, "Name"), String(input.description ?? ""), at, processId);
      return { id: processId };
    });
    if (action === "set_process_mcp") {
      const result = transaction(this.database, () => {
      const process = processContext(this.database, input.processId, ["admin", "member"]);
      const policy = checkMcpServers(this.database, mcpPolicy(input), process.mcpServers);
      this.database.prepare("UPDATE processes SET mcp_access = ?, mcp_servers_json = ?, updated_at = ? WHERE id = ?")
        .run(policy.access, JSON.stringify(policy.servers), at, process.id);
      return { id: process.id };
      });
      await this.agents?.refreshMcpForProcess?.(result.id);
      return result;
    }
    if (action === "set_stage_route") return transaction(this.database, () => {
      const stageId = required(input.stageId, "Stage");
      const stage = this.database.prepare(`
        SELECT s.id, s.process_id AS processId, s.driver, p.kind, p.workspace_id AS workspaceId
        FROM stages s JOIN processes p ON p.id = s.process_id
        WHERE s.id = ? AND s.archived_at IS NULL
      `).get(stageId);
      if (!stage) throw new Error("Stage not found");
      // Rerouting Goals from inside a run is how a run would replace the reviewer that judges it.
      if (input.viaAgent && stage.kind === "goals") throw new Error("A run cannot reroute the Goals process");
      workspaceContext(this.database, stage.workspaceId, ["admin", "member"]);
      if (["manual", "terminal"].includes(stage.driver)) throw new Error("This stage does not run an agent");
      const requiredCapabilities = capabilities(input.requiredCapabilities, "Stage capabilities");
      if (input.targetType && input.targetType !== "agent") throw new Error("A stage routes to agents; name them in agentIds");
      const ids = normalizeAgentIds(Array.isArray(input.agentIds) ? input.agentIds
        : input.targetType === "agent" && input.targetId ? [input.targetId] : []);
      if (stage.driver === "review" && ids.length > 1) throw new Error("A review stage must use one independent agent");
      for (const id of ids) {
        if (!assignment(this.database, id, stage.workspaceId)) throw new Error("Agent is not in this team");
        // An app agent runs with no MCP access; on an ordinary process nothing mounts the sandbox that holds it in.
        if (this.database.prepare(`SELECT 1 FROM app_agent_owners a WHERE a.agent_id = ?
          AND NOT EXISTS (SELECT 1 FROM app_process_owners p WHERE p.process_id = ? AND p.installation_id = a.installation_id)`).get(id, stage.processId))
          throw new Error("Manage app agents through Apps to preserve their permission boundary");
      }
      if (!ids.length && !requiredCapabilities.length) {
        this.database.prepare("DELETE FROM stage_routes WHERE stage_id = ?").run(stage.id);
        this.database.prepare("UPDATE processes SET updated_at = ? WHERE id = ?").run(at, stage.processId);
        return { id: stage.id };
      }
      this.database.prepare(`
        INSERT INTO stage_routes
          (stage_id, agent_assignment_id, required_capabilities_json, created_at, updated_at, agent_ids_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(stage_id) DO UPDATE SET agent_assignment_id = excluded.agent_assignment_id,
          required_capabilities_json = excluded.required_capabilities_json,
          agent_ids_json = excluded.agent_ids_json,
          updated_at = excluded.updated_at
      `).run(stage.id, ids[0] ?? null, JSON.stringify(requiredCapabilities), at, at, JSON.stringify(ids));
      this.database.prepare("UPDATE processes SET updated_at = ? WHERE id = ?").run(at, stage.processId);
      return { id: stage.id };
    });
    if (["archive_agent_assignment", "restore_agent_assignment", "copy_agent_assignment"].includes(action)) return transaction(this.database, () => {
      const id = required(input.agentAssignmentId, "Agent");
      const agent = this.database.prepare("SELECT * FROM agent_assignments WHERE id = ?").get(id);
      if (!agent) throw new Error("Agent not found");
      workspaceContext(this.database, agent.workspace_id, ["admin", "member"]);
      if (this.database.prepare("SELECT 1 FROM app_agent_owners WHERE agent_id = ?").get(id))
        throw new Error("Manage app agents through Apps to preserve their permission boundary");
      if (action === "copy_agent_assignment") {
        if (agent.archived_at) throw new Error("Restore this agent before duplicating it");
        const copiedId = randomUUID();
        this.database.prepare(`
          INSERT INTO agent_assignments (id, workspace_id, preset_id, name, description, instructions,
            model, reasoning_effort, system_role, capabilities_json, enabled, max_concurrency,
            created_at, updated_at, mcp_access, mcp_servers_json)
          SELECT ?, workspace_id, preset_id, ?, description, instructions, model, reasoning_effort,
            NULL, capabilities_json, enabled, max_concurrency, ?, ?, mcp_access, mcp_servers_json
          FROM agent_assignments WHERE id = ?
        `).run(copiedId, required(input.name, "New agent name"), at, at, id);
        this.database.prepare(`INSERT INTO agent_locations (agent_assignment_id, location_id, relative_path)
          SELECT ?, location_id, relative_path FROM agent_locations WHERE agent_assignment_id = ?`).run(copiedId, id);
        return { id: copiedId };
      }
      if (agent.system_role) throw new Error("The built-in Bees agents cannot be archived");
      const restoring = action === "restore_agent_assignment";
      if (restoring && !agent.archived_at) return { id };
      this.database.prepare("UPDATE agent_assignments SET archived_at = ?, enabled = ?, updated_at = ? WHERE id = ?")
        .run(restoring ? null : at, restoring ? 1 : 0, at, id);
      return { id };
    });
    if (action === "add_agent_assignment") {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      const presetId = required(input.presetId, "agent preset");
      if (this.agentPresets) {
        const presets = await this.agentPresets.list();
        const preset = presets.find(({ id }) => id === presetId);
        if (!preset || preset.broken || await this.presetGap(presetId)) throw new Error("The agent preset is unavailable");
      }
      const policy = checkMcpServers(this.database, mcpPolicy(input));
      if (input.viaAgent) {
        assertAgentHasTools({ mcpAccess: policy.access, mcpServers: policy.servers, name: input.name });
        assertUsableInstructions(input);
      }
      return transaction(this.database, () => {
        const id = randomUUID();
        const inputLocationIds = locationIds(this.database, workspace.id, input.inputLocationIds);
        const maxConcurrency = Number(input.maxConcurrency ?? 0);
        if (!Number.isInteger(maxConcurrency) || maxConcurrency < 0 || maxConcurrency > 1000)
          throw new Error("Agent concurrency must be an integer from 0 to 1000");
        this.database.prepare(`
          INSERT INTO agent_assignments
            (id, workspace_id, preset_id, name, description, instructions, model, reasoning_effort, system_role,
             capabilities_json, enabled, max_concurrency, created_at, updated_at, mcp_access, mcp_servers_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, workspace.id, presetId, required(input.name, "Agent name"),
          String(input.description ?? ""), String(input.instructions ?? ""), optionalModelRoute(input.model),
          optionalReasoningEffort(input.reasoningEffort),
          JSON.stringify(capabilities(input.capabilities)), input.enabled === false ? 0 : 1,
          maxConcurrency, at, at, policy.access, JSON.stringify(policy.servers));
        replaceLocations(this.database, "agent_locations", "agent_assignment_id", id, inputLocationIds);
        return { id };
      });
    }
    if (action === "edit_agent_assignment") {
      const id = input.agentAssignmentId
        ?? proposalResource(this.database, required(input.workspaceId, "Workspace"), "agent", input.agent).id;
      const assignment = this.database.prepare(`
        SELECT workspace_id AS workspaceId, name, description, instructions, model, preset_id AS presetId,
               system_role AS systemRole, reasoning_effort AS reasoningEffort, capabilities_json AS capabilities,
               enabled, max_concurrency AS maxConcurrency,
               mcp_access AS mcpAccess, mcp_servers_json AS mcpServers
        FROM agent_assignments WHERE id = ? AND archived_at IS NULL
      `).get(required(id, "Agent"));
      if (!assignment) throw new Error("Agent not found");
      // A run editing the agent that reviews it could tell that reviewer to pass everything.
      if (input.viaAgent && assignment.systemRole) throw new Error("A run cannot edit the agents Bees ships");
      workspaceContext(this.database, assignment.workspaceId, ["admin", "member"]);
      const presetId = input.presetId ?? assignment.presetId;
      if (this.agentPresets) {
        const preset = (await this.agentPresets.list()).find(({ id }) => id === presetId);
        if (!preset || preset.broken || await this.presetGap(presetId)) throw new Error("The agent preset is unavailable");
      }
      const nextCapabilities = Object.hasOwn(input, "capabilities")
        ? capabilities(input.capabilities) : JSON.parse(assignment.capabilities || "[]");
      const enabled = Object.hasOwn(input, "enabled") ? input.enabled !== false : Boolean(assignment.enabled);
      const maxConcurrency = Number(Object.hasOwn(input, "maxConcurrency")
        ? input.maxConcurrency : assignment.maxConcurrency);
      const reasoningEffort = Object.hasOwn(input, "reasoningEffort")
        ? optionalReasoningEffort(input.reasoningEffort) : assignment.reasoningEffort;
      if (!Number.isInteger(maxConcurrency) || maxConcurrency < 0 || maxConcurrency > 1000)
        throw new Error("Agent concurrency must be an integer from 0 to 1000");
      const current = JSON.parse(assignment.mcpServers || "[]");
      const policy = checkMcpServers(this.database, mcpPolicy(input, {
        access: assignment.mcpAccess ?? "all", servers: current
      }), current);
      if (input.viaAgent && Object.hasOwn(input, "mcpAccess"))
        assertAgentHasTools({ mcpAccess: policy.access, mcpServers: policy.servers, name: assignment.name });
      // a bad folder used to throw after the update landed, so the agent saved half the edit
      return transaction(this.database, () => {
      this.database.prepare(`
        UPDATE agent_assignments SET preset_id = ?, name = ?, description = ?, instructions = ?,
          model = ?, reasoning_effort = ?, capabilities_json = ?, enabled = ?, max_concurrency = ?,
          mcp_access = ?, mcp_servers_json = ?, updated_at = ? WHERE id = ?
      `).run(presetId, assignment.systemRole ? assignment.name : required(input.name ?? assignment.name, "Agent name"),
        String(input.description ?? assignment.description ?? ""), String(input.instructions ?? assignment.instructions ?? ""),
        optionalModelRoute(Object.hasOwn(input, "model") ? input.model : assignment.model),
        reasoningEffort,
        JSON.stringify(nextCapabilities), enabled ? 1 : 0, maxConcurrency,
        policy.access, JSON.stringify(policy.servers), at, id);
      if (Object.hasOwn(input, "inputLocationIds")) replaceLocations(this.database, "agent_locations",
        "agent_assignment_id", id, locationIds(this.database, assignment.workspaceId, input.inputLocationIds));
      return { id };
      });
    }
    if (action === "add_location") {
      const teamId = required(input.teamId, "Team");
      requireTeam(this.database, teamId, ["admin", "member"]);
      const kind = input.kind === "file" ? "file" : "folder";
      const canonical = input.path ? canonicalMapping(input.path, kind) : null;
      return transaction(this.database, () => {
        const { deviceId } = currentIdentity(this.database);
        const name = required(input.name, "Name");

        if (canonical) {
          const existing = this.database.prepare(`
            SELECT l.id, m.absolute_path AS path 
            FROM team_locations l
            LEFT JOIN device_location_mappings m ON m.location_id = l.id AND m.device_id = ?
            WHERE l.team_id = ? AND (lower(l.name) = lower(?) OR m.absolute_path = ?)
          `).get(deviceId, teamId, name, canonical);
          if (existing && existing.path === canonical) return { id: existing.id, reused: true };
        }

        const id = randomUUID();
        this.database.prepare(`
          INSERT INTO team_locations VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `).run(id, teamId, stableUuid(`${teamId}:${id}`), name, kind, String(input.description ?? ""), at, at);
        if (canonical) this.database.prepare(`INSERT INTO device_location_mappings VALUES (?, ?, ?, ?)`)
          .run(id, deviceId, canonical, at);
        return { id };
      });
    }
    if (action === "map_location") {
      const location = mappedLocation(this.database, required(input.locationId, "Location"));
      if (!location) throw new Error("Location not found");
      requireTeam(this.database, location.teamId, ["admin", "member"]);
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
      requireTeam(this.database, location.teamId, ["admin", "member"]);
      const { deviceId } = currentIdentity(this.database);
      this.database.prepare("DELETE FROM device_location_mappings WHERE location_id = ? AND device_id = ?")
        .run(location.id, deviceId);
      return {};
    }
    if (action === "archive_location") {
      const location = mappedLocation(this.database, required(input.locationId, "Location"));
      if (!location) throw new Error("Location not found");
      requireTeam(this.database, location.teamId, ["admin", "member"]);
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
      `).get(locationId, workspace.teamId)) throw new Error("Location is unavailable to this team");
      const table = target.targetKind === "process" ? "process_locations" : "work_item_locations";
      this.database.prepare(`INSERT OR IGNORE INTO ${table} VALUES (?, ?, ?)`)
        .run(target.id, locationId, logicalRelativePath(input.relativePath));
      this.database.prepare(`UPDATE ${target.targetKind === "process" ? "processes" : "work_items"}
        SET updated_at = ? WHERE id = ?`).run(at, target.id);
      return {};
    });
    if (action === "detach_location") return transaction(this.database, () => {
      const relativePath = Object.hasOwn(input, "relativePath") ? logicalRelativePath(input.relativePath) : null;
      if (input.processId) {
        const process = processContext(this.database, input.processId, ["admin", "member"]);
        this.database.prepare("DELETE FROM process_locations WHERE process_id = ? AND location_id = ? AND (? IS NULL OR relative_path = ?)")
          .run(process.id, required(input.locationId, "Location"), relativePath, relativePath);
        this.database.prepare("UPDATE processes SET updated_at = ? WHERE id = ?").run(at, process.id);
      } else {
        const item = itemContext(this.database, input.itemId, ["admin", "member"]);
        this.database.prepare("DELETE FROM work_item_locations WHERE work_item_id IN (SELECT value FROM json_each(?)) AND location_id = ? AND (? IS NULL OR relative_path = ?)")
          .run(JSON.stringify(workRunItems(this.database, item.id)), required(input.locationId, "Location"), relativePath, relativePath);
        this.database.prepare("UPDATE work_items SET updated_at = ? WHERE id = ?").run(at, item.id);
      }
      return {};
    });
    if (action === "set_output_location") return transaction(this.database, () => {
      const target = input.processId
        ? { ...processContext(this.database, input.processId, ["admin", "member"]), table: "processes" }
        : { ...this.workContext.lineage(itemContext(this.database, input.itemId, ["admin", "member"]).id)[0], table: "work_items" };
      const locationId = locationIds(this.database, target.workspaceId,
        input.locationId ? [input.locationId] : [], true)[0] ?? null;
      this.database.prepare(`UPDATE ${target.table} SET output_location_id = ?, updated_at = ? WHERE id = ?`)
        .run(locationId, at, target.id);
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
      const list = JSON.parse(proposal.changes);
      for (const change of list) {
        authorizeReferences(this.database, proposal.workspaceId, change.references ?? []);
        if (change.templateId) resolveReference(this.database, proposal.workspaceId, "process-template", change.templateId, true);
      }
      // Claim the row before running anything, so a second click cannot apply the plan twice.
      if (!this.database.prepare("UPDATE bees_proposals SET status = 'applied', updated_at = ? WHERE id = ? AND status = 'pending'")
        .run(at, proposalId).changes) throw new Error("This plan was already applied");
      // Resolve earlier creations first, then active resources in this workspace.
      const made = { process: new Map(), agent: new Map(), item: new Map() };
      const idOf = (kind, name) => {
        const id = made[kind].get(String(name ?? "").trim().toLocaleLowerCase());
        if (id) return id;
        if (kind === "item") throw new Error(`The proposed item "${name}" was not created earlier in this proposal`);
        return proposalResource(this.database, proposal.workspaceId, kind, String(name ?? "").trim()).id;
      };
      const folderId = (name) => proposedFolder(this.database, proposal.workspaceId, name).id;
      const results = new Array(list.length);
      // Servers go in first so an agent can list one installed by the same plan, whatever order the planner wrote.
      const order = [...list.keys()].sort((a, b) => Number(CAPABILITY_CHANGES.includes(list[b].action)) - Number(CAPABILITY_CHANGES.includes(list[a].action)));
      try {
        for (const index of order) {
          const change = list[index];
          const payload = { ...change, workspaceId: proposal.workspaceId,
            connectionId: input.connectionId, accountUserId: input.accountUserId };
          // Running the same prompt twice proposes the same agent names; reuse rather than refuse.
          if (change.action === "add_agent_assignment") {
            const existing = this.database.prepare(`
              SELECT id FROM agent_assignments WHERE workspace_id = ? AND lower(name) = lower(?)
            `).get(proposal.workspaceId, String(change.name ?? ""));
            if (existing) { made.agent.set(String(change.name).toLocaleLowerCase(), existing.id); results[index] = { id: existing.id, reused: true }; continue; }
          }
          if (change.action === "edit_agent_assignment") Object.assign(payload, { agentAssignmentId: idOf("agent", change.agent), viaAgent: true });
          // A catalog server that is already installed is reused; only the API bridge is meant to exist many times.
          if (change.action === "install_mcp_server" && !catalogEntry(change.catalogId)?.nameFrom) {
            const installed = this.database.prepare("SELECT id FROM mcp_servers WHERE catalog_id = ?").get(String(change.catalogId ?? ""));
            if (installed) { results[index] = { id: installed.id, reused: true }; continue; }
          }
          if (change.action === "create_process") {
            // Execute the stages shown in the approved proposal, even if the saved template was edited.
            delete payload.templateId;
            const existing = this.database.prepare(`
              SELECT id FROM processes WHERE workspace_id = ? AND lower(name) = lower(?) AND archived_at IS NULL
            `).get(proposal.workspaceId, String(change.name ?? ""));
            if (existing) { made.process.set(String(change.name).toLocaleLowerCase(), existing.id); results[index] = { id: existing.id, reused: true }; continue; }
          }
          if (change.action === "create_item") {
            payload.processId = idOf("process", change.processId ?? change.process);
          }
          if (change.action === "create_item" || change.action === "create_goal") {
            payload.idempotencyKey = `proposal:${proposalId}:${index}`;
            payload.inputLocationIds = (change.inputLocations ?? []).map(folderId);
            if (change.outputLocation) payload.outputLocationId = folderId(change.outputLocation);
            if (change.agents) payload.agentIds = change.agents.map((name) => idOf("agent", name));
          }
          if (change.action === "create_recurring_work") {
            // a planned schedule repeats its planned item, so a stray description must not replace it
            Object.assign(payload, { itemId: idOf("item", change.item), paused: true, description: undefined });
            // planning a schedule again, or re-applying after a failure, updates it instead of adding a copy
            const existing = this.database.prepare(`
              SELECT r.id, r.source_work_item_id AS definition FROM recurring_work r JOIN work_items w ON w.id = ?
              WHERE r.workspace_id = ? AND lower(r.name) = lower(?) AND r.process_id = w.process_id
            `).get(payload.itemId, proposal.workspaceId, String(change.name ?? ""));
            if (existing) {
              results[index] = await this.execute("edit_recurring_work", { ...payload, recurringWorkId: existing.id });
              transaction(this.database, () => {
                this.database.prepare("UPDATE recurring_work SET origin_work_item_id = ? WHERE id = ?")
                  .run(payload.itemId, existing.id);
                this.database.prepare(`
                  UPDATE work_items SET (title, description, owner, agent_assignment_id, agent_ids_json, priority, output_location_id, run_settings_json, updated_at) =
                    (SELECT title, description, owner, agent_assignment_id, agent_ids_json, priority, output_location_id, run_settings_json, ? FROM work_items WHERE id = ?)
                  WHERE id = ?
                `).run(at, payload.itemId, existing.definition);
                this.database.prepare("DELETE FROM work_item_locations WHERE work_item_id = ?").run(existing.definition);
                this.database.prepare("INSERT INTO work_item_locations SELECT ?, location_id, relative_path FROM work_item_locations WHERE work_item_id = ?")
                  .run(existing.definition, payload.itemId);
              });
              continue;
            }
          }
          if (change.action === "set_stage_route") {
            payload.stageId = this.database.prepare(`
              SELECT id FROM stages WHERE process_id = ? AND lower(name) = lower(?) AND archived_at IS NULL
            `).get(idOf("process", change.processId ?? change.process), String(change.stage ?? ""))?.id;
            if (!payload.stageId) throw new Error(`The proposed stage "${change.stage}" is not in that process`);
            payload.agentIds = (change.agents ?? []).map((name, index) => idOf("agent", change.agentIds?.[index] ?? name));
          }
          const result = CAPABILITY_CHANGES.includes(change.action)
            ? await this.capabilities.command(payload) : await this.execute(change.action, payload);
          results[index] = result;
          const kind = { create_process: "process", add_agent_assignment: "agent", create_item: "item", create_goal: "item" }[change.action];
          if (kind) made[kind].set(String(change.name ?? change.title).toLocaleLowerCase(), result.id);
        }
      } catch (error) {
        // The proposal goes back to pending so it can be applied again, which means its secrets
        // have to stay for the changes that have not run yet. The ones that did run already put
        // their secrets in the credential store, so a second plaintext copy here is pure exposure.
        const remaining = list.map((change, index) =>
          results[index] === undefined ? change : { ...change, secrets: undefined });
        this.database.prepare("UPDATE bees_proposals SET status = 'pending', changes_json = ?, updated_at = ? WHERE id = ?")
          .run(JSON.stringify(remaining), at, proposalId);
        throw error;
      }
      this.database.prepare("UPDATE bees_proposals SET changes_json = ? WHERE id = ?")
        .run(JSON.stringify(withoutSecrets(list)), proposalId);
      return { id: proposalId, results };
    }
    if (action === "reject_proposal") {
      const proposal = this.database.prepare("SELECT workspace_id AS workspaceId, changes_json AS changes FROM bees_proposals WHERE id = ? AND status = 'pending'")
        .get(required(input.proposalId, "Proposal"));
      if (!proposal) throw new Error("Proposal is no longer pending");
      workspaceContext(this.database, proposal.workspaceId, ["admin", "member"]);
      this.database.prepare("UPDATE bees_proposals SET status = 'rejected', changes_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(withoutSecrets(JSON.parse(proposal.changes))), at, input.proposalId);
      return {};
    }
    if (action === "list_items") {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      return this.database.prepare(`
        SELECT w.id, w.title, p.name AS process, s.name AS stage, w.runtime_phase AS phase, w.updated_at AS updatedAt
        FROM work_items w JOIN processes p ON p.id = w.process_id JOIN stages s ON s.id = w.stage_id
        WHERE p.workspace_id = ? AND w.archived_at IS NULL AND w.deleted_at IS NULL
        ORDER BY w.updated_at DESC LIMIT 200
      `).all(workspace.id);
    }
    if (action === "list_agents") {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      return this.database.prepare("SELECT id, name, description FROM agent_assignments WHERE workspace_id = ? AND archived_at IS NULL ORDER BY name")
        .all(workspace.id);
    }
    if (action === "list_processes") {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      return this.database.prepare(`
        SELECT p.id, p.name, (SELECT name FROM team_locations WHERE id = p.output_location_id) AS outputFolder,
          (SELECT json_group_array(json_object('name', s.name, 'driver', s.driver, 'agents', (
            SELECT json_group_array(a.name) FROM stage_routes r, json_each(r.agent_ids_json) j
            JOIN agent_assignments a ON a.id = j.value WHERE r.stage_id = s.id)))
            FROM (SELECT * FROM stages WHERE process_id = p.id AND archived_at IS NULL ORDER BY position) s) AS stages,
          (SELECT json_group_array(json_object('id', r.id, 'name', r.name, 'status', r.status, 'workItemId', r.origin_work_item_id,
            'schedule', json(r.schedule_json), 'timezone', r.timezone, 'nextRunAt', r.next_run_at))
            FROM recurring_work r WHERE r.process_id = p.id) AS schedules
        FROM processes p WHERE p.workspace_id = ? AND p.archived_at IS NULL ORDER BY p.updated_at DESC
      `).all(workspace.id).map((row) => ({ ...row, stages: JSON.parse(row.stages), schedules: JSON.parse(row.schedules) }));
    }
    if (action === "ask_bees") {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      const executionId = randomUUID();
      const reasoningEffort = optionalReasoningEffort(input.reasoningEffort);
      const runDirectory = resolve(workspaceRoot(workspace.id), "runs", executionId);
      const policy = checkMcpServers(this.database, mcpPolicy(input));
      const resolved = resolveReferences(this.database, workspace.id, required(input.outcome, "Outcome"));
      const outcome = resolved.text;
      const manifest = inputManifest(stageInputLocations(referenceInputs(this.database, workspace.id, resolved.references), runDirectory));
      // A newer plan supersedes one still parked. Left alive it came back on every launch and asked
      // again for an answer the person had already moved on from.
      for (const { execution_id: parked } of this.database.prepare(`
        SELECT execution_id FROM execution_links
        WHERE workspace_id = ? AND COALESCE(work_item_id, '') = ''
          AND status IN ('waiting_for_input', 'waiting_for_approval')
      `).all(workspace.id)) {
        if (!this.agents.abort(parked)) this.agents.setStatus(parked, "cancelled");
      }
      const queued = await this.agents.dispatch("bees-run", executionId, {
        idempotencyKey: `start:${executionId}`, workspace: runDirectory,
        body: await this.planningBrief(workspace.id, outcome) + (manifest ? `\n\n${manifest}` : ""),
        initialData: {
          version: 1, mode: "planning", executionId, workItemId: null, agentId: "bees-plan",
          agentName: "Ask Bees", purpose: outcome, model: optionalModelRoute(input.model),
          reasoningEffort,
          capabilities: [],
          // Build with Bees on Process Templates asks for the process itself, and the person starts its runs
          instructions: input.process
            ? "The person is building a reusable process from the Process Templates page. Propose create_process for it even for a single outcome: the exact name of a listed process built for this job, never Goals, or a new one with a description every run's agents can work from, its stages and routes. Add only the agents, servers and skills it is missing. They start its runs once the plan is applied, so add a work item only when a schedule needs one."
            : "Reuse the team's existing resources and default to Goals. Propose only missing setup and the requested work, with a new process only for an explicit reusable workflow request. Put the work item before its schedule.",
          workspaceId: workspace.id, agentPresetId: input.agentPresetId || this.agents.ctx.agentPresets.defaultId,
          mcpAccess: policy.access, mcpServers: policy.servers,
          grants: []
        }
      });
      return { executionId, sessionId: queued.sessionId, status: queued.status };
    }
    if (action === "open_agent_browser") {
      const executionId = required(input.executionId, "Execution");
      runContext(this.database, executionId);
      // When the agent supplies a URL (e.g. a login page), navigate Chrome there directly so the
      // user sees the actual page rather than the initial about:blank tab.
      const url = typeof input.url === "string" && input.url.startsWith("https://") ? input.url : null;
      await (url ? navigateAgentBrowser(url) : showAgentBrowser());
      return { opened: true };
    }

    if (action === "open_in_explorer") {
      const targetPath = required(input.path, "Path");
      if (!targetPath.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(targetPath))
        throw new Error("Only absolute paths can be opened");
      if (!existsSync(targetPath))
        throw new Error("The path does not exist on this device");
      const { execFile } = await import("node:child_process");
      const open = (command, args) => new Promise((done, fail) =>
        execFile(command, args, (error) => error ? fail(new Error(`Could not open ${targetPath}`)) : done()));
      // explorer exits 1 even when it opens the path, so its exit code means nothing
      if (process.platform === "win32") execFile("explorer", [targetPath]);
      // no app claims .md on a fresh mac, so fall back to the text editor
      else if (process.platform === "darwin") await open("open", [targetPath]).catch(() => open("open", ["-t", targetPath]));
      else await open("xdg-open", [targetPath]);
      return { opened: true };
    }
    if (action === "stop_run") {
      const executionId = required(input.executionId, "Execution");
      const { status } = runContext(this.database, executionId);
      const stopped = this.agents.abort(executionId);
      // a queued or parked run has nothing live to abort; dropping its queue row stops a start in flight
      if (!stopped && ["queued", "waiting_for_input", "waiting_for_approval"].includes(status)) {
        this.database.prepare("DELETE FROM bees_run_queue WHERE execution_id = ?").run(executionId);
        this.agents.setStatus(executionId, "cancelled");
      }
      // Nothing is waiting on a sign-in any more, so the window it raised has no reason to stay up.
      this.agents.track(hideAgentBrowser());
      return { stopped };
    }
    if (action === "provide_run_input") {
      const executionId = required(input.executionId, "Execution");
      const { data, item, status } = runContext(this.database, executionId);
      if (!["waiting_for_input", "waiting_for_approval"].includes(status))
        throw new Error("This run is no longer waiting for input");
      const workspace = workspaceContext(this.database, data.workspaceId, ["admin", "member"]);
      const location = mappedLocation(this.database, required(input.locationId, "Location"));
      if (!location || location.teamId !== workspace.teamId) throw new Error("Location is unavailable to this team");
      const run = this.agents.run(executionId);
      if (!run?.runDirectory) throw new Error("This run is unavailable on this device");
      const staged = stageInputLocations([location], run.runDirectory, true);
      if (item) await this.execute("attach_location", { itemId: item.id, locationId: location.id });
      return { manifest: inputManifest(staged) };
    }
    if (action === "continue_run") {
      const executionId = required(input.executionId, "Execution");
      const text = required(input.text, "Text");
      const { uid, item, runtimePhase } = runContext(this.database, executionId);
      const result = item && runtimePhase === "failed" ? await this.processes.signal(item.id, "retry", text)
        : await this.agents.admit("bees-run", executionId, {
          idempotencyKey: `continue:${executionId}:${Date.now()}`,
          uid, ownerChecked: true,
          body: text
        });
      this.workContext.recordOwner(executionId, text);
      return result;
    }
    if (action === "publish_run") {
      const executionId = required(input.executionId, "Execution");
      const { uid, data } = runContext(this.database, executionId);
      const locationId = required(input.locationId, "Location");
      const granted = data.workItemId ? outputLocation(this.database, data.workItemId) === locationId
        : data.grants.includes(locationId);
      if (!granted)
        throw new Error("That location was not granted to this run");
      return this.agents.admit("bees-run", executionId, {
        idempotencyKey: `publish:${executionId}:${locationId}:${randomUUID()}`, uid,
        body: `Publish the finished files under outputs/ to the granted location ${locationId}. Use bees_publish_outputs and do not modify the deliverables.`
      });
    }
    throw new Error(`Unknown action: ${action}`);
}
