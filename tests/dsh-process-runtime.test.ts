import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROCESS_TASK_QUEUE, ProcessRuntime, processWorkflowId
} from "../dsh-runtime/plugin/lib/process-runtime.js";
import { NodeDatabase } from "./node-database.js";

function harness(options: { workerFactory?: (options: any) => Promise<any> } = {}) {
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
  return { database, workspaceId, runtime, starts, signals, schedules };
}

function insertManual(state: ReturnType<typeof harness>) {
  const at = "2026-01-01T00:00:00.000Z";
  state.database.connection.exec(`
    INSERT INTO processes (id, workspace_id, name, description, kind, created_at, updated_at)
      VALUES ('manual', '${state.workspaceId}', 'Manual', '', 'standard', '${at}', '${at}');
    INSERT INTO stages VALUES ('ready', 'manual', 'Ready', 0, 'manual', 0, NULL);
    INSERT INTO stages VALUES ('done', 'manual', 'Done', 1, 'manual', 1, NULL);
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

  it("keeps human waits open and treats user stops as cancellation", () => {
    const workflow = readFileSync(new URL(
      "../dsh-runtime/plugin/lib/process-workflow.js", import.meta.url
    ), "utf8");
    expect(workflow).toContain('startToCloseTimeout: "36500 days"');
    expect(workflow).not.toContain('startToCloseTimeout: "36500 days",\n  heartbeatTimeout: "30 seconds",\n  retry:');
    expect(workflow).toContain('deprecatePatch("bees-durable-human-waits-v1")');
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
    await state.runtime.createRecurring("morning-news");
    expect(state.schedules[0]).toMatchObject({
      scheduleId: "bees/recurring/morning-news",
      spec: { calendars: [{ hour: 9, minute: 0 }], timezone: "America/Los_Angeles" },
      action: { type: "startWorkflow", workflowType: "recurringWorkWorkflow" },
      policies: { overlap: "SKIP", catchupWindow: "1 minute" }
    });
    const input = state.runtime.createRecurringWorkItem("morning-news");
    expect(input).toMatchObject({ processId: goal.processId, stageId: goal.stageId });
    expect(state.database.connection.prepare(`
      SELECT kind, recurring_work_id AS recurringWorkId FROM work_items WHERE id = ?
    `).get(input.workItemId)).toEqual({ kind: "run", recurringWorkId: "morning-news" });
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

  it("retries a heartbeat-interrupted human wait during reconciliation", async () => {
    const state = harness();
    insertGoal(state);
    state.database.connection.prepare(`
      UPDATE work_items SET runtime_phase = 'failed', runtime_error = 'activity Heartbeat timeout'
      WHERE id = 'goal'
    `).run();
    await state.runtime.reconcile();
    expect(state.signals).toEqual([{ workflowId: processWorkflowId("goal"), name: "retry" }]);
    expect(state.database.connection.prepare("SELECT runtime_phase FROM work_items WHERE id = 'goal'").get())
      .toEqual({ runtime_phase: "running" });
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
