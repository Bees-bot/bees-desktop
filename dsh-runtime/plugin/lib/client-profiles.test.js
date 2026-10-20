import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClientProfiles } from './client-profiles.js';

test('accounts retain separate databases and sign-out does not expose the previous account',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bees-profiles-')),original=globalThis.fetch;
  let legacy=false,emailRequests=0,offlineAlice=false;
  const orgIds={alice:'11111111-1111-4111-8111-111111111111',bob:'22222222-2222-4222-8222-222222222222'};
  const reply=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url).pathname,token=new Headers(init.headers).get('authorization')?.slice(7);
    if(path==='/api/config')return reply({...(legacy?{}:{architecture:'client-owned-threads'}),socialProviders:['google','github'],ssoEnabled:true});
    if(path==='/api/auth/sign-in/email'){emailRequests++;return new Response(JSON.stringify({token:JSON.parse(init.body).email.split('@')[0]}));}
    if(path==='/api/me')return ['alice','bob'].includes(token)?reply({user:{id:token,email:token+'@example.com',emailVerified:true}}):new Response('{}',{status:401});
    if(path==='/api/directory/clients')return reply({token});
    if(path==='/api/directory/organizations'){if(offlineAlice&&token==='alice')throw Error('Offline account');return reply({organizations:[{id:orgIds[token],name:'Studio',role:'owner'}],invitations:[]});}
    if(path==='/api/directory/heartbeat')return reply({ok:true});
    if(path==='/api/directory')return reply({threads:[],clients:[],participants:[],invitations:[]});
    if(path==='/api/directory/incoming')return reply([]);
    throw Error('Unexpected request '+path);
  };
  let profiles=new ClientProfiles(root);
  try{
    await profiles.start();const local=await profiles.command({action:'create',title:'Personal draft'});
    await profiles.login({url:'https://directory.example',email:'alice@example.com',password:'example-password'});
    const alice=profiles.active.store.clientId;assert.equal(profiles.active.store.document(local.id).title,'Personal draft');
    await profiles.command({action:'selectOrganization',accountId:(await profiles.snapshot()).accounts[0].id,organizationId:orgIds.alice});
    await profiles.command({action:'selectOrganization',accountId:null,organizationId:null});
    assert.equal((await profiles.snapshot()).localActive,true);assert.equal(profiles.active.store.preference('settings').selectedOrganizationId,null);
    assert.equal(profiles.active.store.document(local.id).title,'Personal draft');assert.equal(profiles.active.directory.token,'alice');
    await profiles.logout();assert.equal((await profiles.active.snapshot()).threads.length,0);assert.equal(profiles.active.directory.user,undefined);
    await profiles.login({url:'https://directory.example',email:'bob@example.com',password:'example-password'});
    assert.notEqual(profiles.active.store.clientId,alice);assert.equal((await profiles.active.snapshot()).threads.length,0);
    await assert.rejects(profiles.login({url:'https://directory.example',session:'invalid'}),/Sign in again/);
    assert.equal(profiles.active.directory.user.id,'bob');
    const started=await profiles.command({action:'startLogin',url:'https://directory.example',provider:'google'});
    for(let i=0;i<3;i++)assert.deepEqual(await profiles.command({action:'finishLogin',id:started.id}),{pending:true});
    assert.equal(profiles.active.directory.user.id,'bob');
    const callback=new URL(new URL(started.url).searchParams.get('redirect'));callback.searchParams.set('token','alice');
    const response=await original(callback);assert.equal(response.status,200);
    assert.match(await response.text(),/^Signed in\./);
    // Enrollment must finish even while the webview is paused in the background.
    assert.equal(profiles.active.directory.user.id,'alice');
    await profiles.command({action:'finishLogin',id:started.id});
    assert.equal(profiles.active.store.clientId,alice);assert.equal((await profiles.active.snapshot()).threads.length,1);
    const cancelled=await profiles.command({action:'startLogin',url:'https://directory.example',provider:'github'});
    await profiles.command({action:'cancelLogin',id:cancelled.id});
    await assert.rejects(profiles.command({action:'finishLogin',id:cancelled.id}),/expired/);
    assert.equal(profiles.active.store.clientId,alice);
    let snapshot=await profiles.snapshot();assert.equal(snapshot.accounts.length,2);
    const bob=snapshot.accounts.find(a=>a.user.id==='bob'),aliceAccount=snapshot.accounts.find(a=>a.user.id==='alice');
    assert(snapshot.accounts.every(a=>!('token' in a)));assert.equal(aliceAccount.active,true);
    assert.deepEqual(aliceAccount.organizations,[{id:orgIds.alice,name:'Studio',role:'owner'}]);
    assert.deepEqual(bob.organizations,[{id:orgIds.bob,name:'Studio',role:'owner'}]);
    const aliceClient=profiles.active;
    await profiles.command({action:'organizationAppearance',organizationId:orgIds.alice,appearance:{icon:'star',color:'#7c3aed'}});
    const decorated=(await profiles.snapshot()).accounts;assert.equal(decorated.find(account=>account.id===aliceAccount.id).organizations[0].appearance.icon,'star');assert.equal(decorated.find(account=>account.id===bob.id).organizations[0].appearance,undefined);
    await assert.rejects(profiles.command({action:'selectOrganization',accountId:bob.id,organizationId:orgIds.alice}),/membership/);
    assert.equal(profiles.active,aliceClient);
    await profiles.command({action:'selectOrganization',accountId:bob.id,organizationId:orgIds.bob});
    assert.equal(profiles.active.directory.user.id,'bob');assert.equal(profiles.active.store.preference('settings').selectedOrganizationId,orgIds.bob);
    assert.equal(aliceClient.directory.token,'alice');assert.equal(aliceClient.closing,undefined);
    offlineAlice=true;await aliceClient.refresh();
    const offline=(await profiles.snapshot()).accounts.find(account=>account.id===aliceAccount.id);
    assert.equal(offline.organizations[0].id,orgIds.alice);assert(offline.organizationError);
    offlineAlice=false;await aliceClient.refresh();
    await profiles.command({action:'switchAccount',accountId:bob.id});
    assert.equal(profiles.active.directory.user.id,'bob');assert.equal((await profiles.snapshot()).threads.length,0);
    await assert.rejects(profiles.command({action:'switchAccount',accountId:'unknown'}),/Sign in/);
    await profiles.close();profiles=await new ClientProfiles(root).start();
    assert.equal(profiles.active.directory.user.id,'bob');assert.equal((await profiles.snapshot()).accounts.length,2);
    assert.equal(profiles.clients.size,2,'Every signed-in account resumes its background client on restart');
    assert.deepEqual([...profiles.clients.values()].map(client=>client.directory.token).sort(),['alice','bob']);
    assert([...profiles.clients.values()].every(client=>client.timer&&!client.closing));
    const restored=(await profiles.snapshot()).accounts;assert(restored.every(account=>account.organizations.length===1&&!account.organizationError));
    assert.equal(restored.find(account=>account.id===aliceAccount.id).organizations[0].appearance.icon,'star');
    await profiles.logout();snapshot=await profiles.snapshot();assert.equal(snapshot.user,null);assert.equal(snapshot.accounts.length,1);
    await assert.rejects(profiles.command({action:'switchAccount',accountId:bob.id}),/Sign in/);
    await profiles.command({action:'switchAccount',accountId:aliceAccount.id});assert.equal(profiles.active.store.clientId,alice);
    legacy=true;const before=emailRequests;
    await assert.rejects(profiles.command({action:'startLogin',url:'https://directory.example',provider:'google'}),/Server needs an update/);
    await assert.rejects(profiles.login({url:'https://directory.example',email:'alice@example.com',password:'example-password'}),/Server needs an update/);
    assert.equal(emailRequests,before);assert.equal(profiles.active.store.clientId,alice);
  }finally{await profiles.close();globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});

