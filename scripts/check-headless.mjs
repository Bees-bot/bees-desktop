import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { freePort, launchConfig } from "../dsh-runtime/headless.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const token = randomBytes(32).toString("hex");
const root = await mkdtemp(join(tmpdir(), "bees-headless-proof-"));
const bundledTemporal = join(desktop, "src-tauri/binaries", `temporal-${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`);
const temporalBinary = process.env.BEES_PROOF_TEMPORAL || (process.platform === "darwin" && existsSync(bundledTemporal) ? bundledTemporal : "temporal");
const port = await freePort(), modelPort = await freePort();
let modelCalls = 0, toolResults = 0, child, exited, logs = "", trace = [];
const model = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    assert.equal(req.url, "/v1/chat/completions");
    modelCalls++;
    const tool = body.tools?.find(({ function: fn }) => fn.name === "mcp__stage1__calendar_summary");
    const used = body.messages.some((message) => message.role === "tool" && JSON.stringify(message.content).includes("STAGE1_CALENDAR"));
    trace = [...trace, { tools: body.tools?.map(({ function: fn }) => fn.name), used,
      results: body.messages.filter(({ role }) => role === "tool").slice(-2) }].slice(-8);
    if (used) toolResults++;
    const submit = body.tools?.find(({ function: fn }) => fn.name === "bees_submit_stage_result");
    const discover = body.tools?.find(({ function: fn }) => fn.name === "bees_find_tools");
    const submitted = body.messages.some((message) => message.tool_calls?.some(({ function: fn }) => fn.name === "bees_submit_stage_result"));
    const call = (name, args) => ({ role: "assistant", tool_calls: [{ index: 0, id: `proof-${modelCalls}`,
      type: "function", function: { name, arguments: JSON.stringify(args) } }] });
    const delta = !tool && !used && discover ? call(discover.function.name, { query: "mcp__stage1__calendar_summary" })
      : tool && !used ? call(tool.function.name, {})
      : used && submit && !submitted ? call(submit.function.name, { outcome: "candidate", acceptance_criteria_met: true,
        summary: "The calendar has one sales meeting with Acme at 09:00. STAGE1_COMPLETE." })
      : { role: "assistant", content: "STAGE1_COMPLETE." };
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta, finish_reason = null) => ({ id: `proof-${modelCalls}`, object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000), model: "proof", choices: [{ index: 0, delta, finish_reason }] });
    res.end(`data: ${JSON.stringify(chunk(delta))}\n\ndata: ${JSON.stringify(chunk({}, delta.tool_calls ? "tool_calls" : "stop"))}\n\ndata: [DONE]\n\n`);
  } catch (error) { res.writeHead(500).end(JSON.stringify({ error: error.message })); }
});
await new Promise((done) => model.listen(modelPort, "127.0.0.1", done));
const api = async (path, value) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { authorization: `Bearer ${token}`, ...(value ? { "content-type": "application/json" } : {}) },
    ...(value ? { method: "POST", body: JSON.stringify(value) } : {}), signal: AbortSignal.timeout(5000) });
  const result = await response.json();
  assert(response.ok, JSON.stringify(result)); return result;
};
const until = async (check, timeout = 120_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (exited) throw new Error(`Launcher exited: ${logs.slice(-6000)}`);
    const result = await check(); if (result) return result;
    await delay(250);
  }
  throw new Error(`Proof timed out: ${logs.slice(-6000)}`);
};
const start = async (reusedPid = false) => {
  exited = false; logs = "";
  const entry = join(desktop, "dsh-runtime/headless.mjs"), config = join(root, "config.json");
  // Simulate the previous container leaving a lock with our replacement process's PID.
  const args = reusedPid ? ["--input-type=module", "--eval", `
    import { writeFile } from 'node:fs/promises';
    await writeFile(${JSON.stringify(join(root, "state/headless.lock"))}, String(process.pid) + '\\n');
    process.argv = [process.execPath, ${JSON.stringify(entry)}, ${JSON.stringify(config)}];
    await import(${JSON.stringify(entry)});
  `] : [entry, config];
  child = spawn(process.execPath, args,
    { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, BEES_DSH_TOKEN: token,
      HOME: root, TMPDIR: process.env.TMPDIR }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => { logs = (logs + chunk).slice(-20000); });
  child.stderr.on("data", (chunk) => { logs = (logs + chunk).slice(-20000); });
  child.once("exit", () => { exited = true; });
  child.once("error", (error) => { exited = true; logs += error.message; });
  await until(async () => { try { return await api("/bees-api/snapshot"); } catch { return false; } }, 300_000);
};
const stop = async () => {
  if (!child || exited) return;
  const finished = new Promise((done) => child.once("exit", done));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  try { assert.equal(await finished, 0, "Launcher must shut down cleanly"); }
  finally { clearTimeout(timer); }
};
try {
  const config = { stateDir: join(root, "state"), port, temporalBinary };
  assert.throws(() => launchConfig(config, {}), /BEES_DSH_TOKEN/);
  for (const invalid of [{ stateDir: "/" }, { stateDir: "relative" }, { port: 0 }, { host: "example.com" }, { typo: true }])
    assert.throws(() => launchConfig({ ...config, ...invalid }, { BEES_DSH_TOKEN: token }));
  await writeFile(join(root, "config.json"), JSON.stringify(config));
  const profile = join(config.stateDir, "dsh/profiles/bees");
  await mkdir(profile, { recursive: true });
  const overlay = JSON.stringify([
    { id: "llm-pi-ai", config: { providers: { stage1: { api: "openai-completions",
      baseURL: `http://127.0.0.1:${modelPort}/v1`, headers: { authorization: "Bearer synthetic" },
      models: [{ id: "proof", name: "Stage 1 fixture", contextWindow: 32768, maxTokens: 1024 }] } } } },
    { id: "agent-default-model", config: { provider: "stage1", model: "proof" } }
  ]);
  await writeFile(join(profile, "cordis.patch.yml"), overlay);
  await start(true);
  const unauthorized = await fetch(`http://127.0.0.1:${port}/bees-api/snapshot`);
  assert.equal(unauthorized.status, 401);
  const wrongOrigin = await fetch(`http://127.0.0.1:${port}/bees-api/snapshot`,
    { headers: { authorization: `Bearer ${token}`, origin: "http://other.example" } });
  assert.equal(wrongOrigin.status, 401);
  const duplicate = spawn(process.execPath, [join(desktop, "dsh-runtime/headless.mjs"), join(root, "config.json")],
    { env: { ...process.env, BEES_DSH_TOKEN: token }, stdio: "ignore" });
  assert.equal(await new Promise((done) => duplicate.once("exit", done)), 1, "Reject two launchers using one state folder");
  const snapshot = await api("/bees-api/snapshot");
  const workspaceId = snapshot.workspaces[0].id;
  await api("/bees-api/capabilities", { action: "add_mcp_server", serverName: "stage1", transport: "stdio",
    command: process.execPath, args: [join(desktop, "scripts/fixtures/headless-mcp.mjs")] });
  const agent = await api("/bees-api/command", { action: "add_agent_assignment", workspaceId, presetId: "standard",
    name: "Stage 1 verifier", instructions: "Read the synthetic calendar MCP tool and report its sales meeting. Do no other work.",
    model: "stage1/proof", mcpAccess: "listed", mcpServers: ["stage1"] });
  const processRow = await api("/bees-api/command", { action: "create_process", workspaceId,
    name: "Stage 1 proof", description: "Summarize the synthetic sales calendar", stages: [
      { name: "Summarize", driver: "agent" }, { name: "Done", driver: "terminal" } ], mcpAccess: "listed", mcpServers: ["stage1"] });
  const item = await api("/bees-api/command", { action: "create_item", processId: processRow.id,
    agentAssignmentId: agent.id, title: "Synthetic daily summary", description: "Call the calendar MCP tool and summarize the sales meeting." });
  assert(!item.error, item.error);
  await until(async () => {
    const current = await api("/bees-api/snapshot");
    const row = current.items.find(({ id }) => id === item.id);
    assert(row?.runtimePhase !== "failed", JSON.stringify({ row, modelCalls, toolResults, trace }));
    return row?.runtimePhase === "completed";
  });
  assert(modelCalls >= 2 && toolResults > 0, "Real model transport must receive the MCP result");
  const device = await readFile(join(config.stateDir, "device-id"), "utf8");
  const savedOverlay = await readFile(join(profile, "cordis.patch.yml"), "utf8");
  await stop(); await start();
  const restarted = await api("/bees-api/snapshot");
  assert.equal(restarted.items.find(({ id }) => id === item.id).runtimePhase, "completed");
  assert.equal(await readFile(join(config.stateDir, "device-id"), "utf8"), device);
  assert.equal(await readFile(join(profile, "cordis.patch.yml"), "utf8"), savedOverlay);
  assert(!existsSync(join(config.stateDir, "memory")), "Headless startup must not install desktop memory dependencies");
  await stop();
  const brokenConfig = join(root, "broken.json");
  await writeFile(brokenConfig, JSON.stringify({ ...config, temporalBinary: join(root, "missing-temporal") }));
  const broken = spawn(process.execPath, [join(desktop, "dsh-runtime/headless.mjs"), brokenConfig],
    { env: { PATH: process.env.PATH, BEES_DSH_TOKEN: token }, stdio: "ignore" });
  assert.equal(await new Promise((done) => broken.once("exit", done)), 1, "Missing Temporal must fail startup");
  assert(!existsSync(join(config.stateDir, "headless.lock")), "Failed startup must release its state lock");
  console.log(JSON.stringify({ ok: true, checks: ["headless boot", "authentication", "exclusive state", "model + MCP process", "restart persistence", "startup failure cleanup"], modelCalls, toolResults }));
} finally {
  await stop();
  model.closeAllConnections(); await new Promise((done) => model.close(done));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
