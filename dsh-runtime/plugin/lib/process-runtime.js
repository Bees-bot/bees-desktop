import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { ApplicationFailure, Context } from "@temporalio/activity";
import {
  Client, Connection, WorkflowExecutionAlreadyStartedError, WorkflowFailedError, WorkflowNotFoundError
} from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { iso, message, transaction, workItemLineage, workRunItems } from "./product-database.js";
import { step } from "./startup.js";

export const PROCESS_TASK_QUEUE = "bees-processes-v1";
export const processWorkflowId = (workItemId) => `bees/work-item/${workItemId}`;
export const recurringScheduleId = (recurringWorkId, accountUserId = "") =>
  `bees/recurring/${recurringWorkId}${accountUserId ? `/identity/${accountUserId}` : ""}`;

const automaticDrivers = new Set(["agent", "discussion", "review", "terminal"]);

const isScheduleMissing = (error) => error?.name === "ScheduleNotFoundError";

export class ProcessRuntime {
  constructor(database, options = {}) {
    this.database = database;
    this.client = options.client;
    this.logger = options.logger ?? console;
    this.workerFactory = options.workerFactory;
    this.claims = options.claims;
    this.abortAgent = options.abortAgent;
    this.stopAgents = options.stopAgents;
    this.notify = options.notify ?? (() => {});
    this.workflows = new Map();
    this.scheduledOwners = new Map();
    this.startingItems = new Map();
    this.recurringRevisions = new Map();
    this.handoffs = new Map();
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
             w.runtime_error AS error, w.recurring_work_id AS recurringWorkId,
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
        AND json_extract(metadata_json, '$.attempt') = ?
      ORDER BY rowid DESC LIMIT 1
    `).get(item.id, item.attempt) : null;
    const restart = this.database.prepare(`SELECT metadata_json AS metadata FROM dsh_audit_events
      WHERE event_type = 'work-restarted' AND json_extract(metadata_json, '$.workItemId') = ?
        AND json_extract(metadata_json, '$.attempt') = ? ORDER BY rowid DESC LIMIT 1`)
      .get(item.id, item.attempt);
    return {
      workItemId: item.id, processId: item.processId, stageId: item.stageId,
      accountUserId: item.accountUserId ?? "", stages, maxAttempts: 3,
      parentReview: Boolean(item.parentId),
      resumeAttempt: item.attempt || 1,
      // Its own field so runs already in flight replay on the path they started with.
      peerAssignment: Boolean(item.parentId),
      ...(restart ? { restart: JSON.parse(restart.metadata) }
        : correction ? { correction: JSON.parse(correction.metadata) } : {})
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
        const item = this.item(stage.workItemId);
        const migrated = !this.claims?.owner?.(item.id) && (item.recurringWorkId && !item.parentId || item.executionId &&
          this.database.prepare("SELECT 1 FROM execution_links WHERE execution_id=?").get(item.executionId));
        const ownership = this.claims ? await this.claims.acquire("work_item", item.id, item.teamId, "", item.accountUserId ?? "",
          { explicit: Boolean(migrated) }) : { local: true };
        if (!ownership) throw ApplicationFailure.nonRetryable("This machine does not own this process run", "OwnershipRequired");
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
      WHERE r.id = ? AND w.authority = 'local'
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
      // a paused schedule still lists future times it will never fire at
      const nextRunAt = description.state?.paused ? null : description.info?.nextActionTimes?.[0]?.toISOString?.() ?? null;
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
    } catch (error) {
      // a network blip is not a missing schedule, and creating again would double it
      if (!isScheduleMissing(error)) throw error;
      await this.client.schedule.create(options);
    }
    return this.refreshNextRun(recurring.id, accountUserId, handle);
  }

  async reconcileRecurring(recurringWorkId) {
    const eligible = new Set(this.executorAccounts(recurringWorkId));
    const definition = this.recurring(recurringWorkId);
    const revision = JSON.stringify([definition, [...eligible]]);
    if (this.recurringRevisions.get(recurringWorkId) === revision)
      return { nextRunAt: this.database.prepare('SELECT next_run_at AS nextRunAt FROM recurring_work WHERE id=?').get(recurringWorkId).nextRunAt };
    const existing = this.database.prepare(`
      SELECT account_user_id AS accountUserId, temporal_schedule_id AS temporalScheduleId
      FROM bees_recurring_executors WHERE recurring_work_id = ?
    `).all(recurringWorkId);
    for (const executor of existing) if (!eligible.has(executor.accountUserId)) {
      // The person is off the run now, so the schedule and its row both go.
      try { await this.client.schedule.getHandle(executor.temporalScheduleId).delete(); }
      catch (error) {
        // keep the row so the next reconcile tries again, or the schedule keeps firing unowned
        if (!isScheduleMissing(error)) {
          this.logger.warn?.(`bees: a Temporal schedule would not delete: ${message(error)}`);
          continue;
        }
      }
      this.database.prepare(`
        DELETE FROM bees_recurring_executors WHERE recurring_work_id = ? AND account_user_id = ?
      `).run(recurringWorkId, executor.accountUserId);
    }
    const nextRuns = [];
    for (const accountUserId of eligible)
      nextRuns.push(await this.ensureRecurringExecutor(recurringWorkId, accountUserId));
    this.refreshAggregateNextRun(recurringWorkId);
    this.recurringRevisions.set(recurringWorkId, revision);
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
    // the occurrence claim is one-time, so a retry would skip this run; its first stage claims it instead
    let owner;
    try {
      await this.claims?.publish(work.workItemId);
      owner = await this.claims?.acquire("work_item", work.workItemId, recurring.teamId, "", accountUserId, { explicit: true });
    } catch (error) {
      this.logger.warn?.(`bees: a scheduled run could not claim ownership yet: ${message(error)}`);
    }
    if (owner === null) return null;
    if (owner) this.scheduledOwners.set(work.workItemId, owner);
    return work;
  }

  async close() {
    this.closing = true;
    this.workflows.clear();
    this.worker?.shutdown();
    await this.running;
    await this.workerConnection?.close();
    await this.connection?.close();
  }

  async reconcileSchedules() {
    const schedules = this.database.prepare(
      "SELECT id FROM recurring_work ORDER BY created_at"
    ).all();
    for (const settled of await Promise.allSettled(schedules.map(async ({ id }) => {
      await this.reconcileRecurring(id);
    }))) if (settled.status === "rejected")
      this.logger.warn?.(`bees: a recurring schedule failed to reconcile: ${message(settled.reason)}`);
  }

  async reconcile() {
    await this.reconcileSchedules();
    const items = this.database.prepare(`
      SELECT w.id, w.runtime_phase AS phase, w.runtime_execution_id AS executionId,
             EXISTS (SELECT 1 FROM bees_stage_waits h WHERE h.work_item_id = w.id) AS humanWait
      FROM work_items w
      WHERE w.deleted_at IS NULL AND w.archived_at IS NULL
        AND (w.runtime_phase IN ('ready', 'running', 'waiting', 'paused')
          OR w.runtime_phase = 'failed' AND lower(w.runtime_error) LIKE '%heartbeat timeout%')
        AND EXISTS (
          SELECT 1 FROM processes p JOIN workspaces ws ON ws.id = p.workspace_id
          JOIN teams t ON t.id = ws.team_id
          WHERE p.id = w.process_id AND (
            (ws.authority = 'local' AND w.account_user_id IS NULL)
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

  async startItem(workItemId, options = {}) {
    const key = `work-item:${workItemId}`;
    if (this.startingItems.has(key)) return this.startingItems.get(key);
    const starting = this.startItemOnce(workItemId, options).finally(() => this.startingItems.delete(key));
    this.startingItems.set(key, starting);
    return starting;
  }

  async startItemOnce(workItemId, options) {
    const input = this.input(workItemId);
    if (!this.isAutomatic(input.processId)) return { automatic: false };
    // only the device that parked a run holds its question, another would rerun the stage cold
    const { runtimePhase, executionId } = this.item(workItemId);
    if (["waiting", "paused"].includes(runtimePhase) && executionId &&
      !this.database.prepare("SELECT 1 FROM execution_links WHERE execution_id = ?").get(executionId))
      return { automatic: true, claimed: false, waitingFor: "This work is waiting on the device that paused it" };
    const claimKey = `work-item:${workItemId}`;
    if (this.workflows.has(claimKey) && this.claims?.owner?.(workItemId)?.state !== 'relinquishing') {
      return { automatic: true, workflowId: processWorkflowId(workItemId), claimed: true };
    }
    const scheduled = this.scheduledOwners.get(workItemId);
    this.scheduledOwners.delete(workItemId);
    const migrated = !this.claims?.owner?.(workItemId) && this.database.prepare(
      "SELECT 1 FROM execution_links WHERE work_item_id=? LIMIT 1").get(workItemId);
    const claim = scheduled ?? (this.claims
      ? await this.claims.acquire(
          "work_item", workItemId, this.item(workItemId).teamId, "", input.accountUserId ?? "",
          { ...options, explicit: options.explicit || Boolean(migrated) }
        )
      : { local: true });
    if (!claim) return { automatic: true, claimed: false, waitingFor: "This process run stays on its owning machine until its owner relinquishes control" };
    // owned before the readiness check, so a run waiting on an add-on is started by a later tick
    const readiness = await this.canStart(workItemId);
    if (!readiness?.ready) return {
      automatic: true, claimed: false, waitingFor: readiness?.reason ?? "This device is not ready"
    };
    let handle;
    try {
      handle = await this.client.workflow.start("processWorkflow", {
        taskQueue: PROCESS_TASK_QUEUE,
        workflowId: processWorkflowId(workItemId),
        args: [input]
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError) && error?.name !== "WorkflowExecutionAlreadyStartedError") {
        // the scheduler's own wording ("Failed to start Workflow") names no next step, so it only goes to the log
        this.logger.warn?.(`bees: work did not start: ${message(error)}`);
        this.project({ ...input, attempt: input.resumeAttempt, phase: "failed", error: "Bees could not start this work. Try again, and reopen Bees if it keeps failing." });
        throw error;
      }
      handle = this.client.workflow.getHandle(processWorkflowId(workItemId));
    }
    this.database.prepare(`
      UPDATE work_items SET runtime_phase = 'running', runtime_error = NULL, updated_at = ?
      WHERE id = ? AND runtime_phase = 'ready'
    `).run(new Date().toISOString(), workItemId);
    this.notify({ type: "workflow-started", workItemId });
    this.watchWorkflow(claimKey, handle);
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
    // The completed projection precedes Temporal closing the workflow.
    await this.client.workflow.getHandle(processWorkflowId(workItemId)).result();
    await this.workflows.get(`work-item:${workItemId}`)?.settled;
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

  async restartItem(workItemId, text, requestId) {
    if (typeof text !== "string" || text.length > 8000 || typeof requestId !== "string" || !requestId.trim())
      throw new Error("A restart needs a request ID and instructions under 8,000 characters");
    const receiptId = `work-restart:${requestId}`;
    const receipt = this.database.prepare("SELECT metadata_json AS metadata FROM dsh_audit_events WHERE id = ?").get(receiptId);
    const item = this.item(workItemId);
    if (receipt) {
      const saved = JSON.parse(receipt.metadata);
      if (saved.workItemId !== workItemId || saved.text !== text) throw new Error("This restart belongs to another request");
      if (item.runtimePhase === "ready") await this.startItem(workItemId);
      return { id: workItemId };
    }
    if (!this.isAutomatic(item.processId) || item.archivedAt || !["completed", "failed", "cancelled"].includes(item.runtimePhase))
      throw new Error("Only finished automatic work can be restarted");
    const handle = this.client.workflow.getHandle(processWorkflowId(workItemId));
    if (item.runtimePhase === "failed") {
      if (item.executionId) this.abortAgent?.(item.executionId);
      await handle.cancel();
    }
    await handle.result().catch((error) => { if (!(error instanceof WorkflowFailedError)) throw error; });
    await this.workflows.get(`work-item:${workItemId}`)?.settled;
    const first = this.stages(item.processId)[0];
    transaction(this.database, () => {
      const current = this.item(workItemId);
      if (current.attempt !== item.attempt || current.archivedAt || !["completed", "failed", "cancelled"].includes(current.runtimePhase))
        throw new Error("This task already started another attempt");
      const attempt = Number(item.attempt) + 1;
      this.database.prepare(`INSERT INTO dsh_audit_events (id, event_type, metadata_json, created_at)
        VALUES (?, 'work-restarted', ?, ?)`)
        .run(receiptId, JSON.stringify({ workItemId, attempt, text }), iso());
      this.database.prepare(`UPDATE work_items SET stage_id = ?, runtime_phase = 'ready', runtime_attempt = ?,
        runtime_review_cycle = 0, runtime_execution_id = NULL, runtime_error = NULL, updated_at = ? WHERE id = ?`)
        .run(first.id, attempt, iso(), workItemId);
      this.database.prepare("DELETE FROM bees_stage_waits WHERE work_item_id = ?").run(workItemId);
    });
    const started = await this.startItem(workItemId);
    return { id: workItemId, ...started };
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
        // Failed workflows are still open, waiting for retry. Close them before replacing the work.
        await this.client.workflow.getHandle(processWorkflowId(workItemId)).result();
        await this.workflows.get(`work-item:${workItemId}`)?.settled;
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

  watchWorkflow(key, handle) {
    if (typeof handle?.result !== "function" || this.workflows.has(key)) return;
    const watcher = { settled: null };
    this.workflows.set(key, watcher);
    watcher.settled = handle.result().catch(() => undefined).finally(() => {
      if (this.workflows.get(key) === watcher) this.workflows.delete(key);
    });
  }

  relinquish(workItemId, saveCheckpoint, checkFiles) {
    if (this.handoffs.has(workItemId)) return this.handoffs.get(workItemId);
    const pending = this.relinquishOnce(workItemId, saveCheckpoint, checkFiles).finally(() => this.handoffs.delete(workItemId));
    this.handoffs.set(workItemId, pending);
    return pending;
  }

  async relinquishOnce(workItemId, saveCheckpoint, checkFiles) {
    const root = workItemLineage(this.database, workItemId)[0];
    if (root.id !== workItemId) throw new Error("Relinquish control from the parent process run");
    const claim = this.claims?.owner(root.id);
    if (!claim || !['owned','relinquishing'].includes(claim.state))
      throw new Error("Only the owning user and machine can relinquish this process run");
    // a handoff over the file limits must fail before anything is stopped
    await checkFiles?.();
    let checkpoints = claim.checkpoints ?? [];
    let releasing = false;
    try {
      this.claims.relinquishing(claim);
      // Block new admissions before waiting for launches already in progress.
      await Promise.all(workRunItems(this.database, root.id).map((id) => this.startingItems.get(`work-item:${id}`)));
      const ids = workRunItems(this.database, root.id);
      for (const id of claim.checkpoints ? [] : ids) {
        const item = this.item(id);
        if (['completed','cancelled'].includes(item.runtimePhase)) continue;
        const stages = this.stages(item.processId);
        let stage = stages.find(({ id }) => id === item.stageId);
        // Reviewer evidence is local; replay its producer using the saved outputs on the next machine.
        if (stage?.driver === 'review') stage = stages.slice(0, stages.indexOf(stage)).findLast(({ driver }) => ['agent','discussion'].includes(driver));
        if (!stage) throw new Error('This work has no resumable stage');
        checkpoints.push({ workItemId: id, stageId: stage.id, attempt: Number(item.attempt) + 1 });
      }
      this.claims.relinquishing({ ...claim, checkpoints });
      for (const id of ids) {
        const item = this.item(id);
        if (item.executionId) this.abortAgent?.(item.executionId);
        const handle = this.client.workflow.getHandle(processWorkflowId(id));
        try {
          await handle.cancel();
          await handle.result().catch((error) => { if (!(error instanceof WorkflowFailedError)) throw error; });
        } catch (error) { if (!(error instanceof WorkflowNotFoundError)) throw error; }
        await this.workflows.get(`work-item:${id}`)?.settled;
      }
      await this.stopAgents?.(ids);
      checkpoints = checkpoints.filter(({ workItemId }) => this.item(workItemId).runtimePhase !== 'completed');
      this.claims.relinquishing({ ...claim, checkpoints });
      await saveCheckpoint(checkpoints);
      await this.claims.publish(root.id, { handoff: true });
      releasing = true;
      await this.claims.release(claim, checkpoints);
    } catch (error) {
      // a release the server may have taken stays relinquishing, so Finish relinquishing retries it
      if (claim.state !== 'owned' || releasing) throw error;
      this.claims.relinquishing(claim, 'owned');
      // runs this attempt cancelled restart from their checkpoint here, as they would on the next machine
      for (const entry of checkpoints) this.database.prepare(`UPDATE work_items SET stage_id=?,
        runtime_phase='ready',runtime_attempt=?,runtime_review_cycle=0,runtime_execution_id=NULL,runtime_error=NULL,
        updated_at=? WHERE id=? AND runtime_phase='cancelled'`).run(entry.stageId,entry.attempt,iso(),entry.workItemId);
      this.notify({ type: 'work-item-changed', workItemId: root.id });
      throw error;
    }
    for (const checkpoint of checkpoints) this.database.prepare(`UPDATE work_items SET
      stage_id=?,runtime_phase='paused',runtime_attempt=?,runtime_review_cycle=0,runtime_execution_id=NULL,
      runtime_error=NULL,updated_at=? WHERE id=?`).run(checkpoint.stageId,checkpoint.attempt,iso(),checkpoint.workItemId);
    this.notify({ type: 'execution-relinquished', workItemId: root.id });
    return { id: root.id };
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
    if (type === "start") {
      // Initial publication establishes the shared run before its owner starts it.
      await this.claims?.publish(workItemId);
      const started = await this.startItem(workItemId, { explicit: true });
      // a device that can't run it leaves it ready, so say why instead of doing nothing
      if (started.waitingFor) throw new Error(`Can't start yet: ${started.waitingFor}`);
      return started;
    }
    // a run from before ownership has no saved owner, so the machine that ran it claims it like startItemOnce does
    const migrated = !this.claims?.owner?.(workItemId) && this.database.prepare(
      "SELECT 1 FROM execution_links WHERE work_item_id=? LIMIT 1").get(workItemId);
    const ownership = this.claims ? await this.claims.acquire("work_item", workItemId, item.teamId, "", item.accountUserId ?? "",
      { explicit: Boolean(migrated) }) : { local: true };
    if (!ownership) throw new Error("This process run is controlled on another machine");
    const handle = this.client.workflow.getHandle(processWorkflowId(workItemId));
    // a teammate's device ran this item, and only that device holds its workflow
    const elsewhere = (error) => {
      throw error instanceof WorkflowNotFoundError && !item.executionId ? new Error(`This work ran on another device. Open Bees there to ${type} it.`) : error;
    };
    if (type === "cancel") {
      // Stop local model/tool execution now, without waiting for Temporal's next heartbeat.
      // Temporal still owns the workflow's final cancellation projection.
      if (item.executionId) this.abortAgent?.(item.executionId);
      await handle.cancel().catch(elsewhere);
      return item;
    }
    await handle.signal(type, ...(message ? [message] : [])).catch(elsewhere);
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
      SELECT driver, is_terminal AS isTerminal FROM stages
      WHERE id = ? AND process_id = ? AND archived_at IS NULL
    `).get(state.stageId, state.processId);
    if (!stage) throw new Error("The stage does not belong to this process");
    // Peers and skipped work finish early. Save their completion in the terminal board lane too.
    if (state.phase === "completed" && stage.driver !== "terminal" && !stage.isTerminal) {
      const terminal = this.stages(state.processId).find(({ driver, isTerminal }) => driver === "terminal" || isTerminal);
      if (terminal) state = { ...state, stageId: terminal.id };
    }
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
      // one item runs one execution at a time: an attempt a retry replaced would otherwise sit in
      // its old waiting state for ever, and the dashboard keeps asking the owner to answer it
      if (state.executionId) this.database.prepare(`
        UPDATE execution_links SET status = 'cancelled', updated_at = ?
        WHERE work_item_id = ? AND execution_id <> ?
          AND status IN ('running', 'waiting_for_input', 'waiting_for_approval')
      `).run(new Date().toISOString(), state.workItemId, state.executionId);
    });
    if (this.scheduledOwners.has(state.workItemId)) {
      this.scheduledOwners.delete(state.workItemId);
      this.watchWorkflow(`work-item:${state.workItemId}`, this.client.workflow.getHandle(processWorkflowId(state.workItemId)));
    }
    this.notify({
      type: "work-item-changed", workItemId: state.workItemId,
      executionId: state.executionId ?? null, phase: state.phase
    });
    if (state.phase === "cancelled" && state.executionId) this.abortAgent?.(state.executionId);
    return state;
  }
}
