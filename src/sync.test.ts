import { describe, expect, it, vi } from "vitest";
import type { LocalRepository } from "./repository.js";
import { MetadataSyncService, type SyncRecord, type SyncTransport } from "./sync.js";

const record = (recordId: string): SyncRecord =>
  ({ recordType: "work_item", recordId, version: 1, deleted: false, payload: { title: recordId } });

/** Stubs only the four members `synchronize` touches. `applied` and `completed` are what it did. */
function sync(pulled: unknown, apply: (id: string) => void = () => undefined) {
  const applied: string[] = [];
  const completed: string[] = [];
  const repository = {
    syncCursor: async () => "7",
    coordinationProjection: async () => [],
    applyCoordinationRecord: async ({ recordId }: SyncRecord) => {
      apply(recordId);
      applied.push(recordId);
    },
    completeSyncEntries: async (_entries: unknown, cursor: string) => void completed.push(cursor)
  } as unknown as LocalRepository;
  const transport = {
    push: async () => ({ cursor: "7" }),
    pull: async () => pulled as { cursor: string; records: SyncRecord[] }
  } satisfies SyncTransport;
  return { applied, completed, service: new MetadataSyncService(repository, transport) };
}

describe("MetadataSyncService.synchronize", () => {
  it("applies every record and advances the cursor", async () => {
    const { applied, completed, service } = sync({ cursor: "9", records: [record("a"), record("b")] });

    await expect(service.synchronize("org", "team")).resolves.toBe(2);
    expect(applied).toEqual(["a", "b"]);
    expect(completed).toEqual(["9"]);
  });

  // The wedge: one unusable record aborted the loop before the cursor moved, so the next sync pulled
  // the same batch and failed on the same record — permanently, with no way out.
  it("skips an unusable record, keeps the rest, and still advances the cursor", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { applied, completed, service } = sync(
      { cursor: "12", records: [record("a"), record("poison"), record("b")] },
      (id) => { if (id === "poison") throw new Error("UNIQUE constraint failed"); }
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
    const { completed, service } = sync(pulled);

    await expect(service.synchronize("org", "team")).resolves.toBe(0);
    expect(completed).toHaveLength(1);
  });

  // A response with no usable cursor must not rewind the one already stored.
  it("keeps the stored cursor when the response carries none", async () => {
    const { completed, service } = sync({ records: [] });

    await service.synchronize("org", "team");
    expect(completed).toEqual(["7"]);
  });
});
