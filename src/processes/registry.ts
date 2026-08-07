import { goalsProcess } from "./goals/definition.js";
import { softwareProjectProcess } from "./software-project/definition.js";
import { processModuleTag, type ProcessLibraryEntry, type ProcessModule } from "./types.js";

export type {
  ProcessLibraryAgent,
  ProcessLibraryEntry,
  ProcessModule,
  ProcessStudio
} from "./types.js";
export { processModuleTag } from "./types.js";

/** Compile-time process modules shipped with Bees Desktop. */
export const PROCESS_MODULES: readonly ProcessModule[] = [goalsProcess, softwareProjectProcess];

export const PROCESS_LIBRARY: readonly ProcessLibraryEntry[] = PROCESS_MODULES.map(
  ({ definition }) => definition
);

/** The module an installed process belongs to, found by tag so a rename cannot break it. */
export function processModule(tags: readonly string[]): ProcessModule | undefined {
  return PROCESS_MODULES.find(({ definition }) => tags.includes(processModuleTag(definition.id)));
}

export function processModuleById(moduleId: string): ProcessModule | undefined {
  return PROCESS_MODULES.find(({ definition }) => definition.id === moduleId);
}

/**
 * The library name a row should move to, or undefined to leave it alone. Only a row still called
 * something the module shipped under follows the library; a name the team chose is theirs.
 */
export function libraryRename(
  current: string,
  legacyNames: readonly string[],
  libraryName: string
): string | undefined {
  if (current === libraryName) return undefined;
  const shipped = legacyNames.some(
    (legacy) => legacy.toLowerCase() === current.trim().toLowerCase()
  );
  return shipped ? libraryName : undefined;
}

/**
 * The tag a process created by an older build should carry. Matched on name because that is the
 * only handle those rows have; once tagged, the name is free again.
 */
export function processModuleTagForName(name: string): string | undefined {
  const module = PROCESS_MODULES.find(
    ({ definition, legacyNames = [] }) =>
      [definition.name, ...legacyNames].some(
        (candidate) => candidate.toLowerCase() === name.trim().toLowerCase()
      )
  );
  return module && processModuleTag(module.definition.id);
}

export function starterProcessModule(): ProcessModule {
  const module = PROCESS_MODULES.find(({ starter }) => starter);
  if (!module) throw new Error("The bundled starter process is missing");
  return module;
}

export function processLibraryEntry(id: string): ProcessLibraryEntry | undefined {
  return PROCESS_LIBRARY.find((entry) => entry.id === id);
}
