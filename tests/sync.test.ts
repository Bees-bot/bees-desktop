import { describe, expect, it } from "vitest";
import { assertMetadataOnly, logicalFileReference } from "../src/domain.js";
import { LocalRepository } from "../src/repository.js";
import { softwareProjectProcess } from "../src/processes/software-project/definition.js";
import {
  MetadataSyncService,
  type SyncRecord,
  type SyncTransport
} from "../src/sync.js";
import { NodeDatabase } from "./node-database.js";

class MemorySyncTransport implements SyncTransport {
  private readonly records = new Map<
    string,
    SyncRecord & { organizationId: string; sequence: number }
  >();
  private cursor = 0;

  async push(organizationId: string, records: SyncRecord[]): Promise<{ cursor: string }> {
    for (const record of records) {
      const key = `${organizationId}:${record.recordType}:${record.recordId}`;
      const current = this.records.get(key);
      if (!current || record.version > current.version) {
        this.cursor += 1;
        this.records.set(key, { ...record, organizationId, sequence: this.cursor });
      }
    }
    const latest = [...this.records.values()]
      .filter((record) => record.organizationId === organizationId)
      .reduce((maximum, record) => Math.max(maximum, record.sequence), 0);
    return { cursor: String(latest) };
  }

  async pull(organizationId: string, cursor: string | null): Promise<{ cursor: string; records: SyncRecord[] }> {
    const records = [...this.records.values()]
      .filter(
        (record) =>
          record.organizationId === organizationId && record.sequence > Number(cursor ?? 0)
      )
      .sort((left, right) => left.sequence - right.sequence);
    return {
      cursor: String(records.at(-1)?.sequence ?? cursor ?? "0"),
      records: records.map(({ organizationId: _organizationId, sequence: _sequence, ...record }) => record)
    };
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
    const firstProcess = (await first.listProcesses(local.teamId))[0]!;
    const process = (await second.listProcesses(local.teamId))[0]!;
    expect(process.name).toBe("Goals");
    expect(process.id).toBe(firstProcess.id);
    expect(process.stages.map(({ id }) => id)).toEqual(firstProcess.stages.map(({ id }) => id));
    expect(process.definition.stateIds).toEqual(firstProcess.definition.stateIds);
    expect(await second.listAvailableFileLocations(local.teamId)).toEqual([
      expect.objectContaining({ id: locationId, name: "Shared drive", localPath: null })
    ]);

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

  it("assigns the same bundled process and stage IDs on concurrent machines", async () => {
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
        params: [local.teamId, local.organizationId, "Engineering", "2026-01-01", "2026-01-01"]
      }
    ]);
    const second = new LocalRepository(secondDatabase);

    const firstId = await first.createProcess(local.teamId, {
      name: "Code",
      template: softwareProjectProcess.definition
    });
    const secondId = await second.createProcess(local.teamId, {
      name: "Code",
      template: softwareProjectProcess.definition
    });
    const firstCode = (await first.listProcesses(local.teamId)).find(({ id }) => id === firstId)!;
    const secondCode = (await second.listProcesses(local.teamId)).find(({ id }) => id === secondId)!;

    expect(secondId).toBe(firstId);
    expect(secondCode.stages.map(({ id }) => id)).toEqual(firstCode.stages.map(({ id }) => id));
    expect(secondCode.definition).toEqual(firstCode.definition);
  });

  it("keeps first-pull cursors independent between shared workspaces", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const first = await repository.bootstrap();
    const secondOrganizationId = await repository.createOrganization("Second connected org");
    const secondTeamId = await repository.createTeam(secondOrganizationId, "Operations");
    const transport = new MemorySyncTransport();
    const sync = new MetadataSyncService(repository, transport);
    const locationId = crypto.randomUUID();
    await transport.push(secondOrganizationId, [{
      recordType: "file_location",
      recordId: locationId,
      version: 1,
      deleted: false,
      payload: {
        workspaceId: secondOrganizationId,
        teamId: null,
        name: "Second org drive",
        updatedAt: "2026-08-08T12:00:00.000Z"
      }
    }]);

    await sync.synchronize(first.organizationId, first.teamId);
    await sync.synchronize(secondOrganizationId, secondTeamId);

    expect(await repository.listAvailableFileLocations(secondTeamId)).toContainEqual(
      expect.objectContaining({ id: locationId, name: "Second org drive" })
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
      runtime: "dsh",
      workspaceRef: "/private/run/workspace"
    });
    await repository.saveRegistry({
      teamId: local.teamId,
      name: "Private plugin",
      sourcePath: "/Users/alice/private-plugin",
      plugin: {
        manifest: {
          $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
          name: "private-plugin"
        },
        skills: [],
        mcpServers: [],
        issues: [],
        fileCount: 1
      }
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
      ["processId", "name", "position", "completionRules", "isTerminal"].sort()
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
