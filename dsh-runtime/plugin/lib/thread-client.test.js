import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ThreadClient} from './thread-client.js';
import {DEFAULT_WORKFLOW,CHAT_WORKFLOW,WORKFLOW_TEMPLATES,processName} from './thread-workflow.js';

test('explicit Goal and Chat processes survive team defaults, repeated replies and restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-chat-loop-'));let client;const seen=[];
 try{
  client=new ThreadClient(root,{execute:async options=>{seen.push(options);return 'Reply '+seen.length;}});
  const team=(await client.snapshot()).defaultTeamId;
  await client.command({action:'configure',threadId:team,operationId:randomUUID(),workflow:[{name:'Team approval',kind:'approval'}]});
  const chat=await client.command({action:'create',templateId:'chat',title:'New chat'});
  const goal=await client.command({action:'create',templateId:'goals',title:'New goal'});
  for(const message of ['Hello','Tell me more']){
   await client.command({action:'message',threadId:chat.id,operationId:randomUUID(),text:message});
   await client.command({action:'run',threadId:chat.id,operationId:randomUUID(),text:message});await Promise.all([...client.finishing]);
   assert.deepEqual(seen.at(-1).run.workflow,CHAT_WORKFLOW);
  }
  assert.deepEqual(seen[1].thread.messages.map(m=>m.text),['Hello','Reply 1','Tell me more']);
  assert.equal(client.store.get(chat.id).title,'Hello');assert.equal(client.store.get(chat.id).runs.length,2);
  await client.command({action:'run',threadId:goal.id,operationId:randomUUID(),text:'Make a plan'});await Promise.all([...client.finishing]);assert.deepEqual(seen.at(-1).run.workflow,DEFAULT_WORKFLOW);
  client.store.close();client=new ThreadClient(root);
  assert.equal(client.store.get(chat.id).processId,'chat');assert.deepEqual(client.store.get(chat.id).workflow,CHAT_WORKFLOW);
  await assert.rejects(client.command({action:'configure',threadId:chat.id,operationId:randomUUID(),workflow:[...CHAT_WORKFLOW,...DEFAULT_WORKFLOW]}),/Invalid workflow/);
 }finally{client?.store.close();await rm(root,{recursive:true,force:true});}
});

test('new threads default to Goals and retain the chosen starter workflow through execution and restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-template-client-'));let client,executed;
 try{
  client=await new ThreadClient(root,{execute:async({run})=>{executed=run.workflow;return 'Result';}}).start();
  assert.deepEqual((await client.command({action:'create'})).workflow,DEFAULT_WORKFLOW);
  const count=client.store.list().length;
  await assert.rejects(client.command({action:'create',templateId:'unknown'}),/valid thread template/);
  assert.equal(client.store.list().length,count);
  for(const template of WORKFLOW_TEMPLATES){
    const doc=await client.command({action:'create',templateId:template.id});
    assert.deepEqual(doc.workflow,template.workflow);
    assert.equal(processName(doc.workflow),template.name);
  }
  const doc=await client.command({action:'create',templateId:'research-and-report'});
  await client.command({action:'run',threadId:doc.id,operationId:randomUUID(),text:'Research this topic'});
  await Promise.all([...client.finishing]);
  assert.deepEqual(executed,WORKFLOW_TEMPLATES.find(t=>t.id==='research-and-report').workflow);
  await client.close();client=null;client=await new ThreadClient(root,{}).start();
  assert.deepEqual(client.store.document(doc.id).workflow,executed);
  assert.deepEqual(client.store.document(doc.id).runs[0].workflow,executed);
 }finally{await client?.close();await rm(root,{recursive:true,force:true});}
});

test('scheduled occurrences execute once, retain quota across restart, and never replay interrupted work',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-schedule-client-')),prior=process.env.BEES_HOSTED_RUNS_PER_DAY;process.env.BEES_HOSTED_RUNS_PER_DAY='1';let client,calls=0;
 try{
  client=await new ThreadClient(root,{execute:async()=>{calls++;return 'Scheduled result';}}).start();
  const doc=await client.command({action:'create',title:'Daily summary'});
  await client.command({action:'configure',threadId:doc.id,operationId:randomUUID(),schedule:{frequency:'daily',hour:9,timezone:'UTC',prompt:'Prepare the summary'}});
  client.store.mutate(doc.id,randomUUID(),d=>{d.schedule.nextAt=new Date(Date.now()-1000).toISOString();});
  await Promise.all([client.scheduled(),client.scheduled()]);await Promise.all([...client.finishing]);
  const completed=client.store.document(doc.id);assert.equal(calls,1);assert.equal(completed.runs.length,1);assert.equal(completed.runs[0].status,'completed');assert(Date.parse(completed.schedule.nextAt)>Date.now());
  await client.command({action:'run',threadId:doc.id,operationId:completed.runs[0].id,text:'retry'});assert.equal(calls,1);
  await assert.rejects(client.command({action:'run',threadId:doc.id,operationId:randomUUID(),text:'Extra workflow'}),/allowance/);
  client.store.mutate(doc.id,randomUUID(),d=>{d.runs.push({id:randomUUID(),status:'running',prompt:'Interrupted run'});});
  await client.close();client=null;client=await new ThreadClient(root,{execute:async()=>{calls++;return 'Must not replay';}}).start();
  assert.equal(client.store.document(doc.id).runs.at(-1).status,'uncertain');
  await assert.rejects(client.command({action:'run',threadId:doc.id,operationId:randomUUID(),text:'After restart'}),/allowance/);assert.equal(calls,1);
 }finally{await client?.close();if(prior===undefined)delete process.env.BEES_HOSTED_RUNS_PER_DAY;else process.env.BEES_HOSTED_RUNS_PER_DAY=prior;await rm(root,{recursive:true,force:true});}
});

test('stopped runs retain team execution context and report a readable cancellation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-stop-run-'));let executed;
 const client=new ThreadClient(root,{execute:async options=>{executed=options;options.store.mutate(options.thread.id,randomUUID(),doc=>{doc.runs.at(-1).partial='Reply so far';});await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}});
 try{
  const doc=await client.command({action:'create'});
  await client.command({action:'run',threadId:doc.id,operationId:randomUUID(),text:'Work'});
  assert.equal(executed.team.id,(await client.snapshot()).defaultTeamId);
  await client.command({action:'stop',threadId:doc.id,operationId:randomUUID()});await Promise.all([...client.finishing]);
  const run=client.store.document(doc.id).runs.at(-1);
  assert.equal(run.status,'cancelled');assert.equal(run.error,'Stopped before it finished.');
  assert.equal(run.partial,undefined);assert.equal(client.store.document(doc.id).messages.at(-1).text,'Reply so far');
 }finally{client.store.close();await rm(root,{recursive:true,force:true});}
});
