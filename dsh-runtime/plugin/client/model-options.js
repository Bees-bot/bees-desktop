import {h} from './runtime.js';

export function modelOptions(models){
  const money=value=>'$'+Number(value).toLocaleString('en-US',{maximumFractionDigits:6});
  const option=model=>h('option',{key:model.id,value:model.id},model.name+(model.pricing?` · Input ${money(model.pricing.input)} / Output ${money(model.pricing.output)} per 1M tokens${model.pricing.request?' · '+money(model.pricing.request)+' per request':''}${model.pricing.tiers?.length?' · Long-context rates apply':''}`:''));
  return [
    ...models.filter(model=>model.group==='default').map(model=>h('optgroup',{key:'default',label:'Platform default · pinned'},option(model))),
    ...[['recommended','Recommended by platform'],['other','Other models']].map(([group,label])=>{
      const rows=models.filter(model=>model.group===group);
      return rows.length?h('optgroup',{key:group,label},rows.map(option)):null;
    }),
    ...models.filter(model=>!model.group).map(option),
  ];
}

export function ModelPricing({models,current}){
  const model=models.find(row=>row.id===current),pricing=model?.pricing;
  if(!pricing)return null;
  const money=value=>'$'+Number(value).toLocaleString('en-US',{maximumFractionDigits:6});
  const rows=[{label:'Base rate',...pricing},...(pricing.tiers??[]).map(tier=>({...tier,label:`From ${tier.minInputTokens.toLocaleString()} input tokens`}))];
  return h('section',{className:'bc-card bc-form','aria-label':'Selected model pricing'},h('strong',null,model.name),
    h('p',{className:'bc-muted'},'Prices include the 30% Bees markup over OpenRouter. Actual provider cost determines the credits used.'),
    rows.map(row=>h('div',{key:row.label},h('strong',null,row.label),
      h('p',null,`Per 1M tokens: input ${money(row.input)} · output ${money(row.output)} · cached input ${money(row.cacheRead)} · cache writes ${money(row.cacheWrite)}.`),
      row.request?h('p',null,money(row.request)+' per request.'):null)));
}
