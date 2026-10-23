import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureRuntime } from '../client/runtime.js';
import { Login } from '../client/thread-login.js';

test('desktop sign-in polls while Google is open and keeps the attempt until enrollment completes',async t=>{
  const priorLocation=globalThis.location;globalThis.location={search:''};
  t.after(()=>{if(priorLocation===undefined)delete globalThis.location;else globalThis.location=priorLocation;});
  let cursor=0,completed=0,polls=0;
  const state=[],dependencies=[],effects=[],calls=[];
  const React={
    createElement:(type,props,...children)=>({type,props,children}),createContext:()=>({}),
    useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],value=>{state[i]=value;}];},
    useRef(initial){const i=cursor++;return state[i]??=( {current:initial} );},
    useEffect(fn,deps){const i=cursor++;if(!dependencies[i]||deps.some((v,j)=>v!==dependencies[i][j]))effects.push(fn);dependencies[i]=deps;}
  };
  configureRuntime(name=>({react:React,'react-dom':{},'@deepseek-ai/dsh-client-ui-primitives':{},'@bees/dsh-custom-ai':{},'@bees/dsh-subscriptions':{}})[name]);
  const prior=globalThis.window;
  globalThis.window={__TAURI__:{core:{invoke:async(command,{url})=>{calls.push(command);assert.equal(url,'https://server.example/start');}}}};
  t.mock.timers.enable({apis:['setTimeout']});
  const request=async action=>{
    calls.push(action);
    if(action==='authConfig')return {socialProviders:['google']};
    if(action==='startLogin')return {id:'attempt',url:'https://server.example/start'};
    if(action==='finishLogin')return ++polls<3?{pending:true}:{id:'alice'};
    if(action==='cancelLogin')return {ok:true};
    assert.fail('Unexpected '+action);
  };
  const render=()=>{cursor=0;const tree=Login({server:'https://server.example',request,onComplete:async()=>{completed++;}});effects.splice(0).forEach(fn=>fn());return tree;};
  const nodes=node=>!node||typeof node!=='object'?[]:[node,...(node.children??[]).flat(Infinity).flatMap(nodes)];
  try{
    render();t.mock.timers.tick(250);await new Promise(setImmediate);
    const button=nodes(render()).find(node=>node.type==='button'&&node.children.includes('Continue with Google'));
    const signingIn=button.props.onClick();await new Promise(setImmediate);
    assert.equal(polls,1);assert.equal(completed,0);assert(!calls.includes('cancelLogin'));
    t.mock.timers.tick(1000);await new Promise(setImmediate);
    assert.equal(polls,2);assert.equal(completed,0);assert(!calls.includes('cancelLogin'));
    t.mock.timers.tick(1000);await signingIn;
    assert.equal(completed,1);assert.equal(calls.at(-1),'cancelLogin');
  }finally{if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});

test('hosted sign-in shows progress after Google returns until the account is ready, and clears it on failure',async t=>{
  const priorLocation=globalThis.location;globalThis.location={search:''};
  t.after(()=>{if(priorLocation===undefined)delete globalThis.location;else globalThis.location=priorLocation;});
  let cursor=0,channel,login,ready;
  const state=[],dependencies=[],effects=[];
  const React={
    createElement:(type,props,...children)=>({type,props,children}),createContext:()=>({}),
    useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],value=>{state[i]=value;}];},
    useRef(initial){const i=cursor++;return state[i]??={current:initial};},
    useEffect(fn,deps){const i=cursor++;if(!dependencies[i]||deps.some((v,j)=>v!==dependencies[i][j]))effects.push(fn);dependencies[i]=deps;}
  };
  const modules=name=>({react:React,'react-dom':{},'@deepseek-ai/dsh-client-ui-primitives':{},'@bees/dsh-custom-ai':{},'@bees/dsh-subscriptions':{}})[name];
  configureRuntime(modules,{hosted:true});
  const priorWindow=globalThis.window,priorChannel=globalThis.BroadcastChannel;
  globalThis.window={open:()=>({location:{},close(){}})};
  globalThis.BroadcastChannel=class{constructor(){channel=this;}close(){}};
  t.mock.timers.enable({apis:['setTimeout']});
  const request=async(action,values)=>{
    if(action==='authConfig')return {socialProviders:['google']};
    if(action==='startLogin')return {url:'https://server.example/start'};
    if(action==='login'){assert.equal(values.session,'synthetic-session');return login.promise;}
    assert.fail('Unexpected '+action);
  };
  const render=()=>{cursor=0;const tree=Login({server:'https://server.example',request,onComplete:()=>ready.promise});effects.splice(0).forEach(fn=>fn());return tree;};
  const nodes=node=>!node||typeof node!=='object'?[]:[node,...(node.children??[]).flat(Infinity).flatMap(nodes)];
  const status=()=>nodes(render()).find(node=>node.props?.role==='status')?.children[0];
  try{
    render();t.mock.timers.tick(250);await new Promise(setImmediate);
    for(const fail of [false,true]){
      login=Promise.withResolvers();ready=Promise.withResolvers();
      const button=nodes(render()).find(node=>node.type==='button'&&node.children.includes('Continue with Google'));
      const signingIn=button.props.onClick();await new Promise(setImmediate);
      assert.equal(status(),'Finish signing in in your browser.');
      channel.onmessage({data:{token:'synthetic-session'}});await new Promise(setImmediate);
      assert.equal(status(),'Signing in…');assert.equal(render().props['aria-busy'],true);
      assert(nodes(render()).filter(node=>node.type==='input').every(node=>node.props.disabled));
      if(fail)login.reject(Error('Hosted client could not start.'));
      else{
        login.resolve({});await new Promise(setImmediate);
        assert.equal(status(),'Signing in…');assert.equal(render().props['aria-busy'],true);
        ready.resolve();
      }
      await signingIn;
      assert.equal(status(),undefined);assert.equal(render().props['aria-busy'],false);
      if(fail)assert(nodes(render()).some(node=>node.props?.role==='alert'&&node.children.includes('Hosted client could not start.')));
    }
  }finally{
    if(priorWindow===undefined)delete globalThis.window;else globalThis.window=priorWindow;
    globalThis.BroadcastChannel=priorChannel;configureRuntime(modules);
  }
});
