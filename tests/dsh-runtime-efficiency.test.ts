import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { TOOL_PREVIEW_CHARS } from "../dsh-runtime/plugin/lib/context-policy.js";
import { NodeDatabase } from "./node-database.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const { Context } = require("@deepseek-ai/cordis");
const { createScope, scopeTarget } = require("@deepseek-ai/dsh-scope");
const { SessionStore } = require("@deepseek-ai/dsh-session");
const { SystemPrompt } = require("@deepseek-ai/dsh-system-prompt");
const { ToolRuntime, defineTool } = require("@deepseek-ai/dsh-tools");
const { SessionProjectionRegistry } = require("@deepseek-ai/dsh-session-projection");
const { TokenMeter } = require("@deepseek-ai/dsh-token-meter");
const { createAssistantMessage, createToolResultMessage } = require("@deepseek-ai/dsh-llm");

function harness() {
  const ctx: any = new Context();
  new SessionStore(ctx);
  new SessionProjectionRegistry(ctx);
  new TokenMeter(ctx);
  const prompt = new SystemPrompt(ctx, {});
  const tools = new ToolRuntime(ctx);
  const scopes: any[] = [];
  const database = new NodeDatabase();
  ctx.agentPresets = { mount: async () => undefined };
  ctx.credentials = { resolve: async () => undefined };
  const runtime: any = new AgentRuntime(ctx, database.connection);
  const workspaceId = String(database.connection.prepare("SELECT id FROM workspaces LIMIT 1").get()!.id);
  for (const name of ["fetch_sample", "shell_sample"]) tools.register(defineTool({
    name, description: name, parameters: {},
    output: { schema: { type: "object", additionalProperties: false, properties: {} },
      render: () => [{ type: "text", text: "ok" }] }, execute: () => ({})
  }));
  return {
    ctx, runtime, tools, prompt,
    async agent(id: string, parent?: any, managed = true) {
      const agent: any = {};
      const scope = createScope(ctx, agent, parent ? { parent } : {});
      scopes.push(scope);
      agent.ctx = scope.ctx.extend({ agent });
      agent.session = agent.ctx.sessions.create(id, parent ? { meta: { parentSession: parent.session.id } } : {});
      if (managed && !parent) {
        await runtime.setup(agent.ctx, {
          mode: "work", agentPresetId: "standard", workspaceId, workItemId: "work",
          mcpAccess: "none", mcpServers: [], grants: []
        }, id, "/tmp");
      }
      ctx.emit(scopeTarget(agent, agent), "agent/created", { agent });
      return agent;
    },
    async preStep(agent: any) {
      return ctx.waterfall(scopeTarget(agent, agent), "agent/pre-step", {
        agent, turn: 1, step: 1, messages: [], signal: new AbortController().signal
      }, async () => ({ kind: "enter", messages: agent.session.deriveMessages() }));
    },
    async request(agent: any, maxTokens?: number) {
      return ctx.waterfall(scopeTarget(agent, agent), "agent/request", {
        agent, turn: 1, step: 1, signal: new AbortController().signal
      }, async () => ({ provider: "test", model: "test", ...(maxTokens === undefined ? {} : { maxTokens }) }));
    },
    async find(agent: any, query: string) {
      const result = await tools.execute({ agent, callId: `find-${query}`, name: "bees_find_tools",
        arguments: { query }, signal: new AbortController().signal });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
    },
    async close() {
      for (const scope of scopes.reverse()) await scope.dispose();
      database.connection.close();
    }
  };
}

function result(agent: any, step: number, error = false, text = "same failure", name = "fetch_sample") {
  const session = agent.session;
  const callId = `call-${step}`;
  const args = name === "fetch_sample" ? '{"url":"https://example.com"}'
    : name === "read" ? '{"path":"outputs/brief.md"}' : '{}';
  session.append("step/start", { turn: 1, step });
  session.append("assistant/message", { turn: 1, step, stream: [], message: createAssistantMessage({
    source: { provider: "test", model: "test" },
    content: [{ type: "tool-call", id: callId, name, arguments: args }]
  }) }, { surfaceOp: "append" });
  session.append("tool/call", { turn: 1, step, callId, name, arguments: args });
  session.append("tool/result", { turn: 1, step, message: createToolResultMessage({
    callId, isError: error, content: [{ type: "text", text }]
  }), ...(error ? { error: { name: "FetchError", code: "HTTP_ERROR" } } : {}) }, { surfaceOp: "append" });
  session.append("step/end", { turn: 1, step });
}

const toolText = (agent: any) => agent.session.deriveMessages()
  .flatMap((message: any) => message.content)
  .filter((block: any) => block.type === "tool-result")
  .map((block: any) => block.content.filter((entry: any) => entry.type === "text").map((entry: any) => entry.text).join(""));

