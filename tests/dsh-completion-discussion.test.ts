import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { WorkContext } from "../dsh-runtime/plugin/lib/work-context.js";
import { NodeDatabase } from "./node-database.js";

function work(db: any, id: string, parent: string | null = null) {
  const stage = db.prepare(`SELECT s.id, s.process_id AS processId, p.workspace_id AS workspaceId
    FROM stages s JOIN processes p ON p.id = s.process_id WHERE s.driver = 'agent' LIMIT 1`).get();
  db.prepare(`INSERT INTO work_items (id, parent_id, process_id, stage_id, title, description, runtime_phase, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'Write the strategy', 'running', '2026-01-01', '2026-01-01')`)
    .run(id, parent, stage.processId, stage.id, id);
  return stage;
}

describe("completion recording and visible discussion", () => {
  it("preserves a peer document after a rejected submission, exposes the real error, and records completion on explicit retry", async () => {
    const db = new NodeDatabase().connection;
    const directory = mkdtempSync(join(tmpdir(), "bees-completion-"));
    const runtime: any = new AgentRuntime({ on: () => () => undefined, tools: { schemas: () => [] },
      agentPresets: { defaultId: "standard", mount: async () => undefined } }, db);
    try {
      work(db, "root");
      const stage = work(db, "cmo", "root");
      db.prepare(`INSERT INTO execution_links
        (execution_id, workspace_id, work_item_id, agent_name, current_session_id, instance_uid, run_directory, config_json, status, created_at, updated_at)
        VALUES ('peer-run', ?, 'cmo', 'bees-run', 'peer-session', 'peer-uid', ?, '{}', 'running', '2026-01-01', '2026-01-01')`)
        .run(stage.workspaceId, directory);
      mkdirSync(join(directory, "outputs"));
      const document = join(directory, "outputs", "strategy.md");
      writeFileSync(document, "Completed CMO strategy");
      const tools: any[] = [];
      await runtime.setup({ systemPrompt: { section: () => undefined, context: () => undefined, variable: () => undefined },
        tools: { register: (tool: any) => tools.push(tool), restrict: () => undefined } }, {
        mode: "work", stagePurpose: "worker", agentName: "CMO", agentPresetId: "standard",
        workItemId: "cmo", workspaceId: stage.workspaceId, mcpAccess: "none", mcpServers: [], grants: []
      }, "peer-run", directory);
      const submit = tools.find(({ name }) => name === "bees_submit_stage_result");
      const exec = { concludeTurn: vi.fn(), agent: { session: { id: "peer-session", header: {} } } };
      const result = { outcome: "candidate", summary: "Produced outputs/strategy.md" };
      const args = { ...result, acceptance_criteria_met: true };
      vi.spyOn(runtime.workContext, "post").mockImplementationOnce(() => { throw new Error("journal unavailable"); });
      await expect(submit.execute(args, exec)).rejects.toThrow("journal unavailable");
      expect(runtime.stageResult("peer-run")).toBeUndefined();
      expect(runtime.workContext.candidate("peer-run")).toBeUndefined();
      expect(exec.concludeTurn).not.toHaveBeenCalled();
      expect(readFileSync(document, "utf8")).toBe("Completed CMO strategy");
      db.exec(`INSERT INTO dsh_deliveries (delivery_id, execution_id, submission_id, created_at)
        VALUES ('start:submit', 'peer-run', 'submit-turn', '2026-01-01')`);
      vi.spyOn(runtime, "waitForDelivery").mockResolvedValue({ outcome: "completed" });
      await expect(runtime.executeStage("peer-run", {})).rejects.toThrow("bees_submit_stage_result failed: journal unavailable");
      db.exec("UPDATE dsh_deliveries SET outcome = 'completed'; UPDATE execution_links SET status = 'completed'");
      const admit = vi.spyOn(runtime, "admit").mockImplementation(async () => {
        await submit.execute(args, exec);
        return { submissionId: "retry-turn", deliveryId: "retry:1" };
      });
      await expect(runtime.executeStage("peer-run", { retryId: "retry:1", body: "Continue" })).resolves.toEqual(result);
      expect(admit).toHaveBeenCalledExactlyOnceWith("bees-run", "peer-run", expect.objectContaining({
        uid: "peer-uid", initialData: undefined, idempotencyKey: "retry:1",
        body: expect.stringContaining("Continue from the work already completed")
      }));
      expect(runtime.workContext.discussion("root").updates).toEqual([expect.objectContaining({
        author: "CMO", kind: "result", workItemId: "cmo", content: result.summary
      })]);
      await submit.execute(args, exec);
      expect(runtime.workContext.discussion("root").updates).toHaveLength(1);
      expect(readFileSync(document, "utf8")).toBe("Completed CMO strategy");
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("pages the newest discussion across peers without leaking other primary tasks", () => {
    const db = new NodeDatabase().connection;
    try {
      work(db, "root"); work(db, "ceo", "root"); work(db, "cmo", "root"); work(db, "unrelated");
      const context = new WorkContext(db);
      for (let index = 0; index < 45; index++) expect(context.post("ceo", {
        author: "CEO", targetId: "cmo", content: `Question ${index}`
      }).rootId).toBe("root");
      context.post("unrelated", { author: "Other", content: "Private to another task" });
      const latest = context.discussion("cmo");
      expect(latest.updates).toHaveLength(40);
      expect(latest.updates[0].content).toBe("Question 5");
      expect(latest.updates.at(-1).content).toBe("Question 44");
      expect(latest.hasMore).toBe(true);
      expect(latest.participants.map((peer: any) => peer.id).sort()).toEqual(["ceo", "cmo", "root"]);
      const earlier = context.discussion("root", latest.before);
      expect(earlier.updates).toHaveLength(5);
      expect(earlier.hasMore).toBe(false);
      expect(earlier.updates[0].content).toBe("Question 0");
      expect(() => context.discussion("root", -1)).toThrow("cursor");
      expect(context.discussion("unrelated").updates).toHaveLength(1);
    } finally { db.close(); }
  });

  it("renders attributed messages, recipients and work/file navigation separately from context", () => {
    const source = readFileSync(new URL("../dsh-runtime/plugin/client/collaboration.js", import.meta.url), "utf8")
      .replace(/^import .*;\n/gm, "").replaceAll("export function", "function");
    const view = { participants: [{ id: "ceo", title: "CEO strategy", status: "completed" }, { id: "cmo", title: "CMO launch", status: "running" }],
      updates: [{ id: "message", seq: 1, workItemId: "ceo", executionId: "ceo-run", targetId: "cmo", author: "CEO", kind: "decision",
        content: "Target agencies first", evidence: "outputs/strategy.md", createdAt: "2026-09-13T12:00:00Z" }],
      hasMore: true, before: 1, context: { version: 1, content: { goal: "Launch" }, scope: {}, memories: [] } };
    let index = 0;
    const ui = new Script(source + "; ({ WorkDiscussion, SharedWorkContext })").runInNewContext({
      h: (tag: any, props: any, ...children: any[]) => ({ tag, props, children }), Button: "button", React: {},
      useState: () => [[view, "", false, false][index++], () => {}], useEffect: () => {}, useBeesChangeRevision: () => 0
    });
    const open = vi.fn();
    const tree = ui.WorkDiscussion({ item: { id: "root" }, onOpenWork: open });
    const nodes: any[] = [];
    const visit = (node: any) => { if (node && typeof node === "object") { nodes.push(node); node.children?.flat().forEach(visit); } };
    visit(tree);
    const rendered = JSON.stringify(tree);
    for (const text of ["CEO / decision", "To: CMO launch", "Target agencies first", "outputs/strategy.md", "Load earlier messages", "Join the discussion"])
      expect(rendered).toContain(text);
    nodes.find((node) => node.children?.includes("Work and files: CEO strategy")).props.onClick();
    expect(open).toHaveBeenCalledWith("ceo");
    expect(nodes.some((node) => node.props?.role === "log")).toBe(true);
    index = 0;
    const context = JSON.stringify(ui.SharedWorkContext({ item: { id: "root" } }));
    expect(context).toContain("Exact requirements and assigned scope");
    expect(context).not.toContain("Target agencies first");
  });
});
