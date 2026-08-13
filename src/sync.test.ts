import { describe, expect, it, vi } from "vitest";
import type { LocalRepository } from "./repository.js";
import { MetadataSyncService, type SyncRecord, type SyncTransport } from "./sync.js";

const record = (recordId: string, recordType = "work_item"): SyncRecord => ({
  recordType,
  recordId,
  version: 1,
  deleted: false,
  payload: { title: recordId }
});

/** Only the four members `synchronize` touches; the rest of the repository is not in play here. */
function repositoryStub(apply: (record: SyncRecord) => Promise<void>) {
  const completed: Array<string> = [];
  return {
    completed,
    repository: {
      syncCursor: async () => "7",
      coordinationProjection: async () => [],
      applyCoordinationRecord: apply,
      completeSyncEntries: async (_entries: unknown, cursor: string) => {
        completed.push(cursor);
      }
    } as unknown as LocalRepository
  };
}

function transportStub(pulled: unknown): SyncTransport {
  return {
    push: async () => ({ cursor: "7" }),
    pull: async () => pulled as { cursor: string; records: SyncRecord[] }
  };
}

describe("MetadataSyncService.synchronize", () => {
  it("applies every record and advances the cursor", async () => {
    const applied: string[] = [];
    const { repository, completed } = repositoryStub(async ({ recordId }) => {
      applied.push(recordId);
    });
    const service = new MetadataSyncService(
      repository,
      transportStub({ cursor: "9", records: [record("a"), record("b")] })
    );

    await expect(service.synchronize("org", "team")).resolves.toBe(2);
    expect(applied).toEqual(["a", "b"]);
    expect(completed).toEqual(["9"]);
  });

  // The wedge: one unusable record used to abort the loop before the cursor moved, so the next
  // sync pulled the same batch and failed on the same record — permanently, with no way out.
  it("skips an unusable record, keeps the rest, and still advances the cursor", async () => {
    const applied: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { repository, completed } = repositoryStub(async ({ recordId }) => {
      if (recordId === "poison") throw new Error("UNIQUE constraint failed");
      applied.push(recordId);
    });
    const service = new MetadataSyncService(
      repository,
      transportStub({ cursor: "12", records: [record("a"), record("poison"), record("b")] })
    );

    await expect(service.synchronize("org", "team")).resolves.toBe(2);
    expect(applied).toEqual(["a", "b"]);
    expect(completed).toEqual(["12"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("poison"));
    warn.mockRestore();
  });

  it.each([
    ["a 200 carrying no records", { cursor: "9" }],
    ["a null body", null],
    ["records that are not a list", { cursor: "9", records: "nope" }]
  ])("treats %s as an empty batch instead of throwing", async (_label, pulled) => {
    const { repository, completed } = repositoryStub(async () => {
      throw new Error("should not be reached");
    });
    const service = new MetadataSyncService(repository, transportStub(pulled));

    await expect(service.synchronize("org", "team")).resolves.toBe(0);
    expect(completed).toHaveLength(1);
  });

  // A response with no usable cursor must not rewind the one already stored.
  it("keeps the stored cursor when the response carries none", async () => {
    const { repository, completed } = repositoryStub(async () => undefined);
    const service = new MetadataSyncService(repository, transportStub({ records: [] }));

    await service.synchronize("org", "team");
    expect(completed).toEqual(["7"]);
  });
});
