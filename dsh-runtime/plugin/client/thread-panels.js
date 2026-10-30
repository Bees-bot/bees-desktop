import { h, useEffect, useState, MarkdownText } from './runtime.js';
import { when } from './common.js';
import { DEFAULT_WORKFLOW, processName, isChatWorkflow } from '../lib/thread-workflow.js';
import { labels } from './thread-kanban.js';
import { ReviewScreen } from './thread-review.js';

export { THREAD_PAGES } from '../lib/thread-layout.js';
export const THREAD_SETTINGS = [
  ['general', 'General'], ['transfer', 'Transfer'],
];
export const TEAM_SETTINGS = [
  ['general', 'General'], ['members', 'Members & Invites'], ['processes', 'Processes'],
  ['agents', 'Agents'], ['memory', 'Memory'], ['schedule', 'Schedules'],
  ['folders', 'Files & folders'], ['addons', 'Add-ons'], ['browser', 'Browser'],
];
export const GLOBAL_SETTINGS = [
  ['ai', 'AI connections'], ['credits', 'Credits & billing'], ['appearance', 'Appearance'], ['instructions', 'System instructions'],
  ['storage', 'Root folder'],
];

export function SentInvitations({ invitations = [], scope }) {
  const access = scope === 'team' ? { viewer: 'Can view', editor: 'Can contribute and run work' } : { member: 'Member', admin: 'Admin' };
  return h('section', { className: 'bc-form bc-card', 'aria-label': 'Pending invitations' },
    h('h3', null, `Sent invitations (${invitations.length})`),
    h('p', { className: 'bc-muted' }, `People invited to this ${scope} who haven’t joined yet.`),
    invitations.length ? h('div', { className: 'bc-invitation-table' },
      h('table', null, h('thead', null, h('tr', null, ...['Email', 'Access', 'Status', 'Expires'].map(label => h('th', { key: label, scope: 'col' }, label)))),
        h('tbody', null, invitations.map(invite => {
          const expires = new Date(invite.expires_at), validDate = Number.isFinite(expires.getTime());
          return h('tr', { key: invite.id }, h('td', null, invite.email), h('td', null, access[invite.role] ?? invite.role),
            h('td', null, h('span', { className: 'bc-invitation-status' }, 'Pending')),
            h('td', null, validDate ? h('time', { dateTime: expires.toISOString() }, expires.toLocaleDateString()) : '—'));
        })))) : h('p', { className: 'bc-muted' }, 'No pending invitations.'));
}

export function SettingsNav({ items, groups, selected, onSelect, label }) {
  if (groups) {
    return h('nav', { className: 'bc-settings-nav', 'aria-label': label },
      groups.map((group, gIdx) => h('div', { key: group.title || gIdx, className: 'bc-settings-nav-group' },
        h('div', { className: 'bc-settings-group-header' },
          h('span', null, group.title),
          group.extra || null
        ),
        group.selector || null,
        group.items.map(([id, title]) =>
          h('button', {
            key: id,
            type: 'button',
            'aria-current': selected === id ? 'page' : undefined,
            onClick: () => onSelect(id, group.scope)
          }, title)
        )
      ))
    );
  }
  return h('nav', { className: 'bc-settings-nav', 'aria-label': label }, (items ?? []).map(([id, title]) =>
    h('button', { key: id, type: 'button', 'aria-current': selected === id ? 'page' : undefined,
      onClick: () => onSelect(id) }, title)));
}

export function SettingsPage({title,items,groups,selected,onSelect,onClose,children}){
  const hasNav = !!(groups?.length || items?.length);
  // escape closes settings, but not while typing in a field or when a dialog inside settings handles it
  useEffect(()=>{const key=e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!e.target.closest?.('input,textarea,select,dialog,details[open]'))onClose();};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[onClose]);
  return h('section',{className:'bc-settings-page','aria-label':title},
    h('header',{className:'bc-thread-header bc-settings-header'},
      h('h2',null,title),
      h('button',{className:'bc-icon','aria-label':'Close settings',title:'Close settings (Esc)',onClick:onClose},'×')),
    h('div',{className:`bc-settings-layout${hasNav?'':' bc-no-nav'}`},
      hasNav?h(SettingsNav,{items,groups,selected,onSelect,label:`${title} sections`}):null,
      h('div',{className:'bc-settings-content'},children)));
}

