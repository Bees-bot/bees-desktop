import { h, useEffect, useRef, useState, hosted } from './runtime.js';
import { openExternal, confirmAction } from './common.js';

export async function composioConnectionError(error, request) {
  if (error.status !== 401) return error;
  try {
    await request('organizations');
    return Object.assign(Error('You are signed in, but this Bees Server does not support app connections yet. Update Bees Server to use Composio apps.'), { status: 424 });
  } catch (accountError) { return accountError; }
}

export function IntegrationSettings({ threadId, canManage, signedIn, onSignIn, request, perform, page = 'addons', scope='team' }) {
  const [data, setData] = useState(null), [catalogId, setCatalogId] = useState('playwright');
  const [transport, setTransport] = useState('stdio'), [notice, setNotice] = useState('');
  const load = async () => setData(await request('integrations', threadId));
  useEffect(() => { if (canManage) void perform(load); }, [threadId, canManage]);
  if (!canManage) return h('p', { className: 'bc-muted' }, 'Team owners and editors can manage add-ons on their own computers.');
  if (!data) return h('p', { role: 'status' }, 'Loading add-ons…');
  const entry = data.catalog.find(row => row.id === catalogId);
  const provider = data.servers.find(server => server.catalogId === 'composio');
  const access = async enabled => {
    if (provider?.enabled === enabled) return;
    setData(await request(provider ? 'toggleIntegration' : 'saveIntegration', threadId,
      provider ? { serverId: provider.id, enabled } : { catalogId: 'composio' }));
  };
  const change = (action, values) => perform(async () => { setNotice(''); setData(await request(action, threadId, values)); setNotice('Saved. Changes apply to the next run.'); });
  const save = event => {
    event.preventDefault();
    const form = event.currentTarget, values = new FormData(form), connect = event.nativeEvent.submitter?.value === 'google';
    void perform(async () => {
      setNotice('');
      const secrets = entry ? Object.fromEntries([...entry.env, ...entry.headers].map(key => [key.name, String(values.get('secret:' + key.name) ?? '')])) : JSON.parse(String(values.get('secrets') || '{}'));
      const input = { catalogId: catalogId || undefined, transport, label: values.get('label'), serverName: values.get('serverName'),
        command: values.get('command'), args: String(values.get('args') || '').split('\n').filter(Boolean), url: values.get('url'), secrets,
        inputs: Object.fromEntries(['apiBaseUrl', 'openapiSpec'].map(key => [key, values.get(key)])) };
      if (connect) {
        const result = await request('connectGoogle', threadId, input); await openExternal(result.url);
        setNotice('Finish Google sign-in in your browser, then refresh connections.');
      } else { setData(await request('saveIntegration', threadId, input)); form.reset(); setNotice('Connected. The next run will use this add-on.'); }
    });
  };
  const field = (label, name, extra = {}) => h('label', { className: 'bc-field', key: name }, h('span', null, label), h('input', { name, ...extra }));
  if (page === 'browser') return h('section', { className: 'bc-form' },
    h('h3', null, 'Browser'), h('label', { className: 'bc-check' },
      h('input', { type: 'checkbox', role: 'switch', checked: data.browser.mode === 'personal', disabled: !data.browser.personalAvailable,
        onChange: event => change('setBrowser', { mode: event.target.checked ? 'personal' : 'own' }) }), 'Use your own browser'),
    h('p', { className: 'bc-muted' }, data.browser.mode === 'personal'
      ? `Runs use their own tabs in ${data.browser.name}, with your existing sign-ins. ${data.browser.setup}`
      : 'Runs use an isolated browser. Your personal browser and sign-ins stay separate.'),
    !data.browser.personalAvailable ? h('p', { className: 'bc-muted' }, hosted
      ? 'Personal browser access works only in the Bees desktop app.'
      : 'Personal browser access requires a supported Chromium browser as your Mac’s default browser.') : null,
    data.browser.warning ? h('p', { className: 'bc-muted' }, data.browser.warning) : null,
    h('p', null, 'Turn on Browser or Chrome DevTools in Add-ons to give every thread in this team browser tools.'),
    !hosted && data.browser.mode === 'personal' ? h('button', { onClick: () => perform(() => request('openBrowser', threadId)) }, 'Open browser') : null,
    notice ? h('p', { role: 'status' }, notice) : null);
  return h('section', { className: 'bc-form' }, h('h3', null, 'Add-ons'),
    h('p', { className: 'bc-muted' }, scope === 'team' ? 'Connect apps and tools for every thread in this team.' : 'Connect apps and tools for this thread.'),
    h(ComposioApps, { threadId, signedIn, onSignIn, request, provider, onAccess: access, scope }),
    h('div', { className: 'bc-addon-heading' }, h('h3', null, 'MCP add-ons'),
      data.servers.some(server => server.catalogId !== 'composio') ? h('button', { onClick: () => perform(load) }, 'Refresh') : null),
    ...data.servers.filter(server => server.catalogId !== 'composio').map(server => h('div', { className: 'bc-card bc-addon-row', key: server.id },
      h('div', null, h('strong', null, server.label), h('small', null, server.serverName)),
      h('div', { className: 'bc-actions' }, h('label', { className: 'bc-check' }, h('input', {
        type: 'checkbox', checked: server.enabled, onChange: event => change('toggleIntegration', { serverId: server.id, enabled: event.target.checked }),
      }), 'Enabled'), h('button', { onClick: async () => { if (await confirmAction(`Remove ${server.label}? Bees stops using it here.`, 'Remove')) change('removeIntegration', { serverId: server.id }); } }, 'Remove')))),
    h('details', { className: 'bc-form bc-mcp-add' }, h('summary', null, 'Add an MCP add-on'),
    h('label', { className: 'bc-field' }, h('span', null, 'Add-on'),
      h('select', { value: catalogId, onChange: event => setCatalogId(event.target.value) },
        data.catalog.filter(row => row.id !== 'composio').map(row => h('option', { value: row.id, key: row.id }, row.label)), h('option', { value: '' }, 'Custom MCP server'))),
    h('form', { key: catalogId, className: 'bc-form', onSubmit: save },
      entry ? h('p', { className: 'bc-muted' }, entry.summary) : null,
      entry ? h('p', { className: 'bc-muted' }, entry.access) : null,
      entry?.prerequisite ? h('p', { className: 'bc-muted' }, entry.prerequisite) : null,
      entry?.requiresDirectory ? h('p', null, 'This add-on uses the thread’s run folder and its uploaded files.') : null,
      field('Name', 'label', { defaultValue: entry?.label ?? '', required: true, pattern: '.*\\S.*', title: 'Give the add-on a name.' }),
      field('Server name', 'serverName', { defaultValue: entry?.serverName ?? '', required: true, pattern: '[a-zA-Z0-9_\\-]{1,32}', title: 'Use 1 to 32 letters, numbers, dashes or underscores, with no spaces.' }),
      !entry ? h('label', { className: 'bc-field' }, h('span', null, 'Transport'), h('select', { value: transport, onChange: event => setTransport(event.target.value) },
        h('option', { value: 'stdio' }, 'Local command (stdio)'), h('option', { value: 'streamable-http' }, 'Streamable HTTP'))) : null,
      !entry && transport === 'stdio' ? [field('Command', 'command', { required: true }), h('label', { className: 'bc-field', key: 'args' },
        h('span', null, 'Arguments · one per line'), h('textarea', { name: 'args', rows: 3 }))] : null,
      !entry && transport === 'streamable-http' ? field('Server URL', 'url', { type: 'url', required: true }) : null,
      !entry ? h('label', { className: 'bc-field' }, h('span', null, transport === 'stdio' ? 'Environment credentials (JSON)' : 'HTTP headers (JSON)'),
        h('textarea', { name: 'secrets', rows: 3, defaultValue: '{}', autoComplete: 'off', spellCheck: false })) : null,
      entry?.id === 'openapi-bridge' ? [field('API base URL', 'apiBaseUrl', { type: 'url', required: true }), field('OpenAPI spec URL', 'openapiSpec', { type: 'url', required: true })] : null,
      entry ? [...entry.env, ...entry.headers].map(key => field(entry.scopes ? key.name.replaceAll('_', ' ') : key.label, 'secret:' + key.name,
        { type: 'password', autoComplete: 'off', required: !key.optional && !entry.scopes })) : null,
      entry?.scopes && !hosted ? h('button', { type: 'submit', value: 'google', className: 'bc-primary', formNoValidate: true }, 'Connect with Google') : null,
      h('button', { type: 'submit', className: 'bc-primary' }, 'Connect add-on'))),
    notice ? h('p', { role: 'status' }, notice) : null);
}

