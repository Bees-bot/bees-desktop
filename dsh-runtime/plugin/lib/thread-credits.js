import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { threadError } from './thread-store.js';

const prefix='bees-credits-';
export const isAccountAIProvider=provider=>provider.startsWith(prefix)||provider.startsWith('bees-free-');

export function creditsAdapter(provider,ai,baseUrl,resolveApiKey){
  const base=openrouterProvider();
  const model={...ai.model,provider,api:'openai-completions',baseUrl,input:['text'],reasoning:true,
    cost:{input:1,output:1,cacheRead:1,cacheWrite:1},compat:{supportsDeveloperRole:false,thinkingFormat:'openrouter'}};
  const profiles=new Map([[provider,{provider,displayName:'Bees Credits',streamIdleTimeoutMs:300000,
    configuredMaxTokens:new Map([[model.id,model.maxTokens]]),modelErrors:new Map(),
    piProvider:{...base,id:provider,name:'Bees Credits',baseUrl,getModels:()=>[model]}}]]);
  return new PiAiAdapter({profiles:()=>profiles,resolveApiKey});
}

export class ThreadCredits {
  constructor(ctx){this.ctx=ctx;this.accounts=new Map();}
  async sync(client,force=false){
    const {directory,store}=client;
    if(!directory.token||!directory.user||client.closing)return;
    const owner=directory.url+'\n'+directory.user.id;
    let entry=this.accounts.get(store);
    if(entry&&entry.owner!==owner){this.close(client);entry=undefined;}
    if(entry?.pending)return entry.pending;
    if(!force&&entry?.retryAt>Date.now())return;
    entry??={owner,client,provider:prefix+store.clientId};this.accounts.set(store,entry);
    const token=directory.token;
    entry.pending=(async()=>{
      try{
        const {ai}=await directory.request('/ai',{});
        if(client.closing||directory.token!==token||this.accounts.get(store)!==entry)return;
        if(!ai){entry.dispose?.();entry.dispose=undefined;entry.ai=undefined;entry.message='';return;}
        if(ai.kind!=='credits'||typeof ai.available!=='boolean'||!Number.isSafeInteger(ai.credits?.balance)||ai.credits.balance<0||
           ai.credits.starterRemainingUsd!=null&&(typeof ai.credits.starterRemainingUsd!=='number'||!Number.isFinite(ai.credits.starterRemainingUsd)||ai.credits.starterRemainingUsd<0||ai.credits.starterRemainingUsd>0.01)||
           typeof ai.model?.id!=='string'||typeof ai.model.name!=='string'||!Number.isSafeInteger(ai.model.contextWindow)||ai.model.contextWindow<=0||
           !Number.isSafeInteger(ai.model.maxTokens)||ai.model.maxTokens<=0||ai.model.maxTokens>ai.model.contextWindow)
          throw Error('Invalid Bees Credits configuration');
        const changed=entry.ai?.model.id!==ai.model.id||entry.ai?.available!==ai.available;
        entry.ai=ai;
        if(changed||ai.available&&!entry.dispose){
          entry.dispose?.();entry.dispose=undefined;
          if(ai.available){
            const adapter=creditsAdapter(entry.provider,ai,directory.url+'/api/directory/ai/v1',async()=>{
              if(client.closing||!directory.token||directory.url+'\n'+directory.user?.id!==entry.owner||this.accounts.get(store)!==entry)
                throw threadError('Sign in to use Bees Credits');
              return directory.token;
            });
            entry.dispose=this.ctx.llm.registerAdapter([entry.provider],adapter);
          }
        }
        const current=store.preference('model');
        if(ai.available&&(current===null||current.startsWith('bees-credits/')))store.preference('model','bees-credits/'+ai.model.id);
        entry.message=ai.available?'':'Bees Credits AI is not configured on this server yet.';
      }catch(error){
        if(!entry.dispose)entry.ai=undefined;
        entry.message=error.status===404?'':'Bees Credits are temporarily unavailable. Try again or use your own AI connection.';
      }finally{entry.pending=undefined;entry.retryAt=Date.now()+30000;}
    })();
    await entry.pending;
  }
  models(store){const ai=this.accounts.get(store)?.ai;return ai?.available?[{id:'bees-credits/'+ai.model.id,name:ai.model.name}]:[];}
  view(store){const entry=this.accounts.get(store);return {available:!!entry?.ai?.available,message:entry?.message??'',credits:entry?.ai?.credits??null};}
  mount(agentCtx,store){agentCtx.on('llm/stream',(options,next)=>{
    if(isAccountAIProvider(options.provider)&&options.provider!==this.accounts.get(store)?.provider)throw threadError('Bees Credits belong to another account');
    return next();
  });}
  resolve(store,model){
    if(isAccountAIProvider(model?.provider??''))throw threadError('Choose Bees Credits for this account');
    if(model?.provider!=='bees-credits')return model;
    const entry=this.accounts.get(store);
    if(!entry?.ai?.available||!entry.client.directory.token||entry.client.closing)throw threadError('Bees Credits are unavailable. Sign in or choose another AI connection.');
    return {...model,model:entry.ai.model.id,provider:entry.provider};
  }
  close(client){const entry=this.accounts.get(client.store);this.accounts.delete(client.store);entry?.dispose?.();if(entry)entry.ai=undefined;}
}
