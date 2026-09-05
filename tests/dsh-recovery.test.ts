import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentRuntime,
  LATEST_SOL_MODEL,
  copyOutputs,
  latestCodexModel,
  safeRecoverySeed,
  typedReferences
} from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { clientSource as client } from "./client-source.js";
import { NodeDatabase } from "./node-database.js";

function context(): { on: () => () => void } {
  return { on: () => () => undefined };
}

function insertRun(database: NodeDatabase, status = "running", workItemId: string | null = null): void {
  const at = "2026-01-01T00:00:00.000Z";
  const workspace = database.connection.prepare("SELECT id FROM workspaces ORDER BY created_at LIMIT 1").get() as { id: string };
  database.connection.prepare(`
    INSERT INTO execution_links
      (execution_id, workspace_id, work_item_id, agent_name, current_session_id, instance_uid,
       run_directory, config_json, status, created_at, updated_at)
    VALUES ('run', ?, ?, 'bees-run', 'session', 'uid', '/tmp/work', ?, ?, ?, ?)
  `).run(workspace.id, workItemId, JSON.stringify({ version: 1, model: null }), status, at, at);
}

describe("DSH-owned desktop and recovery", () => {
  it("durably queues a run before background agent startup", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-queued-run-"));
    try {
      const database = new NodeDatabase();
      const workspace = database.connection.prepare(
        "SELECT id FROM workspaces ORDER BY created_at LIMIT 1"
      ).get() as { id: string };
      const changes: any[] = [];
      const runtime: any = new AgentRuntime(context(), database.connection, null, (change: any) => changes.push(change));
      runtime.newHandle = () => new Promise(() => undefined);
      const result = await runtime.dispatch("bees-run", "queued-run", {
        idempotencyKey: "start:queued-run", workspace: root, body: "Plan this outcome",
        initialData: {
          version: 1, mode: "planning", executionId: "queued-run", workItemId: null,
          agentId: "planner", agentName: "Planner", purpose: "Plan", model: "test/model",
          reasoningEffort: null, instructions: "", workspaceId: workspace.id,
          agentPresetId: "standard", mcpAccess: "none", mcpServers: [], grants: []
        }
      });

      expect(result).toMatchObject({ executionId: "queued-run", sessionId: "queued-run", status: "queued" });
      expect(database.connection.prepare(
        "SELECT delivery_id AS deliveryId FROM bees_run_queue WHERE execution_id = 'queued-run'"
      ).get()).toEqual({ deliveryId: "start:queued-run" });
      expect(database.connection.prepare(
        "SELECT status FROM execution_links WHERE execution_id = 'queued-run'"
      ).get()).toEqual({ status: "queued" });
      expect(changes).toContainEqual(expect.objectContaining({ type: "run-queued", executionId: "queued-run" }));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("starts a persisted queued run after runtime recovery", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-queued-recovery-"));
    try {
      const database = new NodeDatabase();
      const workspace = database.connection.prepare(
        "SELECT id FROM workspaces ORDER BY created_at LIMIT 1"
      ).get() as { id: string };
      const payload = {
        idempotencyKey: "start:recovered-run", workspace: root, body: "Plan this outcome",
        initialData: {
          version: 1, mode: "planning", executionId: "recovered-run", workItemId: null,
          agentId: "planner", agentName: "Planner", purpose: "Plan", model: "test/model",
          reasoningEffort: null, instructions: "", workspaceId: workspace.id,
          agentPresetId: "standard", mcpAccess: "none", mcpServers: [], grants: []
        }
      };
      const first: any = new AgentRuntime(context(), database.connection);
      await first.queue("bees-run", "recovered-run", { ...payload, background: true });

      const replacement: any = new AgentRuntime(context(), database.connection);
      replacement.newHandle = async () => ({
        sessionId: "recovered-run",
        handle: {
          agent: {
            session: { id: "recovered-run", seq: 0, events: [] },
            followup: () => undefined, whenIdle: () => new Promise(() => undefined), cancel: () => undefined
          },
          dispose: async () => undefined
        }
      });
      replacement.resumeQueued();
      for (let attempt = 0; attempt < 20 && database.connection.prepare(
        "SELECT 1 FROM bees_run_queue WHERE execution_id = 'recovered-run'"
      ).get(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1));

      expect(database.connection.prepare(
        "SELECT status FROM execution_links WHERE execution_id = 'recovered-run'"
      ).get()).toEqual({ status: "running" });
      expect(database.connection.prepare(
        "SELECT 1 FROM bees_run_queue WHERE execution_id = 'recovered-run'"
      ).get()).toBeUndefined();
      expect(database.connection.prepare(
        "SELECT delivery_id AS deliveryId FROM dsh_deliveries WHERE execution_id = 'recovered-run'"
      ).get()).toEqual({ deliveryId: "start:recovered-run" });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("resolves the newest configured Sol release numerically", () => {
    const models = [
      { id: "gpt-5.9-sol" }, { id: "gpt-5.10-sol" },
      { id: "gpt-6.0-terra" }, { id: "gpt-5.6-luna" }
    ];
    expect(latestCodexModel(models, "sol")).toEqual({ id: "gpt-5.10-sol" });
    expect(latestCodexModel(models, "terra")).toEqual({ id: "gpt-6.0-terra" });
    expect(latestCodexModel(models, "luna")).toEqual({ id: "gpt-5.6-luna" });
  });

  it("keeps Tauri as a one-command launcher and opens Bees directly", () => {
    const permission = readFileSync(new URL(
      "../src-tauri/permissions/bees-ui.toml", import.meta.url
    ), "utf8");
    const capability = readFileSync(new URL(
      "../src-tauri/capabilities/default.json", import.meta.url
    ), "utf8");
    const entry = readFileSync(new URL("../src/entry.ts", import.meta.url), "utf8");
    const profile = readFileSync(new URL(
      "../dsh-runtime/profile/cordis.patch.yml", import.meta.url
    ), "utf8");
    const localAiClient = readFileSync(new URL(
      "../dsh-runtime/plugins/local-ai/lib/client.js", import.meta.url
    ), "utf8");
    const freeAiHost = readFileSync(new URL(
      "../dsh-runtime/plugins/free-ai/lib/index.js", import.meta.url
    ), "utf8");
    const tauri = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
    expect(permission).toContain('"ensure_dsh_runtime"');
    expect(permission).toContain('"start_local_model"');
    expect(permission).toContain('"local_model_connection"');
    expect(permission).toContain('"open_external_url"');
    expect(capability).toContain('"http://127.0.0.1:*"');
    expect(permission).not.toContain("db_query");
    expect(entry).toContain('invoke("ensure_dsh_runtime")');
    expect(entry).not.toContain("/bees-auth?token=");
    expect(tauri).toContain('"{}/bees-auth?token={}"');
    expect(tauri).toContain(".navigate(url)");
    expect(tauri).toContain("model_id: Option<String>");
    expect(localAiClient).toContain('status?.state === "starting"');
    expect(readFileSync(new URL("../src-tauri/src/local_models.rs", import.meta.url), "utf8"))
      .toContain("starts: Mutex<HashMap<String, Arc<AtomicBool>>>");
    expect(tauri).toContain('body.contains(r#""product":"bees""#)');
    expect(profile).toMatch(/id: ui-settings-models\n  disabled: true/);
    expect(profile).toContain("local-openai:");
    expect(profile).not.toContain("freellmapi:");
    expect(profile).toContain("name: '@bees/dsh-local-ai'");
    expect(profile).toContain("name: '@bees/dsh-free-ai'");
    expect(profile).toContain("name: '@bees/dsh-custom-ai'");
    expect(profile).toContain("name: '@bees/dsh-subscriptions'");
    expect(freeAiHost).toContain('const API_KEY_REF = "BEES_FREELLMAPI_API_KEY"');
    expect(freeAiHost).toContain('dbPath: join(dataRoot, "freeapi.db")');
    expect(tauri).toContain('.join("freellmapi").join("server.mjs").is_file()');
    expect(tauri).toContain('.env("BEES_RUNTIME_ROOT", &runtime)');
    expect(profile).toContain("provider: local-openai");
    expect(profile).toContain("model: active");
    expect(client).toContain('id: "bees-product"');
    expect(client).toContain("class BeesErrorBoundary extends React.Component");
    expect(client).toContain("}, BeesErrorBoundary));");
    expect(client).toContain('event.code !== "KeyD"');
    expect(client).toContain("event.metaKey || event.ctrlKey");
    expect(client).toContain('toggleAttribute("data-bees-debug-dsh")');
    expect(client).toMatch(/\[data-bees-debug-dsh\] \.bees-app\{[^}]*display:none/);
    expect(client).toMatch(/\.bees-main\{[^}]*min-width:0;min-height:0;overflow:hidden/);
    expect(client).not.toContain('id: "bees-navigation"');
    expect(client).not.toContain('["dsh-settings", "DSH settings"]');
    expect(client).toContain('button[aria-haspopup="dialog"][aria-expanded]');
    expect(client).toContain('action: "create_organization"');
    expect(client).toContain('action: "create_run"');
    expect(client).toContain('ctx.uiSession.pendingInteractions');
    expect(client).toContain('"Approve once"');
    expect(client).toContain('h(FilePreview, { target: viewer, onClose: () => setViewer(null) })');
    expect(client).toContain('h(MarkdownText, { text: file.content })');
    expect(client).not.toContain('const LOCAL_MODELS = [');
    expect(localAiClient).toContain('const LOCAL_MODELS = [');
    expect(localAiClient).toContain('"data-model-toggle": "download"');
    expect(localAiClient).toContain('"data-model-toggle": "run"');
    expect(localAiClient).toContain('invokeLocal("delete_local_model"');
    expect(tauri).toMatch(/const BEES_PLUGINS[\s\S]*?"dsh-subscriptions"/);
    expect(tauri).toContain('BEES_PLUGINS.map(|package| ("@bees", package))');
    expect(client).toContain('action: "edit_process"');
    expect(client).not.toContain('openButton.textContent = "Open Bees"');
    expect(client).not.toContain("data.beesOpen");
    expect(client).not.toContain("window.prompt");
    expect(client).not.toContain("window.confirm");
    expect(client).toContain('document.createElement("dialog")');
    expect(client).toContain('["waiting", "failed"].includes(item.runtimePhase)');
    expect(client).not.toContain('summary.origin === "subagent"');
    expect(client).not.toContain('bees-subagent-card');
    expect(client).toContain('`Parent: ${parentPath}`');
    expect(client).not.toContain('function AgentActivity');
    expect(client).toContain('"New work"');
    expect(client).not.toContain("<iframe");
  });

  it("keeps only a completed turn when replacing an interrupted session", () => {
    const events = [
      { type: "turn/start", seq: 0 },
      { type: "user/message", seq: 1 },
      { type: "turn/end", seq: 2 },
      { type: "turn/start", seq: 3 },
      { type: "approval/asked", seq: 4 }
    ];
    expect(safeRecoverySeed(events)).toEqual(events.slice(0, 3));
  });

  it("reindexes a recovery seed after excluding team events", () => {
    const events = [
      { type: "turn/start", seq: 0 },
      { type: "team/member/spawned", seq: 1 },
      { type: "user/message", seq: 2, data: { source: { kind: "team-message" } } },
      { type: "user/message", seq: 3 },
      { type: "turn/end", seq: 4 },
    ];
    expect(safeRecoverySeed(events)).toEqual([
      events[0],
      { ...events[3], seq: 1 },
      { ...events[4], seq: 2 },
    ]);
  });

  it("includes internal prompt context in the user-facing run transcript", async () => {
    const events = [
      { type: "user/message", time: 1, data: { id: "runtime", content: [{ type: "text", text: "Current runtime context" }], source: { kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt" } } },
      { type: "user/message", time: 2, data: { id: "skills", content: [{ type: "text", text: "<available_skills>" }], source: { kind: "skill-catalog" } } },
      { type: "user/message", time: 3, data: { id: "task", content: [{ type: "text", text: "Complete this work item" }], source: { kind: "user" } } },
      { type: "assistant/message", time: 4, data: { message: { id: "answer", content: [{ type: "text", text: "Done" }] } } }
    ];
    const runtime: any = Object.create(AgentRuntime.prototype);
    runtime.run = () => ({ currentSessionId: "session" });
    runtime.live = new Map([["run", { handle: { agent: { session: { snapshotEvents: () => events } } } }]]);
    runtime.database = { prepare: () => ({ all: () => [] }) };
    const history = await runtime.history("run");
    expect(history.messages.map(({ id }: { id: string }) => id)).toEqual(["runtime", "skills", "task", "answer"]);
  });

  it("provides reviewers with durable approval evidence", async () => {
    const database = new NodeDatabase();
    const stage = database.connection.prepare(`
      SELECT s.id AS stageId, s.process_id AS processId FROM stages s
      JOIN processes p ON p.id = s.process_id WHERE p.kind = 'goals' AND s.driver = 'agent'
    `).get() as { stageId: string; processId: string };
    database.connection.prepare(`
      INSERT INTO work_items (id, process_id, stage_id, kind, title, created_at, updated_at)
      VALUES ('goal', ?, ?, 'goal', 'Goal', '2026-01-01', '2026-01-01')
    `).run(stage.processId, stage.stageId);
    const events = [
      { type: "tool/call", seq: 3, time: 3_000, data: { name: "ask_user_question", callId: "approval-call", arguments: "Approve?" } },
      { type: "tool/result", seq: 4, time: 4_000, data: { message: { source: { callId: "approval-call" }, content: [{ type: "text", text: "approved" }] } } }
    ];
    const runtime = new AgentRuntime({
      on: () => () => undefined,
      sessionPersistence: { inspect: async () => ({ events }) }
    }, database.connection);
    insertRun(database, "completed", "goal");
    const workspace = database.connection.prepare("SELECT id FROM workspaces ORDER BY created_at LIMIT 1").get() as { id: string };
    database.connection.prepare(`
      INSERT INTO execution_links
        (execution_id, workspace_id, work_item_id, agent_name, current_session_id, instance_uid,
         run_directory, config_json, status, created_at, updated_at)
      VALUES ('candidate', ?, 'goal', 'bees-run', 'candidate-session', 'candidate-uid', '/tmp/candidate',
        ?, 'completed', '2026-01-02', '2026-01-02')
    `).run(workspace.id, JSON.stringify({ version: 1, mode: "work", stagePurpose: "worker" }));

    const evidence = await runtime.reviewEvidence("candidate") as any;
    expect(evidence.executions.map(({ executionId }: any) => executionId)).toEqual(["run", "candidate"]);
    expect(evidence.executions[0].sessions[0]).toMatchObject({
      sessionId: "session"
    });
    expect(evidence.executions[0].sessions[0].timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool/call", tool: "ask_user_question", callId: "approval-call" }),
      expect.objectContaining({ type: "tool/result", callId: "approval-call", error: false })
    ]));
  });

  it("preserves stable @ and $ identity independently of display labels", () => {
    expect(typedReferences(
      "Ask @[Design team](bees:team:team-1) to read $[Quarterly folder](bees:location:folder-9)"
    )).toEqual([
      { namespace: "@", label: "Design team", kind: "team", id: "team-1" },
      { namespace: "$", label: "Quarterly folder", kind: "location", id: "folder-9" }
    ]);
  });

  it("publishes outputs directly into the location", () => {
    const workspace = mkdtempSync(join(tmpdir(), "bees-publish-run-"));
    const location = mkdtempSync(join(tmpdir(), "bees-publish-location-"));
    mkdirSync(join(workspace, "outputs"));
    writeFileSync(join(workspace, "outputs", "answer.txt"), "first");
    expect(copyOutputs(workspace, { id: "loc-1", name: "Answers", localPath: location }, "run-1")).toMatchObject({
      files: 1, bytes: 5, destination: ".", existing: false
    });
    writeFileSync(join(workspace, "outputs", "answer.txt"), "second");
    // overwrite works
    copyOutputs(workspace, { id: "loc-1", name: "Answers", localPath: location }, "run-1");
    expect(readFileSync(join(location, "answer.txt"), "utf8")).toBe("second");
    rmSync(workspace, { recursive: true });
    rmSync(location, { recursive: true });
  });

  it("checkpoints approval details without changing the wait at startup", () => {
    const database = new NodeDatabase();
    const runtime = new AgentRuntime(context(), database.connection);
    insertRun(database);
    runtime.onSessionEvent({ id: "session" }, {
      type: "approval/asked",
      seq: 4,
      data: { id: "approval-1", toolName: "bash", callId: "call-1", reason: "Publish outputs" }
    });

    expect(database.connection.prepare(
      "SELECT status FROM execution_links WHERE execution_id = 'run'"
    ).get()).toEqual({ status: "waiting_for_approval" });
    expect(runtime.pendingApproval("run")).toMatchObject({
      approvalId: "approval-1",
      toolName: "bash",
      reason: "Publish outputs"
    });

    const replacement = new AgentRuntime(context(), database.connection);
    expect(database.connection.prepare(
      "SELECT status FROM execution_links WHERE execution_id = 'run'"
    ).get()).toEqual({ status: "waiting_for_approval" });
    expect(replacement.needsRecovery("run")).toBe(true);
    expect(replacement.pendingApproval("run")).toMatchObject({ approvalId: "approval-1" });
  });

  it("keeps a checkpointed DSH question waiting while its session is replaced", async () => {
    const database = new NodeDatabase();
    const runtime = new AgentRuntime(context(), database.connection);
    insertRun(database);
    runtime.onSessionEvent({ id: "session" }, {
      type: "tool/call", seq: 4,
      data: { name: "ask_user_question", callId: "question-1", arguments: JSON.stringify({ questions: [{ id: "market", question: "Which market?" }] }) }
    });
    expect(database.connection.prepare(
      "SELECT status FROM execution_links WHERE execution_id = 'run'"
    ).get()).toEqual({ status: "waiting_for_input" });
    expect(runtime.pendingInteraction("run")).toMatchObject({
      kind: "question", callId: "question-1"
    });

    // Bees asks the question again itself; the run stays waiting until the person answers.
    const asked: unknown[] = [];
    const replacement = new AgentRuntime({ ...context(), userQuestions: { ask: (request: unknown) => { asked.push(request); return new Promise(() => undefined); } } }, database.connection);
    expect(database.connection.prepare(
      "SELECT status FROM execution_links WHERE execution_id = 'run'"
    ).get()).toEqual({ status: "waiting_for_input" });
    expect(replacement.needsRecovery("run")).toBe(true);
    expect(replacement.pendingApproval("run")).toBeNull();
    (replacement as any).newHandle = async () => ({
      sessionId: "replacement-session",
      handle: {
        agent: {
          session: { seq: 0 }, followup: () => undefined,
          whenIdle: () => new Promise(() => undefined)
        },
        dispose: async () => undefined
      }
    });

    await replacement.admit("bees-run", "run", {
      idempotencyKey: "recover-question", body: "Re-present Which market?"
    });

    expect(database.connection.prepare(
      "SELECT status FROM execution_links WHERE execution_id = 'run'"
    ).get()).toEqual({ status: "waiting_for_input" });
  });

  it("tracks a work review separately from an ordinary question", () => {
    const database = new NodeDatabase();
    const runtime = new AgentRuntime(context(), database.connection);
    insertRun(database);
    runtime.onSessionEvent({ id: "session" }, {
      type: "tool/call", seq: 4,
      data: {
        name: "bees_request_work_review", callId: "review-1",
        arguments: JSON.stringify({ summary: "Draft ready" })
      }
    });

    expect(runtime.pendingInteraction("run")).toMatchObject({
      kind: "work-review", callId: "review-1"
    });
    expect(database.connection.prepare(
      "SELECT status FROM execution_links WHERE execution_id = 'run'"
    ).get()).toEqual({ status: "waiting_for_input" });
    expect(database.connection.prepare(`
      SELECT count(*) AS count FROM dsh_audit_events WHERE event_type = 'work-review-requested'
    `).get()).toEqual({ count: 1 });

    runtime.onSessionEvent({ id: "session" }, {
      type: "tool/result", seq: 5,
      data: { message: { source: { callId: "review-1" }, content: [] } }
    });
    expect(runtime.pendingInteraction("run")).toBeNull();
    expect(database.connection.prepare(`
      SELECT count(*) AS count FROM dsh_audit_events WHERE event_type = 'work-review-answered'
    `).get()).toEqual({ count: 1 });
  });

  it("keeps active processing in its durable state across startup", () => {
    const database = new NodeDatabase();
    new AgentRuntime(context(), database.connection);
    const stage = database.connection.prepare(`
      SELECT s.id AS stageId, s.process_id AS processId FROM stages s
      JOIN processes p ON p.id = s.process_id WHERE p.kind = 'goals' AND s.driver = 'agent'
    `).get() as { stageId: string; processId: string };
    database.connection.prepare(`
      INSERT INTO work_items
        (id, process_id, stage_id, kind, title, runtime_phase, created_at, updated_at)
      VALUES ('goal', ?, ?, 'goal', 'Goal', 'running', '2026-01-01', '2026-01-01')
    `).run(stage.processId, stage.stageId);
    insertRun(database, "running", "goal");

    const replacement = new AgentRuntime(context(), database.connection);

    expect(database.connection.prepare(
      "SELECT status FROM execution_links WHERE execution_id = 'run'"
    ).get()).toEqual({ status: "running" });
    expect(database.connection.prepare(`
      SELECT stage_id AS stageId, runtime_phase AS runtimePhase FROM work_items WHERE id = 'goal'
    `).get()).toEqual({ stageId: stage.stageId, runtimePhase: "running" });
    expect(replacement.needsRecovery("run")).toBe(true);
    expect(database.connection.prepare(`
      SELECT count(*) AS count FROM dsh_audit_events WHERE event_type = 'run-interrupted'
    `).get()).toEqual({ count: 0 });
  });

  it("does not migrate legacy interrupted runs", () => {
    const database = new NodeDatabase();
    new AgentRuntime(context(), database.connection);
    insertRun(database, "interrupted");

    const replacement = new AgentRuntime(context(), database.connection);

    expect(database.connection.prepare(
      "SELECT status FROM execution_links WHERE execution_id = 'run'"
    ).get()).toEqual({ status: "interrupted" });
    expect(replacement.needsRecovery("run")).toBe(false);
  });

  it("revives a cancelled human wait after an orchestration heartbeat failure", () => {
    const database = new NodeDatabase();
    const stage = database.connection.prepare(`
      SELECT s.id AS stageId, s.process_id AS processId FROM stages s
      JOIN processes p ON p.id = s.process_id WHERE p.kind = 'goals' AND s.driver = 'agent'
    `).get() as { stageId: string; processId: string };
    database.connection.prepare(`
      INSERT INTO work_items (id, process_id, stage_id, kind, title, created_at, updated_at)
      VALUES ('goal', ?, ?, 'goal', 'Goal', '2026-01-01', '2026-01-01')
    `).run(stage.processId, stage.stageId);
    const runtime = new AgentRuntime(context(), database.connection);
    insertRun(database, "running", "goal");
    runtime.onSessionEvent({ id: "session" }, {
      type: "tool/call", seq: 4,
      data: { name: "ask_user_question", callId: "question-1", arguments: "Continue?" }
    });
    database.connection.prepare("UPDATE execution_links SET status = 'cancelled' WHERE execution_id = 'run'").run();
    database.connection.prepare(`
      UPDATE work_items SET runtime_phase = 'failed', runtime_error = 'activity Heartbeat timeout'
      WHERE id = (SELECT work_item_id FROM execution_links WHERE execution_id = 'run')
    `).run();

    const replacement = new AgentRuntime(context(), database.connection);
    expect(database.connection.prepare(
      "SELECT status FROM execution_links WHERE execution_id = 'run'"
    ).get()).toEqual({ status: "cancelled" });
    expect(replacement.needsRecovery("run")).toBe(true);
    expect(replacement.pendingInteraction("run")).toMatchObject({ kind: "question", callId: "question-1" });
  });

  it("records an aborted question as cancelled rather than answered", () => {
    const database = new NodeDatabase();
    const runtime = new AgentRuntime(context(), database.connection);
    insertRun(database);
    runtime.onSessionEvent({ id: "session" }, {
      type: "tool/call", seq: 4,
      data: { name: "ask_user_question", callId: "question-1", arguments: "Continue?" }
    });
    runtime.onSessionEvent({ id: "session" }, {
      type: "tool/result", seq: 5,
      data: { error: { code: "ASK_ABORTED" }, message: { source: { callId: "question-1" }, content: [] } }
    });
    expect(database.connection.prepare(`
      SELECT count(*) AS count FROM dsh_audit_events WHERE event_type = 'question-cancelled'
    `).get()).toEqual({ count: 1 });
  });

  it("records a completed tool boundary once under duplicate delivery", () => {
    const database = new NodeDatabase();
    const runtime = new AgentRuntime(context(), database.connection);
    insertRun(database);
    const event = {
      type: "tool/result",
      seq: 7,
      data: { message: { source: { callId: "call-1" }, content: [{ type: "text", text: "done" }] } }
    };
    runtime.onSessionEvent({ id: "session" }, event);
    runtime.onSessionEvent({ id: "session" }, event);
    expect(database.connection.prepare(`
      SELECT count(*) AS count FROM bees_run_checkpoints WHERE transition = 'step_completed'
    `).get()).toEqual({ count: 1 });
  });

  it("removes an unstarted execution when DSH cannot create its session", async () => {
    const database = new NodeDatabase();
    const workspace = database.connection.prepare(
      "SELECT id FROM workspaces ORDER BY created_at LIMIT 1"
    ).get() as { id: string };
    const runDirectory = mkdtempSync(join(tmpdir(), "bees-retry-"));
    const runtime = new AgentRuntime({
      on: () => () => undefined,
      agentPresets: { defaultId: "standard", mount: async () => undefined },
      agentDefaultModel: {
        currentSelection: () => ({ provider: "test-default", model: "configured-model" })
      },
      agents: { create: async (options: any) => {
        expect(options.agentOptions).toEqual({
          provider: "test-default", model: "configured-model"
        });
        throw new Error("provider unavailable");
      } },
      approval: { setPolicy: () => undefined },
      sessionPersistence: { load: async () => ({ events: [] }) }
    }, database.connection);
    await expect(runtime.admit("bees-run", "retryable", {
      idempotencyKey: "retryable-start",
      workspace: runDirectory,
      body: "Plan an outcome",
      initialData: {
        version: 1, mode: "planning", executionId: "retryable", workItemId: null,
        agentId: "bees-plan", agentName: "Ask Bees", purpose: "Outcome", model: null,
        instructions: "Plan", workspaceId: workspace.id, agentPresetId: "standard",
        mcpAccess: "all", mcpServers: [],
        grants: []
      }
    })).rejects.toThrow("provider unavailable");
    expect(database.connection.prepare(
      "SELECT 1 FROM execution_links WHERE execution_id = 'retryable'"
    ).get()).toBeUndefined();
    rmSync(runDirectory, { recursive: true });
  });

  it("freezes Latest Sol and its effort before opening the DSH session", async () => {
    const database = new NodeDatabase();
    const workspace = database.connection.prepare(
      "SELECT id FROM workspaces ORDER BY created_at LIMIT 1"
    ).get() as { id: string };
    const runDirectory = mkdtempSync(join(tmpdir(), "bees-sol-"));
    const runtime = new AgentRuntime({
      on: () => () => undefined,
      llm: { listModels: async () => [
        { id: "gpt-5.9-sol" }, { id: "gpt-5.10-sol" }, { id: "gpt-6.0-terra" }
      ] },
      agents: { create: async (options: any) => {
        expect(options.agentOptions).toEqual({
          provider: "openai-codex", model: "gpt-5.10-sol", reasoningEffort: "high"
        });
        throw new Error("stop after selection");
      } },
      approval: { setPolicy: () => undefined },
      sessionPersistence: { load: async () => ({ events: [] }) }
    } as any, database.connection);
    await expect(runtime.admit("bees-run", "latest-sol", {
      idempotencyKey: "latest-sol-start", workspace: runDirectory, body: "Do the work",
      initialData: {
        version: 1, mode: "planning", executionId: "latest-sol", workItemId: null,
        agentId: "bees-plan", agentName: "Ask Bees", purpose: "Outcome",
        model: `openai-codex/${LATEST_SOL_MODEL}`, reasoningEffort: "high",
        instructions: "Plan", workspaceId: workspace.id, agentPresetId: "standard",
        mcpAccess: "all", mcpServers: [], grants: []
      }
    })).rejects.toThrow("stop after selection");
    rmSync(runDirectory, { recursive: true });
  });

  it("preserves the original DSH failure across activity retries", async () => {
    const database = new NodeDatabase();
    const runtime = new AgentRuntime(context(), database.connection);
    insertRun(database, "failed");
    database.connection.prepare(`
      INSERT INTO dsh_deliveries
        (delivery_id, execution_id, submission_id, outcome, error_json, created_at, settled_at)
      VALUES ('delivery', 'run', 'submission', 'failed', ?, '2026-01-01', '2026-01-01')
    `).run(JSON.stringify({ message: "configured model is unavailable" }));

    await expect(runtime.executeStage("run", {})).rejects.toThrow("configured model is unavailable");
  });

  it("only reports an explicit Temporal cancellation as a user stop", async () => {
    const database = new NodeDatabase();
    const runtime = new AgentRuntime(context(), database.connection);
    insertRun(database);
    database.connection.prepare(`
      INSERT INTO dsh_deliveries (delivery_id, execution_id, submission_id, created_at)
      VALUES ('delivery', 'run', 'submission', '2026-01-01')
    `).run();
    const cancellations: unknown[] = [];
    (runtime as any).live.set("run", {
      approvalAbort: new AbortController(),
      handle: { agent: { cancel: (reason: unknown) => cancellations.push(reason) } }
    });

    const shutdown = new AbortController();
    shutdown.abort(new Error("WORKER_SHUTDOWN"));
    await expect((runtime as any).waitForDelivery("run", "submission", shutdown.signal))
      .rejects.toThrow("WORKER_SHUTDOWN");
    expect(cancellations).toEqual([]);

    const cancelled = new AbortController();
    cancelled.abort(new Error("CANCELLED"));
    await expect((runtime as any).waitForDelivery("run", "submission", cancelled.signal))
      .rejects.toThrow("CANCELLED");
    expect(cancellations).toEqual([{ kind: "user" }]);
  });
});
