import { h } from './runtime.js';
import { DEFAULT_WORKFLOW, processName, isChatWorkflow } from '../lib/thread-workflow.js';

export { THREAD_PAGES } from '../lib/thread-layout.js';
export const THREAD_SETTINGS = [
  ['general', 'General'], ['transfer', 'Transfer'],
];
export const TEAM_SETTINGS = [
  ['general', 'General'], ['members', 'Members'], ['invitations', 'Invitations'],
  ['memory', 'Memory'], ['processes', 'Processes'], ['workflow', 'Workflow'], ['schedule', 'Schedules'],
  ['folders', 'Files & folders'], ['addons', 'MCP integrations'], ['browser', 'Browser'],
];
export const GLOBAL_SETTINGS = [
  ['ai', 'AI connections'], ['appearance', 'Appearance'], ['instructions', 'System instructions'],
  ['storage', 'Data & files'], ['organizations', 'Org settings'], ['account', 'Accounts'],
];

export function SettingsNav({ items, selected, onSelect, label }) {
  return h('nav', { className: 'bc-settings-nav', 'aria-label': label }, items.map(([id, title]) =>
    h('button', { key: id, type: 'button', 'aria-current': selected === id ? 'page' : undefined,
      onClick: () => onSelect(id) }, title)));
}

export function SettingsPage({title,items,selected,onSelect,onClose,children}){
  return h('section',{className:'bc-settings-page','aria-label':title},
    h('header',{className:'bc-thread-header'},h('h2',null,title),h('button',{className:'bc-icon','aria-label':'Close settings',onClick:onClose},'×')),
    h('div',{className:'bc-settings-layout'},h(SettingsNav,{items,selected,onSelect,label:`${title} sections`}),h('div',{className:'bc-settings-content'},children)));
}

export function ThreadDetails({ thread, page, onSettings, onFiles }) {
  if (page === 'details') return h('section', { className: 'bc-form' },
    h('h3', null, 'Details'), h('p', null, thread.title), h('code', null, thread.id),
    h('p', { className: 'bc-muted' }, `Created ${new Date(thread.createdAt).toLocaleString()}`),
    h('h3', null, processName(thread.workflow)), [...(thread.workflow ?? DEFAULT_WORKFLOW), { name: isChatWorkflow(thread.workflow)?'Your turn → Chat ↻':'Done' }].map((stage, i) =>
      h('p', { key: i }, `${i + 1}. ${stage.name}`)),
    h('button', { onClick: () => onSettings('general') }, 'Thread settings'));
  if (page === 'context') return h('section', { className: 'bc-form' },
    h('h3', null, 'Context'), h('p', null, thread.instructions || 'Complete the requested outcome.'),
    h('p', { className: 'bc-muted' }, 'Bees uses this thread’s recent conversation, memory, and attached files for each run.'),
    h('h3', null, 'Memory'), ...(thread.memory ?? []).map((note, i) => h('p', { key: i }, note)),
    h('button', { onClick: onFiles }, `Files (${thread.artifacts.length})`));
  return h('section', { className: 'bc-form' }, h('h3', null, page === 'traces' ? 'Traces' : 'Executions'),
    !thread.runs.length ? h('p', { className: 'bc-muted' }, 'No executions yet. Ask Bees to start work in Conversation.') : null,
    ...[...thread.runs].reverse().map(run => h('article', { className: 'bc-card bc-form', key: run.id },
      h('strong', null, run.prompt), h('small', null, `${run.status} · ${new Date(run.createdAt).toLocaleString()}`),
      run.error ? h('p', { role: 'status' }, run.error) : null,
      ...(run.stages ?? []).map((stage, index) => h('details', { key: index }, h('summary', null, stage.name),
        h('p', { className: 'bc-preserve' }, stage.summary),
        page === 'traces' ? h('ul', null, ...(stage.tools ?? []).map((tool, i) => h('li', { key: i }, tool.name))) : null)),
      page === 'traces' ? (run.decisions ?? []).map(decision => h('p', { key: decision.id },
        `${decision.kind === 'approval' ? (decision.approved ? 'Approved' : 'Rejected') : 'Question answered'} · ${decision.actorId} · ${new Date(decision.answeredAt).toLocaleString()}`)) : null)));
}
