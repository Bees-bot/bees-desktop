import { h, MarkdownText, useEffect, useState } from './runtime.js';
import { when, openExternal } from './common.js';
import { DEFAULT_WORKFLOW, processName, isChatWorkflow } from '../lib/thread-workflow.js';
import { labels } from './thread-kanban.js';

export { THREAD_PAGES } from '../lib/thread-layout.js';
export const THREAD_SETTINGS = [
  ['general', 'General'], ['transfer', 'Transfer'],
];
export const TEAM_SETTINGS = [
  ['general', 'General'], ['members', 'Members'], ['invitations', 'Invitations'],
  ['agents', 'Agents'], ['memory', 'Memory'], ['processes', 'Processes'], ['workflow', 'Workflow'], ['schedule', 'Schedules'],
  ['folders', 'Files & folders'], ['addons', 'Add-ons'], ['browser', 'Browser'],
];
export const GLOBAL_SETTINGS = [
  ['ai', 'AI connections'], ['credits', 'Credits & billing'], ['appearance', 'Appearance'], ['instructions', 'System instructions'],
  ['storage', 'Root folder'], ['organizations', 'Org settings'], ['account', 'Accounts'], ['phone', 'Use on your phone'],
];

const linked=text=>text.split(/(https:\/\/\S*[^\s.])/).map((part,i)=>i%2?h('a',{key:i,href:part,onClick:e=>{e.preventDefault();void openExternal(part);}},part):part);
export function PhoneSettings(){
  const [qr,setQr]=useState(),[error,setError]=useState(''),[busy,setBusy]=useState(true);
  const call=async on=>{setBusy(true);setError('');try{const response=await fetch('/bees-api/phone',on===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({on})});const value=await response.json();if(!response.ok)throw Error(value.error);setQr(value.qr);}catch(e){setError(e.message||String(e));}finally{setBusy(false);}};
  useEffect(()=>{void call();},[]);
  return h('section',{className:'bc-form'},h('h3',null,'Use on your phone'),
    h('p',{className:'bc-muted'},linked('Install Tailscale on this computer and on your phone from https://tailscale.com/download and sign in to the same account on both. Then share Bees and scan the code with your phone camera.')),
    qr?h('div',{'aria-label':'Code to open Bees on your phone',role:'img',dangerouslySetInnerHTML:{__html:qr}}):null,
    qr?h('p',{className:'bc-muted'},'The code works until you stop sharing or quit Bees. After Bees restarts, scan it again.'):null,
    h('button',{className:qr?undefined:'bc-primary',disabled:busy,onClick:()=>call(!qr)},qr?'Stop sharing':'Share with my phone'),
    error?h('p',{className:'bc-error',role:'alert'},linked(error)):null,
    error?h('p',{className:'bc-muted'},linked('You can also open https://app.bees.bot/app on any phone, with no setup.')):null);
}

export function SettingsNav({ items, selected, onSelect, label }) {
  return h('nav', { className: 'bc-settings-nav', 'aria-label': label }, items.map(([id, title]) =>
    h('button', { key: id, type: 'button', 'aria-current': selected === id ? 'page' : undefined,
      onClick: () => onSelect(id) }, title)));
}

export function SettingsPage({title,items,selected,onSelect,onClose,children}){
  // escape closes settings, but not while typing in a field or when a dialog inside settings handles it
  useEffect(()=>{const key=e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!e.target.closest?.('input,textarea,select,dialog,details[open]'))onClose();};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[onClose]);
  return h('section',{className:'bc-settings-page','aria-label':title},
    h('header',{className:'bc-thread-header'},h('h2',null,title),h('button',{className:'bc-icon','aria-label':'Close settings',onClick:onClose},'×')),
    h('div',{className:'bc-settings-layout'},h(SettingsNav,{items,selected,onSelect,label:`${title} sections`}),h('div',{className:'bc-settings-content'},children)));
}

export function ThreadDetails({ thread, page, peerNames, userId, onSettings, onFiles }) {
  if (page === 'details') return h('section', { className: 'bc-form' },
    h('h3', null, 'Details'), h('p', null, thread.title), h('p', { className: 'bc-muted' }, 'Thread ID ', h('code', null, thread.id)),
    h('p', { className: 'bc-muted' }, `Created ${when(thread.createdAt)}`),
    h('h3', null, processName(thread.workflow)), [...(thread.workflow ?? DEFAULT_WORKFLOW), { name: isChatWorkflow(thread.workflow)?'Your turn → Chat ↻':'Done' }].map((stage, i) =>
      h('p', { key: i }, `${i + 1}. ${stage.name}`)),
    h('button', { onClick: () => onSettings('general') }, 'Thread settings'));
  if (page === 'context') return h('section', { className: 'bc-form' },
    h('h3', null, 'Instructions'), h('p', thread.instructions ? null : { className: 'bc-muted' }, thread.instructions || 'This thread has no instructions of its own. Team and system instructions still apply.'),
    h('p', { className: 'bc-muted' }, 'Bees uses this thread’s recent conversation, memory, and attached files for each run.'),
    h('h3', null, 'Memory'), ...(thread.memory?.length ? thread.memory.map((note, i) => h('p', { key: i }, note)) : [h('p', { key: 'none', className: 'bc-muted' }, 'Nothing saved yet.')]),
    h('button', { onClick: onFiles }, `Files (${thread.artifacts.length})`));
  return h('section', { className: 'bc-form' }, h('h3', null, page === 'traces' ? 'Activity' : 'Run history'),
    !thread.runs.length ? h('p', { className: 'bc-muted' }, 'No runs yet. Ask Bees to start work in Conversation.') : null,
    ...[...thread.runs].reverse().map(run => h('article', { className: 'bc-card bc-form', key: run.id },
      h('strong', null, run.prompt), h('small', null, `${labels[run.status] ?? run.status} · ${when(run.createdAt)}`),
      run.error ? h('p', { role: 'status' }, run.error) : null,
      ...(run.stages ?? []).map((stage, index) => h('details', { key: index }, h('summary', null, stage.name),
        stage.summary ? h(MarkdownText, { text: stage.summary, content: stage.summary }) : null,
        page === 'traces' ? h('ul', null, ...(stage.tools ?? []).map((tool, i) => h('li', { key: i }, tool.name))) : null)),
      page === 'traces' ? (run.decisions ?? []).map(decision => h('p', { key: decision.id },
        `${decision.kind === 'approval' ? (decision.approved ? 'Approved' : 'Rejected') : 'Question answered'} · ${peerNames.get(decision.actorId) ?? (decision.actorId === userId || decision.actorId === 'local' ? 'You' : decision.actorId)} · ${when(decision.answeredAt)}`)) : null)));
}
