import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { configureRuntime } from '../client/runtime.js';
import { useUpdates, UpdateSettings } from '../client/thread-updates.js';
import { BeesNavigation } from '../client/thread-navigation.js';
import { threadCss } from '../client/thread-style.js';

const nodes = node => !React.isValidElement(node) ? [] : [node, ...React.Children.toArray(node.props.children).flatMap(nodes)];
function harness(t, invoke, hosted = false) {
  const previousWindow = globalThis.window, states = [], refs = [], effects = [];
  let index = 0, refIndex = 0, closed = 0, updates;
  globalThis.window = invoke ? { __TAURI__: { core: { invoke: command => command === 'plugin:app|version' ? Promise.resolve('0.2.2') : invoke(command) } } } : {};
  const configure = react => configureRuntime(name => ({ react, 'react-dom': {}, '@deepseek-ai/dsh-client-ui-primitives': {}, '@bees/dsh-custom-ai': {}, '@bees/dsh-subscriptions': {} })[name], { hosted });
  configure({ ...React, useState: initial => {
    const key = index++;
    if (!(key in states)) states[key] = initial;
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value; }];
  }, useRef: initial => refs[refIndex++] ??= { current: initial }, useEffect: effect => effects.push(effect) });
  t.after(() => {
    configure(React);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const render = () => { index = 0; refIndex = 0; updates = useUpdates(); return UpdateSettings({ updates, onClose: () => closed++ }); };
  return {
    render, effects,
    get updates() { render(); return updates; },
    get closed() { return closed; },
    markup: () => renderToStaticMarkup(render()),
    button: label => nodes(render()).find(node => node.type === 'button' && node.props.children === label),
  };
}

test('manual update check reports current version, errors and newer releases without installing', async t => {
  const calls = [];
  let finish;
  const ui = harness(t, command => { calls.push(command); return new Promise((resolve, reject) => { finish = { resolve, reject }; }); });
  let checking = ui.button('Check for updates').props.onClick();
  assert.equal(ui.button('Checking…').props.disabled, true);
  finish.resolve(null); await checking;
  assert.match(ui.markup(), /Bees is up to date/);
  checking = ui.button('Check for updates').props.onClick();
  finish.reject(Error('Network unavailable')); await checking;
  assert.match(ui.markup(), /Could not check for updates: Error: Network unavailable/);
  checking = ui.button('Check for updates').props.onClick();
  finish.resolve('0.2.3'); await checking;
  assert.match(ui.markup(), /Bees 0.2.3 is ready to install/);
  assert(ui.button('Update and restart'));
  assert.deepEqual(calls, Array(3).fill('check_for_update'));
});

test('install controls handle cancellation and failures; Later preserves the update indicator', async t => {
  let fail = false, finish;
  const calls = [], ui = harness(t, async command => {
    calls.push(command);
    if (command === 'check_for_update') return '0.2.3';
    if (fail) throw Error('Download failed');
    return new Promise(resolve => { finish = resolve; });
  });
  await ui.button('Check for updates').props.onClick();
  const installing = ui.button('Update and restart').props.onClick();
  assert(ui.button('Downloading…').props.disabled);
  assert(ui.button('Check for updates').props.disabled);
  assert(ui.button('Later').props.disabled);
  await ui.updates.check(); await ui.updates.install();
  assert.deepEqual(calls, ['check_for_update', 'install_update'], 'Update operations cannot overlap');
  finish(false); await installing;
  assert.equal(ui.button('Update and restart').props.disabled, false);
  fail = true; await ui.button('Update and restart').props.onClick();
  assert.match(ui.markup(), /Update failed: Error: Download failed/);
  ui.button('Later').props.onClick();
  assert.equal(ui.closed, 1);
  assert.equal(ui.updates.version, '0.2.3');
  assert.deepEqual(calls, ['check_for_update', 'install_update', 'install_update']);
});

test('automatic checks still run at launch and every six hours, with quiet failures and timer cleanup', async t => {
  const calls = [];
  let poll, cleared, completeInstall;
  t.mock.method(globalThis, 'setInterval', (callback, delay) => { poll = callback; assert.equal(delay, 6 * 60 * 60 * 1000); return 42; });
  t.mock.method(globalThis, 'clearInterval', timer => { cleared = timer; });
  const ui = harness(t, async command => {
    calls.push(command);
    if (command === 'install_update') return new Promise(resolve => { completeInstall = resolve; });
    if (calls.length === 1) throw Error('Offline');
    return '0.2.3';
  });
  ui.render();
  const cleanup = ui.effects[0]();
  await new Promise(setImmediate);
  assert.equal(ui.updates.version, null);
  assert.match(ui.markup(), /You are on version 0.2.2/);
  assert.doesNotMatch(ui.markup(), /Offline|Could not check/);
  poll(); await new Promise(setImmediate);
  assert.match(ui.markup(), /Bees 0.2.3 is ready to install/);
  assert.deepEqual(calls, ['check_for_update', 'check_for_update']);
  const installing = ui.button('Update and restart').props.onClick();
  poll(); await new Promise(setImmediate);
  assert(ui.button('Downloading…').props.disabled, 'A background check cannot re-enable installation controls');
  assert.deepEqual(calls, ['check_for_update', 'check_for_update', 'install_update']);
  completeInstall(false); await installing;
  cleanup(); assert.equal(cleared, 42);
});

test('update controls stay hidden in hosted and non-desktop clients', async t => {
  for (const [invoke, hosted] of [[undefined, false], [() => assert.fail('Hosted clients must not check desktop updates'), true]]) {
    await t.test(hosted ? 'hosted' : 'non-desktop', t => {
      const ui = harness(t, invoke, hosted);
      assert.equal(ui.render(), null);
      assert.equal(ui.effects[0](), undefined);
    });
  }
});

test('successful install keeps controls locked until restart', async t => {
  const ui = harness(t, async command => command === 'check_for_update' ? '0.2.3' : true);
  await ui.button('Check for updates').props.onClick();
  await ui.button('Update and restart').props.onClick();
  assert(ui.button('Downloading…').props.disabled);
  assert(ui.button('Check for updates').props.disabled);
});

test('update icon appears above theme, describes both versions and opens update settings', async t => {
  t.mock.method(globalThis, 'setInterval', () => 42);
  t.mock.method(globalThis, 'clearInterval', () => {});
  const ui = harness(t, async () => '0.2.3'), calls = [];
  ui.render();
  ui.effects[0](); await new Promise(setImmediate);
  const props = { icon: () => null, theme: {}, updates: ui.updates, onGlobal: section => calls.push(section) };
  const nav = BeesNavigation(props), markup = renderToStaticMarkup(nav);
  const button = nodes(nav).find(node => node.props.className === 'bc-rail-action bc-update-available');
  assert.equal(button.props.title, 'You are on version 0.2.2, new version 0.2.3 available, click to update');
  assert.equal(button.props['aria-label'], button.props.title);
  assert(markup.indexOf('bc-update-available') < markup.indexOf('Switch to dark theme'));
  button.props.onClick();
  assert.deepEqual(calls, ['updates']);
  assert.match(threadCss, /bc-update-available>svg\{[^}]*animation:bc-update-pulse/);
  assert.match(threadCss, /prefers-reduced-motion:reduce\)\{\.bc-app \*[^}]*animation:none!important/);
  assert.doesNotMatch(renderToStaticMarkup(BeesNavigation({ ...props, updates: { enabled: true, version: null } })), /bc-update-available/);
});
