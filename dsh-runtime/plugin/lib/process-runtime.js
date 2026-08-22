import { fileURLToPath } from "node:url";
import { Context } from "@temporalio/activity";
import {
  Client, Connection, WorkflowExecutionAlreadyStartedError
} from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";

export const PROCESS_TASK_QUEUE = "bees-processes-v1";
export const processWorkflowId = (workItemId) => `bees/work-item/${workItemId}`;

const automaticDrivers = new Set(["agent", "review", "terminal"]);

export class ProcessRuntime {
  constructor(database, options = {}) {
    this.database = database;
    this.client = options.client;
    this.logger = options.logger ?? console;
  }

  item(workItemId) {
    const item = this.database.prepare(`
      SELECT w.id, w.process_id AS processId, w.stage_id AS stageId,
             w.runtime_phase AS runtimePhase, w.archived_at AS archivedAt,
             p.workspace_id AS workspaceId
      FROM work_items w JOIN processes p ON p.id = w.process_id
      WHERE w.id = ? AND w.deleted_at IS NULL
    `).get(workItemId);
    if (!item) throw new Error("Work item not found");
    return item;
  }

  stages(processId) {
    return this.database.prepare(`
      SELECT id, name, driver, completion_rules AS instructions, is_terminal AS isTerminal
      FROM stages WHERE process_id = ? AND archived_at IS NULL ORDER BY position
    `).all(processId).map((stage) => ({ ...stage, isTerminal: Boolean(stage.isTerminal) }));
  }

  input(workItemId) {
    const item = this.item(workItemId);
    const stages = this.stages(item.processId);
    if (!stages.length) throw new Error("Process has no stages");
    return { workItemId: item.id, processId: item.processId, stageId: item.stageId, stages, maxAttempts: 3 };
  }

  isAutomatic(processId) {
    const stages = this.stages(processId);
    return stages.length >= 2 && stages.at(-1).driver === "terminal" &&
      stages.every(({ driver }) => automaticDrivers.has(driver));
  }

  async start(runStage) {
    if (!this.client) {
      const address = process.env.BEES_TEMPORAL_ADDRESS;
      if (!address) throw new Error("bees: missing embedded Temporal address");
      this.connection = await Connection.connect({ address });
      this.workerConnection = await NativeConnection.connect({ address });
      this.client = new Client({ connection: this.connection, namespace: "default" });
      const projectWorkItem = (state) => this.project(state);
      const runDshStage = async (stage) => {
        const context = Context.current();
        const heartbeat = setInterval(() => context.heartbeat(), 10_000);
        heartbeat.unref();
        try {
          context.heartbeat();
          return await runStage(stage, context.cancellationSignal);
        } finally {
          clearInterval(heartbeat);
        }
      };
      this.worker = await Worker.create({
        connection: this.workerConnection,
        namespace: "default",
        taskQueue: PROCESS_TASK_QUEUE,
        workflowsPath: fileURLToPath(new URL("./process-workflow.js", import.meta.url)),
        activities: { projectWorkItem, runDshStage }
      });
      this.running = this.worker.run().catch((error) => this.logger.error?.(error));
    }
    await this.reconcile();
  }

  async close() {
    this.worker?.shutdown();
    await this.running;
    await this.workerConnection?.close();
    await this.connection?.close();
  }

  async reconcile() {
    const items = this.database.prepare(`
      SELECT w.id FROM work_items w
      WHERE w.deleted_at IS NULL AND w.archived_at IS NULL
        AND w.runtime_phase = 'ready'
    `).all();
    await Promise.all(items.map(({ id }) => this.startItem(id)));
  }

