import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ThreadCredits, creditsAdapter } from './thread-credits.js';

const model={id:'test/paid-model',name:'Bees Credits',contextWindow:131072,maxTokens:8192};
const configuration=()=>({kind:'credits',available:true,model,credits:{balance:100000}});
function harness(){
 const adapters=new Map();
 const service=new ThreadCredits({llm:{registerAdapter:([id],adapter)=>{assert(!adapters.has(id));adapters.set(id,adapter);return()=>adapters.delete(id);}}});
 const client=name=>({store:{clientId:randomUUID(),preferences:new Map(),preference(key,value){if(arguments.length>1)this.preferences.set(key,value);return this.preferences.get(key)??null;}},directory:{url:'https://bees.test',user:{id:name},token:name,request:async path=>{assert.equal(path,'/ai');return {ai:configuration()};}}});
 return {adapters,service,client};
}
test('desktop and web share a configured model but keep each account bearer token private',async()=>{
 const {service,adapters,client}=harness(),alice=client('alice'),bob=client('bob');
 bob.store.preference('model','own/local-model');
 let calls=0;const request=alice.directory.request;alice.directory.request=async(...args)=>{calls++;return request(...args);};
 await Promise.all([service.sync(alice),service.sync(alice),service.sync(bob)]);
 assert.equal(calls,1);assert.equal(adapters.size,2);assert.equal(alice.store.preference('model'),'bees-credits/'+model.id);assert.equal(bob.store.preference('model'),'own/local-model');
 const a=service.resolve(alice.store,{provider:'bees-credits',model:model.id}),b=service.resolve(bob.store,{provider:'bees-credits',model:model.id});
 assert.notEqual(a.provider,b.provider);assert.equal(await adapters.get(a.provider).config.resolveApiKey(),'alice');
 assert.equal(await adapters.get(b.provider).config.resolveApiKey(),'bob');
 assert(!JSON.stringify(service.view(alice.store)).includes('alice'));
 let guard;service.mount({on:(_event,fn)=>{guard=fn;}},alice.store);
 assert.throws(()=>guard(b,()=>assert.fail()),/another account/);assert.equal(guard(a,()=>true),true);
 assert.throws(()=>service.resolve(alice.store,b),/Choose Bees Credits/);
 const captured=adapters.get(a.provider);alice.directory.url='https://another-bees.test';
 await assert.rejects(captured.config.resolveApiKey(),/Sign in/);
 alice.directory.token=null;service.close(alice);assert.equal(adapters.size,1);await assert.rejects(captured.config.resolveApiKey(),/Sign in/);service.close(bob);
});
test('refreshes the balance and operator model while preserving user-added model selections',async()=>{
 const {service,adapters,client}=harness(),alice=client('alice');await service.sync(alice);
 alice.directory.request=async()=>({ai:{...configuration(),model:{...model,id:'test/new-model'},credits:{balance:123}}});
 await service.sync(alice,true);assert.equal(adapters.size,1);assert.equal(service.view(alice.store).credits.balance,123);
 assert.equal(alice.store.preference('model'),'bees-credits/test/new-model');
 assert.equal(service.resolve(alice.store,{provider:'bees-credits',model:model.id}).model,'test/new-model');service.close(alice);
});
test('accepts a dollar starter allowance with zero purchased tokens and rejects invalid dollar balances',async()=>{
 const {service,adapters,client}=harness(),alice=client('alice');
 for(const starterRemainingUsd of [-1,0.02,NaN,'0.01']){
  alice.directory.request=async()=>({ai:{...configuration(),credits:{balance:0,starterRemainingUsd}}});
  await service.sync(alice,true);assert.equal(adapters.size,0);
 }
 alice.directory.request=async()=>({ai:{...configuration(),credits:{balance:0,starterRemainingUsd:0.009999,starterLimitUsd:0.01}}});
 await service.sync(alice,true);assert.equal(adapters.size,1);assert.equal(service.view(alice.store).credits.starterRemainingUsd,0.009999);
 service.close(alice);
});
test('rejects legacy/untrusted configurations, handles older servers, and cannot reconnect after sign-out',async()=>{
 const {service,adapters,client}=harness(),alice=client('alice');
 alice.directory.request=async()=>{throw Object.assign(Error('private-provider-key'),{status:503});};await service.sync(alice);assert.match(service.view(alice.store).message,/temporarily unavailable/);assert(!service.view(alice.store).message.includes('private'));
 alice.directory.request=async()=>({ai:{...configuration(),kind:'free',apiKey:'provider-key'}});await service.sync(alice,true);assert.equal(adapters.size,0);
 alice.directory.request=async()=>({ai:null});await service.sync(alice,true);assert.equal(service.view(alice.store).available,false);
 let finish;alice.directory.request=()=>new Promise(resolve=>{finish=resolve;});const pending=service.sync(alice,true);service.close(alice);finish({ai:configuration()});await pending;assert.equal(adapters.size,0);
});
test('the real streaming adapter sends tools through the Bees API using only the enrolled client token',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{
  calls.push({url,headers:new Headers(init.headers),body:JSON.parse(init.body)});
  const chunks=[{id:'completion',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'read_file',arguments:'{"path":"notes.txt"}'}}]},finish_reason:null}]},{id:'completion',choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}];
  return new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 };
 try{
  const adapter=creditsAdapter('bees-credits-test',{model},'https://bees.test/api/directory/ai/v1',async()=>'alice-device-token');
  const prepared=await adapter.prepareCall('bees-credits-test',model.id),chunks=[];
  for await(const chunk of prepared.stream({provider:'bees-credits-test',model:model.id,messages:[{role:'user',content:[{type:'text',text:'Read notes'}]}],maxTokens:100}))chunks.push(chunk);
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://bees.test/api/directory/ai/v1/chat/completions');assert.equal(calls[0].headers.get('authorization'),'Bearer alice-device-token');assert.equal(calls[0].body.model,model.id);assert(JSON.stringify(chunks).includes('read_file'));
 }finally{globalThis.fetch=original;}
});
