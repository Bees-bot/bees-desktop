import { catalogEntry } from "./mcp-catalog.js";
import { randomUUID } from "node:crypto";
import { showAgentBrowser } from "./agent-browser.js";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  agentCapabilities, agentIds as normalizeAgentIds, assignment, capabilities, currentIdentity, DEFAULT_WORKSPACE_NAME, insertDefaultWorkspace, insertProcess, iso,
  itemContext, mcpGrantFor, normalizeRunSettings, optionalModelRoute, optionalReasoningEffort,
  parentFor, processContext, processStages,
  message, requireTeam, required, stableUuid, transaction, workspaceContext
} from "./product-database.js";
import {
  canonicalMapping, inputManifest, logicalRelativePath, mappedLocation, outputLocation, stageInputs
} from "./product-files.js";
import { resolveStageAgent } from "./product-routing.js";

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

function mcpPolicy(input, current = { access: "all", servers: [] }) {
  if (!Object.hasOwn(input, "mcpAccess")) return current;
  const access = String(input.mcpAccess ?? "all");
  if (!["all", "none", "listed"].includes(access)) throw new Error("Choose all, none, or listed MCP servers");
  const servers = access === "listed"
    ? [...new Set((Array.isArray(input.mcpServers) ? input.mcpServers : []).map(String).filter(Boolean))]
    : [];
  if (access === "listed" && !servers.length) throw new Error("Choose at least one MCP server, or pick none");
  return { access, servers };
}

/** A server id that resolves to nothing would silently grant the agent nothing at all. */
function checkMcpServers(database, policy) {
  if (policy.access !== "listed") return policy;
  const known = database.prepare(`
    SELECT id FROM mcp_servers WHERE enabled = 1 AND id IN (SELECT value FROM json_each(?))
  `).all(JSON.stringify(policy.servers)).map(({ id }) => id);
  const missing = policy.servers.filter((id) => !known.includes(id));
  if (missing.length) throw new Error(`No MCP server matches ${missing.join(", ")}`);
  return policy;
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

const referenceSlug = (value) => String(value).normalize("NFKD").toLocaleLowerCase()
  .replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/g, "");
const referenceLabel = (value) => String(value).replace(/[\]\r\n]/g, " ").trim().slice(0, 160);

/** Leading $agents are an ordered roster; the stored form keeps their stable assignment ids. */
function invokedAgents(database, workspaceId, value) {
  let rest = String(value ?? "");
  const agents = [];
  while (agents.length < 9) {
    const canonical = rest.match(/^\s*[$@]\[([^\]\n]{1,160})\]\(bees:agent:([^)\s]{1,256})\)(?:\s*[,;:\-]\s*|\s+|$)/u);
    let agent;
    let consumed;
    if (canonical) {
      agent = assignment(database, canonical[2], workspaceId);
      if (!agent?.enabled) throw new Error(`The referenced agent ${canonical[1]} is unavailable in this team`);
      consumed = canonical[0];
    } else {
      const typed = rest.match(/^\s*\$(agent|human|organization|org|team|workspace|process|template|work|location):([\p{Letter}\p{Number}_-]{1,80})(?:\s*[,;:\-]\s*|\s+|$)/iu);
      if (typed && typed[1].toLocaleLowerCase() !== "agent") break;
      const shorthand = typed
        ? [typed[0], typed[2]]
        : rest.match(/^\s*\$([\p{Letter}][\p{Letter}\p{Number}_-]{0,79})(?=\s|[,;:.!?-]|$)(?:\s*[,;:\-]\s*|\s+|$)/u);
      if (!shorthand) break;
      const matches = database.prepare(`
        SELECT id, workspace_id AS workspaceId, preset_id AS presetId, name, description,
               instructions, model, reasoning_effort AS reasoningEffort, system_role AS systemRole,
               capabilities_json AS capabilities, enabled, max_concurrency AS maxConcurrency,
               updated_at AS updatedAt, mcp_access AS mcpAccess, mcp_servers_json AS mcpServers
        FROM agent_assignments WHERE workspace_id = ? AND enabled = 1
      `).all(workspaceId).filter(({ name }) => referenceSlug(name) === referenceSlug(shorthand[1]));
      if (!matches.length) throw new Error(`No agent matches $${shorthand[1]} in this team`);
      if (matches.length > 1) throw new Error(`More than one agent matches $${shorthand[1]}; use the full agent reference`);
      agent = matches[0];
      consumed = shorthand[0];
    }
    if (agents.some(({ id }) => id === agent.id)) throw new Error(`${agent.name} is mentioned more than once`);
    agents.push(agent);
    rest = rest.slice(consumed.length);
  }
  if (!agents.length) return null;
  if (agents.length > 8) throw new Error("Mention at most eight agents");
  const request = rest.trim();
  if (!request) throw new Error(`Tell ${agents.map(({ name }) => name).join(", ")} what you want done`);
  return {
    agents, request,
    reference: agents.map((agent) => `$[${referenceLabel(agent.name)}](bees:agent:${agent.id})`).join(" ")
  };
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
    : database.prepare(`
        SELECT c.account_user_id AS accountUserId FROM bees_connections c
        JOIN bees_connection_teams ct ON ct.connection_id = c.id
        WHERE c.account_user_id = ? AND ct.team_id = ?
      `).get(input.accountUserId ?? "", teamId);
  if (!row) throw new Error("Choose an account that can access this team");
  return row.accountUserId;
}

