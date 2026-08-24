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
    await (runtime as any).setup(
      {
        systemPrompt: {
          section: () => undefined,
          context: () => undefined,
        },
        tools: { register: (tool: any) => tools.push(tool) },
      },
      {
        mode: "work",
        agentPresetId: "standard",
        stagePurpose: "worker",
        workItemId: null,
        grants: [],
        workspaceId: workspace.id,
      },
      "run",
      "/tmp",
    );

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
});
