import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AgentRuntime, safeRecoverySeed, typedReferences } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { NodeDatabase } from "./node-database.js";

function context(): { on: () => () => void } {
  return { on: () => () => undefined };
}

function insertRun(database: NodeDatabase, status = "running"): void {
  const at = "2026-01-01T00:00:00.000Z";
  database.connection.prepare(`
    INSERT INTO dsh_runs
      (execution_id, agent_name, current_session_id, instance_uid, workspace,
       config_json, status, created_at, updated_at)
    VALUES ('run', 'bees-run', 'session', 'uid', '/tmp/work', ?, ?, ?, ?)
  `).run(JSON.stringify({ version: 1, model: "bees-local/active" }), status, at, at);
}

describe("DSH recovery checkpoints", () => {
  it("keeps application commands on the bundled Bees origin", () => {
    const capability = JSON.parse(readFileSync(new URL(
      "../src-tauri/capabilities/default.json", import.meta.url
    ), "utf8")) as { remote?: { urls: string[] }; permissions: string[] };
    const permission = readFileSync(new URL(
      "../src-tauri/permissions/bees-ui.toml", import.meta.url
    ), "utf8");
    expect(capability.remote).toBeUndefined();
    expect(capability.permissions).toContain("allow-bees-ui");
    expect(permission).toMatch(/commands\.allow = \[[\s\S]*"db_query"/);
  });

  it("publishes the Bees browser bundle and disables DSH onboarding", () => {
    const manifest = JSON.parse(readFileSync(new URL(
      "../dsh-runtime/plugin/package.json", import.meta.url
    ), "utf8")) as { exports: Record<string, string> };
    const profile = readFileSync(new URL(
      "../dsh-runtime/profile/cordis.patch.yml", import.meta.url
    ), "utf8");
    const client = readFileSync(new URL(
      "../dsh-runtime/plugin/lib/client.js", import.meta.url
    ), "utf8");
    const server = readFileSync(new URL(
      "../dsh-runtime/plugin/lib/index.js", import.meta.url
    ), "utf8");
    const runtime = readFileSync(new URL(
      "../dsh-runtime/plugin/lib/agent-runtime.js", import.meta.url
    ), "utf8");
    const entry = readFileSync(new URL("../src/entry.ts", import.meta.url), "utf8");
    const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    expect(manifest.exports["./package.json"]).toBe("./package.json");
    expect(profile).toMatch(/id: ui-settings-models\n  disabled: true/);
    expect(client).not.toContain("<iframe");
    expect(client).toContain('location.assign("/bees-return")');
    expect(server).toContain("location: `http://127.0.0.1:${req.socket.localPort}${next}`");
    expect(server).toContain("HttpOnly; SameSite=Lax; Path=/");
    expect(server).toContain("location: appUrl");
    expect(runtime).toContain('this.ctx.approval.setPolicy(handle.agent, "never")');
    expect(entry).toContain('import "./styles.css";');
    expect(vite).toContain('base: "./"');
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
      "SELECT status FROM dsh_runs WHERE execution_id = 'run'"
    ).get()).toEqual({ status: "waiting_for_approval" });
    expect(runtime.pendingApproval("run")).toMatchObject({
      approvalId: "approval-1",
      toolName: "bash",
      reason: "Publish outputs"
    });

    const replacement = new AgentRuntime(context(), database.connection);
    expect(database.connection.prepare(
      "SELECT status FROM dsh_runs WHERE execution_id = 'run'"
    ).get()).toEqual({ status: "interrupted" });
    expect(replacement.pendingApproval("run")).toMatchObject({ approvalId: "approval-1" });
  });

  it("records a completed tool boundary once under duplicate event delivery", () => {
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
});
