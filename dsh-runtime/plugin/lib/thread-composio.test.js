import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureRuntime } from '../client/runtime.js';
import { ComposioApps } from '../client/thread-integrations.js';

const flush = () => new Promise(setImmediate);
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children ?? []).flat(Infinity).flatMap(nodes)];

function mount(t, request) {
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
  return {
    window,
    unmount: () => cleanups.forEach(cleanup => cleanup?.()),
    render() {
      cursor = 0;
      const tree = ComposioApps({ threadId: 'team', signedIn: true, request, provider: { enabled: true }, onAccess: async () => {} });
      effects.splice(0).forEach(fn => fn());
      return nodes(tree);
    }
  };
}

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
