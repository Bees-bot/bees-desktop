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
  { id: 'news-summary', name: 'News summary', workflow: [
    { name: 'Pick topics', kind: 'work', instructions: 'If the request does not name the topics, ask the person which ones they want, with these options: science, technology, business, finance, politics, sports, entertainment. Write the chosen topics to outputs/topics.md.' },
    { name: 'Read the news', kind: 'work', instructions: 'Read outputs/topics.md. For each topic, read today\'s news from at least three different news sources. Note each story with its source name and link in outputs/sources.md.' },
    { name: 'Summarize news', kind: 'work', instructions: 'Read outputs/sources.md. Write a short summary for each topic to outputs/news-summary.md, a few bullets per topic with a link to each story. Reply with the top story of each topic. The person can put this thread on a schedule in its settings to get the summary every day.' },
  ] },
  { id: 'sales-meeting-prep', name: 'Sales meeting prep', workflow: [
    { name: 'Find meetings', kind: 'work', instructions: 'Find the person\'s upcoming sales meetings. Use a connected calendar add-on if there is one, otherwise ask the person to paste the meetings. Write each meeting\'s time, company and attendees to outputs/meetings.md.' },
    { name: 'Research accounts', kind: 'work', instructions: 'Read outputs/meetings.md. For each company, research the company, its attendees, its main competitors and what those competitors are doing lately. Write the findings with links to outputs/research.md.' },
    { name: 'Talking points', kind: 'work', instructions: 'Read outputs/meetings.md and outputs/research.md. For each meeting, explain why the company needs Bees to stay competitive, then list talking points ranked by how likely each is to make the sale, with a one-line reason each. Write it to outputs/meeting-prep.md and reply with the top three points per meeting.' },
  ] },
  { id: 'email-replies', name: 'Email replies with approval', workflow: [
    { name: 'Find emails', kind: 'work', instructions: 'Find emails that need a reply. Use a connected mail add-on if there is one, otherwise ask the person to paste them. For each one, read the earlier conversation with the same sender. List each email with its sender, subject and what it asks for in outputs/emails.md. Do not send anything.' },
    { name: 'Draft replies', kind: 'work', instructions: 'Read outputs/emails.md and draft a reply to each email in outputs/drafts.md. Show the person each draft and ask them to approve it, change it or skip it, and revise until they approve or skip. Do not send anything. End with a list of the approved drafts.' },
    { name: 'Approve sending', kind: 'approval' },
    { name: 'Send replies', kind: 'work', instructions: 'Read outputs/drafts.md and send only the drafts the person approved, through the connected mail add-on. Never send a draft they changed their mind on or skipped. If no mail add-on is connected, give the person the approved drafts to send themselves. Write what was sent to outputs/sent.md.' },
  ] },
  { id: 'ceo-daily-brief', name: 'CEO daily brief', workflow: [
    { name: 'Collect numbers', kind: 'work', instructions: 'Pull the latest numbers from the sources the person names, such as a sheet, a dashboard or a connected add-on. If no sources are named, ask the person which ones to use and which numbers matter. Add today\'s numbers with the date to the running table in outputs/daily-numbers.md, and keep earlier days.' },
    { name: 'Write brief', kind: 'work', instructions: 'Read outputs/daily-numbers.md and compare today with earlier days. Write a short brief to outputs/daily-brief.md: what changed, what looks off, and what needs the person\'s attention. Reply with the brief in five bullets or fewer. The person can put this thread on a schedule in its settings to get the brief every day.' },
  ] },
  { id: 'founder-thinking-partner', name: 'Founder thinking partner', workflow: [
    { name: 'Understand the company', kind: 'work', instructions: 'Learn what the company does, its customers, its numbers and the founder\'s goals from the request and the shared files. Ask the person at most 5 short questions for what is missing. Write a short company summary to outputs/company.md.' },
    { name: 'Generate ideas', kind: 'work', instructions: 'Read outputs/company.md. Answer four questions: what is the founder not thinking of, how could the company grow 10x, how can the founder improve themself, and which new processes or markets to try. Rank the ideas under each question by impact, each with a short reason and a first step. Write them to outputs/ideas.md.' },
    { name: 'Challenge ideas', kind: 'review', instructions: 'Read outputs/company.md and outputs/ideas.md. Name any idea that is vague, does not fit the company, or is ranked too high, and say why.' },
  ] },
];

export const workflowTemplate = (workflow = DEFAULT_WORKFLOW) => WORKFLOW_TEMPLATES.find(template => workflow.length === template.workflow.length
  && workflow.every((stage, index) => stage.name === template.workflow[index].name && stage.kind === template.workflow[index].kind));

export const processName = workflow => workflowTemplate(workflow)?.name ?? 'Custom process';
