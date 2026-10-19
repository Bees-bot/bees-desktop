import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClientProfiles } from './client-profiles.js';

test('accounts retain separate databases and sign-out does not expose the previous account',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bees-profiles-')),original=globalThis.fetch;
  let legacy=false,emailRequests=0;
  const reply=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url).pathname,token=new Headers(init.headers).get('authorization')?.slice(7);
    if(path==='/api/config')return reply({...(legacy?{}:{architecture:'client-owned-threads'}),socialProviders:['google','github'],ssoEnabled:true});
    if(path==='/api/auth/sign-in/email'){emailRequests++;return new Response(JSON.stringify({token:JSON.parse(init.body).email.split('@')[0]}));}
    if(path==='/api/me')return ['alice','bob'].includes(token)?reply({user:{id:token,email:token+'@example.com',emailVerified:true}}):new Response('{}',{status:401});
    if(path==='/api/directory/clients')return reply({token});
    if(path==='/api/directory/heartbeat')return reply({ok:true});
    if(path==='/api/directory')return reply({threads:[],clients:[],participants:[],invitations:[]});
    if(path==='/api/directory/incoming')return reply([]);
    throw Error('Unexpected request '+path);
  };
  const profiles=new ClientProfiles(root);
  try{
    await profiles.start();const local=await profiles.command({action:'create',title:'Personal draft'});
    await profiles.login({url:'https://directory.example',email:'alice@example.com',password:'example-password'});
    const alice=profiles.active.store.clientId;assert.equal(profiles.active.store.document(local.id).title,'Personal draft');
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
    legacy=true;const before=emailRequests;
    await assert.rejects(profiles.command({action:'startLogin',url:'https://directory.example',provider:'google'}),/Server needs an update/);
    await assert.rejects(profiles.login({url:'https://directory.example',email:'alice@example.com',password:'example-password'}),/Server needs an update/);
    assert.equal(emailRequests,before);assert.equal(profiles.active.store.clientId,alice);
  }finally{await profiles.close();globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});
