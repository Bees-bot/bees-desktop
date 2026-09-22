import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import {
  PROCESS_TASK_QUEUE, ProcessRuntime, processWorkflowId
} from "../dsh-runtime/plugin/lib/process-runtime.js";
import { NodeDatabase } from "./node-database.js";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const { Context } = require("@temporalio/activity");

function harness(options: { workerFactory?: (options: any) => Promise<any>; claims?: any;
  needsRecovery?: (id: string) => boolean; pendingInteraction?: (id: string) => any } = {}) {
  const database = new NodeDatabase();
  const workspaceId = String(database.connection.prepare("SELECT id FROM workspaces LIMIT 1").get()!.id);
  const starts: any[] = [];
  const signals: any[] = [];
  const schedules: any[] = [];
  const scheduleHandle = {
    describe: async () => ({ info: { nextActionTimes: [new Date("2026-01-02T17:00:00.000Z")] } }),
    update: async () => undefined, pause: async () => undefined, unpause: async () => undefined,
    delete: async () => undefined
  };
  const client = {
    workflow: {
      start: async (name: string, options: any) => { starts.push({ name, ...options }); },
      getHandle: (workflowId: string) => ({
        result: async () => undefined,
        signal: async (name: string) => { signals.push({ workflowId, name }); },
        cancel: async () => { signals.push({ workflowId, name: "cancel" }); }
      })
    },
    schedule: {
      create: async (options: any) => { schedules.push(options); return scheduleHandle; },
      getHandle: () => scheduleHandle
    }
  };
  const runtime = new ProcessRuntime(database.connection, { client, ...options });
  return { database, workspaceId, runtime, starts, signals, schedules, client };
}

function insertManual(state: ReturnType<typeof harness>) {
  const at = "2026-01-01T00:00:00.000Z";
  state.database.connection.exec(`
    INSERT INTO processes (id, workspace_id, name, description, kind, created_at, updated_at)
      VALUES ('manual', '${state.workspaceId}', 'Manual', '', 'standard', '${at}', '${at}');
    INSERT INTO stages VALUES ('ready', 'manual', 'Ready', 0, 'manual', 0, 0, NULL);
    INSERT INTO stages VALUES ('done', 'manual', 'Done', 1, 'manual', 0, 1, NULL);
    INSERT INTO work_items
      (id, process_id, stage_id, title, created_at, updated_at)
      VALUES ('one', 'manual', 'ready', 'One', '${at}', '${at}');
  `);
}

function insertGoal(state: ReturnType<typeof harness>, id = "goal") {
  const goals = state.database.connection.prepare(`
    SELECT id FROM processes WHERE workspace_id = ? AND kind = 'goals'
  `).get(state.workspaceId)!;
  const work = state.database.connection.prepare(`
    SELECT id FROM stages WHERE process_id = ? AND driver = 'agent'
  `).get(String(goals.id))!;
  state.database.connection.prepare(`
    INSERT INTO work_items (id, process_id, stage_id, kind, title, created_at, updated_at)
    VALUES (?, ?, ?, 'goal', 'Ship it', '2026-01-01', '2026-01-01')
  `).run(id, String(goals.id), String(work.id));
  return { processId: String(goals.id), stageId: String(work.id) };
}

