import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCreditAmount} from './credit-pricing.js';
import {configureRuntime} from '../client/runtime.js';
import {CreditSettings,FirstStart} from '../client/thread-credits.js';
test('credit amounts preserve cents exactly and reject amounts below the $10 minimum',()=>{
 for(const [input,cents] of [['10',1000],['25',2500],['10.01',1001],['30.5',3050],['999999.99',99999999]])assert.equal(parseCreditAmount(input),cents);
 for(const input of ['9.99','-10','1e2','NaN','10.001','1000000',''])assert.throws(()=>parseCreditAmount(input),/at least/);
});
test('desktop and web show the dollar starter allowance separately from purchased tokens',()=>{
 const React={createElement:(type,props,...children)=>({type,props,children}),createContext:()=>({}),useState:value=>[value,()=>{}],useRef:value=>({current:value}),useEffect:()=>{}};
 configureRuntime(name=>({react:React,'react-dom':{},'@deepseek-ai/dsh-client-ui-primitives':{},'@bees/dsh-custom-ai':{},'@bees/dsh-subscriptions':{}})[name],{hosted:true});
 const settings=JSON.stringify(CreditSettings({user:{emailVerified:true},connection:{available:true,credits:{balance:0,starterRemainingUsd:0.009999}}}));
 assert(settings.includes('$0.009999 starter credit remaining.'));assert(settings.includes('0 purchased tokens available'));
 assert(settings.includes('no starter token quota'));assert(!settings.includes('$0.10'));assert(!settings.includes('(100,000 tokens)'));
 const onboarding=JSON.stringify(FirstStart({}));assert(onboarding.includes('$0.01 of provider usage'));assert(onboarding.includes('no starter token quota'));
});
