import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WorkspaceApi,
  workspaceSandboxLaunch
} from "../flue-runtime/project/.flue/sandboxes/bees-workspace.js";

describe("Bees workspace sandbox", () => {
  it("allows workspace files but rejects a symlink that leaves the workspace", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "bees-workspace-"));
    const outside = mkdtempSync(join(tmpdir(), "bees-outside-"));
    mkdirSync(join(workspace, "inside"));
    writeFileSync(join(workspace, "inside", "ok.txt"), "ok");
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(outside, join(workspace, "escape"), process.platform === "win32" ? "junction" : "dir");
    const api = new WorkspaceApi(realpathSync(workspace));

    await expect(api.readFile("/workspace/inside/ok.txt")).resolves.toBe("ok");
    await expect(api.readFile("/workspace/escape/secret.txt")).rejects.toThrow("symlink");
    await expect(api.writeFile("/workspace/escape/new.txt", "no")).rejects.toThrow("symlink");
  });

  it("delegates commands to the bundled Codex workspace sandbox with networking disabled", () => {
    const workspace = mkdtempSync(join(tmpdir(), "bees-workspace-launch-"));
    const launch = workspaceSandboxLaunch("npm test", workspace, workspace, {
      PATH: "/usr/bin",
      OPENAI_API_KEY: "must-not-leak"
    });
    expect(launch).not.toBeNull();
    expect(launch?.args).toEqual(expect.arrayContaining([
      "sandbox",
      "--permission-profile",
      "bees-workspace",
      "--sandbox-state-disable-network",
      "permissions.bees-workspace.network.enabled=false"
    ]));
    expect(launch?.args).toContain(
      `permissions.bees-workspace.filesystem={${JSON.stringify(workspace)}="write", ":root"="deny", ":minimal"="read"}`
    );
    expect(launch?.env).not.toHaveProperty("OPENAI_API_KEY");
  });
});
