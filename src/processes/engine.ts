import type { Agent, Process, Stage, WorkItem } from "../domain.js";
import { processDiagram } from "../process-diagram.js";
import type {
  ProcessCapability,
  ProcessLibraryEntry,
  ProcessModule
} from "./types.js";

export interface ProcessStateDefinition {
  /** Stable key inside this definition. Customer states use their durable stage id. */
  key: string;
  name: string;
  stageId: string;
}

export interface ProcessRoleBinding {
  role: string;
  stateKey: string;
}

export interface ProcessDefinition {
  id: string;
  version: number | string;
  states: readonly ProcessStateDefinition[];
  /** Bees processes may move from the current state to any state in `states`. */
  targetPolicy: "any-valid-state";
  automation: ProcessLibraryEntry["automation"];
  renderer: ProcessLibraryEntry["renderer"];
  capabilities: readonly ProcessCapability[];
  roleBindings: readonly ProcessRoleBinding[];
}

/**
 * One resolver for process identity, behavior, state selection, and agent bindings. It deliberately
 * has no transition graph: every installed state is a valid destination, regardless of origin.
 */
export class ProcessEngine {
  constructor(private readonly modules: readonly ProcessModule[]) {}

  module(process: Process): ProcessModule | undefined {
    return this.modules.find(({ definition }) =>
      process.tags?.includes(`module:${definition.id}`)
    );
  }

  definition(process: Process, agents: readonly Agent[] = []): ProcessDefinition {
    const module = this.module(process);
    const states = process.stages.map((stage, index) => ({
      key: module?.definition.states[index]?.key ?? stage.id,
      name: stage.name,
      stageId: stage.id
    }));
    const stateKey = (name: string): string | undefined => {
      const index = module?.definition.states.findIndex(({ key }) => key === name) ?? -1;
      return index >= 0 ? states[index]?.key : undefined;
    };
    const installedRoleBindings = agents.flatMap((agent) => {
      const state = states.find(({ stageId }) => stageId === agent.triggerStageId);
      const role = String(agent.config.role ?? agent.name).trim();
      return state && role ? [{ role, stateKey: state.key }] : [];
    });
    const roleBindings = agents.length
      ? installedRoleBindings
      : module
        ? module.definition.agents.flatMap(({ role, state }) => {
            const key = stateKey(state);
            return key ? [{ role, stateKey: key }] : [];
          })
        : installedRoleBindings;
    return {
      id: module?.definition.id ?? process.id,
      version: module?.definition.version ?? process.updatedAt,
      states,
      targetPolicy: "any-valid-state",
      automation: module?.definition.automation ?? "automatic",
      renderer: module?.definition.renderer ?? "default",
      capabilities: module?.definition.capabilities ?? [],
      roleBindings
    };
  }

  state(process: Process, stageId: string): ProcessStateDefinition | undefined {
    return this.definition(process).states.find((state) => state.stageId === stageId);
  }

  stateByKey(process: Process, key: string): ProcessStateDefinition | undefined {
    return this.definition(process).states.find((state) => state.key === key);
  }

  target(process: Process, value: string): Stage | undefined {
    const wanted = value.trim().toLowerCase();
    const state = this.definition(process).states.find(
      ({ key, name, stageId }) =>
        key.toLowerCase() === wanted ||
        name.trim().toLowerCase() === wanted ||
        stageId.toLowerCase() === wanted
    );
    return state && process.stages.find(({ id }) => id === state.stageId);
  }

  next(process: Process, item: Pick<WorkItem, "stageId">): Stage | undefined {
    const current = process.stages.find(({ id }) => id === item.stageId);
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
    return this.definition(process).capabilities.find(
      (capability): capability is Extract<ProcessCapability, { type: Type }> =>
        capability.type === type
    );
  }

  isInteractive(process: Process): boolean {
    return this.definition(process).automation === "interactive";
  }

  renderer(process: Process): ProcessLibraryEntry["renderer"] {
    return this.definition(process).renderer;
  }

  allowsMultipleAgents(process: Process, stageId: string): boolean {
    const definition = this.definition(process);
    const state = definition.states.find((candidate) => candidate.stageId === stageId);
    return Boolean(
      state && definition.roleBindings.filter(({ stateKey }) => stateKey === state.key).length > 1
    );
  }

  agentForItem(process: Process, item: WorkItem, agents: readonly Agent[]): Agent | undefined {
    const definition = this.definition(process, agents);
    const state = definition.states.find(({ stageId }) => stageId === item.stageId);
    if (!state) return undefined;
    const taskPlan = this.capability(process, "task-plan");
    const requestedRole =
      taskPlan && state.key === taskPlan.states.work ? item.goal?.role : undefined;
    const roles = requestedRole
      ? [requestedRole]
      : definition.roleBindings
          .filter(({ stateKey }) => stateKey === state.key)
          .map(({ role }) => role);
    const normalized = new Set(roles.map((role) => role.toLowerCase()));
    return (
      agents.find((agent) =>
        normalized.has(String(agent.config.role ?? agent.name).trim().toLowerCase())
      ) ?? agents.find(({ triggerStageId }) => triggerStageId === item.stageId)
    );
  }

  diagram(process: Process): string {
    return processDiagram(this.definition(process).states.map(({ name }) => name));
  }
}
