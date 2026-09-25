import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { ApplicationFailure, Context } from "@temporalio/activity";
import {
  Client, Connection, WorkflowExecutionAlreadyStartedError
} from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { iso, message, transaction } from "./product-database.js";
import { step } from "./startup.js";

export const PROCESS_TASK_QUEUE = "bees-processes-v1";
export const processWorkflowId = (workItemId) => `bees/work-item/${workItemId}`;
export const recurringScheduleId = (recurringWorkId, accountUserId = "") =>
  `bees/recurring/${recurringWorkId}${accountUserId ? `/identity/${accountUserId}` : ""}`;

const automaticDrivers = new Set(["agent", "discussion", "review", "terminal"]);

export class ProcessRuntime {
  constructor(database, options = {}) {
    this.database = database;
    this.client = options.client;
    this.logger = options.logger ?? console;
    this.workerFactory = options.workerFactory;
    this.claims = options.claims;
    this.abortAgent = options.abortAgent;
    this.notify = options.notify ?? (() => {});
    this.claimWatchers = new Map();
    this.scheduledLeases = new Map();
    this.needsRecovery = options.needsRecovery ?? (() => false);
    this.pendingInteraction = options.pendingInteraction ?? (() => null);
    this.canStart = options.canStart ?? (() => ({ ready: true }));
    this.database.exec(`CREATE TABLE IF NOT EXISTS bees_stage_waits (
      work_item_id TEXT PRIMARY KEY REFERENCES work_items(id) ON DELETE CASCADE,
      execution_id TEXT NOT NULL
    ) STRICT`);
  }

  item(workItemId) {
    const item = this.database.prepare(`
      SELECT w.id, w.process_id AS processId, w.stage_id AS stageId,
             w.runtime_phase AS runtimePhase, w.archived_at AS archivedAt,
             w.account_user_id AS accountUserId, w.parent_id AS parentId,
             w.runtime_attempt AS attempt,
             w.runtime_execution_id AS executionId,
             w.runtime_error AS error,
             p.workspace_id AS workspaceId, ws.team_id AS teamId,
             EXISTS (SELECT 1 FROM recurring_work r WHERE r.source_work_item_id = w.id) AS scheduleDefinition
      FROM work_items w JOIN processes p ON p.id = w.process_id
      JOIN workspaces ws ON ws.id = p.workspace_id
      WHERE w.id = ? AND w.deleted_at IS NULL
    `).get(workItemId);
    if (!item) throw new Error("Work item not found");
    return { ...item, scheduleDefinition: Boolean(item.scheduleDefinition) };
  }

  stages(processId) {
    return this.database.prepare(`
      SELECT id, name, driver, requires_human_approval AS requiresHumanApproval,
             is_terminal AS isTerminal
      FROM stages WHERE process_id = ? AND archived_at IS NULL ORDER BY position
    `).all(processId).map((stage) => ({ ...stage,
      requiresHumanApproval: Boolean(stage.requiresHumanApproval), isTerminal: Boolean(stage.isTerminal) }));
  }

