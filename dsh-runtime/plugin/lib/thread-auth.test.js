import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authConfig, serverOrigin, browserSignInUrl, desktopSignIn } from './thread-auth.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ThreadClient } from './thread-client.js';
import { composioConnectionError } from '../client/thread-integrations.js';

test('an unsupported Composio route does not ask a valid account to sign in again',async()=>{
  const denied=Object.assign(Error('Sign in required'),{status:401});
  const unsupported=await composioConnectionError(denied,async action=>{assert.equal(action,'organizations');return {organizations:[]};});
  assert.equal(unsupported.status,424);assert.match(unsupported.message,/signed in.*Server does not support/);
  assert.equal(await composioConnectionError(denied,async()=>{throw denied;}),denied);
  const unavailable=Object.assign(Error('Unavailable'),{status:503});
  assert.equal(await composioConnectionError(unavailable,()=>assert.fail('Only authentication errors need verification')),unavailable);
});

test('rejected device credentials require sign-in even with a saved user, and re-enrollment restores access',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-expired-account-')),client=new ThreadClient(root),original=globalThis.fetch;
  const directory=client.directory,user={id:'alice',email:'alice@example.com'};
  directory.token='expired';directory.user=user;
  try{
    globalThis.fetch=async()=>Response.json({error:{message:'Sign in required'}},{status:401});
    await assert.rejects(directory.request('/composio/toolkits'),{status:401});
    assert.equal((await client.snapshot()).signedIn,true,'An unsupported app route must not sign out a valid account');
    await assert.rejects(directory.request('/organizations'),{status:401});
    assert.equal((await client.snapshot()).signedIn,false);assert.equal((await client.snapshot()).user.id,'alice');
    globalThis.fetch=async url=>Response.json(new URL(url).pathname==='/api/me'?{user}:{token:'renewed'});
    await directory.resume('session','certificate',[]);
    assert.equal((await client.snapshot()).signedIn,true);
    let finish;globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
    const stale=directory.request('/organizations');directory.token='newer';
    finish(Response.json({error:{message:'Sign in required'}},{status:401}));
    await assert.rejects(stale,{status:401});assert.equal((await client.snapshot()).signedIn,true);
  }finally{globalThis.fetch=original;client.store.close();rmSync(root,{recursive:true,force:true});}
});

test('sign-in validates the server and routes Google, GitHub and company SSO',()=>{
  assert.equal(serverOrigin('https://bees.example/'),'https://bees.example');
  for(const url of ['http://evil.example','https://user:pass@bees.example','https://bees.example/path','https://bees.example/?next=elsewhere'])assert.throws(()=>serverOrigin(url));
  for(const provider of ['google','github']){
    const url=new URL(browserSignInUrl('https://bees.example',{provider},'http://127.0.0.1/callback'));
    assert.equal(url.pathname,'/api/auth/desktop/start');assert.equal(url.searchParams.get('provider'),provider);
  }
  const sso=new URL(browserSignInUrl('https://bees.example',{provider:'sso',email:'person@company.example'},'http://127.0.0.1/callback'));
  assert.equal(sso.pathname,'/api/auth/desktop/sso/start');assert.equal(sso.searchParams.get('email'),'person@company.example');
  assert.throws(()=>browserSignInUrl('https://bees.example',{provider:'sso',email:''},''),/work email/);
  assert.throws(()=>browserSignInUrl('https://bees.example',{provider:'unknown'},''),/Unknown/);
});

test('desktop handoff accepts only its callback and returns provider errors or cancellation',async()=>{
  let enrolled=false;
  const attempt=await desktopSignIn('https://bees.example',{provider:'google'},async token=>{assert.equal(token,'verified-session');enrolled=true;return {id:'alice'};});
  try{
    assert.equal(attempt.result,undefined);
    const redirect=new URL(new URL(attempt.url).searchParams.get('redirect'));
    assert.equal(redirect.hostname,'127.0.0.1');
    assert.equal((await fetch(new URL('/wrong?token=attacker',redirect))).status,404);
    assert.equal((await fetch(redirect)).status,400);
    redirect.searchParams.set('token','verified-session');
    const response=await fetch(redirect);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(enrolled,true);assert.match(await response.text(),/^Signed in\./);
    assert.deepEqual(await attempt.session,{user:{id:'alice'}});
    assert.deepEqual(attempt.result,{user:{id:'alice'}});
  }finally{attempt.close();}
  const failed=await desktopSignIn('https://bees.example',{provider:'github'},()=>assert.fail('Provider error must not enroll'));
  try{
    const redirect=new URL(new URL(failed.url).searchParams.get('redirect'));redirect.searchParams.set('error','Access denied');
    const response=await fetch(redirect);assert.equal(response.status,400);assert.match(await response.text(),/Access denied/);
    assert.deepEqual(await failed.session,{error:'Access denied'});
  }finally{failed.close();}
  const cancelled=await desktopSignIn('https://bees.example',{provider:'google'},()=>assert.fail('Cancelled'));cancelled.close();
  assert.match((await cancelled.session).error,/cancelled/);
});

test('a received Google token is not reported as signed in when client enrollment fails',async()=>{
  const failed=await desktopSignIn('https://bees.example',{provider:'google'},async()=>{throw Object.assign(Error('Client enrollment failed'),{status:409});});
  try{
    const redirect=new URL(new URL(failed.url).searchParams.get('redirect'));redirect.searchParams.set('token','verified-session');
    const response=await fetch(redirect);assert.equal(response.status,409);
    assert.equal(await response.text(),'Bees could not finish signing in: Client enrollment failed');
    assert.deepEqual(await failed.session,{error:'Client enrollment failed'});
  }finally{failed.close();}
});

test('unreachable sign-in servers show the address and how to fix it',async()=>{
  const original=globalThis.fetch;
  try{
    for(const failure of [new TypeError('fetch failed'),new DOMException('The operation timed out','TimeoutError')]){
      globalThis.fetch=async()=>{throw failure;};
      await assert.rejects(authConfig('https://missing.example/'),{
        status:503,
        message:'Could not reach the server at https://missing.example. Check the server URL and your internet connection. The Bees server is at https://app.bees.bot.'
      });
    }
    globalThis.fetch=()=>assert.fail('Invalid server URLs must not be contacted');
    await assert.rejects(authConfig('http://evil.example'),/Use an HTTPS Bees Server/);
  }finally{globalThis.fetch=original;}
});

test('sign-in explains server outages separately from an unreachable address',async()=>{
  const original=globalThis.fetch;
  try{
    for(const status of [500,502,503,504]){
      globalThis.fetch=async()=>new Response('<html>Service Temporarily Unavailable</html>',{status});
      await assert.rejects(authConfig('https://app.bees.bot'),{
        status,
        message:'The Bees server at https://app.bees.bot is temporarily unavailable. Please try again in a few minutes.'
      });
    }
    globalThis.fetch=async()=>new Response('',{status:404});
    await assert.rejects(authConfig('https://bees.example'),{
      status:404,
      message:'Could not load sign-in options from https://bees.example (HTTP 404). Check the server URL or contact your server administrator.'
    });
  }finally{globalThis.fetch=original;}
});

test('the client rejects the older server API before opening a provider or sending credentials',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({socialProviders:['google','github'],ssoEnabled:true}));
  try{await assert.rejects(authConfig('https://bees.example'),/Server needs an update/);}
  finally{globalThis.fetch=original;}
});
