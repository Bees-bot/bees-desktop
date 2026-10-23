import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ClientProfiles} from './client-profiles.js';

test('first startup offers an explicit choice, local mode needs no account, and the choice survives restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-onboarding-'));let profiles=await new ClientProfiles(root).start();
 try{
  assert.equal((await profiles.snapshot()).onboarding,null);
  await assert.rejects(profiles.command({action:'completeOnboarding',mode:'cloud',name:'Studio'}),/Sign in/);
  assert.equal((await profiles.snapshot()).onboarding,null);
  await profiles.command({action:'completeOnboarding',mode:'local'});
  assert.equal((await profiles.snapshot()).user,null);assert.equal((await profiles.snapshot()).localActive,true);
  await profiles.close();profiles=await new ClientProfiles(root).start();assert.equal((await profiles.snapshot()).onboarding,'local');
  await assert.rejects(profiles.command({action:'completeOnboarding',mode:'invalid'}),/Choose/);
 }finally{await profiles.close();await rm(root,{recursive:true,force:true});}
});

test('existing installs keep their work without a forced first-start migration',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-onboarding-legacy-'));let profiles=await new ClientProfiles(root).start();
 try{
  const draft=await profiles.command({action:'create',title:'Existing draft'});await profiles.close();
  const path=join(root,'accounts.json'),state=JSON.parse(await readFile(path,'utf8'));delete state.onboarding;await writeFile(path,JSON.stringify(state));
  profiles=await new ClientProfiles(root).start();assert.equal((await profiles.snapshot()).onboarding,'existing');assert.equal(profiles.active.store.document(draft.id).title,'Existing draft');
 }finally{await profiles.close();await rm(root,{recursive:true,force:true});}
});

test('cloud onboarding creates an organization after sign-in, while choosing local keeps a signed-in account isolated',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bees-onboarding-cloud-'));const profiles=await new ClientProfiles(root).start();
 const org={id:'11111111-1111-4111-8111-111111111111',name:'Studio',role:'owner'};let created=0;
 try{
  profiles.active.directory.user={id:'alice',email:'alice@example.com',emailVerified:true};profiles.active.directory.token='alice';
  profiles.active.directory.request=async(path,body)=>{assert.equal(path,'/organizations');if(body){created++;return org;}return {organizations:[org],invitations:[]};};
  await profiles.command({action:'completeOnboarding',mode:'cloud',name:org.name});
  assert.equal(created,1);assert.equal((await profiles.snapshot()).onboarding,'cloud');assert.equal(profiles.active.store.preference('settings').selectedOrganizationId,org.id);
  const account=profiles.active;profiles.state.accounts.alice=profiles.state.active;
  await profiles.command({action:'completeOnboarding',mode:'local'});
  assert.notEqual(profiles.active,account);assert.equal(profiles.active.directory.user,undefined);assert.equal(account.directory.token,'alice');
 }finally{await profiles.close();await rm(root,{recursive:true,force:true});}
});
