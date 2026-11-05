import { h, useEffect, useRef, useState, hosted } from './runtime.js';
import { openExternal, confirmAction, ask } from './common.js';

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
  const [loadError, setLoadError] = useState(''), [attempt, setAttempt] = useState(0);
  const load = async () => setData(await request('integrations', threadId));
  useEffect(() => {
    let current = true;
    setData(null); setLoadError('');
    if (!canManage) return;
    const timer = setTimeout(() => {
      current = false; setLoadError('Loading add-ons timed out. Try again.');
    }, 20000);
    void request('integrations', threadId).then(
      value => { if (current) setData(value); },
      error => { if (current) setLoadError(error.message); }
    ).finally(() => clearTimeout(timer));
    return () => { current = false; clearTimeout(timer); };
  }, [threadId, canManage, attempt]);
  if (!canManage) return h('p', { className: 'bc-muted' }, 'Team owners and editors can manage add-ons on their own computers.');
  if (!data && loadError) return h('div', { className: 'bc-form' },
    h('p', { className: 'bc-error', role: 'alert' }, loadError),
    h('button', { type: 'button', onClick: () => setAttempt(value => value + 1) }, 'Try again'));
  if (!data) return h('p', { role: 'status' }, 'Loading add-ons…');
  const entry = data.catalog.find(row => row.id === catalogId);
  const provider = data.servers.find(server => server.catalogId === 'composio');
  const access = async enabled => {
    if (provider?.enabled === enabled && !provider.inherited) return;
    setData(await request(provider && !provider.inherited ? 'toggleIntegration' : 'saveIntegration', threadId,
      provider && !provider.inherited ? { serverId: provider.id, enabled } : { catalogId: 'composio', enabled }));
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
        onChange: event => change('setBrowser', { mode: event.target.checked ? 'personal' : 'own' }) }), `Use your own browser${data.browser.name ? ` (${data.browser.name})` : ''}`),
    h('p', { className: 'bc-muted' }, data.browser.mode === 'personal'
      ? `Runs use their own tabs in ${data.browser.name}, with your existing sign-ins. ${data.browser.setup}`
      : 'Runs use an isolated browser. Your personal browser and sign-ins stay separate.'),
    !data.browser.personalAvailable ? h('p', { className: 'bc-muted' }, hosted
      ? 'Personal browser access works only in the Bees desktop app.'
      : 'Open Google Chrome once, or use a supported Chromium browser as your Mac’s default browser.') : null,
    data.browser.warning ? h('p', { className: 'bc-muted' }, data.browser.warning) : null,
    h('p', null, 'Turn on Browser or Chrome DevTools in Add-ons to give every thread in this team browser tools.'),
    !hosted && data.browser.mode === 'personal' ? h('button', { onClick: () => perform(() => request('openBrowser', threadId)) }, 'Open browser') : null,
    notice ? h('p', { role: 'status' }, notice) : null);
  return h('section', { className: 'bc-form' }, h('h3', null, 'Add-ons'),
    h('p', { className: 'bc-muted' }, scope === 'team' ? 'Connect apps and tools for every thread in this team.' : 'Connect apps and tools for this thread.'),
    h(ComposioApps, { threadId, signedIn, onSignIn, request, provider, onAccess: access,
      onSelection: async (toolkit, accounts) => setData(await request('setComposioAccounts', threadId, { toolkit, accounts })), scope }),
    h('div', { className: 'bc-addon-heading' }, h('h3', null, 'MCP add-ons'),
      data.servers.some(server => server.catalogId !== 'composio') ? h('button', { onClick: () => perform(load) }, 'Refresh') : null),
    ...data.servers.filter(server => server.catalogId !== 'composio').map(server => h('div', { className: 'bc-card bc-addon-row', key: server.id },
      h('div', null, h('strong', null, server.label), h('small', null, server.serverName),
        server.needsSetup ? h('small', null, 'Setup required on this machine. Check the command and dependencies, then enable it here.') : null,
        server.needsSetup ? h('code', null, server.transport === 'stdio' ? [server.command, ...server.args].join(' ') : server.url) : null),
      h('div', { className: 'bc-actions' }, h('label', { className: 'bc-check' }, h('input', {
        type: 'checkbox', checked: server.enabled && !server.needsSetup, onChange: async event => {
          const enabled=event.target.checked;
          if(enabled&&server.needsSetup&&!await confirmAction(`Enable ${server.label} on this machine? Make sure its command, dependencies, and local paths are ready.`, 'Enable here'))return;
          change('toggleIntegration', { serverId: server.id, enabled });
        },
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

export function ComposioApps({ threadId, signedIn, onSignIn, request, provider, onAccess, onSelection, scope = 'team' }) {
  const [search, setSearch] = useState(''), [apps, setApps] = useState(null);
  const [pending, setPending] = useState(''), [error, setError] = useState(null), [notice, setNotice] = useState('');
  const [connecting, setConnecting] = useState(null);
  const [accounts, setAccounts] = useState({});
  const [connectionVersion, setConnectionVersion] = useState(0);
  const generation = useRef(0), enabled = !!provider?.enabled;
  const browse = async cursor => {
    const current = ++generation.current, query = cursor ? apps.query : search;
    setPending('loading'); setError(null);
    try {
      const page = await request('composioApps', threadId, { search: query, cursor });
      if (current === generation.current) {
        setApps(previous => ({ ...page, query, items: cursor ? [...previous.items, ...page.items] : page.items }));
        if (connecting && !connecting.accountId && !connecting.multiple && page.items.some(app => app.slug === connecting.slug && app.connected)) {
          setConnecting(null); setNotice(`${connecting.name} connected.`);
          setConnectionVersion(value => value + 1);
        } else if (!connecting) setNotice('');
      }
    } catch (error) { const problem = await composioConnectionError(error, request); if (current === generation.current) setError(problem); }
    finally { if (current === generation.current) setPending(''); }
  };
  useEffect(() => {
    setApps(null); setError(null); setPending(''); setConnecting(null); setAccounts({});
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
        const checkingAccount = connecting.accountId || connecting.multiple;
        const page = await request(checkingAccount ? 'composioAccounts' : 'composioApps', threadId,
          checkingAccount ? { toolkit: connecting.slug } : { search: connecting.slug });
        if (stopped) return;
        const connected = checkingAccount ? page.items.some(account => account.status === 'ACTIVE' && (connecting.accountId
          ? account.id === connecting.accountId : !connecting.previousIds.includes(account.id))) : page.items.some(app => app.slug === connecting.slug && app.connected);
        const app = checkingAccount ? { ...connecting, connected: true } : page.items.find(app => app.slug === connecting.slug);
        if (checkingAccount) setAccounts(previous => ({ ...previous, [connecting.slug]: page }));
        if (connected) {
          setApps(previous => previous && ({ ...previous, items: previous.items.map(item => item.slug === app.slug ? app : item) }));
          setConnecting(null); setNotice(`${connecting.name} connected.`);
          setConnectionVersion(value => value + 1);
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
  const connect = (app, multiple = false) => act(app.slug, async () => {
    await onAccess(true);
    if (!multiple && (app.connected || app.noAuth)) { setNotice(`${app.name} is ready for this ${scope}.`); return; }
    const previous = multiple ? await request('composioAccounts', threadId, { toolkit: app.slug }) : accounts[app.slug];
    const { url, accountId } = await request('connectComposioApp', threadId, { toolkit: app.slug });
    await openExternal(url);
    setConnecting({ ...app, multiple, accountId, previousIds: (previous?.items ?? []).map(account => account.id) });
    setNotice(app.connected ? `${app.name} already has a connection. Finish signing in with a different account in your browser, or cancel this sign-in.`
      : `Finish connecting ${app.name} in your browser. Its status will update automatically.`);
  });
  const needsSignIn = !signedIn || error?.status === 401;
  return h('section', { className: 'bc-form bc-app-connections', 'aria-label': 'Apps' },
    signedIn ? h(ConnectedAccounts, { key: threadId, threadId, request, refreshToken: connectionVersion, provider, onAccess, onSelection, scope, connecting: !!pending || !!connecting, onChanged: () => browse(), onConnect: app => connect(app, true) }) : null,
    h('div', { className: 'bc-addon-heading' }, h('div', null, h('h3', null, 'Available apps'),
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
        connecting ? h('button', { type: 'button', style: { alignSelf: 'flex-start' }, onClick: () => { setConnecting(null); setNotice('Sign in cancelled. Existing connections are unchanged.'); } }, 'Cancel sign in') : null,
        apps && !apps.items.length ? h('p', { className: 'bc-muted' }, 'No matching apps. Try another name.') : null,
        apps ? h('div', { className: 'bc-composio-grid', 'aria-busy': pending === 'loading' }, apps.items.map(app =>
          h('article', { className: 'bc-card bc-composio-app', key: app.slug },
            h('div', { className: 'bc-app-title' }, h('span', { className: 'bc-app-symbol', 'aria-hidden': true }, app.name.slice(0, 1)), h('strong', null, app.name)),
            app.description ? h('p', { className: 'bc-muted' }, app.description) : null,
            enabled && (app.connected || app.noAuth) ? h('small', null, app.connected ? connecting?.slug === app.slug ? 'Existing account connected' : 'Connected' : 'Ready to use')
              : h('button', { disabled: !!pending || connecting?.slug === app.slug, onClick: () => void connect(app) }, connecting?.slug === app.slug ? 'Waiting for sign-in…' : pending === app.slug ? 'Connecting…' : app.connected || app.noAuth ? `Use in this ${scope}` : 'Connect'),
            !app.noAuth && app.connected ? h('button', { disabled: !!pending || connecting?.slug === app.slug, onClick: () => void connect(app, true) }, connecting?.slug === app.slug ? 'Waiting for sign-in…' : 'Connect a different account') : null))) : null,
        apps?.nextCursor ? h('button', { disabled: !!pending, onClick: () => void browse(apps.nextCursor) }, 'Show more apps') : null,
        h('small', null, `Connections belong to your Bees account. Connecting an app lets agents in this ${scope} use it.`)));
}

export function groupConnectedAccounts(items) {
  const groups = new Map(), seen = new Set();
  for (const account of items) {
    if (seen.has(account.id)) continue;
    seen.add(account.id);
    const key = account.identity ? `${account.toolkit}:${account.identity.toLowerCase()}` : account.id;
    const group = groups.get(key) ?? [];
    group.push(account); groups.set(key, group);
  }
  return [...groups.values()].map(group => group.sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE')));
}

export function ConnectedAccounts({ threadId, request, refreshToken, onChanged, onConnect, provider, onAccess, onSelection, connecting, scope = 'team' }) {
  const [page, setPage] = useState(null), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const identities = useRef(new Map());
  const loadingTimer = useRef(null);
  const load = async (cursor) => {
    const current = ++generation.current;
    clearTimeout(loadingTimer.current);
    setLoading(true); setError('');
    const seen = new Set(cursor ? [cursor] : []);
    let append = !!cursor;
    try {
      do {
        loadingTimer.current = setTimeout(() => {
          if (current !== generation.current) return;
          generation.current++;
          setLoading(false);
          setError('Loading connections timed out. Try again. If this continues, update Bees Server.');
        }, 20000);
        const result = await request('composioConnections', threadId, { cursor });
        if (current !== generation.current) return;
        clearTimeout(loadingTimer.current);
        if (result.nextCursor && seen.has(result.nextCursor)) throw Error('Connection pagination did not advance. Refresh connections to try again.');
        result.items = result.items.map(account => ({ ...account, identity: account.identity || identities.current.get(account.id) }));
        const adding = append;
        setPage(previous => ({ ...result, items: adding ? [...previous.items, ...result.items] : result.items }));
        append = true;
        cursor = result.nextCursor;
        seen.add(cursor);
      } while (cursor);
    } catch (error) { if (current === generation.current) setError(error.message); }
    finally { if (current === generation.current) { clearTimeout(loadingTimer.current); setLoading(false); } }
  };
  useEffect(() => { void load(); return () => { generation.current++; clearTimeout(loadingTimer.current); }; }, [threadId, refreshToken]);
  const act = async action => {
    if (pending) return;
    const current = generation.current;
    setPending(true); setError('');
    try { await action(); }
    catch (error) { if (current === generation.current) setError(error.message); }
    finally { setPending(false); }
  };
  const selectedFor = toolkit => provider?.accountSelections?.[toolkit] ?? page.items.filter(row => row.toolkit === toolkit && row.status === 'ACTIVE').slice(0, 1);
  const select = (account, checked) => act(async () => {
    await onAccess(true);
    const selected = selectedFor(account.toolkit);
    await onSelection(account.toolkit, (checked ? [...selected, account] : selected.filter(row => row.id !== account.id)).map(({ id, label }) => ({ id, label })));
  });
  const disconnect = account => act(async () => {
    if (!await confirmAction(`Disconnect ${account.label} (${account.id}) from ${account.toolkit}? All your teams will lose access to this connection. Other connections are kept.`, 'Disconnect')) return;
    await request('disconnectComposioAccount', threadId, { toolkit: account.toolkit, accountId: account.id });
    await load(); await onChanged?.();
  });
  const rename = account => act(async () => {
    const alias = await ask('Connection name (optional), e.g. Client A CRM. Saved in your Bees profile on this computer. Leave blank to use the provider name.', account.displayName ?? '');
    if (alias === null) return;
    if (alias.length > 100) throw Error('Use a display name of at most 100 characters.');
    await request('renameComposioAccount', threadId, { toolkit: account.toolkit, accountId: account.id, alias });
    if (onSelection && selectedFor(account.toolkit).some(row => row.id === account.id)) {
      await onAccess(true);
      await onSelection(account.toolkit, selectedFor(account.toolkit).map(row => ({ id: row.id, label: row.id === account.id ? alias || account.identity || account.label : row.label })));
    }
    await load();
  });
  const identify = account => act(async () => {
    const current = generation.current;
    const { identity } = await request('identifyComposioAccount', threadId, { toolkit: account.toolkit, accountId: account.id });
    if (current === generation.current) {
      identities.current.set(account.id, identity);
      setPage(previous => ({ ...previous, items: previous.items.map(row => row.id === account.id ? { ...row, identity } : row) }));
    }
  });
  const date = account => account.createdAt && Number.isFinite(Date.parse(account.createdAt)) ? new Date(account.createdAt).toLocaleString() : 'Unavailable';
  const selection = account => onSelection ? h('label', { className: 'bc-check' }, h('input', {
    type: 'checkbox', checked: selectedFor(account.toolkit).some(row => row.id === account.id),
    disabled: pending || account.status !== 'ACTIVE' && !selectedFor(account.toolkit).some(row => row.id === account.id),
    onChange: event => void select(account, event.target.checked), 'aria-label': `Use ${account.label} (${account.id}) in this ${scope}`
  }), `Use in this ${scope}`) : null;
  return h('section', { className: 'bc-form', 'aria-label': 'Connected accounts' },
    h('div', { className: 'bc-addon-heading' }, h('div', null, h('h3', null, 'Connected accounts'),
      h('p', { className: 'bc-muted' }, `Select the accounts this ${scope} can use. Connect first, then use Name connection or Rename to add a label for you and your agents.`)),
      h('button', { disabled: pending || loading, onClick: () => void load(error ? page?.nextCursor : undefined) }, error ? 'Retry loading connections' : 'Refresh connections')),
    page?.legacy ? h('p', { className: 'bc-muted' }, 'Connection names work on this computer. Update Bees Server for connection dates, identity checks and disconnect actions.') : null,
    error ? h('p', { role: 'alert' }, error) : null,
    pending || loading ? h('p', { role: 'status' }, loading && page?.nextCursor ? 'Loading remaining connections…' : 'Updating connections…') : null,
    page && !page.items.length && !loading && !error ? h('p', { className: 'bc-muted' }, page.legacy ? 'No accounts found for connected apps. Update Bees Server to include expired apps.' : 'No connected accounts. Connect an app below to get started.') : null,
    page?.items.length ? h('div', { className: 'bc-connections-table' }, h('table', null,
      h('thead', null, h('tr', null, ...['App', 'Account', 'Connected date', 'Status', 'Access', 'Actions'].map(title => h('th', { key: title, scope: 'col' }, title)))),
      h('tbody', null, ...groupConnectedAccounts(page.items).map(([account, ...duplicates]) => h('tr', { key: account.id },
        h('td', null, account.appName || account.toolkit),
        h('td', null, h('strong', null, account.label),
          h('small', null, account.identity || 'Provider account identity unavailable'), h('code', null, account.id),
          duplicates.length ? h('details', { className: 'bc-connection-duplicates' }, h('summary', null, `${duplicates.length} additional connection${duplicates.length === 1 ? '' : 's'} for this account`),
            h('p', null, 'These connections have the same provider account identity. Keep the connection your workflows use; disconnect extras individually.'),
            ...duplicates.map(extra => h('div', { className: 'bc-form', key: extra.id }, h('strong', null, extra.label), h('code', null, extra.id),
              h('small', null, `${extra.status} · ${date(extra)}`), selection(extra),
              h('button', { disabled: pending, onClick: () => void disconnect(extra) }, 'Disconnect extra connection')))) : null),
        h('td', null, date(account)), h('td', null, account.status), h('td', null, selection(account)),
        h('td', null, h('div', { className: 'bc-actions' },
          h('button', { disabled: pending, onClick: () => void rename(account) }, account.displayName ? 'Rename' : 'Name connection'),
          !account.identity && ['gmail', 'github'].includes(account.toolkit) ? h('button', { disabled: pending || page.legacy, onClick: () => void identify(account) }, 'Check identity') : null,
          onConnect ? h('button', { disabled: pending || connecting, onClick: () => void onConnect({ slug: account.toolkit, name: account.appName || account.toolkit }) }, account.status === 'ACTIVE' ? 'Connect a different account' : 'Reconnect') : null,
          h('button', { disabled: pending || page.legacy, 'aria-label': `Disconnect ${account.label} (${account.id})`, onClick: () => void disconnect(account) }, 'Disconnect')))))))) : null);
}
