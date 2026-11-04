import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { threadError } from './thread-store.js';
import {tokenSavingsContext,withTokenSavings} from './thread-token-savings.js';

const prefix='bees-credits-';
export const isAccountAIProvider=provider=>provider.startsWith(prefix)||provider.startsWith('bees-free-');

export function creditsAdapter(provider,ai,baseUrl,resolveApiKey){
  const base=openrouterProvider();
  const models=(ai.models??[ai.model]).map(model=>({...model,provider,api:'openai-completions',baseUrl,input:['text'],reasoning:model.reasoning??true,
    thinkingLevelMap:{minimal:'minimal',low:'low',medium:'medium',high:'high',xhigh:'xhigh',max:'max'},
    cost:model.pricing??{input:1,output:1,cacheRead:1,cacheWrite:1},compat:{supportsDeveloperRole:false,thinkingFormat:'openrouter'}}));
  const profiles=new Map([[provider,{provider,displayName:'Bees Credits',streamIdleTimeoutMs:300000,
    reasoning:ai.reasoningEffort==='none'?'off':ai.reasoningEffort||undefined,
    configuredMaxTokens:new Map(models.map(model=>[model.id,model.maxTokens])),modelErrors:new Map(),
    headers:ai.organizationId?{'X-Bees-Organization':ai.organizationId}:{},
    piProvider:{...base,id:provider,name:'Bees Credits',baseUrl,getModels:()=>models,
      streamSimple:(model,context,options)=>base.streamSimple(model,context,{...options,headers:{...options.headers,
        ...(tokenSavingsContext.getStore()?{'X-Bees-Optimization':JSON.stringify(tokenSavingsContext.getStore())}:{})}})}}]]);
  return new PiAiAdapter({profiles:()=>profiles,resolveApiKey});
}

