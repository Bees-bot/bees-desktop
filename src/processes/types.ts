export interface ProcessLibraryAgent {
  role: string;
  name: string;
  purpose: string;
  stage: string;
  prompt: string;
  provider: string;
  model: string;
  skills?: readonly string[];
}

export interface ProcessLibraryEntry {
  id: string;
  name: string;
  description: string;
  boardName: string;
  stages: readonly string[];
  agents: readonly ProcessLibraryAgent[];
}

export interface ProcessModule {
  mode: "data-driven" | "studio";
  definition: ProcessLibraryEntry;
  starter?: boolean;
  autoStart?: boolean;
  /** Names this process shipped under before. Only used to tag rows created by older builds. */
  legacyNames?: readonly string[];
  /** Board names this process shipped under before, renamed on load the same way. */
  legacyBoardNames?: readonly string[];
}

/**
 * The tag that ties an installed process back to its bundled module. Written once at install and
 * never rewritten, so a team can rename the process to anything without losing its behaviour.
 */
export function processModuleTag(moduleId: string): string {
  return `module:${moduleId}`;
}

export interface ProcessStudio {
  matches(process: Process): boolean;
  render(item: WorkItem, process: Process, runs: Execution[]): Promise<string>;
  handleAction(action: string, control: HTMLElement): Promise<boolean>;
  handlesSubmit(form: HTMLFormElement): boolean;
  handleSubmit(form: HTMLFormElement): Promise<boolean>;
}
import type { Execution, Process, WorkItem } from "../domain.js";
