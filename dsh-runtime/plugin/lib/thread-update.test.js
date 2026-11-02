import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { configureRuntime } from '../client/runtime.js';
import { UpdateBar } from '../client/thread-app.js';

const nodes = node => !React.isValidElement(node) ? [] : [node, ...React.Children.toArray(node.props.children).flatMap(nodes)];
function harness(t, invoke, hosted = false) {
  const previousWindow = globalThis.window, states = [], effects = [];
  let index = 0;
  globalThis.window = invoke ? { __TAURI__: { core: { invoke } } } : {};
  const configure = react => configureRuntime(name => ({ react, 'react-dom': {}, '@deepseek-ai/dsh-client-ui-primitives': {}, '@bees/dsh-custom-ai': {}, '@bees/dsh-subscriptions': {} })[name], { hosted });
  configure({ ...React, useState: initial => {
    const key = index++;
    if (!(key in states)) states[key] = initial;
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value; }];
  }, useEffect: effect => effects.push(effect) });
  t.after(() => {
    configure(React);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const render = (showCheck = true) => { index = 0; return UpdateBar({ showCheck }); };
  return {
    render, effects,
    markup: () => renderToStaticMarkup(render()),
    button: label => nodes(render()).find(node => node.type === 'button' && node.props.children === label),
  };
}

test('manual update check reports current version, errors and newer releases without installing', async t => {
  const calls = [];
  let finish;
  const ui = harness(t, command => { calls.push(command); return new Promise((resolve, reject) => { finish = { resolve, reject }; }); });
  assert.equal(ui.render(false), null, 'The manual button only appears in Settings');
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
  assert.match(renderToStaticMarkup(ui.render(false)), /Update and restart/, 'Available updates remain visible outside Settings');
  assert.deepEqual(calls, Array(3).fill('check_for_update'));
});

test('install controls still handle cancellation, failures and deferring an update', async t => {
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
  finish(false); await installing;
  assert.equal(ui.button('Update and restart').props.disabled, false);
  fail = true; await ui.button('Update and restart').props.onClick();
  assert.match(ui.markup(), /Update failed: Error: Download failed/);
  ui.button('Later').props.onClick();
  assert.equal(ui.render(false), null);
  assert.doesNotMatch(ui.markup(), /Update failed|Update and restart/);
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
  assert.equal(ui.render(false), null);
  assert.doesNotMatch(ui.markup(), /Offline|Could not check/);
  poll(); await new Promise(setImmediate);
  assert.match(ui.markup(), /Bees 0.2.3 is ready to install/);
  assert.deepEqual(calls, ['check_for_update', 'check_for_update']);
  const installing = ui.button('Update and restart').props.onClick();
  poll(); await new Promise(setImmediate);
  assert(ui.button('Downloading…').props.disabled, 'A background check cannot re-enable installation controls');
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
