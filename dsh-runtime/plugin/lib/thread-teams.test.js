import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ThreadClient } from './thread-client.js';
import { ThreadStore } from './thread-store.js';

test('teams retain organization scope and reject creation outside organization membership',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-org-teams-')),client=new ThreadClient(root),organizationId=randomUUID();
  try{
    client.directory.request=async path=>{assert.equal(path,'/organizations');return {organizations:[{id:organizationId}]};};
    const team=await client.command({action:'createTeam',name:'Work',organizationId});
    assert.equal(team.organizationId,organizationId);assert.equal((await client.snapshot()).teams.find(t=>t.id===team.id).organizationId,organizationId);
    await assert.rejects(client.command({action:'createTeam',name:'Other',organizationId:randomUUID()}),/membership required/);
    await client.command({action:'preferences',values:{selectedOrganizationId:organizationId}});assert.equal((await client.snapshot()).settings.selectedOrganizationId,organizationId);
    await assert.rejects(client.command({action:'preferences',values:{selectedOrganizationId:'invalid'}}),/Invalid identity/);
  }finally{client.store.close();rmSync(root,{recursive:true,force:true});}
});

test('new and previously empty owned organizations get exactly one Default team',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-org-default-')),client=new ThreadClient(root);
  const organization={id:randomUUID(),name:'Work',role:'owner'},older={id:randomUUID(),name:'Older',role:'owner'};
  try{
    client.directory.request=async(path,input)=>{assert.equal(path,'/organizations');return input?organization:{organizations:[organization,older],invitations:[]};};
    assert.equal((await client.command({action:'createOrganization',name:'Work'})).id,organization.id);
    let teams=(await client.snapshot()).teams.filter(t=>t.organizationId===organization.id);
    assert.equal(teams.length,1);assert.equal(teams[0].title,'Default');
    await client.command({action:'configure',threadId:teams[0].id,operationId:randomUUID(),title:'Renamed'});
    await client.command({action:'organizations'});await client.command({action:'organizations'});
    teams=(await client.snapshot()).teams;
    assert.equal(teams.filter(t=>t.organizationId===organization.id).length,1);
    assert.equal(teams.filter(t=>t.organizationId===older.id).length,1);
    assert.equal(teams.find(t=>t.organizationId===older.id).title,'Default');
  }finally{client.store.close();rmSync(root,{recursive:true,force:true});}
});

test('team visibility and selection persist locally without changing teams or their threads',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-hidden-team-'));let client=new ThreadClient(root);
  try{
    const team=await client.command({action:'createTeam',name:'Research'}),thread=await client.command({action:'create',teamId:team.id});
    await client.command({action:'preferences',values:{hiddenTeamIds:[team.id],selectedTeamId:team.id}});
    assert.equal(client.store.get(team.id).hidden,undefined);assert.equal(client.store.get(thread.id).teamId,team.id);
    client.store.close();client=new ThreadClient(root);
    assert.deepEqual((await client.snapshot()).settings.hiddenTeamIds,[team.id]);assert.equal((await client.snapshot()).settings.selectedTeamId,team.id);
    await assert.rejects(client.command({action:'preferences',values:{hiddenTeamIds:['invalid']}}),/Invalid identity/);
    await assert.rejects(client.command({action:'preferences',values:{hiddenTeamIds:'all'}}),/Invalid hidden teams/);
    await client.command({action:'preferences',values:{hiddenTeamIds:[]}});assert.deepEqual((await client.snapshot()).settings.hiddenTeamIds,[]);
  }finally{client.store.close();rmSync(root,{recursive:true,force:true});}
});

test('organization connection errors identify the server and how to start it',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-org-offline-')),client=new ThreadClient(root),prior=globalThis.fetch;
  try{
    client.directory.url='http://127.0.0.1:3000';globalThis.fetch=async()=>{throw new TypeError('fetch failed');};
    await assert.rejects(client.command({action:'createOrganization',name:'Research'}),/127\.0\.0\.1:3000.*npm run dev/);
    assert.equal((await client.snapshot()).teams.length,1);
  }finally{globalThis.fetch=prior;client.store.close();rmSync(root,{recursive:true,force:true});}
});

