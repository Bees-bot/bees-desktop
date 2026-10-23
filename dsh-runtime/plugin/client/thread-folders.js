import { h, useEffect, useState } from './runtime.js';

export function RootFolderSettings({ ctx, folders, organization, busy, onSave }) {
  const row = organization && folders?.organizations.find(row => row.id === organization.id);
  const current = organization ? row?.folder : folders?.root;
  const [directory, setDirectory] = useState(current ?? ''), [error, setError] = useState('');
  useEffect(() => { setDirectory(current ?? ''); setError(''); }, [current, organization?.id]);
  const editable = folders?.editable && (!organization || ['owner','admin'].includes(organization.role));
  const choose = async () => {
    try {
      const invoke = window.__TAURI__?.core?.invoke;
      const picked = invoke ? await invoke('plugin:dialog|open', { options: { directory: true, multiple: false, defaultPath: current } }) : await ctx?.uiWorkspace?.pickDirectory();
      if (typeof picked === 'string') setDirectory(picked);
    } catch (error) { setError(error.message || String(error)); }
  };
  return h('section', { className: 'bc-form' }, h('h3', null, organization ? 'Org root folder' : 'Root folder'),
    h('p', { className: 'bc-muted' }, organization ? 'This organization uses the global root folder unless you choose an override on this computer.' : 'Bees automatically creates a folder for your work the first time it opens. Change it here whenever you need to.'),
    h('p', { style: { overflowWrap: 'anywhere' } }, current || 'Loading folder settings…'),
    folders?.missing ? h('p', { role: 'alert' }, 'The root folder is unavailable. Reconnect it or choose another folder.') : null,
    folders?.editable === false ? h('p', { className: 'bc-muted' }, 'The hosted client manages this folder. Desktop clients can choose a folder on their own computer.') : null,
    editable ? h('form', { className: 'bc-form', onSubmit: event => { event.preventDefault(); if (!busy) void onSave({ directory, ...(organization ? { organizationId: organization.id } : {}) }); } },
      h('label', { className: 'bc-field' }, h('span', null, 'Folder path'), h('input', { required: true, value: directory, disabled: busy, onChange: event => setDirectory(event.target.value) })),
      h('p', { className: 'bc-muted' }, 'Stop running work before changing folders. Existing run files are copied and their originals are kept. Private account data stays in Bees application storage.'),
      h('div', { className: 'bc-actions' },
        h('button', { type: 'button', disabled: busy, onClick: choose }, 'Choose folder'),
        h('button', { type: 'submit', className: 'bc-primary', disabled: busy || !directory.trim() }, 'Save folder'),
        row?.override ? h('button', { type: 'button', disabled: busy, onClick: () => onSave({ directory: null, organizationId: organization.id }) }, 'Use global root folder') : null)) : null,
    error ? h('p', { role: 'alert' }, error) : null);
}
