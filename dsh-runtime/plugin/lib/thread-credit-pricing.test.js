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
  assert(settings.includes(display+' starter credits remaining.'));assert(settings.includes('0 purchased tokens available'));
  assert(settings.includes('10k starter credits'));assert(settings.includes('dollars × 1,000,000'));assert(!settings.includes('$0.01'));
 }
 const unavailable=JSON.stringify(CreditSettings({user:{emailVerified:true},connection:{credits:{starterRemainingUsd:null,starterMessage:'Temporarily unavailable'}}}));
 assert(!unavailable.includes('starter credits remaining.'));assert(unavailable.includes('Temporarily unavailable'));
 const onboarding=JSON.stringify(FirstStart({}));assert(onboarding.includes('10k starter credits'));assert(!onboarding.includes('$0.01'));
});
