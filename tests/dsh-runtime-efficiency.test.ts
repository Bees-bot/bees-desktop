import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { NodeDatabase } from "./node-database.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const { Context } = require("@deepseek-ai/cordis");
const { createScope, scopeTarget } = require("@deepseek-ai/dsh-scope");
const { SessionStore } = require("@deepseek-ai/dsh-session");
const { SystemPrompt } = require("@deepseek-ai/dsh-system-prompt");
const { ToolRuntime, defineTool } = require("@deepseek-ai/dsh-tools");
const { SessionProjectionRegistry } = require("@deepseek-ai/dsh-session-projection");
const { TokenMeter } = require("@deepseek-ai/dsh-token-meter");
const { createAssistantMessage, createToolResultMessage, createUserMessage } = require("@deepseek-ai/dsh-llm");

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

function result(agent: any, step: number, error = false, text = "same failure") {
  const session = agent.session;
  const callId = `call-${step}`;
  session.append("step/start", { turn: 1, step });
  session.append("assistant/message", { turn: 1, step, message: createAssistantMessage({
    source: { provider: "test", model: "test" },
    content: [{ type: "tool-call", id: callId, name: "fetch_sample", arguments: '{"url":"https://example.com"}' }]
  }) }, { surfaceOp: "append" });
  session.append("tool/call", { turn: 1, step, callId, name: "fetch_sample", arguments: '{"url":"https://example.com"}' });
  session.append("tool/result", { turn: 1, step, message: createToolResultMessage({
    callId, isError: error, content: [{ type: "text", text }]
  }), ...(error ? { error: { name: "FetchError", code: "HTTP_ERROR" } } : {}) }, { surfaceOp: "append" });
  session.append("step/end", { turn: 1, step });
}

function input(agent: any, kind: "user" | "plugin") {
  agent.session.append("user/message", createUserMessage({
    source: kind === "user" ? { kind } : { kind, plugin: "runtime-context", form: "snapshot", sections: [] },
    content: [{ type: "text", text: "Updated context" }]
  }), { surfaceOp: "append" });
}

const toolText = (agent: any) => agent.session.deriveMessages()
  .flatMap((message: any) => message.content)
  .filter((block: any) => block.type === "tool-result")
  .map((block: any) => block.content.filter((entry: any) => entry.type === "text").map((entry: any) => entry.text).join(""));

it("installs discovery, pruning and output caps on a managed parent and each published descendant without cross-scope filtering", async () => {
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
      expect(toolText(agent)[0].length).toBeLessThanOrEqual(2_000);
      expect(agent.session.snapshotEvents().filter((event: any) => event.type === "compaction/prune")).toHaveLength(1);
      expect((await h.request(agent, 32_000)).maxTokens).toBe(4_096);
      expect((await h.request(agent, 1_000)).maxTokens).toBe(1_000);
    }
    expect((await h.request(unrelated, 32_000)).maxTokens).toBe(32_000);
  } finally { await h.close(); }
});

it("stops three identical failed calls, ignores injected context as a reset, and resumes after success or actual user input", async () => {
  const h = harness();
  try {
    const agent = await h.agent("retrying");
    result(agent, 1, true, "failure ".repeat(600));
    await h.preStep(agent);
    input(agent, "plugin");
    result(agent, 2, true, "failure ".repeat(600));
    await h.preStep(agent);
    result(agent, 3, true, "failure ".repeat(600));
    await expect(h.preStep(agent)).rejects.toMatchObject({ code: "BEES_TOOL_LOOP" });
    expect(agent.session.deriveMessages().flatMap((message: any) => message.content)
      .filter((block: any) => block.type === "tool-result").every((block: any) => block.isError)).toBe(true);
    input(agent, "user");
    await expect(h.preStep(agent)).resolves.toMatchObject({ kind: "enter" });
    result(agent, 4, true);
    result(agent, 5, true);
    result(agent, 6, false, "success");
    result(agent, 7, true);
    await expect(h.preStep(agent)).resolves.toMatchObject({ kind: "enter" });
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

it("keeps usage and loop stops terminal even when a provider policy would retry every failure", async () => {
  const h = harness();
  try {
    let retries = 0;
    h.ctx.on("agent/request-error", async () => { retries++; return { kind: "retry" }; });
    const parent = await h.agent("terminal-parent");
    const child = await h.agent("terminal-child", parent);
    const unrelated = await h.agent("other-provider", undefined, false);
    const failure = (agent: any, code: string) => h.ctx.waterfall(scopeTarget(agent, agent), "agent/request-error", {
      agent, turn: 1, step: 1, provider: "test", failure: { code, message: "test failure" },
      retryPolicy: { mode: "always" }, signal: new AbortController().signal
    }, async () => undefined);
    for (const agent of [parent, child]) {
      await expect(failure(agent, "BEES_TOOL_LOOP")).resolves.toBeUndefined();
    }
    expect(retries).toBe(0);
    await expect(failure(parent, "TRANSIENT_NETWORK_ERROR")).resolves.toEqual({ kind: "retry" });
    await expect(failure(unrelated, "BEES_TOOL_LOOP")).resolves.toEqual({ kind: "retry" });
    expect(retries).toBe(2);
  } finally { await h.close(); }
});
