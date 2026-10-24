// Local session identities never travel in a shared thread checkpoint.
export const chatSessionKey = threadId => 'chatSession:' + threadId;

export function chatMessages(thread, state, prompt) {
  const cursor = state?.lastMessageId ? thread.messages.findIndex(message => message.id === state.lastMessageId) : -1;
  const messages = thread.messages.slice(cursor + 1).filter(message => message.id !== state?.replyMessageId);
  // The latest user message is already supplied as the run prompt.
  if (messages.at(-1)?.kind === 'user' && messages.at(-1).text === prompt) messages.pop();
  return messages;
}

export function recordChatReply(store, threadId, runId, messageId) {
  const key = chatSessionKey(threadId), state = store.preference(key);
  if (state?.runId === runId) store.preference(key, { ...state, replyMessageId: messageId });
}
