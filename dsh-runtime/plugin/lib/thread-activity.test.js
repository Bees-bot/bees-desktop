import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoverThreadActivity, trackThreadAgent, threadAgentSnapshot } from './thread-activity.js';
import { ThreadClient } from './thread-client.js';

const at = Date.parse('2026-10-18T00:00:00Z');
const events = rows => rows.map(([type, data], seq) => ({ type, data, seq, time: at + seq }));
const session = (rows, header = {}) => ({ header, inheritedEventCount: 0, snapshotEvents: () => events(rows) });

test('agent tracking records exact parentage and lifecycle without including unrelated agents', () => {
  const run = { id: 'run' }, listeners = new Set();
  const store = { mutate: (_thread, _operation, fn) => fn({ runs: [run] }) };
  const ctx = { effect: fn => fn(), on: (_event, fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  const makeAgent = id => ({ id, status: 'idle', options: { model: 'example-model' }, session: session([]) });
  const parent = makeAgent('parent'), child = makeAgent('child');
  trackThreadAgent(ctx, { agent: parent, store, threadId: 'thread', runId: 'run', stageIndex: 0 });
  trackThreadAgent(ctx, { agent: child, store, threadId: 'thread', runId: 'run', stageIndex: 0, parentId: parent.id });
  const emit = (agent, status) => { for (const listener of listeners) listener({ agent, status }); };
  emit(makeAgent('unrelated'), 'running'); emit(parent, 'running'); emit(child, 'running');
  assert.equal(run.agents.length, 2);
  assert.deepEqual(run.agents.map(agent => agent.status), ['running', 'running']);
  assert.equal(run.agents[1].parentId, 'parent');
  for (const [reason, expected] of [['completed', 'completed'], ['error', 'failed'], ['aborted', 'cancelled']]) {
    child.session = session([['turn/end', { reason: { kind: reason } }]]);
    emit(child, 'idle');
    assert.equal(run.agents[1].status, expected);
  }
  assert.equal(run.agents[0].status, 'running');
});

test('snapshots preserve actual task, model, result and completion; inherited fork history is excluded', () => {
  const value = session([
    ['user/message', { content: [{ type: 'text', text: 'Parent task' }] }],
    ['turn/end', { reason: { kind: 'completed' } }],
    ['subagent/descriptor', { label: 'Append first entry', agentModel: 'old-model' }],
    ['user/message', { content: [{ type: 'text', text: 'Append first.' }, { type: 'text', text: 'Internal delegation guidance' }] }],
    ['request/context', { model: 'actual-model' }],
    ['assistant/message', { message: { content: [{ type: 'text', text: 'Appended first.' }] } }],
    ['turn/end', { reason: { kind: 'completed' } }],
  ], { createdAt: at });
  value.inheritedEventCount = 2;
  const snapshot = threadAgentSnapshot(value);
  assert.equal(snapshot.task, 'Append first.'); assert.equal(snapshot.title, 'Append first entry');
  assert.equal(snapshot.summary, 'Appended first.'); assert.equal(snapshot.model, 'actual-model');
  assert.equal(snapshot.status, 'completed'); assert(snapshot.completedAt);
  assert.equal(threadAgentSnapshot(session([['turn/start', {}]])).status, 'uncertain');
});

test('execution evidence distinguishes a completed turn from a successful file contribution', () => {
  const call = (callId, name, args) => ['tool/call', { callId, name, arguments: JSON.stringify(args) }];
  const result = (toolCallId, text, isError = false) => ['tool/result', { message: { toolCallId, isError, content: [{ type: 'text', text }] } }];
  const value = session([
    call('inherited', 'write', { file_path: 'outputs/counter.txt', content: 'parent entry' }),
    result('inherited', 'Written'),
    call('locate', 'glob', { pattern: 'counter-*.txt', path: 'outputs' }),
    result('locate', 'No files found'),
    call('failed', 'bees_append_file', { file_path: 'outputs/counter.txt', content: 'first\n' }),
    result('failed', 'Access denied', true),
    call('append', 'bees_append_file', { file_path: 'outputs/counter.txt', content: 'first\n' }),
    result('append', '{"appended_chars":6}'),
    call('pending', 'read', { file_path: 'outputs/counter.txt' }),
    ['turn/end', { reason: { kind: 'completed' } }],
  ]);
  value.inheritedEventCount = 2;
  const snapshot = threadAgentSnapshot(value);
  assert.equal(snapshot.status, 'completed');
  assert.deepEqual(snapshot.tools.map(tool => [tool.id, tool.status]), [
    ['locate', 'succeeded'], ['failed', 'failed'], ['append', 'succeeded'], ['pending', 'pending'],
  ]);
  assert.equal(snapshot.tools[0].result, 'No files found');
  assert.equal(snapshot.tools[1].result, 'Access denied');
  assert.equal(JSON.parse(snapshot.tools[2].arguments).content, 'first\n');
  assert(snapshot.tools[2].completedAt >= snapshot.tools[2].startedAt);
  assert.equal(snapshot.tools[3].completedAt, undefined);
  assert.deepEqual(threadAgentSnapshot(session([['turn/end', { reason: { kind: 'completed' } }]])).tools, []);
});

test('private thread reads recover durable child history once, with validated lineage and no model calls', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bees-activity-'));
  const sources = new Map(); let opened = 0, closed = 0;
  const ctx = { sessions: { get: () => undefined }, agents: { get: () => undefined }, sessionPersistence: {
    open: async (id, access) => {
      assert.equal(access, 'read'); opened++;
      const value = sources.get(id);
      if (!value) throw Object.assign(Error('Missing session'), { name: 'SessionPersistenceNotFoundError' });
      return { header: value.header, inheritedEventCount: 0, read: async () => ({ events: value.snapshotEvents() }), close: async () => { closed++; } };
    },
  } };
  const client = new ThreadClient(root, { recoverActivity: (store, doc) => recoverThreadActivity(ctx, store, doc) });
  try {
    const doc = client.store.create('Counter'), runId = randomUUID(), childId = randomUUID(), grandchildId = randomUUID();
    const cwd = join(root, 'runs', doc.id, runId), parentId = `${runId}-0`;
    client.store.mutate(doc.id, randomUUID(), value => value.runs.push({ id: runId, status: 'completed', activityVersion: 1, prompt: 'Counter', workflow: [{ name: 'Work', kind: 'work' }] }));
    sources.set(parentId, session([['subagent/catalog', { childId }], ['turn/end', { reason: { kind: 'completed' } }]], { id: parentId, cwd, createdAt: at }));
    sources.set(childId, session([['subagent/descriptor', { label: 'First' }], ['subagent/catalog', { childId: grandchildId }], ['turn/end', { reason: { kind: 'completed' } }]], { id: childId, parentSession: parentId, cwd, createdAt: at }));
    sources.set(grandchildId, session([['turn/end', { reason: { kind: 'completed' } }]], { id: grandchildId, parentSession: childId, cwd, createdAt: at }));
    const recovered = await client.command({ action: 'read', threadId: doc.id });
    assert.equal(recovered.runs[0].agents.length, 3);
    assert.equal(recovered.runs[0].agents[1].title, 'First');
    assert.equal(recovered.runs[0].agents[2].parentId, childId);
    assert(recovered.runs[0].agents.every(agent => agent.status === 'completed'));
    assert.equal(recovered.runs[0].activityVersion, 2);
    assert(recovered.runs[0].agents.every(agent => Array.isArray(agent.tools)));
    assert.equal(opened, 3); assert.equal(closed, 3);
    await client.command({ action: 'read', threadId: doc.id }); assert.equal(opened, 3);
    client.store.mutate(doc.id, randomUUID(), value => { delete value.runs[0].activityVersion; value.runs[0].agents = []; });
    sources.get(childId).header.cwd = '/another-thread';
    const fenced = await client.command({ action: 'read', threadId: doc.id });
    assert.deepEqual(fenced.runs[0].agents.map(agent => agent.id), [parentId]);
    assert.match(fenced.runs[0].activityError, /does not belong/);
    assert.equal(opened, 5); assert.equal(closed, 5);
    await recoverThreadActivity(ctx, { ...client.store, clientId: randomUUID() }, client.store.get(doc.id)); assert.equal(opened, 5);
  } finally { client.store.close(); rmSync(root, { recursive: true, force: true }); }
});
