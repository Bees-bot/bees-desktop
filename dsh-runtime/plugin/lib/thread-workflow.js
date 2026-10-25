export const DEFAULT_WORKFLOW = [{ name: 'Work', kind: 'work' }, { name: 'Review', kind: 'review' }];
export const CHAT_WORKFLOW = [{ name: 'Chat', kind: 'chat' }];
export const isChatWorkflow = workflow => workflow?.length===1&&workflow[0].kind==='chat';
export const workflowFor = (thread,team) => thread.processId?thread.workflow:team?.workflowConfigured?team.workflow:thread.workflow??DEFAULT_WORKFLOW;
export const isValidWorkflow = workflow => Array.isArray(workflow)&&workflow.length>0&&workflow.length<=12
  &&workflow.every(s=>s&&['work','review','approval','chat'].includes(s.kind)&&typeof s.name==='string'&&!!s.name.trim()&&s.name.length<=80&&(!s.model||typeof s.model==='string'&&s.model.length<=200&&s.model.includes('/'))&&(!s.agentId||typeof s.agentId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s.agentId))&&(!s.instructions||typeof s.instructions==='string'&&s.instructions.length<=4000))
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
  { id: 'build-software', name: 'Build software', workflow: [
    { name: 'Requirements', kind: 'work', instructions: 'Ask the person what they want built before anything else. Ask at most 5 short questions with answer options where you can, and skip anything the request already answers. Write the answers as a short requirements list to outputs/requirements.md. Do not design or build anything yet.' },
    { name: 'Architecture', kind: 'work', instructions: 'Read outputs/requirements.md. Search GitHub for a base project to build on: MIT or Apache 2.0 licensed, still maintained, modular, and one that saves the most custom code. Then get at least two independent architecture proposals from subagents, on different AI models when more than one is available, and have them critique each other. Rank designs by modularity first, then less custom code through existing packages and libraries, then reusable components so similar modules are never built twice. Do not argue about small things, and settle within 2 to 5 rounds. Write the base project, its license and the design to outputs/architecture.md. Then show the person the design, ask them to approve it or say what to change, and revise until they approve.' },
    { name: 'Plan', kind: 'work', instructions: 'Read outputs/requirements.md and outputs/architecture.md. Split the build into phases the person can test on their own, each about 1000 changed lines or fewer. For every phase write numbered test steps that use only the app\'s screens, never a terminal or code. Write the plan to outputs/plan.md.' },
    { name: 'Build', kind: 'work', instructions: 'Build outputs/plan.md one phase at a time, with the code under outputs/. After each phase, ask the person to follow that phase\'s test steps, including how to open the app, and to say which steps failed. Fix what they report and ask again until the phase passes, then start the next phase.' },
    { name: 'Review', kind: 'review', instructions: 'Check that every phase in outputs/plan.md was built and that the person confirmed its test steps passed. Name any phase that was skipped or still fails.' },
  ] },
];

export const workflowTemplate = (workflow = DEFAULT_WORKFLOW) => WORKFLOW_TEMPLATES.find(template => workflow.length === template.workflow.length
  && workflow.every((stage, index) => stage.name === template.workflow[index].name && stage.kind === template.workflow[index].kind));

export const processName = workflow => workflowTemplate(workflow)?.name ?? 'Custom process';
