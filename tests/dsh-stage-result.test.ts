import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { NodeDatabase } from "./node-database.js";

describe("DSH stage results", () => {
  it("concludes the turn only after accepting a durable result", async () => {
    const database = new NodeDatabase();
    const requestReview = vi.fn();
    const runtime = new AgentRuntime(
      {
        on: () => () => undefined,
        agentPresets: { defaultId: "standard", mount: async () => undefined },
        userQuestions: { ask: requestReview },
      },
      database.connection,
      { get: () => ({ systemInstructions: "Use ISO dates in every deliverable" }) },
    );
    const searches: Array<{ query: string; workspaceId: string }> = [];
    runtime.setKnowledgeSearch(async (query, workspaceId) => {
      searches.push({ query, workspaceId });
      return [{ kind: "file", title: "Team/guide.md", excerpt: "Release guide" }];
    });
    runtime.setKnowledgeReader(async (resultId, workspaceId) => ({
      id: resultId, workspaceId, content: "Release guide", authority: "current"
    }));
    const workspace = database.connection.prepare(
      "SELECT id FROM workspaces ORDER BY created_at LIMIT 1",
    ).get() as { id: string };
    database.connection.prepare(`
      INSERT INTO execution_links
        (execution_id, workspace_id, agent_name, current_session_id, instance_uid,
         run_directory, config_json, status, created_at, updated_at)
      VALUES ('run', ?, 'bees-run', 'session', 'uid', '/tmp/work', '{}', 'running',
        '2026-01-01', '2026-01-01')
    `).run(workspace.id);

    const tools: any[] = [];
    const restrictions: string[][] = [];
    const prompts: string[] = [];
    await (runtime as any).setup(
      {
        systemPrompt: {
          section: ({ text }: { text: string }) => prompts.push(text),
          context: () => undefined,
        },
        tools: {
          register: (tool: any) => tools.push(tool),
          restrict: ({ deny }: { deny: string[] }) => restrictions.push(deny),
        },
      },
      {
        mode: "work",
        agentPresetId: "standard",
        mcpAccess: "all", mcpServers: [],
        stagePurpose: "worker",
        workItemId: "item",
        grants: [],
        workspaceId: workspace.id,
      },
      "run",
      "/tmp",
    );

    expect(restrictions.flat()).toEqual(expect.arrayContaining(["subagent", "workflow", "ralph"]));
    expect(tools.map(({ name }) => name)).toContain("bees_delegate_work");
    expect(tools.map(({ name }) => name)).toContain("bees_search_knowledge");
    expect(tools.map(({ name }) => name)).toContain("bees_read_knowledge");
    expect(tools.map(({ name }) => name)).toContain("bees_request_work_review");
    const search = tools.find(({ name }) => name === "bees_search_knowledge");
    await expect(search.execute({ query: "release" })).resolves.toEqual({
      results_json: JSON.stringify([{ kind: "file", title: "Team/guide.md", excerpt: "Release guide" }])
    });
    expect(searches).toEqual([{ query: "release", workspaceId: workspace.id }]);
    expect(prompts.join("\n")).toContain("Team knowledge is available independently of attached inputs");
    expect(prompts.join("\n")).toContain("System-wide user instructions:\nUse ISO dates in every deliverable");
    const read = tools.find(({ name }) => name === "bees_read_knowledge");
    await expect(read.execute({ result_id: "location:guide.md" })).resolves.toEqual({
      document_json: JSON.stringify({
        id: "location:guide.md", workspaceId: workspace.id,
        content: "Release guide", authority: "current"
      })
    });
    expect(prompts.join("\n")).toContain("Never simulate or claim a peer");
    expect(prompts.join("\n")).toContain("Use ask_user_question only to obtain missing information");
    expect(prompts.join("\n")).toContain("approval after each entry, step, or child task");
    expect(prompts.join("\n")).toContain("Never create Approve, Reject, Continue, or Stop choices with ask_user_question");
    const review = tools.find(({ name }) => name === "bees_request_work_review");
    expect(review.description).toContain("approval after each entry, step, or child task");
    const reviewExec = { agent: { session: { id: "session" } } };
    requestReview.mockResolvedValueOnce({
      answers: [{ id: "work-review", selected: [], custom: "Use exact dates" }]
    });
    await expect(review.execute({ summary: "The draft is ready" }, reviewExec)).resolves.toEqual({
      outcome: "rejected", feedback: "Use exact dates"
    });
    expect(requestReview).toHaveBeenCalledWith(expect.objectContaining({
      agent: reviewExec.agent,
      questions: [expect.objectContaining({
        id: "work-review", question: "Approve this work?", multiSelect: false,
        options: [expect.objectContaining({ label: "Approve" }), expect.objectContaining({ label: "Reject" })]
      })]
    }));
    requestReview.mockResolvedValueOnce({
      answers: [{ id: "work-review", selected: ["Approve"] }]
    });
    await expect(review.execute({ summary: "The draft is ready" }, reviewExec)).resolves.toEqual({
      outcome: "approved", feedback: ""
    });
    const delegate = tools.find(({ name }) => name === "bees_delegate_work");
    expect(delegate.timeoutMs).toBeLessThanOrEqual(2_147_483_647);
    expect(delegate.description).toContain("works exclusively in this run's shared workspace");
    const submit = tools.find((tool) => tool.name === "bees_submit_stage_result");
    let conclusions = 0;
    const exec = { concludeTurn: () => conclusions++ };

    await expect(submit.execute({
      outcome: "blocked", acceptance_criteria_met: false, summary: "Approval declined",
    }, exec)).resolves.toEqual({ outcome: "blocked", summary: "Approval declined" });
    expect(database.connection.prepare(
      "SELECT outcome, summary FROM bees_stage_results WHERE execution_id = 'run'"
    ).get()).toEqual({ outcome: "blocked", summary: "Approval declined" });
    database.connection.prepare("DELETE FROM bees_stage_results WHERE execution_id = 'run'").run();
    conclusions = 0;

    await expect(submit.execute({
      outcome: "candidate", acceptance_criteria_met: false, summary: "Blocked",
    }, exec)).rejects.toThrow("every acceptance criterion is met");
    await expect(submit.execute({
      outcome: "candidate", acceptance_criteria_met: true,
      summary: "Acceptance criteria are not fully met",
    }, exec)).rejects.toThrow("every acceptance criterion is met");
    expect(conclusions).toBe(0);

    await expect(submit.execute({
      outcome: "candidate", acceptance_criteria_met: true, summary: "Done",
    }, exec)).resolves.toEqual({ outcome: "candidate", summary: "Done" });
    expect(conclusions).toBe(1);

    await submit.execute({ outcome: "candidate", acceptance_criteria_met: true, summary: "Done" }, exec);
    expect(conclusions).toBe(2);

    await expect(
      submit.execute({ outcome: "candidate", acceptance_criteria_met: true, summary: "Different" }, exec),
    ).rejects.toThrow("different immutable result");
    expect(conclusions).toBe(2);
  });

  it("upgrades the durable result constraint without losing prior results", () => {
    const database = new NodeDatabase();
    database.connection.exec("PRAGMA foreign_keys = ON");
    new AgentRuntime({ on: () => () => undefined }, database.connection);
    const workspace = database.connection.prepare(
      "SELECT id FROM workspaces ORDER BY created_at LIMIT 1",
    ).get() as { id: string };
    database.connection.prepare(`
      INSERT INTO execution_links
        (execution_id, workspace_id, agent_name, current_session_id, instance_uid,
         run_directory, config_json, status, created_at, updated_at)
      VALUES ('prior-run', ?, 'bees-run', 'prior-session', 'prior-uid', '/tmp/prior', '{}',
        'completed', '2026-01-01', '2026-01-01')
    `).run(workspace.id);
    database.connection.prepare(`
      INSERT INTO bees_stage_results VALUES
        ('prior-run', 'worker', 'candidate', 'Already done', '2026-01-01')
    `).run();
    database.connection.exec(`
      ALTER TABLE bees_stage_results RENAME TO bees_stage_results_new;
      CREATE TABLE bees_stage_results (
        execution_id TEXT PRIMARY KEY REFERENCES execution_links(execution_id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK (purpose IN ('worker', 'reviewer')),
        outcome TEXT NOT NULL CHECK (outcome IN ('candidate', 'pass', 'revise')),
        summary TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO bees_stage_results SELECT * FROM bees_stage_results_new;
      DROP TABLE bees_stage_results_new;
    `);

    new AgentRuntime({ on: () => () => undefined }, database.connection);

    const schema = database.connection.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bees_stage_results'"
    ).get() as { sql: string };
    expect(schema.sql).toContain("'blocked'");
    expect(database.connection.prepare(
      "SELECT outcome, summary FROM bees_stage_results WHERE execution_id = 'prior-run'"
    ).get()).toEqual({ outcome: "candidate", summary: "Already done" });
  });

  it("returns the durable peer settlement time", async () => {
    const database = new NodeDatabase();
    const runtime: any = new AgentRuntime({ on: () => () => undefined }, database.connection);
    const stage = database.connection.prepare(`
      SELECT s.id AS stageId, s.process_id AS processId FROM stages s
      JOIN processes p ON p.id = s.process_id WHERE p.kind = 'goals' AND s.driver = 'agent'
    `).get() as { stageId: string; processId: string };
    const workspace = database.connection.prepare(
      "SELECT id FROM workspaces ORDER BY created_at LIMIT 1",
    ).get() as { id: string };
    database.connection.prepare(`
      INSERT INTO work_items
        (id, process_id, stage_id, kind, title, runtime_phase, created_at, updated_at)
      VALUES ('peer', ?, ?, 'work', 'Independent result', 'completed', '2026-01-01', '2026-01-01')
    `).run(stage.processId, stage.stageId);
    database.connection.prepare(`
      INSERT INTO execution_links
        (execution_id, workspace_id, work_item_id, agent_name, current_session_id, instance_uid,
         run_directory, config_json, status, created_at, updated_at)
      VALUES ('peer-run', ?, 'peer', 'bees-run', 'peer-session', 'peer-uid', ?, '{}',
        'completed', '2026-01-01', '2026-01-01')
    `).run(workspace.id, "/tmp/shared-workspace");
    database.connection.prepare(`
      INSERT INTO bees_stage_results VALUES
        ('peer-run', 'worker', 'candidate', 'Done', '2026-01-01')
    `).run();

    await expect(runtime.waitForPeers(["peer"])).resolves.toEqual([{
      id: "peer", title: "Independent result", status: "completed", settledAt: "2026-01-01"
    }]);
  });

  it("exports each peer settlement before the next delegation", async () => {
    const database = new NodeDatabase();
    const runtime: any = new AgentRuntime({
      on: () => () => undefined,
      agentPresets: { defaultId: "standard", mount: async () => undefined },
    }, database.connection);
    const stage = database.connection.prepare(`
      SELECT s.id AS stageId, s.process_id AS processId FROM stages s
      JOIN processes p ON p.id = s.process_id WHERE p.kind = 'goals' AND s.driver = 'agent'
    `).get() as { stageId: string; processId: string };
    const workspace = database.connection.prepare(
      "SELECT id FROM workspaces ORDER BY created_at LIMIT 1",
    ).get() as { id: string };
    database.connection.prepare(`
      INSERT INTO work_items
        (id, process_id, stage_id, kind, title, runtime_phase, created_at, updated_at)
      VALUES ('parent', ?, ?, 'goal', 'Sequential work', 'running', '2026-01-01', '2026-01-01')
    `).run(stage.processId, stage.stageId);
    database.connection.prepare(`
      INSERT INTO execution_links
        (execution_id, workspace_id, work_item_id, agent_name, current_session_id, instance_uid,
         run_directory, config_json, status, created_at, updated_at)
      VALUES ('run', ?, 'parent', 'bees-run', 'session', 'uid', '/tmp/work', '{}', 'running',
        '2026-01-01', '2026-01-01')
    `).run(workspace.id);

    const peers = ["peer-1", "peer-2"];
    runtime.setSubitemStore({
      create: async () => [{ id: peers.shift()! }],
      cancel: async () => undefined,
    });
    runtime.waitForPeers = async (ids: string[]) => {
      const id = ids[0]!;
      return [{ id, title: id, status: "completed", settledAt: `2026-01-01T00:00:0${id.at(-1)}Z` }];
    };
    const tools: any[] = [];
    await runtime.setup({
      systemPrompt: { section: () => undefined, context: () => undefined },
      tools: { register: (tool: any) => tools.push(tool), restrict: () => undefined },
    }, {
      mode: "work", agentPresetId: "standard", mcpAccess: "all", mcpServers: [],
      workItemId: "parent", grants: [], workspaceId: workspace.id,
    }, "run", "/tmp");
    const delegate = tools.find(({ name }) => name === "bees_delegate_work");
    const exec = { agent: { session: { id: "session" } } };

    await delegate.execute({ items_json: JSON.stringify([{ title: "First" }]) }, exec);
    await delegate.execute({ items_json: JSON.stringify([{ title: "Second" }]) }, exec);

    const evidence = await runtime.reviewEvidence("run");
    const audit = evidence.executions[0].audit
      .filter(({ type }: any) => type.startsWith("peer-work-"))
      .map(({ type, metadata }: any) => ({ type, metadata: JSON.parse(metadata) }));
    expect(audit.map(({ type }: any) => type)).toEqual([
      "peer-work-delegated", "peer-work-settled", "peer-work-delegated", "peer-work-settled",
    ]);
    expect(audit[1].metadata.results).toEqual([expect.objectContaining({
      id: "peer-1", status: "completed", settledAt: "2026-01-01T00:00:01Z",
    })]);
    expect(audit[3].metadata.results).toEqual([expect.objectContaining({
      id: "peer-2", status: "completed", settledAt: "2026-01-01T00:00:02Z",
    })]);
  });
});
