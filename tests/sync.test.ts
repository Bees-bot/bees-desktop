import { describe, expect, it } from "vitest";
import { assertMetadataOnly, logicalFileReference } from "../src/domain.js";
import { LocalRepository } from "../src/repository.js";
import {
  MetadataSyncService,
  type SyncRecord,
  type SyncTransport
} from "../src/sync.js";
import { NodeDatabase } from "./node-database.js";

class MemorySyncTransport implements SyncTransport {
  private readonly records = new Map<string, SyncRecord>();
  private cursor = 0;

  async push(_organizationId: string, records: SyncRecord[]): Promise<{ cursor: string }> {
    for (const record of records) {
      const key = `${record.recordType}:${record.recordId}`;
      const current = this.records.get(key);
      if (!current || record.version >= current.version) this.records.set(key, record);
    }
    this.cursor += 1;
    return { cursor: String(this.cursor) };
  }

  async pull(): Promise<{ cursor: string; records: SyncRecord[] }> {
    return { cursor: String(this.cursor), records: [...this.records.values()] };
  }
}

describe("metadata synchronization", () => {
  it("coordinates work between two local databases without file content", async () => {
    const first = new LocalRepository(new NodeDatabase());
    const local = await first.bootstrap();
    const secondDatabase = new NodeDatabase();
    await secondDatabase.transaction([
      {
        sql: "INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        params: [local.organizationId, "Shared", "2026-01-01", "2026-01-01"]
      },
      {
        sql: "INSERT INTO teams (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        params: [local.teamId, local.organizationId, "Marketing", "2026-01-01", "2026-01-01"]
      }
    ]);
    const second = new LocalRepository(secondDatabase);
    const transport = new MemorySyncTransport();
    const firstSync = new MetadataSyncService(first, transport);
    const secondSync = new MetadataSyncService(second, transport);

    const locationId = await first.createFileLocation({
      organizationId: local.organizationId,
      name: "Shared drive",
      localPath: "/Users/alice/Drive"
    });

    await firstSync.synchronize(local.organizationId, local.teamId);
    await secondSync.synchronize(local.organizationId, local.teamId);
    const process = (await second.listProcesses(local.teamId))[0]!;
    expect(process.name).toBe("Goals");
    expect(await second.listAvailableFileLocations(local.teamId)).toEqual([
      expect.objectContaining({ id: locationId, name: "Shared drive", localPath: null })
    ]);

    const firstProcess = (await first.listProcesses(local.teamId))[0]!;
    const parentId = await first.createWorkItem(firstProcess.id, {
      stageId: firstProcess.stages[0]!.id,
      title: "Shared brief",
      logicalFiles: [logicalFileReference(locationId, "Briefs/shared.md")]
    });
    await first.createWorkItem(firstProcess.id, {
      stageId: firstProcess.stages[0]!.id,
      parentId,
      title: "Shared subtask"
    });
    await firstSync.synchronize(local.organizationId, local.teamId);
    await secondSync.synchronize(local.organizationId, local.teamId);
    expect(await second.listWorkItems(firstProcess.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: parentId,
          title: "Shared brief",
          logicalFiles: [logicalFileReference(locationId, "Briefs/shared.md")]
        }),
        expect.objectContaining({ title: "Shared subtask", parentId })
      ])
    );
  });

  it("rejects document contents and absolute paths at the sync boundary", () => {
    expect(() => assertMetadataOnly({ fileBytes: "base64" })).toThrow("not allowed");
    expect(() => assertMetadataOnly({ absolutePath: "/Users/alice/file.md" })).toThrow(
      "not allowed"
    );
    expect(() => assertMetadataOnly({ logicalFiles: ["Drafts/file.md"] })).not.toThrow();
    expect(() =>
      assertMetadataOnly({
        logicalFiles: ["123e4567-e89b-42d3-a456-426614174000::Drafts/file.md"]
      })
    ).not.toThrow();
  });

  it("projects only the exact coordination fields", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const process = (await repository.listProcesses(local.teamId))[0]!;
    const workItemId = await repository.createWorkItem(process.id, {
      stageId: process.stages[0]!.id,
      title: "Private draft",
      description: "Coordination description",
      logicalFiles: ["Drafts/private.md"]
    });
    await repository.setTeamFolder(local.teamId, "/Users/alice/Company");
    await repository.createExecution({
      agentId: "private-agent",
      config: { prompt: "private prompt", instructions: "private instructions" },
      workItemId,
      runtime: "flue",
      workspaceRef: "/private/run/workspace"
    });
    await repository.saveRegistry({
      teamId: local.teamId,
      name: "Private tools",
      sourcePath: "/Users/alice/private-tools",
      files: ["secret-tool.ts"]
    });

    const projection = await repository.coordinationProjection(local.teamId);
    const processRecord = projection.find(({ recordType }) => recordType === "process")!;
    const stageRecord = projection.find(({ recordType }) => recordType === "stage")!;
    const workItemRecord = projection.find(({ recordId }) => recordId === workItemId)!;

    expect(Object.keys(processRecord.payload).sort()).toEqual(
      ["teamId", "name", "description", "definition", "updatedAt"].sort()
    );
    expect(processRecord.payload.definition).toEqual(process.definition);
    expect(Object.keys(stageRecord.payload).sort()).toEqual(
      ["processId", "name", "position", "completionRules"].sort()
    );
    expect(Object.keys(workItemRecord.payload).sort()).toEqual(
      [
        "processId",
        "stageId",
        "parentId",
        "title",
        "description",
        "owner",
        "goal",
        "status",
        "logicalFiles",
        "checkpointStageId",
        "checkpointAt",
        "createdAt",
        "updatedAt"
      ].sort()
    );
    expect(workItemRecord.payload.logicalFiles).toEqual(["Drafts/private.md"]);
    expect(JSON.stringify(projection)).not.toMatch(
      /private prompt|private instructions|private-tools|secret-tool|workspace|localPath/
    );
  });
});
