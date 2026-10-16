import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const base='data:text/javascript,'+encodeURIComponent('export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env}}');
const source=(await readFile(new URL('./machines.mjs',import.meta.url),'utf8')).replace("'cloudflare:workers'",JSON.stringify(base));
const {default:worker,BeesMachine}=await import('data:text/javascript,'+encodeURIComponent(source));
test('managed machines require operator authorization and use a fixed entrypoint with one-time enrollment',async()=>{
 let starts=0,stops=0,timeouts=0;const container={running:false,start(options){starts++;assert.deepEqual(options.entrypoint,['node','dsh-runtime/runner-cloud.mjs']);assert.equal(options.env.BEES_PAIR_CODE,'p'.repeat(43));this.running=true;},async destroy(){stops++;this.running=false;},async setInactivityTimeout(ms){assert.equal(ms,21600000);timeouts++;},async monitor(){}};
 const machine=new BeesMachine({container,waitUntil(){},blockConcurrencyWhile:f=>f()},{BEES_CONTROL_PLANE_URL:'https://bees.example'});
 const env={BEES_MANAGER_TOKEN:'a'.repeat(43),MACHINES:{getByName:id=>{assert.equal(id,'00000000-0000-4000-a000-000000000000');return machine;}}};
 const request=(action,token=env.BEES_MANAGER_TOKEN)=>new Request('https://manager.example/machines/00000000-0000-4000-a000-000000000000',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({action,code:'p'.repeat(43)})});
 assert.equal((await worker.fetch(request('start','bad'),env)).status,401);assert.equal(starts,0);
 assert.equal((await worker.fetch(request('start'),env)).status,200);await worker.fetch(request('start'),env);assert.equal(starts,1);
 assert.deepEqual(await(await worker.fetch(request('status'),env)).json(),{running:true});assert.equal(timeouts,2);
 await worker.fetch(request('stop'),env);assert.equal(stops,1);
});
