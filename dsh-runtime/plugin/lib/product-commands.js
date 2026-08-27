import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  assignment, capabilities, currentIdentity, insertProcess, insertWorkspaceDefaults, iso,
  itemContext, mcpGrantFor, optionalReasoningEffort, parentFor, processContext, processStageNames,
  message, requireTeam, required, stableUuid, transaction, workspaceContext
} from "./product-database.js";
import {
  canonicalMapping, logicalRelativePath, mappedLocation, stageInputs
} from "./product-files.js";
import { resolveStageAgent } from "./product-routing.js";

/** The three the UI offers. Anything else is a typo or a client that has drifted. */
function priorityOf(value) {
  const priority = String(value ?? "normal");
  if (!["low", "normal", "high"].includes(priority)) throw new Error("Priority must be low, normal or high");
  return priority;
}

/** An agent's MCP policy: every connected server, none of them, or a named few. */
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
        input.owner ? String(input.owner) : null, assignmentId, priorityOf(input.priority), at, at);
        return { id };
      });
      // The row is already committed; throwing here would have the caller retry and create a second item.
      return { ...created, ...await this.processes.startItem(created.id).catch((error) => ({ error: message(error) })) };
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
        assignmentId, priorityOf(input.priority), parentId, at, item.id);
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
      processContext(this.database, processId, ["admin", "member"]);
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
        this.database.prepare("UPDATE stages SET archived_at = ? WHERE id = ?").run(at, id));
      names.forEach((name, position) => {
        const driver = position === names.length - 1 ? "terminal"
          : position > 0 && /review/i.test(name) ? "review" : "agent";
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
    if (action === "set_stage_instructions") return transaction(this.database, () => {
      const stage = this.database.prepare(`
        SELECT s.id, p.workspace_id AS workspaceId FROM stages s JOIN processes p ON p.id = s.process_id
        WHERE s.id = ? AND s.archived_at IS NULL
      `).get(required(input.stageId, "Stage"));
      if (!stage) throw new Error("Stage not found");
      workspaceContext(this.database, stage.workspaceId, ["admin", "member"]);
      this.database.prepare("UPDATE stages SET completion_rules = ? WHERE id = ?")
        .run(String(input.instructions ?? "").slice(0, 4_000), stage.id);
      return { id: stage.id };
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
      const policy = checkMcpServers(this.database, mcpPolicy(input));
      return transaction(this.database, () => {
        const id = randomUUID();
        const maxConcurrency = Number(input.maxConcurrency ?? 0);
        if (!Number.isInteger(maxConcurrency) || maxConcurrency < 0 || maxConcurrency > 1000)
          throw new Error("Agent concurrency must be an integer from 0 to 1000");
        this.database.prepare(`
          INSERT INTO agent_assignments
            (id, workspace_id, preset_id, name, description, instructions, model, reasoning_effort, system_role,
             capabilities_json, enabled, max_concurrency, created_at, updated_at, mcp_access, mcp_servers_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, workspace.id, presetId, required(input.name, "Agent name"),
          String(input.description ?? ""), String(input.instructions ?? ""), input.model || null,
          optionalReasoningEffort(input.reasoningEffort),
          JSON.stringify(capabilities(input.capabilities)), input.enabled === false ? 0 : 1,
          maxConcurrency, at, at, policy.access, JSON.stringify(policy.servers));
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
        if (!preset || preset.broken) throw new Error("The DSH preset is unavailable");
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
        String(input.description ?? ""), String(input.instructions ?? ""), input.model || null,
        reasoningEffort,
        JSON.stringify(nextCapabilities), enabled ? 1 : 0, maxConcurrency,
        policy.access, JSON.stringify(policy.servers), at, id);
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
      const proposedProcessIds = new Map();
      for (const change of JSON.parse(proposal.changes)) {
        const processId = change.action === "create_item"
          ? proposedProcessIds.get(String(change.process).toLocaleLowerCase())
          : undefined;
        if (change.action === "create_item" && !processId)
          throw new Error("The proposed work item's process was not created earlier in this proposal");
        const result = await this.execute(change.action, {
          ...change, processId: processId ?? change.processId, workspaceId: proposal.workspaceId
        });
        results.push(result);
        if (change.action === "create_process")
          proposedProcessIds.set(String(change.name).toLocaleLowerCase(), result.id);
      }
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
          reasoningEffort: optionalReasoningEffort(input.reasoningEffort),
          instructions: "Propose a goal and/or visible process. Keep the proposal concise and executable.",
          workspaceId: workspace.id, agentPresetId: input.agentPresetId || "standard",
          mcpAccess: "all", mcpServers: [],
          grants: []
        }
      });
      return { executionId, sessionId: this.agents.run(executionId)?.currentSessionId };
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
      const assignment = resolveStageAgent(this.database, {
        executionId, item, stageId: item.stageId, purpose: stagePurpose,
        // Without this the reviewer could be the same agent that produced the work.
        candidateExecutionId: stagePurpose === "reviewer" ? this.database.prepare(`
          SELECT execution_id AS executionId FROM agent_dispatches
          WHERE work_item_id = ? ORDER BY created_at DESC LIMIT 1
        `).get(item.id)?.executionId : null
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
          reasoningEffort: optionalReasoningEffort(input.reasoningEffort) || assignment?.reasoningEffort || null,
          instructions: [assignment?.instructions, item.description].filter(Boolean).join("\n\n"),
          workspaceId: item.workspaceId, agentPresetId: assignment?.presetId || "standard",
          ...mcpGrantFor(this.database, assignment?.id),
          grants
        }
      });
      return { executionId };
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
    if (action === "publish_run") {
      const executionId = required(input.executionId, "Execution");
      const { uid, data } = runContext(this.database, executionId);
      const locationId = required(input.locationId, "Location");
      if (!data.grants.includes(locationId)) throw new Error("That location was not granted to this run");
      return this.agents.admit("bees-run", executionId, {
        idempotencyKey: `publish:${executionId}:${locationId}:${randomUUID()}`, uid,
        body: `Publish the finished files under outputs/ to the granted location ${locationId}. Use bees_publish_outputs and do not modify the deliverables.`
      });
    }
    throw new Error(`Unknown action: ${action}`);
}
