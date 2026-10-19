import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThreadClient } from './thread-client.js';
import { THREAD_PAGES, defaultThreadLayout, normalizeThreadLayout, layoutGroups, updateLayoutNode, activateWidget, dockWidget } from './thread-layout.js';

const views = layout => layoutGroups(layout).flatMap(group => group.tabs);
const assertComplete = layout => {
  assert.deepEqual([...views(layout)].sort(), THREAD_PAGES.map(([id]) => id).sort());
  assert.deepEqual(normalizeThreadLayout(layout), layout);
};

test('desktop leaves HTML drag and drop to the widget UI', () => {
  const config = JSON.parse(readFileSync(new URL('../../../src-tauri/tauri.conf.json', import.meta.url)));
  assert.equal(config.app.windows[0].dragDropEnabled, false);
});

test('views start as tabs, split in every direction, regroup and collapse empty groups', () => {
  const original = defaultThreadLayout();
  for (const position of ['left', 'right', 'top', 'bottom']) {
    const split = dockWidget(original, 'files', 'conversation', position, position);
    assertComplete(split);
    assert.equal(split.type, ['left', 'right'].includes(position) ? 'row' : 'column');
    assert.equal(split[['left', 'top'].includes(position) ? 'first' : 'second'].active, 'files');
    const grouped = dockWidget(split, 'files', 'conversation', 'tab');
    assert.equal(grouped.type, 'tabs');
    assert.equal(grouped.active, 'files');
    assertComplete(grouped);
  }
  assert.equal(layoutGroups(original).length, 1);
  assert.equal(original.active, 'conversation');
  assert.deepEqual(original.tabs, ['conversation', 'files', 'kanban', 'discussion', 'details', 'context', 'schedule', 'memory', 'addons', 'runs', 'traces']);
});

test('nested splits, tab ordering, navigation and divider sizes preserve all views', () => {
  let layout = dockWidget(defaultThreadLayout(), 'files', 'conversation', 'right', 'files');
  layout = dockWidget(layout, 'kanban', 'files', 'bottom', 'kanban');
  assert.equal(layoutGroups(layout).length, 3);
  layout = dockWidget(layout, 'discussion', 'files', 'before');
  assert.deepEqual(layoutGroups(layout).find(group => group.tabs.includes('files')).tabs, ['discussion', 'files']);
  layout = activateWidget(layout, 'files');
  assert.equal(layoutGroups(layout).find(group => group.tabs.includes('files')).active, 'files');
  layout = updateLayoutNode(layout, 'kanban-split', node => ({ ...node, ratio: 0.7 }));
  assert.equal(layout.second.ratio, 0.7);
  assertComplete(layout);
  layout = dockWidget(layout, 'kanban', 'conversation', 'tab');
  assert.equal(layoutGroups(layout).length, 2);
  assertComplete(layout);
  for (const [from, to, position] of [['files', 'files', 'right'], ['unknown', 'files', 'tab'], ['files', 'missing', 'tab'], ['files', 'conversation', 'unknown']]) {
    assert.equal(dockWidget(layout, from, to, position), layout);
  }
});

test('invalid, incomplete, repeated and oversized layouts are rejected', () => {
  const valid = defaultThreadLayout();
  const split = dockWidget(valid, 'files', 'conversation', 'right', 'files');
  for (const value of [null, {}, [], { ...valid, type: 'html' }, { ...valid, tabs: [] },
    { ...valid, tabs: [...valid.tabs, 'files'] }, { ...valid, tabs: valid.tabs.slice(1) },
    { ...valid, tabs: [...valid.tabs, 'unknown'] }, { ...valid, active: 'missing' },
    { ...valid, id: '<script>' }, { ...valid, id: 'a'.repeat(81) },
    { ...split, ratio: NaN }, { ...split, ratio: 1 }, { ...split, ratio: '0.5' },
    { ...split, second: { ...split.second, id: 'main' } }]) assert.equal(normalizeThreadLayout(value), null);
  const cyclic = { type: 'row', id: 'loop', ratio: 0.5, second: valid };cyclic.first = cyclic;
  assert.equal(normalizeThreadLayout(cyclic), null);
  assert.deepEqual(normalizeThreadLayout({ ...valid, secret: 'discard' }), valid);
});

test('layouts persist as client preferences without entering shared thread documents; invalid updates are atomic', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bees-layout-'));let client = new ThreadClient(root);
  try {
    const layout = dockWidget(defaultThreadLayout(), 'files', 'conversation', 'right', 'files');
    await client.command({ action: 'preferences', values: { threadLayout: layout } });
    const thread = await client.command({ action: 'create', title: 'Layout is personal' });
    assert.equal(client.store.document(thread.id).threadLayout, undefined);
    await assert.rejects(client.command({ action: 'preferences', values: { systemInstructions: 'should not save', threadLayout: {} } }), /Invalid thread layout/);
    assert.equal((await client.snapshot()).settings.systemInstructions, undefined);
    client.store.close();client = new ThreadClient(root);
    assert.deepEqual((await client.snapshot()).settings.threadLayout, layout);
  } finally {client.store.close();rmSync(root, { recursive: true, force: true });}
});
