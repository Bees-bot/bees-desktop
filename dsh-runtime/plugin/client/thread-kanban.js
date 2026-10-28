import { h, useState, MarkdownText } from './runtime.js';
import { when } from './common.js';
import { DEFAULT_WORKFLOW, processName, isChatWorkflow } from '../lib/thread-workflow.js';

export const labels = { planned: 'Planned', running: 'In progress', waiting: 'Needs input', completed: 'Done',
  failed: 'Failed', cancelled: 'Stopped', uncertain: 'Interrupted', idle: 'Ready' };
const agentStatus = (agent, run) => ['running', 'idle'].includes(agent.status) && run.status !== 'running' ? 'uncertain' : agent.status;
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const badge = status => h('span', { className: 'bc-kanban-status', 'data-status': status }, labels[status] ?? status);

export function kanbanColumns(thread, run) {
  const workflow = (run ? run.workflow : thread.workflow) ?? DEFAULT_WORKFLOW;
  const columns = [...workflow, { name: isChatWorkflow(workflow)?'Your turn':'Done', kind: isChatWorkflow(workflow)?'input':'terminal' }].map((stage, index) => ({ ...stage, index, cards: [] }));
  if (!run) return columns;
  const current = run.stageIndex ?? Math.max(0, workflow.findIndex(stage => stage.name === run.stage));
  const agents = run.agents ?? [];
  const roots = agents.filter(agent => !agent.parentId);
  const root = { id: run.id, title: thread.title || run.prompt, task: run.prompt, kind: 'Root work item',
    status: run.status === 'running' && run.pending ? 'waiting' : run.status,
    agents: roots, createdAt: run.createdAt, completedAt: run.completedAt };
  columns[run.status === 'completed' ? workflow.length : current]?.cards.push(root);
  for (const agent of agents.filter(agent => agent.parentId)) {
    const status = agentStatus(agent, run);
    const parent = agents.find(entry => entry.id === agent.parentId);
    const card = { ...agent, title: agent.title || 'Subagent', kind: 'Subagent', status, agents: [agent],
      parentTitle: parent?.parentId ? parent.title || parent.id : root.title, parentCardId: parent?.parentId ? parent.id : run.id };
    columns[status === 'completed' ? workflow.length : agent.stageIndex]?.cards.push(card);
  }
  return columns;
}

function WorkCard({ card, selected, onSelect }) {
  return h('li', { className: 'bc-kanban-item' },
    h('button', { type: 'button', className: 'bc-kanban-work-card', 'aria-pressed': selected, onClick: onSelect },
      h('div', { className: 'bc-kanban-card-heading' }, h('small', null, card.kind), badge(card.status)),
      h('strong', { className: 'bc-kanban-title', title: card.title }, card.title),
      card.parentTitle ? h('small', { className: 'bc-kanban-parent', title: card.parentTitle }, `Parent: ${card.parentTitle}`) : null,
      h('small', null, [...new Set(card.agents.map(agent => agent.model).filter(Boolean))].join(' · ') || 'Agent details unavailable'),
      card.createdAt ? h('small', null, `Started ${when(card.createdAt)}`) : null));
}

function WorkDetails({ card, run, onSelect, onClose }) {
  return h('section', { className: 'bc-kanban-details bc-form', 'aria-label': 'Work item details' },
    h('div', { className: 'bc-kanban-details-header' },
      h('div', { className: 'bc-kanban-card-heading' }, h('h3', null, card.title), badge(card.status)),
      onClose ? h('button', { type: 'button', className: 'bc-icon bc-kanban-close', 'aria-label': 'Close details', title: 'Close details', onClick: onClose }, '×') : null),
    card.parentTitle ? h('button', { className: 'bc-kanban-parent-link', onClick: () => onSelect(card.parentCardId) }, `Parent: ${card.parentTitle}`) : null,
    card.task && card.task !== card.title ? h('p', { className: 'bc-preserve' }, card.task) : null,
    h('div', { className: 'bc-kanban-agent-details' }, card.agents.map(agent => h('article', { key: agent.id, className: 'bc-kanban-agent-card' },
      h('div', { className: 'bc-kanban-card-heading' },
        h('strong', null, agent.title || (agent.parentId ? 'Subagent' : `${(run?.workflow ?? DEFAULT_WORKFLOW)[agent.stageIndex]?.name ?? 'Work'} agent`)),
        card.agents.length > 1 ? badge(agentStatus(agent, run)) : null),
      h('small', { className: 'bc-muted' }, 'Agent ID ', h('code', null, agent.id)),
      agent.model ? h('small', null, agent.model) : null,
      agent.completedAt ? h('small', null, `Finished ${when(agent.completedAt)}`) : null))),
    card.kind === 'Root work item' ? (run?.stages ?? []).map((stage, index) => h('details', { key: index, className: 'bc-kanban-stage-result' },
      h('summary', null, `${stage.name} result`), stage.summary ? h(MarkdownText, { text: stage.summary, content: stage.summary }) : null,
      stage.tools?.length ? h('small', null, 'Tools: ' + stage.tools.map(tool => tool.name).join(', ')) : null))
      : card.summary ? h(MarkdownText, { text: card.summary, content: card.summary }) : null);
}

