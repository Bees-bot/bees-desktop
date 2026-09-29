import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const { apply: spillPolicy } = await import(require.resolve("@deepseek-ai/dsh-spill-policy"));
const { estimateContent } = await import(require.resolve("@deepseek-ai/dsh-token-meter/estimate"));
const { truncateWithoutSplittingSurrogatePair } = await import(require.resolve("@deepseek-ai/dsh-output-retention"));
const root = mkdtempSync(join(tmpdir(), "bees-rc2-check-"));
for (const key of ["BEES_APP_DATA", "BEES_DATA_DIR", "BEES_STATE_DIR", "BEES_DEFAULT_WORKSPACE"]) process.env[key] = root;
writeFileSync(join(root, "device-id"), "rc2-check-device");
try {
  const { AgentRuntime, resolveRunModel } = await import("../dsh-runtime/plugin/lib/agent-runtime.js");
  const { modelLabel } = await import("../dsh-runtime/plugin/lib/model-label.js");
  // Human-readable labels must never replace the route used to run a model.
  let localName = "Qwen3 4B";
  const modelContext = {
    agentDefaultModel: { currentSelection: () => ({ provider: "local-openai", model: "active" }) },
    llm: {
      listProviders: () => [{ id: "local-openai", name: "Bees AI" }, { id: "openai", name: "OpenAI" }],
      resolveModelInfo: async () => ({ name: localName })
    }
  };
  const firstModel = await resolveRunModel(modelContext, {});
  assert.equal(firstModel.resolvedModel, "local-openai/active");
  assert.equal(firstModel.resolvedModelLabel, "Local · Qwen3 4B");
  localName = "Gemma 4B";
  assert.equal((await resolveRunModel(modelContext, {})).resolvedModelLabel, "Local · Gemma 4B");
  assert.equal(firstModel.resolvedModelLabel, "Local · Qwen3 4B");
  modelContext.llm.resolveModelInfo = async () => { throw new Error("Catalog unavailable"); };
  assert.equal((await resolveRunModel(modelContext, {})).resolvedModelLabel, "Local · active model (name unavailable)");
  assert.equal(modelLabel("local-openai-qwen3/active", "Qwen3 4B"), "Local · Qwen3 4B");
  assert.equal(modelLabel("local-openai/active", "Bees AI model"), "Local · active model (name unavailable)");
  const cloudModel = await resolveRunModel(modelContext, { model: "openai/gpt-example" });
  assert.equal(cloudModel.resolvedModel, "openai/gpt-example");
  assert.equal(cloudModel.resolvedModelLabel, "OpenAI · gpt-example");
  const { initializeProductDatabase } = await import("../dsh-runtime/plugin/lib/product-database.js");
  const { readToolResult, installContextPolicy } = await import("../dsh-runtime/plugin/lib/context-policy.js");
  const { Session } = await import(require.resolve("@deepseek-ai/dsh-session"));
  const { createUserMessage, createToolResultMessage } = await import(require.resolve("@deepseek-ai/dsh-llm"));
  // RC2 appends changed runtime snapshots. Keep one on the request surface without
  // losing user corrections, tool evidence, or the original append-only history.
  const session = Session.create("context-retention");
  const user = (text, source = { kind: "user" }) => createUserMessage({
    content: [{ type: "text", text }], source
  });
  const snapshot = (text) => user(text, { kind: "runtime-context", form: "snapshot", sections: [] });
  const append = (message) => session.append("user/message", message, { surfaceOp: "append" });
  const initial = append(user("Create five contributions, preserving every entry."));
  append(snapshot("old state ".repeat(3000)));
  const correction = append(user("Use the current run filename."));
  append(snapshot("newer state ".repeat(3000)));
  const originalEvents = session.snapshotEvents();
  let preStep;
  installContextPolicy({ on: (name, hook) => { if (name === "agent/pre-step") preStep = hook; }, tools: { register() {} } });
  const retainedContexts = () => session.deriveMessages().filter(({ source }) => source.kind === "runtime-context");
  const enter = async (messages) => preStep({ agent: { session }, signal: new AbortController().signal },
    async () => ({ kind: "enter", messages }));
  await enter([]); // A restored session may have multiple snapshots but no new one.
  assert.equal(retainedContexts().length, 1);
  assert.match(retainedContexts()[0].content[0].text, /^newer state/);
  const current = snapshot("Current requirements, human corrections, roster and file evidence.");
  await enter([current]);
  append(current);
  assert.deepEqual(retainedContexts(), [current]);
  assert(session.surface.nodes.includes(initial.seq));
  assert(session.surface.nodes.includes(correction.seq));
  assert.deepEqual(session.snapshotEvents().slice(0, originalEvents.length), originalEvents);
  assert.deepEqual(Session.create(session.id, session.snapshotEvents()).deriveMessages(), session.deriveMessages());
  const stableSeq = session.seq;
  await enter([]);
  assert.equal(session.seq, stableSeq, "unchanged context must not create more replacements");
  const abort = new AbortController(); abort.abort();
  await assert.rejects(preStep({ agent: { session }, signal: abort.signal }, async () => ({ kind: "enter", messages: [snapshot("cancelled")] })), { name: "AbortError" });
  assert.deepEqual(retainedContexts(), [current]);
  const contextRead = (id, args, text, name = "bees_read_context") => {
    session.append("tool/call", { callId: id, name, arguments: JSON.stringify(args) });
    return session.append("tool/result", { message: createToolResultMessage({ callId: id,
      content: [{ type: "text", text }], isError: false }) }, { surfaceOp: "append" });
  };
  contextRead("old-context", {}, "Old complete context with historical filename.");
  const page = contextRead("discussion-page", { after: 12 }, "Earlier discussion page requested explicitly.");
  const recalled = contextRead("memory-read", { include_memories: true }, "Explicitly requested historical memory.");
  const newest = contextRead("current-context", {}, "Current file and participant evidence.");
  contextRead("old-wait", { after: 0 }, "Earlier peer statuses and messages.", "bees_wait_for_peers");
  const latestWait = contextRead("new-wait", { after: 0 }, "Current peer statuses and messages.", "bees_wait_for_peers");
  await enter([]);
  assert(session.surface.nodes.includes(page.seq));
  assert(session.surface.nodes.includes(recalled.seq));
  assert(session.surface.nodes.includes(newest.seq));
  assert(session.surface.nodes.includes(latestWait.seq));
  assert(!session.deriveMessages().some((message) => message.content[0]?.text === "Old complete context with historical filename."));
  assert.equal(readToolResult(session, { call_id: "old-context" }).text, "Old complete context with historical filename.");
  assert(!session.deriveMessages().some((message) => message.content[0]?.text === "Earlier peer statuses and messages."));
  assert.equal(readToolResult(session, { call_id: "old-wait" }).text, "Earlier peer statuses and messages.");
  assert.deepEqual(Session.create(session.id, session.snapshotEvents()).deriveMessages(), session.deriveMessages());
  const database = new DatabaseSync(":memory:");
  initializeProductDatabase(database);
  const schemas = [];
  const ctx = { on() {}, tools: { schemas: () => schemas }, logger: { warn() {} } };
  const runtime = new AgentRuntime(ctx, database);
  // Retention markers are runtime context, while the original human messages stay visible.
  const typedMarker = "[Earlier runtime context superseded by the latest snapshot.]";
  append(user(typedMarker));
  const history = await runtime.history.call({ database,
    run: () => ({ status: "running" }),
    live: new Map([[session.id, { handle: { agent: { session } } }]])
  }, session.id);
  const { conversationMessages } = await import("../dsh-runtime/plugin/client/conversation-model.js");
  assert.deepEqual(conversationMessages({ ...history, executionId: session.id }, [], [])
    .filter(({ role }) => role === "user").map(({ text }) => text),
    ["Create five contributions, preserving every entry.", "Use the current run filename.", typedMarker]);
  // A review, including a recovery seed with workspace-write, cannot mutate its
  // candidate. Worker sessions keep their existing file policy.
  for (const mode of ["review", "work"]) {
    const policySession = Session.create(`policy-${mode}`);
    policySession.append("sandbox/mode", { mode: "workspace-write" });
    const handle = { agent: { session: policySession }, dispose: async () => {} };
    await runtime.newHandle.call({ ctx: { ...modelContext,
      agents: { create: async () => handle }, approval: { setPolicy() {} }
    } }, { executionId: `policy-${mode}`, currentSessionId: `policy-${mode}` },
    { mode, model: "local-openai/active" }, root, "create");
    assert.equal(policySession.snapshotEvents().filter(({ type }) => type === "sandbox/mode").at(-1).data.mode,
      mode === "review" ? "read-only" : "workspace-write");
  }
  // A successful terminal tool must finish even if steering/another turn was
  // queued while it ran. Exercise the actual RC2 driver, not a fake idle state.
  const { Context } = await import(require.resolve("@deepseek-ai/cordis"));
  const { LlmAdapter } = await import(require.resolve("@deepseek-ai/dsh-llm"));
  const { defineTool } = await import(require.resolve("@deepseek-ai/dsh-tools"));
  const { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } = await import(require.resolve("@deepseek-ai/dsh-agent-loop-testkit"));
  const loopContext = new Context();
  await mountAgentLoopTestDependencies(loopContext);
  await loopContext.plugin(await import(require.resolve("@deepseek-ai/dsh-time-context")), { refreshIntervalMs: 0 });
  let calls = 0, submitted = false;
  loopContext.llm.registerAdapter(["stage-test"], new class extends LlmAdapter {
    async *stream() {
      calls++;
      assert.equal(calls, 1, "accepted stage generated another model request");
      yield { type: "block-start", index: 0, blockType: "tool-call" };
      yield { type: "block-end", index: 0, block: { type: "tool-call", id: "submit", name: "submit", arguments: "{}" } };
      yield { type: "finish", reason: { kind: "tool-calls" } };
    }
  });
  const harness = await mountAgentLoopTestHarness(loopContext);
  const loopAgent = await harness.create("stage-completion", { provider: "stage-test", model: "test" });
  runtime.guardStageCompletion.call({ stageResult: () => submitted ? { outcome: "candidate" } : null }, loopAgent.ctx, "stage-test");
  loopAgent.ctx.tools.register(defineTool({ name: "submit", description: "Finish this test stage", parameters: {},
    output: { schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean", required: true } } }, render: () => [{ type: "text", text: "Accepted" }] },
    execute: (_args, exec) => {
      submitted = true;
      loopAgent.steer(user("The write succeeded; submit once."));
      loopAgent.followup(user("Late duplicate continuation."));
      exec.concludeTurn();
      return { ok: true };
    }
  }));
  loopAgent.followup(user("Submit the finished contribution."));
  await loopAgent.whenIdle();
  assert(submitted);
  assert.equal(calls, 1);
  assert(loopAgent.session.snapshotEvents().filter((event) => event.type === "turn/end").every((event) => event.data.reason.kind === "completed"));

  // Exercise a real follow-up turn with an old completed result, through setup's guard selection.
  const followupProcess = database.prepare("SELECT id, workspace_id AS workspaceId FROM processes WHERE kind = 'goals'").get();
  const firstStage = database.prepare("SELECT id FROM stages WHERE process_id = ? ORDER BY position LIMIT 1").get(followupProcess.id);
  database.prepare(`INSERT INTO work_items (id, process_id, stage_id, title, runtime_phase, created_at, updated_at)
    VALUES ('followup-item', ?, ?, 'Finished task', 'completed', 'now', 'now')`).run(followupProcess.id, firstStage.id);
  let followupCalls = 0;
  loopContext.llm.registerAdapter(["followup-test"], new class extends LlmAdapter {
    async *stream() {
      followupCalls++;
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "block-end", index: 0, block: { type: "text", text: "Here is the answer about your finished task." } };
      yield { type: "finish", reason: { kind: "stop" } };
    }
  });
  const followupAgent = await harness.create("finished-followup", { provider: "followup-test", model: "test" });
  const originalResult = runtime.stageResult, originalPolicies = runtime.installPolicies;
  runtime.stageResult = () => ({ outcome: "candidate", summary: "Earlier completed result" });
  runtime.installPolicies = () => {};
  ctx.agentPresets = { mount() {} };
  await runtime.setup(followupAgent.ctx, { mode: "work", workItemId: "followup-item", workspaceId: followupProcess.workspaceId,
    agentPresetId: "standard", mcpAccess: "none", mcpServers: [], instructions: "" }, "finished-followup", root);
  followupAgent.followup(user("What did you finish?"));
  await followupAgent.whenIdle();
  assert.equal(followupCalls, 1, "completed work must accept a new model request");
  assert(followupAgent.session.snapshotEvents().some((event) => event.type === "user/message" && event.data.content[0]?.text === "What did you finish?"));
  assert(followupAgent.session.snapshotEvents().some((event) => event.type === "assistant/message"));
  runtime.stageResult = originalResult; runtime.installPolicies = originalPolicies;
  await loopContext.fiber.dispose();
  const grant = { mcpAccess: "listed", mcpServers: ["sales"] };
  const servers = database.prepare("INSERT INTO mcp_servers (id, server_name, label, transport, created_at) VALUES (?, ?, ?, 'stdio', 'now')");
  servers.run("sales", "sales", "Sales");
  let guard, assemble;
  const agentCtx = { tools: { guard: (fn) => { guard = fn; return () => {}; }, restrict: () => () => {} },
    on: (_name, fn) => { assemble = fn; return () => {}; } };
  const dispose = runtime.restrictMcp(agentCtx, grant);
  assert.equal(guard({ name: "mcp__sales__list" }), undefined);
  // Add a new server and tool after setup: the old snapshot restriction missed these.
  servers.run("private", "sales__private", "Private");
  schemas.push({ name: "mcp__sales__private__delete" }, { name: "mcp__sales__new_tool" });
  assert.match(guard({ name: schemas[0].name }), /not granted/);
  assert.equal(guard({ name: schemas[1].name }), undefined);
  const assembly = await assemble({}, {}, async () => ({ tools: schemas, sections: schemas.map(({ name }) => ({ name: `tool:${name}` })) }));
  assert.deepEqual(assembly.tools, [schemas[1]]);
  assert.equal(assembly.sections.length, 1);
  grant.mcpServers = [];
  assert.match(guard({ name: schemas[1].name }), /not granted/);
  grant.mcpAccess = "none";
  assert.match(guard({ name: "mcp__unknown__call" }), /not granted/);
  assert.equal(guard({ name: "read" }), undefined);
  dispose();

  // Completion notices must remain unconsumed, and a wakeup's next turn must settle too.
  const listeners = new Set();
  let jobs = [{ id: "bash-1", owner: "owner", status: "running" }, { id: "bash-2", owner: "someone-else", status: "running" }];
  ctx.jobs = { list: () => jobs,
    wait() { throw new Error("Bees must not consume a completion notice"); },
    events: { subscribe: (_filter, fn) => { listeners.add(fn); return () => listeners.delete(fn); } } };
  let finishTurn;
  const agent = { session: { id: "owner" }, status: "idle",
    whenIdle: () => agent.status === "idle" ? Promise.resolve() : new Promise((resolve) => { finishTurn = resolve; }) };
  let settled = false;
  const settling = runtime.untilIdle("run", { agent }).then(() => { settled = true; });
  await delay(20);
  assert.equal(settled, false);
  assert.equal(runtime.pendingJobs(agent).length, 1);
  jobs[0].status = "completed";
  agent.status = "running";
  for (const listener of listeners) listener({ type: "settled", job: jobs[0], awaited: false });
  await delay(20);
  assert.equal(settled, false);
  jobs.push({ id: "bash-3", owner: "owner", status: "running" });
  agent.status = "idle"; finishTurn();
  await delay(20);
  assert.equal(settled, false); // A second background completion must not be lost.
  jobs[2].status = "completed";
  agent.status = "running";
  for (const listener of listeners) listener({ type: "settled", job: jobs[2], awaited: false });
  await delay(20);
  assert.equal(settled, false);
  agent.status = "idle"; finishTurn();
  await settling;
  assert.equal(listeners.size, 0);
  let outcome;
  runtime.finish = async (_execution, _submission, _session, _handle, result) => { outcome = result; };
  agent.session.snapshotEvents = () => [{ type: "turn/end", seq: 1, data: { reason: { kind: "max-tokens" } } }];
  await runtime.settle("run", "submission", "owner", { agent }, 0);
  assert.equal(outcome.outcome, "failed");
  assert.equal(outcome.error.code, "OUTPUT_LIMIT");

  // Exercise the installed RC2 retention policy, including its native image recovery paths.
  const hooks = new Map();
  const warnings = [];
  const saved = [];
  const services = {
    llm: { imageRequestPricing: () => ({ priceImages: (images) => images.map(() => ({ visualTokens: 1000, text: "image" })) }) },
    attachments: { imageHostPath: () => join(root, "image.png") },
    fs: { processPathFromHostPath: (path) => path },
    spillStore: { saveText: async ({ content }) => {
      saved.push(content); return { path: join(root, "full.txt") };
    } }
  };
  spillPolicy({ on: (name, fn) => hooks.set(name, fn), get: (name) => services[name], logger: { warn: (warning) => warnings.push(warning) } }, { maxInlineTokens: 2000 });
  const image = { type: "image", attachment: { attachmentId: "image", mediaType: "image/png", width: 10, height: 10 } };
  const content = [{ type: "text", text: "😀Start世界".repeat(7000) }, image, { type: "text", text: "Tail😀".repeat(7000) }];
  const exec = { name: "mcp__sales__list", callId: "large", agent: { session: { header: { id: "owner" }, requestHeader: () => ({ config: { provider: "mock", model: "mock" } }) } } };
  const retain = (blocks) => hooks.get("tools/post-execute")(exec, { content: blocks }, async () => ({ kind: "accept" }));
  const retained = await retain(content);
  assert.equal(warnings.length, 0, warnings.join("\n"));
  assert(retained.content.length);
  assert(estimateContent(retained.content.filter(({ type }) => type === "text")) + retained.content.filter(({ type }) => type === "image").length * 1002 <= 2000);
  assert(saved[0].includes("image.png"));
  assert(saved[0].includes(content[0].text));
  assert(retained.content.filter(({ type }) => type === "text").every(({ text }) => text.isWellFormed()));
  services.spillStore.saveText = async () => { throw new Error("disk unavailable"); };
  assert.equal((await retain(content)).content, undefined); // Preserve original on recovery failure.
  assert.equal(truncateWithoutSplittingSurrogatePair("a😀b", 2), "a");
  // A crashed writer must not strand plugin installs or settings writes behind a stale lock.
  const atomic = require.resolve("@deepseek-ai/dsh-atomic-write");
  const { withFileLock, writeFileAtomic } = await import(atomic);
  const locked = join(root, "profile.json");
  const child = spawn(process.execPath, ["--input-type=module", "-e",
    `import { withFileLock } from ${JSON.stringify(atomic)}; await withFileLock(${JSON.stringify(locked)}, async () => { process.stdout.write('locked'); await new Promise(() => { setInterval(() => {}, 1000); }); });`],
    { stdio: ["ignore", "pipe", "inherit"] });
  await once(child.stdout, "data");
  const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
  await withFileLock(locked, () => writeFileAtomic(locked, "recovered", { mode: 0o600 }), { waitMs: 1000 });
  assert.equal(readFileSync(locked, "utf8"), "recovered");
  const events = [{ type: "tool/result", data: { message: { source: { callId: "old" }, content: [{ type: "text", text: "😀old result" }] } } }];
  assert.equal(readToolResult({ snapshotEvents: () => events }, { call_id: "old", offset: 1 }).text, "old result");

  // No mixed release families may enter a deterministic installation.
  const lock = JSON.parse(readFileSync(new URL("../dsh-runtime/package-lock.json", import.meta.url)));
  for (const [path, info] of Object.entries(lock.packages)) {
    if (/^@deepseek-ai\/dsh(?:-|$)/.test(path.split("node_modules/").at(-1))) assert.equal(info.version, "0.1.7-rc.2", path);
  }
  database.close();
  console.log("RC2 grants, job settlement, retention, Unicode, historical recall and pin checks passed");
} finally { rmSync(root, { recursive: true, force: true }); }