  input(workItemId) {
    const item = this.item(workItemId);
    const stages = this.stages(item.processId);
    if (!stages.length) throw new Error("Process has no stages");
    const correction = item.parentId && item.attempt > 0 ? this.database.prepare(`
      SELECT metadata_json AS metadata FROM dsh_audit_events
      WHERE event_type = 'peer-work-correction' AND json_extract(metadata_json, '$.workItemId') = ?
      ORDER BY rowid DESC LIMIT 1
    `).get(item.id) : null;
    return {
      workItemId: item.id, processId: item.processId, stageId: item.stageId,
      accountUserId: item.accountUserId ?? "", stages, maxAttempts: 3,
      parentReview: Boolean(item.parentId),
      // Its own field so runs already in flight replay on the path they started with.
      peerAssignment: Boolean(item.parentId),
      ...(correction ? { correction: JSON.parse(correction.metadata) } : {})
    };
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
      this.connection = await step("temporal.client.connect", () => Connection.connect({ address }));
      this.client = new Client({ connection: this.connection, namespace: "default" });
    }
    if (!this.worker && (address || this.workerFactory)) {
      this.workerConnection = this.workerFactory ? undefined : await step("temporal.worker.connect", () => NativeConnection.connect({ address }));
      const projectWorkItem = (state) => this.project(state);
      const createRecurringWorkItem = async ({ recurringWorkId, occurrenceAt, accountUserId = "" }) => {
        const work = await this.createRecurringWorkItem(recurringWorkId, occurrenceAt, accountUserId);
        if (!work) return null;
        // a failed run no longer holds its schedule, so the next run replaces it instead of piling up
        for (const { id } of this.database.prepare(`
          SELECT id FROM work_items
          WHERE recurring_work_id = ? AND parent_id IS NULL AND coalesce(account_user_id, '') = ? AND runtime_phase = 'failed'
        `).all(recurringWorkId, accountUserId))
          await this.client.workflow.getHandle(processWorkflowId(id)).cancel().catch(() => undefined);
        const recurring = this.recurring(recurringWorkId, accountUserId);
        await this.refreshNextRun(
          recurringWorkId, accountUserId, this.client.schedule.getHandle(recurring.temporalScheduleId)
        );
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
          throw ApplicationFailure.nonRetryable(reason, "DshStageFailure");
        } finally {
          clearInterval(heartbeat);
        }
      };
      const workerOptions = {
        connection: this.workerConnection,
        namespace: "default",
        taskQueue: PROCESS_TASK_QUEUE,
        maxHeartbeatThrottleInterval: "10 seconds",
        workflowsPath: fileURLToPath(new URL("./process-workflow.js", import.meta.url)),
        activities: { projectWorkItem, createRecurringWorkItem, runDshStage }
      };
      this.worker = await step("temporal.worker.create-and-bundle", () => this.workerFactory
        ? this.workerFactory(workerOptions)
        : Worker.create(workerOptions));
      this.running = this.worker.run().catch((error) => this.logger.error?.(error));
    }
    await step("temporal.reconcile", () => this.reconcile());
  }

  recurring(recurringWorkId, accountUserId = "") {
    const row = this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, process_id AS processId,
             source_work_item_id AS sourceWorkItemId, name,
             schedule_kind AS scheduleKind, schedule_json AS schedule,
             timezone, temporal_schedule_id AS temporalScheduleId, status,
             (SELECT team_id FROM workspaces WHERE id = recurring_work.workspace_id) AS teamId
      FROM recurring_work WHERE id = ?
    `).get(recurringWorkId);
    if (!row) throw new Error("Recurring work not found");
    return {
      ...row, accountUserId, temporalScheduleId: recurringScheduleId(row.id, accountUserId),
      schedule: JSON.parse(row.schedule)
    };
  }

  executorAccounts(recurringWorkId) {
    // a shared schedule runs as the account whose item was scheduled, on whichever of that person's
    // devices is connected here: their servers and sign-ins live there. every other member's device
    // would fire the same tick under its own account and the server keeps claims per account, so two
    // devices meant two runs. a schedule from before this had no owner and still runs for everyone.
    const connected = this.database.prepare(`
      SELECT DISTINCT c.account_user_id AS accountUserId
      FROM recurring_work r JOIN workspaces w ON w.id = r.workspace_id
      LEFT JOIN work_items d ON d.id = r.source_work_item_id
      JOIN bees_connection_teams ct ON ct.team_id = w.team_id
      JOIN bees_connections c ON c.id = ct.connection_id
        AND c.account_user_id = COALESCE(d.account_user_id, c.account_user_id)
      WHERE r.id = ? ORDER BY c.account_user_id
    `).all(recurringWorkId).map(({ accountUserId }) => accountUserId);
    if (connected.length) return connected;
    const local = this.database.prepare(`
      SELECT 1 FROM recurring_work r JOIN workspaces w ON w.id = r.workspace_id
      JOIN teams t ON t.id = w.team_id JOIN organizations o ON o.id = t.organization_id
      WHERE r.id = ? AND o.personal = 1
    `).get(recurringWorkId);
    return local ? [""] : [];
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
        taskQueue: PROCESS_TASK_QUEUE,
        args: [{ recurringWorkId: recurring.id, accountUserId: recurring.accountUserId }]
      },
      policies: { overlap: "SKIP", catchupWindow: "1 minute" },
      state: { paused: recurring.status === "paused" },
      memo: {
        recurringWorkId: recurring.id,
        accountUserId: recurring.accountUserId,
        name: recurring.name
      }
    };
  }

  async refreshNextRun(recurringWorkId, accountUserId, handle) {
    try {
      const description = await handle.describe();
      const nextRunAt = description.info?.nextActionTimes?.[0]?.toISOString?.() ?? null;
      this.database.prepare(`
        UPDATE bees_recurring_executors SET next_run_at = ?
        WHERE recurring_work_id = ? AND account_user_id = ?
      `).run(nextRunAt, recurringWorkId, accountUserId);
      this.refreshAggregateNextRun(recurringWorkId);
      return nextRunAt;
    } catch { return null; }
  }

  refreshAggregateNextRun(recurringWorkId) {
    this.database.prepare(`
      UPDATE recurring_work SET next_run_at = (
        SELECT min(next_run_at) FROM bees_recurring_executors WHERE recurring_work_id = ?
      ) WHERE id = ?
    `).run(recurringWorkId, recurringWorkId);
  }

  async ensureRecurringExecutor(recurringWorkId, accountUserId) {
    const recurring = this.recurring(recurringWorkId, accountUserId);
    const existing = this.database.prepare(`
      SELECT 1 FROM bees_recurring_executors
      WHERE recurring_work_id = ? AND account_user_id = ?
    `).get(recurring.id, accountUserId);
    this.database.prepare(`
      INSERT INTO bees_recurring_executors
        (recurring_work_id, account_user_id, temporal_schedule_id, next_run_at)
      VALUES (?, ?, ?, NULL)
      ON CONFLICT(recurring_work_id, account_user_id) DO UPDATE SET
        temporal_schedule_id = excluded.temporal_schedule_id
    `).run(recurring.id, accountUserId, recurring.temporalScheduleId);
    const handle = this.client.schedule.getHandle(recurring.temporalScheduleId);
    const options = this.scheduleOptions(recurring);
    if (!existing) await this.client.schedule.create(options);
    else try {
      await handle.describe();
      await handle.update((previous) => ({
        spec: options.spec, action: options.action, policies: options.policies,
        state: { ...previous.state, paused: recurring.status === "paused" },
        memo: options.memo
      }));
    } catch {
      await this.client.schedule.create(options);
    }
    return this.refreshNextRun(recurring.id, accountUserId, handle);
  }

  async reconcileRecurring(recurringWorkId) {
    const eligible = new Set(this.executorAccounts(recurringWorkId));
    const existing = this.database.prepare(`
      SELECT account_user_id AS accountUserId, temporal_schedule_id AS temporalScheduleId
      FROM bees_recurring_executors WHERE recurring_work_id = ?
    `).all(recurringWorkId);
    for (const executor of existing) if (!eligible.has(executor.accountUserId)) {
      // Keep the local row only if the schedule is still out there, so reconciliation can retry it.
      await this.client.schedule.getHandle(executor.temporalScheduleId).delete()
        .catch((error) => { this.logger.warn?.(`bees: a Temporal schedule would not delete: ${message(error)}`); });
      this.database.prepare(`
        DELETE FROM bees_recurring_executors WHERE recurring_work_id = ? AND account_user_id = ?
      `).run(recurringWorkId, executor.accountUserId);
    }
    const nextRuns = [];
    for (const accountUserId of eligible)
      nextRuns.push(await this.ensureRecurringExecutor(recurringWorkId, accountUserId));
    this.refreshAggregateNextRun(recurringWorkId);
    return { nextRunAt: nextRuns.filter(Boolean).sort()[0] ?? null };
  }

  createRecurring(recurringWorkId) {
    return this.reconcileRecurring(recurringWorkId);
  }

  updateRecurring(recurringWorkId) {
    return this.reconcileRecurring(recurringWorkId);
  }

  async setRecurringPaused(recurringWorkId, paused) {
    for (const executor of this.database.prepare(`
      SELECT account_user_id AS accountUserId, temporal_schedule_id AS temporalScheduleId
      FROM bees_recurring_executors WHERE recurring_work_id = ?
    `).all(recurringWorkId)) {
      const handle = this.client.schedule.getHandle(executor.temporalScheduleId);
      if (paused) await handle.pause("Paused in Bees");
      else await handle.unpause("Resumed in Bees");
      await this.refreshNextRun(recurringWorkId, executor.accountUserId, handle);
    }
  }

  async createRecurringWorkItem(recurringWorkId, occurrenceAt = "", accountUserId = "") {
    const recurring = this.recurring(recurringWorkId, accountUserId);
    const claim = this.claims
      ? await this.claims.acquire(
          "schedule_occurrence", recurringWorkId, recurring.teamId, occurrenceAt, accountUserId
        )
      : { local: true };
    if (!claim) return null;
    const work = transaction(this.database, () => {
      if (recurring.status !== "active") throw new Error("Recurring work is paused");
      const source = this.database.prepare(`
        SELECT process_id AS processId, title, description, owner,
               agent_assignment_id AS agentAssignmentId, agent_ids_json AS agentIds, priority,
               output_location_id AS outputLocationId, run_settings_json AS runSettingsJson
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
           agent_ids_json, priority, output_location_id, recurring_work_id, account_user_id, created_at, updated_at)
        VALUES (?, ?, ?, 'run', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, source.processId, stageId, source.title, source.description, source.owner,
        source.agentAssignmentId, source.agentIds, source.priority, source.outputLocationId, recurring.id, accountUserId || null, at, at);
      this.database.prepare("UPDATE work_items SET run_settings_json = ? WHERE id = ?")
        .run(source.runSettingsJson, id);
      this.database.prepare(`
        INSERT INTO work_item_locations
        SELECT ?, location_id, relative_path FROM work_item_locations WHERE work_item_id = ?
      `).run(id, recurring.sourceWorkItemId);
      return this.input(id);
    });
    // the server refuses a lease on a run it has not seen, and then the schedule stops holding the run
    await this.claims?.publish();
    // only the lease holder runs it; refused or unreachable, the run waits and a later sync starts it wherever the lease goes
    const lease = await this.claims?.acquire("work_item", work.workItemId, recurring.teamId, "", accountUserId)
      .catch(() => null);
    if (lease === null) return null;
    if (lease) this.scheduledLeases.set(work.workItemId, lease);
    return work;
  }

  async close() {
    this.closing = true;
    const claims = [...this.claimWatchers.values()];
    this.claimWatchers.clear();
    for (const watcher of claims) clearInterval(watcher.heartbeat);
    await Promise.allSettled(claims.map(({ claim }) => this.claims?.release(claim)));
    this.worker?.shutdown();
    await this.running;
    await this.workerConnection?.close();
    await this.connection?.close();
  }

  async reconcile() {
    const schedules = this.database.prepare(
      "SELECT id FROM recurring_work ORDER BY created_at"
    ).all();
    for (const settled of await Promise.allSettled(schedules.map(async ({ id }) => {
      await this.reconcileRecurring(id);
    }))) if (settled.status === "rejected")
      this.logger.warn?.(`bees: a recurring schedule failed to reconcile: ${message(settled.reason)}`);
    const items = this.database.prepare(`
      SELECT w.id, w.runtime_phase AS phase, w.runtime_execution_id AS executionId,
             EXISTS (SELECT 1 FROM bees_stage_waits h WHERE h.work_item_id = w.id) AS humanWait
      FROM work_items w
      WHERE w.deleted_at IS NULL AND w.archived_at IS NULL
        AND (w.runtime_phase IN ('ready', 'running', 'waiting', 'paused')
          OR w.runtime_phase = 'failed' AND lower(w.runtime_error) LIKE '%heartbeat timeout%')
        AND EXISTS (
          SELECT 1 FROM processes p JOIN workspaces ws ON ws.id = p.workspace_id
          JOIN teams t ON t.id = ws.team_id JOIN organizations o ON o.id = t.organization_id
          WHERE p.id = w.process_id AND (
            (o.personal = 1 AND w.account_user_id IS NULL)
            OR EXISTS (
              SELECT 1 FROM bees_connections c
              JOIN bees_connection_teams ct ON ct.connection_id = c.id AND ct.team_id = t.id
              JOIN bees_accounts a ON a.user_id = c.account_user_id AND a.enabled = 1
            )
          )
        )
        AND NOT EXISTS (SELECT 1 FROM recurring_work r WHERE r.source_work_item_id = w.id)
        AND NOT (w.runtime_phase = 'ready' AND EXISTS (SELECT 1 FROM bees_work_receipts r
          WHERE r.work_item_id = w.id AND r.idempotency_key LIKE 'proposal:%'))
    `).all();
    // One work item that cannot start must not reject startup: reconcile runs before the plugin
    // registers its routes, so a single bad row used to leave the app with no /healthz at all.
    for (const settled of await Promise.allSettled(items.map(async ({ id, phase, executionId, humanWait }) => {
      const started = await this.startItem(id);
      if (!started.claimed) return;
      if (phase === "failed") await this.signal(id, "retry");
      else if (humanWait && phase !== "paused" &&
        (this.needsRecovery(executionId) || !this.pendingInteraction(executionId)))
        await this.wakeStage(executionId);
    }))) {
      if (settled.status === "rejected")
        this.logger.warn?.(`bees: a work item failed to reconcile: ${message(settled.reason)}`);
    }
  }

  async wakeStage(executionId) {
    if (this.closing) return;
    const wait = this.database.prepare(`
      SELECT h.work_item_id AS workItemId FROM bees_stage_waits h
      JOIN work_items w ON w.id = h.work_item_id
      WHERE h.execution_id = ? AND w.runtime_execution_id = h.execution_id
        AND w.runtime_phase IN ('running', 'waiting', 'paused')
        AND w.deleted_at IS NULL AND w.archived_at IS NULL
    `).get(executionId);
    if (wait) await this.client.workflow.getHandle(processWorkflowId(wait.workItemId))
      .signal("stageChanged", executionId);
  }

  async startItem(workItemId) {
    const input = this.input(workItemId);
    if (!this.isAutomatic(input.processId)) return { automatic: false };
    const readiness = await this.canStart(workItemId);
    if (!readiness?.ready) return {
      automatic: true, claimed: false, waitingFor: readiness?.reason ?? "This device is not ready"
    };
    const claimKey = `work-item:${workItemId}`;
    if (this.claimWatchers.has(claimKey)) {
      return { automatic: true, workflowId: processWorkflowId(workItemId), claimed: true };
    }
    const scheduled = this.scheduledLeases.get(workItemId);
    this.scheduledLeases.delete(workItemId);
    // a parked lease may have lapsed while this waited, so confirm it is still ours before running
    const claim = scheduled ? await this.claims.renew(scheduled) : (this.claims
      ? await this.claims.acquire(
          "work_item", workItemId, this.item(workItemId).teamId, "", input.accountUserId ?? ""
        )
      : { local: true });
    if (!claim) return { automatic: true, claimed: false };
    let handle;
    try {
      handle = await this.client.workflow.start("processWorkflow", {
        taskQueue: PROCESS_TASK_QUEUE,
        workflowId: processWorkflowId(workItemId),
        args: [input]
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError) && error?.name !== "WorkflowExecutionAlreadyStartedError") {
        await this.claims?.release(claim).catch(() => undefined);
        this.project({ ...input, phase: "failed", error: String(error?.message ?? error) });
        throw error;
      }
      handle = this.client.workflow.getHandle(processWorkflowId(workItemId));
    }
    this.database.prepare(`
      UPDATE work_items SET runtime_phase = 'running', runtime_error = NULL, updated_at = ?
      WHERE id = ? AND runtime_phase = 'ready'
    `).run(new Date().toISOString(), workItemId);
    this.notify({ type: "workflow-started", workItemId });
    this.watchClaim(claimKey, claim, handle);
    return { automatic: true, workflowId: processWorkflowId(workItemId), claimed: true };
  }

  /** A parent correction starts a fresh attempt after the previous workflow has closed. */
  async reviseItem(workItemId, feedback, requestId, signal) {
    signal?.throwIfAborted();
    const receiptId = `peer-correction:${requestId}`;
    const receipt = this.database.prepare("SELECT metadata_json AS metadata FROM dsh_audit_events WHERE id = ?").get(receiptId);
    if (receipt) {
      if (JSON.parse(receipt.metadata).workItemId !== workItemId)
        throw new Error("This correction request belongs to another child");
      if (this.item(workItemId).runtimePhase === "ready") await this.startItem(workItemId);
      return { id: workItemId };
    }
    const item = this.item(workItemId);
    if (!item.parentId || item.runtimePhase !== "completed" || item.archivedAt)
      throw new Error("Only completed delegated work can be corrected");
    // The completed projection precedes Temporal closing the workflow and releasing its claim.
    await this.client.workflow.getHandle(processWorkflowId(workItemId)).result();
    await this.claimWatchers.get(`work-item:${workItemId}`)?.settled;
    signal?.throwIfAborted();
    const first = this.stages(item.processId).find(({ driver }) => ["agent", "discussion"].includes(driver));
    if (!first) throw new Error("Delegated work has no work stage");
    transaction(this.database, () => {
      const current = this.item(workItemId);
      const parent = this.item(current.parentId);
      if (["cancelled", "completed", "failed"].includes(parent.runtimePhase) || parent.archivedAt)
        throw new Error("The parent is no longer running");
      if (current.runtimePhase !== "completed" || current.attempt !== item.attempt || current.archivedAt)
        throw new Error("This child already received a correction; inspect its current result");
      const prior = this.database.prepare(`
        SELECT e.execution_id AS executionId FROM execution_links e JOIN bees_stage_results r
          ON r.execution_id = e.execution_id
        WHERE e.work_item_id = ? AND r.purpose = 'worker' ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1
      `).get(workItemId);
      const correction = { workItemId, attempt: Number(item.attempt) + 1, feedback,
        candidateExecutionId: prior?.executionId ?? null };
      this.database.prepare(`INSERT INTO dsh_audit_events
        (id, event_type, metadata_json, created_at) VALUES (?, 'peer-work-correction', ?, ?)
      `).run(receiptId, JSON.stringify(correction), iso());
      this.database.prepare(`UPDATE work_items SET stage_id = ?, runtime_phase = 'ready',
        runtime_attempt = ?, runtime_error = NULL, updated_at = ? WHERE id = ?
      `).run(first.id, correction.attempt, iso(), workItemId);
    });
    await this.startItem(workItemId);
    return { id: workItemId };
  }

  /** Recover a failed child explicitly, preserving the failure and replacement in the audit log. */
  async resolveFailedItem(workItemId, reason, requestId, replacementWorkItemId = null, signal) {
    signal?.throwIfAborted();
    const receiptId = `peer-recovery:${requestId}`;
    const saved = this.database.prepare("SELECT metadata_json AS metadata FROM dsh_audit_events WHERE id = ?").get(receiptId);
    let receipt = saved ? JSON.parse(saved.metadata) : null;
    if (receipt && (receipt.workItemId !== workItemId || receipt.replacementWorkItemId !== replacementWorkItemId || receipt.reason !== reason))
      throw new Error("This recovery request belongs to another resolution");
    const item = this.item(workItemId);
    if (!item.parentId || item.archivedAt || (!receipt && item.runtimePhase !== "failed"))
      throw new Error("Only failed delegated work can be recovered");
    const parent = this.item(item.parentId);
    if (["cancelled", "completed", "failed"].includes(parent.runtimePhase) || parent.archivedAt)
      throw new Error("The parent is no longer running");
    if (replacementWorkItemId) {
      const replacement = this.item(replacementWorkItemId);
      if (replacement.id === item.id || replacement.parentId !== item.parentId ||
          replacement.workspaceId !== item.workspaceId || replacement.runtimePhase !== "completed" || replacement.archivedAt)
        throw new Error("The replacement must be a completed sibling of the failed child");
    }
    if (!receipt) {
      receipt = { workItemId, replacementWorkItemId, reason, attempt: item.attempt,
        executionId: item.executionId, error: item.error, settled: false };
      this.database.prepare(`INSERT INTO dsh_audit_events (id, event_type, metadata_json, created_at)
        VALUES (?, 'peer-work-recovery', ?, ?)`).run(receiptId, JSON.stringify(receipt), iso());
    }
    if (!receipt.settled) {
      if (replacementWorkItemId) {
        if (item.runtimePhase === "failed") await this.signal(workItemId, "cancel");
        else if (item.runtimePhase !== "cancelled") throw new Error("The failed child has already resumed");
        // Failed workflows are still open, waiting for retry. Close them and release their claim.
        await this.client.workflow.getHandle(processWorkflowId(workItemId)).result();
        await this.claimWatchers.get(`work-item:${workItemId}`)?.settled;
        if (this.item(workItemId).runtimePhase !== "cancelled")
          throw new Error("The failed child has not finished cancellation");
      } else if (item.runtimePhase === "failed" && item.attempt === receipt.attempt) {
        await this.signal(workItemId, "retry");
      }
      receipt.settled = true;
      this.database.prepare("UPDATE dsh_audit_events SET metadata_json = ? WHERE id = ?")
        .run(JSON.stringify(receipt), receiptId);
      this.notify({ type: "peer-work-recovered", workItemId, replacementWorkItemId });
    }
    return { id: workItemId, action: replacementWorkItemId ? "superseded" : "retry", replacementWorkItemId };
  }

  watchClaim(key, claim, handle) {
    if (claim.local || !this.claims || typeof handle?.result !== "function") return;
    let renewing = false;
    const heartbeat = setInterval(async () => {
      if (renewing) return;
      renewing = true;
      try {
        if (!await this.claims.renew(claim)) await handle.cancel();
      } catch (error) {
        // A 4xx is the server saying this claim is not ours any more, so the work must stop. Any
        // other failure is our own connection: cancelling on that threw away a waiting run.
        if (error?.status >= 400 && error?.status < 500) await handle.cancel().catch(() => undefined);
        this.logger.warn?.(`bees: execution claim heartbeat failed: ${message(error)}`);
      } finally { renewing = false; }
    }, 20_000);
    heartbeat.unref();
    const watcher = { claim, heartbeat, settled: null };
    this.claimWatchers.set(key, watcher);
    watcher.settled = handle.result().catch(() => undefined).finally(async () => {
      const current = this.claimWatchers.get(key);
      if (current?.claim !== claim) return;
      clearInterval(heartbeat);
      await this.claims.release(claim).catch((error) =>
        this.logger.warn?.(`bees: execution claim release failed: ${message(error)}`));
      this.claimWatchers.delete(key);
    });
  }

  async signal(workItemId, type, message) {
    const item = this.item(workItemId);
    if (!this.isAutomatic(item.processId)) throw new Error("This process is manually driven");
    const allowed = {
      start: ["ready"],
      pause: ["running", "waiting"],
      resume: ["paused"],
      retry: ["failed"],
      cancel: ["running", "waiting", "paused", "failed"]
    };
    if (!allowed[type]?.includes(item.runtimePhase))
      throw new Error(`Cannot ${type} work while it is ${item.runtimePhase}`);
    if (type === "start") return this.startItem(workItemId);
    const handle = this.client.workflow.getHandle(processWorkflowId(workItemId));
    if (type === "cancel") {
      // Stop local model/tool execution now, without waiting for Temporal's next heartbeat.
      // Temporal still owns the workflow's final cancellation projection.
      if (item.executionId) this.abortAgent?.(item.executionId);
      await handle.cancel();
      return item;
    }
    await handle.signal(type, ...(message ? [message] : []));
    const phase = type === "pause" ? "paused" : "running";
    this.database.prepare(`
      UPDATE work_items SET runtime_phase = ?, runtime_error = NULL, updated_at = ? WHERE id = ?
    `).run(phase, new Date().toISOString(), workItemId);
    return { ...item, runtimePhase: phase };
  }

  async archive(workItemId, restore = false) {
    const item = this.item(workItemId);
    if (!restore && item.scheduleDefinition && this.database.prepare(`
      SELECT 1 FROM recurring_work WHERE source_work_item_id = ? AND status = 'active'
    `).get(workItemId)) throw new Error("Pause recurring work before archiving its work item");
    // Archiving hides the whole tree, so delegated work still in flight has to stop with it.
    // Cancelling only the root left a child running behind a screen nobody could see.
    // One child whose cancel fails must not abort the archival: the rest of the tree would stay
    // running behind a screen nobody can see, which is the thing cancelling here exists to prevent.
    if (!restore) for (const id of this.cancellableTree(workItemId)) {
      try { await this.signal(id, "cancel"); }
      catch (error) { this.logger.warn?.(`bees: could not cancel ${id} while archiving: ${message(error)}`); }
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

  /** Work in this tree that archiving must stop: automatic, unscheduled, and in a phase cancel accepts. */
  cancellableTree(workItemId) {
    return this.database.prepare(`
      WITH RECURSIVE tree(id) AS (
        SELECT ? UNION SELECT w.id FROM work_items w JOIN tree ON w.parent_id = tree.id
        WHERE w.deleted_at IS NULL
      )
      SELECT w.id, w.process_id AS processId FROM work_items w JOIN tree ON tree.id = w.id
      WHERE w.runtime_phase IN ('running', 'waiting', 'paused', 'failed')
        AND NOT EXISTS (SELECT 1 FROM recurring_work r WHERE r.source_work_item_id = w.id)
    `).all(workItemId).filter(({ processId }) => this.isAutomatic(processId)).map(({ id }) => id);
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
    `);
    transaction(this.database, () => {
      const updated = result.run(
        state.stageId, state.phase, Number(state.attempt ?? 0), Number(state.reviewCycle ?? 0),
        state.executionId ?? null, state.error ?? null, new Date().toISOString(),
        state.workItemId, state.processId
      );
      if (!updated.changes) throw new Error("Work item not found");
      if (state.waitingForInput && state.executionId) this.database.prepare(`
        INSERT INTO bees_stage_waits VALUES (?, ?)
        ON CONFLICT(work_item_id) DO UPDATE SET execution_id = excluded.execution_id
      `).run(state.workItemId, state.executionId);
      else this.database.prepare("DELETE FROM bees_stage_waits WHERE work_item_id = ?").run(state.workItemId);
    });
    // a scheduled run's first projection means its workflow exists, so its lease can be renewed from here on
    const lease = this.scheduledLeases.get(state.workItemId);
    if (lease) {
      this.scheduledLeases.delete(state.workItemId);
      this.watchClaim(`work-item:${state.workItemId}`, lease, this.client.workflow.getHandle(processWorkflowId(state.workItemId)));
    }
    this.notify({
      type: "work-item-changed", workItemId: state.workItemId,
      executionId: state.executionId ?? null, phase: state.phase
    });
    if (state.phase === "cancelled" && state.executionId) this.abortAgent?.(state.executionId);
    return state;
  }
}
