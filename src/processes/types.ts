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
}

export interface ProcessStudio {
  matches(processName: string): boolean;
  render(item: WorkItem, process: Process, runs: Execution[]): Promise<string>;
  handleAction(action: string, control: HTMLElement): Promise<boolean>;
  handlesSubmit(form: HTMLFormElement): boolean;
  handleSubmit(form: HTMLFormElement): Promise<boolean>;
}
import type { Execution, Process, WorkItem } from "../domain.js";
