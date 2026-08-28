import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { NodeDatabase } from "./node-database.js";

describe("DSH stage results", () => {
  it("concludes the turn only after accepting a durable result", async () => {
    const database = new NodeDatabase();
    const runtime = new AgentRuntime(
      {
        on: () => () => undefined,
        agentPresets: { mount: async () => undefined },
      },
      database.connection,
    );
    const searches: Array<{ query: string; workspaceId: string }> = [];
    runtime.setKnowledgeSearch(async (query, workspaceId) => {
      searches.push({ query, workspaceId });
      return [{ kind: "file", title: "Team/guide.md", excerpt: "Release guide" }];
    });
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
    const search = tools.find(({ name }) => name === "bees_search_knowledge");
    await expect(search.execute({ query: "release" })).resolves.toEqual({
      results_json: JSON.stringify([{ kind: "file", title: "Team/guide.md", excerpt: "Release guide" }])
    });
    expect(searches).toEqual([{ query: "release", workspaceId: workspace.id }]);
    expect(prompts.join("\n")).toContain("Never simulate or claim a peer");
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

  it("waits for peer work without copying shared outputs", async () => {
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

    await expect(runtime.waitForPeers(["peer"])).resolves.toEqual([expect.objectContaining({
      id: "peer", status: "completed"
    })]);
  });
});
