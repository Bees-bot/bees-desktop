import { h, React, useEffect, useState, hosted } from './runtime.js';
import { openExternal } from './common.js';

export function IntegrationSettings({ threadId, canManage, signedIn, request, perform, page = 'addons', scope='team' }) {
  const [data, setData] = useState(null), [catalogId, setCatalogId] = useState('playwright');
  const [transport, setTransport] = useState('stdio'), [notice, setNotice] = useState('');
  const [search, setSearch] = useState(''), [apps, setApps] = useState(null), [appsBusy, setAppsBusy] = useState(false), [connecting, setConnecting] = useState(null);
  const load = async () => setData(await request('integrations', threadId));
  useEffect(() => { if (canManage) void perform(load); }, [threadId, canManage]);
  const composioEnabled = data?.servers.some(server => server.catalogId === 'composio' && server.enabled);
  const browse = cursor => void perform(async () => {
    setAppsBusy(true);
    try {
      const query = cursor ? apps?.query ?? search : search;
      const page = await request('composioApps', threadId, { search: query, cursor });
      setApps(previous => cursor ? { items: [...(previous?.items ?? []), ...page.items], nextCursor: page.nextCursor, query }
        : { ...page, query });
    } finally { setAppsBusy(false); }
  });
  useEffect(() => { if (page === 'addons' && composioEnabled && signedIn) browse(); else setApps(null); }, [page, composioEnabled, signedIn, threadId]);
  const connectApp = app => void perform(async () => {
    setConnecting(app.slug);
    try {
      const { url } = await request('connectComposioApp', threadId, { toolkit: app.slug });
      await openExternal(url);
      setNotice(`Finish connecting ${app.name} in your browser, then refresh apps.`);
    } finally { setConnecting(null); }
  });
  if (!canManage) return h('p', { className: 'bc-muted' }, 'Team owners and editors can manage add-ons on their own computers.');
  if (!data) return h('p', { role: 'status' }, 'Loading add-ons…');
  const entry = data.catalog.find(row => row.id === catalogId);
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
      } else { setData(await request('saveIntegration', threadId, input)); form.reset(); setNotice(entry?.id === 'composio' ? 'Enabled. Ask an agent to use an app; it will give you a sign-in link when needed.' : 'Connected. The next run will use this add-on.'); }
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
    h('p', { className: 'bc-muted' }, scope==='team'?'Add-ons work in every thread in this team that runs on this computer. Local add-on keys and sign-ins stay on this computer; Composio accounts are managed online.':'These add-ons work only in this thread. Local add-on keys and sign-ins stay on this computer; Composio accounts are managed online.'),
    h('button', { onClick: () => perform(load) }, 'Refresh connections'),
    ...data.servers.map(server => h('div', { className: 'bc-card bc-form', key: server.id },
      h('strong', null, server.label), h('small', null, server.serverName),
      h('div', { className: 'bc-actions' }, h('label', { className: 'bc-check' }, h('input', {
        type: 'checkbox', checked: server.enabled, onChange: event => change('toggleIntegration', { serverId: server.id, enabled: event.target.checked }),
      }), 'Enabled'), h('button', { onClick: () => change('removeIntegration', { serverId: server.id }) }, 'Remove')))),
    composioEnabled ? h('section', { className: 'bc-form' }, h('h3', null, 'Composio apps'),
      signedIn ? h(React.Fragment, null,
        h('form', { className: 'bc-actions', onSubmit: event => { event.preventDefault(); browse(); } },
          h('input', { type: 'search', 'aria-label': 'Search Composio apps', placeholder: 'Search Gmail, Slack, Notion…', maxLength: 80,
            value: search, onChange: event => setSearch(event.target.value) }),
          h('button', { type: 'submit', disabled: appsBusy }, 'Search'),
          h('button', { type: 'button', disabled: appsBusy, onClick: () => browse() }, 'Refresh apps')),
        appsBusy && !apps ? h('p', { role: 'status' }, 'Loading Composio apps…') : null,
        apps && !apps.items.length ? h('p', { className: 'bc-muted' }, 'No apps found. Try another search.') : null,
        apps ? h('div', { className: 'bc-composio-grid' }, apps.items.map(app => h('div', { className: 'bc-card bc-composio-app', key: app.slug },
          h('div', null, h('strong', null, app.name), app.description ? h('p', { className: 'bc-muted' }, app.description) : null),
          app.connected ? h('small', null, 'Connected') : app.noAuth ? h('small', null, 'Ready to use')
            : h('button', { disabled: !!connecting, onClick: () => connectApp(app) }, connecting === app.slug ? 'Opening…' : 'Connect')))) : null,
        apps?.nextCursor ? h('button', { disabled: appsBusy, onClick: () => browse(apps.nextCursor) }, 'Show more apps') : null)
        : h('p', { className: 'bc-muted' }, 'Sign in to Bees to browse and connect Composio apps.')) : null,
    h('h3', null, 'Connect an add-on'),
    h('label', { className: 'bc-field' }, h('span', null, 'Add-on'),
      h('select', { value: catalogId, onChange: event => setCatalogId(event.target.value) },
        data.catalog.map(row => h('option', { value: row.id, key: row.id }, row.label)), h('option', { value: '' }, 'Custom MCP server'))),
    entry?.id === 'composio' && composioEnabled ? h('p', { className: 'bc-muted' }, 'Composio is enabled. Browse its apps above.') : h('form', { key: catalogId, className: 'bc-form', onSubmit: save },
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
      h('button', { type: 'submit', className: 'bc-primary' }, entry?.id === 'composio' ? 'Enable Composio' : 'Connect add-on')),
    notice ? h('p', { role: 'status' }, notice) : null);
}
