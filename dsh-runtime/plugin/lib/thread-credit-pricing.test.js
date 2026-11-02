import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCreditAmount} from './credit-pricing.js';
import {configureRuntime} from '../client/runtime.js';
import {CreditSettings,FirstStart} from '../client/thread-credits.js';
test('credit amounts preserve cents exactly and reject amounts below the $10 minimum',()=>{
 for(const [input,cents] of [['10',1000],['25',2500],['10.01',1001],['30.5',3050],['999999.99',99999999]])assert.equal(parseCreditAmount(input),cents);
 for(const input of ['9.99','-10','1e2','NaN','10.001','1000000',''])assert.throws(()=>parseCreditAmount(input),/at least/);
});
test('desktop and web show starter credits as dollars times one million',()=>{
 const React={createElement:(type,props,...children)=>({type,props,children}),createContext:()=>({}),useState:value=>[value,()=>{}],useRef:value=>({current:value}),useEffect:()=>{}};
 configureRuntime(name=>({react:React,'react-dom':{},'@deepseek-ai/dsh-client-ui-primitives':{},'@bees/dsh-custom-ai':{},'@bees/dsh-subscriptions':{}})[name],{hosted:true});
 for(const [usd,display] of [[0.01,'10,000'],[0.009999,'9,999'],[0.004,'4,000'],[0.0000001,'0.1'],[0,'0']]){
  const settings=JSON.stringify(CreditSettings({user:{emailVerified:true},connection:{available:true,credits:{balance:0,starterRemainingUsd:usd}}}));
  assert(settings.includes(display+' starter credits remaining.'));assert(settings.includes('0 purchased credits available'));
  assert(settings.includes('50k starter credits'));assert(settings.includes('credits are not tokens')); assert(!settings.includes('$0.01'));
 }
 const monthly=JSON.stringify(CreditSettings({user:{emailVerified:true},connection:{credits:{balance:1000000,billingSchedule:'monthly_advance'}}}));
 assert(monthly.includes('monthly Net 30 invoice'));assert(monthly.includes('1,000,000 credits available'));assert(monthly.includes('Monthly invoice autopay is managed separately.'));
 const upfront=JSON.stringify(CreditSettings({user:{emailVerified:true},connection:{credits:{balance:1000000,billingSchedule:'monthly_upfront'}}}));
 assert(upfront.includes('paid upfront'));assert(upfront.includes('New credits become available after payment'));assert(!upfront.includes('monthly Net 30 invoice'));
 const unavailable=JSON.stringify(CreditSettings({user:{emailVerified:true},connection:{credits:{starterRemainingUsd:null,starterMessage:'Temporarily unavailable'}}}));
 assert(!unavailable.includes('starter credits remaining.'));assert(unavailable.includes('Temporarily unavailable'));
 const onboarding=JSON.stringify(FirstStart({}));assert(onboarding.includes('50k starter credits'));assert(!onboarding.includes('$0.01'));
});

test('model choices pin the default, group recommendations before other models, and show marked-up prices and tiers',async()=>{
 const React=(await import('react')).default,{renderToStaticMarkup}=await import('react-dom/server');
 const {modelOptions,ModelPricing}=await import('../client/model-options.js');
 configureRuntime(name=>({react:React,'react-dom':{},'@deepseek-ai/dsh-client-ui-primitives':{}})[name],{hosted:true});
 const pricing={input:2.6,output:13,cacheRead:0.13,cacheWrite:3.25,request:0,tiers:[{minInputTokens:272000,input:5.2,output:19.5,cacheRead:0.26,cacheWrite:6.5,request:0}]};
 const models=[{id:'own/model',name:'Own AI'},{id:'other',name:'Other',group:'other',pricing},{id:'default',name:'Pinned',group:'default',pricing},{id:'recommended',name:'Recommended',group:'recommended',pricing}];
 const markup=renderToStaticMarkup(React.createElement('select',null,modelOptions(models)));
 assert(markup.indexOf('Pinned')<markup.indexOf('Recommended'));assert(markup.indexOf('Recommended')<markup.indexOf('Other models'));assert(markup.indexOf('Other models')<markup.indexOf('Own AI'));
 assert(markup.includes('Input $2.6 / Output $13 per 1M tokens'));assert(markup.includes('Long-context rates apply'));
 const details=renderToStaticMarkup(React.createElement(ModelPricing,{models,current:'default'}));
 for(const value of ['30%','272,000','$5.2','$19.5','cached input $0.13','cache writes $3.25'])assert(details.includes(value),value);
 assert.equal(renderToStaticMarkup(React.createElement(ModelPricing,{models,current:'own/model'})),'');
});