export class ThreadCredits {
  constructor(ctx){this.ctx=ctx;this.accounts=new Map();this.sessions=new Map();
    ctx.on('llm/stream',(options,next)=>{
      const session=this.sessions.get(options.sessionId);
      return session&&isAccountAIProvider(options.provider)?withTokenSavings(options,next,session):next();
    });
  }
  scope(store,organizationId){return organizationId===undefined?store.preference('settings')?.selectedOrganizationId??null:organizationId;}
  entry(store,organizationId){return this.accounts.get(store)?.get(this.scope(store,organizationId)??'personal');}
  async sync(client,force=false,organizationId){
    const {directory,store}=client;
    if(!directory.token||!directory.user||client.closing)return;
    organizationId=this.scope(store,organizationId);
    if(organizationId&&client.organizations?.().some(org=>org.id===organizationId&&org.local))return;
    const scope=organizationId??'personal',owner=directory.url+'\n'+directory.user.id;
    let scopes=this.accounts.get(store);
    if(scopes&&[...scopes.values()].some(entry=>entry.owner!==owner)){this.close(client);scopes=undefined;}
    if(!scopes){scopes=new Map();this.accounts.set(store,scopes);}
    let entry=scopes.get(scope);
    if(entry?.pending)return entry.pending;
    if(!force&&entry?.retryAt>Date.now())return;
    entry??={owner,client,provider:prefix+store.clientId+(organizationId?'-'+organizationId:'')};scopes.set(scope,entry);
    const token=directory.token;
    entry.pending=(async()=>{
      try{
        const {ai}=await directory.request('/ai',organizationId?{organizationId}:{});
        if(client.closing||directory.token!==token||this.entry(store,organizationId)!==entry)return;
        if(!ai){entry.dispose?.();entry.dispose=undefined;entry.ai=undefined;entry.message='';return;}
        const validModel=model=>typeof model?.id==='string'&&typeof model.name==='string'&&Number.isSafeInteger(model.contextWindow)&&model.contextWindow>0&&Number.isSafeInteger(model.maxTokens)&&model.maxTokens>0&&model.maxTokens<=model.contextWindow;
        if(ai.kind!=='credits'||typeof ai.available!=='boolean'||typeof ai.credits?.balance!=='number'||!Number.isFinite(ai.credits.balance)||ai.credits.balance<0||
           !validModel(ai.model)||ai.models!==undefined&&(!Array.isArray(ai.models)||!ai.models.length||ai.models.some(model=>!validModel(model)))||
           organizationId&&ai.organizationId!==organizationId)
          throw Error('Invalid Bees Credits configuration');
        const changed=JSON.stringify(entry.ai?.models??entry.ai?.model)!==JSON.stringify(ai.models??ai.model)||entry.ai?.available!==ai.available||entry.ai?.reasoningEffort!==ai.reasoningEffort;
        entry.ai=ai;
        if(changed||ai.available&&!entry.dispose){
          entry.dispose?.();entry.dispose=undefined;
          if(ai.available){
            const adapter=creditsAdapter(entry.provider,ai,directory.url+'/api/directory/ai/'+(ai.modelSelection?'v2':'v1'),async()=>{
              if(client.closing||!directory.token||directory.url+'\n'+directory.user?.id!==entry.owner||this.entry(store,organizationId)!==entry)
                throw threadError('Sign in to use Bees Credits');
              return directory.token;
            });
            entry.dispose=this.ctx.llm.registerAdapter([entry.provider],adapter);
          }
        }
        const current=store.preference('model'),models=ai.models??[ai.model];
        if(ai.available&&(current===null||current===store.preference('automaticCreditModel')||current.startsWith('bees-credits/')&&!models.some(model=>'bees-credits/'+model.id===current))){
          store.preference('model','bees-credits/'+ai.model.id);store.preference('automaticCreditModel','bees-credits/'+ai.model.id);
        }
        entry.message=ai.available?'':'Bees Credits AI is not configured on this server yet.';
      }catch(error){
        if(organizationId||error.status===401||error.status===403){entry.dispose?.();entry.dispose=undefined;entry.ai=undefined;}
        if(!entry.dispose)entry.ai=undefined;
        entry.message=error.status===404?'':'Bees Credits are temporarily unavailable. Try again or use your own AI connection.';
      }finally{entry.pending=undefined;entry.retryAt=Date.now()+30000;}
    })();
    await entry.pending;
  }
  models(store){const ai=this.entry(store)?.ai;return ai?.available?(ai.models??[ai.model]).map(model=>({id:'bees-credits/'+model.id,name:model.name,group:model.group,pricing:model.pricing})):[];}
  view(store){const entry=this.entry(store);return {available:!!entry?.ai?.available,message:entry?.message??'',credits:entry?.ai?.credits??null,organizationId:this.scope(store),canManage:entry?.ai?.canManage??!this.scope(store),reasoningEfforts:entry?.ai?.reasoningEfforts??[],defaultReasoningEffort:entry?.ai?.reasoningEffort??'',reasoningEffort:store.preference('creditReasoningEffort')??''};}
  mount(agentCtx,store,organizationId,session){
    if(session)agentCtx.effect(()=>{this.sessions.set(session.id,session);return()=>{if(this.sessions.get(session.id)===session)this.sessions.delete(session.id);};},'Thread token savings');
    agentCtx.on('llm/stream',(options,next)=>{
    if(isAccountAIProvider(options.provider)&&options.provider!==this.entry(store,organizationId)?.provider)throw threadError('Bees Credits belong to another account or organization');
    return next();
  });}
  resolve(store,model,organizationId){
    if(isAccountAIProvider(model?.provider??''))throw threadError('Choose Bees Credits for this account');
    if(model?.provider!=='bees-credits')return model;
    const entry=this.entry(store,organizationId);
    if(!entry?.ai?.available||!entry.client.directory.token||entry.client.closing)throw threadError('Bees Credits are unavailable. Sign in or choose another AI connection.');
    const id=entry.ai.models?model.model:entry.ai.model.id;
    if(entry.ai.models&&!entry.ai.models.some(row=>row.id===id))throw threadError('Choose an available Bees Credits model in Settings.');
    const effort=model.reasoningEffort||store.preference('creditReasoningEffort');
    return {...model,model:id,provider:entry.provider,...(effort?{reasoningEffort:effort==='none'?'off':effort}:{})};
  }
  close(client){const entries=this.accounts.get(client.store);this.accounts.delete(client.store);for(const entry of entries?.values()??[]){entry.dispose?.();entry.ai=undefined;}}
}