it("installs discovery and pruning on managed agents without changing their output settings", async () => {
  const h = harness();
  try {
    const parent = await h.agent("parent");
    const child = await h.agent("child", parent);
    const grandchild = await h.agent("grandchild", child);
    const unrelated = await h.agent("unrelated", undefined, false);
    expect(h.runtime.ownsSession(child.session)).toBe(true);
    expect(h.runtime.ownsSession(grandchild.session)).toBe(true);
    expect(h.runtime.ownsSession(unrelated.session)).toBe(false);
    const names = async (agent: any) => (await h.prompt.assemble({ scope: agent, agent })).tools.map((tool: any) => tool.name);
    expect(await names(parent)).toEqual(expect.arrayContaining(["bees_find_tools", "bees_read_tool_result"]));
    expect(await names(parent)).not.toContain("fetch_sample");
    await h.find(parent, "fetch_sample");
    await h.find(child, "shell_sample");
    expect(await names(parent)).toContain("fetch_sample");
    expect(await names(parent)).not.toContain("shell_sample");
    expect(await names(child)).toContain("shell_sample");
    expect(await names(child)).not.toContain("fetch_sample");
    expect(await names(grandchild)).not.toContain("shell_sample");
    expect(await names(unrelated)).toEqual(expect.arrayContaining(["fetch_sample", "shell_sample"]));

    for (const agent of [parent, child, grandchild]) {
      result(agent, 1, false, "large data ".repeat(4_000));
      await h.preStep(agent);
      expect(toolText(agent)[0].length).toBeLessThanOrEqual(TOOL_PREVIEW_CHARS);
      expect(agent.session.snapshotEvents().filter((event: any) => event.type === "compaction/prune")).toHaveLength(1);
      await expect(h.request(agent)).resolves.toEqual({ provider: "test", model: "test" });
      for (const maxTokens of [1_000, 32_000, 128_000])
        await expect(h.request(agent, maxTokens)).resolves.toEqual({ provider: "test", model: "test", maxTokens });
    }
    expect((await h.request(unrelated, 32_000)).maxTokens).toBe(32_000);
  } finally { await h.close(); }
});

it("leaves failed tool retries to the model on managed leads and peers", async () => {
  const h = harness();
  try {
    let attempts = 0;
    h.tools.register(defineTool({
      name: "failing_sample", description: "An unavailable tool", parameters: {},
      output: { schema: { type: "object", additionalProperties: false, properties: {} },
        render: () => [{ type: "text", text: "ok" }] },
      execute: () => { attempts++; throw new Error("service unavailable"); }
    }));
    const parent = await h.agent("retrying-parent");
    const child = await h.agent("retrying-child", parent);
    for (const agent of [parent, child]) {
      await h.find(agent, "failing_sample");
      for (let step = 1; step <= 3; step++) {
        const before = attempts;
        const failure = await h.tools.execute({ agent, callId: `failed-${step}`, name: "failing_sample",
          arguments: {}, signal: new AbortController().signal });
        expect(failure.isError).toBe(true);
        expect(attempts).toBe(before + 1);
        result(agent, step, true, "service unavailable", "failing_sample");
        await expect(h.preStep(agent)).resolves.toMatchObject({ kind: "enter" });
        expect(attempts).toBe(before + 1);
      }
    }
  } finally { await h.close(); }
});

it("allows unchanged and updated rereads even after old results are shortened", async () => {
  const h = harness();
  try {
    const agent = await h.agent("rereading");
    for (let step = 1; step <= 6; step++) {
      result(agent, step, false, `file version ${Math.ceil(step / 3)} `.repeat(600), "read");
      await expect(h.preStep(agent)).resolves.toMatchObject({ kind: "enter" });
    }
    expect(toolText(agent)[0]).toContain("Text shortened");
  } finally { await h.close(); }
});

it("allows a managed lead and peer to continue beyond 100 model steps", async () => {
  const h = harness();
  try {
    const parent = await h.agent("long-stage");
    const child = await h.agent("long-peer", parent);
    for (const agent of [parent, child]) {
      for (let step = 1; step <= 150; step++) {
        result(agent, step, false, `file version ${step}`, "read");
        await expect(h.preStep(agent)).resolves.toMatchObject({ kind: "enter" });
      }
    }
  } finally { await h.close(); }
});

it("does not send a request when newly pruned tool history cannot be flushed", async () => {
  const h = harness();
  try {
    const agent = await h.agent("flush-failure");
    result(agent, 1, true, "private error details ".repeat(400));
    const dispose = h.ctx.on("session/flush", () => { throw new Error("disk unavailable"); });
    await expect(h.preStep(agent)).rejects.toThrow("disk unavailable");
    // Pruning already landed in memory; a retry must still wait for its durable flush.
    await expect(h.preStep(agent)).rejects.toThrow("disk unavailable");
    expect(toolText(agent)[0]).toContain("private error details");
    dispose();
    await expect(h.preStep(agent)).resolves.toMatchObject({ kind: "enter" });
  } finally { await h.close(); }
});

it("leaves provider request retries to the provider policy for managed leads and peers", async () => {
  const h = harness();
  try {
    let retries = 0;
    h.ctx.on("agent/request-error", async () => { retries++; return { kind: "retry" }; });
    const parent = await h.agent("provider-parent");
    const child = await h.agent("provider-child", parent);
    const unrelated = await h.agent("other-provider", undefined, false);
    for (const agent of [parent, child, unrelated]) {
      await expect(h.ctx.waterfall(scopeTarget(agent, agent), "agent/request-error", {
        agent, turn: 1, step: 1, provider: "test",
        failure: { code: "TRANSPORT", message: "connection interrupted" },
        retryPolicy: { mode: "always" }, signal: new AbortController().signal
      }, async () => undefined)).resolves.toEqual({ kind: "retry" });
    }
    expect(retries).toBe(3);
  } finally { await h.close(); }
});
