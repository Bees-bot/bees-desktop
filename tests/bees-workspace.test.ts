import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
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

  it("delegates commands to Anthropic SRT with a workspace-only policy", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "bees-workspace-launch-"));
    process.env.BEES_STATE_DIR = mkdtempSync(join(tmpdir(), "bees-srt-state-"));
    const launch = await workspaceSandboxLaunch("npm test", workspace, workspace, {
      PATH: "/usr/bin",
      OPENAI_API_KEY: "must-not-leak"
    });
    expect(launch.args[0]).toContain("@anthropic-ai/sandbox-runtime/dist/cli.js");
    expect(launch.args).toEqual(expect.arrayContaining(["--settings", launch.policyPath, "-c", "npm test"]));
    const policy = JSON.parse(readFileSync(launch.policyPath, "utf8"));
    expect(policy.filesystem).toMatchObject({ allowWrite: [workspace], denyWrite: [] });
    expect(policy.filesystem.allowRead).toContain(workspace);
    expect(policy.filesystem.allowRead).not.toContain("/");
    expect(policy.network.allowedDomains).toContain("registry.npmjs.org");
    expect(policy.network.strictAllowlist).toBe(true);
    expect(launch.env).not.toHaveProperty("OPENAI_API_KEY");
    delete process.env.BEES_STATE_DIR;
  });

  it.runIf(process.platform === "darwin")(
    "allows workspace writes and blocks neighboring files in the real OS sandbox",
    async () => {
      const workspace = mkdtempSync(join(tmpdir(), "bees-srt-work-"));
      const outside = mkdtempSync(join(tmpdir(), "bees-srt-outside-"));
      process.env.BEES_STATE_DIR = mkdtempSync(join(tmpdir(), "bees-srt-state-"));
      writeFileSync(join(outside, "secret.txt"), "secret");
      const api = new WorkspaceApi(realpathSync(workspace));

      const result = await api.exec(`touch created.txt; cat '${join(outside, "secret.txt")}'`);

      expect(existsSync(join(workspace, "created.txt"))).toBe(true);
      expect(result.exitCode, JSON.stringify(result)).not.toBe(0);
      expect(result.stdout).not.toContain("secret");
      const npm = await api.exec("npm --version");
      expect(npm.exitCode, JSON.stringify(npm)).toBe(0);
      expect(npm.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
      delete process.env.BEES_STATE_DIR;
    }
  );
});
