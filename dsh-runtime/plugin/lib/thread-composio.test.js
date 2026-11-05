import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureRuntime } from '../client/runtime.js';
import { ComposioApps, IntegrationSettings, ConnectedAccounts, groupConnectedAccounts } from '../client/thread-integrations.js';

const flush = () => new Promise(setImmediate);
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children ?? []).flat(Infinity).flatMap(nodes)];

test('connected accounts show the first page immediately and load remaining pages automatically', async t => {
  let finish;
  const account = { id: 'ca_one', toolkit: 'facebook', label: 'Client A', status: 'ACTIVE', createdAt: '2026-11-01T00:00:00Z' };
  const ui = mount(t, async (action, id, input) => {
    assert.equal(action, 'composioConnections'); assert.equal(id, 'team');
    return input.cursor ? new Promise(resolve => { finish = () => resolve({ items: [{ ...account, id: 'ca_two', label: 'Client B', createdAt: null }], nextCursor: null }); })
      : { items: [account], nextCursor: 'next' };
  }, ConnectedAccounts);
  ui.render(); await flush();
  let tree = ui.render();
  for (const value of ['Client A', 'ca_one', 'facebook', 'ACTIVE', 'Connected date', 'Disconnect']) assert(tree.some(node => node.children.includes(value)));
  assert(!tree.some(node => node.children.includes('Show more connections')));
  assert.equal(tree.find(node => node.children.includes('Name connection')).props.disabled, false);
  finish(); await flush();
  tree = ui.render();
  assert(tree.some(node => node.children.includes('Client A')));
  assert(tree.some(node => node.children.includes('Client B')));
  assert(tree.some(node => node.children.includes('Unavailable')));
  assert(!tree.some(node => node.children.includes('Show more connections')));
});

test('connected account refresh ignores responses after unmount', async t => {
  let finish;
  const ui = mount(t, () => new Promise(resolve => { finish = resolve; }), ConnectedAccounts);
  ui.render(); await flush(); ui.unmount();
  finish({ items: [{ id: 'ca_stale', label: 'Stale' }] }); await flush();
  assert(!ui.render().some(node => node.children.includes('Stale')));
});

test('a failed later page keeps loaded accounts and retries only the missing page', async t => {
  const cursors = [];
  let fail = true;
  const ui = mount(t, async (_action, _id, input) => {
    cursors.push(input.cursor);
    if (!input.cursor) return { items: [{ id: 'ca_a', toolkit: 'gmail', label: 'Account A' }], nextCursor: 'page2' };
    if (fail) throw Error('Page unavailable');
    return { items: [{ id: 'ca_b', toolkit: 'gmail', label: 'Account B' }], nextCursor: null };
  }, ConnectedAccounts);
  ui.render(); await flush();
  let tree = ui.render();
  assert(tree.some(node => node.children.includes('Account A')));
  assert(tree.some(node => node.props?.role === 'alert' && node.children.includes('Page unavailable')));
  fail = false;
  tree.find(node => node.children.includes('Retry loading connections')).props.onClick(); await flush();
  tree = ui.render();
  assert(tree.some(node => node.children.includes('Account A')));
  assert(tree.some(node => node.children.includes('Account B')));
  assert.deepEqual(cursors, [undefined, 'page2', 'page2']);
});

test('repeated page cursors stop automatic loading instead of looping', async t => {
  let calls = 0;
  const ui = mount(t, async () => {
    calls++;
    return { items: [], nextCursor: 'same' };
  }, ConnectedAccounts);
  ui.render(); await flush();
  assert.equal(calls, 2);
  assert(ui.render().some(node => node.props?.role === 'alert' && node.children.some(value => typeof value === 'string' && value.includes('pagination did not advance'))));
});

test('connected accounts can retry a failed load', async t => {
  let calls = 0;
  const ui = mount(t, async () => {
    if (++calls === 1) throw Error('Connections unavailable');
    return { items: [], nextCursor: null };
  }, ConnectedAccounts);
  ui.render(); await flush();
  assert(ui.render().some(node => node.props?.role === 'alert' && node.children.includes('Connections unavailable')));
  ui.render().find(node => node.children.includes('Retry loading connections')).props.onClick(); await flush();
  assert(!ui.render().some(node => node.props?.role === 'alert'));
  assert(ui.render().some(node => node.children.includes('No connected accounts. Connect an app below to get started.')));
});