/** A run is only reachable through the work item or workspace that owns it. */
function runContext(database, executionId, roles = ["admin", "member"]) {
  const run = database.prepare(`
    SELECT work_item_id AS workItemId, instance_uid AS uid, config_json AS configJson
    FROM execution_links WHERE execution_id = ?
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
  catch { throw new Error("Timezone must be a valid IANA timezone such as America/Los_Angeles"); }
  return timezone;
}

function recurringSchedule(input) {
  const frequency = String(input.frequency ?? "daily");
  if (frequency === "hourly") {
    const everyMinutes = Number(input.everyMinutes ?? 60);
    if (!Number.isInteger(everyMinutes) || everyMinutes < 1 || everyMinutes > 525_600)
      throw new Error("Interval must be between 1 minute and 1 year");
    const anchorUtc = new Date(input.anchorUtc || Date.now()).toISOString();
    return { kind: "interval", timezone: null, value: { everyMinutes, anchorUtc } };
  }
  const timezone = timezoneOf(input.timezone || "UTC");
  if (frequency === "advanced") {
    const expression = required(input.cronExpression, "Cron expression");
    const fields = expression.split(/\s+/);
    if (fields.length < 5 || fields.length > 7)
      throw new Error("Advanced schedules need a 5, 6, or 7 field cron expression");
    return { kind: "cron", timezone, value: { expression } };
  }
  if (!["daily", "weekly", "monthly"].includes(frequency)) throw new Error("Schedule frequency is invalid");
  const hour = Number(input.hour);
  const minute = Number(input.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 ||
      !Number.isInteger(minute) || minute < 0 || minute > 59)
    throw new Error("Schedule time is invalid");
  const value = { frequency, hour, minute };
  if (frequency === "weekly") {
    const dayOfWeek = String(input.dayOfWeek ?? "MONDAY").toUpperCase();
    if (!new Set(["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]).has(dayOfWeek))
      throw new Error("Schedule weekday is invalid");
    value.dayOfWeek = dayOfWeek;
  }
  if (frequency === "monthly") {
    const dayOfMonth = Number(input.dayOfMonth ?? 1);
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
  const text = String(playbook ?? "").trim().slice(0, 6_000);
  const at = iso();
  database.prepare(`
    UPDATE agent_specializations SET playbook = ?, revision = ?, updated_at = ? WHERE id = ?
  `).run(text, next, at, specialization.id);
  database.prepare(`
    INSERT INTO agent_specialization_versions
      (id, specialization_id, revision, playbook, source, feedback, execution_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), specialization.id, next, text, source,
    feedback ? String(feedback).slice(0, 2_000) : null, executionId, at);
  return { id: specialization.id, name: specialization.name, revision: next, playbook: text };
}

function producerSpecialization(database, executionId, itemId) {
  const current = database.prepare(`
    SELECT d.specialization_id AS specializationId, d.created_at AS createdAt,
           json_extract(e.config_json, '$.stagePurpose') AS purpose
    FROM agent_dispatches d JOIN execution_links e ON e.execution_id = d.execution_id
    WHERE d.execution_id = ? AND d.work_item_id = ?
  `).get(executionId, itemId);
  if (!current) throw new Error("This run has no agent assignment");
  if (current.purpose !== "reviewer") return current.specializationId;
  return database.prepare(`
    SELECT d.specialization_id AS specializationId
    FROM agent_dispatches d JOIN execution_links e ON e.execution_id = d.execution_id
    WHERE d.work_item_id = ? AND d.created_at <= ?
      AND json_extract(e.config_json, '$.stagePurpose') = 'worker'
    ORDER BY d.created_at DESC LIMIT 1
  `).get(itemId, current.createdAt)?.specializationId;
}

