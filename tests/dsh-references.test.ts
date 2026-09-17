import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { BeesProduct } from "../dsh-runtime/plugin/lib/product.js";
import { authorizeReferences, referenceContext, referenceText, resolveReferences, typedReferences } from "../dsh-runtime/plugin/lib/product-references.js";
import { NodeDatabase } from "./node-database.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "bees-refs-"));
  roots.push(root);
  const database = new NodeDatabase().connection;
  const runtime: any = new AgentRuntime({ on: () => () => undefined,
    agentPresets: { defaultId: "standard", mount: async () => undefined }, tools: { schemas: () => [] } }, database);
  const dispatch = vi.spyOn(runtime, "dispatch").mockResolvedValue({ sessionId: "plan", status: "queued" });
  const stages = { startItem: vi.fn(async () => ({})), isAutomatic: () => true, createRecurring: async () => ({}) };
  const capabilities = { command: vi.fn(async () => ({})) };
  const product = new BeesProduct(database, runtime, stages, root, { capabilities });
  const { id: workspaceId, team_id: teamId } = database.prepare("SELECT id, team_id FROM workspaces LIMIT 1").get() as { id: string; team_id: string };
  const resolve = (text: string) => resolveReferences(database, workspaceId, text);
  expect(() => resolve("$missing-agent do the work")).toThrow("unavailable");
  const agent = database.prepare("SELECT id FROM agent_assignments WHERE workspace_id = ? AND name = 'CEO'").get(workspaceId) as { id: string };
  const researcher = await product.command({ action: "add_agent_assignment", workspaceId, presetId: "standard", name: "Field Researcher" });
  database.prepare("UPDATE users SET name = 'Vinay'").run();
  const work = await product.command({ action: "create_goal", workspaceId, title: "Pricing Proposal", description: "Charge 25 per seat." });
  const process = await product.command({ action: "create_process", workspaceId, name: "Q4 Launch", stages: ["Work", "Done"] });
  const template = await product.command({ action: "create_process_template", workspaceId, name: "Product Launch",
    stages: [{ name: "Draft", driver: "agent", requiresHumanApproval: true }, { name: "Done", driver: "terminal" }] });
  const docs = join(root, "docs");
  mkdirSync(join(docs, "nested"), { recursive: true });
  writeFileSync(join(docs, "nested", "proposal.pdf"), "PDF fixture bytes");
  writeFileSync(join(docs, "unrelated.txt"), "Must not be attached");
  const location = await product.command({ action: "add_location", teamId, name: "Documents", kind: "folder", path: docs });
  return { root, database, runtime, dispatch, stages, product, capabilities, workspaceId, teamId, resolve, agent, researcher, work, process, template, docs, location };
}

it("resolves every requested shorthand using existing, scoped resources", async () => {
  const { database, product, workspaceId, resolve, agent, researcher, work, process, template, location } = await setup();
  const result = resolve("$ceo discuss with $human:vinay using $work:pricing-proposal, $template:product-launch, $file:proposal.pdf and $process:q4-launch.");
  expect(result.references.map(({ kind }) => kind)).toEqual(["agent", "human", "work-item", "process-template", "file", "process"]);
  expect(result.references.map(({ id }) => id)).toEqual([
    agent.id, database.prepare("SELECT id FROM users LIMIT 1").get()!.id, work.id, template.id,
    `${location.id}/nested%2Fproposal.pdf`, process.id
  ]);
  expect(typedReferences(result.text)).toEqual(result.references);
  expect(result.text).toMatch(/\)\.$/);
  expect(resolve(result.text)).toEqual(result);
  expect(resolve("$field-researcher investigate").references[0]!.id).toBe(researcher.id);
  const assigned = await product.command({ action: "create_goal", workspaceId, title: "Investigate", description: "$field-researcher: investigate" });
  expect(database.prepare("SELECT agent_assignment_id AS id FROM work_items WHERE id = ?").get(assigned.id)).toEqual({ id: researcher.id });
  expect(resolve("Discuss $ceo and $ceo").references).toHaveLength(1);
  expect(referenceContext(database, workspaceId, result.references)).toContain("Charge 25 per seat");
  expect(referenceContext(database, workspaceId, result.references)).toContain('"requiresHumanApproval":true');
  database.prepare("UPDATE work_items SET archived_at = '2026-09-06' WHERE id = ?").run(work.id);
  expect(resolve("Read $work:pricing-proposal").references[0]!.id).toBe(work.id);
  expect((await product.references("template:product-launch", workspaceId)).dollar[0].id).toBe(template.id);
  expect((await product.references("file:proposal.pdf", workspaceId)).dollar[0].id).toBe(`${location.id}/nested%2Fproposal.pdf`);
  expect(resolve('Cost $25; `echo $HOME`; \\$unknown; ```\n$unknown\n```').references).toEqual([]);
});