export function ThreadKanban({ thread, onConversation, onWorkflow, icon }) {
  const [runId, setRunId] = useState('');
  const [cardId, setCardId] = useState('');
  const runs = thread.runs ?? [];
  const run = runs.find(entry => entry.id === runId) ?? runs.at(-1);
  const columns = kanbanColumns(thread, run);
  const cards = columns.flatMap(column => column.cards);
  const selected = cardId === 'none' ? null : (cards.find(card => card.id === cardId) ?? cards.find(card => card.id === run?.id));
  const subagents = (run?.agents ?? []).filter(agent => agent.parentId);
  return h('div', { className: 'bc-kanban' },
    h('header', { className: 'bc-kanban-toolbar' },
      h('div', null, h('h3', null, processName((run ? run.workflow : thread.workflow) ?? DEFAULT_WORKFLOW)),
        h('p', { className: 'bc-muted' }, columns.map(stage => stage.name).join(' → '))),
      h('div', { className: 'bc-kanban-actions' },
        runs.length ? h('label', { className: 'bc-field bc-kanban-execution-field' }, h('span', null, 'Execution'),
          h('select', { value: runId, onChange: event => { setRunId(event.target.value); setCardId(''); } },
            h('option', { value: '' }, 'Latest execution'),
            [...runs].reverse().map(entry => h('option', { key: entry.id, value: entry.id },
              `${when(entry.createdAt)} · ${entry.prompt.slice(0, 60)}`)))) : null,
        h('button', { className: 'bc-kanban-settings-btn', onClick: onWorkflow, title: 'Process settings' }, icon ? icon('gear') : null, 'Process settings'))),
    run ? h('p', { className: 'bc-muted', role: 'status' },
      `Execution: ${labels[run.status] ?? run.status} · ` + (!run.agents || !run.agents.length && run.activityError
        ? 'Agent history unavailable' : `${run.agents.length - subagents.length} agents · ${subagents.length} subagents`),
      run.status === 'running' && run.pending ? h('button', { onClick: onConversation }, 'Respond in Conversation') : null) : null,
    run?.error ? h('p', { role: 'status' }, run.error) : null,
    run?.activityError ? h('p', { role: 'status', className: 'bc-muted' }, run.activityError) : null,
    h('div', { className: 'bc-kanban-board', role: 'region', 'aria-label': 'Process board', tabIndex: 0 },
      columns.map(stage => h('section', { key: stage.index, className: 'bc-kanban-column', 'aria-label': stage.name },
        h('header', null, h('h3', null, stage.name), h('small', null, count(stage.cards.length, 'work item'))),
        stage.cards.length ? h('ul', { className: 'bc-kanban-items', 'aria-label': `${stage.name} work items` },
          stage.cards.map(card => h(WorkCard, {
            key: card.id,
            card,
            selected: selected?.id === card.id,
            onSelect: () => setCardId(current => (current === card.id || (!current && card.id === run?.id)) ? 'none' : card.id),
          })))
          : h('p', { className: 'bc-muted bc-kanban-empty' }, 'No work')))),
    selected ? h(WorkDetails, { card: selected, run, onSelect: setCardId, onClose: () => setCardId('none') }) : null,
    !run ? h('div', { className: 'bc-kanban-empty-footer' },
      h('p', { className: 'bc-muted bc-kanban-empty-note' }, 'Stages and subagent tasks will track here once you start work in Conversation.'),
      h('button', { className: 'bc-primary', onClick: onConversation }, 'Start work in Conversation')) : null);
}
