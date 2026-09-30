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
  const { initializeProductDatabase, itemContext, resolveItemId } = await import("../dsh-runtime/plugin/lib/product-database.js");
  const { AgentRuntime } = await import("../dsh-runtime/plugin/lib/agent-runtime.js");
  const { assertPeersSettled } = await import("../dsh-runtime/plugin/lib/peer-collaboration.js");
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
  const goals = () => database.prepare("SELECT description, updated_at AS updatedAt FROM processes WHERE id = ?").get(processRow.id);
  const shipped = goals().description;
  const previousGoals = shipped.replace(
    "Do small tasks directly unless the request requires subagents. Delegate required subagent contributions regardless of task size.",
    "Do small tasks directly.");
  assert.notEqual(previousGoals, shipped);
  const previousTime = "2026-01-01T00:00:00.000Z";
  database.prepare("UPDATE processes SET description = ?, updated_at = ? WHERE id = ?").run(previousGoals, previousTime, processRow.id);
  database.exec("PRAGMA user_version = 34");
  initializeProductDatabase(database);
  assert.equal(goals().description, shipped, "upgrade the conflicting shipped default");
  assert(Date.parse(goals().updatedAt) > Date.parse(previousTime));
  const customized = previousGoals + "\nUse my custom workflow.";
  database.prepare("UPDATE processes SET description = ? WHERE id = ?").run(customized, processRow.id);
  database.exec("PRAGMA user_version = 34");
  initializeProductDatabase(database);
  assert.equal(goals().description, customized, "preserve the owner's process instructions");
  database.prepare("UPDATE processes SET description = ? WHERE id = ?").run(shipped, processRow.id);
  const stage = database.prepare("SELECT id FROM stages WHERE process_id = ? ORDER BY position LIMIT 1").get(processRow.id);
  const at = new Date().toISOString();
  database.prepare(`INSERT INTO work_items (id, process_id, stage_id, kind, title, description, runtime_phase, created_at, updated_at)
    VALUES ('item', ?, ?, 'goal', 'Draft posts', 'Draft from the supplied brief', 'running', ?, ?)`)
    .run(processRow.id, stage.id, at, at);
  assert.equal(resolveItemId(database, "item-retyped"), "item");
  assert.throws(() => resolveItemId(database, "missing"), /No work item starts/);
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

  const pending = runtime.pendingQuestion("run");
  // Continuing a live worker must not seed a second concurrent writer from its log.
  const messages = [];
  let disposed = 0;
  const activeHandle = { agent: { steer: (message) => messages.push(message) }, dispose: async () => { disposed++; } };
  const active = { handle: activeHandle, approvalAbort: new AbortController(), openTools: new Set(["pending-approval"]), lastEventAt: Date.now() };
  runtime.live.set("run", active);
  database.prepare("INSERT INTO dsh_deliveries (delivery_id, execution_id, submission_id, created_at) VALUES ('initial', 'run', 'initial-submission', ?)").run(at);
  const originalNewHandle = runtime.newHandle;
  runtime.newHandle = () => assert.fail("a live continuation created another worker");
  const continuation = { idempotencyKey: "followup", uid: "instance", body: "Continue from the verified file." };
  const receipt = await runtime.admit("bees-run", "run", continuation);
  assert.deepEqual({ ...await runtime.admit("bees-run", "run", continuation) }, receipt);
  assert.equal(messages.length, 1);
  assert.equal(runtime.live.get("run"), active);
  assert.equal(runtime.run("run").currentSessionId, "session");
  assert.equal(active.approvalAbort.signal.aborted, false);
  assert(active.openTools.has("pending-approval"));
  activeHandle.agent.steer = () => { throw new Error("Follow-up refused"); };
  await assert.rejects(runtime.admit("bees-run", "run", { ...continuation, idempotencyKey: "refused" }), /Follow-up refused/);
  assert(!database.prepare("SELECT 1 FROM dsh_deliveries WHERE delivery_id = 'refused'").get());
  await runtime.finish("run", "stale", "old-session", { dispose: async () => { disposed++; } }, { outcome: "failed" });
  assert.equal(runtime.live.get("run"), active);
  await runtime.finish("run", "initial-submission", "session", activeHandle, { outcome: "completed" });
  assert.deepEqual(database.prepare("SELECT outcome FROM dsh_deliveries WHERE execution_id = 'run'").all().map(({ outcome }) => outcome), ["completed", "completed"]);
  assert.equal(disposed, 2);
  assert(!runtime.live.has("run"));
  runtime.newHandle = originalNewHandle;
  runtime.setStatus("run", "running");

  // A restart re-presents the question and preserves the explicit stop decision.
  database.prepare("DELETE FROM dsh_audit_events WHERE event_type = 'dependency-stop-requested'").run();
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

  // A file written entirely by the parent is not evidence that five subagents ran.
  const claim = "The counter file has been successfully created and contains entries from all 5 subagents: 'first', 'second', 'third', 'fourth', and 'fifth'.";
  const worker = { workItemId: "item", stagePurpose: "worker" };
  const reviewer = { ...worker, stagePurpose: "reviewer" };
  assert.throws(() => assertPeersSettled(runtime, worker, claim), /0 recorded successful child executions.*bees_delegate_work/);
  assert.throws(() => assertPeersSettled(runtime, reviewer, claim), /0 recorded successful child executions.*Return revise/);
  assert.throws(() => assertPeersSettled(runtime, worker, "All subagents completed their tasks."), /0 recorded successful child executions/);
  assert.doesNotThrow(() => assertPeersSettled(runtime, worker, "Created the counter file myself. No subagents were launched."));

  // A delayed delegation audit must not make overlapping children appear sequential.
  const stamp = (offset) => new Date(Date.parse(at) + offset).toISOString();
  const addExecution = database.prepare(`INSERT INTO execution_links (execution_id, workspace_id, work_item_id,
    agent_name, current_session_id, instance_uid, run_directory, config_json, status, created_at, updated_at)
    VALUES (?, ?, ?, 'Peer', ?, 'instance', 'runs/check', '{}', 'completed', ?, ?)`);
  const addResult = database.prepare("INSERT INTO bees_stage_results VALUES (?, 'worker', 'candidate', 'Finished', ?)");
  for (let i = 0; i < 5; i++) {
    const id = `review-child-${i}`;
    database.prepare(`INSERT INTO work_items (id, process_id, stage_id, parent_id, title, runtime_phase, created_at, updated_at)
      VALUES (?, ?, ?, 'item', ?, 'completed', ?, ?)`)
      .run(id, processRow.id, stage.id, `Append ${i + 1}`, at, at);
    // A completed card without its actual execution/result cannot satisfy the count.
    assert.throws(() => assertPeersSettled(runtime, worker, claim), new RegExp(`${i} recorded successful child executions`));
    addExecution.run(id, processRow.workspaceId, id, id, stamp(i * 20), stamp(200 + i));
    addResult.run(id, stamp(200 + i));
  }
  assert.doesNotThrow(() => assertPeersSettled(runtime, worker, claim));
  assert.doesNotThrow(() => assertPeersSettled(runtime, reviewer, "All five parallel subagents completed their tasks."));
  assert.doesNotThrow(() => assertPeersSettled(runtime, { ...worker, workItemId: "review-child-0" }, claim));
  for (const column of ["archived_at", "deleted_at"]) {
    database.prepare(`UPDATE work_items SET ${column} = ? WHERE id = 'review-child-4'`).run(at);
    assert.throws(() => assertPeersSettled(runtime, worker, claim), /4 recorded successful child executions/);
    database.prepare(`UPDATE work_items SET ${column} = NULL WHERE id = 'review-child-4'`).run();
  }
  database.prepare("UPDATE work_items SET runtime_phase = 'cancelled' WHERE id = 'review-child-4'").run();
  assert.throws(() => assertPeersSettled(runtime, worker, claim), /4 recorded successful child executions/);
  database.prepare("UPDATE work_items SET runtime_phase = 'completed' WHERE id = 'review-child-4'").run();
  database.prepare("UPDATE bees_stage_results SET outcome = 'skipped' WHERE execution_id = 'review-child-4'").run();
  assert.throws(() => assertPeersSettled(runtime, worker, claim), /4 recorded successful child executions/);
  database.prepare("UPDATE bees_stage_results SET outcome = 'candidate' WHERE execution_id = 'review-child-4'").run();
  addResult.run("run", stamp(1000));
  // A completed stage's immutable result must not swallow a new conversation turn.
  const oldConfig = runtime.run("run").configJson;
  database.prepare("UPDATE execution_links SET config_json = ? WHERE execution_id = 'run'")
    .run(JSON.stringify({ ...JSON.parse(oldConfig), stagePurpose: "worker" }));
  runtime.setStatus("run", "completed");
  const oldHandle = runtime.newHandle, oldSettle = runtime.settle;
  let followupData, followupText;
  const followupHandle = { agent: { session: { seq: 0 },
    followup: (message) => { followupText = message.content[0].text; },
    steer: (message) => { followupText = message.content[0].text; } }, dispose: async () => {} };
  runtime.newHandle = async (_run, data) => { followupData = data; return { sessionId: "followup-session", handle: followupHandle }; };
  runtime.settle = async () => {};
  const followup = { uid: "instance", idempotencyKey: "completed-followup", body: "What did you finish?" };
  const accepted = await runtime.admit("bees-run", "run", followup);
  assert.equal(followupData.stagePurpose, undefined);
  assert.equal(followupText, followup.body);
  assert.equal(runtime.run("run").status, "running");
  assert.equal(runtime.stageResult("run").summary, "Finished");
  assert.deepEqual({ ...await runtime.admit("bees-run", "run", followup) }, accepted);
  runtime.newHandle = () => assert.fail("a second message replaced a live follow-up worker");
  await runtime.admit("bees-run", "run", { ...followup, idempotencyKey: "second-followup", body: "One more detail." });
  assert.equal(followupText, "One more detail.");
  assert.equal(runtime.live.get("run").handle, followupHandle);
  await runtime.finish("run", accepted.submissionId, "followup-session", followupHandle, { outcome: "completed" });
  runtime.newHandle = oldHandle; runtime.settle = oldSettle;
  database.prepare("UPDATE execution_links SET config_json = ? WHERE execution_id = 'run'").run(oldConfig);
  const recorded = (await runtime.workResult("item")).delegation;
  assert.equal(recorded.launched, 5);
  assert.equal(recorded.completed, 5);
  assert.equal(recorded.peers.length, 5);
  const groups = [[0, 1, 2, 3], [4]];
  for (const [i, group] of groups.entries()) database.prepare(`INSERT INTO dsh_audit_events
    VALUES (?, 'peer-work-delegated', 'run', 'session', ?, ?)`)
    .run(`delegation-${i}`, JSON.stringify({ ids: group.map((n) => `review-child-${n}`) }), stamp(500 + i));
  // A subsequent attempt on the same child is not part of this candidate's review.
  addExecution.run("later-child-attempt", processRow.workspaceId, "review-child-4", "later-session", stamp(2000), stamp(3000));
  assert.throws(() => assertPeersSettled(runtime, worker, claim), /4 recorded successful child executions/);
  const coordination = { type: "tool/call", seq: 1, time: Date.parse(stamp(60)),
    data: { name: "bees_delegate_work", callId: "fifth",
      arguments: JSON.stringify({ items_json: JSON.stringify([{ title: "Append fifth" }]) }) } };
  const events = runtime.sessionEvents;
  runtime.sessionEvents = async () => [coordination];
  const evidence = await runtime.reviewEvidence("run");
  runtime.sessionEvents = events;
  assert.equal(evidence.limits.peersPerDelegationCall, 8);
  const reviewed = evidence.executions.find(({ executionId }) => executionId === "run");
  assert.deepEqual(reviewed.delegatedWork.map(({ workItemId }) => workItemId),
    [0, 1, 2, 3, 4].map((n) => `review-child-${n}`));
  assert(reviewed.delegatedWork[4].createdAt < reviewed.delegatedWork[0].resultSubmittedAt);
  assert(reviewed.delegatedWork.every(({ outcome }) => outcome === "candidate"));
  assert.equal(reviewed.sessions[0].timeline.find(({ callId }) => callId === "fifth").time, coordination.time);

  // A message can return a delegation early; running children have not settled.
  runtime.workContext.pin("run", itemContext(database, "item"));
  const oldMemory = [{ text: "Previous run finished: outputs/counter-old.txt contains all five entries." }];
  database.prepare("UPDATE bees_run_resources SET memories_json = ? WHERE root_id = 'item'").run(JSON.stringify(oldMemory));
  assert(!runtime.workContext.prompt("run").includes("counter-old.txt"));
  assert.match(runtime.workContext.prompt("run"), /include_memories:true/);
  const currentContext = runtime.workContext.view("item", "run", 0, { includeMemories: false });
  assert.deepEqual(currentContext.context.memories, []);
  assert.equal(currentContext.context.availableMemories, 1);
  assert.equal(currentContext.context.content.goal.requirements, "Draft from the supplied brief");
  const pinnedInstructions = runtime.workContext.instructions("run");
  assert.match(pinnedInstructions, /Draft from the supplied brief/);
  assert(!runtime.workContext.prompt("run").includes("Draft from the supplied brief"), "live state must not replay the pinned assignment");
  assert(!pinnedInstructions.includes("counter-old.txt"));
  assert.deepEqual(runtime.workContext.view("item", "run").context.memories, oldMemory);
  runtime.workContext.recordOwner("run", "Save the draft as Markdown.");
  runtime.workContext.recordOwner("run", "Use plain text instead of Markdown.");
  const ownerPrompt = runtime.workContext.prompt("run");
  assert.match(ownerPrompt, /Where an answer differs from the pinned requirements the answer wins/);
  assert.match(ownerPrompt, /Save the draft as Markdown\.[\s\S]*Use plain text instead of Markdown\./);
  assert.equal(runtime.workContext.instructions("run"), pinnedInstructions, "owner updates stay live without replaying the pinned task");
  database.prepare("UPDATE work_items SET runtime_phase = 'running' WHERE id = 'review-child-4'").run();
  let wake;
  runtime.subscribe = (fn) => { wake = fn; return () => {}; };
  const controller = new AbortController();
  const waiting = runtime.waitForPeers(["review-child-4"], controller.signal, "item");
  runtime.workContext.post("item", { id: "progress", author: "User", kind: "note", content: "How is it going?" });
  wake({ workItemId: "review-child-4" });
  const [running] = await waiting;
  controller.abort();
  assert.equal(running.status, "running");
  assert.equal(running.settledAt, null);
  assert.equal(running.summary, undefined, "a running correction must not return the previous attempt's success claim");
  database.prepare("UPDATE work_items SET runtime_phase = 'completed' WHERE id = 'review-child-4'").run();
  const [finished] = await runtime.waitForPeers(["review-child-4"], undefined, "item");
  assert.equal(finished.settledAt, at);
  runtime.subscribe = null;

  // Delegated and skipped work can complete directly from Work; the board uses stage_id.
  const { ProcessRuntime } = await import("../dsh-runtime/plugin/lib/process-runtime.js");
  const processes = new ProcessRuntime(database);
  const terminal = processes.stages(processRow.id).find(({ driver }) => driver === "terminal");
  database.prepare(`INSERT INTO work_items (id, process_id, stage_id, parent_id, title, created_at, updated_at)
    VALUES ('child', ?, ?, 'item', 'Add first to counter', ?, ?)`)
    .run(processRow.id, stage.id, at, at);
  const projection = { workItemId: "child", processId: processRow.id, stageId: stage.id,
    attempt: 2, reviewCycle: 1, executionId: null, error: null };
  for (const phase of ["running", "waiting", "paused", "failed", "cancelled"]) {
    processes.project({ ...projection, phase });
    assert.equal(processes.item("child").stageId, stage.id);
    assert.equal(processes.item("child").runtimePhase, phase);
  }
  for (const workItemId of ["child", "item"]) {
    const completed = processes.project({ ...projection, workItemId, phase: "completed" });
    assert.equal(completed.stageId, terminal.id);
    assert.equal(processes.item(workItemId).stageId, terminal.id);
    assert.equal(processes.item(workItemId).runtimePhase, "completed");
    assert.equal(processes.item(workItemId).attempt, 2);
  }
  assert.throws(() => processes.project({ ...projection, stageId: "missing", phase: "completed" }),
    /stage does not belong/);

  // Restart the same card at its first stage, with fresh IDs and the old results preserved.
  const closed = [];
  processes.client = { workflow: { getHandle: (id) => ({ result: async () => { closed.push(id); } }) } };
  const restartInputs = [];
  processes.startItem = async (id) => {
    restartInputs.push(processes.input(id));
    database.prepare("UPDATE work_items SET runtime_phase = 'running' WHERE id = ?").run(id);
    return { automatic: true, claimed: true };
  };
  const restarted = await executeProductCommand.call({ database, processes }, "restart_item", {
    itemId: "item", text: "Start this same task again", requestId: "restart-check"
  });
  assert.equal(restarted.id, "item");
  assert.equal(processes.item("item").stageId, stage.id);
  assert.equal(processes.item("item").runtimePhase, "running");
  assert.equal(processes.item("item").attempt, 3);
  assert.equal(processes.input("item").restart.text, "Start this same task again");
  assert.equal(runtime.stageResult("run").summary, "Finished");
  await processes.restartItem("item", "Start this same task again", "restart-check");
  assert.equal(restartInputs.length, 1, "replayed requests must not restart twice");
  await assert.rejects(processes.restartItem("item", "Different request", "restart-check"), /another request/);
  await assert.rejects(processes.restartItem("item", "Again", "new-restart"), /Only finished/);
  database.prepare("UPDATE work_items SET archived_at = ? WHERE id = 'child'").run(at);
  await assert.rejects(processes.restartItem("child", "Again", "archived-restart"), /Only finished/);
  database.prepare("UPDATE work_items SET archived_at = NULL WHERE id = 'child'").run();

  const states = [], stageCalls = [];
  const workflowSource = readFileSync(new URL("../dsh-runtime/plugin/lib/process-workflow.js", import.meta.url), "utf8")
    .replace(/^import \{([\s\S]*?)\} from "@temporalio\/workflow";/, "const {$1} = temporal;")
    .replaceAll("export async function", "async function");
  const workflow = new Function("temporal", workflowSource + "\nreturn processWorkflow;")({
    defineSignal: (name) => name, setHandler() {},
    proxyActivities: () => ({ projectWorkItem: async (state) => states.push({ ...state }),
      runDshStage: async (call) => { stageCalls.push(call); return { outcome: call.purpose === "reviewer" ? "pass" : "candidate" }; } })
  });
  await workflow(restartInputs[0]);
  assert.equal(stageCalls[0].stageId, stage.id);
  assert.equal(stageCalls[0].executionId, "item-stage-0-work-3");
  assert.match(stageCalls[0].retryMessage, /Start this same task again/);
  assert.equal(states.at(-1).phase, "completed");
  assert.equal(states.at(-1).stageId, terminal.id);
  processes.project({ ...projection, workItemId: "item", phase: "completed" });

  const { conversationMessages } = await import("../dsh-runtime/plugin/client/conversation-model.js");
  const ownerUpdates = [1, 2].map((n) => ({ id: `owner-${n}`, author: "Owner", executionId: "run", content: "Again", createdAt: stamp(n) }));
  const transcript = { executionId: "run", messages: [{ id: "native", role: "user", parts: [{ text: "Again" }] }] };
  const visible = conversationMessages(transcript, [], [], [], ownerUpdates);
  assert.equal(visible.length, 2, "show unsurfaced owner messages without duplicating the native transcript");
  assert.equal(conversationMessages(null, [], [], [], ownerUpdates).length, 2, "keep messages visible after switching executions");

  // Upgrading repairs old completed cards, preserves unfinished work and is idempotent.
  database.prepare("UPDATE work_items SET stage_id = ?, updated_at = ? WHERE id = 'child'")
    .run(stage.id, at);
  processes.project({ ...projection, workItemId: "item", phase: "waiting" });
  database.exec("PRAGMA user_version = 33");
  initializeProductDatabase(database);
  assert.equal(processes.item("child").stageId, terminal.id);
  assert.equal(processes.item("child").runtimePhase, "completed");
  assert.equal(processes.item("child").attempt, 2);
  assert.equal(processes.item("item").stageId, stage.id);
  assert.equal(processes.item("item").runtimePhase, "waiting");
  const repaired = database.prepare("SELECT updated_at FROM work_items WHERE id = 'child'").get();
  assert(Date.parse(repaired.updated_at) > Date.parse(at));
  initializeProductDatabase(database);
  assert.deepEqual(database.prepare("SELECT updated_at FROM work_items WHERE id = 'child'").get(), repaired);

  // Personal work must start even when an unrelated cloud sync never responds.
  const { ConnectedAccount } = await import("../dsh-runtime/plugin/lib/connected-account.js");
  const { BeesProduct } = await import("../dsh-runtime/plugin/lib/product.js");
  const connected = new ConnectedAccount(database, {});
  const cloud = Promise.withResolvers();
  let fullSyncs = 0;
  connected.sync = () => { fullSyncs++; return cloud.promise; };
  connected.syncCoordination = () => assert.fail("Personal work does not need team synchronization");
  const started = [];
  const delegation = new BeesProduct(database, null, { claims: connected.executionClaims(), startItem: async (id) => {
    started.push(id);
    return { automatic: true, claimed: true };
  } }, root, { connected });
  const before = performance.now();
  const spawning = delegation.createSubitems({ parentId: "item", items: Array.from({ length: 5 }, (_, i) => ({
    title: `Immediate local child ${i + 1}`, description: `Append entry ${i + 1}`
  })) });
  try {
    await new Promise(setImmediate);
    assert.equal(fullSyncs, 0, "Local delegation must not wait for an unrelated cloud sync");
    assert.equal(started.length, 5, "All five children start while cloud sync is blocked");
    assert.equal((await spawning).length, 5);
    console.log(`Five local children admitted in ${Math.round(performance.now() - before)}ms while cloud sync is blocked`);
  } finally {
    cloud.resolve([]);
    await spawning;
  }

  // Shared work still publishes its own item before requesting an execution lease.
  const published = Promise.withResolvers();
  const publishedItems = [];
  delegation.processes.claims.publish = (id) => { publishedItems.push(id); return published.promise; };
  const shared = delegation.command({ action: "create_item", processId: processRow.id, title: "Shared work" });
  try {
    await new Promise(setImmediate);
    assert.equal(publishedItems.length, 1);
    assert.equal(itemContext(database, publishedItems[0]).title, "Shared work");
    assert.equal(started.length, 5, "Shared execution waits for publication");
  } finally { published.resolve([]); await shared; }
  assert.equal(started.length, 6);
  assert.equal(fullSyncs, 0, "Creating work does not refresh unrelated accounts");

  // Exercise the actual stage prompt and registered delegation tool, not just child creation.
  const dispatched = [];
  const launchProduct = new BeesProduct(database, runtime, { startItem: async (id) => { dispatched.push(id); return {}; } }, root);
  launchProduct.memory.recall = async () => [];
  ctx.agentPresets = { mount() {}, defaultId: "standard" };
  ctx.tools = { schemas: () => [] };
  runtime.executeStage = async (_id, request) => request;
  runtime.installPolicies = () => {}; // File/MCP policies are covered by their own checks.
  const lead = await launchProduct.command({ action: "create_item", processId: processRow.id,
    title: "Test five subagents", description: "Launch five parallel subagents; each appends its own number word to outputs/counter.txt." });
  const stageFor = (id) => ({ workItemId: id, executionId: `${id}-work`, stageId: stage.id, stageName: "Work", purpose: "worker" });
  const leadRequest = await launchProduct.runProcessStage(stageFor(lead.id));
  const restartRequest = await launchProduct.runProcessStage({ ...stageFor(lead.id), executionId: `${lead.id}-restart`, retryMessage: "Restart from stage one with the new instructions." });
  assert.match(restartRequest.body, /Restart from stage one with the new instructions/);
  assert.doesNotMatch(leadRequest.body, /otherwise do the work yourself|substantial independent work/);
  assert.match(leadRequest.body, /your next action is bees_delegate_work/);
  const mountedTools = async (request, id) => {
    const tools = new Map();
    await runtime.setup({ on() {}, tools: { register: (tool) => tools.set(tool.name, tool), guard() {}, restrict() {} },
      systemPrompt: { variable() {}, section() {}, context() {} } }, request.initialData, `${id}-work`, request.workspace);
    return tools;
  };
  const leadTools = await mountedTools(leadRequest, lead.id);
  const delegateTool = leadTools.get("bees_delegate_work");
  const assignments = ["first", "second", "third", "fourth", "fifth"].map((word) => ({
    title: `Append ${word}`, description: `Append '${word}\\n' to outputs/counter.txt with bees_append_file.`,
    agentAssignmentId: "" // Local models leave optional IDs empty to inherit the parent.
  }));
  const delegated = await delegateTool.execute({ items: assignments, background: true }, exec);
  const childIds = delegated.ids.split(",");
  assert.equal(delegated.count, 5);
  assert.equal(new Set(childIds).size, 5);
  assert.deepEqual(dispatched.slice(1).sort(), [...childIds].sort());
  assert.equal(database.prepare("SELECT count(*) AS n FROM work_items WHERE parent_id = ?").get(lead.id).n, 5);
  const legacy = await delegateTool.execute({ items_json: JSON.stringify(assignments.map(({ agentAssignmentId, ...item }) => item)), background: true }, exec);
  assert.deepEqual(legacy.ids.split(",").sort(), [...childIds].sort(), "old calls reuse the same tracked children");
  await assert.rejects(delegateTool.execute({ items: assignments, items_json: "[]" }, exec), /only items or items_json/);
  await assert.rejects(delegateTool.execute({ items: [] }, exec), /at least one/);
  await assert.rejects(delegateTool.execute({ items: Array.from({ length: 9 }, () => assignments[0]) }, exec), /at most 8/);
  await assert.rejects(delegateTool.execute({ items_json: "[null]" }, exec), /nonempty title/);
  const childRequest = await launchProduct.runProcessStage(stageFor(childIds[0]));
  assert.match(childRequest.body, /You are a delegated worker; do not launch other agents/);
  assert.doesNotMatch(childRequest.body, /your next action is bees_delegate_work/);
  assert(!(await mountedTools(childRequest, childIds[0])).has("bees_delegate_work"), "children cannot launch grandchildren");

  // Process memory uses the real journal, command permissions and pinned run context.
  const memoryInput = { processId: processRow.id };
  const memories = () => launchProduct.command({ action: "read_process_memory", ...memoryInput });
  const notes = runtime.workContext.processMemory;
  runtime.workContext.recordHumanReview("run", "memory-feedback", false, "", "Always include the launch date.");
  await leadTools.get("bees_share_update").execute({ kind: "lesson", content: "Use the brand’s plain language.", evidence: "Owner’s brand brief, page 2" }, { ...exec, callId: "memory-lesson" });
  runtime.workContext.post("item", { id: "result:memory-result", executionId: "run", kind: "finding", author: "Reviewer", content: "Date verified.", evidence: "Brief" });
  let memoryView = await memories();
  assert(memoryView.canManage);
  assert(memoryView.entries.some((entry) => entry.kind === "response" && entry.content === "Use plain text instead of Markdown."));
  assert(memoryView.entries.some((entry) => entry.kind === "feedback" && entry.content.includes("Always include the launch date.")));
  assert(memoryView.entries.some((entry) => entry.kind === "result" && entry.content === "Date verified."));
  assert(memoryView.entries.every((entry) => !entry.active), "Captured entries require owner selection before reuse");
  const lesson = memoryView.entries.find((entry) => entry.kind === "information" && entry.sourceId?.endsWith("memory-lesson"));
  assert.equal(lesson.evidence, "Owner’s brand brief, page 2");
  await assert.rejects(launchProduct.command({ action: "edit_process_memory", ...memoryInput, id: lesson.id, expectedRevision: lesson.revision, active: true, viaAgent: true }), /Only the process owner/);
  await launchProduct.command({ action: "edit_process_memory", ...memoryInput, id: lesson.id, expectedRevision: lesson.revision, content: "Use plain language and short sentences.", active: true });
  await assert.rejects(launchProduct.command({ action: "edit_process_memory", ...memoryInput, id: lesson.id, expectedRevision: lesson.revision, content: "Stale overwrite" }), /changed/);
  assert.equal((await memories()).entries.find((entry) => entry.id === lesson.id).sourceContent, lesson.content, "Editing preserves the original source");
  assert.deepEqual(runtime.workContext.run(`${lead.id}-work`).content.processMemory, [], "Existing runs remain frozen");
  const future = await product.execute("create_item", { processId: processRow.id, title: "Next process run", idempotencyKey: "proposal:memory-check" });
  runtime.workContext.pin("memory-next", itemContext(database, future.id));
  assert.match(runtime.workContext.instructions("memory-next"), /Use plain language and short sentences/);
  const snapshot = runtime.workContext.run("memory-next").content.processMemory;
  await launchProduct.command({ action: "forget_process_memory", ...memoryInput, id: lesson.id, expectedRevision: 1 });
  assert.deepEqual(runtime.workContext.pin("memory-next-stage", itemContext(database, future.id)).content.processMemory, snapshot);
  assert.deepEqual(runtime.workContext.pin("memory-review", itemContext(database, future.id), { reviewer: true, candidateExecutionId: "memory-next" }).content.processMemory, snapshot);
  const { WorkContext } = await import("../dsh-runtime/plugin/lib/work-context.js");
  new WorkContext(database);
  assert(!(await memories()).entries.some((entry) => entry.id === lesson.id), "Backfill must not restore forgotten sources");
  const otherProcess = await product.execute("create_process", { workspaceId: processRow.workspaceId, name: "Another process", stages: [{ name: "Work", driver: "agent" }, { name: "Done", driver: "terminal" }] });
  assert.deepEqual(notes.view({ processId: otherProcess.id }).entries, [], "Memory is isolated by process");
  await assert.rejects(launchProduct.command({ action: "edit_process_memory", processId: otherProcess.id, id: lesson.id, expectedRevision: 2 }), /not found in this process/);
  await assert.rejects(launchProduct.command({ action: "add_process_memory", ...memoryInput, content: " " }), /1 to 12000/);
  await assert.rejects(launchProduct.command({ action: "add_process_memory", ...memoryInput, content: "x".repeat(12001) }), /1 to 12000/);
  await assert.rejects(memories().then(() => notes.view({ ...memoryInput, before: -1 })), /cursor/);
  for (let i = 0; i < 43; i++) notes.command("add_process_memory", { ...memoryInput, content: `Saved note ${i}`, active: false });
  const page = notes.view({ ...memoryInput, query: "Saved note" });
  assert.equal(page.entries.length, 40); assert(page.hasMore);
  const older = notes.view({ ...memoryInput, query: "Saved note", before: page.before });
  assert.equal(older.entries.length, 3); assert(!older.hasMore);
  assert(!older.entries.some((entry) => page.entries.some((newer) => entry.id === newer.id)));
  notes.command("add_process_memory", { ...memoryInput, content: "x".repeat(12000), active: true });
  notes.command("add_process_memory", { ...memoryInput, content: "y".repeat(12000), active: true });
  assert.throws(() => notes.command("add_process_memory", { ...memoryInput, content: "Overflow", active: true }), /Active memory is full/);
  runtime.workContext.post(future.id, { id: "source-survives", author: "User", content: "Keep this response after task deletion." });
  database.prepare("DELETE FROM work_items WHERE id = ?").run(future.id);
  const retained = notes.view({ ...memoryInput, query: "after task deletion" }).entries[0];
  assert.equal(retained.workItemId, null); assert.equal(retained.sourceContent, retained.content);

  const localUser = database.prepare("SELECT id FROM users ORDER BY created_at LIMIT 1").get().id;
  database.prepare("UPDATE team_memberships SET role = 'viewer' WHERE team_id = ? AND user_id = ?").run(teamId, localUser);
  assert(!notes.view(memoryInput).canManage);
  assert.throws(() => notes.command("add_process_memory", { ...memoryInput, content: "Viewer write" }), /Only the process owner/);
  database.prepare("UPDATE team_memberships SET role = 'admin' WHERE team_id = ? AND user_id = ?").run(teamId, localUser);
  const orgId = database.prepare("SELECT organization_id AS id FROM teams WHERE id = ?").get(teamId).id;
  database.prepare("UPDATE workspaces SET authority = 'connected' WHERE id = ?").run(processRow.workspaceId);
  for (const [account, role] of [["owner-account", "member"], ["other-account", "admin"]]) {
    database.prepare("INSERT INTO bees_accounts (user_id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(account, `${account}@example.test`, account, at, at);
    database.prepare("INSERT INTO bees_connections VALUES (?, ?, ?, ?, ?, ?)").run(account, orgId, account, role, at, at);
    database.prepare("INSERT INTO bees_connection_teams VALUES (?, ?, ?, ?, ?)").run(account, teamId, role, at, at);
  }
  database.prepare("UPDATE processes SET account_user_id = 'owner-account' WHERE id = ?").run(processRow.id);
  assert(notes.view({ ...memoryInput, connectionId: "owner-account" }).canManage);
  assert(!notes.view({ ...memoryInput, connectionId: "other-account", accountUserId: "owner-account" }).canManage);
  assert.throws(() => notes.command("add_process_memory", { ...memoryInput, connectionId: "other-account", accountUserId: "owner-account", content: "Spoofed owner" }), /Only the process owner/);
  assert.throws(() => notes.command("add_process_memory", { ...memoryInput, content: "Missing connection" }), /Only the process owner/);
  database.prepare("UPDATE bees_accounts SET enabled = 0 WHERE user_id = 'owner-account'").run();
  assert(!notes.view({ ...memoryInput, connectionId: "owner-account" }).canManage);
  database.prepare("UPDATE bees_accounts SET enabled = 1 WHERE user_id = 'owner-account'").run();
  const { teamRecords, applyTeamRecords } = await import("../dsh-runtime/plugin/lib/team-sync.js");
  const exported = teamRecords(database, orgId).find((entry) => entry.recordType === "team_process" && entry.recordId === processRow.id);
  assert.equal(exported.payload.accountUserId, "owner-account");
  database.prepare("UPDATE processes SET account_user_id = NULL WHERE id = ?").run(processRow.id);
  const syncedTime = new Date(Date.now() + 10000).toISOString();
  applyTeamRecords(database, orgId, [{ ...exported, version: Date.parse(syncedTime), payload: { ...exported.payload, updatedAt: syncedTime } }]);
  assert.equal(database.prepare("SELECT account_user_id AS owner FROM processes WHERE id = ?").get(processRow.id).owner, "owner-account");
  const { accountUserId: omitted, ...legacyPayload } = exported.payload;
  applyTeamRecords(database, orgId, [{ ...exported, version: Date.parse(syncedTime) + 1, payload: { ...legacyPayload, updatedAt: new Date(Date.parse(syncedTime) + 1).toISOString() } }]);
  assert.equal(database.prepare("SELECT account_user_id AS owner FROM processes WHERE id = ?").get(processRow.id).owner, "owner-account", "Older clients preserve process ownership");
  database.close();
  console.log("Process interaction checks passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
