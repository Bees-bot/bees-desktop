import { describe, expect, it, vi } from "vitest";
import { checkEntitlement } from "../src/entitlements.js";
import {
  TemporaryWorkspaceService,
  validateCollectedOutputs,
  type WorkspaceNativePort
} from "../src/workspaces.js";

describe("local adapters", () => {
  it("publishes only normalized logical output paths", async () => {
    const native: WorkspaceNativePort = {
      validateDirectory: vi.fn().mockResolvedValue("/team"),
      defaultRoot: vi.fn().mockResolvedValue("/home/Bees"),
      ensureDirectory: vi.fn().mockResolvedValue("/team"),
      create: vi.fn().mockResolvedValue("/cache/run"),
      projectWorkspace: vi.fn().mockResolvedValue("/projects/run"),
      copyInputs: vi.fn().mockResolvedValue([]),
      writeOutput: vi.fn().mockResolvedValue(".tasks.json"),
      collectOutputs: vi.fn().mockResolvedValue(["result.md"]),
      preview: vi.fn().mockResolvedValue({ before: null, after: "result", truncated: false }),
      publish: vi.fn().mockResolvedValue("Approved/result.md"),
      cleanup: vi.fn().mockResolvedValue(undefined),
      readLocationFile: vi.fn().mockResolvedValue(null),
      writeLocationFile: vi.fn().mockResolvedValue(undefined)
    };
    const service = new TemporaryWorkspaceService(native);
    await expect(
      service.publishApproved("/cache/run", "../secret", "/team", "Approved/result.md")
    ).rejects.toThrow("relative paths");
    await expect(
      service.publishApproved("/cache/run", "result.md", "/team", "Approved/result.md")
    ).resolves.toBe("Approved/result.md");
    expect(() => validateCollectedOutputs([], ["require-output"])).toThrow("at least one output");
    expect(() => validateCollectedOutputs(["result.txt"], ["extension:.md"])).toThrow(
      ".md extension"
    );
  });

  it("stages linked inputs under an isolated location directory", async () => {
    const copyInputs = vi.fn().mockResolvedValue([]);
    const native = {
      validateDirectory: vi.fn(async (path: string) => path),
      create: vi.fn().mockResolvedValue("/app/runs/run-1"),
      copyInputs
    } as unknown as WorkspaceNativePort;
    const service = new TemporaryWorkspaceService(native);
    const locationId = "123e4567-e89b-42d3-a456-426614174000";

    await service.prepare(
      "run-1",
      "/team",
      ["brief.md", `${locationId}::Reports/q2.pdf`],
      [{
        id: locationId,
        organizationId: "org",
        teamId: null,
        name: "Company Drive",
        localPath: "/drive",
        missing: false,
        deletedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }]
    );

    expect(copyInputs).toHaveBeenNthCalledWith(
      1,
      "/team",
      "/app/runs/run-1",
      ["brief.md"],
      "",
      undefined
    );
    expect(copyInputs).toHaveBeenNthCalledWith(
      2,
      "/drive",
      "/app/runs/run-1",
      ["Reports/q2.pdf"],
      "locations/company-drive-123e4567",
      undefined
    );
  });

  it("stages a project run's inputs inside the worktree, under the Bees folder", async () => {
    const copyInputs = vi.fn().mockResolvedValue([]);
    const native = {
      validateDirectory: vi.fn(async (path: string) => path),
      create: vi.fn(),
      copyInputs
    } as unknown as WorkspaceNativePort;

    await new TemporaryWorkspaceService(native).prepareProject(
      "/projects/app",
      "/team",
      ["roteris.txt"],
      [],
      "project-1"
    );

    expect(native.create).not.toHaveBeenCalled();
    expect(copyInputs).toHaveBeenCalledWith(
      "/team",
      "/projects/app",
      ["roteris.txt"],
      "",
      "project-1"
    );
  });

  it("keeps local core usable and applies the offline license grace window", () => {
    expect(checkEntitlement("local-core", null)).toEqual({
      enabled: true,
      reason: "open-source"
    });
    const license = {
      plan: "team",
      features: ["shared-sync"],
      checkedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-02T00:00:00Z",
      offlineGraceDays: 7
    };
    expect(checkEntitlement("shared-sync", license, new Date("2026-01-05T00:00:00Z"))).toEqual({
      enabled: true,
      reason: "offline-grace"
    });
    expect(checkEntitlement("shared-sync", license, new Date("2026-01-20T00:00:00Z"))).toEqual({
      enabled: false,
      reason: "expired"
    });
  });
});
