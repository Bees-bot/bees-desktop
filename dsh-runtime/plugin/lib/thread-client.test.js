import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ThreadClient} from './thread-client.js';
import {DEFAULT_WORKFLOW,CHAT_WORKFLOW,WORKFLOW_TEMPLATES,processName} from './thread-workflow.js';

test('cached conversations and roster survive restart without network work and revoked previews are removed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-cached-startup-'));let client=new ThreadClient(root);
 try{
  const own=client.store.create('Saved work','alice');client.store.message(own.id,randomUUID(),'Saved locally','alice');
  const remoteId=randomUUID(),authority={id:remoteId,kind:'thread',title:'Remote work',owner_client_id:randomUUID(),owner_user_id:'alice',epoch:1};
  client.directory.token='client-token';client.directory.user={id:'alice'};client.directory.save();
  client.store.preference('directoryRoster',{capabilities:{transferRequests:true},threads:[authority],participants:[],clients:[],invitations:[]});
  client.store.preference(`conversation:${remoteId}`,{id:remoteId,title:'Remote work',metadataOnly:true,messages:[{id:randomUUID(),text:'Saved preview'}],runs:[],artifacts:[]});
  client.store.close();client=new ThreadClient(root);
  client.directory.request=()=>assert.fail('Cache reads must not contact Bees');
  assert.equal((await client.snapshot()).directory.threads[0].id,remoteId);
  const local=await client.command({action:'read',threadId:own.id,cached:true});
  assert.equal(local.messages[0].text,'Saved locally');assert.equal(local.cached,true);
  const preview=await client.command({action:'read',threadId:remoteId,cached:true});
  assert.equal(preview.messages[0].text,'Saved preview');assert.equal(preview.metadataOnly,true);assert.equal(preview.cached,true);
  client.peer={endpoints:[]};client.directory.request=async path=>path==='/heartbeat'?{}:{threads:[],participants:[],clients:[],invitations:[]};
  await client.refresh({directoryOnly:true});
  assert.equal(await client.command({action:'read',threadId:remoteId,cached:true}),null);
  assert.equal(client.store.preference(`conversation:${remoteId}`),null);
 }finally{client.store.close();await rm(root,{recursive:true,force:true});}
});

test('selected conversation reads bypass slow organization and billing sync',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-priority-read-')),client=new ThreadClient(root);let finish,background;
 try{
  const doc=client.store.create('Selected work','alice');client.store.message(doc.id,randomUUID(),'Open me first','alice');
  client.store.mutate(doc.id,randomUUID(),doc=>{doc.shared=true;});
  client.directory.token='client-token';client.peer={endpoints:[]};
  const authority={id:doc.id,kind:'thread',owner_client_id:client.store.clientId,epoch:1};
  client.directory.request=async path=>{
   if(path==='/heartbeat')return {};
   if(path==='/')return {threads:[authority],participants:[],clients:[],invitations:[]};
   assert.equal(path,'/organizations');return new Promise(resolve=>{finish=()=>resolve({organizations:[]});});
  };
  background=client.refresh();while(!finish)await new Promise(setImmediate);
  const selected=await client.command({action:'read',threadId:doc.id});
  assert.equal(selected.messages[0].text,'Open me first');
 }finally{finish?.();await background;client.store.close();await rm(root,{recursive:true,force:true});}
});

