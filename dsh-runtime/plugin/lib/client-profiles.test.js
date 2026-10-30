import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClientProfiles } from './client-profiles.js';
import { ThreadFolders } from './thread-folders.js';

test('multiple local orgs keep the built-in org, teams, folders and settings across switches and restart without a server',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bees-local-orgs-')),original=globalThis.fetch;
  const folders=new ThreadFolders(join(root,'folders.json'),{defaultRoot:join(root,'work'),privateRoot:join(root,'profiles')});
  let profiles=await new ClientProfiles(join(root,'profiles'),{folders}).start();
  globalThis.fetch=async()=>{throw Error('Local work must not contact the server');};
  try{
    const builtIn=await profiles.command({action:'create',title:'Built-in draft'}),defaultTeamId=(await profiles.snapshot()).defaultTeamId;
    for(const name of ['', ' ', 'x'.repeat(121),null])await assert.rejects(profiles.command({action:'createLocalOrganization',name}),/valid text/);
    const studio=await profiles.command({action:'createLocalOrganization',name:' Studio '}),personal=await profiles.command({action:'createLocalOrganization',name:'Personal'});
    assert.equal(studio.name,'Studio');assert.notEqual(studio.id,personal.id);
    let snapshot=await profiles.snapshot();assert.deepEqual(snapshot.localOrganizations,[studio,personal]);assert.equal(snapshot.accounts.length,0);
    assert.equal(snapshot.defaultTeamId,defaultTeamId);assert.equal(snapshot.teams.filter(team=>!team.organizationId).length,1);
    assert.equal(snapshot.teams.filter(team=>team.organizationId===studio.id).length,1);
    await profiles.command({action:'selectOrganization',accountId:null,organizationId:studio.id});
    const team=await profiles.command({action:'createTeam',organizationId:studio.id,name:'Research'});
    const thread=await profiles.command({action:'create',teamId:team.id,title:'Studio draft'});
    await profiles.command({action:'organizationAppearance',settingsAccountId:null,organizationId:studio.id,appearance:{icon:'star',color:'#7c3aed'}});
    const organizations=await profiles.command({action:'organizations',settingsAccountId:null,local:true});assert.equal(organizations.organizations.length,2);assert.deepEqual(organizations.invitations,[]);
    snapshot=await profiles.snapshot();assert.equal(snapshot.localActive,true);assert.equal(snapshot.user,null);assert.equal(snapshot.settings.selectedOrganizationId,studio.id);
    assert.notEqual(snapshot.folders.organizations[0].folder,snapshot.folders.organizations[1].folder);
    assert.notEqual(folders.organization(profiles.active.store,null),snapshot.folders.organizations[0].folder);
    await profiles.command({action:'selectOrganization',accountId:null,organizationId:null});
    assert.equal((await profiles.snapshot()).settings.selectedOrganizationId,null);assert.equal((await profiles.command({action:'read',threadId:builtIn.id})).title,'Built-in draft');
    await profiles.command({action:'selectOrganization',accountId:null,organizationId:personal.id});
    await profiles.close();profiles=await new ClientProfiles(join(root,'profiles'),{folders}).start();
    snapshot=await profiles.snapshot();assert.equal(snapshot.settings.selectedOrganizationId,personal.id);assert.equal(snapshot.localOrganizations.length,2);
    assert.equal(snapshot.localOrganizations[0].appearance.icon,'star');assert.equal((await profiles.command({action:'read',threadId:thread.id})).title,'Studio draft');
    await assert.rejects(profiles.command({action:'selectOrganization',accountId:null,organizationId:randomUUID()}),/membership/);
    profiles.active.directory.token='test-token';
    await assert.rejects(profiles.active.registerThread(thread.id),/Local organizations cannot be shared/);
    profiles.active.directory.token=null;
  }finally{await profiles.close();globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});