test('local work remains reachable beside a separate signed-in account and after restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bees-local-switch-'));let profiles=await new ClientProfiles(root).start();
  try{
    const localId=profiles.active.store.clientId,draft=await profiles.command({action:'create',title:'Local draft'});
    const account=await profiles.open('signed-in');account.directory.user={id:'alice',email:'alice@example.com'};account.directory.token='alice';account.directory.save();
    profiles.state.accounts.alice='signed-in';profiles.state.active='signed-in';profiles.active=account;profiles.save();
    assert.equal((await profiles.snapshot()).localActive,false);
    await profiles.command({action:'selectOrganization',accountId:null,organizationId:null});
    assert.equal((await profiles.snapshot()).localActive,true);assert.equal((await profiles.snapshot()).user,null);assert.equal(profiles.active.store.document(draft.id).title,'Local draft');
    assert.equal(account.directory.token,'alice');assert.equal((await profiles.snapshot()).accounts[0].active,false);
    await profiles.command({action:'switchAccount',accountId:'alice'});
    assert.equal(profiles.active,account);assert.equal((await profiles.snapshot()).threads.length,0);
    await profiles.command({action:'selectOrganization',accountId:null,organizationId:null});
    account.directory.token=null;account.directory.save();
    await profiles.close();profiles=await new ClientProfiles(root).start();
    assert.equal(profiles.active.store.clientId,localId);assert.equal((await profiles.snapshot()).localActive,true);assert.equal(profiles.active.store.document(draft.id).title,'Local draft');
  }finally{await profiles.close();await rm(root,{recursive:true,force:true});}
});

test('the configured server selects its own profile without sending another server its credentials',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bees-profile-server-')),prior=process.env.BEES_ACCOUNT_API_URL;
  let profiles;
  try{
    process.env.BEES_ACCOUNT_API_URL='https://production.example';profiles=await new ClientProfiles(root).start();
    const originalId=profiles.active.store.clientId;profiles.active.directory.save();await profiles.close();
    process.env.BEES_ACCOUNT_API_URL='http://127.0.0.1:3000';profiles=await new ClientProfiles(root).start();
    assert.equal(profiles.active.directory.url,'http://127.0.0.1:3000');assert.notEqual(profiles.active.store.clientId,originalId);
    assert.equal(profiles.active.directory.token,undefined);await profiles.close();
    process.env.BEES_ACCOUNT_API_URL='https://production.example';profiles=await new ClientProfiles(root).start();
    assert.equal(profiles.active.directory.url,'https://production.example');assert.equal(profiles.active.store.clientId,originalId);assert.equal(profiles.active.directory.token,undefined);
  }finally{await profiles?.close();if(prior===undefined)delete process.env.BEES_ACCOUNT_API_URL;else process.env.BEES_ACCOUNT_API_URL=prior;await rm(root,{recursive:true,force:true});}
});
