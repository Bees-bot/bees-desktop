import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClientProfiles } from './client-profiles.js';

test('accounts retain separate databases and sign-out does not expose the previous account',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bees-profiles-')),original=globalThis.fetch;
  const reply=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(url).pathname,token=new Headers(init.headers).get('authorization')?.slice(7);
    if(path==='/api/auth/sign-in/email')return new Response(JSON.stringify({token:JSON.parse(init.body).email.split('@')[0]}));
    if(path==='/api/me')return reply({user:{id:token,email:token+'@example.com',emailVerified:true}});
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
    await profiles.logout();assert.equal(profiles.active.store.list().length,0);assert.equal(profiles.active.directory.user,undefined);
    await profiles.login({url:'https://directory.example',email:'bob@example.com',password:'example-password'});
    assert.notEqual(profiles.active.store.clientId,alice);assert.equal(profiles.active.store.list().length,0);
    await profiles.login({url:'https://directory.example',email:'alice@example.com',password:'example-password'});
    assert.equal(profiles.active.store.clientId,alice);assert.equal(profiles.active.store.list().length,1);
  }finally{await profiles.close();globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});
