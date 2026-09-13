import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkContext } from "../dsh-runtime/plugin/lib/work-context.js";
import { itemContext } from "../dsh-runtime/plugin/lib/product-database.js";
import { NodeDatabase } from "./node-database.js";

function fixture() {
  const db = new NodeDatabase().connection;
  const stage = db.prepare("SELECT id, process_id AS processId FROM stages WHERE driver = 'agent' LIMIT 1").get() as { id: string; processId: string };
  const add = (id: string, parent: string | null = null) => {
    db.prepare(`INSERT INTO work_items (id, process_id, stage_id, parent_id, kind, title, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'work', ?, 'Use only supplied sources. Include dates.', 'now', 'now')`)
      .run(id, stage.processId, stage.id, parent, id);
    return itemContext(db, id);
  };
  return { db, add, contexts: new WorkContext(db) };
}

describe("authoritative work context", () => {
  it("pins identical worker and reviewer criteria even after the live request changes", () => {
    const { db, add, contexts } = fixture();
    const item = add("root");
    const worker = contexts.pin("worker", item, { instructions: "Produce a table", systemInstructions: "Use English", references: "approved source" });
    db.prepare("UPDATE work_items SET description = 'Changed after production' WHERE id = ?").run(item.id);
    const reviewer = contexts.pin("review", itemContext(db, item.id), { reviewer: true, candidateExecutionId: "worker", instructions: "Check independently" });
    expect(reviewer.id).toBe(worker.id);
    expect(reviewer.scope).toEqual(worker.scope);
    expect(contexts.prompt("review")).toBe(contexts.prompt("worker"));
    expect(contexts.prompt("review")).not.toContain("Changed after production");
    expect(contexts.pin("new-work", itemContext(db, item.id)).version).toBe(2);
    expect(() => contexts.pin("bad-review", item, { reviewer: true, candidateExecutionId: "missing" })).toThrow("pinned");
    db.close();
  });

  it("shares the root contract with children without erasing their assigned scope", () => {
    const { db, add, contexts } = fixture();
    const root = add("root");
    contexts.pin("root-run", root, { instructions: "Lead the task" });
    const child = add("child", root.id);
    const pinned = contexts.pin("child-run", child, { instructions: "Check the dates" });
    expect(pinned.id).toBe(contexts.run("root-run")!.id);
    expect(pinned.scope.assignments[0]!.title).toBe("child");
    contexts.post(child.id, { kind: "finding", author: "Peer", content: "A date is missing", evidence: "inputs/source.md" });
    expect(contexts.prompt("root-run")).toContain("A date is missing");
    add("unrelated");
    expect(() => contexts.post(root.id, { author: "Lead", targetId: "unrelated", content: "No" })).toThrow("same primary");
    expect(contexts.updates("unrelated").updates).toEqual([]);
    expect(() => contexts.view("unrelated", "root-run")).toThrow("another work item");
    db.close();
  });

  it("preserves source inputs and candidate bytes and stops repeated rejection of unchanged work", () => {
    const { db, add, contexts } = fixture();
    const item = add("root");
    const dir = mkdtempSync(join(tmpdir(), "bees-pinned-evidence-"));
    try {
      mkdirSync(join(dir, "outputs")); mkdirSync(join(dir, "inputs"));
      writeFileSync(join(dir, "outputs", "result.md"), "The original candidate");
      writeFileSync(join(dir, "inputs", "source.md"), "The original source");
      contexts.pin("worker", item);
      const data = { stagePurpose: "worker", workItemId: item.id, agentName: "Worker" };
      const result = { outcome: "candidate", summary: "Produced outputs/result.md" };
      const evidence = contexts.resultEvidence("worker", data, dir, result, []);
      contexts.recordResult("worker", data, result, [], evidence);
      writeFileSync(join(dir, "outputs", "result.md"), "Modified later");
      expect(readFileSync(join(evidence.directory!, "result.md"), "utf8")).toBe("The original candidate");
      expect(readFileSync(join(evidence.directory!, "..", "inputs", "source.md"), "utf8")).toBe("The original source");
      const reviewData = { ...data, stagePurpose: "reviewer", candidateExecutionId: "worker" };
      const findings = [{ criterion: "goal", evidence: "Date absent", change: "Add the source date" }];
      contexts.pin("review", item, { reviewer: true, candidateExecutionId: "worker" });
      const revision = { outcome: "revise", summary: "Add the date" };
      contexts.recordResult("review", reviewData, revision, findings, contexts.resultEvidence("review", reviewData, dir, revision, findings));
      contexts.pin("review-again", item, { reviewer: true, candidateExecutionId: "worker" });
      expect(() => contexts.resultEvidence("review-again", reviewData, dir, revision, findings)).toThrow("No progress");
      expect(() => contexts.findings("review", '[{"criterion":"personal preference","evidence":"x","change":"y"}]')).toThrow("criterion");
    } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
  });
});
