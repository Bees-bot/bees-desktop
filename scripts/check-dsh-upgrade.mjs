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
  const { readToolResult } = await import("../dsh-runtime/plugin/lib/context-policy.js");
  const database = new DatabaseSync(":memory:");
  initializeProductDatabase(database);
  const schemas = [];
  const ctx = { on() {}, tools: { schemas: () => schemas }, logger: { warn() {} } };
  const runtime = new AgentRuntime(ctx, database);
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
