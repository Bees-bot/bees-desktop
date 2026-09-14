import {
  activeAgentRuns, agentCapabilities, agentIds, assignment, capabilities, defaultAssignment, iso, transaction
} from "./product-database.js";
import { randomUUID } from "node:crypto";

export class AgentCapacityError extends Error {}

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

export function resolveStageAgent(database, { executionId, item, stageId, purpose, candidateExecutionId, recurringGuidance }) {
  const prior = database.prepare(`
    SELECT d.agent_assignment_id AS agentAssignmentId, d.target_type AS targetType,
           d.target_id AS targetId, d.reason, d.agent_revision AS agentRevision,
           d.specialization_id AS specializationId, d.agent_config_json AS agentConfig,
           d.agent_ids_json AS agentIds
    FROM agent_dispatches d WHERE d.execution_id = ?
  `).get(executionId);
  if (prior) {
    const lead = { ...JSON.parse(prior.agentConfig), ...prior };
    const ids = agentIds(JSON.parse(prior.agentIds || "[]"));
    const agents = [lead, ...(lead.participantConfigs ?? [])];
    return { ...lead, agents, collaborating: agents.length > 1 };
  }

  const stage = database.prepare(`
    SELECT s.id, s.name, s.driver, p.workspace_id AS workspaceId,
           r.agent_assignment_id AS routeAgentId,
           r.agent_ids_json AS routeAgentIds, r.required_capabilities_json AS requiredCapabilities
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
    let ids;
    let targetType;
    let targetId;
    let reason;
    if (purpose !== "reviewer" && item.agentIds.length) {
      ids = item.agentIds;
      targetType = "item";
      targetId = item.id;
      reason = ids.length > 1 ? "Work-item participant selections" : "Work-item agent mention";
    } else {
      ids = agentIds(JSON.parse(stage.routeAgentIds || "[]"));
      if (!ids.length && stage.routeAgentId) ids = [stage.routeAgentId];
    }
    if (!targetType && ids.length) {
      targetType = "agent";
      targetId = ids[0];
      reason = ids.length > 1 ? `Direct stage collaboration for ${stage.name}` : `Direct stage assignment for ${stage.name}`;
    }
    if (!ids.length) {
      const role = purpose === "reviewer" ? "reviewer" : "worker";
      const preferred = defaultAssignment(database, stage.workspaceId, role);
      const fallback = accepts(preferred) ? preferred : database.prepare(
        "SELECT id FROM agent_assignments WHERE workspace_id = ? AND enabled = 1 ORDER BY name, id"
      ).all(stage.workspaceId).map(({ id }) => assignment(database, id, stage.workspaceId))
        .find((agent) => accepts(agent) && (role === "reviewer" ? agent.systemRole === "reviewer" : agent.systemRole !== "reviewer"));
      ids = fallback ? [fallback.id] : [];
      targetType = "workspace-default";
      targetId = role;
      reason = `Automatic: ${fallback?.name ?? role} selected from eligible team agents`;
    }
    ids = agentIds(ids);
    if (!ids.length) throw new Error(`The team ${purpose === "reviewer" ? "reviewer" : "worker"} agent is unavailable`);
    // the planner writes discussion stages with one agent to seat; one agent is agent work
    const collaborating = ids.length > 1;
    if (purpose === "reviewer" && ids.length > 1) throw new Error("A review stage must use one independent agent");
    const agents = ids.map((id) => assignment(database, id, stage.workspaceId));
    if (agents.some((agent) => !accepts(agent)))
      throw new Error(`An agent assigned to ${stage.name} is disabled, incompatible, or not independent`);
    const busy = agents.filter((agent) => agent.maxConcurrency && activeAgentRuns(database, agent.id) >= agent.maxConcurrency);
    if (busy.length) throw new AgentCapacityError(`${busy.map(({ name }) => name).join(", ")} ${busy.length === 1 ? "is" : "are"} at capacity`);
    let selected = agents[0];
    const storedSpecialization = specializationFor(database, item.recurringWorkId, selected);
    const frozen = recurringGuidance?.find((entry) => entry.agentAssignmentId === selected.id);
    const specialization = storedSpecialization && recurringGuidance !== undefined
      ? { ...storedSpecialization, playbook: frozen?.playbook ?? "", revision: frozen?.revision ?? 0 }
      : storedSpecialization;
    if (Object.hasOwn(item.runSettings ?? {}, "model")) selected = {
      ...selected, model: item.runSettings.model, reasoningEffort: item.runSettings.reasoningEffort
    };
    const effectiveInstructions = [selected.instructions, specialization?.playbook].filter(Boolean).join("\n\n");
    const agentConfig = JSON.stringify({
      id: selected.id, workspaceId: selected.workspaceId, presetId: selected.presetId,
      participantConfigs: agents.slice(1),
      name: selected.name, instructions: effectiveInstructions, baseInstructions: selected.instructions,
      systemRole: selected.systemRole,
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
         agent_assignment_id, agent_ids_json, specialization_id, reason, agent_revision, agent_config_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(executionId, item.id, stage.id, targetType, targetId, selected.id, JSON.stringify(ids), specialization?.id ?? null,
      reason, `${selected.updatedAt}:${specialization?.revision ?? 0}`, agentConfig, iso());
    return {
      ...selected, instructions: effectiveInstructions,
      specializationId: specialization?.id ?? null,
      specializationName: specialization?.name ?? null,
      specialistPlaybook: specialization?.playbook ?? "",
      specialistRevision: specialization?.revision ?? null,
      agentAssignmentId: selected.id, targetType, targetId, reason,
      agentRevision: `${selected.updatedAt}:${specialization?.revision ?? 0}`,
      agents: [selected, ...agents.slice(1)], collaborating
    };
  });
}
