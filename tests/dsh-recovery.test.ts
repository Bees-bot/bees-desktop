import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentRuntime,
  copyOutputs,
  safeRecoverySeed,
  typedReferences
} from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { NodeDatabase } from "./node-database.js";

function context(): { on: () => () => void } {
  return { on: () => () => undefined };
}

function insertRun(database: NodeDatabase, status = "running"): void {
  const at = "2026-01-01T00:00:00.000Z";
  const workspace = database.connection.prepare("SELECT id FROM workspaces ORDER BY created_at LIMIT 1").get() as { id: string };
  database.connection.prepare(`
    INSERT INTO execution_links
      (execution_id, workspace_id, agent_name, current_session_id, instance_uid,
       run_directory, config_json, status, created_at, updated_at)
    VALUES ('run', ?, 'bees-run', 'session', 'uid', '/tmp/work', ?, ?, ?, ?)
  `).run(workspace.id, JSON.stringify({ version: 1, model: null }), status, at, at);
}

describe("DSH-owned desktop and recovery", () => {
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
    const client = readFileSync(new URL(
      "../dsh-runtime/plugin/lib/client.js", import.meta.url
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
    expect(tauri).toContain('body == r#"{"status":"ok","runtime":"dsh","product":"bees"}"#');
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
    expect(client).toContain('.bees-main{min-width:0;min-height:0;overflow:hidden');
    expect(client).not.toContain('id: "bees-navigation"');
    expect(client).toContain('["dsh-settings", "DSH settings"]');
    expect(client).toContain('button[aria-haspopup="dialog"][aria-expanded]');
    expect(client).toContain('action: "create_organization"');
    expect(client).toContain('action: "create_run"');
    expect(client).not.toContain('const LOCAL_MODELS = [');
    expect(localAiClient).toContain('const LOCAL_MODELS = [');
    expect(localAiClient).toContain('"data-model-toggle": "download"');
    expect(localAiClient).toContain('"data-model-toggle": "run"');
    expect(localAiClient).toContain('invokeLocal("delete_local_model"');
    expect(tauri).toContain('("@bees", "dsh-subscriptions")');
    expect(client).toContain('action: "edit_process"');
    expect(client).not.toContain('openButton.textContent = "Open Bees"');
    expect(client).not.toContain("data.beesOpen");
    expect(client).not.toContain("window.prompt");
    expect(client).not.toContain("window.confirm");
    expect(client).toContain('document.createElement("dialog")');
    expect(client).toContain('item.runtimeError ? h("p", { className: "bees-error" }, item.runtimeError)');
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

  it("preserves stable @ and $ identity independently of display labels", () => {
    expect(typedReferences(
      "Ask @[Design team](bees:team:team-1) to read $[Quarterly folder](bees:location:folder-9)"
    )).toEqual([
      { namespace: "@", label: "Design team", kind: "team", id: "team-1" },
      { namespace: "$", label: "Quarterly folder", kind: "location", id: "folder-9" }
    ]);
  });

  it("publishes outputs into a run-specific directory without overwriting a prior publication", () => {
    const workspace = mkdtempSync(join(tmpdir(), "bees-publish-run-"));
    const location = mkdtempSync(join(tmpdir(), "bees-publish-location-"));
    mkdirSync(join(workspace, "outputs"));
    writeFileSync(join(workspace, "outputs", "answer.txt"), "first");
    expect(copyOutputs(workspace, { localPath: location }, "run-1")).toMatchObject({
      files: 1, bytes: 5, destination: "Bees outputs/run-1", existing: false
    });
    writeFileSync(join(workspace, "outputs", "answer.txt"), "second");
    expect(copyOutputs(workspace, { localPath: location }, "run-1").existing).toBe(true);
    expect(readFileSync(join(location, "Bees outputs", "run-1", "answer.txt"), "utf8")).toBe("first");
    rmSync(workspace, { recursive: true });
    rmSync(location, { recursive: true });
  });

  it("checkpoints approval details and detects the interrupted wait at startup", () => {
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
    ).get()).toEqual({ status: "interrupted" });
    expect(replacement.pendingApproval("run")).toMatchObject({ approvalId: "approval-1" });
  });

  it("projects a DSH question as human input and recovers it as agent work", () => {
    const database = new NodeDatabase();
    const runtime = new AgentRuntime(context(), database.connection);
    insertRun(database);
    runtime.onSessionEvent({ id: "session" }, {
      type: "tool/call", seq: 4,
      data: { name: "ask_user_question", callId: "question-1", arguments: "Which market?" }
    });
    expect(database.connection.prepare(
      "SELECT status FROM execution_links WHERE execution_id = 'run'"
    ).get()).toEqual({ status: "waiting_for_input" });
    expect(runtime.pendingInteraction("run")).toMatchObject({
      kind: "question", callId: "question-1"
    });

    const replacement = new AgentRuntime(context(), database.connection);
    expect(database.connection.prepare(
      "SELECT status FROM execution_links WHERE execution_id = 'run'"
    ).get()).toEqual({ status: "interrupted" });
    expect(replacement.pendingApproval("run")).toBeNull();
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
      agentPresets: { mount: async () => undefined },
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
        grants: []
      }
    })).rejects.toThrow("provider unavailable");
    expect(database.connection.prepare(
      "SELECT 1 FROM execution_links WHERE execution_id = 'retryable'"
    ).get()).toBeUndefined();
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
});