test('old-server connections can be named while unsupported remote actions stay disabled', async t => {
  const ui = mount(t, async () => ({ legacy: true, items: [{ id: 'ca_hub', toolkit: 'hubspot', label: '247892721', status: 'ACTIVE' }] }), ConnectedAccounts);
  ui.render(); await flush();
  const tree = ui.render();
  assert.equal(tree.find(node => node.children.includes('Name connection')).props.disabled, false);
  assert.equal(tree.find(node => node.children.includes('Disconnect')).props.disabled, true);
});

test('app cards connect directly without asking for a name first', async t => {
  let connects = 0;
  const ui = mount(t, async (action, _id, input) => {
    if (action === 'composioApps') return { items: [{ slug: 'hubspot', name: 'HubSpot' }] };
    if (action === 'connectComposioApp') {
      connects++; assert.deepEqual(input, { toolkit: 'hubspot' });
      return { url: 'https://connect.composio.dev/link/test', accountId: 'ca_new' };
    }
    assert.fail(action);
  });
  ui.render(); await flush();
  const tree = ui.render();
  assert(!tree.some(node => node.type === 'input' && !['search', 'checkbox'].includes(node.props.type)));
  assert(!tree.some(node => node.children.includes('Connection name (optional)')));
  tree.find(node => node.children.includes('Connect')).props.onClick(); await flush();
  assert.equal(connects, 1);
  assert(ui.render().some(node => node.children.includes('Finish connecting HubSpot in your browser. Its status will update automatically.')));
});

test('connecting another account from the table opens sign-in without a name prompt', async t => {
  let connects = 0;
  const ui = mount(t, async (action, _id, input) => {
    if (action === 'composioApps') return { items: [{ slug: 'hubspot', name: 'HubSpot', connected: true }] };
    if (action === 'composioAccounts') return { items: [] };
    assert.equal(action, 'connectComposioApp'); assert.deepEqual(input, { toolkit: 'hubspot' });
    connects++; return { url: 'https://connect.composio.dev/link/test', accountId: 'ca_new' };
  });
  ui.render(); await flush();
  await ui.render().find(node => node.type === ConnectedAccounts).props.onConnect({ slug: 'hubspot', name: 'HubSpot' });
  assert.equal(connects, 1);
});

test('a stalled connection list times out, permits retry, and cannot overwrite the retry result', async t => {
  let calls = 0, finish;
  const ui = mount(t, async () => {
    if (++calls === 1) return new Promise(resolve => { finish = resolve; });
    return { items: [{ id: 'ca_current', toolkit: 'gmail', label: 'Current account', status: 'ACTIVE' }] };
  }, ConnectedAccounts);
  ui.render(); await flush();
  t.mock.timers.tick(20000);
  let tree = ui.render();
  assert(tree.some(node => node.props?.role === 'alert' && node.children.some(value => typeof value === 'string' && value.includes('timed out'))));
  assert(!tree.some(node => node.children.includes('Updating connections…')));
  const refresh = tree.find(node => node.children.includes('Retry loading connections'));
  assert.equal(refresh.props.disabled, false);
  refresh.props.onClick(); await flush();
  finish({ items: [{ id: 'ca_stale', label: 'Stale account' }] }); await flush();
  tree = ui.render();
  assert(tree.some(node => node.children.includes('Current account')));
  assert(!tree.some(node => node.children.includes('Stale account')));
});

