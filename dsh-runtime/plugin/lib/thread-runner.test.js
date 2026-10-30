import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,symlinkSync,mkdirSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ThreadStore } from './thread-store.js';
import { ThreadRunner, guardThreadTool, resolveThreadModel, mountThreadApprovals } from './thread-runner.js';
import { Context } from '@deepseek-ai/cordis';
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope';
import { ApprovalService } from '@deepseek-ai/dsh-user-approval';

test('nested helpers prompt once per tool call and return a runtime-recognized approval', async t => {
  const ctx = new Context(), prompts = [], signal = new AbortController().signal;
  const service = await ctx.plugin(ApprovalService, { policy: 'ask' });
  t.after(() => service.dispose());
  const runner = { wait: async (...args) => { prompts.push(args); return { approved }; } };
  const store = { document: () => ({ runs: [{ id: 'run', status: 'running' }] }) };
  let approved = true;
  let hiddenPrompts = 0;
  ctx.on('approval/request', () => { hiddenPrompts++; return 'unavailable'; });
  const makeAgent = () => {
    const events = [{ type: 'turn/start' }];
    return { session: { get seq() { return events.length; }, eventAt: seq => events[seq],
      append: (type, data) => events.push({ type, data }) } };
  };
  const parent = makeAgent(), child = makeAgent(), grandchild = makeAgent();
  for (const [owner, ancestor] of [[parent], [child, parent], [grandchild, child]]) {
    const scope = createScope(ctx, owner, ancestor ? { parent: ancestor } : undefined);
    t.after(() => scope.dispose());
    mountThreadApprovals(scope.ctx, { owner, runner, store, threadId: 'thread', runId: 'run', signal, stage: { kind: 'work' } });
  }
  const execute = (agent, callId) => ctx.waterfall(scopeTarget(ctx, agent), 'tools/pre-execute',
    { agent, callId, name: 'mcp__mail__send', arguments: { body: 'Hello' }, signal }, async () => ({ kind: 'allow' }));
  assert.deepEqual(await execute(grandchild, 'first'), { kind: 'allow' });
  assert.equal(prompts.length, 1, 'Ancestor handlers must not prompt again for the same execution');
  prompts.length = 0;
  await Promise.all([execute(child, 'second'), execute(grandchild, 'third')]);
  assert.equal(prompts.length, 2, 'Separate calls with identical arguments each need approval');
  prompts.length = 0;
  assert.equal(await ctx.approval.request({ agent: grandchild, toolName: 'bash', callId: 'fourth', signal }), 'allowed-once');
  assert.equal(prompts.length, 1);
  approved = false;
  await assert.rejects(execute(child, 'denied'), /not approved/);
  assert.equal(await ctx.approval.request({ agent: child, toolName: 'bash', callId: 'denied', signal }), 'rejected');
  assert.equal(hiddenPrompts, 0, 'The thread answerer must run before the hidden host UI');
  prompts.length = 0;
  const reviewer = makeAgent(), reviewScope = createScope(ctx, reviewer, { parent });
  t.after(() => reviewScope.dispose());
  mountThreadApprovals(reviewScope.ctx, { owner: reviewer, runner, store, threadId: 'thread', runId: 'run', signal, stage: { kind: 'review' } });
  await assert.rejects(execute(reviewer, 'review'), /Review stages cannot perform integration actions/);
  assert.equal(prompts.length, 0);
});

test('saved Latest Codex selections resolve to the newest available family model',async()=>{
  const llm={listModels:async provider=>{assert.equal(provider,'openai-codex');return ['gpt-6-luna','gpt-5.6-luna','gpt-6.9-luna','gpt-6.10-luna','gpt-99-luna-preview','gpt-6-sol','gpt-5.6-terra'].map(id=>({id}));}};
  for(const [family,expected] of [['luna','gpt-6.10-luna'],['sol','gpt-6-sol'],['terra','gpt-5.6-terra']]){
    assert.deepEqual(await resolveThreadModel({provider:'openai-codex',model:`__bees_latest_${family}__`},llm),{provider:'openai-codex',model:expected});
  }
  const explicit={provider:'openai-codex',model:'gpt-5.6-luna'};
  assert.equal(await resolveThreadModel(explicit,{}),explicit);
  assert.equal(await resolveThreadModel(null,{}),null);
  await assert.rejects(resolveThreadModel({provider:'openai-codex',model:'__bees_latest_luna__'},{listModels:async()=>[]}),/Choose a connected AI model/);
});

