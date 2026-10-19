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
