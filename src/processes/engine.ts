import type {
  Agent,
  PersistedProcessDefinition,
  Process,
  ProcessCapability,
  Stage,
  WorkItem
} from "../domain.js";
import { processDiagram } from "../process-diagram.js";

export interface ProcessDefinition extends PersistedProcessDefinition {
  states: readonly Stage[];
  /** Bees processes may move from the current state to any installed state. */
  targetPolicy: "any-valid-state";
}

/** One ID-based resolver for built-in and customer-created processes. */
export class ProcessEngine {
  definition(process: Process, agents: readonly Agent[] = []): ProcessDefinition {
    const installedRoleBindings = agents.flatMap((agent) => {
      const role = String(agent.config.role ?? agent.name).trim();
      return role && process.stages.some(({ id }) => id === agent.triggerStageId)
        ? [{ role, stageId: agent.triggerStageId! }]
        : [];
    });
    return {
      ...process.definition,
      states: process.stages,
      targetPolicy: "any-valid-state",
      roleBindings: agents.length ? installedRoleBindings : process.definition.roleBindings
    };
  }

  state(process: Process, stageId: string): Stage | undefined {
    return process.stages.find(({ id }) => id === stageId);
  }

  boundState(process: Process, binding: string): Stage | undefined {
    const stageId = process.definition.stateIds[binding];
    return stageId ? this.state(process, stageId) : undefined;
  }

  target(process: Process, value: string): Stage | undefined {
    const wanted = value.trim();
    return process.stages.find(({ id }) => id === wanted);
  }

  next(process: Process, item: Pick<WorkItem, "stageId">): Stage | undefined {
    const current = this.state(process, item.stageId);
    return current
      ? process.stages.find(({ position }) => position > current.position)
      : undefined;
  }

  resolveTarget(
    process: Process,
    item: Pick<WorkItem, "stageId">,
    requested?: string
  ): Stage | undefined {
    return requested?.trim() ? this.target(process, requested) : this.next(process, item);
  }

  capability<Type extends ProcessCapability["type"]>(
    process: Process,
    type: Type
  ): Extract<ProcessCapability, { type: Type }> | undefined {
    return process.definition.capabilities.find(
      (capability): capability is Extract<ProcessCapability, { type: Type }> =>
        capability.type === type
    );
  }

  isInteractive(process: Process): boolean {
    return process.definition.automation === "interactive";
  }

  renderer(process: Process): string {
    return process.definition.renderer;
  }

  allowsMultipleAgents(process: Process, stageId: string): boolean {
    return process.definition.roleBindings.filter((binding) => binding.stageId === stageId).length > 1;
  }

  agentForItem(process: Process, item: WorkItem, agents: readonly Agent[]): Agent | undefined {
    const definition = this.definition(process, agents);
    if (!this.state(process, item.stageId)) return undefined;
    const taskPlan = this.capability(process, "task-plan");
    const requestedRole =
      taskPlan?.stageIds.work === item.stageId ? item.goal?.role : undefined;
    const roles = requestedRole
      ? [requestedRole]
      : definition.roleBindings
          .filter(({ stageId }) => stageId === item.stageId)
          .map(({ role }) => role);
    const normalized = new Set(roles.map((role) => role.toLowerCase()));
    return (
      agents.find((agent) =>
        normalized.has(String(agent.config.role ?? agent.name).trim().toLowerCase())
      ) ?? agents.find(({ triggerStageId }) => triggerStageId === item.stageId)
    );
  }

  diagram(process: Process): string {
    return processDiagram(process.stages.map(({ name }) => name));
  }
}
