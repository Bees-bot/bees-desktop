export const DEFAULT_WORKFLOW = [{ name: 'Work', kind: 'work' }, { name: 'Review', kind: 'review' }];
export const CHAT_WORKFLOW = [{ name: 'Chat', kind: 'chat' }];
export const isChatWorkflow = workflow => workflow?.length===1&&workflow[0].kind==='chat';
export const workflowFor = (thread,team) => thread.processId?thread.workflow:team?.workflowConfigured?team.workflow:thread.workflow??DEFAULT_WORKFLOW;
export const isValidWorkflow = workflow => Array.isArray(workflow)&&workflow.length>0&&workflow.length<=12
  &&workflow.every(s=>s&&['work','review','approval','chat'].includes(s.kind)&&typeof s.name==='string'&&!!s.name.trim()&&s.name.length<=80&&(!s.model||typeof s.model==='string'&&s.model.length<=200&&s.model.includes('/'))&&(!s.agentId||typeof s.agentId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s.agentId)))
  &&(!workflow.some(s=>s.kind==='chat')||workflow.length===1);

export const WORKFLOW_TEMPLATES = [
  { id: 'goals', name: 'Goals', workflow: DEFAULT_WORKFLOW },
  { id: 'chat', name: 'Chat', workflow: CHAT_WORKFLOW },
  { id: 'research-and-report', name: 'Research and report', workflow: [
    { name: 'Research', kind: 'work' }, { name: 'Draft', kind: 'work' }, { name: 'Review', kind: 'review' },
  ] },
  { id: 'fix-a-bug', name: 'Fix a bug', workflow: [
    { name: 'Reproduce', kind: 'work' }, { name: 'Fix', kind: 'work' }, { name: 'Verify', kind: 'work' },
  ] },
  { id: 'write-and-publish', name: 'Write and publish', workflow: [
    { name: 'Outline', kind: 'work' }, { name: 'Write', kind: 'work' }, { name: 'Edit', kind: 'work' }, { name: 'Publish', kind: 'work' },
  ] },
];

export const workflowTemplate = (workflow = DEFAULT_WORKFLOW) => WORKFLOW_TEMPLATES.find(template => workflow.length === template.workflow.length
  && workflow.every((stage, index) => stage.name === template.workflow[index].name && stage.kind === template.workflow[index].kind));

export const processName = workflow => workflowTemplate(workflow)?.name ?? 'Custom process';