export function ComposioApps({ threadId, signedIn, onSignIn, request, provider, onAccess, scope = 'team' }) {
  const [search, setSearch] = useState(''), [apps, setApps] = useState(null);
  const [pending, setPending] = useState(''), [error, setError] = useState(null), [notice, setNotice] = useState('');
  const [connecting, setConnecting] = useState(null);
  const generation = useRef(0), enabled = !!provider?.enabled;
  const browse = async cursor => {
    const current = ++generation.current, query = cursor ? apps.query : search;
    setPending('loading'); setError(null);
    try {
      const page = await request('composioApps', threadId, { search: query, cursor });
      if (current === generation.current) {
        setApps(previous => ({ ...page, query, items: cursor ? [...previous.items, ...page.items] : page.items }));
        if (connecting && page.items.some(app => app.slug === connecting.slug && app.connected)) {
          setConnecting(null); setNotice(`${connecting.name} connected.`);
        } else if (!connecting) setNotice('');
      }
    } catch (error) { const problem = await composioConnectionError(error, request); if (current === generation.current) setError(problem); }
    finally { if (current === generation.current) setPending(''); }
  };
  useEffect(() => {
    setApps(null); setError(null); setPending(''); setConnecting(null);
    if (signedIn) void browse();
    return () => { generation.current++; };
  }, [threadId, signedIn]);
  useEffect(() => {
    if (!signedIn || !connecting) return;
    let stopped = false, checking = false, timer, attempts = 0;
    const check = async () => {
      if (stopped || checking) return;
      clearTimeout(timer); checking = true;
      try {
        const page = await request('composioApps', threadId, { search: connecting.slug });
        if (stopped) return;
        const app = page.items.find(app => app.slug === connecting.slug);
        if (app?.connected) {
          setApps(previous => previous && ({ ...previous, items: previous.items.map(item => item.slug === app.slug ? app : item) }));
          setConnecting(null); setNotice(`${connecting.name} connected.`);
        } else if (++attempts < 60) timer = setTimeout(check, 5000);
        else {
          setConnecting(null); setNotice(`Still waiting for ${connecting.name}. Select Refresh after finishing sign-in, or Connect to try again.`);
        }
      } catch (error) {
        const problem = await composioConnectionError(error, request);
        if (!stopped) { setConnecting(null); setError(problem); }
      } finally { checking = false; }
    };
    timer = setTimeout(check, 1500);
    window.addEventListener('focus', check);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener('focus', check); };
  }, [connecting, threadId, signedIn]);
  const act = async (key, action) => {
    if (pending) return;
    setPending(key); setError(null); setNotice('');
    try { await action(); } catch (error) { setError(await composioConnectionError(error, request)); } finally { setPending(''); }
  };
  const connect = app => act(app.slug, async () => {
    await onAccess(true);
    if (app.connected || app.noAuth) { setNotice(`${app.name} is ready for this ${scope}.`); return; }
    const { url } = await request('connectComposioApp', threadId, { toolkit: app.slug });
    await openExternal(url);
    setConnecting(app);
    setNotice(`Finish connecting ${app.name} in your browser. Its status will update automatically.`);
  });
  const needsSignIn = !signedIn || error?.status === 401;
  return h('section', { className: 'bc-form bc-app-connections', 'aria-label': 'Apps' },
    h('div', { className: 'bc-addon-heading' }, h('div', null, h('h3', null, 'Apps'),
      h('p', { className: 'bc-muted' }, 'Gmail, Slack, Notion, and more. Powered by Composio.')),
      provider ? h('label', { className: 'bc-check' }, h('input', { type: 'checkbox', role: 'switch', checked: enabled,
        disabled: !!pending, onChange: event => void act('access', () => onAccess(event.target.checked)) }), `Use in this ${scope}`) : null),
    needsSignIn ? h('div', { className: 'bc-card bc-form' },
      h('strong', null, 'Connect your apps'),
      h('p', { className: 'bc-muted' }, error?.status === 401 ? 'Your Bees session has expired. Sign in again to reconnect your apps.' : 'Sign in to Bees to browse apps and securely connect your accounts.'),
      h('button', { className: 'bc-primary', onClick: onSignIn }, error?.status === 401 ? 'Sign in again' : 'Sign in to Bees'))
      : h('div', { className: 'bc-form' },
        h('form', { className: 'bc-actions', onSubmit: event => { event.preventDefault(); if (!pending) void browse(); } },
          h('input', { type: 'search', 'aria-label': 'Search apps', placeholder: 'Search apps…', maxLength: 80,
            value: search, onChange: event => setSearch(event.target.value) }),
          h('button', { type: 'submit', disabled: !!pending }, 'Search'),
          h('button', { type: 'button', disabled: !!pending, onClick: () => void browse() }, 'Refresh')),
        error ? h('div', { className: 'bc-card bc-form', role: 'alert' },
          h('p', null, error.message), h('button', { disabled: !!pending, onClick: () => void browse() }, 'Try again')) : null,
        pending === 'loading' ? h('p', { role: 'status', className: 'bc-muted' }, 'Loading apps…') : null,
        notice ? h('p', { role: 'status' }, notice) : null,
        apps && !apps.items.length ? h('p', { className: 'bc-muted' }, 'No matching apps. Try another name.') : null,
        apps ? h('div', { className: 'bc-composio-grid', 'aria-busy': pending === 'loading' }, apps.items.map(app =>
          h('article', { className: 'bc-card bc-composio-app', key: app.slug },
            h('div', { className: 'bc-app-title' }, h('span', { className: 'bc-app-symbol', 'aria-hidden': true }, app.name.slice(0, 1)), h('strong', null, app.name)),
            app.description ? h('p', { className: 'bc-muted' }, app.description) : null,
            enabled && (app.connected || app.noAuth) ? h('small', null, app.connected ? 'Connected' : 'Ready to use')
              : h('button', { disabled: !!pending || connecting?.slug === app.slug, onClick: () => void connect(app) }, connecting?.slug === app.slug ? 'Waiting for sign-in…' : pending === app.slug ? 'Connecting…' : app.connected || app.noAuth ? `Use in this ${scope}` : 'Connect')))) : null,
        apps?.nextCursor ? h('button', { disabled: !!pending, onClick: () => void browse(apps.nextCursor) }, 'Show more apps') : null,
        h('small', null, `Connections belong to your Bees account. Connecting an app lets agents in this ${scope} use it.`)));
}