test('refresh skips an unavailable organization without blocking healthy threads and resumes registration after setup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-incomplete-org-')),client=new ThreadClient(root);
 try{
  const organizationId=randomUUID(),team=client.store.create('Org6 Default','alice',DEFAULT_WORKFLOW,undefined,'team',{organizationId});
  const local=client.store.create('Org6 work','alice',DEFAULT_WORKFLOW,team.id);
  const healthy=client.store.create('Existing work','alice'),pending=client.store.create('New work','alice');
  client.store.message(healthy.id,randomUUID(),'Saved conversation','alice');
  const threads=[client.store.get(client.store.preference('defaultTeam')),client.store.get(healthy.id)].map(doc=>{
   client.store.mutate(doc.id,randomUUID(),d=>{d.shared=true;});
   return {id:doc.id,title:doc.title,kind:doc.kind,owner_client_id:client.store.clientId,epoch:1,run_status:'idle'};
  });
  let organizations=[],listed=true;const registrations=[];
  client.directory.token='client-token';client.directory.user={id:'alice'};client.peer={endpoints:[]};
  client.directory.request=async(path,body)=>{
   if(path==='/heartbeat')return {};
   if(path==='/')return {capabilities:{transferRequests:true},threads:structuredClone(threads),participants:[],clients:[]};
   if(path==='/organizations'){if(!listed)throw Object.assign(Error('Organization list offline'),{status:503});return {organizations};}
   if(path==='/threads'){
    assert(!body.organizationId||organizations.some(org=>org.id===body.organizationId));
    const authority={id:body.id,title:body.title,kind:body.kind,team_id:body.teamId,organization_id:body.organizationId,owner_client_id:client.store.clientId,epoch:1,run_status:'idle'};
    registrations.push(body.id);threads.push(authority);return authority;
   }
   throw Error('Unexpected request '+path);
  };
  const read=()=>client.command({action:'read',threadId:healthy.id});
  assert.equal((await read()).unavailable,undefined);
  assert.equal((await read()).messages[0].text,'Saved conversation');
  await client.refresh();
  assert.deepEqual(registrations,[pending.id]);
  assert.equal(client.store.get(team.id).shared,false);assert.deepEqual(client.store.get(local.id),{...local,staged:false});
  let snapshot=await client.snapshot();
  assert.match(snapshot.teams.find(row=>row.id===team.id).syncError,/Finish organization setup/);
  assert.match(snapshot.threads.find(row=>row.id===local.id).syncError,/Finish organization setup/);
  assert.equal(snapshot.threads.find(row=>row.id===healthy.id).syncError,undefined);
  assert.equal(snapshot.connectionError,null);
  organizations=[{id:organizationId,name:'Org6',role:'owner'}];
  client.store.preference('organizations',organizations);listed=false;
  await client.refresh();assert.deepEqual(registrations,[pending.id],'A stale organization list must not authorize automatic registration');
  assert.match((await client.snapshot()).teams.find(row=>row.id===team.id).syncError,/could not be checked/);
  listed=true;await client.refresh();
  assert.equal(client.store.get(team.id).shared,true);assert.equal(client.store.get(local.id).shared,true);
  await client.refresh();
  snapshot=await client.snapshot();assert.equal(snapshot.teams.find(row=>row.id===team.id).syncError,undefined);
  assert.equal(snapshot.threads.find(row=>row.id===local.id).syncError,undefined);
 }finally{client.store.close();await rm(root,{recursive:true,force:true});}
});

