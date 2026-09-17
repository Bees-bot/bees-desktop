import { existsSync, readFileSync, renameSync, statSync } from "node:fs";

// Preserve Cargo's input timestamp when preparation produces the same executable.
// The caller removes the temporary staging directory after this returns.
export function publishArtifact(staged, destination) {
  if (existsSync(destination)) {
    const before = statSync(destination);
    const after = statSync(staged);
    if (before.size === after.size && before.mode === after.mode &&
        readFileSync(staged).equals(readFileSync(destination))) return false;
  }
  renameSync(staged, destination);
  return true;
}
