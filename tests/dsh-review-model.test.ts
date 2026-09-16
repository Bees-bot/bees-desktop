import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { BeesProduct } from "../dsh-runtime/plugin/lib/product.js";
import { NodeDatabase } from "./node-database.js";

it.each([false, true])("repairs a frozen Review model on retry (recovery=%s), preserving other run settings", async (recovery) => {
  const root = mkdtempSync(join(tmpdir(), "bees-review-model-"));
  const db = new NodeDatabase().connection;
  try {
    const agents = new AgentRuntime({ on: () => () => undefined,
      sessionPersistence: { open: async () => ({ read: async () => ({ events: [] }), close: async () => {} }) } }, db);
    const product = new BeesProduct(db, agents, { startItem: async () => ({}), isAutomatic: () => false }, root);
    const initial = await product.snapshot();
    const workspaceId = initial.workspaces[0].id;
    const reviewer = initial.assignments.find((a: any) => a.workspaceId === workspaceId && a.systemRole === "reviewer");
    const stages = initial.stages.filter((s: any) => s.processId === initial.processes.find((p: any) => p.workspaceId === workspaceId && p.kind === "goals").id);
    const work = stages.find((s: any) => s.driver === "agent");
    const review = stages.find((s: any) => s.driver === "review");
    const execute = vi.spyOn(agents, "executeStage").mockImplementation(async (id, payload) => {
      const data = payload.initialData;
      if (data) db.prepare(`INSERT OR IGNORE INTO execution_links
        (execution_id, workspace_id, work_item_id, agent_name, current_session_id, instance_uid,
         run_directory, config_json, status, created_at, updated_at)
        VALUES (?, ?, ?, 'bees-run', ?, ?, ?, ?, 'failed', '2026-01-01', '2026-01-01')`)
        .run(id, workspaceId, data.workItemId, id, id, payload.workspace, JSON.stringify(data));
      const selection = Object.hasOwn(payload, "refreshedModel") ? payload.refreshedModel : data?.model;
      if (selection === "local-openai/active") throw new Error("Connection error.");
      return { outcome: id.includes("review") ? "pass" : "candidate", summary: "Checked" };
    });
    vi.spyOn(agents, "needsRecovery").mockImplementation(() => recovery);
    for (const index of [1, 2]) {
      await product.command({ action: "edit_agent_assignment", agentAssignmentId: reviewer.id,
        model: "local-openai/active", reasoningEffort: "high", instructions: "Independent review" });
      const item = await product.command({ action: "create_goal", workspaceId, title: `Model repair ${index}` });
      const workerId = `work-${index}`;
      await expect(product.runProcessStage({ workItemId: item.id, stageId: work.id, executionId: workerId,
        purpose: "worker", stageName: "Work" })).resolves.toMatchObject({ outcome: "candidate" });
      const stage = { workItemId: item.id, stageId: review.id, executionId: `review-${index}`,
        candidateExecutionId: workerId, purpose: "reviewer", stageName: "Review", durableWaits: true };
      await expect(product.runProcessStage(stage)).rejects.toThrow("Connection error.");
      await product.command({ action: "edit_agent_assignment", agentAssignmentId: reviewer.id,
        model: "", reasoningEffort: "", instructions: "Changed after failure" });
      await expect(product.runProcessStage({ ...stage, retryRequest: 1 })).resolves.toMatchObject({ outcome: "pass" });
      const payload = execute.mock.calls.at(-1)![1];
      expect(payload).toMatchObject({ refreshedModel: null, refreshedReasoningEffort: null });
      if (recovery) expect(payload.initialData.instructions).toBe("Independent review");
      const frozen = db.prepare("SELECT agent_config_json AS config FROM agent_dispatches WHERE execution_id = ?").get(stage.executionId)!;
      expect(JSON.parse(String(frozen.config))).toMatchObject({ model: "local-openai/active", instructions: "Independent review" });
    }
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

it("preserves the provider error with Review, model and run identifiers in delivery and logs", async () => {
  const db = new NodeDatabase().connection;
  try {
    const warn = vi.fn();
    const runtime = new AgentRuntime({ on: () => () => undefined, logger: { warn } }, db);
    const workspace = db.prepare("SELECT id FROM workspaces LIMIT 1").get()!;
    db.prepare(`INSERT INTO execution_links (execution_id, workspace_id, agent_name, current_session_id,
      instance_uid, run_directory, config_json, status, created_at, updated_at)
      VALUES ('review', ?, 'bees-run', 'session', 'uid', '/tmp', ?, 'running', '2026-01-01', '2026-01-01')`)
      .run(String(workspace.id), JSON.stringify({ stagePurpose: "reviewer", agentName: "Bees reviewer", resolvedModel: "local-openai/active" }));
    db.exec(`INSERT INTO dsh_deliveries (delivery_id, execution_id, submission_id, created_at)
      VALUES ('delivery', 'review', 'submission', '2026-01-01')`);
    await (runtime as any).finish("review", "submission", "session", { dispose: async () => {} },
      { outcome: "failed", error: { code: "TRANSPORT", message: "Connection error." } });
    const error = JSON.parse(String(db.prepare("SELECT error_json FROM dsh_deliveries").get()!.error_json));
    expect(error.code).toBe("TRANSPORT");
    expect(error.message).toContain("reviewer (Bees reviewer) using local-openai/active: Connection error.");
    expect(error.message).toContain("Settings → AI");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("execution=review session=session code=TRANSPORT"));
    expect(JSON.parse(String(db.prepare("SELECT metadata_json FROM dsh_audit_events WHERE event_type = 'run-failed'").get()!.metadata_json)).error).toBe(error.message);
    await (runtime as any).finish("review", "submission", "session", { dispose: async () => {} },
      { outcome: "cancelled", error: { message: "Stopped by user" } });
    expect(JSON.parse(String(db.prepare("SELECT error_json FROM dsh_deliveries").get()!.error_json)).message).toBe("Stopped by user");
  } finally { db.close(); }
});