describe("Temporal process projection", () => {
  it("persists an idempotent parent correction and reconstructs it after restart", async () => {
    const state = harness();
    new AgentRuntime({ on: () => () => undefined }, state.database.connection);
    insertGoal(state, "parent");
    const goal = insertGoal(state, "child");
    state.database.connection.exec(`UPDATE work_items SET runtime_phase = 'running' WHERE id = 'parent';
      UPDATE work_items SET parent_id = 'parent', runtime_phase = 'completed', runtime_attempt = 1 WHERE id = 'child';`);
    state.database.connection.prepare(`INSERT INTO execution_links
      (execution_id, workspace_id, work_item_id, agent_name, current_session_id, instance_uid,
       run_directory, config_json, status, created_at, updated_at)
      VALUES ('child-stage-0-work-1', ?, 'child', 'worker', 'child-session', 'child-uid', '/tmp/child', '{}', 'completed', '2026-01-01', '2026-01-01')
    `).run(state.workspaceId);
    state.database.connection.exec(`INSERT INTO bees_stage_results VALUES ('child-stage-0-work-1', 'worker', 'candidate', 'Existing answer', '2026-01-01')`);
    await state.runtime.reviseItem("child", "Add the original publication dates", "parent-call-1");
    expect(state.starts[0].args[0]).toMatchObject({ stageId: goal.stageId, parentReview: true,
      correction: { attempt: 2, candidateExecutionId: "child-stage-0-work-1", feedback: "Add the original publication dates" } });
    await state.runtime.reviseItem("child", "Add the original publication dates", "parent-call-1");
    expect(state.starts).toHaveLength(1);
    await expect(state.runtime.reviseItem("parent", "Different target", "parent-call-1")).rejects.toThrow("another child");
    const restarted = new ProcessRuntime(state.database.connection);
    expect(restarted.input("child")).toEqual(state.starts[0].args[0]);
    await expect(state.runtime.reviseItem("parent", "Wrong target", "parent-call-2")).rejects.toThrow("completed delegated");
    await expect(state.runtime.reviseItem("child", "Already running", "parent-call-3")).rejects.toThrow("completed delegated");
  });

  it("waits for the previous workflow and claim before a correction, and honors cancellation during that wait", async () => {
    const state = harness();
    new AgentRuntime({ on: () => () => undefined }, state.database.connection);
    insertGoal(state, "parent");
    insertGoal(state, "child");
    state.database.connection.exec(`UPDATE work_items SET runtime_phase = 'running' WHERE id = 'parent';
      UPDATE work_items SET parent_id = 'parent', runtime_phase = 'completed', runtime_attempt = 1 WHERE id = 'child';`);
    let close!: () => void;
    let release!: () => void;
    const closed = new Promise<void>((resolve) => { close = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(state.client.workflow, "getHandle").mockReturnValue({ result: () => closed } as any);
    (state.runtime as any).claimWatchers.set("work-item:child", { settled: released });
    const abort = new AbortController();
    const pending = state.runtime.reviseItem("child", "Fix date", "cancelled-call", abort.signal);
    const rejected = expect(pending).rejects.toThrow();
    close();
    await Promise.resolve();
    expect(state.starts).toHaveLength(0);
    abort.abort();
    release();
    await rejected;
    expect(state.runtime.item("child")).toMatchObject({ runtimePhase: "completed", attempt: 1 });
    expect(state.starts).toHaveLength(0);
    expect(state.database.connection.prepare("SELECT id FROM dsh_audit_events WHERE event_type = 'peer-work-correction'").all()).toEqual([]);
  });

  it("starts the process worker when a shared Temporal client is injected", async () => {
    let workerOptions: any;
    const state = harness({ workerFactory: async (options) => {
      workerOptions = options;
      return { run: async () => undefined };
    } });
    await state.runtime.start(async () => ({ outcome: "completed" }));
    expect(workerOptions).toMatchObject({
      namespace: "default",
      taskQueue: PROCESS_TASK_QUEUE,
      activities: {
        createRecurringWorkItem: expect.any(Function),
        projectWorkItem: expect.any(Function),
        runDshStage: expect.any(Function)
      }
    });
  });

  it("marks failed agent work non-retryable even when it requests an automatic retry", async () => {
    let workerOptions: any;
    const state = harness({ workerFactory: async (options) => {
      workerOptions = options;
      return { run: async () => undefined };
    } });
    await state.runtime.start(async () => { throw Object.assign(new Error("Provider exhausted its retries"), { retryable: true }); });
    const activity = vi.spyOn(Context, "current").mockReturnValue({
      heartbeat: () => undefined, cancellationSignal: new AbortController().signal,
    });
    try {
      await expect(workerOptions.activities.runDshStage({})).rejects.toMatchObject({
        message: "Provider exhausted its retries", type: "DshStageFailure", nonRetryable: true,
      });
    } finally { activity.mockRestore(); }
  });

  it("keeps human waits open and treats user stops as cancellation", () => {
    const workflow = readFileSync(new URL(
      "../dsh-runtime/plugin/lib/process-workflow.js", import.meta.url
    ), "utf8");
    expect(workflow).toContain('startToCloseTimeout: "36500 days"');
    expect(workflow).not.toContain('startToCloseTimeout: "36500 days",\n  heartbeatTimeout: "30 seconds",\n  retry:');
    expect(workflow).toContain('durableWaits: true');
    expect(workflow).toContain('message === "Stopped by user"');
    expect(workflow).toContain('project("cancelled", message)');
    expect(workflow).toContain('result.outcome === "blocked"');
    expect(workflow).toContain('waitForRetry(result.summary');
  });

  it("keeps manual boards movable and rejects a stage from another process", () => {
    const state = harness();
    insertManual(state);
    expect(state.runtime.move("one", "done")).toMatchObject({ stageId: "done" });
    const goals = state.database.connection.prepare("SELECT id FROM processes WHERE kind = 'goals'").get()!;
    const otherStage = state.database.connection.prepare("SELECT id FROM stages WHERE process_id = ? LIMIT 1").get(String(goals.id))!;
    expect(() => state.runtime.move("one", String(otherStage.id))).toThrow("does not belong");
  });

  it("creates Temporal schedules and fresh work items for recurring work", async () => {
    const state = harness();
    const goal = insertGoal(state, "source-goal");
    state.database.connection.prepare(`
      INSERT INTO recurring_work
        (id, workspace_id, process_id, source_work_item_id, name, schedule_kind,
         schedule_json, timezone, temporal_schedule_id, status, created_at, updated_at)
      VALUES ('morning-news', ?, ?, 'source-goal', 'Daily news', 'calendar',
        '{"frequency":"daily","hour":9,"minute":0}', 'America/Los_Angeles',
        'bees/recurring/morning-news', 'active', '2026-01-01', '2026-01-01')
    `).run(state.workspaceId, goal.processId);

    await state.runtime.reconcile();
    expect(state.starts).toEqual([]);
    expect(state.schedules[0]).toMatchObject({
      scheduleId: "bees/recurring/morning-news",
      spec: { calendars: [{ hour: 9, minute: 0 }], timezone: "America/Los_Angeles" },
      action: { type: "startWorkflow", workflowType: "recurringWorkWorkflow" },
      policies: { overlap: "SKIP", catchupWindow: "1 minute" }
    });
    const input = await state.runtime.createRecurringWorkItem("morning-news");
    expect(input).toMatchObject({ processId: goal.processId, stageId: goal.stageId });
    expect(state.database.connection.prepare(`
      SELECT kind, recurring_work_id AS recurringWorkId FROM work_items WHERE id = ?
    `).get(input.workItemId)).toEqual({ kind: "run", recurringWorkId: "morning-news" });
  });

  it("creates one schedule per identity and binds each occurrence to that identity", async () => {
    const claimed: any[] = [];
    const state = harness({ claims: {
      acquire: async (...args: any[]) => { claimed.push(args); return { local: true }; },
      renew: async () => null,
      release: async () => undefined
    } });
    const goal = insertGoal(state, "shared-source");
    const team = state.database.connection.prepare(`
      SELECT t.id, t.organization_id AS organizationId FROM workspaces w
      JOIN teams t ON t.id = w.team_id WHERE w.id = ?
    `).get(state.workspaceId)!;
    state.database.connection.exec(`
      INSERT INTO bees_accounts VALUES
        ('user-a', 'a@acme.com', 'A', '2026-01-01', '2026-01-01', 1),
        ('user-b', 'b@acme.com', 'B', '2026-01-01', '2026-01-01', 1);
    `);
    state.database.connection.prepare(`
      INSERT INTO bees_connections VALUES
        ('connection-a', ?, 'user-a', 'member', '2026-01-01', '2026-01-01'),
        ('connection-b', ?, 'user-b', 'member', '2026-01-01', '2026-01-01')
    `).run(String(team.organizationId), String(team.organizationId));
    state.database.connection.prepare(`
      INSERT INTO bees_connection_teams VALUES
        ('connection-a', ?, 'member', '2026-01-01', '2026-01-01'),
        ('connection-b', ?, 'member', '2026-01-01', '2026-01-01')
    `).run(String(team.id), String(team.id));
    state.database.connection.prepare(`
      INSERT INTO recurring_work
        (id, workspace_id, process_id, source_work_item_id, name, schedule_kind,
         schedule_json, timezone, temporal_schedule_id, status, created_at, updated_at)
      VALUES ('shared-schedule', ?, ?, 'shared-source', 'Shared', 'interval',
        '{"everyMinutes":60,"anchorUtc":"2026-01-01T00:00:00.000Z"}', NULL,
        'bees/recurring/shared-schedule', 'active', '2026-01-01', '2026-01-01')
    `).run(state.workspaceId, goal.processId);

    await state.runtime.reconcile();
    expect(state.schedules.map(({ scheduleId }) => scheduleId).sort()).toEqual([
      "bees/recurring/shared-schedule/identity/user-a",
      "bees/recurring/shared-schedule/identity/user-b"
    ]);
    expect(state.schedules.map(({ action }) => action.args[0].accountUserId).sort())
      .toEqual(["user-a", "user-b"]);

    const work = await state.runtime.createRecurringWorkItem(
      "shared-schedule", "2026-01-01T01:00:00Z", "user-a"
    );
    expect(claimed).toContainEqual([
      "schedule_occurrence", "shared-schedule", String(team.id),
      "2026-01-01T01:00:00Z", "user-a"
    ]);
    expect(state.database.connection.prepare(`
      SELECT account_user_id AS accountUserId FROM work_items WHERE id = ?
    `).get(work.workItemId)).toEqual({ accountUserId: "user-a" });
  });

  it("starts one derived Temporal workflow for an automatic goal", async () => {
    const state = harness();
    const goal = insertGoal(state);
    await state.runtime.startItem("goal");
    expect(state.starts).toEqual([expect.objectContaining({
      name: "processWorkflow",
      taskQueue: PROCESS_TASK_QUEUE,
      workflowId: processWorkflowId("goal"),
      args: [expect.objectContaining({
        workItemId: "goal",
        processId: goal.processId,
        stages: [
          expect.objectContaining({ driver: "agent" }),
          expect.objectContaining({ driver: "review" }),
          expect.objectContaining({ driver: "terminal" })
        ]
      })]
    })]);
    expect(state.database.connection.prepare("SELECT runtime_phase FROM work_items WHERE id = 'goal'").get())
      .toEqual({ runtime_phase: "running" });
  });

  it("does not start work whose shared lease belongs to another desktop", async () => {
    const state = harness({ claims: {
      acquire: async () => null,
      renew: async () => null,
      release: async () => undefined
    } });
    insertGoal(state, "shared-goal");
    await expect(state.runtime.startItem("shared-goal")).resolves.toEqual({
      automatic: true, claimed: false
    });
    expect(state.starts).toEqual([]);
    expect(state.database.connection.prepare(
      "SELECT runtime_phase AS phase FROM work_items WHERE id = 'shared-goal'"
    ).get()).toEqual({ phase: "ready" });
  });

  it("checks local readiness before attempting the team lease", async () => {
    const acquire = vi.fn();
    const state = harness({ claims: { acquire, renew: vi.fn(), release: vi.fn() } } as any);
    insertGoal(state, "unready-goal");
    (state.runtime as any).canStart = async () => ({ ready: false, reason: "Mail is not connected" });
    await expect(state.runtime.startItem("unready-goal")).resolves.toEqual({
      automatic: true, claimed: false, waitingFor: "Mail is not connected"
    });
    expect(acquire).not.toHaveBeenCalled();
  });

  it("recovers legacy heartbeat failures while leaving agent errors for explicit retry", async () => {
    const state = harness();
    insertGoal(state);
    insertGoal(state, "ready-goal");
    insertGoal(state, "running-goal");
    insertGoal(state, "provider-failed");
    state.database.connection.exec("UPDATE work_items SET runtime_phase = 'failed', runtime_error = 'Provider unavailable' WHERE id = 'provider-failed'");
    state.database.connection.prepare(`
      UPDATE work_items SET runtime_phase = 'failed', runtime_error = 'activity Heartbeat timeout', runtime_attempt = 1
      WHERE id = 'goal'
    `).run();
    state.database.connection.prepare("UPDATE work_items SET runtime_phase = 'running' WHERE id = 'running-goal'").run();
    await state.runtime.reconcile();
    expect(state.signals).toEqual([{ workflowId: processWorkflowId("goal"), name: "retry" }]);
    expect(state.starts.map(({ workflowId }) => workflowId).sort())
      .toEqual([processWorkflowId("goal"), processWorkflowId("ready-goal"), processWorkflowId("running-goal")]);
    expect(state.database.connection.prepare("SELECT runtime_phase, runtime_attempt FROM work_items WHERE id = 'goal'").get())
      .toEqual({ runtime_phase: "running", runtime_attempt: 1 });
  });

  it("persists a human wait across restart and retries a lost answer notification", async () => {
    const state = harness({ pendingInteraction: () => ({ kind: "question" }) });
    const goal = insertGoal(state);
    const projection = { workItemId: "goal", processId: goal.processId, stageId: goal.stageId,
      phase: "waiting", executionId: "execution", waitingForInput: true };
    state.runtime.project(projection);
    await state.runtime.reconcile();
    expect(state.signals).toEqual([]);
    const restarted = new ProcessRuntime(state.database.connection, {
      client: state.client, pendingInteraction: () => ({ kind: "question" }), needsRecovery: () => true,
    });
    await restarted.reconcile();
    expect(state.signals).toEqual([{ workflowId: processWorkflowId("goal"), name: "stageChanged" }]);
    // Answer committed, process exited before sending a signal. The persisted marker recovers it.
    state.signals.length = 0;
    state.database.connection.exec("UPDATE work_items SET runtime_phase = 'running' WHERE id = 'goal'");
    const afterAnswer = new ProcessRuntime(state.database.connection, { client: state.client });
    await afterAnswer.reconcile();
    expect(state.signals).toEqual([{ workflowId: processWorkflowId("goal"), name: "stageChanged" }]);
    afterAnswer.project({ ...projection, phase: "running", waitingForInput: false });
    state.signals.length = 0;
    await afterAnswer.wakeStage("execution");
    expect(state.signals).toEqual([]);
  });

  it("heartbeats through long asynchronous work and stops heartbeating when it suspends", async () => {
    let workerOptions: any;
    const state = harness({ workerFactory: async (options) => {
      workerOptions = options;
      return { run: async () => undefined };
    } });
    let suspend!: (value: any) => void;
    await state.runtime.start(() => new Promise((resolve) => { suspend = resolve; }));
    expect(workerOptions.maxHeartbeatThrottleInterval).toBe("10 seconds");
    const heartbeat = vi.fn();
    const activity = vi.spyOn(Context, "current").mockReturnValue({
      heartbeat, cancellationSignal: new AbortController().signal,
    });
    vi.useFakeTimers();
    try {
      const running = workerOptions.activities.runDshStage({});
      await vi.advanceTimersByTimeAsync(90_000);
      expect(heartbeat).toHaveBeenCalledTimes(10);
      suspend({ outcome: "suspended" });
      await expect(running).resolves.toEqual({ outcome: "suspended" });
      await vi.advanceTimersByTimeAsync(90_000);
      expect(heartbeat).toHaveBeenCalledTimes(10);
    } finally { vi.useRealTimers(); activity.mockRestore(); }
  });

  it("signals control to Temporal and never stores a workflow id", async () => {
    const state = harness();
    insertGoal(state);
    await state.runtime.startItem("goal");
    state.starts.length = 0;
    await state.runtime.signal("goal", "pause");
    await state.runtime.signal("goal", "resume");
    await state.runtime.signal("goal", "cancel");
    expect(state.signals).toEqual([
      { workflowId: processWorkflowId("goal"), name: "pause" },
      { workflowId: processWorkflowId("goal"), name: "resume" },
      { workflowId: processWorkflowId("goal"), name: "cancel" }
    ]);
    expect(state.database.connection.prepare("PRAGMA table_info(work_items)").all())
      .not.toContainEqual(expect.objectContaining({ name: "workflow_id" }));
  });

  it("accepts only projection stages from the card's process", () => {
    const state = harness();
    const goal = insertGoal(state);
    const review = state.database.connection.prepare(`
      SELECT id FROM stages WHERE process_id = ? AND driver = 'review'
    `).get(goal.processId)!;
    state.runtime.project({
      workItemId: "goal", processId: goal.processId, stageId: review.id,
      phase: "running", attempt: 1, reviewCycle: 1, executionId: "review-1", error: null
    });
    expect(state.database.connection.prepare(`
      SELECT stage_id, runtime_review_cycle, runtime_execution_id FROM work_items WHERE id = 'goal'
    `).get()).toEqual({ stage_id: review.id, runtime_review_cycle: 1, runtime_execution_id: "review-1" });
    insertManual(state);
    expect(() => state.runtime.project({
      workItemId: "goal", processId: goal.processId, stageId: "done", phase: "completed"
    })).toThrow("does not belong");
  });
});
