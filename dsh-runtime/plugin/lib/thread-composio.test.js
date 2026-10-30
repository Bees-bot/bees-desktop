import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureRuntime } from '../client/runtime.js';
import { ComposioApps, IntegrationSettings } from '../client/thread-integrations.js';

const flush = () => new Promise(setImmediate);
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children ?? []).flat(Infinity).flatMap(nodes)];

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

test('accounts can be selected together, switched, and paginated without enabling expired connections', async t => {
  const a = { id: 'ca_a', label: 'Client A', status: 'ACTIVE' }, b = { id: 'ca_b', label: 'Client B', status: 'ACTIVE' };
  const selections = [];
  const ui = mount(t, async (action, _id, input) => {
    if (action === 'composioApps') return { items: [{ slug: 'facebook', name: 'Facebook', connected: true }] };
    if (action === 'composioAccounts') return input.cursor ? { items: [b], nextCursor: null } : {
      items: [a, { id: 'ca_expired', label: 'Expired', status: 'EXPIRED' }], nextCursor: 'more'
    };
    if (action === 'setComposioAccounts') { selections.push(input); return {}; }
    assert.fail(action);
  });
  ui.render(); await flush();
  ui.render().find(node => node.children.includes('Manage accounts')).props.onClick(); await flush();
  let tree = ui.render();
  const check = label => tree.find(node => node.type === 'label' && node.children.includes(label)).children[0];
  assert.equal(check('Client A').props.checked, true);
  assert.equal(check('Expired').props.disabled, true);
  tree.find(node => node.children.includes('Show more accounts')).props.onClick(); await flush();
  tree = ui.render(); check('Client B').props.onChange({ target: { checked: true } }); await flush();
  assert.deepEqual(selections.at(-1), { toolkit: 'facebook', accounts: [a, b].map(({ id, label }) => ({ id, label })) });
  tree = ui.render(); check('Client A').props.onChange({ target: { checked: false } }); await flush();
  assert.deepEqual(selections.at(-1).accounts, [{ id: 'ca_b', label: 'Client B' }]);
  tree = ui.render(); assert.equal(check('Client A').props.checked, false); assert.equal(check('Client B').props.checked, true);
});

test('adding a named second account waits for that connection, not the already connected app', async t => {
  let active = false, checks = 0;
  const a = { id: 'ca_a', label: 'Client A', status: 'ACTIVE' };
  const ui = mount(t, async (action, _id, input) => {
    if (action === 'composioApps') return { items: [{ slug: 'facebook', name: 'Facebook', connected: true }] };
    if (action === 'composioAccounts') { checks++; return { items: [a, { id: 'ca_b', label: 'Client B', status: active ? 'ACTIVE' : 'INITIATED' }] }; }
    if (action === 'connectComposioApp') {
      assert.deepEqual(input, { toolkit: 'facebook', alias: 'Client B' });
      return { url: 'https://connect.composio.dev/link/second', accountId: 'ca_b' };
    }
    assert.fail(action);
  });
  ui.render(); await flush();
  ui.render().find(node => node.children.includes('Manage accounts')).props.onClick(); await flush();
  let tree = ui.render();
  tree.find(node => node.type === 'input' && node.props.placeholder === 'e.g. Client A').props.onChange({ target: { value: 'Client B' } });
  tree = ui.render(); tree.find(node => node.children.includes('Add another account')).props.onClick(); await flush();
  tree = ui.render(); assert(tree.some(node => node.type === 'button' && node.children.includes('Waiting for sign-in…')));
  t.mock.timers.tick(1500); await flush(); tree = ui.render();
  assert(tree.some(node => node.type === 'button' && node.children.includes('Waiting for sign-in…')));
  assert(!tree.some(node => node.children.includes('Facebook connected.')));
  active = true; ui.window.dispatchEvent(new Event('focus')); await flush(); tree = ui.render();
  assert(tree.some(node => node.children.includes('Facebook connected.')));
  assert(tree.some(node => node.type === 'label' && node.children.includes('Client B')));
  const completedChecks = checks;
  t.mock.timers.tick(30000); await flush(); assert.equal(checks, completedChecks);
});