function mount(t, request, Component = ComposioApps) {
  let cursor = 0;
  const state = [], dependencies = [], effects = [], cleanups = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }), createContext: () => ({}),
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return state[i] ??= { current: initial }; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!dependencies[i] || deps.some((value, j) => value !== dependencies[i][j])) effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); });
      dependencies[i] = deps;
    }
  };
  configureRuntime(name => ({ react: React, 'react-dom': {}, '@deepseek-ai/dsh-client-ui-primitives': {}, '@bees/dsh-custom-ai': {}, '@bees/dsh-subscriptions': {} })[name]);
  const prior = globalThis.window, window = new EventTarget();
  window.__TAURI__ = { core: { invoke: async () => {} } };
  globalThis.window = window;
  t.after(() => { cleanups.forEach(cleanup => cleanup?.()); if (prior === undefined) delete globalThis.window; else globalThis.window = prior; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const provider = { enabled: true, accountSelections: {} };
  return {
    window,
    unmount: () => cleanups.forEach(cleanup => cleanup?.()),
    render(props = {}) {
      cursor = 0;
      const tree = Component({ threadId: 'team', canManage: true, signedIn: true, request, provider, onAccess: async () => {},
        perform: async fn => { try { return await fn(); } catch {} }, ...props,
        onSelection: async (toolkit, accounts) => { await request('setComposioAccounts', 'team', { toolkit, accounts }); provider.accountSelections[toolkit] = accounts; } });
      effects.splice(0).forEach(fn => fn());
      return nodes(tree);
    }
  };
}

test('browser settings name the available browser and allow switching it on and off', async t => {
  const modes = [], data = { servers: [], catalog: [], browser: { mode: 'own', name: 'Google Chrome', personalAvailable: true } };
  const ui = mount(t, async (action, id, input) => {
    assert.equal(id, 'team');
    if (action === 'setBrowser') { modes.push(input.mode); data.browser.mode = input.mode; }
    else assert.equal(action, 'integrations');
    return structuredClone(data);
  }, IntegrationSettings);
  const render = () => ui.render({ page: 'browser' });
  const toggle = () => render().find(node => node.props?.role === 'switch');
  render(); await flush();
  assert(render().some(node => node.children.includes('Use your own browser (Google Chrome)')));
  assert.equal(toggle().props.disabled, false);
  assert.equal(toggle().props.checked, false);
  await toggle().props.onChange({ target: { checked: true } });
  assert.equal(toggle().props.checked, true);
  await toggle().props.onChange({ target: { checked: false } });
  assert.equal(toggle().props.checked, false);
  assert.deepEqual(modes, ['personal', 'own']);
});

test('add-on settings show a failed initial request and retry without remaining on the loading screen', async t => {
  let calls = 0;
  const ui = mount(t, async action => {
    assert.equal(action, 'integrations');
    if (++calls === 1) throw Error('The add-on service is unavailable');
    return { servers: [], catalog: [], browser: {} };
  }, IntegrationSettings);
  ui.render(); await flush();
  let tree = ui.render();
  assert(tree.some(node => node.props?.role === 'alert' && node.children.includes('The add-on service is unavailable')));
  assert(!tree.some(node => node.children.includes('Loading add-ons…')));
  tree.find(node => node.type === 'button' && node.children.includes('Try again')).props.onClick();
  ui.render(); await flush(); tree = ui.render();
  assert(tree.some(node => node.children.includes('Add an MCP add-on')));
  assert.equal(calls, 2);
  for (let i = 0; i < 5; i++) ui.render();
  assert.equal(calls, 2, 'Parent refreshes must not restart initial loading');
});

test('add-on settings stop waiting for a stalled request and ignore its late response after retry', async t => {
  let calls = 0, finish;
  const ui = mount(t, async () => {
    if (++calls === 1) return new Promise(resolve => { finish = resolve; });
    return { servers: [{ id: 'current', label: 'Current add-on', serverName: 'current' }], catalog: [], browser: {} };
  }, IntegrationSettings);
  ui.render(); await flush();
  t.mock.timers.tick(20000);
  let tree = ui.render();
  assert(!tree.some(node => node.children.includes('Loading add-ons…')));
  tree.find(node => node.type === 'button' && node.children.includes('Try again')).props.onClick();
  ui.render(); await flush();
  finish({ servers: [{ id: 'stale', label: 'Stale add-on', serverName: 'stale' }], catalog: [], browser: {} });
  await flush(); tree = ui.render();
  assert(tree.some(node => node.children.includes('Current add-on')));
  assert(!tree.some(node => node.children.includes('Stale add-on')));
});

test('Composio authorization updates its card automatically on return without losing other apps or pagination', async t => {
  let checks = 0;
  const gmail = { slug: 'gmail', name: 'Gmail', connected: false }, github = { slug: 'github', name: 'GitHub' };
  const ui = mount(t, async (action, threadId, input) => {
    assert.equal(threadId, 'team');
    if (action === 'connectComposioApp') return { url: 'https://connect.composio.dev/link/test' };
    assert.equal(action, 'composioApps');
    if (!input.search) return { items: [gmail, github], nextCursor: 'more' };
    assert.equal(input.search, 'gmail');
    return { items: [{ ...gmail, connected: ++checks >= 2 }], nextCursor: null };
  });
  ui.render(); await flush();
  ui.render().find(node => node.type === 'button' && node.children.includes('Connect')).props.onClick(); await flush();
  assert(ui.render().some(node => node.type === 'button' && node.props.disabled && node.children.includes('Waiting for sign-in…')));
  t.mock.timers.tick(1500); await flush();
  assert.equal(checks, 1);
  ui.window.dispatchEvent(new Event('focus')); await flush();
  const result = ui.render();
  assert(result.some(node => node.type === 'small' && node.children.includes('Connected')));
  assert(result.some(node => node.children.includes('Gmail connected.')));
  assert(result.some(node => node.children.includes('GitHub')));
  assert(result.some(node => node.children.includes('Show more apps')));
  t.mock.timers.tick(30000); ui.window.dispatchEvent(new Event('focus')); await flush();
  assert.equal(checks, 2, 'Stop checking once authorization completes');
});

test('Composio status checks stop on unmount and ignore an in-flight response', async t => {
  const gmail = { slug: 'gmail', name: 'Gmail', connected: false };
  let checks = 0, resolve;
  const ui = mount(t, async (action, threadId, input) => {
    if (action === 'connectComposioApp') return { url: 'https://connect.composio.dev/link/test' };
    if (!input.search) return { items: [gmail] };
    checks++;
    return new Promise(done => { resolve = done; });
  });
  ui.render(); await flush();
  ui.render().find(node => node.type === 'button' && node.children.includes('Connect')).props.onClick(); await flush();
  ui.render(); t.mock.timers.tick(1500); await flush();
  ui.window.dispatchEvent(new Event('focus'));
  assert.equal(checks, 1, 'Do not overlap status requests');
  ui.unmount(); resolve({ items: [{ ...gmail, connected: true }] }); await flush();
  t.mock.timers.tick(30000); ui.window.dispatchEvent(new Event('focus')); await flush();
  assert.equal(checks, 1);
  assert(!ui.render().some(node => node.children.includes('Gmail connected.')));
});

test('abandoned add-on sign-in can be cancelled and retried while ignoring a late status response', async t => {
  const gmail = { slug: 'gmail', name: 'Gmail', connected: false };
  let connects = 0, finish;
  const ui = mount(t, async (action, _id, input) => {
    if (action === 'connectComposioApp') { connects++; return { url: 'https://connect.composio.dev/link/test' }; }
    if (!input.search) return { items: [gmail] };
    return new Promise(resolve => { finish = resolve; });
  });
  const button = label => ui.render().find(node => node.type === 'button' && node.children.includes(label));
  ui.render(); await flush();
  button('Connect').props.onClick(); await flush(); ui.render();
  t.mock.timers.tick(1500); await flush();
  button('Cancel sign in').props.onClick(); ui.render();
  finish({ items: [{ ...gmail, connected: true }] }); await flush();
  assert.equal(button('Connect').props.disabled, false);
  assert(!ui.render().some(node => node.children.includes('Gmail connected.')));
  button('Connect').props.onClick(); await flush();
  assert.equal(connects, 2);
  assert.equal(button('Waiting for sign-in…').props.disabled, true);
});

test('table accounts can be selected together without enabling expired connections', async t => {
  const a = { id: 'ca_a', toolkit: 'facebook', label: 'Client A', status: 'ACTIVE' }, b = { id: 'ca_b', toolkit: 'facebook', label: 'Client B', status: 'ACTIVE' };
  const selections = [];
  const ui = mount(t, async (action, _id, input) => {
    if (action === 'composioConnections') return { items: [a, b, { id: 'ca_expired', toolkit: 'facebook', label: 'Expired', status: 'EXPIRED' }] };
    if (action === 'setComposioAccounts') { selections.push(input); return {}; }
    assert.fail(action);
  }, ConnectedAccounts);
  ui.render(); await flush();
  const check = id => ui.render().find(node => node.type === 'input' && node.props['aria-label']?.includes(`(${id})`));
  assert.equal(check('ca_a').props.checked, true);
  assert.equal(check('ca_expired').props.disabled, true);
  check('ca_b').props.onChange({ target: { checked: true } }); await flush();
  assert.deepEqual(selections.at(-1), { toolkit: 'facebook', accounts: [a, b].map(({ id, label }) => ({ id, label })) });
  check('ca_a').props.onChange({ target: { checked: false } }); await flush();
  assert.deepEqual(selections.at(-1).accounts, [{ id: 'ca_b', label: 'Client B' }]);
  assert.equal(check('ca_a').props.checked, false); assert.equal(check('ca_b').props.checked, true);
});

test('duplicate identities group only within an app and never by user-defined display name', () => {
  const rows = [
    { id: 'ca_old', toolkit: 'gmail', identity: 'me@example.com', label: 'Work', status: 'EXPIRED' },
    { id: 'ca_new', toolkit: 'gmail', identity: 'ME@example.com', label: 'Other name', status: 'ACTIVE' },
    { id: 'ca_calendar', toolkit: 'googlecalendar', identity: 'me@example.com', status: 'ACTIVE' },
    { id: 'ca_unknown1', toolkit: 'gmail', label: 'Work' },
    { id: 'ca_unknown2', toolkit: 'gmail', label: 'Work' }
  ];
  const groups = groupConnectedAccounts([...rows, rows[1]]);
  assert.equal(groups.length, 4);
  assert.deepEqual(groups[0].map(row => row.id), ['ca_new', 'ca_old']);
  assert.equal(rows[0].id, 'ca_old');
});

test('checking identities groups repeated connections and preserves the result on refresh', async t => {
  const ui = mount(t, async (action, _id, input) => {
    if (action === 'composioConnections') return { items: ['ca_a', 'ca_b'].map(id => ({ id, toolkit: 'gmail', label: id, status: 'ACTIVE' })) };
    assert.equal(action, 'identifyComposioAccount'); assert(['ca_a', 'ca_b'].includes(input.accountId));
    return { identity: 'me@example.com' };
  }, ConnectedAccounts);
  ui.render(); await flush();
  ui.render().find(node => node.children.includes('Check identity')).props.onClick(); await flush();
  ui.render().find(node => node.children.includes('Check identity')).props.onClick(); await flush();
  assert(ui.render().some(node => node.type === 'summary' && node.children.includes('1 additional connection for this account')));
  ui.render().find(node => node.children.includes('Refresh connections')).props.onClick(); await flush();
  assert(ui.render().some(node => node.type === 'summary' && node.children.includes('1 additional connection for this account')));
});

test('adding a different account waits for that connection, not the already connected app', async t => {
  let active = false, checks = 0;
  const a = { id: 'ca_a', label: 'Client A', status: 'ACTIVE' };
  const ui = mount(t, async (action, _id, input) => {
    if (action === 'composioApps') return { items: [{ slug: 'facebook', name: 'Facebook', connected: true }] };
    if (action === 'composioAccounts') { checks++; return { items: [a, { id: 'ca_b', label: 'Client B', status: active ? 'ACTIVE' : 'INITIATED' }] }; }
    if (action === 'connectComposioApp') {
      assert.deepEqual(input, { toolkit: 'facebook' });
      return { url: 'https://connect.composio.dev/link/second', accountId: 'ca_b' };
    }
    assert.fail(action);
  });
  ui.render(); await flush();
  let tree = ui.render();
  tree.find(node => node.children.includes('Connect a different account')).props.onClick(); await flush();
  tree = ui.render(); assert(tree.some(node => node.type === 'button' && node.children.includes('Waiting for sign-in…')));
  t.mock.timers.tick(1500); await flush(); tree = ui.render();
  assert(tree.some(node => node.type === 'button' && node.children.includes('Waiting for sign-in…')));
  assert(!tree.some(node => node.children.includes('Facebook connected.')));
  active = true; ui.window.dispatchEvent(new Event('focus')); await flush(); tree = ui.render();
  assert(tree.some(node => node.children.includes('Facebook connected.')));
  assert(!tree.some(node => node.type === 'input' && node.props.placeholder === 'e.g. Client A'));
  assert(!tree.some(node => node.children.includes('Manage accounts')));
  const completedChecks = checks;
  t.mock.timers.tick(30000); await flush(); assert.equal(checks, completedChecks);
});
