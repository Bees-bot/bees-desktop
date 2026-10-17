import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ThreadClient} from './thread-client.js';

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
