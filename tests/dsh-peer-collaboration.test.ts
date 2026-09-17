import { describe, expect, it } from "vitest";
import { WorkContext } from "../dsh-runtime/plugin/lib/work-context.js";
import { mountPeerCollaboration, assertPeersSettled } from "../dsh-runtime/plugin/lib/peer-collaboration.js";
import { itemContext } from "../dsh-runtime/plugin/lib/product-database.js";
import { NodeDatabase } from "./node-database.js";

function fixture() {
  const db = new NodeDatabase().connection;
  const stage = db.prepare("SELECT id, process_id AS processId FROM stages WHERE driver = 'agent' LIMIT 1").get() as { id: string; processId: string };
  for (const [id, parent] of [["root", null], ["peer", "root"]] as Array<[string, string | null]>) db.prepare(`INSERT INTO work_items
    (id, process_id, stage_id, parent_id, kind, title, runtime_phase, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'work', ?, 'running', 'now', 'now')`).run(id, stage.processId, stage.id, parent, id);
  const listeners = new Set<(event: any) => void>();
  const notify = (event: any) => { for (const listener of [...listeners]) listener(event); };
  const runtime: any = { database: db, workContext: new WorkContext(db, notify), peerWaiters: new Set(), notify,
    subscribe: (listener: any) => { listeners.add(listener); return () => listeners.delete(listener); } };
  runtime.workContext.pin("root-run", itemContext(db, "root"));
  runtime.workContext.pin("peer-run", itemContext(db, "peer"));
  const mount = (id: string) => {
    const tools: any[] = [], contexts: any[] = [];
    const variables: Record<string, () => string> = {};
    const expand = (text: string) => text.replace(/\{\{([a-z0-9_]+)\}\}/g, (_, name: string) => variables[name]!());
    mountPeerCollaboration(runtime, { tools: { register: (tool: any) => tools.push(tool) },
      systemPrompt: { variable: (name: string, provider: any) => { variables[name] = provider; },
        context: (value: any) => contexts.push({ ...value, text: () => expand(value.text) }) } },
      { workItemId: id, agentName: id }, `${id}-run`);
    return { tool: (name: string) => tools.find((tool) => tool.name === name), contexts };
  };
  return { db, runtime, mount, listeners };
}

describe("one peer collaboration path", () => {
  it("injects current shared context on every assembly and wakes a waiting peer on a message", async () => {
    const { db, mount, listeners } = fixture();
    const lead = mount("root"), peer = mount("peer");
    const signal = new AbortController().signal;
    const pending = peer.tool("bees_wait_for_peers").execute({ after: 0 }, { signal });
    await lead.tool("bees_share_update").execute({ kind: "decision", content: "Use supplied dates", target_id: "peer" }, { callId: "message-1" });
    const result = JSON.parse((await pending).result_json);
    expect(result.reason).toBe("message");
    expect(result.updates[0].content).toBe("Use supplied dates");
    expect(peer.contexts[0].text()).toContain("Use supplied dates");
    expect(listeners.size).toBe(0);
    db.close();
  });

  it("reports no progress when all peers are waiting and cleans up cancelled waits", async () => {
    const { db, runtime, mount, listeners } = fixture();
    runtime.peerWaiters.add("root");
    const peer = mount("peer");
    const controller = new AbortController();
    expect(JSON.parse((await peer.tool("bees_wait_for_peers").execute({}, { signal: controller.signal })).result_json).reason).toBe("no-progress");
    runtime.peerWaiters.clear();
    const pending = peer.tool("bees_wait_for_peers").execute({}, { signal: controller.signal });
    controller.abort(new Error("Stopped"));
    await expect(pending).rejects.toThrow("Stopped");
    expect(listeners.size).toBe(0); expect(runtime.peerWaiters.size).toBe(0);
    db.close();
  });

  it("requires completed peer contributions before the lead finishes", () => {
    const { db, runtime } = fixture();
    expect(() => assertPeersSettled(runtime, { workItemId: "root" })).toThrow("is running");
    db.prepare("UPDATE work_items SET runtime_phase = 'completed' WHERE id = 'peer'").run();
    expect(() => assertPeersSettled(runtime, { workItemId: "root" })).not.toThrow();
    expect(() => assertPeersSettled(runtime, { workItemId: "root", participantIds: ["missing"] })).toThrow("assigned participant");
    db.close();
  });
});
