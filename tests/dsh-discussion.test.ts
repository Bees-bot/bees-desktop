import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { BeesProduct, initializeProductDatabase } from "../dsh-runtime/plugin/lib/product.js";
import { NodeDatabase } from "./node-database.js";

describe("DSH Agent Teams discussions", () => {
  it("migrates a legacy discussion pool into an ordered direct roster", () => {
    const database = new NodeDatabase();
    const workspaceId = String(database.connection.prepare("SELECT id FROM workspaces LIMIT 1").get()!.id);
    const stageId = String(database.connection.prepare("SELECT id FROM stages WHERE name = 'Work' LIMIT 1").get()!.id);
    const agents = database.connection.prepare(`
      SELECT id FROM agent_assignments WHERE workspace_id = ? ORDER BY system_role
    `).all(workspaceId).map(({ id }) => String(id));
    database.connection.prepare("UPDATE stages SET driver = 'discussion' WHERE id = ?").run(stageId);
    database.connection.prepare(`
      INSERT INTO agent_pools
        (id, workspace_id, name, description, archived_at, created_at, updated_at)
      VALUES ('legacy-pool', ?, 'Legacy panel', '', NULL, '2026-01-01', '2026-01-01')
    `).run(workspaceId);
    const member = database.connection.prepare(`
      INSERT INTO agent_pool_members
        (pool_id, agent_assignment_id, priority, enabled, last_assigned_at)
      VALUES ('legacy-pool', ?, ?, 1, NULL)
    `);
    member.run(agents[0]!, 10);
    member.run(agents[1]!, 20);
    database.connection.prepare(`
      INSERT INTO stage_routes
        (stage_id, agent_assignment_id, agent_pool_id, required_capabilities_json, created_at, updated_at)
      VALUES (?, NULL, 'legacy-pool', '[]', '2026-01-01', '2026-01-01')
    `).run(stageId);
    database.connection.exec("PRAGMA user_version = 17");

    initializeProductDatabase(database.connection);

    const route = database.connection.prepare(`
      SELECT agent_assignment_id AS agentId, agent_pool_id AS poolId, agent_ids_json AS agentIds
      FROM stage_routes WHERE stage_id = ?
    `).get(stageId)!;
    expect(route).toMatchObject({ agentId: agents[0], poolId: null });
    expect(JSON.parse(String(route.agentIds))).toEqual(agents);
  });

  it("maps an ordered stage roster to a discussion and gives every peer the goal", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-discussion-"));
    try {
      const database = new NodeDatabase();
      const agents = new AgentRuntime({
        on: () => () => undefined,
        agentPresets: { defaultId: "standard", mount: async () => undefined },
      }, database.connection);
      const execute = vi.spyOn(agents, "executeStage").mockResolvedValue({ outcome: "candidate" } as any);
      const product = new BeesProduct(database.connection, agents, { startItem: async () => ({}) }, root);
      const snapshot = await product.snapshot();
      const workspaceId = snapshot.workspaces[0].id;
      const process = await product.command({
        action: "create_process", workspaceId, name: "Architecture decision",
        stages: [
          { name: "Roundtable", driver: "discussion", requiresHumanApproval: true },
          { name: "Approved", driver: "terminal" },
        ],
      });
      const lead = await product.command({
        action: "add_agent_assignment", workspaceId, presetId: "standard",
        name: "Architect", description: "Owns system coherence", capabilities: ["architecture"],
      });
      const peer = await product.command({
        action: "add_agent_assignment", workspaceId, presetId: "standard",
        name: "Test lead", description: "Challenges testability", instructions: "Find hidden failure modes",
        model: "anthropic/claude-sonnet", reasoningEffort: "high", capabilities: ["architecture"],
      });
      const stage = (await product.snapshot()).stages.find(({ processId }: any) => processId === process.id)!;
      await product.command({
        action: "set_stage_route", stageId: stage.id, agentIds: [lead.id, peer.id],
        requiredCapabilities: ["architecture"],
      });
      const item = await product.command({
        action: "create_item", processId: process.id, title: "Choose the API architecture",
        description: "Compare REST and GraphQL, then recommend one.",
      });

      await product.runProcessStage({
        executionId: "architecture-roundtable", workItemId: item.id,
        stageId: stage.id, stageName: stage.name, purpose: "discussion",
        requiresHumanApproval: true,
      });

      const payload = execute.mock.calls[0]![1];
      expect(payload.initialData).toMatchObject({
        agentId: lead.id, stagePurpose: "worker", requiresHumanApproval: true,
      });
      expect(payload.initialData.discussionMembers).toHaveLength(1);
      expect(payload.initialData.discussionMembers[0]).toMatchObject({
        name: "participant-1", description: "Test lead",
        model: "anthropic/claude-sonnet", reasoningEffort: "high",
      });
      expect(payload.initialData.discussionMembers[0].prompt).toContain("Goal: Choose the API architecture");
      expect(payload.initialData.discussionMembers[0].prompt).toContain("Wait until list_agents shows all of them");
      expect(payload.body).toContain("This is a DSH Agent Teams discussion");
      expect(payload.body).not.toContain("use bees_delegate_work only for a large separate piece");
      expect(payload.initialData.instructions).not.toContain("bees_delegate_work");
      expect(payload.body).toContain("cannot finish until the human approves");
      expect((await product.snapshot()).stages.find(({ id }: any) => id === stage.id)).toMatchObject({
        driver: "discussion", requiresHumanApproval: true, agentIds: [lead.id, peer.id],
      });
      const copied = await product.command({
        action: "copy_process", processId: process.id, name: "Architecture decision copy"
      });
      const copiedSnapshot = await product.snapshot();
      const copiedStage = copiedSnapshot.stages.find(({ processId }: any) => processId === copied.id)!;
      expect(copiedStage.agentIds.map((id: string) =>
        copiedSnapshot.assignments.find((agent: any) => agent.id === id)?.name
      )).toEqual(["Architect (Copy)", "Test lead (Copy)"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the pinned DSH Agent Team bridge that forwards a peer model route", () => {
    const team = readFileSync(new URL(
      "../dsh-runtime/node_modules/@deepseek-ai/dsh-experimental-agent-team/lib/index.js",
      import.meta.url,
    ), "utf8");
    expect(team).toContain("request.agentOptions ? { agentOptions: request.agentOptions }");
  });

  it("keeps Agent Team controls while blocking one-shot delegation", async () => {
    const database = new NodeDatabase();
    const runtime: any = new AgentRuntime({
      on: () => () => undefined,
      agentPresets: { defaultId: "standard", mount: async () => undefined },
    }, database.connection);
    const workspace = database.connection.prepare(
      "SELECT id FROM workspaces ORDER BY created_at LIMIT 1",
    ).get() as { id: string };
    const tools: any[] = [];
    const restrictions: string[][] = [];

    await runtime.setup({
      systemPrompt: { section: () => undefined, context: () => undefined },
      tools: {
        register: (tool: any) => tools.push(tool),
        restrict: ({ deny }: { deny: string[] }) => restrictions.push(deny),
      },
    }, {
      mode: "work", agentPresetId: "standard", mcpAccess: "all", mcpServers: [],
      workItemId: "discussion", grants: [], workspaceId: workspace.id,
      discussionMembers: [{ name: "participant-1" }],
    }, "run", "/tmp");

    expect(restrictions.flat()).toEqual(expect.arrayContaining(["subagent", "subagent_fork"]));
    for (const teamTool of ["send_message", "followup_task", "list_agents", "wait_agent", "interrupt_agent"])
      expect(restrictions.flat()).not.toContain(teamTool);
    expect(tools.map(({ name }) => name)).not.toContain("bees_delegate_work");
  });

  it("seats native DSH peers and refuses a conclusion until each one pitches", async () => {
    const database = new NodeDatabase();
    const spawnTeammate = vi.fn(async () => undefined);
    const events: any[] = [];
    const ctx: any = {
      on: () => () => undefined,
      agentTeams: {
        spawnTeammate,
        listMembers: () => [
          { id: "lead", name: "lead", role: "lead", status: "idle" },
          { id: "peer", name: "participant-1", role: "teammate", status: "idle", description: "Test lead" },
        ],
      },
    };
    const runtime: any = new AgentRuntime(ctx, database.connection);
    const agent = { session: { id: "lead", snapshotEvents: () => events } };
    const members = [{
      name: "participant-1", description: "Test lead", prompt: "Challenge the design",
      model: "anthropic/claude-sonnet", reasoningEffort: "high",
    }];

    await runtime.prepareDiscussion(agent, members, new AbortController().signal);
    expect(spawnTeammate).toHaveBeenCalledWith(agent, expect.objectContaining({
      name: "participant-1", context: "fresh", provider: "spawn",
      agentOptions: { provider: "anthropic", model: "claude-sonnet", reasoningEffort: "high" },
    }));
    expect(() => runtime.assertDiscussionReady(agent, members)).toThrow("has not pitched in yet");
    events.push({
      type: "team/message/queued",
      data: { message: { senderId: "peer", targetId: "lead" } },
    });
    expect(() => runtime.assertDiscussionReady(agent, members)).not.toThrow();
  });

  it("deduplicates agent-started work by source event id", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-trigger-"));
    try {
      const database = new NodeDatabase();
      const starts: string[] = [];
      const agents = new AgentRuntime({ on: () => () => undefined }, database.connection);
      const product = new BeesProduct(database.connection, agents, {
        startItem: async (id: string) => { starts.push(id); return { executionId: `run-${id}` }; },
      }, root);
      const snapshot = await product.snapshot();
      const process = snapshot.processes.find(({ kind }: any) => kind === "goals")!;
      const input = {
        workspaceId: snapshot.workspaces[0].id, process: process.name,
        title: "Respond to urgent message", description: "Slack event evt-42", idempotencyKey: "slack:evt-42",
      };

      const created = await product.startWork(input);
      const repeated = await product.startWork(input);

      const otherTeam = await product.command({
        action: "create_team", organizationId: snapshot.organizations[0].id, name: "Other team",
      });
      const sameEventInAnotherTeam = await product.startWork({ ...input, workspaceId: otherTeam.workspaceId });

      expect(created.status).toBe("started");
      expect(repeated).toEqual({ id: created.id, status: "existing" });
      expect(sameEventInAnotherTeam).toMatchObject({ status: "started" });
      expect(sameEventInAnotherTeam.id).not.toBe(created.id);
      expect(starts).toEqual([created.id, sameEventInAnotherTeam.id]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
