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
    expect(prompts.join("\n")).toContain("Never simulate or claim a peer");
    const delegate = tools.find(({ name }) => name === "bees_delegate_work");
    expect(delegate.timeoutMs).toBeLessThanOrEqual(2_147_483_647);
    expect(delegate.description).toContain("works exclusively in this run's shared workspace");
    const submit = tools.find((tool) => tool.name === "bees_submit_stage_result");
    let conclusions = 0;
    const exec = { concludeTurn: () => conclusions++ };

    await expect(
      submit.execute({ outcome: "candidate", summary: "Done" }, exec),
    ).resolves.toEqual({ outcome: "candidate", summary: "Done" });
    expect(conclusions).toBe(1);

    await submit.execute({ outcome: "candidate", summary: "Done" }, exec);
    expect(conclusions).toBe(2);

    await expect(
      submit.execute({ outcome: "candidate", summary: "Different" }, exec),
    ).rejects.toThrow("different immutable result");
    expect(conclusions).toBe(2);
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
