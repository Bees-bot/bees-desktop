import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ThreadClient } from './thread-client.js';
import { ThreadMemory } from './thread-memory.js';
import { LocalMemory } from './local-memory.js';

function hindsight() {
  const banks = new Map(), calls = []; let down = false;
  return { banks, calls, set down(value) { down = value; }, fetch: async (url, input) => {
    calls.push({ url, ...input }); if (down) throw Error('Service offline');
    const [, bankId, suffix = ''] = /\/banks\/([^/]+)(.*)$/.exec(url), bank = banks.get(bankId), body = input.body && JSON.parse(input.body);
    const result = (data, status = 200) => new Response(JSON.stringify(data), { status });
    if (!suffix && input.method === 'PUT') { banks.set(bankId, { documents: new Map(), operations: new Map() }); return result({}); }
    if (!bank) return result({}, 404);
    if (suffix === '/config') return result({});
    if (suffix === '/health/llm') return result({ operations: [{ ok: true }] });
    if (suffix === '/memories/recall') return result({ results: [...bank.documents.entries()].map(([id, item]) => ({ id, text: item.content, document_id: id, type: 'world' })) });
    if (suffix.startsWith('/operations/')) return bank.operations.has(suffix.split('/').at(-1)) ? result({ status: 'completed' }) : result({}, 404);
    if (suffix === '/memories') { bank.operations.set(body.operation_id, body); for (const item of body.items) bank.documents.set(item.document_id, item); return result({ success: true, async: true, operation_id: body.operation_id }); }
    if (suffix.startsWith('/documents/') && input.method === 'DELETE') { bank.documents.delete(suffix.split('/').at(-1)); return result({}); }
    throw Error('Unexpected Hindsight request ' + suffix);
  } };
}

test('memory queue survives outages and restart, isolates banks, and hides corrected or forgotten outcomes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bees-memory-')), server = hindsight(), keys = new Map();
  const credentials = { set: async (key, value) => keys.set(key, value), resolve: async key => ({ value: keys.get(key) }), unset: async key => keys.delete(key) };
  const options = { memory: store => new ThreadMemory(store, credentials, server.fetch) };
  let client = new ThreadClient(root, options);
  try {
    const teamId = client.store.preference('defaultTeam'), other = await client.command({ action: 'createTeam', name: 'Other' });
    const command = (action, values = {}) => client.command({ action, threadId: teamId, ...values });
    assert.equal((await command('memory_status')).enabled, true);
    await command('memory_configure', { url: 'https://memory.test', enabled: true, apiKey: 'test-only-key' });
    assert(!JSON.stringify(client.store.document(teamId)).includes('test-only-key'));
    server.down = true;
    const id = client.memory.remember(teamId, 'Use primary sources', 'Finished research').id;
    await assert.rejects(client.memory.flush(teamId));
    assert.equal((await command('memory_status')).memories[0].status, 'pending');
    await client.close(); client = new ThreadClient(root, options); server.down = false;
    await client.memory.flush(teamId); await client.memory.flush(teamId);
    assert.equal((await command('memory_status')).memories[0].status, 'stored');
    assert.equal((await client.memory.recall(teamId, 'sources'))[0].text, 'Use primary sources');
    assert.deepEqual(await client.memory.recall(other.id, 'sources'), []);
    assert.notEqual(client.memory.settings(teamId).bank, client.memory.settings(other.id).bank);
    await command('memory_edit', { id, content: 'Use reviewed primary sources' });
    assert.deepEqual(await client.memory.recall(teamId, 'sources'), [], 'Pending corrections suppress stale recall');
    await client.memory.flush(teamId);
    assert.equal((await client.memory.recall(teamId, 'sources'))[0].text, 'Use reviewed primary sources');
    await assert.rejects(command('memory_configure', { url: 'https://different.test', enabled: true }), /Forget and synchronize/);
    await command('memory_delete', { id }); assert.deepEqual(await client.memory.recall(teamId, 'sources'), []);
    await command('memory_configure', { url: 'https://memory.test', enabled: false });
    const before = server.calls.length;
    client.memory.remember(teamId, 'Disabled outcome', 'evidence'); assert.deepEqual(await client.memory.recall(teamId, 'anything'), []);
    assert.equal(server.calls.length, before); assert.deepEqual((await command('memory_status')).memories, []);
    await assert.rejects(command('memory_configure', { url: 'http://public.test', enabled: true }), /HTTPS/);
    await assert.rejects(command('memory_configure', { url: 'https://key@public.test', enabled: true }), /credentials/);
    await assert.rejects(client.localCommand(teamId, { action: 'memory_configure', operationId: randomUUID() }, 'remote-user'), /Unknown thread command/);
  } finally { await client.close(); rmSync(root, { recursive: true, force: true }); }
});

