import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createClientProxy } from './hosted-api.mjs';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
test('hosted worker exposes only its narrow authenticated API and preserves streamed files',async()=>{
 const token='x'.repeat(32),seen=[];
 const runtime=createServer(async(req,res)=>{seen.push(req.url);assert.equal(req.headers.host,'127.0.0.1:'+runtime.address().port);assert.equal(req.headers.authorization,'Bearer '+token);assert.equal(req.headers.cookie,undefined);const chunks=[];for await(const chunk of req)chunks.push(chunk);res.end(req.method==='POST'?Buffer.concat(chunks):'private file');});
 const port=await listen(runtime),proxy=createClientProxy({port,token}),url='http://127.0.0.1:'+await listen(proxy);
 try{
  assert.equal((await fetch(url+'/healthz')).status,200);
  assert.equal((await fetch(url+'/bees-api/threads')).status,401);
  const headers={authorization:'Bearer '+token,cookie:'must-not-forward=1'};
  assert.equal((await fetch(url+'/api/shell',{headers})).status,404);
  assert.equal((await fetch(url+'/bees-api/threads',{headers:{...headers,origin:'https://attacker.test'}})).status,401);
  assert.equal(await (await fetch(url+'/bees-api/thread-file?thread=example',{headers})).text(),'private file');
  assert.equal(await (await fetch(url+'/bees-api/threads',{method:'POST',headers,body:'{"action":"read"}'})).text(),'{"action":"read"}');
  assert.deepEqual(seen,['/healthz','/bees-api/thread-file?thread=example','/bees-api/threads']);
 }finally{await close(proxy);await close(runtime);}
});
