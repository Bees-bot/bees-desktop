import { createRequire } from "node:module";
import { expect, it } from "vitest";
// @ts-expect-error Plain JS runtime boundary.
import { mountToolDiscovery } from "../dsh-runtime/plugin/lib/tool-discovery.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const { Context } = require("@deepseek-ai/cordis");
const { ToolRuntime, defineTool } = require("@deepseek-ai/dsh-tools");
const { SystemPrompt } = require("@deepseek-ai/dsh-system-prompt");
const { createScope } = require("@deepseek-ai/dsh-scope");

function tool(name: string, description = "A fixture capability") {
  return defineTool({ name, description, parameters: {},
    output: { schema: { type: "object", additionalProperties: false, properties: { result: { type: "string", required: true } } },
      render: (_args: any, value: any) => [{ type: "text", text: value.result }] },
    execute: () => ({ result: "executed" }) });
}

it("loads late scoped tools, bounds discovery and schema growth, and preserves permissions and other scopes", async () => {
  const ctx = new Context();
  const prompt = new SystemPrompt(ctx, {});
  const runtime = new ToolRuntime(ctx);
  const agent = { session: { header: {} } };
  const otherAgent = { session: { header: {} } };
  const run = createScope(ctx, agent);
  const other = createScope(ctx, otherAgent);
  const descendant = createScope(ctx, {}, { parent: agent });
  const execute = (name: string, args = {}) => runtime.execute({ agent, callId: name, name,
    arguments: args, signal: new AbortController().signal });
  try {
    ctx.tools.register(tool("mcp__private__read", "Read an unauthorized server"));
    run.ctx.tools.restrict({ deny: ["mcp__private__read"] });
    run.ctx.tools.guard(({ name }: any) => ["guarded_send", "subagent", "subagent_fork"].includes(name) ? "denied" : undefined);
    mountToolDiscovery(run.ctx);
    // Simulate the standard preset's agent/created registrations after Bees setup.
    run.ctx.tools.register(tool("bees_submit_stage_result"));
    run.ctx.tools.register(tool("bees_read_tool_result"));
    run.ctx.tools.register(tool("bash", "Run shell commands"));
    run.ctx.tools.register(tool("guarded_send", "Send guarded data"));
    run.ctx.tools.register(tool("subagent"));
    run.ctx.tools.register(tool("subagent_fork"));
    for (let index = 0; index < 30; index++) run.ctx.tools.register(tool(`fixture_${index}`, "long description ".repeat(500)));
    other.ctx.tools.register(tool("other_private"));
    const initial = await prompt.assemble({ scope: agent });
    expect(initial.tools.map(({ name }: any) => name).sort()).toEqual([
      "bees_find_tools", "bees_read_tool_result", "bees_submit_stage_result"
    ]);
    const discover = async (query: string, offset = 0) => {
      const result = await execute("bees_find_tools", { query, offset });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      return JSON.parse(result.content[0].text);
    };
    expect(await discover("shell")).toMatchObject({ tools: [{ name: "bash" }], next_offset: null });
    expect((await prompt.assemble({ scope: agent })).tools.some(({ name }: any) => name === "bash")).toBe(true);
    expect((await execute("bash")).isError).not.toBe(true);
    expect(await discover("mcp__private__read")).toMatchObject({ tools: [], total: 0 });
    expect(await discover("subagent")).toMatchObject({ tools: [], total: 0 });
    expect((await execute("mcp__private__read")).isError).toBe(true);
    expect((await execute("subagent")).isError).toBe(true);
    expect((await execute("subagent_fork")).isError).toBe(true);
    expect(await discover("guarded_send")).toMatchObject({ tools: [{ name: "guarded_send" }] });
    expect((await execute("guarded_send")).isError).toBe(true);
    const seen = new Set();
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await discover("fixture", offset);
      expect(page.tools.length).toBeLessThanOrEqual(4);
      expect(JSON.stringify(page).length).toBeLessThan(1200);
      for (const entry of page.tools) seen.add(entry.name);
      expect((await prompt.assemble({ scope: agent })).tools.length).toBeLessThanOrEqual(11);
      offset = page.next_offset;
    }
    expect(seen.size).toBe(30);
    expect((await prompt.assemble({ scope: agent })).tools.some(({ name }: any) => name === "bash")).toBe(false);
    // A schema evicted for efficiency is still callable under the same permission guards.
    expect((await execute("bash")).isError).not.toBe(true);
    expect((await prompt.assemble({ scope: otherAgent })).tools.map(({ name }: any) => name).sort())
      .toEqual(["mcp__private__read", "other_private"]);
    const childScope = require("@deepseek-ai/dsh-scope").scopeOf(descendant.ctx);
    expect((await prompt.assemble({ scope: childScope })).tools.length).toBeGreaterThan(30);
    expect((await execute("bees_find_tools", { query: "x".repeat(257) })).isError).toBe(true);
    expect((await execute("bees_find_tools", { query: "", offset: -1 })).isError).toBe(true);
  } finally {
    await descendant.dispose();
    await other.dispose();
    await run.dispose();
  }
});