test('registration and metadata failures stay on the affected documents while other work stays usable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-isolated-sync-')),client=new ThreadClient(root);
 try{
  const rejected=client.store.create('Cannot share','alice'),healthy=client.store.create('Healthy work','alice'),outdated=client.store.create('Renamed work','alice');
  const threads=[client.store.get(client.store.preference('defaultTeam')),healthy,outdated].map(doc=>{
   client.store.mutate(doc.id,randomUUID(),d=>{d.shared=true;});
   return {id:doc.id,title:doc.id===outdated.id?'Old name':doc.title,kind:doc.kind,owner_client_id:client.store.clientId,epoch:1,run_status:'idle'};
  });
  let failing=true,updated=false;
  client.directory.token='client-token';client.directory.user={id:'alice'};client.peer={endpoints:[]};
  client.directory.request=async(path,body)=>{
   if(path==='/heartbeat')return {};
   if(path==='/')return {capabilities:{transferRequests:true},threads:structuredClone(threads),participants:[],clients:[]};
   if(path==='/organizations')return {organizations:[]};
   if(path==='/threads'){
    if(failing)throw Object.assign(Error('Complete organization setup before creating shared work'),{status:403});
    const authority={id:body.id,title:body.title,kind:body.kind,owner_client_id:client.store.clientId,epoch:1,run_status:'idle'};threads.push(authority);return authority;
   }
   if(path===`/threads/${outdated.id}/metadata`){
    if(failing)throw Object.assign(Error('Only the owning client may update metadata'),{status:403});
    Object.assign(threads.find(row=>row.id===outdated.id),{title:body.title,run_status:body.status});updated=true;return {};
   }
   throw Error('Unexpected request '+path);
  };
  assert.equal((await client.command({action:'read',threadId:healthy.id})).unavailable,undefined);
  assert.equal((await client.command({action:'read',threadId:outdated.id})).unavailable,undefined);
  await client.refresh();
  let snapshot=await client.snapshot();
  assert.match(snapshot.threads.find(row=>row.id===rejected.id).syncError,/Cannot share.*Complete organization setup/);
  assert.match(snapshot.threads.find(row=>row.id===outdated.id).syncError,/Renamed work.*update metadata/);
  assert.equal(snapshot.threads.find(row=>row.id===healthy.id).syncError,undefined);
  failing=false;await client.refresh();assert(updated);assert.equal(client.store.get(rejected.id).shared,true);
  snapshot=await client.snapshot();assert(snapshot.threads.every(row=>!row.syncError));
  threads.splice(threads.findIndex(row=>row.id===healthy.id),1);
  assert.equal((await client.command({action:'read',threadId:healthy.id})).unavailable,'You no longer have access to this thread.');
  assert.equal(client.store.preference(`frozen:${healthy.id}`),true);
  await assert.rejects(client.fence(healthy.id),/being transferred/);
 }finally{client.store.close();await rm(root,{recursive:true,force:true});}
});

test('opening a remote thread loads conversation text without files, execution state, MCP settings or a stored replica',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-conversation-preview-')),client=new ThreadClient(root),owner=new ThreadClient(join(root,'owner'));
 try{
  const original=owner.store.create('Research','alice');owner.store.message(original.id,randomUUID(),'Conversation text','alice');
  owner.store.mutate(original.id,randomUUID(),d=>{d.shared=true;d.instructions='Private execution instructions';d.messages[0].files=[randomUUID()];});
  const authority={id:original.id,title:'Research',kind:'thread',team_id:randomUUID(),owner_client_id:owner.store.clientId,owner_user_id:'alice',epoch:1,run_status:'idle'};
  client.directory.token='client-token';client.directory.user={id:'alice'};client.refresh=async()=>{};
  client.roster={capabilities:{transferRequests:true},threads:[authority],participants:[],clients:[]};
  const calls=[];
  client.peer={send:async(id,target,input)=>{calls.push(input.kind);assert.equal(target,owner.store.clientId);return owner.receive({thread_id:id,epoch:1},input);}};
  const preview=await client.command({action:'read',threadId:original.id});
  assert.deepEqual(calls,['conversation']);assert.equal(preview.messages[0].text,'Conversation text');
  assert.equal(preview.messages[0].files,undefined);assert.deepEqual(preview.artifacts,[]);assert.deepEqual(preview.runs,[]);assert.equal(preview.instructions,undefined);
  assert.equal(client.store.list().some(row=>row.id===original.id),false);assert.equal(client.store.preference(`integrations:${original.id}`),null);
  await client.replicate();assert.deepEqual(calls,['conversation']);
  await assert.rejects(client.command({action:'run',threadId:original.id,operationId:randomUUID(),text:'Run remotely'}),/Transfer/);
  client.peer.send=async()=>{throw Object.assign(Error('Client authentication required'),{status:403});};
  assert.equal((await client.command({action:'read',threadId:original.id})).unavailable,'Client authentication required');
  const own=client.store.create('Local work','alice');client.store.message(own.id,randomUUID(),'Available offline','alice');
  client.refresh=async()=>{throw Object.assign(Error('Server offline'),{status:503});};
  assert.equal((await client.command({action:'read',threadId:own.id})).messages[0].text,'Available offline');
 }finally{client.store.close();owner.store.close();await rm(root,{recursive:true,force:true});}
});

