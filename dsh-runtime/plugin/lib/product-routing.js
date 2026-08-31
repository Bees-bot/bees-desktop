import {
  activeAgentRuns, agentCapabilities, assignment, capabilities, defaultAssignment, iso, transaction
} from "./product-database.js";
import { randomUUID } from "node:crypto";

export class AgentCapacityError extends Error {}

function ensureAgentCapacity(database, agent, label) {
  const activeRuns = activeAgentRuns(database, agent.id);
  if (agent.maxConcurrency && activeRuns >= agent.maxConcurrency)
    throw new AgentCapacityError(`${label} is at its concurrency limit`);
  return activeRuns;
}

function specializationFor(database, recurringWorkId, agent) {
  if (!recurringWorkId) return null;
  let row = database.prepare(`
    SELECT s.id, s.name, s.playbook, s.revision, s.updated_at AS updatedAt
    FROM agent_specializations s
    WHERE s.recurring_work_id = ? AND s.agent_assignment_id = ?
  `).get(recurringWorkId, agent.id);
  if (row) return row;
  const recurring = database.prepare("SELECT name FROM recurring_work WHERE id = ?").get(recurringWorkId);
  if (!recurring) throw new Error("Recurring work not found");
  const at = iso();
  const id = randomUUID();
  database.prepare(`
    INSERT INTO agent_specializations
      (id, recurring_work_id, agent_assignment_id, name, playbook, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, '', 0, ?, ?)
  `).run(id, recurringWorkId, agent.id, `${recurring.name} · ${agent.name}`, at, at);
  row = { id, name: `${recurring.name} · ${agent.name}`, playbook: "", revision: 0, updatedAt: at };
  return row;
}

export function resolveStageAgent(database, { executionId, item, stageId, purpose, candidateExecutionId }) {
  const prior = database.prepare(`
    SELECT d.agent_assignment_id AS agentAssignmentId, d.target_type AS targetType,
           d.target_id AS targetId, d.reason, d.agent_revision AS agentRevision,
           d.specialization_id AS specializationId, d.agent_config_json AS agentConfig
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
      const assignedAt = iso();
      database.prepare(`
        UPDATE agent_pool_members SET last_assigned_at = ? WHERE pool_id = ? AND agent_assignment_id = ?
      `).run(assignedAt, pool.id, selected.id);
      database.prepare("UPDATE agent_pools SET updated_at = ? WHERE id = ?").run(assignedAt, pool.id);
    } else {
      const role = purpose === "reviewer" ? "reviewer" : "worker";
      selected = defaultAssignment(database, stage.workspaceId, role);
      targetType = "workspace-default";
      targetId = role;
      reason = `Team ${role} fallback`;
      if (!accepts(selected)) throw new Error(`The team ${role} agent is disabled, incompatible, or not independent`);
      ensureAgentCapacity(database, selected, selected.name);
    }
    const specialization = specializationFor(database, item.recurringWorkId, selected);
    if (Object.hasOwn(item.runSettings ?? {}, "model")) selected = {
      ...selected, model: item.runSettings.model, reasoningEffort: item.runSettings.reasoningEffort
    };
    const effectiveInstructions = [selected.instructions, specialization?.playbook].filter(Boolean).join("\n\n");
    const agentConfig = JSON.stringify({
      id: selected.id, workspaceId: selected.workspaceId, presetId: selected.presetId,
      name: selected.name, instructions: effectiveInstructions, baseInstructions: selected.instructions,
      specializationId: specialization?.id ?? null,
      specializationName: specialization?.name ?? null,
      specialistPlaybook: specialization?.playbook ?? "",
      specialistRevision: specialization?.revision ?? null,
      model: selected.model,
      reasoningEffort: selected.reasoningEffort,
      capabilities: selected.capabilities, enabled: selected.enabled,
      maxConcurrency: selected.maxConcurrency, updatedAt: selected.updatedAt
    });
    database.prepare(`
      INSERT INTO agent_dispatches
        (execution_id, work_item_id, stage_id, target_type, target_id,
         agent_assignment_id, specialization_id, reason, agent_revision, agent_config_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(executionId, item.id, stage.id, targetType, targetId, selected.id, specialization?.id ?? null,
      reason, `${selected.updatedAt}:${specialization?.revision ?? 0}`, agentConfig, iso());
    return {
      ...selected, instructions: effectiveInstructions,
      specializationId: specialization?.id ?? null,
      specializationName: specialization?.name ?? null,
      specialistPlaybook: specialization?.playbook ?? "",
      specialistRevision: specialization?.revision ?? null,
      agentAssignmentId: selected.id, targetType, targetId, reason,
      agentRevision: `${selected.updatedAt}:${specialization?.revision ?? 0}`
    };
  });
}
