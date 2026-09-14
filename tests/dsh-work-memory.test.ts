import { describe, expect, it, vi } from "vitest";
import { WorkMemory } from "../dsh-runtime/plugin/lib/work-memory.js";
import { NodeDatabase } from "./node-database.js";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

function fixture() {
  const db = new NodeDatabase().connection;
  const workspaceId = String(db.prepare("SELECT id FROM workspaces LIMIT 1").get()!.id);
  const secrets = new Map<string, string>();
  const credentials = { set: async (id: string, value: string) => { secrets.set(id, value); },
    resolve: async (id: string) => secrets.has(id) ? { value: secrets.get(id) } : undefined,
    unset: async (id: string) => { secrets.delete(id); } };
  const operations = new Map<string, { status: string; item: any }>();
  const documents = new Map<string, any>();
  let exists = false;
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.split(`/banks/bees-workspace-${workspaceId}`)[1];
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (path === "" && init?.method === "PUT") { exists = true; return response({}); }
    if (path === "/memories" && init?.method === "POST") {
      exists = true;
      if (!operations.has(body.operation_id)) operations.set(body.operation_id, { status: "processing", item: body.items[0] });
      return response({ success: true, async: true, operation_id: body.operation_id });
    }
    if (!exists) return response({}, 404);
    if (path === "/profile") return response({ name: "Existing profile" });
    if (path === "/health/llm") return response({ operations: [{ operation: "retain", ok: true }] });
    if (path?.startsWith("/operations/")) return response({ status: operations.get(path.split("/")[2]!)?.status ?? "not_found" });
    if (path?.startsWith("/documents/") && init?.method === "DELETE") {
      documents.delete(decodeURIComponent(path.split("/")[2]!)); return response({});
    }
    if (path === "/memories/recall") return response({ results: [...documents.values()].map(item => ({
      id: item.document_id, text: item.content, document_id: item.document_id, type: "world"
    })) });
    throw new Error(`Unexpected memory request: ${init?.method} ${path}`);
  });
  const complete = () => {
    for (const operation of operations.values()) if (operation.status === "processing") {
      operation.status = "completed";
      documents.set(operation.item.document_id, operation.item);
    }
  };
  const memory = new WorkMemory(db, credentials, fetcher as typeof fetch);
  const configure = () => memory.configure(workspaceId, { url: "http://127.0.0.1:8888", enabled: true });
  const row = () => db.prepare("SELECT content, status, error FROM bees_memories LIMIT 1").get();
  return { db, workspaceId, secrets, credentials, fetcher, memory, configure, row, operations, documents, complete };
}

