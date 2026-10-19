import { h, useEffect, useState, useRef, hosted } from './runtime.js';
import { openExternal } from './common.js';

const field=(label,props)=>h('label',{className:'bc-field'},h('span',null,label),h('input',props));
export function Login({server,request,onComplete}) {
  const [url,setUrl]=useState(server??location.origin),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[signup,setSignup]=useState(false);
  const [config,setConfig]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[waiting,setWaiting]=useState(false);
  const cancel=useRef(null);
  useEffect(()=>{let alive=true;setConfig(null);const timer=setTimeout(()=>{request('authConfig',{url}).then(value=>{if(alive){setConfig(value);setError('');}},e=>{if(alive)setError(e.message);});},250);return()=>{alive=false;clearTimeout(timer);};},[url]);
  useEffect(()=>()=>cancel.current?.(),[]);
  const submit=async values=>{setBusy(true);setError('');try{await request('login',values);await onComplete();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const social=async provider=>{
    if(provider==='sso'&&!/^[^\s@]+@[^\s@]+$/.test(email)){setError('Enter your work email for company SSO');return;}
    const popup=hosted?window.open('about:blank','_blank'):null;
    if(hosted&&!popup){setError('Allow the sign-in window in your browser, then try again.');return;}
    if(popup)popup.opener=null;
    setBusy(true);setWaiting(true);setError('');
    let channel,timer;
    try {
      if(hosted){
        const state=crypto.randomUUID();channel=new BroadcastChannel('bees-sign-in-'+state);
        let finish;const result=new Promise(resolve=>{finish=resolve;});channel.onmessage=e=>finish(e.data);
        cancel.current=()=>finish({error:'Sign in was cancelled. Try again.'});
        timer=setTimeout(()=>finish({error:'Sign in timed out. Try again.'}),5*60_000);
        const started=await request('startLogin',{provider,email,state});popup.location.href=started.url;
        const value=await result;if(value.error)throw Error(value.error);if(!value.token)throw Error('Sign in failed. Try again.');
        await request('login',{session:value.token});
      }else{
        const started=await request('startLogin',{url,provider,email});
        cancel.current=()=>{void request('cancelLogin',{id:started.id}).catch(()=>{});};
        await openExternal(started.url);
        // Webviews can suspend a long request while the person signs in in another browser.
        while((await request('finishLogin',{id:started.id})).pending)await new Promise(resolve=>setTimeout(resolve,1000));
      }
      await onComplete();
    }catch(e){setError(e.message);}finally{cancel.current?.();cancel.current=null;clearTimeout(timer);channel?.close();popup?.close();setBusy(false);setWaiting(false);}
  };
  return h('form',{className:'bc-form',onSubmit:e=>{e.preventDefault();void submit({url,email,password,...(signup?{name}:{})});}},
    h('p',{className:'bc-muted'},'Sign in to share threads and connect your machines.'),
    !hosted?field('Bees Server',{value:url,type:'url',required:true,disabled:busy,onChange:e=>setUrl(e.target.value)}):null,
    (config?.socialProviders??[]).filter(p=>['google','github'].includes(p)).map(provider=>h('button',{key:provider,type:'button',disabled:busy,onClick:()=>social(provider)},'Continue with '+({google:'Google',github:'GitHub'}[provider]))),
    error?h('p',{className:'bc-error',role:'alert'},error):null,
    waiting?h('p',{role:'status'},'Finish signing in in your browser.'):null,
    waiting?h('button',{type:'button',onClick:()=>cancel.current?.()},'Cancel sign in'):null,
    signup?field('Name',{value:name,required:true,disabled:busy,autoComplete:'name',onChange:e=>setName(e.target.value)}):null,
    field('Email',{value:email,type:'email',required:true,disabled:busy,autoComplete:'email',onChange:e=>setEmail(e.target.value)}),
    config?.ssoEnabled?h('button',{type:'button',disabled:busy,onClick:()=>social('sso')},'Continue with company SSO'):null,
    field('Password',{value:password,type:'password',required:true,disabled:busy,minLength:8,autoComplete:signup?'new-password':'current-password',onChange:e=>setPassword(e.target.value)}),
    h('button',{className:'bc-primary',type:'submit',disabled:busy},signup?'Create account':'Sign in'),
    h('button',{type:'button',className:'bc-link',disabled:busy,onClick:()=>setSignup(!signup)},signup?'Already have an account?':'Create an account'));
}
