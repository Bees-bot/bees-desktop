import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { ApplicationFailure, Context } from "@temporalio/activity";
import {
  Client, Connection, WorkflowExecutionAlreadyStartedError
} from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { iso, message, transaction } from "./product-database.js";

export const PROCESS_TASK_QUEUE = "bees-processes-v1";
export const processWorkflowId = (workItemId) => `bees/work-item/${workItemId}`;
export const recurringScheduleId = (recurringWorkId) => `bees/recurring/${recurringWorkId}`;

const automaticDrivers = new Set(["agent", "review", "terminal"]);

export class ProcessRuntime {
  constructor(database, options = {}) {
    this.database = database;
    this.client = options.client;
    this.logger = options.logger ?? console;
    this.workerFactory = options.workerFactory;
  }

  item(workItemId) {
    const item = this.database.prepare(`
      SELECT w.id, w.process_id AS processId, w.stage_id AS stageId,
             w.runtime_phase AS runtimePhase, w.archived_at AS archivedAt,
             p.workspace_id AS workspaceId,
             EXISTS (SELECT 1 FROM recurring_work r WHERE r.source_work_item_id = w.id) AS scheduleDefinition
      FROM work_items w JOIN processes p ON p.id = w.process_id
      WHERE w.id = ? AND w.deleted_at IS NULL
    `).get(workItemId);
    if (!item) throw new Error("Work item not found");
    return { ...item, scheduleDefinition: Boolean(item.scheduleDefinition) };
  }

  stages(processId) {
    return this.database.prepare(`
      SELECT id, name, driver, is_terminal AS isTerminal
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
    const address = process.env.BEES_TEMPORAL_ADDRESS;
    if (!this.client) {
      if (!address) throw new Error("bees: missing embedded Temporal address");
      this.connection = await Connection.connect({ address });
      this.client = new Client({ connection: this.connection, namespace: "default" });
    }
    if (!this.worker && (address || this.workerFactory)) {
      this.workerConnection = this.workerFactory ? undefined : await NativeConnection.connect({ address });
      const projectWorkItem = (state) => this.project(state);
      const createRecurringWorkItem = async ({ recurringWorkId }) => {
        const work = this.createRecurringWorkItem(recurringWorkId);
        const recurring = this.recurring(recurringWorkId);
        await this.refreshNextRun(recurringWorkId, this.client.schedule.getHandle(recurring.temporalScheduleId));
        return work;
      };
      const runDshStage = async (stage) => {
        const context = Context.current();
        const heartbeat = setInterval(() => context.heartbeat(), 10_000);
        heartbeat.unref();
        try {
          context.heartbeat();
          return await runStage(stage, context.cancellationSignal);
        } catch (error) {
          if (context.cancellationSignal.aborted) throw error;
          const reason = message(error);
          if (error?.retryable) throw ApplicationFailure.retryable(reason, "DshStageFailure");
          throw ApplicationFailure.nonRetryable(reason, "DshStageFailure");
        } finally {
          clearInterval(heartbeat);
        }
      };
      const workerOptions = {
        connection: this.workerConnection,
        namespace: "default",
        taskQueue: PROCESS_TASK_QUEUE,
        workflowsPath: fileURLToPath(new URL("./process-workflow.js", import.meta.url)),
        activities: { projectWorkItem, createRecurringWorkItem, runDshStage }
      };
      this.worker = this.workerFactory
        ? await this.workerFactory(workerOptions)
        : await Worker.create(workerOptions);
      this.running = this.worker.run().catch((error) => this.logger.error?.(error));
    }
    await this.reconcile();
  }

  recurring(recurringWorkId) {
    const row = this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, process_id AS processId,
             source_work_item_id AS sourceWorkItemId, name,
             schedule_kind AS scheduleKind, schedule_json AS schedule,
             timezone, temporal_schedule_id AS temporalScheduleId, status
      FROM recurring_work WHERE id = ?
    `).get(recurringWorkId);
    if (!row) throw new Error("Recurring work not found");
    return { ...row, schedule: JSON.parse(row.schedule) };
  }

  scheduleSpec(recurring) {
    const schedule = recurring.schedule;
    if (recurring.scheduleKind === "interval") {
      const everyMinutes = Number(schedule.everyMinutes);
      if (!Number.isInteger(everyMinutes) || everyMinutes < 1 || everyMinutes > 525_600)
        throw new Error("Interval must be between 1 minute and 1 year");
      const every = everyMinutes * 60_000;
      const anchor = Date.parse(schedule.anchorUtc);
      if (!Number.isFinite(anchor)) throw new Error("Interval anchor must be a valid UTC time");
      return { intervals: [{ every, offset: ((anchor % every) + every) % every }] };
    }
    if (recurring.scheduleKind === "cron") {
      const expression = String(schedule.expression ?? "").trim();
      if (expression.split(/\s+/).length < 5 || expression.split(/\s+/).length > 7)
        throw new Error("Advanced schedules need a 5, 6, or 7 field cron expression");
      return { cronExpressions: [expression], timezone: recurring.timezone || "UTC" };
    }
    const calendar = { hour: Number(schedule.hour), minute: Number(schedule.minute) };
    if (!Number.isInteger(calendar.hour) || calendar.hour < 0 || calendar.hour > 23 ||
        !Number.isInteger(calendar.minute) || calendar.minute < 0 || calendar.minute > 59)
      throw new Error("Schedule time is invalid");
    if (schedule.frequency === "weekly") calendar.dayOfWeek = String(schedule.dayOfWeek);
    if (schedule.frequency === "monthly") calendar.dayOfMonth = Number(schedule.dayOfMonth);
    return { calendars: [calendar], timezone: recurring.timezone || "UTC" };
  }

