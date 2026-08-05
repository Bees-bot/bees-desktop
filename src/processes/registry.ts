import { goalsProcess } from "./goals/definition.js";
import { softwareProjectProcess } from "./software-project/definition.js";
import type { ProcessLibraryEntry, ProcessModule } from "./types.js";

export type {
  ProcessLibraryAgent,
  ProcessLibraryEntry,
  ProcessModule,
  ProcessStudio
} from "./types.js";

/** Compile-time process modules shipped with Bees Desktop. */
export const PROCESS_MODULES: readonly ProcessModule[] = [goalsProcess, softwareProjectProcess];

export const PROCESS_LIBRARY: readonly ProcessLibraryEntry[] = PROCESS_MODULES.map(
  ({ definition }) => definition
);

export function processModule(name: string): ProcessModule | undefined {
  return PROCESS_MODULES.find(({ definition }) => definition.name === name);
}

export function starterProcessModule(): ProcessModule {
  const module = PROCESS_MODULES.find(({ starter }) => starter);
  if (!module) throw new Error("The bundled starter process is missing");
  return module;
}

export function processLibraryEntry(id: string): ProcessLibraryEntry | undefined {
  return PROCESS_LIBRARY.find((entry) => entry.id === id);
}