test('tool paths use actual DSH arguments and cannot escape through traversal or symlink parents',()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-tool-fence-')),cwd=join(root,'run');mkdirSync(cwd);symlinkSync(root,join(cwd,'escape'),'dir');
  try{
    assert.equal(guardThreadTool({name:'read',arguments:{file_path:'inputs/invoice.txt'}},cwd),undefined);
    assert.match(guardThreadTool({name:'read',arguments:{file_path:'../secret'}},cwd),/Attach/);
    assert.match(guardThreadTool({name:'write',arguments:{file_path:'escape/new/secret'}},cwd),/Attach/);
    assert.match(guardThreadTool({name:'bash',arguments:{sandbox_permissions:'danger-full-access'}},cwd),/widen/);
    assert.equal(guardThreadTool({name:'working_directory',arguments:{}},cwd),undefined);
    assert.match(guardThreadTool({name:'working_directory',arguments:{cd:root}},cwd),/keep the run workspace/);
    assert.equal(guardThreadTool({name:'mcp__mail__get',arguments:{path:'/api/messages'}},cwd),undefined);
    assert.match(guardThreadTool({name:'mcp__mail__get'},cwd,{mcpAccess:'none'}),/disabled/);
    assert.match(guardThreadTool({name:'mcp__mail__get'},cwd,{mcpAccess:'selected',mcpServers:['docs']}),/disabled/);
    assert.equal(guardThreadTool({name:'mcp__docs__read'},cwd,{mcpAccess:'selected',mcpServers:['docs']}),undefined);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('run inputs preserve legacy names, resolve clashes, and retain team folders',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-input-names-')),store=new ThreadStore(root);
  try{
    const thread=store.create('Files'),team=store.create('Team');
    const attach=(doc,name,body,path)=>{const id=randomUUID();store.attach(doc.id,id,name,Buffer.from(body),'local',path);return id;};
    const older=attach(thread,'report.txt','old');attach(thread,'report.txt','new');
    attach(thread,'notes?.txt','sanitized');attach(thread,'nested.txt','nested','folder/nested.txt');
    const clash=attach(thread,'folder','legacy');attach(team,'team.txt','team','shared/team.txt');
    const run={id:randomUUID(),workflow:[]};
    await new ThreadRunner({}).execute({thread:store.document(thread.id),team:store.document(team.id),run,signal:new AbortController().signal,store});
    const cwd=join(root,'runs',thread.id,run.id),read=path=>readFileSync(join(cwd,path),'utf8');
    assert.equal(read('inputs/report.txt'),'new');assert.equal(read('inputs/'+older+'-report.txt'),'old');
    assert.equal(read('inputs/notes_.txt'),'sanitized');assert.equal(read('inputs/folder/nested.txt'),'nested');
    assert.equal(read('inputs/'+clash+'-folder'),'legacy');assert.equal(read('team-inputs/shared/team.txt'),'team');
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('parallel helpers queue human decisions without replacing another pending approval',async()=>{
  const run={id:'run'},store={mutate:(_thread,_operation,change)=>change({runs:[run]})},runner=new ThreadRunner({});
  const signal=new AbortController(),cancelled=new AbortController();
  const first=runner.wait(store,'thread','run',signal.signal,'approval',{text:'First helper'});
  const second=runner.wait(store,'thread','run',signal.signal,'approval',{text:'Second helper'});
  const third=runner.wait(store,'thread','run',cancelled.signal,'questions',{questions:[]});
  const rejected=assert.rejects(third,/Work stopped/);cancelled.abort();await rejected;
  assert.equal(run.pending.text,'First helper');
  runner.answer(run.pending.id,{approved:true,actorId:'owner'});await first;
  assert.equal(run.pending.text,'Second helper');
  runner.answer(run.pending.id,{approved:false,actorId:'owner'});await second;
  assert.equal(run.pending,undefined);assert.equal(runner.pending.size,0);
  assert.deepEqual(run.decisions.map(decision=>decision.approved),[true,false]);
  const active=runner.wait(store,'thread','run',signal.signal,'approval',{text:'Active'});
  const queued=runner.wait(store,'thread','run',signal.signal,'approval',{text:'Queued'});
  const stopped=Promise.all([assert.rejects(active,/Work stopped/),assert.rejects(queued,/Work stopped/)]);
  signal.abort();await stopped;assert.equal(run.pending,undefined);assert.equal(runner.pending.size,0);
});
