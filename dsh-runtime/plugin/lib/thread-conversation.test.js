import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { configureRuntime } from '../client/runtime.js';
import { ThreadConversation } from '../client/thread-app.js';
import { CHAT_WORKFLOW } from './thread-workflow.js';

test('Chat keeps its conversational composer ready after a reply',()=>{
  const markup=renderToStaticMarkup(React.createElement(ThreadConversation,{thread:{workflow:CHAT_WORKFLOW,messages:[{id:'reply',kind:'assistant',text:'Hello',createdAt:new Date().toISOString()}]},peerNames:new Map(),canWrite:true,templateId:'chat'}));
  assert.match(markup,/placeholder="Chat with Bees…"/);assert.match(markup,/Chat with AI/);assert.match(markup,/Your turn/);
  assert.doesNotMatch(markup,/<textarea[^>]*disabled/);
});

configureRuntime(name => ({ react: React, 'react-dom': {}, '@deepseek-ai/dsh-client-ui-primitives': { MarkdownText: ({ text }) => text } })[name], { hosted: true });
const render = (messages = [], discussion = false) => renderToStaticMarkup(React.createElement(ThreadConversation, {
  thread: { id: 'new-thread', messages }, discussion, peerNames: new Map(), canWrite: true,
}));

test('new threads place the composer above the empty conversation, including threads with only discussion messages', () => {
  assert.match(render(), /class="bc-chat-widget bc-empty-chat"/);
  assert.match(render([{ id: 'discussion', kind: 'discussion' }]), /class="bc-chat-widget bc-empty-chat"/);
});

test('conversations with messages and discussion keep the composer below their messages', () => {
  assert.doesNotMatch(render([{ id: 'message', kind: 'user', text: 'Hello', createdAt: new Date().toISOString() }]), /bc-empty-chat/);
  assert.doesNotMatch(render([], true), /bc-empty-chat/);
});

test('new conversations offer the starter templates with Goals selected by default', () => {
  const markup=render();
  assert.match(markup, /aria-label="Thread template"/);
  assert.match(markup, /value="goals" selected="">Goals \(default\)/);
  for(const name of ['Research and report','Fix a bug','Write and publish'])assert(markup.includes(name));
  assert.doesNotMatch(render([],true), /aria-label="Thread template"/);
  assert.doesNotMatch(render([{id:'message',kind:'user',text:'Hello',createdAt:new Date().toISOString()}]), /aria-label="Thread template"/);
});

test('the selected template is shown and cannot be changed by viewers or during a request', () => {
  const props={thread:{messages:[]},peerNames:new Map(),canWrite:true,manage:true,templateId:'research-and-report'};
  const markup=renderToStaticMarkup(React.createElement(ThreadConversation,props));
  assert.match(markup,/value="research-and-report" selected=""/);
  assert.doesNotMatch(markup,/<select[^>]*disabled/);
  for(const extra of [{canWrite:false},{manage:false},{busy:true}]){
    assert.match(renderToStaticMarkup(React.createElement(ThreadConversation,{...props,...extra})),/<select[^>]*disabled/);
  }
});

test('failed and interrupted runs offer recovery while keeping the composer available', () => {
  for(const [status,label] of [['failed','Retry'],['uncertain','Continue'],['cancelled','Continue']]){
    const run={id:'run',status,error:'Previous attempt stopped'};
    const props={thread:{messages:[],runs:[run]},run,peerNames:new Map(),canWrite:true};
    const markup=renderToStaticMarkup(React.createElement(ThreadConversation,props));
    assert.match(markup,new RegExp(`<button[^>]*>${label}</button>`));
    assert.doesNotMatch(markup,/<textarea[^>]*disabled/);
    for(const extra of [{busy:true},{canWrite:false}]){
      assert.match(renderToStaticMarkup(React.createElement(ThreadConversation,{...props,...extra})),new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`));
    }
    assert.doesNotMatch(renderToStaticMarkup(React.createElement(ThreadConversation,{...props,discussion:true})),/>(Retry|Continue)<\/button>/);
  }
  for(const status of ['running','completed']){
    const run={id:'run',status};
    assert.doesNotMatch(renderToStaticMarkup(React.createElement(ThreadConversation,{thread:{messages:[],runs:[run]},run,active:status==='running',peerNames:new Map(),canWrite:true})),/>(Retry|Continue)<\/button>/);
  }
});

test('interrupted reviews must be resolved before Continue appears; stale approvals cannot be answered', () => {
  const review={id:'review',revision:1,state:'open',values:{},request:{title:'Saved review',effect:'Use reviewed data',values:{},view:{type:'text',text:'Check these values'}}};
  const run={id:'run',status:'uncertain',error:'Generic interruption warning',pending:{kind:'review',reviewId:review.id},reviews:[review]};
  const props={thread:{messages:[],runs:[run]},run,peerNames:new Map(),canWrite:true,manage:true};
  const open=renderToStaticMarkup(React.createElement(ThreadConversation,props));
  assert.match(open,/Resolve the saved review below/);
  assert.match(open,/Save and approve/);
  assert.doesNotMatch(open,/>Continue<\/button>/);
  review.state='approved';review.resumeRequired=true;delete run.pending;
  const saved=renderToStaticMarkup(React.createElement(ThreadConversation,props));
  assert.match(saved,/Your review decision is saved/);
  assert.match(saved,/>Continue<\/button>/);
  assert.doesNotMatch(saved,/Generic interruption warning/);
  run.pending={kind:'approval',id:'expired',text:'Expired approval'};
  const stale=renderToStaticMarkup(React.createElement(ThreadConversation,props));
  assert.doesNotMatch(stale,/Expired approval|>Approve<\/button>/);
  assert.match(stale,/>Continue<\/button>/);
});

test('recovery sends one contextual message without clearing a typed draft or attachments', async () => {
  const configure=react=>configureRuntime(name=>({react,'react-dom':{},'@deepseek-ai/dsh-client-ui-primitives':{MarkdownText:({text})=>text}})[name],{hosted:true});
  const nodes=node=>!React.isValidElement(node)?[]:[node,...React.Children.toArray(node.props.children).flatMap(nodes)];
  try{
    for(const status of ['failed','uncertain']){
      let state=0,changes=0,finish;const calls=[];
      configure({...React,useState:initial=>[++state===1?'My draft':state===2?[{name:'notes.txt'}]:initial,()=>changes++],useRef:initial=>({current:initial}),useEffect:()=>{}});
      const run={id:'run',status,error:'Stopped'},onSend=(...args)=>{calls.push(args);return new Promise(resolve=>{finish=resolve;});};
      const tree=ThreadConversation({thread:{messages:[],runs:[run]},run,peerNames:new Map(),canWrite:true,onSend});
      const all=nodes(tree),button=all.find(node=>node.type==='button'&&node.props.children===(status==='failed'?'Retry':'Continue'));
      const sending=button.props.onClick();await button.props.onClick();
      assert.equal(calls.length,1);assert.equal(calls[0][1],false);assert.equal(calls[0].length,2);
      assert.match(calls[0][0],status==='failed'?/Retry the previous request.*checking existing work/:/Continue the previous request.*saved work and review decisions.*fresh approval/);
      assert.equal(all.find(node=>node.type==='textarea').props.value,'My draft');assert.equal(changes,0);
      assert(all.some(node=>node.type==='span'&&node.props.children?.[0]==='notes.txt'));
      finish(true);await sending;
    }
  }finally{configure(React);}
});