describe("workspace Hindsight memory", () => {
  it("is opt-in, creates the first bank, and stores keys only in DSH credentials", async () => {
    const f = fixture();
    expect(await f.memory.recall(f.workspaceId, "Anything")).toEqual([]);
    f.memory.remember(f.workspaceId, "Disabled", "review");
    expect(f.row()).toBeUndefined();
    expect(f.fetcher).not.toHaveBeenCalled();
    await f.memory.command("memory_configure", { workspaceId: f.workspaceId, url: "https://memory.example", enabled: true, apiKey: "private-test-key" });
    expect(f.fetcher.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true);
    expect((f.fetcher.mock.calls[0]![1]?.headers as any).authorization).toBe("Bearer private-test-key");
    expect(JSON.stringify(f.memory.settings(f.workspaceId))).not.toContain("private-test-key");
    expect([...f.secrets.values()]).toEqual(["private-test-key"]);
    expect(f.memory.settings(f.workspaceId).status).toBe("Connected");
    f.fetcher.mockClear();
    await f.memory.connect(f.workspaceId);
    expect(f.fetcher.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    await expect(f.memory.configure(f.workspaceId, { url: "https://key:secret@memory.example", enabled: true })).rejects.toThrow("credentials");
    f.db.close();
  });

  it("waits for extraction, survives a lost acknowledgement and resumes with the same operation after restart", async () => {
    const f = fixture(); await f.configure();
    f.memory.remember(f.workspaceId, "Use source dates", "Accepted review run-1", "outcome-1");
    f.memory.remember(f.workspaceId, "Use source dates", "Accepted review run-1", "outcome-1");
    const implementation = f.fetcher.getMockImplementation()!;
    let loseReply = true;
    f.fetcher.mockImplementation(async (url, init) => {
      const result = await implementation(url, init);
      if (String(url).endsWith("/memories") && loseReply) { loseReply = false; throw new Error("lost reply"); }
      return result;
    });
    await f.memory.flush(f.workspaceId);
    expect(f.row()!.status).toBe("pending");
    expect(f.operations.size).toBe(1);
    const restarted = new WorkMemory(f.db, f.credentials, f.fetcher as typeof fetch);
    await restarted.flush(f.workspaceId);
    expect(f.row()!.status).toBe("processing");
    expect(f.operations.size).toBe(1);
    expect(await restarted.recall(f.workspaceId, "Dates")).toEqual([]);
    f.complete(); await restarted.flush(f.workspaceId);
    expect(f.row()!.status).toBe("stored");
    expect((await restarted.recall(f.workspaceId, "Dates"))[0]!.text).toBe("Use source dates");
    expect(f.db.prepare("SELECT count(*) AS count FROM bees_memories").get()!.count).toBe(1);
    f.db.close();
  });

  it("does not claim connectivity when Hindsight's extraction provider is unavailable", async () => {
    const f = fixture(); await f.configure();
    const implementation = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (url, init) => String(url).endsWith("/health/llm")
      ? new Response(JSON.stringify({ operations: [{ operation: "retain", ok: false }] }))
      : implementation(url, init));
    await expect(f.memory.connect(f.workspaceId)).rejects.toThrow("LLM is not ready");
    await f.memory.recall(f.workspaceId, "Past outcomes");
    expect(f.memory.settings(f.workspaceId).status).toBe("LLM unavailable");
    f.db.close();
  });

  it("retries an unsent request with its durable operation ID", async () => {
    const f = fixture(); await f.configure();
    f.memory.remember(f.workspaceId, "Lesson", "review", "outcome-1");
    f.fetcher.mockRejectedValueOnce(new Error("offline"));
    await f.memory.flush(f.workspaceId);
    const id = f.db.prepare("SELECT id FROM bees_memory_operations").get()!.id;
    await f.memory.flush(f.workspaceId);
    expect([...f.operations.keys()]).toEqual([id]);
    f.db.close();
  });

  it("finishes old extraction before applying a correction and hides its stale facts", async () => {
    const f = fixture(); await f.configure();
    f.memory.remember(f.workspaceId, "Old lesson", "review", "outcome-1");
    await f.memory.flush(f.workspaceId);
    await f.memory.command("memory_edit", { workspaceId: f.workspaceId, id: "outcome-1", content: "Corrected lesson" });
    expect(f.operations.size).toBe(1);
    f.complete();
    expect(await f.memory.recall(f.workspaceId, "Lesson")).toEqual([]);
    await f.memory.flush(f.workspaceId);
    expect(f.row()!.status).toBe("pending");
    await f.memory.flush(f.workspaceId); f.complete(); await f.memory.flush(f.workspaceId);
    expect(f.row()).toMatchObject({ content: "Corrected lesson", status: "stored" });
    expect((await f.memory.recall(f.workspaceId, "Lesson"))[0]!.text).toBe("Corrected lesson");
    f.db.close();
  });

  it("waits for outstanding extraction before deletion so a forgotten source cannot be recreated", async () => {
    const f = fixture(); await f.configure();
    f.memory.remember(f.workspaceId, "Lesson", "review", "outcome-1");
    await f.memory.flush(f.workspaceId);
    await f.memory.command("memory_delete", { workspaceId: f.workspaceId, id: "outcome-1" });
    expect(f.row()!.status).toBe("deleting");
    expect(f.fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    f.complete();
    expect(await f.memory.recall(f.workspaceId, "Lesson")).toEqual([]);
    await f.memory.flush(f.workspaceId);
    expect(f.row()).toBeUndefined(); expect(f.documents.size).toBe(0);
    await expect(f.memory.command("memory_delete", { workspaceId: "other", id: "outcome-1" })).rejects.toThrow();
    f.db.close();
  });

  it("keeps terminal failures visible until an explicit retry", async () => {
    const f = fixture(); await f.configure();
    f.memory.remember(f.workspaceId, "Lesson", "review", "outcome-1");
    await f.memory.flush(f.workspaceId);
    [...f.operations.values()][0]!.status = "failed";
    await f.memory.flush(f.workspaceId);
    expect(f.row()!.status).toBe("failed");
    await f.memory.flush(f.workspaceId); expect(f.operations.size).toBe(1);
    await f.memory.command("memory_retry", { workspaceId: f.workspaceId });
    expect(f.operations.size).toBe(2);
    f.complete(); await f.memory.flush(f.workspaceId);
    expect(f.row()!.status).toBe("stored");
    f.db.close();
  });

  it("does not abandon remote sources when switching endpoints", async () => {
    const f = fixture(); await f.configure();
    f.memory.remember(f.workspaceId, "Lesson", "review");
    await expect(f.memory.configure(f.workspaceId, { url: "https://other.example", enabled: true })).rejects.toThrow("Forget and synchronize");
    await expect(f.memory.command("memory_retry", { workspaceId: f.workspaceId, viaAgent: true })).rejects.toThrow("user");
    f.db.close();
  });

  it("automatically drains multiple batches and stops before the database closes", async () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      await f.configure();
      for (let n = 0; n < 25; n++) f.memory.remember(f.workspaceId, `Lesson ${n}`, "review", `outcome-${n}`);
      f.memory.start();
      await f.memory.flush(f.workspaceId);
      f.complete();
      await vi.advanceTimersByTimeAsync(15000);
      f.complete();
      await vi.advanceTimersByTimeAsync(15000);
      f.complete();
      await vi.advanceTimersByTimeAsync(15000);
      expect(f.db.prepare("SELECT count(*) AS count FROM bees_memories WHERE status = 'stored'").get()!.count).toBe(25);
      await f.memory.close();
      const count = f.fetcher.mock.calls.length;
      f.db.close();
      await vi.advanceTimersByTimeAsync(30000);
      expect(f.fetcher.mock.calls.length).toBe(count);
    } finally { vi.useRealTimers(); }
  });
});

