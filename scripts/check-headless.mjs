import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
if (temporalBinary === "temporal" && spawnSync("temporal", ["--version"]).error)
  throw new Error("No temporal program found. Set BEES_PROOF_TEMPORAL to its path, put temporal on PATH, or build the desktop app once.");
const port = await freePort(), modelPort = await freePort();
let modelCalls = 0, deniedReads = 0, child, exited, logs = "", trace = [];
const model = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    assert.equal(req.url, "/v1/chat/completions");
    modelCalls++;
    const read = body.tools?.find(({function:fn})=>fn.name==='read');
    const attempted = body.messages.some(m=>m.tool_calls?.some(({function:fn})=>fn.name==='read'));
    const results=body.messages.filter(m=>m.role==='tool');
    assert(!JSON.stringify(results).includes('DO_NOT_LEAK_FROM_OTHER_THREAD'));
    if(results.some(m=>JSON.stringify(m.content).includes('Attach this file')))deniedReads++;
    trace=[...trace,{attempted,results:results.slice(-2)}].slice(-8);
    const delta=read&&!attempted?{role:'assistant',tool_calls:[{index:0,id:'proof-'+modelCalls,type:'function',function:{name:'read',arguments:JSON.stringify({file_path:join(root,'private-other-thread.txt')})}}]}:{role:'assistant',content:'STAGE1_COMPLETE.'};
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
  await writeFile(join(root,'private-other-thread.txt'),'DO_NOT_LEAK_FROM_OTHER_THREAD');
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
      models: [{ id: "proof", name: "Stage 1 fixture", contextWindow: 32768, maxTokens: 1024 }] } } } }
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
  assert.equal(snapshot.product, "Bees Client");
  assert.equal(snapshot.threads.length, 0);
  assert(!Object.hasOwn(snapshot, "teams") && !Object.hasOwn(snapshot, "workspaces"));
  const command = input => api("/bees-api/threads", {operationId: crypto.randomUUID(), ...input});
  const thread = await command({action: "create", title: "Synthetic thread"});
  await command({action: "message", threadId: thread.id, text: "Describe the fictional repair cafe."});
  const operationId = crypto.randomUUID();
  await command({action: "run", threadId: thread.id, operationId, text: "Reply STAGE1_COMPLETE after inspecting the supplied files."});
  await until(async () => {
    const current = await command({action: "read", threadId: thread.id});
    const run = current.runs.find(r => r.id === operationId);
    assert(run.status !== "failed", JSON.stringify({run, trace, logs: logs.slice(-3000)}));
    return run.status === "completed";
  });
  const completed = await command({action: "read", threadId: thread.id});
  assert.match(completed.messages.at(-1).text, /STAGE1_COMPLETE/);
  assert.equal(completed.runs[0].stages.length, 2);
  assert(deniedReads>=2,"Work and review must both enforce the thread file boundary");
  const callsBeforeRetry = modelCalls;
  await command({action: "run", threadId: thread.id, operationId, text: "Do not duplicate"});
  await delay(100);
  assert.equal(modelCalls, callsBeforeRetry);
  await command({action:'configure',threadId:thread.id,workflow:[{name:'Work',kind:'work'},{name:'Approve result',kind:'approval'}]});
  const approvalRun=crypto.randomUUID();await command({action:'run',threadId:thread.id,operationId:approvalRun,text:'Prepare a fictional result for my approval.'});
  const pending=await until(async()=>{const current=await command({action:'read',threadId:thread.id});const run=current.runs.find(r=>r.id===approvalRun);assert.notEqual(run.status,'failed',run.error);return run.pending;});
  assert.equal(pending.kind,'approval');await command({action:'answer',threadId:thread.id,questionId:pending.id,approved:true});
  await until(async()=>{const current=await command({action:'read',threadId:thread.id});const run=current.runs.find(r=>r.id===approvalRun);assert.notEqual(run.status,'failed',run.error);return run.status==='completed';});
  const approved=await command({action:'read',threadId:thread.id});assert.equal(approved.runs.at(-1).decisions[0].actorId,'local');assert.equal(approved.runs.at(-1).decisions[0].approved,true);
  assert(!existsSync(join(config.stateDir, "bees-stage1.db")), "No team/workspace database is created");
  await stop(); await start();
  const restarted = await command({action: "read", threadId: thread.id});
  assert.equal(restarted.runs[0].status, "completed");
  assert.match(restarted.messages.at(-1).text, /STAGE1_COMPLETE/);
  await stop();
  console.log(JSON.stringify({ok: true, checks: ["client boot", "authentication", "exclusive state", "real agent work and review", "actual tool file denial", "run deduplication", "human approval and attribution", "restart persistence", "no team/workspace database"], modelCalls}));
} finally {
  await stop();
  model.closeAllConnections(); await new Promise((done) => model.close(done));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