test('team processes persist, start threads with captured stages, and leave existing threads intact after deletion',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-team-process-'));let client=new ThreadClient(root,{execute:async()=> 'Done'});
  try{
    const team=(await client.snapshot()).defaultTeamId,id=randomUUID(),workflow=[{name:'Investigate',kind:'work'},{name:'Approve',kind:'approval'}];
    const processes=[{id,name:'Investigation',workflow}];
    await client.command({action:'configure',threadId:team,operationId:randomUUID(),processes});
    const thread=await client.command({action:'create',teamId:team,templateId:id});assert.equal(thread.processId,id);assert.deepEqual(thread.workflow,workflow);
    await assert.rejects(client.command({action:'configure',threadId:team,operationId:randomUUID(),processes:[...processes,...processes]}),/Invalid team processes/);
    await assert.rejects(client.command({action:'configure',threadId:team,operationId:randomUUID(),processes:[{id,name:'Bad',workflow:[{name:'Bad',kind:'unknown'}]}]}),/Invalid process stages/);
    assert.deepEqual(client.store.get(team).processes,processes);
    client.store.close();client=new ThreadClient(root,{execute:async()=> 'Done'});assert.deepEqual(client.store.get(team).processes,processes);
    await client.command({action:'configure',threadId:team,operationId:randomUUID(),processes:[]});
    await assert.rejects(client.command({action:'create',teamId:team,templateId:id}),/valid thread template/);
    await client.command({action:'run',threadId:thread.id,operationId:randomUUID(),text:'Investigate'});await Promise.all([...client.finishing]);
    assert.deepEqual(client.store.get(thread.id).runs[0].workflow,workflow);
  }finally{client.store.close();rmSync(root,{recursive:true,force:true});}
});

test('Default is created once, adopts legacy threads without changing snapshots, and teams isolate configuration',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-teams-'));let client;
  try{
    const old=new ThreadStore(root),legacy=old.create('Existing work');writeFileSync(join(root,'client-id'),old.clientId);old.close();
    let executed;
    client=new ThreadClient(root,{execute:async options=>{executed=options;return 'Done';}});
    const first=await client.snapshot(),defaultId=first.defaultTeamId;
    assert.equal(first.teams.length,1);assert.equal(first.teams[0].title,'Default');
    assert.equal(first.threads[0].teamId,defaultId);assert.deepEqual(client.store.document(legacy.id),legacy);
    const other=await client.command({action:'createTeam',name:'Research'});
    const workflow=[{name:'Investigate',kind:'work'}];
    await client.command({action:'configure',threadId:other.id,operationId:randomUUID(),instructions:'Cite sources.',memory:['Use primary evidence.'],workflow});
    const thread=await client.command({action:'create',teamId:other.id});
    await client.command({action:'run',threadId:thread.id,operationId:randomUUID(),text:'Research bees'});await Promise.all([...client.finishing]);
    assert.equal(executed.team.id,other.id);assert.deepEqual(executed.run.workflow,workflow);assert.equal(executed.run.instructions,'Cite sources.');assert.deepEqual(executed.thread.memory,['Use primary evidence.']);
    await client.command({action:'run',threadId:legacy.id,operationId:randomUUID(),text:'Other work'});await Promise.all([...client.finishing]);
    assert(!executed.run.instructions.includes('Cite sources.'));assert.deepEqual(executed.thread.memory,[]);
    client.store.close();client=new ThreadClient(root);
    assert.equal((await client.snapshot()).teams.length,2);assert.equal((await client.snapshot()).defaultTeamId,defaultId);
    assert.equal(client.store.get(other.id).instructions,'Cite sources.');
    await assert.rejects(client.command({action:'createTeam',name:' '}),/valid text/);
    await assert.rejects(client.command({action:'create',teamId:thread.id}),/Choose a team/);
  }finally{client?.store.close();rmSync(root,{recursive:true,force:true});}
});

test('team schedules create one child per occurrence and preserve that child when retried',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-team-schedule-'));let calls=0;
  const client=new ThreadClient(root,{execute:async()=>{calls++;return 'Done';}});
  try{
    const id=(await client.snapshot()).defaultTeamId;
    await client.command({action:'configure',threadId:id,operationId:randomUUID(),schedule:{frequency:'daily',hour:9,timezone:'UTC',prompt:'Daily summary'}});
    client.store.mutate(id,randomUUID(),d=>{d.schedule.nextAt=new Date(Date.now()-1000).toISOString();});
    await Promise.all([client.scheduled(),client.scheduled()]);await Promise.all([...client.finishing]);
    const snapshot=await client.snapshot();assert.equal(snapshot.threads.length,1);assert.equal(snapshot.threads[0].teamId,id);assert.equal(calls,1);assert.equal(client.store.get(id).runs.length,0);
    await client.scheduled();assert.equal(calls,1);
    const doc=client.store.document(snapshot.threads[0].id),authority={owner_client_id:doc.ownerClientId,owner_user_id:doc.ownerUserId,epoch:1,kind:'thread',team_id:id};
    assert.throws(()=>client.store.import({...doc,shared:true,teamId:randomUUID()},authority),/team authority/);
  }finally{client.store.close();rmSync(root,{recursive:true,force:true});}
});