  scheduleOptions(recurring) {
    return {
      scheduleId: recurring.temporalScheduleId,
      spec: this.scheduleSpec(recurring),
      action: {
        type: "startWorkflow", workflowType: "recurringWorkWorkflow",
        taskQueue: PROCESS_TASK_QUEUE, args: [{ recurringWorkId: recurring.id }]
      },
      policies: { overlap: "SKIP", catchupWindow: "1 minute", pauseOnFailure: true },
      state: { paused: recurring.status === "paused" },
      memo: { recurringWorkId: recurring.id, name: recurring.name }
    };
  }

  async refreshNextRun(recurringWorkId, handle) {
    try {
      const description = await handle.describe();
      const nextRunAt = description.info?.nextActionTimes?.[0]?.toISOString?.() ?? null;
      this.database.prepare("UPDATE recurring_work SET next_run_at = ?, updated_at = ? WHERE id = ?")
        .run(nextRunAt, iso(), recurringWorkId);
      return nextRunAt;
    } catch { return null; }
  }

  async createRecurring(recurringWorkId) {
    const recurring = this.recurring(recurringWorkId);
    const handle = await this.client.schedule.create(this.scheduleOptions(recurring));
    return { nextRunAt: await this.refreshNextRun(recurring.id, handle) };
  }

  async updateRecurring(recurringWorkId) {
    const recurring = this.recurring(recurringWorkId);
    const handle = this.client.schedule.getHandle(recurring.temporalScheduleId);
    const options = this.scheduleOptions(recurring);
    await handle.update((previous) => ({
      spec: options.spec, action: previous.action, policies: options.policies,
      state: { ...previous.state, paused: recurring.status === "paused" }
    }));
    return { nextRunAt: await this.refreshNextRun(recurring.id, handle) };
  }

  async setRecurringPaused(recurringWorkId, paused) {
    const recurring = this.recurring(recurringWorkId);
    const handle = this.client.schedule.getHandle(recurring.temporalScheduleId);
    if (paused) await handle.pause("Paused in Bees");
    else await handle.unpause("Resumed in Bees");
    await this.refreshNextRun(recurring.id, handle);
  }

  async deleteRecurring(recurringWorkId) {
    const recurring = this.recurring(recurringWorkId);
    await this.client.schedule.getHandle(recurring.temporalScheduleId).delete();
  }

  createRecurringWorkItem(recurringWorkId) {
    return transaction(this.database, () => {
      const recurring = this.recurring(recurringWorkId);
      if (recurring.status !== "active") throw new Error("Recurring work is paused");
      const source = this.database.prepare(`
        SELECT process_id AS processId, title, description, owner,
               agent_assignment_id AS agentAssignmentId, priority,
               output_location_id AS outputLocationId
        FROM work_items WHERE id = ? AND deleted_at IS NULL
      `).get(recurring.sourceWorkItemId);
      if (!source) throw new Error("The recurring work definition is unavailable");
      const stageId = this.database.prepare(`
        SELECT id FROM stages WHERE process_id = ? AND archived_at IS NULL ORDER BY position LIMIT 1
      `).get(source.processId)?.id;
      if (!stageId) throw new Error("Process has no stage");
      const id = randomUUID();
      const at = iso();
      this.database.prepare(`
        INSERT INTO work_items
          (id, process_id, stage_id, kind, title, description, owner, agent_assignment_id,
           priority, output_location_id, recurring_work_id, created_at, updated_at)
        VALUES (?, ?, ?, 'run', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, source.processId, stageId, source.title, source.description, source.owner,
        source.agentAssignmentId, source.priority, source.outputLocationId, recurring.id, at, at);
      this.database.prepare(`
        INSERT INTO work_item_locations
        SELECT ?, location_id, relative_path FROM work_item_locations WHERE work_item_id = ?
      `).run(id, recurring.sourceWorkItemId);
      return this.input(id);
    });
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
        AND NOT EXISTS (SELECT 1 FROM recurring_work r WHERE r.source_work_item_id = w.id)
    `).all();
    const interruptedWaits = this.database.prepare(`
      SELECT w.id FROM work_items w
      WHERE w.deleted_at IS NULL AND w.archived_at IS NULL
        AND w.runtime_phase = 'failed' AND lower(w.runtime_error) LIKE '%heartbeat timeout%'
    `).all();
    // One work item that cannot start must not reject startup: reconcile runs before the plugin
    // registers its routes, so a single bad row used to leave the app with no /healthz at all.
    for (const settled of await Promise.allSettled([
      ...items.map(({ id }) => this.startItem(id)),
      ...interruptedWaits.map(({ id }) => this.signal(id, "retry"))
    ])) {
      if (settled.status === "rejected")
        this.logger.warn?.(`bees: a work item failed to reconcile: ${message(settled.reason)}`);
    }
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
    if (!restore && item.scheduleDefinition && this.database.prepare(`
      SELECT 1 FROM recurring_work WHERE source_work_item_id = ? AND status = 'active'
    `).get(workItemId)) throw new Error("Pause recurring work before archiving its work item");
    if (!restore && this.isAutomatic(item.processId) && !["completed", "cancelled"].includes(item.runtimePhase)) {
      if (!item.scheduleDefinition) await this.signal(workItemId, "cancel");
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