test('new work recalls team outcomes and completed goals are queued, while failures and chats are not retained', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bees-memory-runs-')), remembered = [], seen = [];
  const service = { recall: async () => [{ text: 'Earlier lesson' }], remember: (...args) => remembered.push(args), flush: async () => {}, close: async () => {} };
  const client = new ThreadClient(root, { memory: () => service, execute: async input => { seen.push(input); if (input.run.prompt === 'Fail') throw Error('Model offline'); return 'Finished result'; } });
  try {
    const goal = await client.command({ action: 'create' }), chat = await client.command({ action: 'create', templateId: 'chat' });
    for (const [threadId, text] of [[goal.id, 'Goal'], [chat.id, 'Chat'], [goal.id, 'Fail']]) {
      await client.command({ action: 'run', threadId, operationId: randomUUID(), text }); await Promise.all(client.finishing);
    }
    assert.equal(remembered.length, 1); assert.equal(remembered[0][0], goal.teamId); assert.equal(remembered[0][1], 'Finished result');
    assert(seen[0].thread.memory.some(note => note.includes('Earlier lesson')));
    service.recall = async () => { throw Error('Memory offline'); };
    await client.command({ action: 'run', threadId: goal.id, operationId: randomUUID(), text: 'Works offline' }); await Promise.all(client.finishing);
    assert.equal(client.store.get(goal.id).runs.at(-1).status, 'completed');
  } finally { await client.close(); rmSync(root, { recursive: true, force: true }); }
});

test('managed memory uses current local AI connections and their credentials, never hosted providers', async t => {
  const local = new LocalMemory({ describe: () => [{ ns: 'llm-pi-ai', value: { providers: {
    'external-local-ai': { baseURL: 'http://127.0.0.1:1234/v1', models: [{ id: 'local', name: 'Local model' }] },
    'custom-openai': { api: 'openai-completions', baseURL: 'http://127.0.0.1:1235/v1', apiKeyEnv: 'LOCAL_KEY', models: [{ id: 'current' }] },
    'local-openai-cloud': { baseURL: 'https://cloud.test/v1', models: [{ id: 'remote' }] },
    'unsupported': { api: 'anthropic-messages', baseURL: 'http://127.0.0.1:1236/v1', models: [{ id: 'unsupported' }] },
  } } }] }, { get: () => ({ memoryModel: JSON.stringify(['custom-openai', 'current']) }) }, '/unused', { resolve: async ref => { assert.equal(ref, 'LOCAL_KEY'); return { value: 'local-only-test-key' }; } });
  assert.deepEqual(local.models().map(row => row.model), ['local', 'current']);
  t.mock.method(globalThis, 'fetch', async (url, input) => {
    assert.equal(url, 'http://127.0.0.1:1235/v1/models');
    assert.equal(input.headers.get('authorization'), 'Bearer local-only-test-key');
    return new Response(JSON.stringify({ data: [{ id: 'current' }] }));
  });
  assert.equal((await local.target()).model, 'current');
  const root = mkdtempSync(join(tmpdir(), 'bees-memory-wait-')); let calls = 0;
  const client = new ThreadClient(root, { memory: store => new ThreadMemory(store, {}, async () => { calls++; throw Error('Must not fetch'); }) });
  try {
    client.memory.local = { ready: false, status: 'Waiting for local AI', view: () => ({ managed: true, localStatus: 'Waiting for local AI' }), ensure() {} };
    const id = client.store.preference('defaultTeam');
    client.memory.remember(id, 'Outcome', 'Evidence'); await client.memory.flush(id);
    await assert.rejects(client.memory.recall(id, 'Question'), /Waiting for local AI/); assert.equal(calls, 0);
    assert.equal(client.memory.settings(id).status, 'Waiting for local AI');
  } finally { await client.close(); rmSync(root, { recursive: true, force: true }); }
});
