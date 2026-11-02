import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ThreadClient } from './thread-client.js';
import { ThreadIntegrations, browserMode } from './thread-integrations.js';

const agent = () => ({ id: randomUUID(), name: 'Researcher', presetId: 'standard', instructions: 'Cite primary sources.', model: 'test/research', reasoningEffort: 'high', enabled: true, mcpAccess: 'selected', mcpServers: ['docs'] });

test('team agents persist and each execution captures its agent before later edits', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bees-agents-')); let client;
  let release, captured;
  try {
    client = new ThreadClient(root, { execute: async input => { captured = input; await new Promise(resolve => { release = resolve; }); return 'Done'; } });
    const teamId = client.store.preference('defaultTeam'), researcher = agent();
    const configure = values => client.command({ action: 'configure', threadId: teamId, operationId: randomUUID(), ...values });
    const workflow = [{ name: 'Research', kind: 'work', agentId: researcher.id }];
    await configure({ agents: [researcher], workflow });
    const thread = await client.command({ action: 'create' });
    await client.command({ action: 'run', threadId: thread.id, operationId: randomUUID(), text: 'Research' });
    assert.deepEqual(captured.run.workflow[0].agent, researcher);
    assert.deepEqual(captured.team.agents, [researcher]);
    await configure({ agents: [{ ...researcher, instructions: 'Changed later' }] });
    assert.equal(captured.run.workflow[0].agent.instructions, 'Cite primary sources.');
    assert.equal(captured.team.agents[0].instructions, 'Cite primary sources.');
    release(); await Promise.all(client.finishing);
    const runId = captured.run.id;
    client.store.close(); client = new ThreadClient(root);
    assert.equal(client.store.get(teamId).agents[0].instructions, 'Changed later');
    assert.equal(client.store.get(thread.id).runs.find(run => run.id === runId).workflow[0].agent.name, 'Researcher');
    await client.command({ action: 'configure', threadId: teamId, operationId: randomUUID(), agents: [{ ...researcher, enabled: false }] });
    await assert.rejects(client.command({ action: 'run', threadId: thread.id, operationId: randomUUID(), text: 'Again' }), /disabled/);
    assert.equal(client.store.get(thread.id).runs.length, 1);
    const other = await client.command({ action: 'createTeam', name: 'Other' });
    await client.command({ action: 'configure', threadId: other.id, operationId: randomUUID(), workflow });
    const otherThread = await client.command({ action: 'create', teamId: other.id });
    await assert.rejects(client.command({ action: 'run', threadId: otherThread.id, operationId: randomUUID(), text: 'Other team' }), /removed/);
    for (const invalid of [[researcher, researcher], [{ ...researcher, mcpAccess: 'anything' }], [{ ...researcher, apiKey: 'secret' }]]) {
      await assert.rejects(client.command({ action: 'configure', threadId: teamId, operationId: randomUUID(), agents: invalid }));
    }
  } finally { release?.(); await client?.close(); rmSync(root, { recursive: true, force: true }); }
});

test('agent add-on restrictions apply to team and legacy connections; browser defaults preserve explicit opt-out', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bees-agent-tools-')), integrations = new ThreadIntegrations({});
  const client = new ThreadClient(root);
  try {
    const teamId = client.store.preference('defaultTeam'), thread = await client.command({ action: 'create' });
    for (const [id, serverName] of [[teamId, 'docs'], [teamId, 'mail'], [thread.id, 'legacy']]) await integrations.save(client.store, id, { serverName, transport: 'streamable-http', url: 'https://example.test/mcp' });
    const mounted = [], ctx = { plugin: (_plugin, config) => { mounted.push(config.serverName); return Promise.resolve(); } };
    await integrations.mount(ctx, client.store, thread.id, root, agent()); assert.deepEqual(mounted, ['docs']);
    mounted.length = 0; await integrations.mount(ctx, client.store, thread.id, root, { mcpAccess: 'none', mcpServers: [] }); assert.deepEqual(mounted, []);
    assert.equal(browserMode(client.store, teamId, true), 'personal');
    assert.equal(browserMode(client.store, teamId, false), 'own');
    assert.equal(browserMode(client.store, teamId, { fallback: true }), 'own', 'A fallback browser needs explicit opt-in');
    client.store.preference('browser:' + teamId, 'own'); assert.equal(browserMode(client.store, teamId, true), 'own');
    assert.equal(browserMode(client.store, teamId, { fallback: true }), 'own');
    client.store.preference('browser:' + teamId, 'personal'); assert.equal(browserMode(client.store, teamId, false), 'own');
    assert.equal(browserMode(client.store, teamId, { fallback: true }), 'personal');
  } finally { await client.close(); rmSync(root, { recursive: true, force: true }); }
});