test('a first read preserves sync failures, recovers when the owner returns, and retains cached work offline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-first-sync-')),client=new ThreadClient(join(root,'web')),owner=new ThreadClient(join(root,'owner'));
 try{
  const original=owner.store.create('Desktop research','alice');
  const doc=owner.store.mutate(original.id,randomUUID(),d=>{d.shared=true;});
  owner.store.message(doc.id,randomUUID(),'Saved on desktop','alice');
  const authority={id:doc.id,kind:'thread',owner_client_id:owner.store.clientId,owner_user_id:'alice',epoch:1};
  client.refresh=async()=>{};
  client.roster.threads=[authority];
  const now=new Date().toISOString();
  client.roster.clients=[{id:client.store.clientId,last_seen_at:now},{id:owner.store.clientId,last_seen_at:new Date(Date.now()-60000).toISOString()}];
  let requests=0;
  client.peer={send:async(id,target,input)=>{requests++;assert.equal(id,doc.id);assert.equal(target,owner.store.clientId);assert.equal(input.kind,'snapshot');return owner.store.document(id);}};
  const read=()=>client.command({action:'read',threadId:doc.id});
  await assert.rejects(read(),{status:408,message:"The owner's Bees Client can't be reached right now."});
  assert.equal(requests,0);assert(!client.store.list().some(row=>row.id===doc.id),'Failed downloads must not create empty threads');
  client.roster.clients[1].last_seen_at=now;
  const synced=await read();assert.equal(synced.title,'Desktop research');assert.equal(synced.messages[0].text,'Saved on desktop');assert.equal(synced.unavailable,undefined);
  client.roster.clients[1].last_seen_at=new Date(Date.now()-60000).toISOString();
  const cached=await read();assert.equal(cached.messages[0].text,'Saved on desktop');assert.match(cached.unavailable,/can't be reached/);
  client.refresh=async()=>{throw Object.assign(Error('Organization access denied'),{status:403});};
  assert.equal((await read()).unavailable,'Organization access denied','An unrelated 403 must not be labeled as revoked thread access');
  client.store.drop(doc.id);
  for(const status of [401,403,502]){
   const failure=Object.assign(Error('Sync failure '+status),{status});client.refresh=async()=>{throw failure;};
   await assert.rejects(read(),error=>error===failure);
  }
 }finally{client.store.close();owner.store.close();await rm(root,{recursive:true,force:true});}
});

test('web reads of an offline desktop-owned thread explain how to transfer it without masking access errors',async t=>{
 const priorHosted=process.env.BEES_HOSTED_CLIENT;process.env.BEES_HOSTED_CLIENT='1';
 t.after(()=>{if(priorHosted===undefined)delete process.env.BEES_HOSTED_CLIENT;else process.env.BEES_HOSTED_CLIENT=priorHosted;});
 const root=await mkdtemp(join(tmpdir(),'bees-desktop-transfer-')),client=new ThreadClient(join(root,'web')),desktop=new ThreadClient(join(root,'desktop'));
 try{
  client.directory.user={id:'alice'};client.refresh=async()=>{};
  const original=desktop.store.create('Desktop research','alice'),doc=desktop.store.mutate(original.id,randomUUID(),d=>{d.shared=true;});
  const authority={id:doc.id,kind:'thread',owner_client_id:desktop.store.clientId,owner_user_id:'alice',epoch:1};
  client.roster.threads=[authority];
  client.roster.clients=[{id:desktop.store.clientId,name:'My Mac',last_seen_at:new Date(0).toISOString()}];
  const read=()=>client.command({action:'read',threadId:doc.id});
  const message='This thread is active in your desktop client. To transfer it to the web client, open Bees Desktop and select this thread. Finish or stop any active work, then go to Settings → Transfer, choose Bees Cloud, and click Offer transfer. Return to the web client and click Accept transfer. Keep both clients open until the transfer finishes.';
  await assert.rejects(read(),{status:408,message});
  client.store.import(doc,authority);assert.equal((await read()).unavailable,message);client.store.drop(doc.id);
  for(const change of [()=>{authority.owner_user_id='bob';},()=>{client.roster.clients[0].name='Bees Cloud';},()=>{authority.kind='team';},()=>{delete process.env.BEES_HOSTED_CLIENT;}]){
   authority.owner_user_id='alice';authority.kind='thread';client.roster.clients[0].name='My Mac';process.env.BEES_HOSTED_CLIENT='1';change();
   await assert.rejects(read(),{status:408,message:"The owner's Bees Client can't be reached right now."});
  }
  process.env.BEES_HOSTED_CLIENT='1';authority.kind='thread';
  for(const status of [401,403,502]){const failure=Object.assign(Error('Failure '+status),{status});client.refresh=async()=>{throw failure;};await assert.rejects(read(),error=>error===failure);}
 }finally{client.store.close();desktop.store.close();await rm(root,{recursive:true,force:true});}
});

