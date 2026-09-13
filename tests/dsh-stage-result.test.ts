import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { NodeDatabase } from "./node-database.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("DSH stage results", () => {
  it("hands the parent the actual child result and resolves only evidence belonging to its task tree", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bees-parent-evidence-"));
    const database = new NodeDatabase();
    const runtime: any = new AgentRuntime({ on: () => () => undefined,
      tools: { schemas: () => [] }, agentPresets: { mount: async () => undefined } }, database.connection);
    try {
      const stage = database.connection.prepare(`SELECT s.id AS stageId, s.process_id AS processId,
        p.workspace_id AS workspaceId FROM stages s JOIN processes p ON p.id = s.process_id
        WHERE p.kind = 'goals' AND s.driver = 'agent'`).get() as { stageId: string; processId: string; workspaceId: string };
      for (const [id, parent] of [["parent", null], ["child", "parent"], ["unrelated", null]] as const)
        database.connection.prepare(`INSERT INTO work_items
          (id, parent_id, process_id, stage_id, title, runtime_phase, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'completed', '2026-01-01', '2026-01-02')
        `).run(id, parent, stage.processId, stage.stageId, id);
      mkdirSync(join(directory, "outputs"));
      writeFileSync(join(directory, "outputs/yahoo-news.md"), "Yahoo story");
      writeFileSync(join(directory, "outputs/other-child.md"), "Sibling file");
      database.connection.prepare(`INSERT INTO execution_links
        (execution_id, workspace_id, work_item_id, agent_name, current_session_id, instance_uid,
         run_directory, config_json, status, created_at, updated_at)
        VALUES ('child-run', ?, 'child', 'worker', 'child-session', 'uid', ?, '{}', 'completed', '2026-01-01', '2026-01-02')
      `).run(stage.workspaceId, directory);
      const summary = "Wrote outputs/yahoo-news.md. Publication dates available in the Yahoo RSS; article pages have limited text.";
      database.connection.prepare("INSERT INTO bees_stage_results VALUES ('child-run', 'worker', 'candidate', ?, '2026-01-02')").run(summary);
      const evidenceText = "Lyft: published 2026-09-10T17:13:16Z, https://finance.yahoo.com/story";
      const events = [
        { type: "tool/call", data: { callId: "rss", name: "bees_fetch_page", arguments: '{"url":"https://finance.yahoo.com/rss/"}' } },
        { type: "tool/result", data: { message: { source: { callId: "rss" }, content: [{
          type: "tool-result", content: [{ type: "text", text: evidenceText }]
        }] } } }
      ];
      runtime.sessionEvents = vi.fn(async () => events);
      const [result] = await runtime.waitForPeers(["child"]);
      expect(result).toMatchObject({ status: "completed", summary, artifacts: ["outputs/yahoo-news.md"],
        evidence: [{ session_id: "child-session", call_id: "rss", tool: "bees_fetch_page" }] });
      const tools: any[] = [];
      await runtime.setup({ systemPrompt: { section: () => undefined, context: () => undefined },
        tools: { register: (tool: any) => tools.push(tool), restrict: () => undefined } }, {
        mode: "work", agentPresetId: "standard", mcpAccess: "none", mcpServers: [],
        workItemId: "parent", workspaceId: stage.workspaceId, grants: []
      }, "parent-run", directory);
      const read = tools.find(({ name }) => name === "bees_read_work_evidence");
      const page = await read.execute({ work_item_id: "child", session_id: "child-session", call_id: "rss" });
      expect(JSON.parse(page.result_json).text).toBe(evidenceText);
      await expect(read.execute({ work_item_id: "unrelated" })).rejects.toThrow("direct children only");
      await expect(read.execute({ work_item_id: "child", session_id: "foreign-session", call_id: "rss" })).rejects.toThrow("session and call reference");
      await expect(read.execute({ work_item_id: "child", session_id: "child-session", call_id: "missing" })).rejects.toThrow("this session");
      const revise = vi.fn(async () => ({ id: "child" }));
      runtime.setSubitemStore({ revise, cancel: vi.fn() });
      const correction = tools.find(({ name }) => name === "bees_revise_work");
      const signal = new AbortController().signal;
      const revised = await correction.execute({ work_item_id: "child", feedback: "Add the RSS date already retrieved" }, {
        callId: "fix-call", signal, agent: { session: { id: "parent-session", header: {} } }
      });
      expect(revise).toHaveBeenCalledWith({ parentId: "parent", workItemId: "child",
        feedback: "Add the RSS date already retrieved", requestId: "parent-run:fix-call", signal });
      expect(JSON.parse(revised.result_json).summary).toBe(summary);
      runtime.sessionEvents.mockResolvedValue(Array.from({ length: 45 }, (_, index) => [
        { ...events[0], data: { ...events[0]!.data, callId: `source-${index}` } },
        { ...events[1], data: { message: { ...events[1]!.data.message, source: { callId: `source-${index}` } } } }
      ]).flat());
      const first = JSON.parse((await read.execute({ work_item_id: "child" })).result_json);
      const last = JSON.parse((await read.execute({ work_item_id: "child", evidence_offset: first.next_evidence_offset })).result_json);
      expect(first.evidence).toHaveLength(40);
      expect(last.evidence).toHaveLength(5);
      expect(last.next_evidence_offset).toBeNull();
      expect(new Set([...first.evidence, ...last.evidence].map(({ call_id }: any) => call_id)).size).toBe(45);
    } finally { database.connection.close(); rmSync(directory, { recursive: true, force: true }); }
  });

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
        requiresHumanApproval: true,
        instructions: "Delegate sequentially and inspect each returned result.",
        workItemId: "item",
        grants: [],
        workspaceId: workspace.id,
      },
      "run",
      "/tmp",
    );

    expect(restrictions.flat()).toEqual(expect.arrayContaining(["subagent", "subagent_fork"]));
    for (const teamTool of ["send_message", "followup_task", "list_agents", "wait_agent", "interrupt_agent"])
      expect(restrictions.flat()).toContain(teamTool);
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
    expect(prompts.join("\n")).toContain("A request for a subagent means tracked peer delegation");
    const prompt = prompts.join("\n");
    expect(prompt).toContain("even when saved agent instructions give a different default");
    expect(prompt.indexOf("Delegation scheduling:")).toBeGreaterThan(prompt.indexOf("Delegate sequentially"));
    expect(prompt).toContain("items_json array of one bees_delegate_work call");
    expect(prompt).toContain("When sequential execution is requested or a task depends on an earlier result, delegate one at a time");
    expect(prompts.join("\n")).toContain("Use ask_user_question only to obtain missing information");
    expect(prompts.join("\n")).toContain("approval after each entry, step, or child task");
    expect(prompts.join("\n")).toContain("Never create Approve, Reject, Continue, or Stop choices with ask_user_question");
    const submit = tools.find((tool) => tool.name === "bees_submit_stage_result");
    let conclusions = 0;
    const exec = { concludeTurn: () => conclusions++ };
    await expect(submit.execute({
      outcome: "candidate", acceptance_criteria_met: true, summary: "Done",
    }, exec)).rejects.toThrow("requires human approval");
    const review = tools.find(({ name }) => name === "bees_request_work_review");
    expect(review.description).toContain("approval after each entry, step, or child task");
    const reviewExec = { agent: { session: { id: "session", header: {} } } };
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

  it("delegates through a tracked child work item and records its settlement", async () => {
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
      VALUES ('parent', ?, ?, 'goal', 'Parent', 'running', '2026-01-01', '2026-01-01')
    `).run(stage.processId, stage.stageId);
    database.connection.prepare(`
      INSERT INTO execution_links
        (execution_id, workspace_id, work_item_id, agent_name, current_session_id, instance_uid,
         run_directory, config_json, status, created_at, updated_at)
      VALUES ('run', ?, 'parent', 'bees-run', 'session', 'uid', '/tmp/work', '{}', 'running',
        '2026-01-01', '2026-01-01')
    `).run(workspace.id);
    const create = vi.fn(async () => [{ id: "peer" }]);
    runtime.setSubitemStore({ create, cancel: vi.fn(async () => undefined) });
    runtime.waitForPeers = vi.fn(async () => [{
      id: "peer", title: "Write first", status: "completed", settledAt: "2026-01-02",
    }]);
    const tools: any[] = [];
    const listeners = new Map<string, (...args: any[]) => void>();
    runtime.installPolicies = () => undefined;
    await runtime.setup({
      on: (event: string, handler: (...args: any[]) => void) => { listeners.set(event, handler); return () => listeners.delete(event); },
      effect: () => () => undefined,
      systemPrompt: { section: () => undefined, context: () => undefined },
      tools: { register: (tool: any) => tools.push(tool), restrict: () => undefined },
    }, {
      mode: "work", agentPresetId: "standard", mcpAccess: "all", mcpServers: [],
      workItemId: "parent", grants: [], workspaceId: workspace.id, participantIds: [],
    }, "run", "/tmp");
    let peerStatus = "running";
    runtime.ctx.agentTeams = { tryMembership: () => ({ root: lead.agent }), membership: () => ({ root: lead.agent }), listMembers: () => [{ id: "cto-seat", name: "participant-1", status: peerStatus }] };
    const lead = { signal: new AbortController().signal, agent: { id: "session", inbox: { hasPending: false }, session: { id: "session", header: {}, snapshotEvents: () => [{
      type: "team/message/queued", data: { message: { senderId: "cto-seat", targetId: "session" } }
    }] } } };
    const delegate = tools.find(({ name }) => name === "bees_delegate_work");
    await expect(delegate.execute({ items_json: '[{"title":"Write first","}]' }, lead)).rejects.toThrow("valid JSON");
    const pending = delegate.execute({ items_json: '[{"title":"Write first"}]' }, lead);
    // Tracked peers start immediately; there is no separate discussion lifecycle.
    peerStatus = "idle";
    const result = await pending;
    expect(create).toHaveBeenCalledTimes(1);
    await expect(delegate.execute({ items_json: '[{"title":"Write first"}]' }, {
      agent: { session: { header: { parentSession: "session" } } }
    })).rejects.toThrow("Only the lead");

    expect(create).toHaveBeenCalledWith({
      parentId: "parent", items: [{ title: "Write first" }],
    });
    expect(result).toMatchObject({ count: 1, ids: "peer" });
    expect(database.connection.prepare(`
      SELECT event_type AS type FROM dsh_audit_events
      WHERE execution_id = 'run' AND event_type LIKE 'peer-work-%' ORDER BY created_at, rowid
    `).all()).toEqual([
      { type: "peer-work-delegated" }, { type: "peer-work-settled" },
    ]);
  });

  it("returns the durable peer settlement time", async () => {
    const database = new NodeDatabase();
    const runtime: any = new AgentRuntime({ on: () => () => undefined }, database.connection);
    const stage = database.connection.prepare(`
      SELECT s.id AS stageId, s.process_id AS processId FROM stages s
      JOIN processes p ON p.id = s.process_id WHERE p.kind = 'goals' AND s.driver = 'agent'
    `).get() as { stageId: string; processId: string };
    database.connection.prepare(`
      INSERT INTO work_items
        (id, process_id, stage_id, kind, title, runtime_phase, created_at, updated_at)
      VALUES ('peer', ?, ?, 'work', 'Independent result', 'completed', '2026-01-01', '2026-01-02')
    `).run(stage.processId, stage.stageId);

    await expect(runtime.waitForPeers(["peer"])).resolves.toEqual([{
      id: "peer", title: "Independent result", status: "completed", settledAt: "2026-01-02",
    }]);
  });

  it("exposes process starts only to agents with the capability", async () => {
    const database = new NodeDatabase();
    const start = vi.fn(async () => ({ id: "created", status: "started" }));
    const runtime: any = new AgentRuntime({
      on: () => () => undefined,
      agentPresets: { defaultId: "standard", mount: async () => undefined },
    }, database.connection);
    runtime.setWorkStarter(start);
    const workspace = database.connection.prepare(
      "SELECT id FROM workspaces ORDER BY created_at LIMIT 1",
    ).get() as { id: string };
    const tools: any[] = [];
    await runtime.setup({
      systemPrompt: { section: () => undefined, context: () => undefined },
      tools: { register: (tool: any) => tools.push(tool), restrict: () => undefined },
    }, {
      mode: "work", agentPresetId: "standard", mcpAccess: "all", mcpServers: [], capabilities: ["start-work"],
      agentId: "watcher", workItemId: null, grants: [], workspaceId: workspace.id,
    }, "run", "/tmp");
    const trigger = tools.find(({ name }) => name === "bees_start_work");
    await expect(trigger.execute({
      process: "Incident response", title: "Urgent customer message",
      description: "Handle source event", idempotency_key: "slack:evt-42",
    }, { agent: { session: { header: {} } } })).resolves.toEqual({ id: "created", status: "started" });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: workspace.id, agentId: "watcher", idempotencyKey: "slack:evt-42",
    }));
  });
});
