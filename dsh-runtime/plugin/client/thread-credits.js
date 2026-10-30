import { h, useEffect, useRef, useState, hosted } from './runtime.js';
import { openExternal } from './common.js';
import { parseCreditAmount } from '../lib/credit-pricing.js';

const tokens=value=>Number(value??0).toLocaleString();
const starterCredits=value=>(value*1000000).toLocaleString('en-US',{maximumFractionDigits:6});
export function CreditSettings({connection,user,request,onRefresh,onSignIn}){
  const credits=connection?.credits;
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[renew,setRenew]=useState(credits?.autoRenew??false),[amount,setAmount]=useState(((credits?.renewalCents??1000)/100).toFixed(2));
  const purchase=useRef(crypto.randomUUID());
  useEffect(()=>setRenew(credits?.autoRenew??false),[credits?.autoRenew]);
  useEffect(()=>setAmount(((credits?.renewalCents??1000)/100).toFixed(2)),[credits?.renewalCents]);
  let amountCents;try{amountCents=parseCreditAmount(amount);}catch{}
  const price=amountCents?'$'+(amountCents/100).toFixed(2):'the chosen amount';
  const act=async fn=>{setBusy(true);setError('');try{await fn();await request('credits');await onRefresh();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const buy=()=>{
    const popup=hosted?window.open('about:blank','_blank'):null;
    if(hosted&&!popup){setError('Allow the checkout window in your browser, then try again.');return;}
    if(popup)popup.opener=null;
    void act(async()=>{
      try{
        const {url}=await request('purchaseCredits',{id:purchase.current,autoRenew:renew,amountCents:parseCreditAmount(amount)});
        const target=new URL(url);if(target.protocol!=='https:'||target.hostname!=='checkout.stripe.com')throw Error('Checkout could not be opened');
        if(popup)popup.location.href=target.href;else await openExternal(target.href);
        purchase.current=crypto.randomUUID();
      }catch(e){popup?.close();throw e;}
    });
  };
  return h('section',{className:'bc-form'},h('h3',null,'Credits & billing'),
    !user?h('div',null,h('p',null,'Sign in to use your personal Bees balance on desktop and web.'),h('button',{onClick:onSignIn},'Sign in')):h('div',{className:'bc-form'},
      h('p',null,h('strong',null,tokens(credits?.balance)+' purchased tokens available')),
      h('p',{className:'bc-muted'},'Your balance belongs to your Bees user account and is shared across all organizations, desktop Clients, and web Clients. Creating another organization does not grant more credits.'),
      h('p',null,'One-time grant: 10k starter credits. Starter credits equal provider usage in dollars × 1,000,000. Starter credits are used before purchased tokens.'),
      typeof credits?.starterRemainingUsd==='number'?h('p',{role:'status'},starterCredits(credits.starterRemainingUsd)+' starter credits remaining.'):null,
      credits?.starterMessage?h('p',{role:'status'},credits.starterMessage):null,
      h('p',{className:'bc-muted'},'Purchased tokens count input and output, including cached input and reasoning reported in those totals.'),
      credits?.heldTokens?h('p',{role:'status'},tokens(credits.heldTokens)+' tokens are reserved for running or unconfirmed requests. Unused reservations are returned when usage is confirmed.'):null,
      credits?.suspended?h('p',{className:'bc-error',role:'alert'},'Credit spending is paused. Contact support@bees.bot for a balance review.'):null,
      connection?.message?h('p',{role:'status'},connection.message):null,
      credits?.billingError?h('p',{className:'bc-error',role:'alert'},credits.billingError):null,
      error?h('p',{className:'bc-error',role:'alert'},error):null,
      h('button',{disabled:busy,onClick:()=>void act(async()=>{})},'Refresh balance'),
      h('hr',{style:{width:'100%',border:0,borderTop:'1px solid var(--line)',margin:'8px 0'}}),h('h4',null,'Add credits · $1 per million tokens'),
      h('label',{className:'bc-field'},h('span',null,'Amount in USD · minimum $10'),h('input',{type:'number',min:10,max:999999.99,step:0.01,required:true,disabled:busy,value:amount,onChange:e=>{setAmount(e.target.value);purchase.current=crypto.randomUUID();}})),
      h('p',null,amountCents?`${price} buys ${tokens(amountCents*10000)} tokens.`:'Enter an amount of at least $10 USD.'),
      h('label',{className:'bc-check'},h('input',{type:'checkbox',checked:renew,disabled:busy,onChange:e=>{setRenew(e.target.checked);purchase.current=crypto.randomUUID();}}),
        `Use this amount for auto-renew: charge ${price} whenever my balance reaches 100,000 tokens. Repeat until I turn it off.`),
      h('button',{className:'bc-primary',disabled:busy||!amountCents||!connection?.available||!credits?.purchasingEnabled||!user.emailVerified||credits?.suspended,onClick:buy},'Buy tokens · '+price),
      !user.emailVerified?h('p',{className:'bc-muted'},'Verify your email before purchasing or using Bees Credits.'):null,
      !credits?.purchasingEnabled?h('p',{className:'bc-muted'},'Credit purchases are not configured on this server yet.'):null,
      h('p',null,credits?.autoRenew?`Auto-renew is on: $${(credits.renewalCents/100).toFixed(2)} per refill.`:'Auto-renew is off. No automatic charges.'),
      credits?.hasPaymentMethod?h('p',{className:'bc-muted'},'Auto-renew uses the card saved during a checkout with auto-renew selected. To replace it, buy credits with auto-renew selected using your new card.'):null,
      credits?.hasPaymentMethod?h('button',{disabled:busy||!amountCents,onClick:()=>void act(()=>request('creditAutoRenew',{enabled:true,amountCents:parseCreditAmount(amount)}))},credits.autoRenew?'Save auto-renew amount · '+price:'Enable auto-renew · '+price+' per refill'):null,
      credits?.autoRenew?h('button',{disabled:busy,onClick:()=>void act(()=>request('creditAutoRenew',{enabled:false}))},'Turn off auto-renew'):null,
      credits?.paymentPending?h('p',{role:'status'},'A recharge is processing. A charge already in progress may complete after auto-renew is turned off.'):null));
}

export function FirstStart({user,organizations=[],accounts=[],busy,error,onSignIn,onCloud,onLocal,onVerify,invitations}){
  const [name,setName]=useState(''),[organizationId,setOrganizationId]=useState(''),[accountId,setAccountId]=useState(accounts.find(account=>account.active)?.id??accounts[0]?.id??null);
  const [invites,setInvites]=useState([]),[sent,setSent]=useState();
  const account=accounts.find(account=>account.id===accountId);
  user=account?.user??user;organizations=account?.organizations??organizations;
  useEffect(()=>{let alive=true;setInvites([]);if(user?.emailVerified)void invitations(accountId).then(rows=>{if(alive)setInvites(rows);},()=>{});return()=>{alive=false;};},[accountId,user?.emailVerified]);
  return h('main',{className:'bc-first-start'},h('section',{className:'bc-onboarding'},
    h('h1',null,'How would you like to start?'),h('p',{className:'bc-muted'},'Choose a Bees organization with starter credits, or work locally with your own AI.'),
    error?h('p',{className:'bc-error',role:'alert'},error):null,
    h('div',{className:'bc-onboarding-options'},
      h('section',{className:'bc-form bc-onboarding-option'},h('h2',null,'Create a Bees organization'),
        h('p',null,'Get 10k starter credits for your first task. Use the same personal balance on desktop and web.'),
        h('p',{className:'bc-muted'},'One grant per Bees user, shared across organizations. Add 10 million tokens for $10 when you need more.'),
        accounts.length>1?h('label',{className:'bc-field'},h('span',null,'Account'),h('select',{'aria-label':'Account for new organization',value:accountId,disabled:busy,onChange:e=>{setAccountId(e.target.value);setOrganizationId('');}},accounts.map(account=>h('option',{key:account.id,value:account.id},account.user.email)))):null,
        !user?h('button',{className:'bc-primary',disabled:busy,onClick:onSignIn},'Sign in or create an account'):
        !user.emailVerified?h('div',null,h('p',null,'Verify your email to create an organization and use starter credits.'),h('button',{disabled:busy,onClick:()=>void onVerify(accountId).then(ok=>setSent(ok&&accountId))},'Send verification email'),sent===accountId?h('p',{className:'bc-notice',role:'status'},'Check your email to verify your account.'):null):
        h('form',{className:'bc-form',onSubmit:e=>{e.preventDefault();if(!busy)onCloud({name,...(accountId?{accountId}:{}),...(organizationId?{organizationId}:{})});}},
          invites.map(i=>h('div',{key:i.id,className:'bc-person'},h('span',null,(i.invited_by_name?i.invited_by_name+' invited you to ':'You’re invited to ')+(i.organization_name??'an organization')),
            h('button',{type:'button',className:'bc-primary',disabled:busy,onClick:()=>onCloud({...(accountId?{accountId}:{}),invitationId:i.id,organizationId:i.organization_id})},'Join'))),
          organizations.length?h('label',{className:'bc-field'},h('span',null,'Organization'),h('select',{value:organizationId,disabled:busy,onChange:e=>setOrganizationId(e.target.value)},
            h('option',{value:''},'Create a new organization'),organizations.map(org=>h('option',{key:org.id,value:org.id},org.name)))):null,
          !organizationId?h('label',{className:'bc-field'},h('span',null,'Organization name'),h('input',{required:true,maxLength:120,value:name,disabled:busy,onChange:e=>setName(e.target.value)})):null,
          h('button',{type:'submit',className:'bc-primary',disabled:busy},organizationId?'Use this organization':'Create organization'))),
      h('section',{className:'bc-form bc-onboarding-option'},h('h2',null,'Use a local organization'),
        h('p',null,'Work on your computer and connect your own local model or AI provider. No Bees credits or account are required.'),
        hosted?h('div',null,h('p',{className:'bc-muted'},'Models running on your computer require Bees Desktop.'),h('button',{disabled:busy,onClick:()=>void openExternal('https://bees.bot/download/')},'Get Bees Desktop')):
        h('button',{disabled:busy,onClick:onLocal},'Continue locally and configure AI')))));
}
