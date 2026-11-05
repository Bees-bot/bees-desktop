import { h, useEffect, useRef, useState } from './runtime.js';

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
    h('p', { className: 'bc-muted' }, folders?.editable === false ? 'Bees keeps your work in a private folder in your cloud workspace. Desktop clients can choose a folder on their own computer.' : organization ? 'This organization uses the global root folder unless you choose an override on this computer.' : 'Bees automatically creates a folder for your work the first time it opens. Change it here whenever you need to.'),
    folders?.editable === false ? null : h('p', { style: { overflowWrap: 'anywhere' } }, current || 'Loading folder settings…'),
    folders?.missing ? h('p', { role: 'alert' }, 'The root folder is unavailable. Reconnect it or choose another folder.') : null,
    editable ? h('form', { className: 'bc-form', onSubmit: event => { event.preventDefault(); if (!busy) void onSave({ directory, ...(organization ? { organizationId: organization.id } : {}) }); } },
      h('label', { className: 'bc-field' }, h('span', null, 'Folder path'), h('input', { required: true, value: directory, disabled: busy, onChange: event => setDirectory(event.target.value) })),
      h('p', { className: 'bc-muted' }, 'Stop running work before changing folders. Existing run files are copied and their originals are kept. Private account data stays in Bees application storage.'),
      h('div', { className: 'bc-actions' },
        // dsh picks its chooser once at boot, so a phone added later by phone sharing would open finder on the mac
        window.__TAURI__ || location.hostname === '127.0.0.1' ? h('button', { type: 'button', disabled: busy, onClick: choose }, 'Choose folder') : null,
        h('button', { type: 'submit', className: 'bc-primary', disabled: busy || !directory.trim() }, 'Save folder'),
        row?.override ? h('button', { type: 'button', disabled: busy, onClick: () => onSave({ directory: null, organizationId: organization.id }) }, 'Use global root folder') : null)) : null,
    error ? h('p', { role: 'alert' }, error) : null);
}

export function SharedFolderSettings({ ctx, threadId, request, clients = [], participants = [], clientId, ownerClientId }) {
  const [view, setView] = useState(null), [error, setError] = useState('');
  const requestRef = useRef(request); requestRef.current = request;
  useEffect(() => {
    let alive = true;
    const load = () => requestRef.current('sharedFolders', threadId).then(value => { if (alive) { setView(value); setError(''); } }).catch(error => { if (alive) setError(error.message); });
    void load(); const timer = setInterval(load, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [threadId]);
  return h('section', { className: 'bc-form-section', 'aria-label': 'Shared folder locations' },
    h('h3', null, 'Shared folder locations'),
    h('p', { className: 'bc-muted' }, 'Map folders managed by Google Drive, SharePoint, or another file service. Each teammate can use a different local path. Recognition checks the folder identity; a synchronization check confirms files recently reached another client.'),
    error ? h('p', { role: 'alert' }, error) : null,
    view?.editable === false ? h('p', null, 'Choose shared folder locations in Bees Desktop.') : null,
    ...(view?.folders ?? []).map(folder => h(SharedFolderLocation, { key: folder.purpose, ctx, threadId, request, folder, canInitialize: view.canInitialize,
      clients: clients.filter(client => client.id !== clientId && !client.revoked_at && participants.some(person => person.thread_id === threadId && person.user_id === client.user_id)), ownerClientId, onChanged: setView })));
}

function SharedFolderLocation({ ctx, threadId, request, folder, canInitialize, clients, ownerClientId, onChanged }) {
  const [directory, setDirectory] = useState(folder.directory ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState(null);
  const [target, setTarget] = useState(ownerClientId);
  useEffect(() => { setDirectory(folder.directory ?? ''); setResult(null); }, [folder.directory]);
  const targetClientId = clients.some(client => client.id === target) ? target : clients[0]?.id ?? '';
  const label = folder.purpose === 'input' ? 'Input' : 'Output';
  const perform = async work => { setBusy(true); setError(''); setResult(null); try { await work(); } catch (error) { setError(error.message); } finally { setBusy(false); } };
  const save = initialize => perform(async () => onChanged(await request('setSharedFolder', threadId, { purpose: folder.purpose, directory, initialize })));
  const choose = () => perform(async () => {
    const invoke = window.__TAURI__?.core?.invoke;
    const picked = invoke ? await invoke('plugin:dialog|open', { options: { directory: true, multiple: false, defaultPath: folder.directory ?? undefined } }) : await ctx?.uiWorkspace?.pickDirectory();
    if (typeof picked === 'string') {
      setDirectory(picked);
      onChanged(await request('setSharedFolder', threadId, { purpose: folder.purpose, directory: picked }));
    }
  });
  return h('form', { className: 'bc-form', onSubmit: event => { event.preventDefault(); if (!busy) void save(false); } },
    h('h4', null, label + ' folder'),
    h('p', { role: 'status' }, ({ recognized: 'Folder recognized. Synchronization has not been confirmed by this identity check.', missing: 'Folder or identity marker unavailable. Reconnect the file service or locate the folder.', mismatch: 'Folder identity could not be verified. Locate the correct folder.', unmapped: 'No folder mapped on this computer.' })[folder.status]),
    h('label', { className: 'bc-field' }, h('span', null, label + ' folder path'), h('input', { value: directory, disabled: busy, onChange: event => { setDirectory(event.target.value); setResult(null); } })),
    h('div', { className: 'bc-actions' },
      h('button', { type: 'button', disabled: busy, onClick: choose }, 'Locate shared folder'),
      h('button', { type: 'submit', disabled: busy || !directory.trim() }, 'Use this folder'),
      canInitialize ? h('button', { type: 'button', disabled: busy || !directory.trim(), onClick: () => save(true) }, 'Set up folder') : null,
      folder.directory ? h('button', { type: 'button', disabled: busy, onClick: () => perform(async () => onChanged(await request('setSharedFolder', threadId, { purpose: folder.purpose, directory: null }))) }, 'Disconnect mapping') : null),
    h('p', { className: 'bc-muted' }, 'Changing this mapping keeps the old folder and its marker. Files are not moved or imported. Set up folder writes an identity marker; teammates should locate that same externally shared folder.'),
    folder.status === 'recognized' && clients.length ? h('div', { className: 'bc-actions' },
      h('label', { className: 'bc-field' }, h('span', null, 'Check ' + label.toLowerCase() + ' synchronization with'), h('select', { value: targetClientId, disabled: busy, onChange: event => { setTarget(event.target.value); setResult(null); } }, ...clients.map(client => h('option', { key: client.id, value: client.id }, client.name || client.id)))),
      h('button', { type: 'button', disabled: busy || !targetClientId, onClick: () => perform(async () => setResult(await request('probeSharedFolder', threadId, { purpose: folder.purpose, targetClientId }))) }, busy ? 'Checking…' : 'Check synchronization')) : null,
    result ? h('p', { role: 'status' }, result.status === 'confirmed' ? 'Synchronization confirmed in both directions for this check.' : 'Synchronization not confirmed. The other client or file service may be offline or still synchronizing.') : null,
    error ? h('p', { role: 'alert' }, error) : null);
}