  async startItem(workItemId) {
    const input = this.input(workItemId);
    if (!this.isAutomatic(input.processId)) return { automatic: false };
    try {
      await this.client.workflow.start("processWorkflow", {
        taskQueue: PROCESS_TASK_QUEUE,
        workflowId: processWorkflowId(workItemId),
        args: [input]
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError) && error?.name !== "WorkflowExecutionAlreadyStartedError") {
        this.project({ ...input, phase: "failed", error: String(error?.message ?? error) });
        throw error;
      }
    }
    this.database.prepare(`
      UPDATE work_items SET runtime_phase = 'running', runtime_error = NULL, updated_at = ?
      WHERE id = ? AND runtime_phase = 'ready'
    `).run(new Date().toISOString(), workItemId);
    return { automatic: true, workflowId: processWorkflowId(workItemId) };
  }

  async signal(workItemId, type) {
    const item = this.item(workItemId);
    if (!this.isAutomatic(item.processId)) throw new Error("This process is manually driven");
    const allowed = {
      pause: ["running", "waiting"],
      resume: ["paused"],
      retry: ["failed"],
      cancel: ["running", "waiting", "paused", "failed"]
    };
    if (!allowed[type]?.includes(item.runtimePhase))
      throw new Error(`Cannot ${type} work while it is ${item.runtimePhase}`);
    const handle = this.client.workflow.getHandle(processWorkflowId(workItemId));
    if (type === "cancel") await handle.cancel();
    else await handle.signal(type);
    const phase = type === "pause" ? "paused" : type === "cancel" ? "cancelled" : "running";
    this.database.prepare(`
      UPDATE work_items SET runtime_phase = ?, runtime_error = NULL, updated_at = ? WHERE id = ?
    `).run(phase, new Date().toISOString(), workItemId);
    return { ...item, runtimePhase: phase };
  }

  move(workItemId, targetStageId) {
    const item = this.item(workItemId);
    if (this.isAutomatic(item.processId)) throw new Error("Temporal moves this process automatically");
    const result = this.database.prepare(`
      UPDATE work_items SET stage_id = ?, updated_at = ? WHERE id = ? AND process_id = ?
        AND EXISTS (SELECT 1 FROM stages WHERE id = ? AND process_id = ? AND archived_at IS NULL)
    `).run(targetStageId, new Date().toISOString(), workItemId, item.processId, targetStageId, item.processId);
    if (!result.changes) throw new Error("The stage does not belong to this process");
    return { ...item, stageId: targetStageId };
  }

  async archive(workItemId, restore = false) {
    const item = this.item(workItemId);
    if (!restore && this.isAutomatic(item.processId) && !["completed", "cancelled"].includes(item.runtimePhase)) {
      await this.signal(workItemId, "cancel");
    }
    const at = new Date().toISOString();
    this.database.prepare(`
      WITH RECURSIVE tree(id) AS (
        SELECT ? UNION SELECT w.id FROM work_items w JOIN tree ON w.parent_id = tree.id
        WHERE w.deleted_at IS NULL
      )
      UPDATE work_items SET archived_at = ?, updated_at = ? WHERE id IN (SELECT id FROM tree)
    `).run(workItemId, restore ? null : item.archivedAt ?? at, at);
    return { ...item, archivedAt: restore ? null : item.archivedAt ?? at };
  }

  project(state) {
    const stage = this.database.prepare(`
      SELECT 1 FROM stages WHERE id = ? AND process_id = ? AND archived_at IS NULL
    `).get(state.stageId, state.processId);
    if (!stage) throw new Error("The stage does not belong to this process");
    const result = this.database.prepare(`
      UPDATE work_items SET stage_id = ?, runtime_phase = ?, runtime_attempt = ?,
        runtime_review_cycle = ?, runtime_execution_id = ?, runtime_error = ?, updated_at = ?
      WHERE id = ? AND process_id = ? AND deleted_at IS NULL
    `).run(
      state.stageId, state.phase, Number(state.attempt ?? 0), Number(state.reviewCycle ?? 0),
      state.executionId ?? null, state.error ?? null, new Date().toISOString(),
      state.workItemId, state.processId
    );
    if (!result.changes) throw new Error("Work item not found");
    return state;
  }
}