function learnedPlaybook(current, feedback) {
  const guidance = required(feedback, "Rejection reason").replace(/\s+/g, " ").slice(0, 800);
  if (guidance.length < 3) throw new Error("Add a specific rejection reason");
  const bullet = `- ${guidance.replace(/^[-•]\s*/, "")}`;
  const lines = String(current ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.some((line) => line.toLocaleLowerCase() === bullet.toLocaleLowerCase())) lines.push(bullet);
  return lines.slice(-12).join("\n").slice(0, 6_000);
}

export async function executeProductCommand(action, input) {
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
    if (action === "create_team") {
      const { userId } = currentIdentity(this.database);
      const organizationId = required(input.organizationId, "Organization");
      if (!this.database.prepare(`
        SELECT 1 FROM organization_memberships WHERE user_id = ? AND organization_id = ? AND status = 'active'
      `).get(userId, organizationId)) throw new Error("You are not a member of this organization");
      const name = required(input.name, "Team name");
      const id = randomUUID();
      const workspaceId = randomUUID();
      const path = resolve(this.defaultWorkspace, "workspaces", workspaceId);
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
      const workspace = workspaceContext(this.database, process.workspaceId, ["admin", "member"]);
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
      const invocationText = String(input.description ?? "").trim() ? input.description : input.title;
      const invocation = invokedAgents(this.database, process.workspaceId, invocationText);
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
      const settings = normalizeRunSettings(parent?.runSettings ?? input.runSettings ?? {});
      if (settings.mcpAccess) checkMcpServers(this.database, { access: settings.mcpAccess, servers: settings.mcpServers });
      const kind = action === "create_goal" ? "goal" : action === "create_run" ? "run" : "work";
      const rawTitle = required(input.title, "Title");
      const titleInvocation = invocation && /^\s*[$@]/u.test(rawTitle)
        ? invokedAgents(this.database, process.workspaceId, rawTitle)
        : null;
      const title = titleInvocation?.request.split("\n")[0].trim() || rawTitle;
      const description = invocation ? `${invocation.reference} ${invocation.request}` : String(input.description ?? "");
      this.database.prepare(`
        INSERT INTO work_items (id, process_id, stage_id, parent_id, kind, title, description, owner,
          agent_assignment_id, agent_ids_json, priority, output_location_id, recurring_work_id, account_user_id,
          archived_at, deleted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      `).run(id, processId, stageId, parentId, kind, required(title, "Title"), description,
        input.owner ? String(input.owner) : null, assignmentId, JSON.stringify(selectedAgentIds), priorityOf(input.priority), outputLocationId,
        recurringWorkId, accountUserId, at, at);
      replaceLocations(this.database, "work_item_locations", "work_item_id", id, inputLocationIds);
      this.database.prepare("UPDATE work_items SET run_settings_json = ? WHERE id = ?")
        .run(JSON.stringify(settings), id);
      if (parent) {
        // Inherit before startItem: the first delegated run must see the same context and limits.
        this.database.prepare(`INSERT OR IGNORE INTO work_item_locations
          SELECT ?, location_id, relative_path FROM work_item_locations WHERE work_item_id = ?`).run(id, parent.id);
        this.database.prepare("UPDATE work_items SET output_location_id = coalesce(output_location_id, ?) WHERE id = ?")
          .run(parent.outputLocationId, id);
      }
      return { id };
      });
      // The row is already committed; throwing here would have the caller retry and create a second item.
      return { ...created, ...await this.processes.startItem(created.id).catch((error) => ({ error: message(error) })) };
    }
    if (action === "edit_item") return transaction(this.database, () => {
      const item = itemContext(this.database, input.itemId, ["admin", "member"]);
      const parentId = parentFor(this.database, item.id, item.processId, input.parentId);
      const rawTitle = required(input.title, "Title");
      const rawDescription = String(input.description ?? "");
      const invocationText = rawDescription.trim() ? rawDescription : rawTitle;
      const invocation = invokedAgents(this.database, item.workspaceId, invocationText);
      const explicitIds = Array.isArray(input.agentIds) ? normalizeAgentIds(input.agentIds)
        : input.agentAssignmentId ? [required(input.agentAssignmentId, "Agent")] : [];
      const selectedAgentIds = invocation?.agents.map(({ id }) => id) ?? explicitIds;
      for (const agentId of selectedAgentIds) if (!assignment(this.database, agentId, item.workspaceId))
        throw new Error("Agent assignment is not in this team");
      const titleInvocation = invocation && /^\s*[$@]/u.test(rawTitle)
        ? invokedAgents(this.database, item.workspaceId, rawTitle) : null;
      const title = titleInvocation?.request.split("\n")[0].trim() || rawTitle;
      const description = invocation ? `${invocation.reference} ${invocation.request}` : rawDescription;
      this.database.prepare(`
        UPDATE work_items SET title = ?, description = ?, owner = ?, agent_assignment_id = ?, agent_ids_json = ?,
          priority = ?, parent_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL
      `).run(title, description, input.owner ? String(input.owner) : null,
        selectedAgentIds[0] ?? null, JSON.stringify(selectedAgentIds), priorityOf(input.priority), parentId, at, item.id);
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
    if (action === "create_recurring_work") {
      const item = itemContext(this.database, input.itemId, ["admin", "member"]);
      if (item.parentId) throw new Error("Delegated child work cannot be scheduled; schedule its primary work item instead");
      if (!this.processes.isAutomatic(item.processId))
        throw new Error("Recurring work requires an automatic process");
      const name = required(input.name, "Recurring work name").slice(0, 120);
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
            (id, workspace_id, process_id, source_work_item_id, name, schedule_kind,
             schedule_json, timezone, temporal_schedule_id, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        `).run(id, item.workspaceId, item.processId, sourceWorkItemId, name, schedule.kind,
          JSON.stringify(schedule.value), schedule.timezone, temporalScheduleId, at, at);
        this.database.prepare(`
          INSERT INTO work_items
            (id, process_id, stage_id, parent_id, kind, title, description, owner,
             agent_assignment_id, agent_ids_json, priority, output_location_id, recurring_work_id,
             archived_at, deleted_at, created_at, updated_at)
          VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
        `).run(sourceWorkItemId, item.processId, stageId, item.kind === "goal" ? "goal" : "work",
          item.title, item.description, item.owner, item.agentAssignmentId, JSON.stringify(item.agentIds), item.priority,
          item.outputLocationId, id, at, at);
        this.database.prepare(`
          INSERT INTO work_item_locations
          SELECT ?, location_id, relative_path FROM work_item_locations WHERE work_item_id = ?
        `).run(sourceWorkItemId, item.id);
        this.database.prepare("UPDATE work_items SET run_settings_json = ? WHERE id = ?")
          .run(JSON.stringify(item.runSettings), sourceWorkItemId);
      });
      try {
        const runtime = await this.processes.createRecurring(id);
        return { id, sourceWorkItemId, ...runtime };
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
      const name = required(input.name, "Recurring work name").slice(0, 120);
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
    if (action === "apply_specialist_feedback") return transaction(this.database, () => {
      const executionId = required(input.executionId, "Execution");
      const { item } = runContext(this.database, executionId);
      if (!item?.recurringWorkId) throw new Error("Future-run feedback is only available for scheduled runs");
      const specializationId = producerSpecialization(this.database, executionId, item.id);
      if (!specializationId) throw new Error("The producing specialist could not be identified");
      const specialization = specializationContext(this.database, specializationId);
      if (specialization.recurringWorkId !== item.recurringWorkId)
        throw new Error("The specialist does not belong to this recurring work");
      const result = savePlaybook(this.database, specialization,
        learnedPlaybook(specialization.playbook, input.feedback), "feedback", input.feedback, executionId);
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
    if (["pause_item", "resume_item", "retry_item", "cancel_item"].includes(action)) {
      const item = itemContext(this.database, input.itemId, ["admin", "member"]);
      return this.processes.signal(item.id, action.replace("_item", ""));
    }
    if (action === "create_process") return transaction(this.database, () => {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      // Home starts a process straight from a template card, so it sends the template instead of stages.
      const template = input.templateId ? this.database.prepare(`
        SELECT workspace_id AS workspaceId, description, stages_json AS stages
        FROM process_templates WHERE id = ? AND archived_at IS NULL
      `).get(input.templateId) : null;
      if (input.templateId && !template) throw new Error("Process template not found");
      if (template && template.workspaceId !== workspace.id)
        throw new Error("That process template belongs to another team");
      const stages = processStages(template ? JSON.parse(template.stages) : input.stages);
      const inputLocationIds = locationIds(this.database, workspace.id, input.inputLocationIds);
      const outputLocationId = locationIds(this.database, workspace.id,
        input.outputLocationId ? [input.outputLocationId] : [], true)[0] ?? null;
      const id = insertProcess(this.database, workspace.id, input.name,
        input.description ?? template?.description, stages);
      this.database.prepare("UPDATE processes SET output_location_id = ? WHERE id = ?").run(outputLocationId, id);
      replaceLocations(this.database, "process_locations", "process_id", id, inputLocationIds);
      return { id };
    });
    if (action === "create_process_template") return transaction(this.database, () => {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      const id = randomUUID();
      const stages = processStages(input.stages, "process template");
      this.database.prepare(`
        INSERT INTO process_templates VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(id, workspace.id, required(input.name, "Template name"), String(input.description ?? ""),
        JSON.stringify(stages), at, at);
      return { id };
    });
    if (action === "copy_process") return transaction(this.database, () => {
      const processId = required(input.processId, "Process");
      const process = processContext(this.database, processId, ["admin", "member"]);
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
      this.database.prepare(`INSERT INTO processes (id, workspace_id, kind, name, description, output_location_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(newProcessId, workspaceId, process.kind, name, process.description, process.outputLocationId, at, at);
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
              (stage_id, agent_assignment_id, agent_pool_id, required_capabilities_json,
               created_at, updated_at, agent_ids_json)
            VALUES (?, ?, NULL, ?, ?, ?, ?)
          `).run(newStageId, mappedAgentIds[0] ?? null, route.required_capabilities_json,
            at, at, JSON.stringify(mappedAgentIds));
        }
      }

      return { id: newProcessId };
    });
    if (action === "save_process_template") return transaction(this.database, () => {
      const process = processContext(this.database, input.processId, ["admin", "member"]);
      const source = this.database.prepare("SELECT name, description FROM processes WHERE id = ?").get(process.id);
      const stages = this.database.prepare(`
        SELECT name, driver, requires_human_approval AS requiresHumanApproval
        FROM stages WHERE process_id = ? AND archived_at IS NULL ORDER BY position
      `).all(process.id).map((stage) => ({ ...stage, requiresHumanApproval: Boolean(stage.requiresHumanApproval) }));
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
      processContext(this.database, processId, ["admin", "member"]);
      if (this.processes.isAutomatic(processId) && this.database.prepare(`
        SELECT 1 FROM work_items WHERE process_id = ? AND deleted_at IS NULL
          AND runtime_phase NOT IN ('completed', 'cancelled') LIMIT 1
      `).get(processId)) throw new Error("Finish or cancel active automatic work before editing this process");
      const names = processStages(input.stages);
      const existing = this.database.prepare(`
        SELECT id, name FROM stages WHERE process_id = ? AND archived_at IS NULL ORDER BY position
      `).all(processId);
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
        if (assigned[position]) this.database.prepare(`
          UPDATE stages SET name = ?, position = ?, driver = ?, requires_human_approval = ?, is_terminal = ? WHERE id = ?
        `).run(name, position, driver, requiresHumanApproval ? 1 : 0,
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
    if (action === "set_stage_route") return transaction(this.database, () => {
      const stageId = required(input.stageId, "Stage");
      const stage = this.database.prepare(`
        SELECT s.id, s.process_id AS processId, s.driver, p.workspace_id AS workspaceId
        FROM stages s JOIN processes p ON p.id = s.process_id
        WHERE s.id = ? AND s.archived_at IS NULL
      `).get(stageId);
      if (!stage) throw new Error("Stage not found");
      workspaceContext(this.database, stage.workspaceId, ["admin", "member"]);
      if (["manual", "terminal"].includes(stage.driver)) throw new Error("This stage does not run an agent");
      const requiredCapabilities = capabilities(input.requiredCapabilities, "Stage capabilities");
      if (input.targetType === "pool") throw new Error("Agent pools are no longer supported; assign agents directly");
      const ids = normalizeAgentIds(Array.isArray(input.agentIds) ? input.agentIds
        : input.targetType === "agent" && input.targetId ? [input.targetId] : []);
      if (stage.driver === "review" && ids.length > 1) throw new Error("A review stage must use one independent agent");
      for (const id of ids) if (!assignment(this.database, id, stage.workspaceId))
        throw new Error("Agent is not in this team");
      if (!ids.length && !requiredCapabilities.length) {
        this.database.prepare("DELETE FROM stage_routes WHERE stage_id = ?").run(stage.id);
        this.database.prepare("UPDATE processes SET updated_at = ? WHERE id = ?").run(at, stage.processId);
        return { id: stage.id };
      }
      this.database.prepare(`
        INSERT INTO stage_routes
          (stage_id, agent_assignment_id, agent_pool_id, required_capabilities_json, created_at, updated_at, agent_ids_json)
        VALUES (?, ?, NULL, ?, ?, ?, ?)
        ON CONFLICT(stage_id) DO UPDATE SET agent_assignment_id = excluded.agent_assignment_id,
          agent_pool_id = NULL,
          required_capabilities_json = excluded.required_capabilities_json,
          agent_ids_json = excluded.agent_ids_json,
          updated_at = excluded.updated_at
      `).run(stage.id, ids[0] ?? null, JSON.stringify(requiredCapabilities), at, at, JSON.stringify(ids));
      this.database.prepare("UPDATE processes SET updated_at = ? WHERE id = ?").run(at, stage.processId);
      return { id: stage.id };
    });
    if (action === "add_agent_assignment") {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      const presetId = required(input.presetId, "DSH preset");
      if (this.agentPresets) {
        const presets = await this.agentPresets.list();
        const preset = presets.find(({ id }) => id === presetId);
        if (!preset || preset.broken || await this.presetGap(presetId)) throw new Error("The DSH preset is unavailable");
      }
      const policy = checkMcpServers(this.database, mcpPolicy(input));
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
      const id = required(input.agentAssignmentId, "Agent");
      const assignment = this.database.prepare(`
        SELECT workspace_id AS workspaceId, name, system_role AS systemRole,
               reasoning_effort AS reasoningEffort, capabilities_json AS capabilities,
               enabled, max_concurrency AS maxConcurrency,
               mcp_access AS mcpAccess, mcp_servers_json AS mcpServers
        FROM agent_assignments WHERE id = ?
      `).get(id);
      if (!assignment) throw new Error("Agent not found");
      workspaceContext(this.database, assignment.workspaceId, ["admin", "member"]);
      const presetId = required(input.presetId, "DSH preset");
      if (this.agentPresets) {
        const preset = (await this.agentPresets.list()).find(({ id }) => id === presetId);
        if (!preset || preset.broken || await this.presetGap(presetId)) throw new Error("The DSH preset is unavailable");
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
      const policy = checkMcpServers(this.database, mcpPolicy(input, {
        access: assignment.mcpAccess ?? "all", servers: JSON.parse(assignment.mcpServers || "[]")
      }));
      this.database.prepare(`
        UPDATE agent_assignments SET preset_id = ?, name = ?, description = ?, instructions = ?,
          model = ?, reasoning_effort = ?, capabilities_json = ?, enabled = ?, max_concurrency = ?,
          mcp_access = ?, mcp_servers_json = ?, updated_at = ? WHERE id = ?
      `).run(presetId, assignment.systemRole ? assignment.name : required(input.name, "Agent name"),
        String(input.description ?? ""), String(input.instructions ?? ""), optionalModelRoute(input.model),
        reasoningEffort,
        JSON.stringify(nextCapabilities), enabled ? 1 : 0, maxConcurrency,
        policy.access, JSON.stringify(policy.servers), at, id);
      if (Object.hasOwn(input, "inputLocationIds")) replaceLocations(this.database, "agent_locations",
        "agent_assignment_id", id, locationIds(this.database, assignment.workspaceId, input.inputLocationIds));
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
        this.database.prepare("DELETE FROM work_item_locations WHERE work_item_id = ? AND location_id = ? AND (? IS NULL OR relative_path = ?)")
          .run(item.id, required(input.locationId, "Location"), relativePath, relativePath);
        this.database.prepare("UPDATE work_items SET updated_at = ? WHERE id = ?").run(at, item.id);
      }
      return {};
    });
    if (action === "set_output_location") return transaction(this.database, () => {
      const target = input.processId
        ? { ...processContext(this.database, input.processId, ["admin", "member"]), table: "processes" }
        : { ...itemContext(this.database, input.itemId, ["admin", "member"]), table: "work_items" };
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
      // Claim the row before running anything, so a second click cannot apply the plan twice.
      if (!this.database.prepare("UPDATE bees_proposals SET status = 'applied', updated_at = ? WHERE id = ? AND status = 'pending'")
        .run(at, proposalId).changes) throw new Error("This plan was already applied");
      const results = [];
      // The planner names things it created earlier in the same proposal; ids exist only once applied.
      const made = { process: new Map(), agent: new Map(), item: new Map() };
      const idOf = (kind, name) => {
        const id = made[kind].get(String(name ?? "").toLocaleLowerCase());
        if (!id) throw new Error(`The proposed ${kind} "${name}" was not created earlier in this proposal`);
        return id;
      };
      const folderId = (name) => {
        const row = this.database.prepare(`
          SELECT l.id FROM team_locations l JOIN workspaces w ON w.team_id = l.team_id
          WHERE w.id = ? AND lower(l.name) = lower(?) AND l.archived_at IS NULL
        `).get(proposal.workspaceId, String(name ?? ""));
        if (!row) throw new Error(`No team folder is named "${name}"`);
        return row.id;
      };
      try {
        for (const change of JSON.parse(proposal.changes)) {
          const payload = { ...change, workspaceId: proposal.workspaceId,
            connectionId: input.connectionId, accountUserId: input.accountUserId };
          // Running the same prompt twice proposes the same agent names; reuse rather than refuse.
          if (change.action === "add_agent_assignment") {
            const existing = this.database.prepare(`
              SELECT id FROM agent_assignments WHERE workspace_id = ? AND lower(name) = lower(?)
            `).get(proposal.workspaceId, String(change.name ?? ""));
            if (existing) { made.agent.set(String(change.name).toLocaleLowerCase(), existing.id); results.push({ id: existing.id, reused: true }); continue; }
          }
          // A catalog server that is already installed is reused; only the API bridge is meant to exist many times.
          if (change.action === "install_mcp_server" && !catalogEntry(change.catalogId)?.nameFrom) {
            const installed = this.database.prepare("SELECT id FROM mcp_servers WHERE catalog_id = ?").get(String(change.catalogId ?? ""));
            if (installed) { results.push({ id: installed.id, reused: true }); continue; }
          }
          if (change.action === "create_process") {
            const existing = this.database.prepare(`
              SELECT id FROM processes WHERE workspace_id = ? AND lower(name) = lower(?) AND archived_at IS NULL
            `).get(proposal.workspaceId, String(change.name ?? ""));
            if (existing) { made.process.set(String(change.name).toLocaleLowerCase(), existing.id); results.push({ id: existing.id, reused: true }); continue; }
          }
          if (change.action === "create_item") {
            payload.processId = idOf("process", change.process);
            const existing = this.database.prepare(`
              SELECT id FROM work_items WHERE process_id = ? AND lower(title) = lower(?)
                AND archived_at IS NULL AND deleted_at IS NULL
            `).get(payload.processId, String(change.title ?? ""));
            if (existing) { made.item.set(String(change.title).toLocaleLowerCase(), existing.id); results.push({ id: existing.id, reused: true }); continue; }
          }
          if (change.action === "create_item" || change.action === "create_goal") {
            payload.inputLocationIds = (change.inputLocations ?? []).map(folderId);
            if (change.outputLocation) payload.outputLocationId = folderId(change.outputLocation);
          }
          if (change.action === "create_recurring_work") payload.itemId = idOf("item", change.item);
          if (change.action === "set_stage_route") {
            payload.stageId = this.database.prepare(`
              SELECT id FROM stages WHERE process_id = ? AND lower(name) = lower(?) AND archived_at IS NULL
            `).get(idOf("process", change.process), String(change.stage ?? ""))?.id;
            if (!payload.stageId) throw new Error(`The proposed stage "${change.stage}" is not in that process`);
            payload.agentIds = (change.agents ?? []).map((name) => idOf("agent", name));
          }
          const result = CAPABILITY_CHANGES.includes(change.action)
            ? await this.capabilities.command(payload) : await this.execute(change.action, payload);
          results.push(result);
          const kind = { create_process: "process", add_agent_assignment: "agent", create_item: "item", create_goal: "item" }[change.action];
          if (kind) made[kind].set(String(change.name ?? change.title).toLocaleLowerCase(), result.id);
        }
      } catch (error) {
        this.database.prepare("UPDATE bees_proposals SET status = 'pending', updated_at = ? WHERE id = ?").run(iso(), proposalId);
        throw error;
      }
      this.database.prepare("UPDATE bees_proposals SET changes_json = ? WHERE id = ?")
        .run(JSON.stringify(withoutSecrets(JSON.parse(proposal.changes))), proposalId);
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
    if (action === "ask_bees") {
      const workspace = workspaceContext(this.database, input.workspaceId, ["admin", "member"]);
      const executionId = randomUUID();
      const reasoningEffort = optionalReasoningEffort(input.reasoningEffort);
      const runDirectory = resolve(this.defaultWorkspace, "runs", executionId);
      const policy = mcpPolicy(input);
      const queued = await this.agents.dispatch("bees-run", executionId, {
        idempotencyKey: `start:${executionId}`, workspace: runDirectory,
        body: `Plan this outcome for the current Bees team. Propose reviewable changes with bees_propose_changes; do not apply them yourself.\n\nOutcome: ${required(input.outcome, "Outcome")}`,
        initialData: {
          version: 1, mode: "planning", executionId, workItemId: null, agentId: "bees-plan",
          agentName: "Ask Bees", purpose: String(input.outcome), model: optionalModelRoute(input.model),
          reasoningEffort,
          capabilities: [],
          instructions: "Propose the agents, process, servers, schedule and first work item this outcome needs.",
          workspaceId: workspace.id, agentPresetId: input.agentPresetId || this.agents.ctx.agentPresets.defaultId,
          mcpAccess: policy.access, mcpServers: policy.servers,
          grants: []
        }
      });
      return { executionId, sessionId: queued.sessionId, status: queued.status };
    }
    if (action === "run_item") {
      const item = itemContext(this.database, input.itemId, ["admin", "member"]);
      if (this.processes.isAutomatic(item.processId))
        throw new Error("Temporal runs this process automatically");
      const executionId = randomUUID();
      if (this.database.prepare("SELECT 1 FROM execution_links WHERE execution_id = ?").get(executionId))
        return { executionId };
      const stage = this.database.prepare(`SELECT driver FROM stages WHERE id = ? AND process_id = ?`)
        .get(item.stageId, item.processId);
      const stagePurpose = stage?.driver === "review" ? "reviewer" : "worker";
      const reasoningEffort = optionalReasoningEffort(input.reasoningEffort);
      const assignment = resolveStageAgent(this.database, {
        executionId, item, stageId: item.stageId, purpose: stagePurpose,
        // Without this the reviewer could be the same agent that produced the work.
        candidateExecutionId: stagePurpose === "reviewer" ? this.database.prepare(`
          SELECT execution_id AS executionId FROM agent_dispatches
          WHERE work_item_id = ? ORDER BY created_at DESC LIMIT 1
        `).get(item.id)?.executionId : null
      });
      const runDirectory = resolve(this.defaultWorkspace, "runs", executionId);
      const manifest = inputManifest(stageInputs(this.database, item.id, runDirectory, assignment.id));
      const grants = [outputLocation(this.database, item.id)].filter(Boolean);
      const queued = await this.agents.dispatch("bees-run", executionId, {
        idempotencyKey: `start:${executionId}`, workspace: runDirectory,
        body: `Complete this work item.\n\nTitle: ${item.title}\n\n${item.description}${manifest ? `\n\n${manifest}` : ""}`,
        initialData: {
          version: 1, mode: "work", executionId, workItemId: item.id,
          agentId: assignment.id, agentName: assignment.name,
          purpose: item.title, model: input.model || assignment?.model || null,
          reasoningEffort: reasoningEffort || assignment?.reasoningEffort || null,
          instructions: assignment?.instructions || "",
          capabilities: agentCapabilities(assignment),
          workspaceId: item.workspaceId, agentPresetId: assignment?.presetId || this.agents.ctx.agentPresets.defaultId,
          ...mcpGrantFor(this.database, assignment?.id, item.runSettings),
          grants
        }
      });
      return { executionId, status: queued.status };
    }
    if (action === "open_agent_browser") {
      const executionId = required(input.executionId, "Execution");
      runContext(this.database, executionId);
      await showAgentBrowser();
      return { opened: true };
    }
    if (action === "stop_run") {
      const executionId = required(input.executionId, "Execution");
      runContext(this.database, executionId);
      return { stopped: this.agents.abort(executionId) };
    }
    if (action === "recover_run") {
      const executionId = required(input.executionId, "Execution");
      const { data, item } = runContext(this.database, executionId);
      return this.agents.admit("bees-run", executionId, {
        idempotencyKey: `recover:${executionId}:${Date.now()}`,
        body: item
          ? `Resume this work item from the last safe checkpoint.\n\nTitle: ${item.title}\n\n${item.description}`
          : `Resume this ${data.mode === "planning" ? "Bees planning run" : "run"} from the last safe checkpoint.`
      });
    }
    if (action === "continue_run") {
      const executionId = required(input.executionId, "Execution");
      const text = required(input.text, "Text");
      const { uid } = runContext(this.database, executionId);
      return this.agents.admit("bees-run", executionId, {
        idempotencyKey: `continue:${executionId}:${Date.now()}`,
        uid,
        body: text
      });
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