it.runIf(Boolean(process.env.BEES_MEMORY_TEST_URL))("delivers, recalls, corrects and forgets through the real Hindsight service", async () => {
  const db = new NodeDatabase().connection;
  const workspaceId = String(db.prepare("SELECT id FROM workspaces LIMIT 1").get()!.id);
  const memory = new WorkMemory(db, undefined);
  const bank = `bees-adapter-check-${randomUUID()}`;
  const settings = memory.settings.bind(memory);
  memory.settings = (id) => ({ ...settings(id), bank });
  await memory.configure(workspaceId, { url: process.env.BEES_MEMORY_TEST_URL, enabled: true });
  await memory.request(workspaceId, "", "PUT", {});
  const settle = async () => {
    for (let i = 0; i < 60; i++) {
      await memory.flush(workspaceId);
      const pending = db.prepare("SELECT status, error FROM bees_memories WHERE status != 'stored'").all();
      expect(pending.some(row => row.status === "failed")).toBe(false);
      if (!pending.length) return;
      await delay(1000);
    }
    throw new Error("Real Hindsight delivery did not settle in one minute");
  };
  try {
    memory.remember(workspaceId, "Project Marigold uses release code CEDAR-742.", "Owner approved", "adapter-outcome");
    await settle();
    expect((await memory.recall(workspaceId, "Marigold release code")).some(fact => /CEDAR-742/.test(fact.text))).toBe(true);
    await memory.command("memory_edit", { workspaceId, id: "adapter-outcome", content: "Project Marigold uses release code MAPLE-913." });
    await settle();
    const recalled = await memory.recall(workspaceId, "Marigold release code");
    expect(recalled.some(fact => /MAPLE-913/.test(fact.text))).toBe(true);
    expect(recalled.some(fact => /CEDAR-742/.test(fact.text))).toBe(false);
    await memory.command("memory_delete", { workspaceId, id: "adapter-outcome" });
    await settle();
    expect(await memory.recall(workspaceId, "Marigold release code")).toEqual([]);
  } finally {
    await memory.request(workspaceId, "", "DELETE");
    await memory.close();
    db.close();
  }
}, 150000);
