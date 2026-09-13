import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { NodeDatabase } from "./node-database.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const { Context } = require("@deepseek-ai/cordis");
const { default: AgentLoop } = require("@deepseek-ai/dsh-agent-loop");
const { mountAgentLoopTestDependencies } = require("@deepseek-ai/dsh-agent-loop-testkit");
const { LlmAdapter, createUserMessage } = require("@deepseek-ai/dsh-llm");

it("reads only native attachments admitted to the calling run, and never writes them", () => {
  const root = mkdtempSync(join(tmpdir(), "bees-native-uploads-"));
  const database = new NodeDatabase();
  try {
    const runDirectory = join(root, "run");
    mkdirSync(runDirectory);
    const uploaded = join(root, "report.pdf");
    const other = join(root, "other.pdf");
    writeFileSync(uploaded, Buffer.from([0, 1, 255]));
    writeFileSync(other, "other session");
    let guard: any;
    new AgentRuntime({ on: () => () => {}, tools: { guard: (value: any) => { guard = value; } },
      attachments: { fileHostPath: (ref: any) => {
        if (ref.attachmentId !== "admitted") throw new Error("Invalid attachment");
        return uploaded;
      } } }, database.connection);
    const workspace = database.connection.prepare("SELECT id FROM workspaces LIMIT 1").get()!;
    database.connection.prepare(`INSERT INTO execution_links
      (execution_id, workspace_id, agent_name, current_session_id, instance_uid,
       run_directory, config_json, status, created_at, updated_at)
      VALUES ('run', ?, 'agent', 'session', 'uid', ?, '{}', 'running', 'now', 'now')`
    ).run(String(workspace.id), runDirectory);
    const events = [{ type: "user/message", data: { content: [
      { type: "file", attachment: { attachmentId: "admitted", name: "report.pdf", bytes: 3 } }
    ] } }];
    const exec = (name: string, path: string, history = events) => ({ name, arguments: { file_path: path },
      agent: { session: { id: "session", header: {}, snapshotEvents: () => history } } });
    expect(guard(exec("read", uploaded))).toBeUndefined();
    expect(guard(exec("read", other))).toContain("outside this run");
    expect(guard(exec("write", uploaded))).toContain("outside this run");
    expect(guard(exec("read", uploaded, []))).toContain("outside this run");
    expect(guard(exec("read", root))).toContain("outside this run");
  } finally { database.connection.close(); rmSync(root, { recursive: true, force: true }); }
});

it("drains steering in the current turn and queued follow-ups before becoming idle", async () => {
  const ctx = new Context();
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const firstRequest = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  let handle: any;
  try {
    await mountAgentLoopTestDependencies(ctx);
    await ctx.plugin(AgentLoop, { agents: [] });
    ctx.llm.registerAdapter(["test"], new class extends LlmAdapter {
      async *stream() {
        calls++;
        if (calls === 1) { started(); await gate; }
        const block = { type: "text", text: "Acknowledged" };
        yield { type: "block-start", index: 0, blockType: "text" };
        yield { type: "text-delta", index: 0, text: block.text };
        yield { type: "block-end", index: 0, block };
        yield { type: "finish", reason: { kind: "stop" } };
      }
    }());
    handle = await ctx.agents.create({ sessionId: "native-queue", agentOptions: { provider: "test", model: "test" } });
    const message = (text: string) => createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } });
    handle.agent.followup(message("Start"));
    await firstRequest;
    handle.agent.followup(message("Queued"));
    handle.agent.steer(message("Steered"));
    expect(handle.agent.inbox.nextStep.length).toBe(1);
    expect(handle.agent.inbox.nextTurn.length).toBe(1);
    release();
    await handle.agent.whenIdle();
    const events = handle.agent.session.snapshotEvents();
    expect(events.filter((event: any) => event.type === "user/message")
      .map((event: any) => event.data.content[0].text)).toEqual(["Start", "Steered", "Queued"]);
    expect(handle.agent.inbox.nextStep).toHaveLength(0);
    expect(handle.agent.inbox.nextTurn).toHaveLength(0);
    expect(calls).toBe(3);
  } finally { release(); await handle?.dispose(); await ctx.fiber.dispose(); }
});

it("continues through a new managed session while the native viewer owns the previous writer", async () => {
  const ctx = new Context();
  const database = new NodeDatabase();
  let viewed: any;
  let runtime: any;
  try {
    await mountAgentLoopTestDependencies(ctx);
    await ctx.plugin(AgentLoop, { agents: [] });
    ctx.llm.registerAdapter(["test"], new class extends LlmAdapter {
      async *stream() {
        yield { type: "finish", reason: { kind: "stop" } };
      }
    }());
    viewed = await ctx.agents.create({ sessionId: "viewed", meta: { cwd: "/tmp" }, agentOptions: { provider: "test", model: "test" } });
    viewed.agent.followup(createUserMessage({ content: [{ type: "text", text: "Original work" }], source: { kind: "user" } }));
    await viewed.agent.whenIdle();
    ctx.provide("approval", { setPolicy: () => {} });
    runtime = new AgentRuntime(ctx, database.connection);
    runtime.setup = async () => {};
    runtime.installPolicies = () => {};
    const workspace = database.connection.prepare("SELECT id FROM workspaces LIMIT 1").get()!;
    database.connection.prepare(`INSERT INTO execution_links
      (execution_id, workspace_id, agent_name, current_session_id, instance_uid,
       run_directory, config_json, status, created_at, updated_at)
      VALUES ('native-resume', ?, 'agent', 'viewed', 'uid', '/tmp', ?, 'completed', 'now', 'now')`
    ).run(String(workspace.id), JSON.stringify({ model: "test/test", resolvedModel: "test/test", agentPresetId: "standard", workspaceId: workspace.id }));
    // This test exercises ownership and the real loop; the read handle supplies its durable snapshot.
    runtime.sessionEvents = async () => viewed.agent.session.snapshotEvents();
    const submission = await runtime.admit("bees-run", "native-resume", { uid: "uid", idempotencyKey: "continue", body: "More work" });
    const delivery = await runtime.waitForDelivery("native-resume", submission.submissionId, AbortSignal.timeout(1000));
    expect(delivery.outcome).toBe("completed");
    expect(runtime.run("native-resume").currentSessionId).not.toBe("viewed");
    expect(ctx.agents.get("viewed")).toBe(viewed.agent);
    expect(database.connection.prepare("SELECT metadata_json FROM dsh_audit_events WHERE event_type = 'replacement-run-created'").get()!.metadata_json)
      .toContain('"reason":"native-continuation"');
  } finally { await viewed?.dispose(); await ctx.fiber.dispose(); database.connection.close(); }
});
