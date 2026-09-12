import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { NodeDatabase } from "./node-database.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const { Context } = require("@deepseek-ai/cordis");
const { createScope } = require("@deepseek-ai/dsh-scope");
const { SystemPrompt } = require("@deepseek-ai/dsh-system-prompt");
const { ToolRuntime, defineTool } = require("@deepseek-ai/dsh-tools");

it("hides and denies preset delegation even when DSH registers it in the agent scope after setup", async () => {
  const ctx: any = new Context();
  const prompt = new SystemPrompt(ctx, {});
  const tools = new ToolRuntime(ctx);
  const presetKey = {};
  const preset = createScope(ctx, presetKey);
  const agent: any = { session: { header: {} } };
  const run = createScope(ctx, agent, { parent: presetKey });
  const other = {};
  const otherRun = createScope(ctx, other, { parent: presetKey });
  const database = new NodeDatabase();
  const workspaceId = String(database.connection.prepare("SELECT id FROM workspaces LIMIT 1").get()!.id);
  let rawDelegations = 0;
  const delegationTool = (name: string) => defineTool({
    name, description: "Delegate test work", parameters: {},
    output: {
      schema: { type: "object", additionalProperties: false, properties: {} },
      render: () => [{ type: "text", text: "Delegated" }]
    },
    execute: async () => { rawDelegations++; return {}; }
  });
  preset.ctx.tools.register(delegationTool("subagent_fork"));
  ctx.agentPresets = { mount: async () => undefined };
  ctx.credentials = { resolve: async () => undefined };
  const runtime: any = new AgentRuntime(ctx, database.connection);
  try {
    await runtime.setup(run.ctx, {
      mode: "work", agentPresetId: "standard", workspaceId, workItemId: "work",
      mcpAccess: "none", mcpServers: [], grants: []
    }, "run", "/tmp");

    // dsh-tool-subagent with modelSelectionSettings installs on agent/created,
    // after Bees setup, into the agent's own (unrestrictable) tool layer.
    run.ctx.tools.register(delegationTool("subagent"));
    run.ctx.tools.register(delegationTool("subagent_fork"));
    otherRun.ctx.tools.register(delegationTool("subagent"));
    const names = (await prompt.assemble({ scope: agent })).tools.map(({ name }: any) => name);
    expect(names).not.toContain("subagent");
    expect(names).not.toContain("subagent_fork");
    expect(names).toContain("bees_find_tools");
    expect(names).toContain("bees_delegate_work");
    expect(names).not.toContain("bees_list_execution_agents");
    const found = await tools.execute({ agent, callId: "find-delegation", name: "bees_find_tools",
      arguments: { query: "bees_list_execution_agents" }, signal: new AbortController().signal });
    expect(found.isError).not.toBe(true);
    expect((await prompt.assemble({ scope: agent })).tools.map(({ name }: any) => name))
      .toContain("bees_list_execution_agents");
    expect((await prompt.assemble({ scope: other })).tools.map(({ name }: any) => name))
      .toEqual(expect.arrayContaining(["subagent", "subagent_fork"]));

    for (const name of ["subagent", "subagent_fork"]) {
      const denied = await tools.execute({
        agent, callId: name, name, arguments: {}, signal: new AbortController().signal
      });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).toContain("bees_delegate_work");
    }
    expect(rawDelegations).toBe(0);
    const allowed = await tools.execute({
      agent: other, callId: "other-delegation", name: "subagent", arguments: {}, signal: new AbortController().signal
    });
    expect(allowed.isError, JSON.stringify(allowed)).not.toBe(true);
    expect(rawDelegations).toBe(1);
  } finally {
    await run.dispose();
    await otherRun.dispose();
    await preset.dispose();
    database.connection.close();
  }
});