test('signing in beside local orgs keeps them private, visible and selectable after restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bees-local-org-login-')),original=globalThis.fetch,priorHosted=process.env.BEES_HOSTED_CLIENT;
  let profiles=await new ClientProfiles(root).start();
  const user={id:'alice',email:'alice@example.com',emailVerified:true};
  globalThis.fetch=async url=>{
    const path=new URL(url).pathname;
    if(path==='/api/config')return Response.json({architecture:'client-owned-threads'});
    if(path==='/api/me')return Response.json({user});
    if(path==='/api/directory/clients')return Response.json({token:'alice'});
    if(path==='/api/directory/heartbeat')return Response.json({ok:true});
    if(path==='/api/directory')return Response.json({threads:[],clients:[],participants:[],invitations:[]});
    if(path==='/api/directory/organizations')return Response.json({organizations:[],invitations:[]});
    throw Error('Unexpected request '+path);
  };
  try{
    const org=await profiles.command({action:'createLocalOrganization',name:'Private studio'}),local=profiles.active;
    await profiles.login({url:'https://directory.example',session:'alice'});
    assert.notEqual(profiles.active,local);assert.equal(local.directory.token,undefined);
    assert.deepEqual((await profiles.snapshot()).accounts[0].organizations,[]);assert.equal((await profiles.snapshot()).localOrganizations[0].id,org.id);
    const second=await profiles.command({action:'createLocalOrganization',name:'Second private org',settingsAccountId:(await profiles.snapshot()).accounts[0].id});
    assert.equal(profiles.active.directory.user.id,'alice');assert.equal(local.organizations().length,2);
    await profiles.close();profiles=await new ClientProfiles(root).start();
    assert.equal((await profiles.snapshot()).localOrganizations.length,2);assert.equal((await profiles.snapshot()).user.id,'alice');
    await profiles.command({action:'selectOrganization',accountId:null,organizationId:second.id});
    assert.equal((await profiles.snapshot()).user,null);assert.equal((await profiles.snapshot()).settings.selectedOrganizationId,second.id);
    process.env.BEES_HOSTED_CLIENT='1';
    await assert.rejects(profiles.command({action:'createLocalOrganization',name:'Not hosted'}),/Bees Desktop/);
  }finally{if(priorHosted===undefined)delete process.env.BEES_HOSTED_CLIENT;else process.env.BEES_HOSTED_CLIENT=priorHosted;await profiles.close();globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});

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
    const selectedBefore=aliceClient.store.preference('settings');
    const bobSettings=await profiles.command({action:'settingsSnapshot',settingsAccountId:bob.id});
    assert.equal(bobSettings.user.id,'bob');assert.equal(profiles.active,aliceClient);
    const bobTeam=bobSettings.teams.find(team=>team.organizationId===orgIds.bob);
    await profiles.command({action:'configure',threadId:bobTeam.id,operationId:randomUUID(),title:'Bob team',settingsAccountId:bob.id});
    assert.equal((await profiles.command({action:'read',threadId:bobTeam.id,settingsAccountId:bob.id})).title,'Bob team');
    assert.equal(profiles.active,aliceClient);assert.deepEqual(aliceClient.store.preference('settings'),selectedBefore);
    assert.equal((await profiles.snapshot()).accounts.find(account=>account.id===aliceAccount.id).active,true);
    await assert.rejects(profiles.command({action:'settingsSnapshot',settingsAccountId:'unknown'}),/Sign in/);
    await assert.rejects(profiles.command({action:'read',threadId:bobTeam.id,settingsAccountId:aliceAccount.id}));
    await assert.rejects(profiles.settingsClient('unknown'),/Sign in/);

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

test('a configured server excludes saved accounts on other servers from syncing and settings',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bees-profile-settings-server-')),prior=process.env.BEES_ACCOUNT_API_URL,original=globalThis.fetch,requests=[];
  let profiles;
  globalThis.fetch=async url=>{requests.push(new URL(url).origin);throw new TypeError('fetch failed');};
  try{
    process.env.BEES_ACCOUNT_API_URL='http://127.0.0.1:3000';profiles=await new ClientProfiles(root).start();
    const localId=profiles.active.store.clientId,localSlot=profiles.state.active,accountId=profiles.key(profiles.active.directory.url,'alice');
    profiles.active.directory.token='local-token';profiles.active.directory.user={id:'alice',email:'alice@example.com'};profiles.active.directory.save();
    profiles.state.accounts[accountId]=profiles.state.active;profiles.save();await profiles.close();
    process.env.BEES_ACCOUNT_API_URL='https://app.bees.bot';profiles=await new ClientProfiles(root).start();
    assert.deepEqual(requests,[]);assert.equal(profiles.clients.size,1);
    const snapshot=await profiles.snapshot();assert.equal(snapshot.serverUrl,'https://app.bees.bot');assert.deepEqual(snapshot.accounts,[]);
    assert.equal((await profiles.command({action:'settingsSnapshot',settingsAccountId:null})).serverUrl,'https://app.bees.bot');
    await assert.rejects(profiles.command({action:'settingsSnapshot',settingsAccountId:accountId}),/Sign in/);
    await assert.rejects(profiles.command({action:'switchAccount',accountId}),/Sign in/);
    const production=await profiles.open('production');production.directory.token='production-token';production.directory.user={id:'bob',email:'bob@example.com'};production.directory.save();
    profiles.state.active='production';profiles.active=production;profiles.state.anonymous=localSlot;profiles.save();await profiles.close();
    profiles=await new ClientProfiles(root).start();
    assert.equal(profiles.active,profiles.clients.get('production'));assert(!profiles.clients.has(localSlot));
    assert.equal((await profiles.command({action:'settingsSnapshot',settingsAccountId:null})).serverUrl,'https://app.bees.bot');
    assert(requests.every(url=>url==='https://app.bees.bot'));requests.length=0;
    await profiles.close();
    process.env.BEES_ACCOUNT_API_URL='http://127.0.0.1:3000';profiles=await new ClientProfiles(root).start();
    assert.equal(profiles.active.store.clientId,localId);assert.equal(profiles.active.directory.token,'local-token');
    assert.equal((await profiles.snapshot()).accounts[0].id,accountId);assert(requests.length>0);assert(requests.every(url=>url==='http://127.0.0.1:3000'));
  }finally{await profiles?.close();globalThis.fetch=original;if(prior===undefined)delete process.env.BEES_ACCOUNT_API_URL;else process.env.BEES_ACCOUNT_API_URL=prior;await rm(root,{recursive:true,force:true});}
});