test('snapshots omit empty Chat and Goal placeholders at any revision while preserving saved work',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-empty-drafts-'));let client=new ThreadClient(root);
 try{
  const chat=await client.command({action:'create',title:'New chat'}),goal=await client.command({action:'create',title:'New Goal'});
  client.store.mutate(goal.id,randomUUID(),()=>{});
  assert.equal(client.store.get(goal.id).revision,2);
  assert.deepEqual((await client.snapshot()).threads,[]);
  assert.equal(client.store.get(chat.id).title,'New chat','Placeholder data stays intact');
  assert.equal(client.store.get(goal.id).title,'New Goal');
  client.store.close();client=new ThreadClient(root);
  assert.deepEqual((await client.snapshot()).threads,[],'Reopening the stored drafts keeps them out of the list');
  const kept=[];
  for(const values of [{messages:[{id:randomUUID(),kind:'user',text:'Saved message',authorId:'local',createdAt:new Date().toISOString()}]},{instructions:'Saved instructions'},{memory:['Remember this']},{folders:['work']},{shared:true},{workflow:[{name:'Saved process',kind:'work'}]},{workflow:DEFAULT_WORKFLOW.map((stage,index)=>index===0?{...stage,model:'provider/saved-model'}:stage)},{title:'My empty thread'}]){
    const doc=await client.command({action:'create',title:'New chat'});client.store.save({...doc,...values});kept.push(doc.id);
  }
  const file=await client.command({action:'create',title:'New goal'});
  client.store.attach(file.id,randomUUID(),'saved.txt',Buffer.from('Keep this'),'local');kept.push(file.id);
  assert.deepEqual(new Set((await client.snapshot()).threads.map(row=>row.id)),new Set(kept));
  await client.command({action:'message',threadId:chat.id,operationId:randomUUID(),text:'Hello'});
  assert((await client.snapshot()).threads.some(row=>row.id===chat.id),'A draft reappears after its first message');
 }finally{client.store.close();await rm(root,{recursive:true,force:true});}
});

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

