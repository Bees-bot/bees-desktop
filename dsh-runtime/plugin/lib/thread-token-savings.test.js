import {test} from 'node:test';
import assert from 'node:assert/strict';
import {markAgentLoopRequest} from '@deepseek-ai/dsh-llm';
import {Context} from '@deepseek-ai/cordis';
import {ThreadCredits} from './thread-credits.js';
import {contextTokensAvoided,tokenSavingsContext,withTokenSavings} from './thread-token-savings.js';

function fixture(){
  const events=[],session={snapshotEvents:()=>events,deriveEventMessage:event=>event.data.message};
  const replace=(type,before,text,start=0,end=0)=>events.push(
    {type,data:{shadowedRange:{start,end},shadowedTokenCount:before}},
    {type:'user/message',surfaceOp:{op:'replace',startSeq:start,endSeq:end},data:{message:{role:'user',content:[{type:'text',text}]}}}
  );
  return {session,events,replace};
}

test('counts nested pruning and compaction reductions once, and reuses the reduction on later requests',()=>{
  const {session,events,replace}=fixture();
  assert.equal(contextTokensAvoided(session),0);
  replace('compaction/prune',100,'12345678');
  assert.equal(contextTokensAvoided(session),90);assert.equal(contextTokensAvoided(session),90);
  replace('compaction/summary',210,'123456789012',0,3);
  assert.equal(contextTokensAvoided(session),289);
  events.push({type:'compaction/prune',data:{shadowedRange:{start:4,end:4},shadowedTokenCount:1000}});
  assert.equal(contextTokensAvoided(session),289);
  events.push({type:'tool/result',surfaceOp:{op:'replace',startSeq:4,endSeq:4},data:{message:{role:'tool',content:[{type:'text',text:'12345678'}]}}});
  assert.equal(contextTokensAvoided(session),1279);
  events.push({type:'compaction/prune',data:{shadowedRange:{start:4,end:4},shadowedTokenCount:1000}},{type:'turn/end'});
  assert.equal(contextTokensAvoided(session),1279);
});

test('keeps concurrent request measurements isolated and identifies summarization overhead',async()=>{
  const {session,replace}=fixture();replace('compaction/prune',100,'12345678');
  const request=markAgentLoopRequest({}),reports=[];
  const next=()=> (async function*(){await new Promise(resolve=>setImmediate(resolve));reports.push(tokenSavingsContext.getStore());yield 'chunk';})();
  const consume=async options=>{const chunks=[];for await(const chunk of withTokenSavings(options,next,session))chunks.push(chunk);return chunks;};
  assert.deepEqual(await Promise.all([consume(request),consume({purpose:'compaction'})]),[['chunk'],['chunk']]);
  assert.deepEqual(reports,[{avoidedInputTokens:90,overhead:false},{avoidedInputTokens:0,overhead:true}]);
  assert.equal(tokenSavingsContext.getStore(),undefined);
});

test('tracks summarization from the shared service context and releases sessions when agents close',async()=>{
  const ctx=new Context(),service=new ThreadCredits(ctx),{session}=fixture();session.id='session-one';let dispose;
  service.mount({on:()=>{},effect:fn=>{dispose=fn();}},{},null,session);
  const options={provider:'bees-credits-one',sessionId:session.id,purpose:'compaction'};
  const next=()=> (async function*(){yield tokenSavingsContext.getStore();})();
  const collect=async stream=>{const values=[];for await(const value of stream)values.push(value);return values;};
  assert.deepEqual(await collect(ctx.waterfall('llm/stream',options,next)),[{avoidedInputTokens:0,overhead:true}]);
  dispose();assert.equal(service.sessions.size,0);
  assert.deepEqual(await collect(ctx.waterfall('llm/stream',options,next)),[undefined]);
});
