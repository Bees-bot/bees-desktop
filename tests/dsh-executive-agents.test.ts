import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { BeesProduct, initializeProductDatabase } from "../dsh-runtime/plugin/lib/product.js";
import { NodeDatabase } from "./node-database.js";

describe("executive team", () => {
  it("seeds four editable agents without overwriting customization or duplicating existing names", () => {
    const db = new NodeDatabase().connection;
    const executives = () => db.prepare("SELECT * FROM agent_assignments WHERE system_role IS NULL ORDER BY name").all();
    expect(executives().map((row) => row.name)).toEqual(["CEO", "CMO", "CRO", "CTO"]);
    for (const agent of executives()) {
      expect(agent.instructions).toContain("send parallel assignments together");
      expect(agent.instructions).not.toContain("Delegate sequentially");
    }
    db.exec("UPDATE agent_assignments SET name = 'Engineering', instructions = 'My rules', enabled = 0 WHERE name = 'CTO'");
    const customized = executives();
    initializeProductDatabase(db);
    expect(executives()).toEqual(customized);
    // Simulate an existing team that already created its own CEO before this feature.
    db.exec("UPDATE agent_assignments SET id = 'existing-ceo', instructions = 'Existing CEO' WHERE name = 'CEO'");
    initializeProductDatabase(db);
    expect(executives()).toHaveLength(4);
    expect(executives().find((row) => row.name === "CEO")?.instructions).toBe("Existing CEO");
  });

  it("routes a discussion's child to CTO with its instructions and restricted tools, then independently reviews", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-executives-"));
    try {
      const db = new NodeDatabase().connection;
      const runtime = new AgentRuntime({ on: () => () => undefined }, db);
      const execute = vi.spyOn(runtime, "executeStage").mockResolvedValue({ outcome: "candidate" } as any);
      const product = new BeesProduct(db, runtime, { startItem: async () => ({}) }, root);
      const initial = await product.snapshot();
      const workspaceId = initial.workspaces[0].id;
      const cto = initial.assignments.find((a: any) => a.name === "CTO")!;
      db.prepare("UPDATE agent_assignments SET mcp_access = 'none' WHERE id = ?").run(cto.id);
      const goal = await product.command({ action: "create_goal", workspaceId,
        title: "Launch", description: "$ceo $cto $cmo Build a local page and launch copy." });
      const work = initial.stages.find((s: any) => s.name === "Work")!;
      await product.runProcessStage({ workItemId: goal.id, stageId: work.id, executionId: "lead", purpose: "worker" });
      const lead = execute.mock.calls.at(-1)![1];
      expect(lead.initialData.discussionMembers).toHaveLength(2);
      expect(lead.body).toContain(cto.id);
      expect(lead.body).toContain("only for substantial independent work");
      expect(lead.body).toContain("Do small, tightly coupled work yourself");
      expect(lead.initialData.discussionMembers[0].prompt).toContain("do not implement");
      const input = { parentId: goal.id, items: [{ title: "Build page", description: "Write and test outputs/index.html", agentAssignmentId: cto.id }] };
      const [child] = await product.createSubitems(input);
      expect((await product.createSubitems(input))[0].id).toBe(child.id);
      await product.runProcessStage({ workItemId: child.id, stageId: work.id, executionId: "cto", purpose: "worker" });
      const worker = execute.mock.calls.at(-1)![1].initialData;
      expect(worker).toMatchObject({ agentId: cto.id, agentName: "CTO", mcpAccess: "none", discussionMembers: [] });
      expect(worker.instructions).toContain(cto.instructions);
      writeFileSync(join(root, "runs", "cto", "outputs", "index.html"), "<h1>Launch</h1>");
      db.prepare(`INSERT INTO execution_links
        (execution_id, workspace_id, work_item_id, agent_name, current_session_id, instance_uid,
         run_directory, config_json, status, created_at, updated_at)
        VALUES ('cto', ?, ?, 'CTO', 'cto-session', 'uid', ?, '{}', 'completed', '2026-01-01', '2026-01-01')`)
        .run(workspaceId, child.id, join(root, "runs", "cto"));
      const review = initial.stages.find((s: any) => s.name === "Review")!;
      await product.runProcessStage({ workItemId: child.id, stageId: review.id, executionId: "review", purpose: "reviewer", candidateExecutionId: "cto" });
      expect(execute.mock.calls.at(-1)![1].initialData.agentId).not.toBe(cto.id);
      await expect(product.createSubitems({ parentId: goal.id, items: [{ title: "Invalid", agentAssignmentId: "foreign-or-missing" }] })).rejects.toThrow("belong to this team");
      await expect(product.createSubitems({ parentId: goal.id, items: [{ title: "Build page" }] })).rejects.toThrow("another agent");
      db.prepare("UPDATE agent_assignments SET enabled = 0 WHERE id = ?").run(cto.id);
      await expect(product.createSubitems({ parentId: goal.id, items: [{ title: "Disabled", agentAssignmentId: cto.id }] })).rejects.toThrow("enabled");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("starts independent delegated peers together and reuses them on retry", async () => {
    const db = new NodeDatabase().connection;
    const startItem = vi.fn(async (_id: string) => ({}));
    const runtime = new AgentRuntime({ on: () => () => undefined }, db);
    const product = new BeesProduct(db, runtime, { startItem }, tmpdir());
    const initial = await product.snapshot();
    const workspaceId = initial.workspaces[0].id;
    const cto = initial.assignments.find((agent: any) => agent.name === "CTO")!;
    const cmo = initial.assignments.find((agent: any) => agent.name === "CMO")!;
    const goal = await product.command({ action: "create_goal", workspaceId, title: "Parallel launch" });
    const input = { parentId: goal.id, items: [
      { title: "Build page", description: "Write outputs/index.html", agentAssignmentId: cto.id },
      { title: "Write copy", description: "Write outputs/copy.md", agentAssignmentId: cmo.id }
    ] };
    startItem.mockClear();
    let releaseFirst: () => void = () => undefined;
    startItem.mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = () => resolve({}); }));
    startItem.mockImplementationOnce(async () => { releaseFirst(); return {}; });

    const children = await product.createSubitems(input);

    expect(startItem.mock.calls.map(([id]) => id)).toEqual(children.map(({ id }) => id));
    expect(db.prepare("SELECT title, agent_assignment_id AS agentId FROM work_items WHERE parent_id = ? ORDER BY title").all(goal.id)).toEqual([
      { title: "Build page", agentId: cto.id }, { title: "Write copy", agentId: cmo.id }
    ]);
    expect((await product.createSubitems(input)).map(({ id }) => id)).toEqual(children.map(({ id }) => id));
    expect(startItem).toHaveBeenCalledTimes(2);
  }, 1_000);

  it("gives an inherited child the original request and lets only its parent request corrections", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-parent-instructions-"));
    try {
      const db = new NodeDatabase().connection;
      const runtime: any = new AgentRuntime({ on: () => () => undefined }, db);
      const execute = vi.spyOn(runtime, "executeStage").mockResolvedValue({ outcome: "candidate" } as any);
      const reviseItem = vi.fn(async () => ({ id: "child" }));
      const product = new BeesProduct(db, runtime, { startItem: async () => ({}), reviseItem }, root);
      const initial = await product.snapshot();
      const parent = await product.command({ action: "create_goal", workspaceId: initial.workspaces[0].id,
        title: "News brief", description: "Google and Yahoo only; business, finance and technology." });
      const other = await product.command({ action: "create_goal", workspaceId: initial.workspaces[0].id, title: "Unrelated" });
      const [child] = await product.createSubitems({ parentId: parent.id,
        items: [{ title: "Yahoo portion", description: "Gather Yahoo stories and preserve dates when exposed." }] });
      const work = initial.stages.find((s: any) => s.name === "Work")!;
      await product.runProcessStage({ workItemId: child.id, stageId: work.id, executionId: "child-work", purpose: "worker" });
      const config: any = execute.mock.calls.at(-1)![1];
      expect(config.body).toContain("Google and Yahoo only; business, finance and technology.");
      expect(config.body).toContain("Gather Yahoo stories and preserve dates when exposed.");
      expect(config.body).toContain("The parent owns the combined outcome and reviews your result");
      expect(config.initialData.discussionMembers).toEqual([]);
      await expect(Promise.resolve().then(() => runtime.subitemStore.revise({ parentId: other.id,
        workItemId: child.id, feedback: "Wrong owner", requestId: "wrong" }))).rejects.toThrow("Only this child's parent");
      await runtime.subitemStore.revise({ parentId: parent.id, workItemId: child.id,
        feedback: "Use existing dates", requestId: "correct" });
      expect(reviseItem).toHaveBeenCalledWith(child.id, "Use existing dates", "correct", undefined);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("validates the entire delegated batch before starting any peer", async () => {
    const db = new NodeDatabase().connection;
    const startItem = vi.fn(async () => ({}));
    const runtime = new AgentRuntime({ on: () => () => undefined }, db);
    const product = new BeesProduct(db, runtime, { startItem }, tmpdir());
    const initial = await product.snapshot();
    const goal = await product.command({ action: "create_goal", workspaceId: initial.workspaces[0].id, title: "Parallel launch" });
    startItem.mockClear();

    await expect(product.createSubitems({ parentId: goal.id, items: [
      { title: "Valid" }, { title: "Invalid", agentAssignmentId: "foreign-or-missing" }
    ] })).rejects.toThrow("belong to this team");
    await expect(product.createSubitems({ parentId: goal.id, items: [
      { title: "Duplicate" }, { title: "Duplicate" }
    ] })).rejects.toThrow("distinct titles");
    expect(startItem).not.toHaveBeenCalled();
    expect(db.prepare("SELECT id FROM work_items WHERE parent_id = ?").all(goal.id)).toEqual([]);
  });
});
