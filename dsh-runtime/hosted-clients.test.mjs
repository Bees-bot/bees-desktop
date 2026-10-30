import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHostedGateway} from './hosted-clients.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject).listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port));});
const close=server=>new Promise(r=>{server.closeAllConnections();server.close(r);});
test('hosted releases invalidate browser assets and missing assets return 404',async()=>{
 const assets=await mkdtemp(join(tmpdir(),'bees-hosted-assets-'));const servers=[];
 try{
  const versions=[];
  for(const bundle of ['first release','second release']){
   await writeFile(join(assets,'app.js'),bundle);
   const gateway=createHostedGateway({directoryUrl:'https://directory.test',assets,provision:()=>{throw Error('Unexpected provisioning');}});servers.push(gateway);const url=await listen(gateway);
   const html=await fetch(url+'/app/');assert.equal(html.headers.get('cache-control'),'no-store');
   const script=(await html.text()).match(/src="([^"]+)"/)[1];versions.push(script);
   const response=await fetch(url+script);assert.equal(await response.text(),bundle);assert.equal(response.headers.get('cache-control'),'no-cache');
   assert.equal((await fetch(url+'/app/assets/missing.js')).status,404);
  }
  assert.notEqual(versions[0],versions[1]);
 }finally{await Promise.all(servers.map(close));await rm(assets,{recursive:true,force:true});}
});
test('hosted gateway authenticates each request and routes only to the matching account client',async()=>{
 const servers=[];const directory=createServer(async(req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/api/me'){const user=String(req.headers.authorization??'').slice(7);if(!['alice','bob'].includes(user)){res.statusCode=401;return res.end('{}');}return res.end(JSON.stringify({user:{id:user,email:user+'@example.com'}}));}if(req.url==='/api/auth/sign-in/email'){const chunks=[];for await(const c of req)chunks.push(c);return res.end(JSON.stringify({token:JSON.parse(Buffer.concat(chunks)).email.split('@')[0]}));}res.statusCode=404;res.end('{}');});servers.push(directory);
 try{
  const directoryUrl=await listen(directory),clients={};
  for(const user of ['alice','bob']){const server=createServer((req,res)=>{res.setHeader('content-type','application/json');assert.equal(req.headers.authorization,'Bearer private-'+user);res.end(JSON.stringify({account:user,path:req.url}));});servers.push(server);clients[user]={url:await listen(server),token:'private-'+user};}
  const calls=[];const gateway=createHostedGateway({directoryUrl,assets:'/unused',provision:async(user,session)=>{calls.push([user.id,session]);return clients[user.id];}});servers.push(gateway);const url=await listen(gateway);
  assert.equal((await fetch(url+'/bees-api/threads')).status,401);
  assert.equal((await fetch(url+'/api/credentials',{headers:{cookie:'bees_hosted_session=alice'}})).status,404);
  assert.equal((await fetch(url+'/bees-api/threads',{method:'POST',headers:{origin:'https://attacker.example','content-type':'application/json'},body:'{}'})).status,403);
  for(const user of ['alice','bob']){
   const login=await fetch(url+'/bees-api/threads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'login',url:'https://attacker.example',email:user+'@example.com',password:'fixture'})});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly/);
   const r=await fetch(url+'/bees-api/threads',{headers:{cookie:login.headers.getSetCookie().find(value=>value.startsWith('bees_hosted_session=')).split(';')[0]}});assert.equal((await r.json()).account,user);
  }
  assert.deepEqual(calls.map(([u,s])=>[u,s]),[['alice','alice'],['alice','alice'],['bob','bob'],['bob','bob']]);
  const start=await fetch(url+'/bees-api/threads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'startLogin',provider:'google',state:'01234567-0123-4123-8123-0123456789ab',url:'https://attacker.example'})});
  const authorization=new URL((await start.json()).url);assert.equal(authorization.origin,directoryUrl);assert.equal(authorization.searchParams.get('provider'),'google');
  const redirect=new URL(authorization.searchParams.get('redirect'));assert.equal(redirect.origin,url);assert.equal(redirect.pathname,'/bees-auth/finish');
  const finish=await fetch(redirect);const html=await finish.text();assert.match(html,/<p role="status">Signing in…/);assert.match(html,/BroadcastChannel/);assert.match(html,/history.replaceState/);assert.doesNotThrow(()=>new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const social=await fetch(url+'/bees-api/threads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'login',session:'alice'})});
  assert.equal(social.status,200);assert.match(social.headers.get('set-cookie'),/bees_hosted_session=alice/);
  const rejected=await fetch(url+'/bees-api/threads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'login',session:'revoked'})});
  assert.equal(rejected.status,401);assert.equal(rejected.headers.get('set-cookie'),null);
  assert.equal((await fetch(url+'/bees-api/threads',{headers:{cookie:'bees_hosted_session=revoked'}})).status,401);
 }finally{await Promise.all(servers.map(close));}
});

test('one browser retains all accounts and organizations while commands and sign-out stay account scoped',async()=>{
 const servers=[],revoked=new Set(),unavailable=new Set(),commands=[],provisioned=new Set(),stopped=[];let creditsUnavailable=false,stopFailed=false,creditOverride;
 const directory=createServer((req,res)=>{
  const token=String(req.headers.authorization??'').slice(7);
  res.setHeader('content-type','application/json');
  if(!['alice','bob'].includes(token)||revoked.has(token)){res.statusCode=401;return res.end('{}');}
  if(req.url==='/api/directory/credits'){
   if(creditsUnavailable){res.statusCode=503;return res.end('{}');}
   return res.end(JSON.stringify({credits:creditOverride===undefined?{balance:token==='alice'?0:100,heldTokens:0,autoRenew:false,paymentPending:false}:creditOverride}));
  }
  if(req.url!=='/api/me'){res.statusCode=404;return res.end('{}');}
  res.end(JSON.stringify({user:{id:token,email:token+'@example.com'}}));
 });servers.push(directory);
 try{
  const directoryUrl=await listen(directory),clients={},jar=new Map();
  for(const user of ['alice','bob']){
   const worker=createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,'Bearer private-'+user);
    res.setHeader('content-type','application/json');
    if(unavailable.has(user)){res.statusCode=503;return res.end('{}');}
    if(req.method==='POST'){
     const chunks=[];for await(const chunk of req)chunks.push(chunk);
     const input=JSON.parse(Buffer.concat(chunks));commands.push({user,...input});
     if(input.action==='selectOrganization'&&input.organizationId!==user+'-org'){res.statusCode=403;return res.end(JSON.stringify({error:'Organization membership required'}));}
     return res.end(JSON.stringify({ok:true}));
    }
    res.end(JSON.stringify({user:{id:user},threads:[{id:user+'-thread'}],organizations:[{id:user+'-org',name:'Studio',appearance:{icon:'star'}}],settings:{}}));
   });servers.push(worker);clients[user]={url:await listen(worker),token:'private-'+user};
  }
  const provision=async user=>{provisioned.add(user.id);return clients[user.id];};
  provision.stop=async user=>{if(stopFailed)throw Error('Stop failed');stopped.push(user.id);provisioned.delete(user.id);};
  let gateway=createHostedGateway({directoryUrl,assets:'/unused',provision});servers.push(gateway);let url=await listen(gateway);
  const request=async(input,path='/bees-api/threads')=>{
   const response=await fetch(url+path,{headers:{cookie:[...jar].map(([key,value])=>key+'='+value).join('; '),...(input?{'content-type':'application/json'}:{})},...(input?{method:'POST',body:JSON.stringify(input)}:{})});
   for(const line of response.headers.getSetCookie()){
    assert.match(line,/HttpOnly; SameSite=Lax; Path=\//);
    const [name,value]=line.split(';')[0].split('=');if(value)jar.set(name,value);else jar.delete(name);
   }
   return {status:response.status,value:await response.json()};
  };
  // An existing browser cookie upgrades without requiring another login.
  jar.set('bees_hosted_session','alice');
  assert.equal((await request({action:'login',session:'bob'})).status,200);
  let result=await request();assert.equal(result.status,200);
  let accounts=result.value.accounts;assert.equal(accounts.length,2);
  const alice=accounts.find(account=>account.user.id==='alice'),bob=accounts.find(account=>account.user.id==='bob');
  assert.equal(bob.active,true);assert.equal(alice.active,false);
  assert.deepEqual(accounts.map(account=>account.organizations[0].id),['alice-org','bob-org']);
  assert.equal(alice.organizations[0].appearance.icon,'star');
  assert.deepEqual(result.value.threads,[{id:'bob-thread'}]);
  assert.deepEqual([...provisioned].sort(),['alice','bob']);
  assert(!JSON.stringify(accounts).includes('private-'));assert(accounts.every(account=>!('token' in account)));
  assert.equal((await request({action:'switchAccount',accountId:'unknown'})).status,401);
  // Renaming a cookie cannot substitute another user's credentials for an account.
  const aliceCookie='bees_hosted_account_'+alice.id;
  jar.set(aliceCookie,'bob');assert.equal((await request({action:'switchAccount',accountId:alice.id})).status,401);jar.set(aliceCookie,'alice');
  assert.equal((await request({action:'selectOrganization',accountId:alice.id,organizationId:'bob-org'})).status,403);
  assert.equal(jar.get('bees_hosted_session'),'bob','Failed selection keeps the prior view');
  assert.equal((await request({action:'selectOrganization',accountId:alice.id,organizationId:'alice-org'})).status,200);
  assert.deepEqual(commands.at(-1),{user:'alice',action:'selectOrganization',accountId:null,organizationId:'alice-org'});
  result=await request();assert.deepEqual(result.value.threads,[{id:'alice-thread'}]);assert.equal(result.value.accounts.length,2);
  unavailable.add('bob');result=await request();assert.equal(result.status,200);assert(result.value.accounts.find(account=>account.id===bob.id).organizationError);unavailable.clear();
  // The gateway holds no in-memory login state; browser cookies restore every account.
  await close(gateway);gateway=createHostedGateway({directoryUrl,assets:'/unused',provision});servers.push(gateway);url=await listen(gateway);
  assert.equal((await request()).value.accounts.length,2);
  creditsUnavailable=true;assert.equal((await request({action:'logout'})).status,503);assert(jar.has(aliceCookie));assert.deepEqual(stopped,[]);creditsUnavailable=false;
  stopFailed=true;assert.equal((await request({action:'logout'})).status,503);assert(jar.has(aliceCookie));stopFailed=false;
  assert.equal((await request({action:'logout',userId:'bob',credits:{balance:100}})).status,200);
  assert.deepEqual(stopped,['alice']);assert(!provisioned.has('alice'));assert(provisioned.has('bob'));
  assert(!jar.has(aliceCookie));result=await request();assert.equal(result.value.user.id,'bob');assert.equal(result.value.accounts.length,1);
  assert.equal((await request({action:'switchAccount',accountId:alice.id})).status,401);
  assert(!commands.some(command=>command.action==='logout'),'Shutdown is handled by the gateway');
  await request({action:'logout'});assert.deepEqual(stopped,['alice'],'Paid account keeps running');
  await request({action:'login',session:'bob'});
  await request({action:'login',session:'alice'});assert(provisioned.has('alice'),'Login restarts the free client');await request({action:'switchAccount',accountId:bob.id});revoked.add('bob');result=await request();assert.equal(result.status,200);assert.equal(result.value.user.id,'alice');assert.equal(result.value.accounts.length,1);
  assert(!jar.has('bees_hosted_account_'+bob.id));
  await request({action:'logout'});assert.equal((await request()).status,401);
  assert.deepEqual(stopped,['alice','alice']);
  for(const status of [{balance:1},{heldTokens:10},{autoRenew:true},{paymentPending:true}]){
   creditOverride={balance:0,heldTokens:0,autoRenew:false,paymentPending:false,...status};
   await request({action:'login',session:'alice'});assert.equal((await request({action:'logout'})).status,200);
   assert.deepEqual(stopped,['alice','alice'],'Purchased, reserved, auto-renewing and pending-payment accounts keep running');
  }
  for(const unknown of [null,{}, {balance:0}]){
   creditOverride=unknown;await request({action:'login',session:'alice'});await request({action:'logout'});
   assert.deepEqual(stopped,['alice','alice'],'Unknown credit status never shuts down a paid client');
  }
 }finally{await Promise.all(servers.map(close));}
});
