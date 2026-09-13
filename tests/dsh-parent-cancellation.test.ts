import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { ProcessRuntime } from "../dsh-runtime/plugin/lib/process-runtime.js";
import { BeesProduct } from "../dsh-runtime/plugin/lib/product.js";
import { NodeDatabase } from "./node-database.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const { Context } = require("@deepseek-ai/cordis");
const { default: AgentLoop } = require("@deepseek-ai/dsh-agent-loop");
const { mountAgentLoopTestDependencies } = require("@deepseek-ai/dsh-agent-loop-testkit");
const { SessionProjectionRegistry } = require("@deepseek-ai/dsh-session-projection");
const { LlmAdapter, createUserMessage } = require("@deepseek-ai/dsh-llm");
const { defineTool } = require("@deepseek-ai/dsh-tools");

it("Stop cancels the real parent agent before Temporal replies and discards a late Yahoo delegation", async () => {
  const ctx = new Context();
  const database = new NodeDatabase();
  let releaseResponse!: () => void;
  let markStarted!: (signal: AbortSignal) => void;
  let replyTemporal!: () => void;
  const response = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const started = new Promise<AbortSignal>((resolve) => { markStarted = resolve; });
  const temporalReply = new Promise<void>((resolve) => { replyTemporal = resolve; });
  const launchYahoo = vi.fn(() => ({}));
  let requests = 0;
  let handle: any;
  try {
    await mountAgentLoopTestDependencies(ctx);
    await ctx.plugin(AgentLoop, { agents: [] });
    ctx.llm.registerAdapter(["test"], new class extends LlmAdapter {
      async *stream({ signal }: { signal: AbortSignal }) {
        requests++;
        markStarted(signal);
        // Deliberately return a late response even after cancellation, like buffered provider output.
        await response;
        const block = { type: "tool-call", id: "late-yahoo", name: "bees_delegate_work", arguments: "{}" };
        yield { type: "block-start", index: 0, blockType: "tool-call" };
        yield { type: "tool-call-delta", index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments };
        yield { type: "block-end", index: 0, block };
        yield { type: "finish", reason: { kind: "tool-calls" } };
      }
    }());
    handle = await ctx.agents.create({ sessionId: "parent-run", agentOptions: { provider: "test", model: "test" },
      setup: (agentCtx: any) => { agentCtx.tools.register(defineTool({
        name: "bees_delegate_work", description: "Launch Yahoo", parameters: {},
        output: { schema: { type: "object", additionalProperties: false, properties: {} }, render: () => [] }, execute: launchYahoo
      })); } });
    const agents: any = new AgentRuntime({ on: () => () => undefined }, database.connection);
    agents.live.set("parent-run", { handle, approvalAbort: new AbortController() });
    const cancelWorkflow = vi.fn(() => temporalReply);
    const processes = new ProcessRuntime(database.connection, {
      client: { workflow: { getHandle: () => ({ cancel: cancelWorkflow }) } },
      abortAgent: (executionId) => agents.abort(executionId)
    });
    const product = new BeesProduct(database.connection, agents, processes, "/tmp");
    const stage = database.connection.prepare(`SELECT s.id, s.process_id AS processId
      FROM stages s JOIN processes p ON p.id = s.process_id WHERE p.kind = 'goals' AND s.driver = 'agent'
    `).get() as { id: string; processId: string };
    database.connection.prepare(`INSERT INTO work_items
      (id, process_id, stage_id, title, runtime_phase, runtime_execution_id, created_at, updated_at)
      VALUES ('parent', ?, ?, 'News digest', 'running', 'parent-run', 'now', 'now')
    `).run(stage.processId, stage.id);
    handle.agent.followup(createUserMessage({ content: [{ type: "text", text: "Collect news" }], source: { kind: "user" } }));
    const signal = await started;
    handle.agent.followup(createUserMessage({ content: [{ type: "text", text: "Queued follow-up" }], source: { kind: "user" } }));
    const stopping = product.command({ action: "cancel_item", itemId: "parent" });
    expect(signal.aborted).toBe(true);
    expect(cancelWorkflow).toHaveBeenCalledOnce();
    releaseResponse();
    await handle.agent.whenIdle();
    expect(launchYahoo).not.toHaveBeenCalled();
    expect(requests).toBe(1);
    expect(handle.agent.session.snapshotEvents().filter(({ type }: any) => type === "turn/end").at(-1).data.reason.kind)
      .toBe("aborted");
    replyTemporal();
    await stopping;
  } finally {
    releaseResponse();
    replyTemporal();
    await handle?.dispose();
    await ctx.fiber.dispose();
    database.connection.close();
  }
});
