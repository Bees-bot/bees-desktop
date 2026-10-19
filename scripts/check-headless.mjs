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
import { DatabaseSync } from 'node:sqlite';
import { freePort, launchConfig } from "../dsh-runtime/headless.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const token = randomBytes(32).toString("hex");
const root = await mkdtemp(join(tmpdir(), "bees-headless-proof-"));
const port = await freePort(), modelPort = await freePort();
let modelCalls = 0, deniedReads = 0, integrationReads = 0, integrationWrites = 0, deniedIntegrationWrites = 0, child, exited, modelError, logs = "", trace = [];
const counterWords=['first','second','third','fourth','fifth'],counterChildren=new Set(),counterCompleted=new Set();
const counterName='counter-'+new Date().toISOString().replace(/\D/g,'-').slice(0,19)+'.txt';
let releaseCounterChildren;
const counterChildrenReady=new Promise(resolve=>{releaseCounterChildren=resolve;});
const model = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    assert.equal(req.url, "/v1/chat/completions");
    modelCalls++;
    const read = body.tools?.find(({function:fn})=>fn.name==='read');
    const attemptedTool = name => body.messages.some(m=>m.tool_calls?.some(({function:fn})=>fn.name===name));
    const attempted = attemptedTool('read');
    const calendar = body.tools?.find(({function:fn})=>fn.name==='mcp__proof__read_calendar_summary');
    const update = body.tools?.find(({function:fn})=>fn.name==='mcp__proof__add_calendar_event');
    if (JSON.stringify(body.messages).includes('NO_MCP_EXPECTED')) assert(!calendar && !update, 'MCP tools must not leak into another thread');
    const results=body.messages.filter(m=>m.role==='tool');
    assert(!JSON.stringify(results).includes('DO_NOT_LEAK_FROM_OTHER_THREAD'));
    if(results.some(m=>JSON.stringify(m.content).includes('Attach this file')))deniedReads++;
    if(results.some(m=>JSON.stringify(m.content).includes('STAGE1_CALENDAR:')))integrationReads++;
    if(results.some(m=>JSON.stringify(m.content).includes('STAGE1_CALENDAR_UPDATED:')))integrationWrites++;
    if(results.some(m=>JSON.stringify(m.content).includes('Review stages cannot perform integration actions')))deniedIntegrationWrites++;
    trace=[...trace,{attempted,results:results.slice(-2)}].slice(-8);
    const call = (name, args) => ({role:'assistant',tool_calls:[{index:0,id:'proof-'+modelCalls,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
    const reviewing=body.messages.some(m=>m.role==='system'&&JSON.stringify(m.content).includes('Independently review the work'));
    const childWord=!reviewing&&JSON.stringify(body.messages.filter(m=>!['assistant','tool'].includes(m.role))).match(/COUNTER_CHILD_(first|second|third|fourth|fifth)/)?.[1];
    let counterDelta;
    if(reviewing&&JSON.stringify(body.messages).includes('SUBAGENT_COUNTER_TEST_PARENT')){
      const evidence=body.messages.find(m=>m.role==='user'&&m.content.includes('Recorded execution evidence:'))?.content;
      assert(evidence,'Review must receive durable delegation evidence');
      const recorded=JSON.parse(evidence.split('Recorded execution evidence:\n')[1].split('\n\nThread context:')[0]);
      assert.equal(recorded.filter(agent=>agent.parentId&&agent.status==='completed').length,5);
      for(const word of counterWords){
        const agent=recorded.find(agent=>agent.title==='Append '+word+' to counter');assert(agent);
        assert(agent.tools.some(tool=>tool.name==='glob'&&tool.status==='succeeded'&&tool.result.includes(counterName)),'Each child must discover the parent-created file');
        assert(agent.tools.some(tool=>tool.name==='bees_append_file'&&tool.status==='succeeded'&&JSON.parse(tool.arguments).content===word+'\n'),'Each child must have its own successful append');
      }
      const parent=recorded.find(agent=>!agent.parentId&&agent.stageIndex===0);
      const initialized=parent.tools.find(tool=>tool.name==='bees_append_file');
      assert.equal(JSON.parse(initialized.arguments).content,'','The parent may initialize but must not append child entries');
      assert(initialized.completedAt<=parent.tools.find(tool=>tool.name==='subagent').startedAt,'File initialization must finish before delegation');
      assert(!parent.tools.some(tool=>['bash','write','edit','bees_commit_file'].includes(tool.name)),'The parent must never manufacture child contributions');
      counterDelta={role:'assistant',content:'Verified all five subagents completed from recorded execution evidence'};
    }else if(childWord&&body.tools){
      assert(body.tools.some(({function:fn})=>fn.name==='bees_append_file'),'Child agents need the shared atomic append tool');
      if(!attemptedTool('read'))counterDelta=call('read',{file_path:join(root,'private-other-thread.txt')});
      else if(!attemptedTool('glob'))counterDelta=call('glob',{pattern:'counter-*.txt',path:'outputs'});
      else if(!attemptedTool('bees_append_file')){
        assert(results.some(m=>JSON.stringify(m.content).includes('Attach this file')),'Child agents must enforce the thread file boundary');
        assert(results.some(m=>JSON.stringify(m.content).includes(counterName)),'Child agents must find the initialized shared file');
        counterChildren.add(childWord);if(counterChildren.size===5)releaseCounterChildren();
        await Promise.race([counterChildrenReady,delay(15_000,undefined,{ref:false}).then(()=>{throw Error('Five subagents must run in parallel');})]);
        counterDelta=call('bees_append_file',{file_path:'outputs/'+counterName,content:childWord+'\n'});
      }else{assert(!results.some(m=>m.is_error));counterCompleted.add(childWord);counterDelta={role:'assistant',content:'Completed '+childWord};}
    }else if(body.tools&&JSON.stringify(body.messages).includes('SUBAGENT_COUNTER_TEST_PARENT')){
      assert(body.tools.some(({function:fn})=>fn.name==='subagent'));
      const instructions=JSON.stringify(body.messages.filter(m=>m.role==='system'));
      assert(instructions.includes('Before launching children that modify an existing shared file'));
      assert(instructions.includes('Never write a requested subagent contribution yourself'));
      if(!attemptedTool('bees_append_file'))counterDelta=call('bees_append_file',{file_path:'outputs/'+counterName,content:''});
      else counterDelta=!attemptedTool('subagent')?{role:'assistant',tool_calls:counterWords.map((word,index)=>({index,id:'counter-'+word,type:'function',function:{name:'subagent',arguments:JSON.stringify({description:'Append '+word+' to counter',prompt:'COUNTER_CHILD_'+word+'. Append your word followed by a newline to outputs/'+counterName+'. Do not launch subtasks.',run_in_background:false})}}))}:{role:'assistant',content:'Counter complete'};
    }
    const chatting=body.messages.some(m=>m.role==='system'&&JSON.stringify(m.content).includes('conversational AI assistant'));
    let chatReply;
    if(chatting){
      assert(!reviewing);
      const context=body.messages.filter(m=>m.role==='user').map(m=>m.content).join('\n');
      if(context.includes('CHAT_LOOP_SECOND')){assert(context.includes('FIRST_CHAT_REPLY'),'Chat must retain its previous AI reply');assert(context.includes('CHAT_LOOP_FIRST'),'Chat must retain its previous user message');chatReply='SECOND_CHAT_REPLY';}
      else{assert(context.includes('CHAT_LOOP_FIRST'));chatReply='FIRST_CHAT_REPLY';}
    }
    const delta=chatting?{role:'assistant',content:chatReply}:counterDelta??(read&&!attempted?call('read',{file_path:join(root,'private-other-thread.txt')})
      :calendar&&!attemptedTool(calendar.function.name)?call(calendar.function.name,{})
      :update&&!attemptedTool(update.function.name)?call(update.function.name,{title:'Synthetic meeting'})
      :{role:'assistant',content:'STAGE1_COMPLETE.'});
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta, finish_reason = null) => ({ id: `proof-${modelCalls}`, object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000), model: "proof", choices: [{ index: 0, delta, finish_reason }] });
    res.end(`data: ${JSON.stringify(chunk(delta))}\n\ndata: ${JSON.stringify(chunk({}, delta.tool_calls ? "tool_calls" : "stop"))}\n\ndata: [DONE]\n\n`);
  } catch (error) { modelError=error;res.writeHead(500).end(JSON.stringify({ error: error.message })); }
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
    if(modelError)throw modelError;
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
  const config = { stateDir: join(root, "state"), port };
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
  assert.equal((await api('/healthz')).product, 'bees', 'The desktop launcher must recognize the client health response');
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
  assert.equal(snapshot.teams.length,1);assert.equal(snapshot.teams[0].title,"Default");assert(!Object.hasOwn(snapshot,"workspaces"));
  const command = input => api("/bees-api/threads", {operationId: crypto.randomUUID(), ...input});
  const thread = await command({action: "create", title: "Synthetic thread"});
  const integration = await command({action:'saveIntegration',threadId:thread.id,serverName:'proof',transport:'stdio',command:process.execPath,args:[join(desktop,'scripts/fixtures/headless-mcp.mjs')],secrets:{BEES_PROOF_SECRET:'synthetic-mcp-credential'}});
  assert(!JSON.stringify(integration).includes('synthetic-mcp-credential'));
  await command({action:'folder',threadId:thread.id,path:'Research/empty'});
  await command({action:'attach',threadId:thread.id,name:'brief.txt',path:'Research/brief.txt',content:Buffer.from('Synthetic brief').toString('base64')});
  await command({action: "message", threadId: thread.id, text: "Describe the fictional repair cafe."});
  const operationId = crypto.randomUUID();
  await command({action: "run", threadId: thread.id, operationId, text: "Reply STAGE1_COMPLETE after inspecting the supplied files."});
  await until(async () => {
    const current = await command({action: "read", threadId: thread.id});
    const run = current.runs.find(r => r.id === operationId);
    assert(run.status !== "failed", JSON.stringify({run, trace, logs: logs.slice(-3000)}));
    if(run.pending){assert.match(run.pending.text,/add_calendar_event/);assert.match(run.pending.text,/Synthetic meeting/);await command({action:'answer',threadId:thread.id,questionId:run.pending.id,approved:true});}
    return run.status === "completed";
  });
  const completed = await command({action: "read", threadId: thread.id});
  assert.match(completed.messages.at(-1).text, /STAGE1_COMPLETE/);
  assert.equal(completed.runs[0].stages.length, 2);
  assert.deepEqual(completed.runs[0].agents.map(agent=>agent.stageIndex),[0,1]);
  assert(completed.runs[0].agents.every(agent=>agent.status==='completed'));
  assert(deniedReads>=2,"Work and review must both enforce the thread file boundary");
  assert(integrationReads>=2, 'Both stages must be able to read the thread MCP');
  assert(integrationWrites>0 && deniedIntegrationWrites>0, 'MCP actions require work approval and are denied during review');
  assert.equal(completed.runs[0].decisions.length,1);
  const inputs=join(config.stateDir,'state/client-v3/personal/runs',thread.id,operationId,'inputs');
  assert.equal(await readFile(join(inputs,'Research/brief.txt'),'utf8'),'Synthetic brief');
  assert(existsSync(join(inputs,'Research/empty')));
  const callsBeforeRetry = modelCalls;
  await command({action: "run", threadId: thread.id, operationId, text: "Do not duplicate"});
  await delay(100);
  assert.equal(modelCalls, callsBeforeRetry);
  await command({action:'toggleIntegration',threadId:thread.id,serverId:integration.servers[0].id,enabled:false});
  const isolated=await command({action:'create',title:'No integration'}),isolatedRun=crypto.randomUUID();
  await command({action:'run',threadId:isolated.id,operationId:isolatedRun,text:'NO_MCP_EXPECTED. Reply STAGE1_COMPLETE.'});
  await until(async()=>{const doc=await command({action:'read',threadId:isolated.id});const run=doc.runs.find(r=>r.id===isolatedRun);assert.notEqual(run.status,'failed',run.error);return run.status==='completed';});
  const chat=await command({action:'create',title:'New chat',templateId:'chat'});
  for(const [prompt,reply] of [['CHAT_LOOP_FIRST','FIRST_CHAT_REPLY'],['CHAT_LOOP_SECOND','SECOND_CHAT_REPLY']]){
    await command({action:'message',threadId:chat.id,text:prompt});
    const operationId=crypto.randomUUID();await command({action:'run',threadId:chat.id,operationId,text:prompt});
    await until(async()=>{const doc=await command({action:'read',threadId:chat.id});const run=doc.runs.find(r=>r.id===operationId);assert.notEqual(run.status,'failed',run.error);return run.status==='completed';});
    const doc=await command({action:'read',threadId:chat.id});assert.equal(doc.messages.at(-1).text,reply);assert.equal(doc.runs.at(-1).stages.length,1);assert.equal(doc.runs.at(-1).workflow[0].kind,'chat');
  }
  const chatHistory=await command({action:'read',threadId:chat.id});
  assert.equal(chatHistory.messages.filter(m=>m.kind==='assistant').length,2,'Each chat turn records one reply');
  assert(chatHistory.runs.every(run=>run.stages.length===1&&run.agents.length===1),'Chat has one agent stage per reply without a review stage');
  await command({action:'configure',threadId:thread.id,workflow:[{name:'Work',kind:'work'},{name:'Approve result',kind:'approval'}]});
  const approvalRun=crypto.randomUUID();await command({action:'run',threadId:thread.id,operationId:approvalRun,text:'Prepare a fictional result for my approval.'});
  const pending=await until(async()=>{const current=await command({action:'read',threadId:thread.id});const run=current.runs.find(r=>r.id===approvalRun);assert.notEqual(run.status,'failed',run.error);return run.pending;});
  assert.equal(pending.kind,'approval');await command({action:'answer',threadId:thread.id,questionId:pending.id,approved:true});
  await until(async()=>{const current=await command({action:'read',threadId:thread.id});const run=current.runs.find(r=>r.id===approvalRun);assert.notEqual(run.status,'failed',run.error);return run.status==='completed';});
  const approved=await command({action:'read',threadId:thread.id});assert.equal(approved.runs.at(-1).decisions[0].actorId,'local');assert.equal(approved.runs.at(-1).decisions[0].approved,true);
  const counter=await command({action:'create',title:'Parallel counter regression'}),counterRun=crypto.randomUUID();
  await command({action:'run',threadId:counter.id,operationId:counterRun,text:'SUBAGENT_COUNTER_TEST_PARENT. Launch five parallel subagents to append the first five English ordinal numbers to one counter file. Only the parent may launch subtasks.'});
  await until(async()=>{const doc=await command({action:'read',threadId:counter.id});const run=doc.runs.at(-1);assert.notEqual(run.status,'failed',run.error);return run.status==='completed';});
  assert.deepEqual([...counterChildren].sort(),[...counterWords].sort(),JSON.stringify(trace));assert.deepEqual([...counterCompleted].sort(),[...counterWords].sort());
  const counterAgents=(await command({action:'read',threadId:counter.id})).runs[0].agents;
  assert.equal(counterAgents.length,7,'The Goals board retains Work, Review, and all five subagents');
  const parentAgent=counterAgents.find(agent=>!agent.parentId&&agent.stageIndex===0);
  assert.equal(counterAgents.filter(agent=>agent.parentId===parentAgent.id).length,5);
  assert(counterAgents.every(agent=>agent.status==='completed'));
  const counterOutput=join(config.stateDir,'state/client-v3/personal/runs',counter.id,counterRun,'outputs',counterName);
  assert.deepEqual((await readFile(counterOutput,'utf8')).trim().split('\n').sort(),[...counterWords].sort());
  await command({action:'configure',threadId:counter.id,workflow:[{name:'Work',kind:'work',model:'stage1/missing-model'}]});
  await command({action:'run',threadId:counter.id,text:'This run must report the underlying model error.'});
  await until(async()=>{const doc=await command({action:'read',threadId:counter.id});const run=doc.runs.at(-1);if(run.status==='running')return false;assert.equal(run.status,'failed');assert.match(run.error,/no configured model "missing-model"/);return true;});
  assert(!existsSync(join(config.stateDir, "bees-stage1.db")), "No team/workspace database is created");
  await stop();
  const legacyStore=new DatabaseSync(join(config.stateDir,'state/client-v3/personal/threads.db'));
  const legacyDoc=JSON.parse(legacyStore.prepare('SELECT document FROM threads WHERE id=?').get(counter.id).document);
  delete legacyDoc.runs[0].agents;delete legacyDoc.runs[0].activityVersion;
  legacyStore.prepare('UPDATE threads SET document=? WHERE id=?').run(JSON.stringify(legacyDoc),counter.id);legacyStore.close();
  await start();
  const recovered=(await command({action:'read',threadId:counter.id})).runs[0];
  assert.equal(recovered.agents.length,7,'Old runs recover their actual delegation history from saved sessions');
  assert.equal(recovered.activityError,undefined);
  assert.equal(recovered.agents.filter(agent=>agent.parentId&&agent.status==='completed').length,5);
  for(const agent of recovered.agents.filter(agent=>agent.parentId))assert(agent.tools.some(tool=>tool.name==='bees_append_file'&&tool.status==='succeeded'),'Successful child appends must survive restart and history recovery');
  const restarted = await command({action: "read", threadId: thread.id});
  assert.equal(restarted.runs[0].status, "completed");
  assert.match(restarted.messages.at(-1).text, /STAGE1_COMPLETE/);
  await stop();
  console.log(JSON.stringify({ok: true, checks: ["client boot", "authentication", "exclusive state", "real agent work and review", "two-turn AI chat loop", "actual tool file denial", "nested thread files and folders", "scoped MCP calls and approvals", "run deduplication", "human approval and attribution", "five parallel subagents and shared counter", "restart persistence", "no team/workspace database"], modelCalls}));
} finally {
  await stop();
  model.closeAllConnections(); await new Promise((done) => model.close(done));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
