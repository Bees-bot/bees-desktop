import { describe, expect, it, vi } from "vitest";
import { WorkMemory } from "../dsh-runtime/plugin/lib/work-memory.js";
import { NodeDatabase } from "./node-database.js";

function fixture() {
  const db = new NodeDatabase().connection;
  const workspaceId = String(db.prepare("SELECT id FROM workspaces LIMIT 1").get()!.id);
  const secrets = new Map<string, string>();
  const credentials = { set: async (id: string, value: string) => { secrets.set(id, value); },
    resolve: async (id: string) => secrets.has(id) ? { value: secrets.get(id) } : undefined,
    unset: async (id: string) => { secrets.delete(id); } };
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  return { db, workspaceId, secrets, fetcher, memory: new WorkMemory(db, credentials, fetcher) };
}

describe("workspace Hindsight memory", () => {
  it("is opt-in and stores keys only in DSH credentials", async () => {
    const { db, workspaceId, secrets, fetcher, memory } = fixture();
    expect(await memory.recall(workspaceId, "Anything")).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    await memory.configure(workspaceId, { url: "https://memory.example", enabled: true, apiKey: "private-test-key" });
    await memory.recall(workspaceId, "Prior outcomes");
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toContain(`/banks/bees-workspace-${workspaceId}/memories/recall`);
    expect((call[1].headers as any).authorization).toBe("Bearer private-test-key");
    expect(JSON.stringify(memory.settings(workspaceId))).not.toContain("private-test-key");
    expect([...secrets.values()]).toEqual(["private-test-key"]);
    await expect(memory.configure(workspaceId, { url: "https://key:secret@memory.example", enabled: true })).rejects.toThrow("credentials");
    db.close();
  });

  it("keeps failed writes durable and retries the same document without duplicate learning", async () => {
    const { db, workspaceId, fetcher, memory } = fixture();
    await memory.configure(workspaceId, { url: "http://127.0.0.1:8888", enabled: true });
    memory.remember(workspaceId, "Use source dates", "Accepted review run-1", "outcome-1");
    memory.remember(workspaceId, "Use source dates", "Accepted review run-1", "outcome-1");
    fetcher.mockRejectedValueOnce(new Error("offline"));
    await memory.flush(workspaceId);
    expect(db.prepare("SELECT status FROM bees_memories").get()!.status).toBe("pending");
    await memory.flush(workspaceId);
    expect(db.prepare("SELECT count(*) AS count FROM bees_memories").get()!.count).toBe(1);
    expect(db.prepare("SELECT status FROM bees_memories").get()!.status).toBe("stored");
    const call = fetcher.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body)).items[0].document_id).toBe("outcome-1");
    db.close();
  });

  it("synchronizes corrections and deletion and rejects cross-workspace administration", async () => {
    const { db, workspaceId, fetcher, memory } = fixture();
    await memory.configure(workspaceId, { url: "http://localhost:8888", enabled: true });
    memory.remember(workspaceId, "Old lesson", "review-1", "outcome-1");
    await memory.flush(workspaceId);
    await memory.command("memory_edit", { workspaceId, id: "outcome-1", content: "Corrected lesson" });
    expect(db.prepare("SELECT content, status FROM bees_memories").get()).toMatchObject({ content: "Corrected lesson", status: "stored" });
    await expect(memory.command("memory_delete", { workspaceId: "other", id: "outcome-1" })).rejects.toThrow();
    await memory.command("memory_delete", { workspaceId, id: "outcome-1" });
    expect(db.prepare("SELECT count(*) AS count FROM bees_memories").get()!.count).toBe(0);
    const call = fetcher.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(call[0]).toContain("/documents/outcome-1"); expect(call[1].method).toBe("DELETE");
    db.close();
  });
});
