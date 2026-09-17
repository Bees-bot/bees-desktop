import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
// @ts-expect-error Build helpers are plain JavaScript.
import { publishArtifact } from "../scripts/publish-artifact.mjs";

it("preserves unchanged executable timestamps, but publishes changed, missing or damaged artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "bees-build-"));
  const staged = join(directory, "staged");
  const destination = join(directory, "runtime");
  const stage = (content: string) => { writeFileSync(staged, content); chmodSync(staged, 0o755); };
  try {
    stage("first binary");
    expect(publishArtifact(staged, destination)).toBe(true);
    utimesSync(destination, new Date(0), new Date(0));
    const timestamp = statSync(destination).mtimeMs;
    stage("first binary");
    expect(publishArtifact(staged, destination)).toBe(false);
    expect(statSync(destination).mtimeMs).toBe(timestamp);
    stage("other binary"); // Same size: a byte change must still invalidate the native build.
    expect(publishArtifact(staged, destination)).toBe(true);
    expect(readFileSync(destination, "utf8")).toBe("other binary");
    if (process.platform !== "win32") {
      chmodSync(destination, 0o644);
      stage("other binary");
      expect(publishArtifact(staged, destination)).toBe(true);
      expect(statSync(destination).mode & 0o777).toBe(0o755);
    }
    rmSync(destination);
    stage("other binary");
    expect(publishArtifact(staged, destination)).toBe(true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
