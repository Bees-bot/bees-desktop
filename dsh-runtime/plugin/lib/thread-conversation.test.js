import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { configureRuntime } from '../client/runtime.js';
import { ThreadConversation } from '../client/thread-app.js';

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
