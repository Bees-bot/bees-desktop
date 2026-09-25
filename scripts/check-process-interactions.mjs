import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = mkdtempSync(join(tmpdir(), "bees-interaction-check-"));
for (const name of ["BEES_APP_DATA", "BEES_DATA_DIR", "BEES_STATE_DIR"]) process.env[name] = root;
process.env.BEES_DEFAULT_WORKSPACE = root;
writeFileSync(join(root, "device-id"), "interaction-check-device");
try {
  const { initializeProductDatabase } = await import("../dsh-runtime/plugin/lib/product-database.js");
  const { AgentRuntime } = await import("../dsh-runtime/plugin/lib/agent-runtime.js");
  const { executeProductCommand } = await import("../dsh-runtime/plugin/lib/product-commands.js");
  const database = new DatabaseSync(":memory:");
  initializeProductDatabase(database);
  let answer;
  const ctx = { on() {}, logger: { warn() {} }, userQuestions: { ask: ({ questions }) => {
    assert.equal(questions.length, 1);
    return new Promise((resolve) => { answer = (selected = [], custom = "") => resolve({ answers: [{ id: "dependency", selected, custom }] }); });
  } } };
  const runtime = new AgentRuntime(ctx, database);
  const processRow = database.prepare("SELECT id, workspace_id AS workspaceId FROM processes WHERE kind = 'goals'").get();
  const stage = database.prepare("SELECT id FROM stages WHERE process_id = ? ORDER BY position LIMIT 1").get(processRow.id);
  const at = new Date().toISOString();
  database.prepare(`INSERT INTO work_items (id, process_id, stage_id, kind, title, description, runtime_phase, created_at, updated_at)
    VALUES ('item', ?, ?, 'goal', 'Draft posts', 'Draft from the supplied brief', 'running', ?, ?)`)
    .run(processRow.id, stage.id, at, at);
  database.prepare(`INSERT INTO execution_links (execution_id, workspace_id, work_item_id, agent_name, current_session_id,
    instance_uid, run_directory, config_json, status, created_at, updated_at) VALUES ('run', ?, 'item', 'Writer', 'session', 'instance', ?, ?, 'running', ?, ?)`)
    .run(processRow.workspaceId, "runs/check", JSON.stringify({ workspaceId: processRow.workspaceId }), at, at);
  const exec = { callId: "submit-1", agent: { session: { id: "session" } }, signal: new AbortController().signal };
  const args = { next_step: "Connect your publishing account under MCPs, then tell me when it is ready." };
  const phase = () => database.prepare("SELECT runtime_phase AS phase FROM work_items WHERE id = 'item'").get().phase;
  const finishTool = (callId, seq) => runtime.onSessionEvent(exec.agent.session, { type: "tool/result", seq,
    data: { message: { source: { callId }, content: [], isError: false } } });
  await assert.rejects(runtime.resolveDependency("run", {}, exec), /one concrete question/);
  const resolving = runtime.resolveDependency("run", args, exec);
  assert.equal(runtime.run("run").status, "waiting_for_input");
  assert.equal(runtime.pendingQuestion("run").kind, "dependency");
  assert.equal(phase(), "waiting");
  answer(["I've made the change"]);
  const result = await resolving;
  assert.equal(result.outcome, "continue");
  assert.match(result.summary, /Verify the supplied change/);
  assert.equal(runtime.stageResult("run"), undefined);
  finishTool(exec.callId, 1);
  assert.equal(runtime.pendingInteraction("run"), null);
  assert.equal(runtime.run("run").status, "running");
  assert.equal(phase(), "running");

  // Any previous answer is insufficient to terminate the next dependency.
  const second = runtime.resolveDependency("run", { next_step: "Provide the product brief using Provide a file." }, { ...exec, callId: "submit-2" });
  answer([], "Skipped.");
  assert.equal((await second).outcome, "continue");
  finishTool("submit-2", 2);
  const stopping = runtime.resolveDependency("run", args, { ...exec, callId: "submit-3" });
  answer(["Stop here"]);
  assert.equal(await stopping, true);
  assert.equal(await runtime.resolveDependency("run", {}, exec), true);

  // A restart re-presents the question and preserves the explicit stop decision.
  database.prepare("DELETE FROM dsh_audit_events WHERE event_type = 'dependency-stop-requested'").run();
  const pending = runtime.pendingQuestion("run");
  let resumed = false;
  runtime.settle = async () => { resumed = true; };
  const recovered = runtime.recoverQuestion("run", "delivery", "session", {
    agent: { session: { id: "session", seq: 0 }, followup() {} }
  }, new AbortController(), pending, "Continue this stage.");
  answer(["Stop here"]);
  await recovered;
  assert(resumed);
  assert.equal(runtime.run("run").status, "running");
  assert.equal(phase(), "running");
  assert.equal(runtime.pendingInteraction("run"), null);
  assert.equal(await runtime.resolveDependency("run", {}, exec), true);

  // File delivery is scoped to the run's team, staged immediately and attached for later stages.
  const product = { database, agents: runtime, execute(action, input) { return executeProductCommand.call(this, action, input); } };
  const { team_id: teamId } = database.prepare("SELECT team_id FROM workspaces WHERE id = ?").get(processRow.workspaceId);
  const source = join(root, "brief.txt");
  writeFileSync(source, "Product brief");
  const location = await product.execute("add_location", { teamId, name: "Brief", kind: "file", path: source });
  runtime.setStatus("run", "waiting_for_input");
  const provided = await product.execute("provide_run_input", { executionId: "run", locationId: location.id });
  assert.match(provided.manifest, /inputs\//);
  const stagedPath = provided.manifest.split(": ").at(-1);
  assert.equal(readFileSync(join(runtime.run("run").runDirectory, stagedPath, "brief.txt"), "utf8"), "Product brief");
  assert(database.prepare("SELECT 1 FROM work_item_locations WHERE work_item_id = 'item' AND location_id = ?").get(location.id));
  await assert.rejects(product.execute("provide_run_input", { executionId: "run", locationId: "missing" }), /unavailable/);
  runtime.setStatus("run", "completed");
  await assert.rejects(product.execute("provide_run_input", { executionId: "run", locationId: location.id }), /no longer waiting/);

  // Unavailable approvals are not denials, but an explicit denial is respected.
  database.prepare("DELETE FROM dsh_audit_events WHERE event_type = 'dependency-stop-requested'").run();
  runtime.audit("approval-rejected", "run", "session", { outcome: "unavailable" });
  await assert.rejects(runtime.resolveDependency("run", {}, exec), /one concrete question/);
  runtime.audit("approval-rejected", "run", "session", { outcome: "rejected" });
  assert.equal(await runtime.resolveDependency("run", {}, exec), true);
  database.close();
  console.log("Process interaction checks passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
