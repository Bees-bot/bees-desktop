import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { BeesProduct } from "../dsh-runtime/plugin/lib/product.js";
import { WorkContext } from "../dsh-runtime/plugin/lib/work-context.js";
import { itemContext } from "../dsh-runtime/plugin/lib/product-database.js";
import { NodeDatabase } from "./node-database.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bees-run-context-"));
  const db = new NodeDatabase().connection;
  const agents = new AgentRuntime({ on: () => () => undefined }, db);
  const execute = vi.spyOn(agents, "executeStage").mockResolvedValue({ outcome: "candidate" } as any);
  const product: any = new BeesProduct(db, agents, { startItem: async () => ({}), isAutomatic: () => false }, directory);
  const recall = vi.spyOn(product.memory, "recall").mockResolvedValue([{ text: "Use source categories" }]);
  const link = (id: string, itemId: string, path: string, data: any = {}, at = id) => db.prepare(`INSERT INTO execution_links
    (execution_id, workspace_id, work_item_id, agent_name, current_session_id, instance_uid,
     run_directory, config_json, status, created_at, updated_at)
    VALUES (?, ?, ?, 'bees-run', ?, ?, ?, ?, 'completed', ?, ?)`)
    .run(id, itemContext(db, itemId).workspaceId, itemId, id, id, path, JSON.stringify(data), at, at);
  const run = async (itemId: string, id: string, purpose = "worker", candidateExecutionId?: string) => {
    const item = itemContext(db, itemId);
    const stage = db.prepare("SELECT id, name FROM stages WHERE process_id = ? AND driver = ? ORDER BY position LIMIT 1")
      .get(item.processId, purpose === "reviewer" ? "review" : "agent")!;
    await product.runProcessStage({ workItemId: itemId, executionId: id, stageId: stage.id,
      stageName: stage.name, purpose, candidateExecutionId });
    const payload: any = execute.mock.calls.at(-1)![1];
    link(id, itemId, payload.workspace, payload.initialData);
    return payload;
  };
  return { db, directory, agents, product, recall, run, link,
    close: () => { db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

it("uses one run context and folder across hierarchy, stages, lifecycle changes and restart", async () => {
  const f = fixture();
  try {
    const initial = await f.product.snapshot();
    const workspaceId = initial.workspaces[0].id, teamId = initial.teams[0].id;
    const root = await f.product.command({ action: "create_goal", workspaceId, title: "Hacker News", description: "Count articles by category." });
    const processId = itemContext(f.db, root.id).processId;
    const child = await f.product.command({ action: "create_item", processId, parentId: root.id, title: "Research" });
    const nested = await f.product.command({ action: "create_item", processId, parentId: child.id, title: "Collect articles" });
    const sibling = await f.product.command({ action: "create_item", processId, parentId: root.id, title: "Pie chart" });
    const sourcePath = join(f.directory, "articles.csv");
    writeFileSync(sourcePath, "news,12\nshow hn,4\n");
    const source = await f.product.command({ action: "add_location", teamId, name: "Articles", kind: "file", path: sourcePath });
    await f.product.command({ action: "attach_location", itemId: nested.id, locationId: source.id });

    // The first item to execute need not be the root or have a running parent.
    const first = await f.run(nested.id, "nested-worker");
    expect(first.workspace).toBe(join(f.directory, "runs", root.id));
    writeFileSync(join(first.workspace, "outputs", "articles.csv"), "news,12\nshow hn,4\n");
    f.product.workContext.post(nested.id, { author: "Researcher", content: "The original articles are ready." });
    f.db.prepare("UPDATE work_items SET runtime_phase = 'completed' WHERE id IN (?, ?)").run(root.id, child.id);
    writeFileSync(sourcePath, "Changed live source");
    const rootStage = await f.run(root.id, "root-worker");
    const chartStage = await f.run(sibling.id, "chart-worker");
    for (const payload of [rootStage, chartStage]) {
      expect(payload.workspace).toBe(first.workspace);
      expect(payload.initialData.contextId).toBe(first.initialData.contextId);
      expect(payload.body).toContain("The original articles are ready");
    }
    expect(f.recall).toHaveBeenCalledTimes(1);
    expect(f.recall).toHaveBeenCalledWith(workspaceId, "Hacker News\nCount articles by category.");
    expect(readFileSync(join(first.workspace, "inputs", `Articles-${source.id.slice(0, 8)}`, "articles.csv"), "utf8")).toContain("news,12");

    const result = { outcome: "candidate", summary: "Produced outputs/articles.csv" };
    const evidence = f.product.workContext.resultEvidence("root-worker", rootStage.initialData, first.workspace, result, []);
    f.product.workContext.recordResult("root-worker", rootStage.initialData, result, [], evidence);
    f.db.prepare("INSERT INTO bees_stage_results VALUES ('root-worker', 'worker', 'candidate', ?, 'now')").run(result.summary);
    const review = await f.run(root.id, "root-review", "reviewer", "root-worker");
    expect(review.workspace).toBe(first.workspace);
    expect(readFileSync(join(first.workspace, ".bees-reviews", "root-review", "candidate", "articles.csv"), "utf8")).toContain("news,12");
    writeFileSync(join(first.workspace, "outputs", "chart.svg"), "<svg />");
    // A later worker must not restore an older candidate over the shared folder.
    await f.run(root.id, "later-stage", "worker", "root-worker");
    expect(readFileSync(join(first.workspace, "outputs", "chart.svg"), "utf8")).toBe("<svg />");

    f.product.workContext.setMemories("chart-worker", [{ text: "The chart uses the existing 16 articles." }]);
    const restarted = new WorkContext(f.db);
    for (const item of [root, child, nested, sibling]) {
      expect(restarted.directory(item.id, f.directory)).toBe(first.workspace);
      expect(restarted.discussion(item.id).rootId).toBe(root.id);
    }
    for (const id of ["nested-worker", "root-worker", "chart-worker", "root-review", "later-stage"])
      expect(restarted.run(id)!.memories).toEqual([{ text: "The chart uses the existing 16 articles." }]);
    const pending = restarted.view(child.id);
    expect(pending.context).toBeNull();
    expect(pending.runContext.content).toEqual(restarted.run("root-worker")!.content);
    expect(pending.runContext.memories).toEqual(restarted.run("root-worker")!.memories);
    await f.product.command({ action: "edit_item", itemId: nested.id, title: "Original articles", description: "Keep the source data" });
    expect(itemContext(f.db, nested.id).parentId).toBe(child.id);
    await f.product.command({ action: "edit_item", itemId: nested.id, title: "Original articles", parentId: sibling.id });
    expect(restarted.directory(nested.id, f.directory)).toBe(first.workspace);
    await expect(f.product.command({ action: "edit_item", itemId: nested.id, title: "Original articles", parentId: null }))
      .rejects.toThrow("remain in its process run");
    const dispatch = vi.spyOn(f.agents, "dispatch").mockResolvedValue({ status: "queued" } as any);
    await f.product.command({ action: "run_item", itemId: child.id });
    const manual: any = dispatch.mock.calls.at(-1)![2];
    expect(manual.workspace).toBe(first.workspace);
    expect(manual.body).toContain("The original articles are ready");
    expect(manual.body).toContain("The chart uses the existing 16 articles.");
    const again = vi.fn(async () => []);
    await restarted.recallMemories("root-review", again);
    expect(again).not.toHaveBeenCalled();

    const target = await f.product.command({ action: "add_location", teamId, name: "Results", kind: "folder", path: f.directory });
    await f.product.command({ action: "set_output_location", itemId: nested.id, locationId: target.id });
    let snapshot = await f.product.snapshot();
    for (const item of snapshot.items) {
      expect(item.processRunId).toBe(root.id);
      expect(item.outputLocationId).toBe(target.id);
      expect(snapshot.attachments).toContainEqual({ workItemId: item.id, locationId: source.id, relativePath: "" });
    }
    expect(snapshot.runs.every((run: any) => run.processRunId === root.id)).toBe(true);
    await f.product.command({ action: "detach_location", itemId: sibling.id, locationId: source.id });
    snapshot = await f.product.snapshot();
    expect(snapshot.attachments).toEqual([]);

    const separate = await f.product.command({ action: "create_run", processId, title: "Separate run" });
    const isolated = await f.run(separate.id, "separate-worker");
    expect(isolated.workspace).not.toBe(first.workspace);
    expect(restarted.discussion(separate.id).updates).toEqual([]);
    expect(restarted.run("separate-worker")!.memories).toEqual([{ text: "Use source categories" }]);
    expect(f.recall).toHaveBeenCalledTimes(2);
  } finally { f.close(); }
});

it("adopts old folders across the whole run once and preserves their existing files", async () => {
  const f = fixture();
  try {
    const workspaceId = (await f.product.snapshot()).workspaces[0].id;
    const root = await f.product.command({ action: "create_goal", workspaceId, title: "Legacy run" });
    const child = await f.product.command({ action: "create_item", processId: itemContext(f.db, root.id).processId,
      parentId: root.id, title: "Older child" });
    for (const [id, itemId, name, content] of [["old", root.id, "articles.csv", "original articles"],
      ["new", child.id, "chart.svg", "chart"]]) {
      const path = join(f.directory, "runs", id!);
      mkdirSync(join(path, "outputs"), { recursive: true });
      writeFileSync(join(path, "outputs", name!), content!);
      writeFileSync(join(path, "outputs", "summary.md"), id!);
      f.link(id!, itemId!, path, {}, id === "old" ? "1" : "2");
    }
    const shared = f.product.workContext.directory(root.id, f.directory);
    expect(shared).toBe(join(f.directory, "runs", "new"));
    expect(readFileSync(join(shared, "outputs", "articles.csv"), "utf8")).toBe("original articles");
    expect(readFileSync(join(shared, "outputs", "summary.md"), "utf8")).toBe("new");
    expect(new WorkContext(f.db).directory(child.id, f.directory)).toBe(shared);
    expect(readFileSync(join(f.directory, "runs", "old", "outputs", "summary.md"), "utf8")).toBe("old");
  } finally { f.close(); }
});

it("shares a single pending memory recall between concurrently starting items", async () => {
  const f = fixture();
  try {
    const workspaceId = (await f.product.snapshot()).workspaces[0].id;
    const root = await f.product.command({ action: "create_goal", workspaceId, title: "Research" });
    const child = await f.product.command({ action: "create_item", processId: itemContext(f.db, root.id).processId,
      parentId: root.id, title: "Chart" });
    const context = f.product.workContext;
    context.pin("child", itemContext(f.db, child.id));
    context.pin("root", itemContext(f.db, root.id));
    let resolve!: (value: any[]) => void;
    const recall = vi.fn(() => new Promise<any[]>((done) => { resolve = done; }));
    const first = context.recallMemories("child", recall), second = context.recallMemories("root", recall);
    await Promise.resolve();
    expect(recall).toHaveBeenCalledTimes(1);
    resolve([{ text: "Shared memory" }]);
    await Promise.all([first, second]);
    expect(context.run("child").memories).toEqual(context.run("root").memories);
  } finally { f.close(); }
});

it("delivers earlier article rows directly in follow-up context even without knowledge search results", async () => {
  const f = fixture();
  try {
    const workspaceId = (await f.product.snapshot()).workspaces[0].id;
    const root = await f.product.command({ action: "create_goal", workspaceId, title: "Read Hacker News", description: "Browse and categorize articles." });
    const producer = await f.run(root.id, "research");
    const table = "| Category | Title |\n|---|---|\n| News | First |\n| Show HN | Second |\n| News | Third |\n";
    writeFileSync(join(producer.workspace, "outputs", "articles.md"), table);
    const chart = await f.product.command({ action: "create_item", processId: itemContext(f.db, root.id).processId,
      parentId: root.id, title: "Create a pie chart", description: "Count each category in the saved articles." });
    f.db.prepare("UPDATE work_items SET runtime_phase = 'completed' WHERE id = ?").run(root.id);
    const abandoned = await f.product.command({ action: "create_item", processId: itemContext(f.db, root.id).processId,
      parentId: root.id, title: "Earlier blocked attempt" });
    f.product.workContext.post(abandoned.id, { executionId: "abandoned-worker", author: "Agent", content: "There is no saved article data." });
    f.product.workContext.post(abandoned.id, { author: "User", content: "Use the saved article rows." });
    f.db.prepare("UPDATE work_items SET runtime_phase = 'failed', archived_at = 'now' WHERE id = ?").run(abandoned.id);
    const followup = await f.run(chart.id, "chart");
    expect(followup.body).toContain('"workItemPhase":"failed","workItemArchivedAt":"now"');
    expect(followup.body).toContain("There is no saved article data.");
    expect(followup.body).toContain("Use the saved article rows.");
    expect(followup.body).toContain("News | First");
    expect(followup.body).toContain("Show HN | Second");
    expect(f.product.workContext.updates(chart.id).updates).toContainEqual(expect.objectContaining({ content: "There is no saved article data." }));
    const view = await f.product.command({ action: "read_work_context", itemId: chart.id, executionId: "chart" });
    expect(view.files).toContainEqual({ path: "outputs/articles.md", content: table, truncated: false });
    expect(followup.body).toMatch(/^Current work item: Create a pie chart/);
    expect(followup.body).toContain("outputs/articles.md");
    const categories = view.files[0].content.split("\n").slice(2).filter(Boolean).map((row: string) => row.split("|")[1]!.trim());
    expect(categories.filter((category: string) => category === "News")).toHaveLength(2);
    expect(categories.filter((category: string) => category === "Show HN")).toHaveLength(1);

    writeFileSync(join(producer.workspace, "outputs", "long.md"), "x".repeat(20_000));
    const outside = join(f.directory, "private.md");
    writeFileSync(outside, "Unrelated source");
    symlinkSync(outside, join(producer.workspace, "outputs", "linked.md"));
    const previews = f.product.workContext.files(chart.id, true);
    expect(previews).toContainEqual({ path: "outputs/long.md", content: "x".repeat(6_000), truncated: true });
    expect(previews.some((file: any) => file.path === "outputs/linked.md")).toBe(false);
    expect(previews.reduce((sum: number, file: any) => sum + (file.content?.length ?? 0), 0)).toBeLessThanOrEqual(12_000);
    const separate = await f.product.command({ action: "create_run", processId: itemContext(f.db, root.id).processId, title: "Unrelated" });
    expect(f.product.workContext.files(separate.id, true)).toEqual([]);
  } finally { f.close(); }
});

it("does not reuse an incomplete input snapshot after staging fails", async () => {
  const f = fixture();
  try {
    const initial = await f.product.snapshot();
    const root = await f.product.command({ action: "create_goal", workspaceId: initial.workspaces[0].id, title: "Read the source" });
    const path = join(f.directory, "large.txt");
    writeFileSync(path, Buffer.alloc(20_000_001));
    const source = await f.product.command({ action: "add_location", teamId: initial.teams[0].id, name: "Source", kind: "file", path });
    await f.product.command({ action: "attach_location", itemId: root.id, locationId: source.id });
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(f.run(root.id, `failed-${attempt}`)).rejects.toThrow("larger than 20 MB");
    writeFileSync(path, "Corrected source");
    const run = await f.run(root.id, "corrected");
    expect(readFileSync(join(run.workspace, "inputs", `Source-${source.id.slice(0, 8)}`, "large.txt"), "utf8")).toBe("Corrected source");
  } finally { f.close(); }
});
