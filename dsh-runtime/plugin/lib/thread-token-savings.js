import {AsyncLocalStorage} from 'node:async_hooks';
import {isAgentLoopRequest} from '@deepseek-ai/dsh-llm';
import {estimateMessage} from '@deepseek-ai/dsh-token-meter/estimate';

export const tokenSavingsContext=new AsyncLocalStorage();
const measured=new WeakMap();

export function contextTokensAvoided(session){
  const events=session.snapshotEvents(),state=measured.get(session)??{cursor:0,tokens:0};
  for(let index=state.cursor;index<events.length;index++){
    const event=events[index],claim=events[index-1];
    if(!['compaction/prune','compaction/summary'].includes(claim?.type)||event.surfaceOp?.op!=='replace')continue;
    const range=claim.data.shadowedRange;
    if(event.surfaceOp.startSeq!==range.start||event.surfaceOp.endSeq!==range.end)continue;
    const message=session.deriveEventMessage(event);
    if(message)state.tokens+=claim.data.shadowedTokenCount-estimateMessage(message);
  }
  state.cursor=events.length;measured.set(session,state);
  return Math.max(0,state.tokens);
}

export function withTokenSavings(options,next,session){
  const overhead=options.purpose==='compaction';
  if(!overhead&&!isAgentLoopRequest(options))return next();
  const report={avoidedInputTokens:overhead?0:contextTokensAvoided(session),overhead};
  const stream=tokenSavingsContext.run(report,next);
  return (async function*(){
    const iterator=stream[Symbol.asyncIterator]();
    try{for(;;){const item=await tokenSavingsContext.run(report,()=>iterator.next());if(item.done)return;yield item.value;}}
    finally{await tokenSavingsContext.run(report,()=>iterator.return?.());}
  })();
}
