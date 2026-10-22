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
   const r=await fetch(url+'/bees-api/threads',{headers:{cookie:login.headers.get('set-cookie').split(';')[0]}});assert.equal((await r.json()).account,user);
  }
  assert.deepEqual(calls.map(([u,s])=>[u,s]),[['alice','alice'],['alice','alice'],['bob','bob'],['bob','bob']]);
  const start=await fetch(url+'/bees-api/threads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'startLogin',provider:'google',state:'01234567-0123-4123-8123-0123456789ab',url:'https://attacker.example'})});
  const authorization=new URL((await start.json()).url);assert.equal(authorization.origin,directoryUrl);assert.equal(authorization.searchParams.get('provider'),'google');
  const redirect=new URL(authorization.searchParams.get('redirect'));assert.equal(redirect.origin,url);assert.equal(redirect.pathname,'/bees-auth/finish');
  const finish=await fetch(redirect);const html=await finish.text();assert.match(html,/BroadcastChannel/);assert.match(html,/history.replaceState/);assert.doesNotThrow(()=>new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const social=await fetch(url+'/bees-api/threads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'login',session:'alice'})});
  assert.equal(social.status,200);assert.match(social.headers.get('set-cookie'),/bees_hosted_session=alice/);
  const rejected=await fetch(url+'/bees-api/threads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'login',session:'revoked'})});
  assert.equal(rejected.status,401);assert.equal(rejected.headers.get('set-cookie'),null);
  assert.equal((await fetch(url+'/bees-api/threads',{headers:{cookie:'bees_hosted_session=revoked'}})).status,401);
 }finally{await Promise.all(servers.map(close));}
});
