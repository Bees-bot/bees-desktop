import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import { defineTool } from '@deepseek-ai/dsh-tools';

export function selectTeamHelper(agents, name, chain) {
  const agent = agents.find(agent => agent.name === name && agent.enabled);
  if (!agent) throw Error('Choose an enabled agent from this team.');
  if (chain.includes(agent.id)) throw Error('An agent cannot invoke itself or an ancestor in this delegation chain.');
  return agent;
}

export function mountTeamDelegation(ctx, { owner, agents, chain, store, threadId, modelFor, subagents = ctx.subagents }) {
  if (!agents.length) return;
  ctx.tools.register(defineTool({
    name: 'bees_delegate_agent',
    description: 'Ask an enabled team agent for help. Each helper uses its saved instructions, model and allowed add-ons in this thread workspace. Supply all relevant context and an exact task. Completion is delivered automatically; a start receipt is not completion. You cannot call yourself or any ancestor. Available team agents:\n' + agents.map(agent => `${agent.name}: ${agent.instructions.slice(0, 300)}`).join('\n'),
    parameters: {
      agent_name: { type: 'string', required: true, description: 'Exact team agent name.' },
      prompt: { type: 'string', required: true, description: 'The task and context this helper needs.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    isConcurrencySafe: () => true,
    execute: async ({ agent_name, prompt }, exec) => {
      if (exec.agent !== owner) throw Error('Delegation belongs to the calling agent only.');
      const agent = selectTeamHelper(agents, agent_name, chain);
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100000) throw Error('Supply a task of 1–100,000 characters.');
      const agentOptions = await modelFor(agent, owner.options);
      exec.signal.throwIfAborted();
      const childId = SessionId(randomUUID()), key = 'teamAgent:' + childId;
      // Save identity before creation so fresh and cold-resumed children receive the same checks.
      store.preference(key, { threadId, agentId: agent.id });
      try {
        await subagents.startActivation({ provider: 'spawn', childId, label: agent.name, signal: exec.signal, delivery: 'parent',
          request: { parent: owner, agentPreset: agent.presetId, agentOptions, prompt: [{ type: 'text', text: prompt }], maxDepth: 8 } });
      } catch (error) { store.preference(key, null); throw error; }
      return JSON.stringify({ agent_id: childId, agent: agent.name, status: 'started' });
    },
  }));
}
