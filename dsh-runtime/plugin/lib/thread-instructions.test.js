import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { configureRuntime } from '../client/runtime.js';
import { ThreadDetails } from '../client/thread-panels.js';

const configure = react => configureRuntime(name => ({ react, 'react-dom': {}, '@deepseek-ai/dsh-client-ui-primitives': {} })[name], { hosted: true });
const nodes = node => !React.isValidElement(node) ? [] : [node, ...React.Children.toArray(node.props.children).flatMap(nodes)];
configure(React);

test('thread instructions display separately from inherited instructions and stay read-only without permission', () => {
  const props = { page: 'context', thread: { instructions: 'Use short paragraphs.\nCite sources.', artifacts: [] }, teamInstructions: 'Write in English.' };
  const markup = renderToStaticMarkup(React.createElement(ThreadDetails, props));
  assert(markup.includes('Use short paragraphs.\nCite sources.'));
  assert(markup.includes('Team instructions')); assert(markup.includes('Write in English.'));
  assert.doesNotMatch(markup, /Edit instructions|Add instructions|<textarea/);
  const editable = renderToStaticMarkup(React.createElement(ThreadDetails, { ...props, canConfigure: true }));
  assert(editable.includes('Edit instructions')); assert(!editable.includes('<textarea'));
  const empty = renderToStaticMarkup(React.createElement(ThreadDetails, { ...props, thread: { artifacts: [] }, canConfigure: true }));
  assert(empty.includes('Add instructions')); assert(empty.includes('no instructions of its own'));
});

test('inline instructions can be added, edited, cancelled and cleared; failed saves keep the draft', async () => {
  let editing = null, succeed = false;
  const calls = [], props = { page: 'context', thread: { artifacts: [] }, canConfigure: true, busy: false,
    onSave: async values => { calls.push(values); if (succeed) props.thread.instructions = values.instructions; return succeed; } };
  configure({ ...React, useState: () => [editing, value => { editing = value; }] });
  const render = () => nodes(ThreadDetails(props));
  const button = label => render().find(node => node.type === 'button' && node.props.children === label);
  const input = () => render().find(node => node.type === 'textarea');
  const submit = () => render().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  try {
    button('Add instructions').props.onClick();
    assert.equal(input().props.value, ''); assert.equal(input().props.maxLength, 20000);
    input().props.onChange({ target: { value: 'Cite primary sources.' } });
    await submit(); assert.equal(input().props.value, 'Cite primary sources.');
    assert.deepEqual(calls, [{ instructions: 'Cite primary sources.' }]);
    props.busy = true;
    assert.equal(render().find(node => node.type === 'fieldset').props.disabled, true);
    await submit(); assert.equal(calls.length, 1);
    props.busy = false; props.canConfigure = false;
    assert(!input()); assert(!render().some(node => node.type === 'form'));
    props.canConfigure = true;
    button('Cancel').props.onClick(); assert(!input()); assert.equal(calls.length, 1);
    button('Add instructions').props.onClick(); assert.equal(input().props.value, '');
    input().props.onChange({ target: { value: 'Cite primary sources.' } });
    succeed = true; await submit(); assert(!input()); assert(button('Edit instructions'));
    button('Edit instructions').props.onClick(); assert.equal(input().props.value, 'Cite primary sources.');
    input().props.onChange({ target: { value: '' } });
    button('Cancel').props.onClick(); assert.equal(props.thread.instructions, 'Cite primary sources.');
    button('Edit instructions').props.onClick(); assert.equal(input().props.value, 'Cite primary sources.');
    input().props.onChange({ target: { value: '' } }); await submit();
    assert.deepEqual(calls.at(-1), { instructions: '' }); assert(button('Add instructions'));
  } finally { configure(React); }
});
