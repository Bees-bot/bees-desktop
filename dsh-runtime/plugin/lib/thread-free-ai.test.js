import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ThreadFreeAI, freeAIAdapter } from './thread-free-ai.js';

const model = { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Bees Free · Nemotron 3 Ultra', contextWindow: 131072, maxTokens: 8192 };
const configuration = name => ({ apiKey: 'sk-or-v1-' + name, limit: 0, model });
function harness() {
  const adapters = new Map();
  const service = new ThreadFreeAI({ llm: { registerAdapter: ([id], adapter) => {
    assert(!adapters.has(id)); adapters.set(id, adapter); return () => adapters.delete(id);
  } } });
  const client = name => ({ store: { clientId: randomUUID(), preferences: new Map(),
    preference(key, value) { if (arguments.length > 1) this.preferences.set(key, value); return this.preferences.get(key) ?? null; } }, directory: {
    url: 'https://bees.test', user: { id: name }, token: name,
    request: async path => { assert.equal(path, '/ai'); return { ai: configuration(name) }; }
  } });
  return { adapters, service, client };
}

test('desktop and hosted accounts use the same free model but separate keys without exposing secrets in views', async () => {
  const { service, adapters, client } = harness(), alice = client('alice'), bob = client('bob');
  const selection = { provider: 'bees-free', model: model.id };
  bob.store.preference('model', 'openrouter/user-chosen-model');
  let calls = 0; const request = alice.directory.request;
  alice.directory.request = async (...args) => { calls++; return request(...args); };
  await Promise.all([service.sync(alice), service.sync(alice), service.sync(bob)]);
  assert.equal(calls, 1); assert.equal(adapters.size, 2);
  assert.equal(alice.store.preference('model'), 'bees-free/' + model.id);
  assert.equal(bob.store.preference('model'), 'openrouter/user-chosen-model');
  const a = service.resolve(alice.store, selection), b = service.resolve(bob.store, selection);
  assert.notEqual(a.provider, b.provider);
  assert.equal(await adapters.get(a.provider).config.resolveApiKey(), 'sk-or-v1-alice');
  assert.equal(await adapters.get(b.provider).config.resolveApiKey(), 'sk-or-v1-bob');
  assert.deepEqual(service.models(alice.store), [{ id: 'bees-free/' + model.id, name: model.name }]);
  assert(!JSON.stringify([service.view(alice.store), service.models(alice.store)]).includes('sk-or'));
  assert.throws(() => service.resolve(alice.store, b), /Choose Bees Free/);
  let guard;
  service.mount({ on: (event, fn) => { assert.equal(event, 'llm/stream'); guard = fn; } }, alice.store);
  assert.throws(() => guard(b, () => assert.fail('Cross-account model request')), /another account/);
  assert.equal(guard(a, () => 'allowed'), 'allowed');
  assert.throws(() => service.resolve(alice.store, { ...selection, model: 'paid/model' }), /unavailable/);
  const own = { provider: 'openrouter', model: 'user-chosen-model' };
  assert.equal(service.resolve(alice.store, own), own);
  const captured = adapters.get(a.provider);
  alice.directory.token = null; service.close(alice);
  assert.equal(adapters.size, 1); assert.equal(service.view(alice.store).available, false);
  await assert.rejects(captured.config.resolveApiKey(), /Sign in/);
  assert.throws(() => service.resolve(alice.store, selection), /unavailable/);
  service.close(bob);
});

test('unavailable, older and unconfigured servers leave existing models usable and retry later', async () => {
  const { service, adapters, client } = harness(), account = client('alice');
  account.directory.request = async () => { throw Object.assign(Error('private upstream detail'), { status: 503 }); };
  await service.sync(account);
  assert.equal(adapters.size, 0); assert.match(service.view(account.store).message, /temporarily unavailable/);
  assert(!service.view(account.store).message.includes('private'));
  account.directory.request = async () => ({ ai: configuration('alice') });
  service.accounts.get(account.store).retryAt = 0; await service.sync(account);
  assert.equal(service.view(account.store).available, true); service.close(account);
  for (const request of [async () => ({ ai: null }), async () => { throw Object.assign(Error('not found'), { status: 404 }); }]) {
    account.directory.request = request; await service.sync(account);
    assert.deepEqual(service.view(account.store), { available: false, message: '' }); service.close(account);
  }
  account.directory.request = async () => ({ ai: { ...configuration('alice'), limit: null } });
  await service.sync(account); assert.equal(adapters.size, 0); service.close(account);
});

test('sign-out during provisioning cannot reconnect an account', async () => {
  const { service, adapters, client } = harness(), account = client('alice');
  let finish;
  account.directory.request = () => new Promise(resolve => { finish = resolve; });
  const pending = service.sync(account);
  service.close(account); finish({ ai: configuration('alice') }); await pending;
  assert.equal(adapters.size, 0); assert.deepEqual(service.models(account.store), []);
});

test('free model streams tool calls through the existing adapter with only the account inference key', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: new Headers(options.headers), body: JSON.parse(options.body) });
    const chunks = [
      { id: 'completion', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"notes.txt"}' } }] }, finish_reason: null }] },
      { id: 'completion', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }
    ];
    return new Response(chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const adapter = freeAIAdapter('bees-free-test', { model }, async () => 'sk-or-v1-alice');
    const prepared = await adapter.prepareCall('bees-free-test', model.id);
    assert.equal(prepared.model.defaultMaxTokens, 8192);
    const chunks = [];
    for await (const chunk of prepared.stream({ provider: 'bees-free-test', model: model.id,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Read notes.txt' }] }], maxTokens: 100 })) chunks.push(chunk);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(calls[0].headers.get('authorization'), 'Bearer sk-or-v1-alice');
    assert.equal(calls[0].body.model, model.id);
    assert(!('models' in calls[0].body));
    assert(JSON.stringify(chunks).includes('read_file'));
    assert(!JSON.stringify(chunks).includes('sk-or'));
  } finally { globalThis.fetch = original; }
});
