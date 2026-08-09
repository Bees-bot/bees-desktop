export interface ProcessLibraryAgent {
  role: string;
  name: string;
  purpose: string;
  /** Installation alias resolved to a database stage ID when the process is created. */
  state: string;
  prompt: string;
  provider: string;
  model: string;
  skills?: readonly string[];
}

export interface ProcessLibraryState {
  /** Installation alias; it is not retained as a runtime state identity. */
  key: string;
  /** Initial display label. Installed processes may rename it. */
  name: string;
}

export interface TaskPlanCapabilityTemplate {
  type: "task-plan";
  output: string;
  states: {
    plan: string;
    work: string;
    waiting: string;
    review: string;
    done: string;
  };
}

export interface ProjectWorkspaceCapabilityTemplate {
  type: "project-workspace";
}

export type ProcessCapabilityTemplate =
  | TaskPlanCapabilityTemplate
  | ProjectWorkspaceCapabilityTemplate;

export interface ProcessLibraryEntry {
  id: string;
  version: number;
  name: string;
  description: string;
  boardName: string;
  /** Every valid state is a valid transition target. This list defines identity, not edges. */
  states: readonly ProcessLibraryState[];
  automation: "automatic" | "interactive";
  renderer: string;
  capabilities?: readonly ProcessCapabilityTemplate[];
  agents: readonly ProcessLibraryAgent[];
}

export interface ProcessModule {
  definition: ProcessLibraryEntry;
  starter?: boolean;
  autoStart?: boolean;
}

/** Resolves template aliases once. The persisted result contains database stage IDs only. */
export function persistProcessDefinition(
  template?: ProcessLibraryEntry,
  stateIds: Record<string, string> = {}
): PersistedProcessDefinition {
  const stageId = (key: string): string => {
    const id = stateIds[key];
    if (!id) throw new Error(`The process template is missing the ${key} state`);
    return id;
  };
  const capabilities: ProcessCapability[] = (template?.capabilities ?? []).map((capability) =>
    capability.type === "task-plan"
      ? {
        type: capability.type,
        output: capability.output,
        stageIds: {
          plan: stageId(capability.states.plan),
          work: stageId(capability.states.work),
          waiting: stageId(capability.states.waiting),
          review: stageId(capability.states.review),
          done: stageId(capability.states.done)
        }
      }
      : { type: capability.type }
  );
  return {
    moduleId: template?.id ?? null,
    version: template?.version ?? 1,
    automation: template?.automation ?? "automatic",
    renderer: template?.renderer ?? "default",
    stateIds,
    capabilities,
    roleBindings: (template?.agents ?? []).map(({ role, state }) => ({
      role,
      stageId: stageId(state)
    }))
  };
}

export interface ProcessRenderer {
  readonly id: string;
  render(item: WorkItem, process: Process, runs: Execution[]): Promise<string>;
  handleAction(action: string, control: HTMLElement): Promise<boolean>;
  handlesSubmit(form: HTMLFormElement): boolean;
  handleSubmit(form: HTMLFormElement): Promise<boolean>;
}
import type {
  Execution,
  PersistedProcessDefinition,
  Process,
  ProcessCapability,
  WorkItem
} from "../domain.js";