test('drafts preserve prompt, files, folders and settings across restart, then start in the same thread',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-draft-'));let client;let executed;
 const command=(action,threadId,values={})=>client.command({action,threadId,operationId:randomUUID(),...values});
 try{
  client=new ThreadClient(root,{execute:async input=>{executed=input;return 'Done';}});
  const draft=await command('create',null,{draft:true,templateId:'chat'});
  assert.equal((await command('create',null,{draft:true,templateId:'chat'})).id,draft.id,'Unused team screens reuse one empty draft');
  assert.equal(client.store.list().find(row=>row.id===draft.id).draftTouched,false);
  const prompt='  Prepare the report\nusing these notes.  ';
  const op=randomUUID();await client.command({action:'draft',threadId:draft.id,operationId:op,text:prompt});
  await client.command({action:'draft',threadId:draft.id,operationId:op,text:'duplicate'});
  assert.equal(client.store.get(draft.id).draftPrompt,prompt);
  const attachment=await command('attach',draft.id,{name:'notes.txt',path:'reference/notes.txt',content:Buffer.from('Source notes').toString('base64')});
  await command('folder',draft.id,{path:'reference/empty'});
  await command('configure',draft.id,{instructions:'Use the attached sources.',workflow:CHAT_WORKFLOW,processId:'chat'});
  assert.equal(executed,undefined);assert.equal(client.store.get(draft.id).messages.length,0);
  assert.equal(client.store.get(draft.id).title,'Draft thread');
  assert.notEqual((await command('create',null,{draft:true,templateId:'chat'})).id,draft.id,'A saved draft is never recycled');
  client.store.close();client=new ThreadClient(root,{execute:async input=>{executed=input;return 'Done';}});
  const saved=await command('read',draft.id),row=(await client.snapshot()).threads.find(row=>row.id===draft.id);
  assert.equal(saved.draftPrompt,prompt);assert.equal(row.preview,prompt);assert.equal(row.draft,true);assert.equal(row.draftTouched,true);
  assert.deepEqual(saved.folders,['reference/empty']);assert.equal(saved.instructions,'Use the attached sources.');
  assert.equal(client.store.object(saved,attachment.artifacts[0].id).bytes.toString(),'Source notes');
  await command('discussion',draft.id,{text:'Discuss before starting'});
  await command('message',draft.id,{text:prompt});assert.equal(client.store.get(draft.id).title,'Draft thread');
  await command('run',draft.id,{text:prompt});await Promise.all([...client.finishing]);
  assert.equal(executed.thread.id,draft.id);assert.equal(executed.thread.artifacts[0].path,'reference/notes.txt');
  assert.equal(executed.run.instructions,'Use the attached sources.');assert.deepEqual(executed.run.workflow,CHAT_WORKFLOW);
  assert.equal(client.store.get(draft.id).title,prompt.trim());assert.equal(client.store.get(draft.id).draft,undefined);
  assert.equal(client.store.get(draft.id).draftPrompt,undefined);
  await assert.rejects(command('draft',draft.id,{text:'Stale save'}),/already started/);
 }finally{client?.store.close();await rm(root,{recursive:true,force:true});}
});

test('manual titles survive starting a draft, including names that look like placeholders',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-draft-title-'));const client=new ThreadClient(root,{execute:async()=> 'Done'});
 const command=(action,threadId,values={})=>client.command({action,threadId,operationId:randomUUID(),...values});
 try{
  for(const title of ['My report','New thread','Draft thread']){
   const draft=await command('create',null,{draft:true});
   await command('configure',draft.id,{title});
   await command('message',draft.id,{text:'Automatic title'});await command('run',draft.id,{text:'Automatic title'});
   await Promise.all([...client.finishing]);assert.equal(client.store.get(draft.id).title,title);
  }
  const ordinary=await command('create');await command('configure',ordinary.id,{title:'New chat'});
  await command('message',ordinary.id,{text:'Keep the name'});assert.equal(client.store.get(ordinary.id).title,'New chat');
  const draft=await command('create',null,{draft:true});
  for(const value of [null,{},'x'.repeat(100001)])await assert.rejects(command('draft',draft.id,{text:value}),/Invalid draft prompt/);
  await command('draft',draft.id,{text:''});assert.equal(client.store.get(draft.id).draftTouched,false);
  client.store.preference(`frozen:${draft.id}`,true);
  await assert.rejects(command('draft',draft.id,{text:'Forbidden'}),/transferred/);
 }finally{client.store.close();await rm(root,{recursive:true,force:true});}
});

test('organization invitation cancellation uses the scoped DELETE route and validates IDs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bees-org-invites-')),client=new ThreadClient(root),requests=[];
  try{
    client.directory.request=async(...args)=>{requests.push(args);return {ok:true};};
    const organizationId=randomUUID(),invitationId=randomUUID();
    assert.deepEqual(await client.command({action:'cancelOrganizationInvitation',organizationId,invitationId}),{ok:true});
    assert.deepEqual(requests,[[`/organizations/${organizationId}/invitations/${invitationId}`,{},'DELETE']]);
    await assert.rejects(client.command({action:'cancelOrganizationInvitation',organizationId:'../other',invitationId}));
    await assert.rejects(client.command({action:'cancelOrganizationInvitation',organizationId,invitationId:'../other'}));
    assert.equal(requests.length,1);
  }finally{client.store.close();await rm(root,{recursive:true,force:true});}
});