export function ThreadDetails({ thread, page, peerNames, userId, onSettings, onFiles, teamInstructions, canConfigure, busy, onSave }) {
  const [editing, setEditing] = useState(null);
  if (page === 'details') return h('section', { className: 'bc-form' },
    h('h3', null, 'Details'), h('p', null, thread.title), h('p', { className: 'bc-muted' }, 'Thread ID ', h('code', null, thread.id)),
    h('p', { className: 'bc-muted' }, `Created ${when(thread.createdAt)}`),
    h('h3', null, `Process: ${processName(thread.workflow)}`), [...(thread.workflow ?? DEFAULT_WORKFLOW), { name: isChatWorkflow(thread.workflow)?'Your turn → Chat ↻':'Done' }].map((stage, i) =>
      h('p', { key: i }, `${i + 1}. ${stage.name}`)),
    h('button', { onClick: () => onSettings('general') }, 'Thread settings'));
  if (page === 'context') return h('section', { className: 'bc-form' },
    h('h3', null, 'Instructions'), h('p', { className: thread.instructions ? 'bc-preserve' : 'bc-muted' }, thread.instructions || 'This thread has no instructions of its own. Team and system instructions still apply.'),
    canConfigure ? editing === null ? h('button', { type: 'button', disabled: busy, onClick: () => setEditing(thread.instructions ?? '') }, thread.instructions ? 'Edit instructions' : 'Add instructions')
      : h('form', { className: 'bc-form', onSubmit: async event => {
        event.preventDefault(); if (busy || !canConfigure) return;
        if (await onSave({ instructions: editing })) setEditing(null);
      } }, h('fieldset', { className: 'bc-form bc-fieldset', disabled: busy },
        h('label', { className: 'bc-field' }, h('span', null, 'Instructions for this thread'),
          h('textarea', { rows: 6, maxLength: 20000, autoFocus: true, value: editing, onChange: event => setEditing(event.target.value) })),
        h('p', { className: 'bc-muted' }, 'Applies to new runs in this thread. Team and system instructions still apply.'),
        h('div', { className: 'bc-actions' }, h('button', { type: 'submit', className: 'bc-primary' }, busy ? 'Saving…' : 'Save instructions'),
          h('button', { type: 'button', onClick: () => setEditing(null) }, 'Cancel')))) : null,
    teamInstructions ? h('div', null, h('h4', null, 'Team instructions'), h('p', { className: 'bc-preserve' }, teamInstructions)) : null,
    h('p', { className: 'bc-muted' }, 'Bees uses this thread’s recent conversation, memory, and attached files for each run.'),
    h('h3', null, 'Memory'), ...(thread.memory?.length ? thread.memory.map((note, i) => h('p', { key: i }, note)) : [h('p', { key: 'none', className: 'bc-muted' }, 'Nothing saved yet.')]),
    h('button', { onClick: onFiles }, `Files (${thread.artifacts.length})`));
  return h('section', { className: 'bc-form' }, h('h3', null, page === 'traces' ? 'Activity' : 'Run history'),
    !thread.runs.length ? h('p', { className: 'bc-muted' }, 'No runs yet. Ask Bees to start work in Conversation.') : null,
    ...[...thread.runs].reverse().map(run => h('article', { className: 'bc-card bc-form', key: run.id },
      h('strong', null, run.prompt), h('small', null, `${labels[run.status] ?? run.status} · ${when(run.createdAt)}`),
      run.error ? h('p', { role: 'status' }, run.error) : null,
      ...(run.reviews ?? []).map(review => h('details', { key: review.id }, h('summary', null, review.request.title, ' · ', review.state.replaceAll('_', ' ')),
        h(ReviewScreen, { review, runId: run.id, readOnly: true }))),
      ...(run.stages ?? []).map((stage, index) => h('details', { key: index }, h('summary', null, stage.name),
        stage.summary ? h(MarkdownText, { text: stage.summary, content: stage.summary }) : null,
        page === 'traces' ? h('ul', null, ...(stage.tools ?? []).map((tool, i) => h('li', { key: i }, tool.name))) : null)),
      page === 'traces' ? (run.decisions ?? []).map(decision => h('p', { key: decision.id },
        `${decision.kind === 'approval' ? (decision.approved ? 'Approved' : 'Rejected') : decision.kind === 'review' ? 'Review: ' + decision.decision.replaceAll('_', ' ') : 'Question answered'} · ${peerNames.get(decision.actorId) ?? (decision.actorId === userId || decision.actorId === 'local' ? 'You' : decision.actorId)} · ${when(decision.answeredAt)}`)) : null)));
}
