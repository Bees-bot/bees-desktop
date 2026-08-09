import { goalsProcess } from "./goals/definition.js";
import { softwareProjectProcess } from "./software-project/definition.js";
import { processModuleTag, type ProcessLibraryEntry, type ProcessModule } from "./types.js";
import { ProcessEngine } from "./engine.js";

export type {
  ProcessLibraryAgent,
  ProcessLibraryEntry,
  ProcessModule,
  ProcessRenderer
} from "./types.js";
export type { ProcessDefinition, ProcessRoleBinding, ProcessStateDefinition } from "./engine.js";
export { processModuleTag } from "./types.js";

/** Compile-time process modules shipped with Bees Desktop. */
export const PROCESS_MODULES: readonly ProcessModule[] = [goalsProcess, softwareProjectProcess];

export const processEngine = new ProcessEngine(PROCESS_MODULES);

export const PROCESS_LIBRARY: readonly ProcessLibraryEntry[] = PROCESS_MODULES.map(
  ({ definition }) => definition
);

export function processModuleById(moduleId: string): ProcessModule | undefined {
  return PROCESS_MODULES.find(({ definition }) => definition.id === moduleId);
}

export function starterProcessModule(): ProcessModule {
  const module = PROCESS_MODULES.find(({ starter }) => starter);
  if (!module) throw new Error("The bundled starter process is missing");
  return module;
}

export function processLibraryEntry(id: string): ProcessLibraryEntry | undefined {
  return PROCESS_LIBRARY.find((entry) => entry.id === id);
}
