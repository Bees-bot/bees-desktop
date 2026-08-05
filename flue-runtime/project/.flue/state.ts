// Mutable per-run pointers and browser profiles live outside the immutable bundled project.

import { resolve } from "node:path";

export function stateDir(): string {
  const dir = process.env.BEES_STATE_DIR;
  if (!dir) throw new Error("BEES_STATE_DIR is not configured");
  return dir;
}

/** The run's pointer file: `{ workspace, teamRoot }`, written by `bind_flue_workspace`. */
export function instancePointer(instanceId: string): string {
  return resolve(stateDir(), "instances", `${instanceId}.json`);
}