it("carries all reference identities and exact file snapshots through Ask, Apply, scheduling, and execution", async () => {
  const { root, database, runtime, dispatch, stages, product, workspaceId, agent, process, location } = await setup();
  await product.command({ action: "ask_bees", workspaceId, mcpAccess: "none",
    outcome: "$ceo read $file:proposal.pdf for $human:vinay. Use $process:q4-launch and $work:pricing-proposal, with $template:product-launch as context." });
  const payload: any = dispatch.mock.calls[0]![2];
  const refs = typedReferences(payload.initialData.purpose);
  expect(refs).toHaveLength(6);
  expect(payload.body).toContain("Charge 25 per seat");
  expect(payload.body).toContain("Available input snapshots:");
  expect(payload.body).not.toContain("Team folders you named");
  const plannerInputs = join(payload.workspace, "inputs");
  const inputDirectory = join(plannerInputs, readdirSync(plannerInputs)[0]!);
  expect(readdirSync(inputDirectory)).toEqual(["proposal.pdf"]);
  expect(readFileSync(join(inputDirectory, "proposal.pdf"), "utf8")).toBe("PDF fixture bytes");
  const tools: any[] = [];
  await runtime.setup({ systemPrompt: { section: () => {}, context: () => {}, variable: () => undefined },
    tools: { register: (tool: any) => tools.push(tool), restrict: () => {} }
  }, payload.initialData, "plan", payload.workspace);
  const proposal = await tools.find(({ name }) => name === "bees_propose_changes").execute({
    proposal_title: "Review pricing", proposal_summary: "Use the existing launch process",
    changes_json: JSON.stringify([
      { action: "create_item", process: process.id, title: "Review pricing", description: "Compare the proposal and summarize." },
      { action: "create_recurring_work", item: "Review pricing", name: "Weekly pricing", frequency: "weekly", dayOfWeek: "MONDAY", hour: 9 }
    ])
  }, { agent: { session: { id: "plan" } } });
  database.prepare("UPDATE agent_assignments SET name = 'Director' WHERE id = ?").run(agent.id);
  database.prepare("UPDATE users SET name = 'V Aggarwal'").run();
  database.prepare("UPDATE processes SET name = 'Launch renamed' WHERE id = ?").run(process.id);
  const applied = await product.command({ action: "apply_proposal", proposalId: proposal.id });
  for (const id of [applied.results[0].id, applied.results[1].sourceWorkItemId]) {
    const item = database.prepare("SELECT description, agent_ids_json AS agents FROM work_items WHERE id = ?").get(id)!;
    expect(typedReferences(String(item.description)).map(({ id }) => id)).toEqual(refs.map(({ id }) => id));
    expect(JSON.parse(String(item.agents))).toEqual([agent.id]);
    expect(database.prepare("SELECT location_id AS id, relative_path AS path FROM work_item_locations WHERE work_item_id = ?").all(id))
      .toEqual([{ id: location.id, path: "nested/proposal.pdf" }]);
  }
  expect(stages.startItem).not.toHaveBeenCalledWith(applied.results[0].id);
  const execute = vi.spyOn(runtime, "executeStage").mockResolvedValue({ outcome: "candidate" });
  const stage = database.prepare("SELECT id, name FROM stages WHERE process_id = ? ORDER BY position LIMIT 1").get(process.id)!;
  await product.runProcessStage({ workItemId: applied.results[0].id, stageId: stage.id, stageName: stage.name, purpose: "worker", executionId: "execute-refs" });
  expect((execute.mock.calls[0]![1] as any).body).toContain("Charge 25 per seat");
  const workInputs = join(root, "runs", applied.results[0].id, "inputs");
  expect(readdirSync(join(workInputs, readdirSync(workInputs)[0]!))).toEqual(["proposal.pdf"]);
});

