import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountTeamDelegation, selectTeamHelper } from './thread-delegation.js';

const agents = ['A', 'B', 'C'].map(name => ({ id: name, name, enabled: true, presetId: 'standard', instructions: 'Role ' + name }));

test('delegation validates the enabled team catalog and rejects every ancestor, including self', async () => {
  const catalog = [...agents, { id: 'disabled', name: 'Disabled', enabled: false, instructions: '' }];
  for (const name of ['A', 'B', 'C']) assert.throws(() => selectTeamHelper(catalog, name, ['A', 'B', 'C']), /ancestor/);
  for (const name of ['Disabled', 'Other team']) assert.throws(() => selectTeamHelper(catalog, name, []), /enabled agent/);
  assert.equal(selectTeamHelper(catalog, 'C', ['A', 'B']), agents[2]);
  const owner = { options: { provider: 'test', model: 'parent' } }, preferences = new Map();
  let definition, started;
  const store = { preference: (key, value) => preferences.set(key, value) };
  const ctx = { tools: { register: tool => { definition = tool; } }, subagents: { startActivation: async spec => {
    assert.equal(preferences.get('teamAgent:' + spec.childId).agentId, 'C');
    started = spec;
  } } };
  mountTeamDelegation(ctx, { owner, agents: catalog, chain: ['A', 'B'], store, threadId: 'thread',
    modelFor: async agent => ({ provider: 'test', model: agent.name }) });
  const exec = { agent: owner, signal: new AbortController().signal };
  await assert.rejects(definition.execute({ agent_name: 'A', prompt: 'Cycle' }, exec), /ancestor/);
  await assert.rejects(definition.execute({ agent_name: 'C', prompt: '' }, exec), /Supply a task/);
  await assert.rejects(definition.execute({ agent_name: 'C', prompt: 'Work' }, { ...exec, agent: {} }), /calling agent/);
  assert.equal(started, undefined);
  const result = JSON.parse(await definition.execute({ agent_name: 'C', prompt: 'Work' }, exec));
  assert.equal(result.agent_id, started.childId); assert.equal(started.request.parent, owner);
  assert.equal(started.request.agentOptions.model, 'C'); assert.equal(started.request.agentPreset, 'standard');
  assert.equal(started.delivery, 'parent'); assert.equal(started.request.maxDepth, 8);
  ctx.subagents.startActivation = async () => { throw Error('Cancelled'); };
  await assert.rejects(definition.execute({ agent_name: 'C', prompt: 'Work' }, exec), /Cancelled/);
  assert.equal([...preferences.values()].at(-1), null);
});
