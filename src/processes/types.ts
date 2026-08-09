export interface ProcessLibraryAgent {
  role: string;
  name: string;
  purpose: string;
  /** Stable process-state key. Display labels may be renamed without changing this binding. */
  state: string;
  prompt: string;
  provider: string;
  model: string;
  skills?: readonly string[];
}

export interface ProcessLibraryState {
  /** Stable semantic key used by capabilities and role bindings. */
  key: string;
  /** Initial display label. Installed processes may rename it. */
  name: string;
}

export interface TaskPlanCapability {
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

export interface ProjectWorkspaceCapability {
  type: "project-workspace";
}

export type ProcessCapability = TaskPlanCapability | ProjectWorkspaceCapability;

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
  capabilities?: readonly ProcessCapability[];
  agents: readonly ProcessLibraryAgent[];
}

export interface ProcessModule {
  definition: ProcessLibraryEntry;
  starter?: boolean;
  autoStart?: boolean;
}

/**
 * The tag that ties an installed process back to its bundled module. Written once at install and
 * never rewritten, so a team can rename the process to anything without losing its behaviour.
 */
export function processModuleTag(moduleId: string): string {
  return `module:${moduleId}`;
}

export interface ProcessRenderer {
  readonly id: string;
  render(item: WorkItem, process: Process, runs: Execution[]): Promise<string>;
  handleAction(action: string, control: HTMLElement): Promise<boolean>;
  handlesSubmit(form: HTMLFormElement): boolean;
  handleSubmit(form: HTMLFormElement): Promise<boolean>;
}
import type { Execution, Process, WorkItem } from "../domain.js";