it("creates a requested process from the referenced template's approved stages", async () => {
  const { database, product, workspaceId, resolve, template } = await setup();
  const proposal = product.storeProposal({ workspaceId, title: "Launch workflow", request: resolve("Create a workflow from $template:product-launch").text,
    changes: [{ action: "create_process", name: "Launch copy", template: template.id }] });
  database.prepare("UPDATE process_templates SET stages_json = ? WHERE id = ?").run(JSON.stringify([{ name: "Different", driver: "agent" }, { name: "Done", driver: "terminal" }]), template.id);
  const applied = await product.command({ action: "apply_proposal", proposalId: proposal.id });
  expect(database.prepare("SELECT name, requires_human_approval AS approval FROM stages WHERE process_id = ? ORDER BY position").all(applied.results[0].id))
    .toEqual([{ name: "Draft", approval: 1 }, { name: "Done", approval: 0 }]);
});

it("rejects missing, ambiguous, foreign, hidden, and escaped references before planning", async () => {
  const { root, database, product, dispatch, workspaceId, teamId, resolve, docs, location } = await setup();
  await product.command({ action: "add_agent_assignment", workspaceId, presetId: "standard", name: "ceo" });
  expect(() => resolve("$ceo discuss")).toThrow("ambiguous");
  writeFileSync(join(docs, "proposal.pdf"), "Another PDF");
  expect(() => resolve("$file:proposal.pdf")).toThrow("ambiguous");
  expect(resolve('$file:"Documents/nested/proposal.pdf"').references).toHaveLength(1);
  writeFileSync(join(docs, ".secret.pdf"), "Hidden");
  writeFileSync(join(root, "outside.pdf"), "Outside");
  symlinkSync(join(root, "outside.pdf"), join(docs, "escape.pdf"));
  for (const value of ["$file:Documents/../outside.pdf", "$file:Documents/escape.pdf", "$file:Documents/.secret.pdf",
    "$human:nobody", "$work:missing", "$template:missing", "$process:missing", "$file:missing.pdf"]) {
    await expect(product.command({ action: "ask_bees", workspaceId, outcome: value, mcpAccess: "none" })).rejects.toThrow();
  }
  expect(dispatch).not.toHaveBeenCalled();
  const organizationId = database.prepare("SELECT organization_id AS id FROM teams WHERE id = ?").get(teamId)!.id;
  const other = await product.command({ action: "create_team", organizationId, name: "Private team" });
  const privateWork = await product.command({ action: "create_goal", workspaceId: other.workspaceId, title: "Private pricing" });
  expect(() => resolve(referenceText({ kind: "work-item", id: privateWork.id, label: "Private pricing" }))).toThrow("unavailable in this workspace");
  expect(() => authorizeReferences(database, other.workspaceId, [{ kind: "file", id: `${location.id}/nested%2Fproposal.pdf`, label: "PDF" }])).toThrow("unavailable in this workspace");
});

it("revalidates preserved references before any Apply side effect", async () => {
  const { database, product, capabilities, workspaceId, resolve, work, docs } = await setup();
  const proposal = product.storeProposal({ workspaceId, title: "Read pricing", request: resolve("Read $work:pricing-proposal and $file:proposal.pdf").text,
    changes: [{ action: "install_skill", repo: "example/skills", directory: "review" }, { action: "create_goal", title: "Review pricing" }] });
  rmSync(join(docs, "nested", "proposal.pdf"));
  await expect(product.command({ action: "apply_proposal", proposalId: proposal.id })).rejects.toThrow();
  expect(capabilities.command).not.toHaveBeenCalled();
  writeFileSync(join(docs, "nested", "proposal.pdf"), "Restored");
  database.prepare("UPDATE work_items SET deleted_at = '2026-09-06' WHERE id = ?").run(work.id);
  await expect(product.command({ action: "apply_proposal", proposalId: proposal.id })).rejects.toThrow("unavailable");
  expect(capabilities.command).not.toHaveBeenCalled();
  expect(database.prepare("SELECT status FROM bees_proposals WHERE id = ?").get(proposal.id)).toEqual({ status: "pending" });
});
