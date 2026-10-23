import { h, useEffect, useState } from './runtime.js';
import { ask, confirmAction } from './common.js';

export function TeamMemory({ teamId, canManage, request }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () => request('memory_status', teamId).then(value => { if (active) { setData(value); setError(''); } }, error => { if (active) setError(error.message); });
    void load(); const timer = setInterval(load, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [teamId]);
  const change = async (action, values = {}) => {
    if (busy) return; setBusy(true); setError('');
    try { const result = await request(action, teamId, values); setData(result); return true; }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  return h('section', { className: 'bc-form' }, h('h3', null, 'Automatic team memory'),
    h('p', { className: 'bc-muted' }, 'Hindsight recalls past outcomes and lessons for new work in this team. Completed goals are saved automatically; chats are not. Memory is enabled by default and kept on this client.'),
    h('p', { className: 'bc-muted' }, 'Local memory uses a running local AI model. Its first setup downloads Hindsight and its dependencies. Queued outcomes are kept while the model or service is unavailable.'),
    h('p', { role: 'status' }, data?.status ?? 'Loading memory…'),
    error ? h('p', { role: 'alert' }, error) : null,
    data ? h('form', { key: `${teamId}:${data.url}:${data.model}:${data.enabled}`, className: 'bc-form', onSubmit: async event => {
      event.preventDefault(); if (!canManage || busy) return;
      const form = event.currentTarget, values = new FormData(form);
      if (await change('memory_configure', { url: values.get('url'), model: values.get('model') ?? undefined, enabled: values.get('enabled') === 'on', apiKey: values.get('apiKey'), clearKey: values.get('clearKey') === 'on' })) form.elements.apiKey.value = '';
    } }, h('fieldset', { className: 'bc-form bc-fieldset', disabled: !canManage || busy },
      h('label', { className: 'bc-check' }, h('input', { type: 'checkbox', name: 'enabled', defaultChecked: data.enabled }), 'Enable automatic memory'),
      data.managed ? h('label', { className: 'bc-field' }, h('span', null, 'Local AI model'), h('select', { name: 'model', defaultValue: data.model || '' },
        h('option', { value: '' }, 'Automatic (running local model)'),
        data.model && !data.models.some(model => model.id === data.model) ? h('option', { value: data.model }, 'Selected model (not connected)') : null,
        data.models.map(model => h('option', { key: model.id, value: model.id }, model.name)))) : null,
      data.activeModel ? h('small', null, 'Using ' + data.activeModel) : null,
      h('details', null, h('summary', null, 'Advanced: custom Hindsight service'),
        h('p', { className: 'bc-muted' }, 'A custom endpoint receives remembered outcomes and queries. Its credentials stay on this client.'),
        h('label', { className: 'bc-field' }, h('span', null, 'Hindsight URL'), h('input', { type: 'url', required: true, name: 'url', defaultValue: data.url })),
        h('label', { className: 'bc-field' }, h('span', null, 'API key (blank keeps the saved key)'), h('input', { type: 'password', name: 'apiKey', autoComplete: 'new-password' })),
        h('label', { className: 'bc-check' }, h('input', { type: 'checkbox', name: 'clearKey' }), 'Remove saved API key')),
      h('div', { className: 'bc-actions' }, h('button', { type: 'submit', className: 'bc-primary' }, 'Save memory settings'),
        h('button', { type: 'button', disabled: !data.enabled, onClick: () => change('memory_test') }, 'Test connection'),
        h('button', { type: 'button', disabled: !data.enabled, onClick: () => change('memory_retry') }, 'Retry synchronization')))) : null,
    h('h4', null, 'Remembered outcomes'),
    data && !data.memories.length ? h('p', { className: 'bc-muted' }, 'Completed goals will appear here.') : null,
    data?.memories.map(memory => h('details', { key: memory.id, className: 'bc-card' },
      h('summary', null, memory.content.slice(0, 100), ' · ', memory.status),
      h('p', { style: { whiteSpace: 'pre-wrap' } }, memory.content), h('small', null, memory.evidence),
      memory.error ? h('p', { role: 'status' }, memory.error) : null,
      canManage ? h('div', { className: 'bc-actions' },
        h('button', { disabled: busy || memory.status === 'deleting', onClick: async () => { const content = await ask('Correct remembered outcome', memory.content, 'textarea'); if (content) await change('memory_edit', { id: memory.id, content }); } }, 'Edit'),
        h('button', { disabled: busy || memory.status === 'deleting', onClick: async () => { if (await confirmAction('Forget this outcome? The original thread is kept.')) await change('memory_delete', { id: memory.id }); } }, 'Forget')) : null)));
}
