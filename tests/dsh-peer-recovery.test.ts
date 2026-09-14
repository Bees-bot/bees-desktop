import { describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { BeesProduct } from "../dsh-runtime/plugin/lib/product.js";
import { ProcessRuntime, processWorkflowId } from "../dsh-runtime/plugin/lib/process-runtime.js";
import { assertPeersSettled } from "../dsh-runtime/plugin/lib/peer-collaboration.js";
import { NodeDatabase } from "./node-database.js";

async function fixture() {
  const db = new NodeDatabase().connection;
  const stage = db.prepare(`SELECT s.id, s.process_id AS processId, p.workspace_id AS workspaceId
    FROM stages s JOIN processes p ON p.id = s.process_id WHERE p.kind = 'goals' AND s.driver = 'agent'`).get() as any;
  for (const [id, parent, phase] of [["parent", null, "running"], ["failed", "parent", "failed"],
    ["replacement", "parent", "completed"], ["other", null, "running"]] as const) {
    db.prepare(`INSERT INTO work_items (id, process_id, stage_id, parent_id, title, runtime_phase,
      runtime_attempt, runtime_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'now', 'now')`)
      .run(id, stage.processId, stage.id, parent, id, phase, phase === "failed" ? "Peer crashed" : null);
  }
  const cancel = vi.fn(async () => { db.exec("UPDATE work_items SET runtime_phase = 'cancelled', runtime_error = 'Cancelled' WHERE id = 'failed'"); });
  const signal = vi.fn(async () => undefined);
  const result = vi.fn(async (): Promise<void> => undefined);
  const client = { workflow: { getHandle: vi.fn(() => ({ cancel, signal, result })) } };
  const processes = new ProcessRuntime(db, { client });
  const runtime: any = new AgentRuntime({ on: () => () => undefined, tools: { schemas: () => [] },
    agentPresets: { mount: async () => undefined } }, db);
  new BeesProduct(db, runtime, processes, tmpdir());
  const tools: any[] = [];
  await runtime.setup({ systemPrompt: { section: () => undefined, context: () => undefined },
    tools: { register: (tool: any) => tools.push(tool), restrict: () => undefined } }, {
    mode: "work", agentPresetId: "standard", mcpAccess: "none", mcpServers: [],
    workItemId: "parent", workspaceId: stage.workspaceId, grants: []
  }, "parent-run", tmpdir());
  const tool = tools.find(({ name }) => name === "bees_resolve_failed_work");
  const exec = { callId: "recovery", signal: new AbortController().signal,
    agent: { session: { id: "parent-session", header: {} } } };
  return { db, runtime, processes, tool, exec, cancel, signal, result, client };
}

describe("failed peer recovery", () => {
  it("unblocks the parent using an explicit completed replacement and preserves the crash without rerunning work", async () => {
    const h = await fixture();
    try {
      expect(() => assertPeersSettled(h.runtime, { workItemId: "parent" })).toThrow("bees_resolve_failed_work");
      const args = { work_item_id: "failed", replacement_work_item_id: "replacement",
        reason: "Reviewed the approved replacement: first is present in outputs/counter.md." };
      const recovered = JSON.parse((await h.tool.execute(args, h.exec)).result_json);
      expect(recovered).toMatchObject({ id: "failed", action: "superseded", replacementWorkItemId: "replacement",
        result: { id: "replacement", status: "completed" } });
      expect(() => assertPeersSettled(h.runtime, { workItemId: "parent" })).not.toThrow();
      expect(h.client.workflow.getHandle).toHaveBeenCalledWith(processWorkflowId("failed"));
      expect(h.cancel).toHaveBeenCalledTimes(1);
      expect(h.signal).not.toHaveBeenCalled();
      const audit = h.db.prepare("SELECT metadata_json AS metadata FROM dsh_audit_events WHERE event_type = 'peer-work-recovery'").get()!;
      expect(JSON.parse(String(audit.metadata))).toMatchObject({ error: "Peer crashed", replacementWorkItemId: "replacement", settled: true });
      expect(h.runtime.workContext.updates("parent").updates[0].content).toContain(args.reason);
      await h.tool.execute(args, h.exec);
      expect(h.cancel).toHaveBeenCalledTimes(1);
      expect(h.runtime.workContext.updates("parent").updates).toHaveLength(1);
      await expect(h.tool.execute({ work_item_id: args.work_item_id, reason: args.reason }, h.exec)).rejects.toThrow("another resolution");
    } finally { h.db.close(); }
  });

  it("retries the same failed child through Temporal and does not treat a running retry as complete", async () => {
    const h = await fixture();
    try {
      vi.spyOn(h.runtime, "waitForPeers").mockResolvedValue([{ id: "failed", status: "running" }]);
      const args = { work_item_id: "failed", reason: "Retry after the transient provider error." };
      expect(JSON.parse((await h.tool.execute(args, h.exec)).result_json)).toMatchObject({ action: "retry",
        result: { id: "failed", status: "running" } });
      expect(h.signal).toHaveBeenCalledWith("retry");
      expect(h.cancel).not.toHaveBeenCalled();
      expect(() => assertPeersSettled(h.runtime, { workItemId: "parent" })).toThrow("unfinished");
      await h.tool.execute(args, h.exec);
      expect(h.signal).toHaveBeenCalledTimes(1);
      h.db.exec("UPDATE work_items SET runtime_phase = 'completed' WHERE id = 'failed'");
      expect(() => assertPeersSettled(h.runtime, { workItemId: "parent" })).not.toThrow();
    } finally { h.db.close(); }
  });

  it.each(["running", "waiting", "failed", "cancelled"])("rejects a %s replacement without changing the failed child", async (phase) => {
    const h = await fixture();
    try {
      h.db.prepare("UPDATE work_items SET runtime_phase = ? WHERE id = 'replacement'").run(phase);
      await expect(h.tool.execute({ work_item_id: "failed", replacement_work_item_id: "replacement", reason: "Covered" }, h.exec))
        .rejects.toThrow("completed sibling");
      expect(h.cancel).not.toHaveBeenCalled();
      expect(h.processes.item("failed").runtimePhase).toBe("failed");
    } finally { h.db.close(); }
  });

  it("rejects unrelated, archived and self replacements, and recovery by another parent", async () => {
    const h = await fixture();
    try {
      const args = { work_item_id: "failed", replacement_work_item_id: "replacement", reason: "Covered" };
      h.db.exec("UPDATE work_items SET parent_id = 'other' WHERE id = 'replacement'");
      await expect(h.tool.execute(args, h.exec)).rejects.toThrow("completed sibling");
      h.db.exec("UPDATE work_items SET parent_id = 'parent', archived_at = 'now' WHERE id = 'replacement'");
      await expect(h.tool.execute(args, h.exec)).rejects.toThrow("completed sibling");
      await expect(h.tool.execute({ ...args, replacement_work_item_id: "failed" }, h.exec)).rejects.toThrow("completed sibling");
      await expect(h.runtime.subitemStore.resolveFailed({ parentId: "other", workItemId: "failed", reason: "Wrong parent", requestId: "foreign" }))
        .rejects.toThrow("Only this child's parent");
      expect(h.cancel).not.toHaveBeenCalled();
    } finally { h.db.close(); }
  });

  it("waits for cancellation to close before reporting resolution and can finish an interrupted receipt", async () => {
    const h = await fixture();
    try {
      let close!: () => void;
      h.result.mockImplementationOnce(() => new Promise<void>((resolve) => { close = resolve; }));
      const pending = h.processes.resolveFailedItem("failed", "Covered", "request", "replacement");
      await vi.waitFor(() => expect(h.result).toHaveBeenCalled());
      const audit = h.db.prepare("SELECT metadata_json AS metadata FROM dsh_audit_events WHERE id = 'peer-recovery:request'").get()!;
      expect(JSON.parse(String(audit.metadata)).settled).toBe(false);
      close();
      await pending;
      h.db.prepare("UPDATE dsh_audit_events SET metadata_json = ? WHERE id = 'peer-recovery:request'").run(String(audit.metadata));
      const restarted = new ProcessRuntime(h.db, { client: h.client });
      await expect(restarted.resolveFailedItem("failed", "Covered", "request", "replacement")).resolves.toMatchObject({ action: "superseded" });
      expect(h.cancel).toHaveBeenCalledTimes(1);
    } finally { h.db.close(); }
  });
});
