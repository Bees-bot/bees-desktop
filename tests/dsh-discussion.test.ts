import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { BeesProduct, initializeProductDatabase } from "../dsh-runtime/plugin/lib/product.js";
import { NodeDatabase } from "./node-database.js";

describe("DSH Agent Teams discussions", () => {
  it("keeps discussion participants from blocking a run on human input", () => {
    const database = new NodeDatabase();
    const guards: Array<(exec: any) => string | undefined> = [];
    new AgentRuntime({ on: () => () => undefined, tools: { guard: (guard: any) => guards.push(guard) } }, database.connection);
    const workspace = database.connection.prepare("SELECT id FROM workspaces LIMIT 1").get() as { id: string };
    database.connection.prepare(`
      INSERT INTO execution_links
        (execution_id, workspace_id, agent_name, current_session_id, instance_uid,
         run_directory, config_json, status, created_at, updated_at)
      VALUES ('run', ?, 'lead', 'lead-session', 'uid', '/tmp/work', '{}', 'running', 'now', 'now')
    `).run(workspace.id);

    const guard = guards[0]!;
    expect(guard({ name: "ask_user_question", agent: { session: { header: { parentSession: "lead-session" } } } }))
      .toContain("Send questions or assumptions to lead");
    expect(guard({ name: "ask_user_question", agent: { session: { header: {} } } })).toBeUndefined();
  });

  it("adds the two default agents to Work without changing stages or custom routes", () => {
    const database = new NodeDatabase().connection;
    const stages = database.prepare("SELECT * FROM stages ORDER BY position").all();
    expect(stages.map(({ name }) => name)).toEqual(["Work", "Review", "Done"]);
    const worker = database.prepare("SELECT id FROM agent_assignments WHERE system_role = 'worker'").get()!;
    const reviewer = database.prepare("SELECT id FROM agent_assignments WHERE system_role = 'reviewer'").get()!;
    expect(database.prepare("SELECT count(*) AS n FROM agent_assignments").get()!.n).toBe(6);
    const route = () => database.prepare("SELECT * FROM stage_routes WHERE stage_id = ?").get(String(stages[0]!.id))!;
    expect(JSON.parse(String(route().agent_ids_json))).toEqual([worker.id, reviewer.id]);

    // Upgrade both an implicit default and a saved single-worker default.
    for (const explicit of [false, true]) {
      if (explicit) database.prepare("UPDATE stage_routes SET agent_ids_json = ? WHERE stage_id = ?")
        .run(JSON.stringify([worker.id]), String(stages[0]!.id));
      else database.prepare("DELETE FROM stage_routes WHERE stage_id = ?").run(String(stages[0]!.id));
      database.exec("PRAGMA user_version = 21");
      initializeProductDatabase(database);
      expect(JSON.parse(String(route().agent_ids_json))).toEqual([worker.id, reviewer.id]);
      expect(database.prepare("SELECT * FROM stages ORDER BY position").all()).toEqual(stages);
    }
    database.prepare("UPDATE stage_routes SET agent_assignment_id = ?, agent_ids_json = ? WHERE stage_id = ?")
      .run(String(reviewer.id), JSON.stringify([reviewer.id]), String(stages[0]!.id));
    const custom = route();
    database.exec("PRAGMA user_version = 21");
    initializeProductDatabase(database);
    initializeProductDatabase(database);
    expect(route()).toEqual(custom);
    expect(database.prepare("SELECT * FROM stages ORDER BY position").all()).toEqual(stages);
  });

  it("plans with two agents inside Work, executes there, and keeps final Review separate", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-goal-discussion-"));
    try {
      const database = new NodeDatabase();
      const runtime = new AgentRuntime({ on: () => () => undefined }, database.connection);
      const execute = vi.spyOn(runtime, "executeStage").mockResolvedValue({ outcome: "candidate" } as any);
      const product = new BeesProduct(database.connection, runtime, { startItem: async () => ({}) }, root);
      const initial = await product.snapshot();
      const workspaceId = initial.workspaces[0].id;
      const goal = await product.command({ action: "create_goal", workspaceId, title: "Create a launch brief" });
      const work = initial.stages.find((stage: any) => stage.name === "Work")!;
      const review = initial.stages.find((stage: any) => stage.name === "Review")!;
      const run = (id: string, stage: any) => product.runProcessStage({ workItemId: goal.id,
        executionId: id, stageId: stage.id, stageName: stage.name,
        purpose: stage.driver === "review" ? "reviewer" : "worker" });
      await run("goal-work", work);
      const payload = execute.mock.calls.at(-1)![1];
      expect(payload.initialData.model).toBeNull();
      expect(payload.initialData.discussionMembers).toHaveLength(1);
      expect(payload.initialData.discussionMembers[0]).toMatchObject({ model: null, planningReviewer: true });
      expect(payload.body).toContain("A plan alone does not complete Work");
      expect(payload.initialData.discussionMembers[0].prompt).toContain("Do not implement the goal");
      await run("goal-work", work); // Replayed dispatch preserves the planning role.
      expect(execute.mock.calls.at(-1)![1].initialData.discussionMembers[0].planningReviewer).toBe(true);
      await run("goal-review", review);
      const final = execute.mock.calls.at(-1)![1].initialData;
      expect(final.mode).toBe("review");
      expect(final.agentId).not.toBe(payload.initialData.agentId);
      expect(final.discussionMembers).toEqual([]);
      expect(final.grants).toEqual([]);

      database.connection.prepare("UPDATE work_items SET run_settings_json = ? WHERE id = ?")
        .run(JSON.stringify({ model: "local/only-model", reasoningEffort: "high" }), goal.id);
      await run("goal-local", work);
      const local = execute.mock.calls.at(-1)![1].initialData;
      expect(local).toMatchObject({ model: "local/only-model", reasoningEffort: "high" });
      expect(local.discussionMembers[0]).toMatchObject({ model: "local/only-model", reasoningEffort: "high" });
      expect((await product.snapshot()).assignments).toEqual(initial.assignments);
    } finally { rmSync(root, { recursive: true, force: true }); }
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
      expect(payload.body).toContain("Honor the requested delegation count and execution order");
      expect(payload.body).not.toContain("Delegate sequentially");
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

  it("keeps Agent Team controls and exposes tracked delegation", async () => {
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
    expect(tools.map(({ name }) => name)).toContain("bees_delegate_work");
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
      type: "agent/inbox/spliced",
      data: { inserted: [{ source: { kind: "subagent-settled", senderSessionId: "peer" } }] },
    });
    expect(() => runtime.assertDiscussionReady(agent, members)).not.toThrow();
  });

  it("uses fresh sessions for one-model planning and resolves reviewer model aliases", async () => {
    const spawnTeammate = vi.fn();
    const runtime: any = new AgentRuntime({ on: () => () => undefined,
      agentDefaultModel: { currentSelection: () => ({ provider: "local", model: "only-model" }) },
      llm: { listModels: async () => [{ id: "gpt-5.6-sol" }] },
      agentTeams: { spawnTeammate }
    }, new NodeDatabase().connection);
    await runtime.prepareDiscussion({}, [{ name: "reviewer", model: null, prompt: "Review" }], new AbortController().signal);
    expect(spawnTeammate).toHaveBeenLastCalledWith({}, expect.objectContaining({
      context: "fresh", agentOptions: { provider: "local", model: "only-model" }
    }));
    await runtime.prepareDiscussion({}, [{ name: "reviewer", model: "openai-codex/__bees_latest_sol__", prompt: "Review" }], new AbortController().signal);
    expect(spawnTeammate).toHaveBeenLastCalledWith({}, expect.objectContaining({
      context: "fresh", agentOptions: { provider: "openai-codex", model: "gpt-5.6-sol" }
    }));
  });

  it("requires a disclosed self-review on planning failure without weakening ordinary discussions", () => {
    const database = new NodeDatabase().connection;
    let status = "failed";
    const runtime: any = new AgentRuntime({ on: () => () => undefined,
      agentTeams: { listMembers: () => [{ name: "reviewer", status }] }
    }, database);
    const agent = { session: { id: "lead", snapshotEvents: () => [] } };
    const members = [{ name: "reviewer", planningReviewer: true }];
    expect(() => runtime.assertDiscussionReady(agent, members, "run")).toThrow("Self-review");
    expect(database.prepare("SELECT event_type FROM dsh_audit_events").get()!.event_type).toBe("goal-planning-fallback");
    expect(() => runtime.assertDiscussionReady(agent, members, "run")).not.toThrow();
    expect(() => runtime.assertDiscussionReady(agent, [{ name: "reviewer" }], "run")).toThrow("failed to join");
    status = "running";
    expect(() => runtime.assertDiscussionReady(agent, members, "run")).toThrow("still working");
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
