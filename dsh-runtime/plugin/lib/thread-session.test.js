import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatMessages, chatSessionKey, recordChatReply } from './thread-session.js';

test('continuing chats send new input once, retain intervening messages, and bootstrap the full visible history', () => {
  const messages = Array.from({ length: 50 }, (_, index) => ({ id: String(index), kind: 'user', text: 'Message ' + index }));
  const thread = { messages: [...messages, { id: 'reply', kind: 'assistant', text: 'Last reply' },
    { id: 'discussion', kind: 'discussion', text: 'Additional context' }, { id: 'latest', kind: 'user', text: 'Continue' }] };
  assert.equal(chatMessages(thread, null, 'Continue').length, 52);
  assert.deepEqual(chatMessages(thread, { lastMessageId: '49', replyMessageId: 'reply' }, 'Continue'), [thread.messages.at(-2)]);
  assert.equal(chatMessages(thread, { lastMessageId: 'unavailable' }, 'Continue')[0].id, '0');
  const state = { runId: 'old' }, values = new Map([[chatSessionKey('thread'), state]]);
  const store = { preference: (key, value) => value === undefined ? values.get(key) : values.set(key, value) };
  recordChatReply(store, 'thread', 'other-run', 'unrelated'); assert.equal(values.get(chatSessionKey('thread')), state);
  recordChatReply(store, 'thread', 'old', 'reply'); assert.equal(values.get(chatSessionKey('thread')).replyMessageId, 'reply');
});
