const identity = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export const REASONING_EFFORTS = ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export const agentAllowsServer = (agent, name) => !agent || agent.mcpAccess === 'all' || agent.mcpAccess === 'selected' && agent.mcpServers.includes(name);

export function validateTeamAgents(agents) {
  if (!Array.isArray(agents) || agents.length > 40) throw Error('A team can have up to 40 agents');
  const ids = new Set(), names = new Set();
  for (const agent of agents) {
    if (!agent || !identity(agent.id) || ids.has(agent.id) || typeof agent.name !== 'string' || !agent.name.trim() || agent.name.length > 120 || names.has(agent.name.trim().toLowerCase())) throw Error('Give every team agent a unique name and identity');
    if (Object.keys(agent).some(key => !['id','name','presetId','instructions','model','reasoningEffort','enabled','mcpAccess','mcpServers'].includes(key))) throw Error('Unknown team agent setting');
    if (typeof agent.presetId !== 'string' || !/^[\w-]{1,120}$/.test(agent.presetId) || typeof agent.instructions !== 'string' || agent.instructions.length > 20000 || typeof agent.model !== 'string' || agent.model.length > 200 || agent.model && !agent.model.includes('/') || !REASONING_EFFORTS.includes(agent.reasoningEffort) || typeof agent.enabled !== 'boolean') throw Error('Invalid team agent settings');
    if (!['all','none','selected'].includes(agent.mcpAccess) || !Array.isArray(agent.mcpServers) || agent.mcpServers.length > 40 || agent.mcpServers.some(name => typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(name))) throw Error('Choose which add-ons this agent can use');
    ids.add(agent.id); names.add(agent.name.trim().toLowerCase());
  }
}

export function captureWorkflowAgents(workflow, team) {
  return workflow.map(stage => {
    const { agent: _ignored, ...saved } = stage;
    if (!stage.agentId || stage.kind === 'approval') return saved;
    const agent = team?.agents?.find(agent => agent.id === stage.agentId);
    if (!agent) throw Error(`The agent for ${stage.name} was removed. Choose another agent in the process.`);
    if (!agent.enabled) throw Error(`${agent.name} is disabled. Enable it in Team agents before running this process.`);
    return { ...stage, agent: structuredClone(agent) };
  });
}
