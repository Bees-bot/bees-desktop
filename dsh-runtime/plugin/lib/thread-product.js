import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { ClientProfiles } from './client-profiles.js';
import { ThreadRunner } from './thread-runner.js';
import { ThreadIntegrations } from './thread-integrations.js';
import { ThreadFolders } from './thread-folders.js';
import { ThreadMemory } from './thread-memory.js';
import { LocalMemory } from './local-memory.js';
import { recoverThreadActivity } from './thread-activity.js';
import { ThreadCredits, isAccountAIProvider } from './thread-credits.js';

const equal=(a,b)=>{const x=Buffer.from(String(a??'')),y=Buffer.from(String(b??''));return x.length===y.length&&x.length>0&&timingSafeEqual(x,y);};
const tokenOf=req=>String(req.headers.authorization??'').replace(/^Bearer\s+/i,'')||String(req.headers.cookie??'').split(';').map(x=>x.trim().split('=')).find(([k])=>k==='bees_dsh')?.[1];
const reply=(res,status,value)=>{const body=JSON.stringify(value);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','content-length':Buffer.byteLength(body)});res.end(body);};
async function body(req){let size=0;const chunks=[];for await(const b of req){size+=b.length;if(size>16_000_000)throw Error('Request is too large');chunks.push(b);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}

export async function applyThreadProduct(ctx,config){
  let folders;
  const token=process.env.BEES_DSH_TOKEN;const root=process.env.BEES_STATE_DIR;if(!token||!root)throw Error('Bees Client launch configuration is missing');
  process.env.BEES_FLEET_JOB='client';
  globalThis.__beesReadFence=workspaceRoot=>({closed:[homedir(),process.env.BEES_HOST_HOME,root,process.env.DSH_HOME,...(folders?.closedRoots()??[])].filter(Boolean),open:[workspaceRoot,tmpdir(),process.env.BEES_RUNTIME_ROOT].filter(Boolean)});
  ctx.effect(()=>ctx.settings.configure({auto:false},ctx.fiber),'Bees Client settings');
  // Install authentication before asynchronous profile startup.
  const allowed=req=>(!req.headers.origin||req.headers.origin===`http://${req.headers.host}`)&&equal(tokenOf(req),token);
  const guard=req=>{const path=new URL(req.url??'/','http://client').pathname;if(!['/bees-auth','/healthz'].includes(path)&&!allowed(req))req.url='/_bees_unauthorized';};
  const guardUpgrade=(req,socket)=>{if(!allowed(req))socket.destroy();};
  ctx.webServer.server.prependListener('request',guard);ctx.webServer.server.prependListener('upgrade',guardUpgrade);
  ctx.effect(()=>()=>{ctx.webServer.server.off('request',guard);ctx.webServer.server.off('upgrade',guardUpgrade);},'Bees Client local authentication');
  const integrations=new ThreadIntegrations(ctx);
  const credits=new ThreadCredits(ctx);
  const models=async store=>{const rows=[];for(const provider of ctx.llm.listProviders().filter(p=>!isAccountAIProvider(p.id)))for(const model of await ctx.llm.listModels(provider.id).catch(()=>[]))rows.push({id:provider.id+'/'+model.id,name:model.name??model.id});return [...rows,...credits.models(store)];};
  folders=new ThreadFolders(join(root,'folders.json'),{privateRoot:root,defaultRoot:process.env.BEES_HOSTED_CLIENT?join(root,'files'):join(process.env.BEES_HOST_HOME||homedir(),'Bees'),hosted:!!process.env.BEES_HOSTED_CLIENT});
  const localMemory=new LocalMemory(ctx.settings,{get:()=>({memoryModel:typeof config.memoryModel?.get==='function'?config.memoryModel.get():config.memoryModel??''}),update:patch=>ctx.settings.update('bees',patch)},join(root,'memory'),ctx.credentials);
  const memory=store=>{const service=new ThreadMemory(store,ctx.credentials);service.local=localMemory;return service;};
  const agentPresets=async()=>(await ctx.agentPresets.list()).filter(preset=>!preset.broken).map(({id,name})=>({id,name}));
  const runner=new ThreadRunner(ctx,integrations,models,folders,credits);
  const profiles=await new ClientProfiles(join(root,'client-v3'),{models,credits,integrations,folders,memory,agentPresets,recoverActivity:(store,thread)=>recoverThreadActivity(ctx,store,thread),execute:options=>runner.execute(options),pending:id=>runner.pending.get(id),answer:(id,input)=>runner.answer(id,input)}).start();
  const client=()=>profiles.active;
  ctx.effect(()=>async()=>{await profiles.close();await localMemory.close();},'Bees Client shutdown');
  ctx.effect(()=>()=>integrations.close(),'Bees integrations shutdown');
  const register=(path,handler)=>ctx.effect(()=>ctx.webServer.register({kind:'exact',path,handler}),'Bees Client '+path);
  register('/_bees_unauthorized',(_req,res)=>reply(res,401,{error:'Open Bees Client again to reconnect.'}));
  register('/healthz',(_req,res)=>reply(res,200,{status:'ok',product:'bees',service:'bees-client',clientId:client().store.clientId}));
  register('/bees-api/snapshot',apiSnapshot);
  async function apiSnapshot(_req,res){try{reply(res,200,await profiles.snapshot());}catch(e){reply(res,400,{error:e.message});}}
  register('/bees-api/active-runs',(_req,res)=>{const count=[...profiles.clients.values()].reduce((n,c)=>n+c.jobs.size,0);reply(res,200,count);});
  register('/bees-auth',async(req,res)=>{
    const offered=new URL(req.url,'http://client').searchParams.get('token');if(!equal(offered,token))return reply(res,401,{error:'Unauthorized'});
    const base=`http://127.0.0.1:${req.socket.localPort}`;const url=ctx.connection.authenticatedUrl(base);
    const response=await fetch(url,{headers:{authorization:`Bearer ${token}`},redirect:'manual',signal:AbortSignal.timeout(5000)});
    res.writeHead(302,{location:response.headers.get('location')??base+'/', 'set-cookie':[`bees_dsh=${token}; HttpOnly; SameSite=Lax; Path=/`,...response.headers.getSetCookie()]});res.end();
  });
  const api=handler=>async(req,res)=>{try{reply(res,200,await handler(req));}catch(e){reply(res,e.status??400,{error:e.message});}};
  register('/bees-api/threads',api(async req=>{
    if(req.method==='GET')return await profiles.snapshot();if(req.method!=='POST')throw Error('Method not allowed');
    const input=await body(req);
    return profiles.command(input);
  }));
  register('/bees-api/thread-file',async(req,res)=>{try{const q=new URL(req.url,'http://client').searchParams;const doc=client().store.document(q.get('thread'));const {artifact,bytes}=client().store.object(doc,q.get('artifact'));res.writeHead(200,{'content-type':'application/octet-stream','content-length':bytes.length,'x-content-type-options':'nosniff','content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`});res.end(bytes);}catch(e){reply(res,e.status??400,{error:e.message});}});
  return profiles;
}
