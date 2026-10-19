import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { configureRuntime } from '../client/runtime.js';
import { ThreadKanban, kanbanColumns } from '../client/thread-kanban.js';
import { THREAD_PAGES } from '../client/thread-panels.js';

configureRuntime(name => ({ react: React, 'react-dom': {}, '@deepseek-ai/dsh-client-ui-primitives': {} })[name], { hosted: true });
const render = thread => renderToStaticMarkup(React.createElement(ThreadKanban, { thread }));
const run = { id: 'run', prompt: 'Test five parallel agents', createdAt: '2026-10-18T00:00:00Z', status: 'running', stageIndex: 0, agents: [
  { id: 'parent', stageIndex: 0, status: 'running', model: 'example-model' },
  ...['first', 'second', 'third', 'fourth', 'fifth'].map(word => ({ id: word, parentId: 'parent', stageIndex: 0, status: 'completed', title: `Append ${word} entry` })),
] };

test('every thread defaults to Goals with Work, Review and Done, even without executions', () => {
  assert(THREAD_PAGES.some(([id, title]) => id === 'kanban' && title === 'Kanban'));
  assert.deepEqual(kanbanColumns({}).map(stage => stage.name), ['Work', 'Review', 'Done']);
  const markup = render({ runs: [] });
  assert.match(markup, />Goals</);
  assert.match(markup, /Work → Review → Done/);
  assert.equal((markup.match(/No work/g) ?? []).length, 3);
  assert.match(markup, /Start work in Conversation/);
});

test('work cards move between columns and completed subagents move to Done', () => {
  const cards = value => kanbanColumns({}, value).map(stage => stage.cards.map(card => card.id));
  assert.deepEqual(cards(run), [['run'], [], ['first', 'second', 'third', 'fourth', 'fifth']]);
  assert.deepEqual(cards({ ...run, stageIndex: 1 }), [[], ['run'], ['first', 'second', 'third', 'fourth', 'fifth']]);
  assert.deepEqual(cards({ ...run, status: 'completed' }), [[], [], ['run', 'first', 'second', 'third', 'fourth', 'fifth']]);
  const custom = { ...run, workflow: [{ name: 'Build', kind: 'work' }, { name: 'Build', kind: 'review' }], stageIndex: 1 };
  assert.equal(kanbanColumns({}, custom)[1].cards[0].id, 'run');
  assert.match(render({ runs: [custom] }), /Custom process/);
  assert.deepEqual(kanbanColumns({ workflow: custom.workflow }, { ...run, workflow: undefined }).map(stage => stage.name), ['Work', 'Review', 'Done']);
});

test('the board shows named subagent cards, parent links, execution history and selectable details', () => {
  const markup = render({ runs: [{ ...run, pending: { kind: 'questions' } }] });
  for (const word of ['first', 'second', 'third', 'fourth', 'fifth']) assert.match(markup, new RegExp(`Append ${word} entry`));
  assert.match(markup, /1 agents · 5 subagents/);
  assert.match(markup, /Root work item/);
  assert.match(markup, /Parent: Test five parallel agents/);
  assert.match(markup, /aria-label="Done work items"/);
  assert.match(markup, /aria-label="Work item details"/);
  assert.match(markup, /example-model/);
  assert.match(markup, /Needs input/);
  assert.match(markup, /Respond in Conversation/);
  assert.match(markup, /Latest execution/);
  assert.match(markup, /aria-pressed="true"/);
});

test('interrupted work never shows stale questions or claims unfinished agents are done', () => {
  const interrupted = { ...run, status: 'uncertain', pending: { kind: 'approval' }, agents: [
    ...run.agents, { id: 'unfinished', parentId: 'parent', stageIndex: 0, status: 'running' },
  ] };
  const columns = kanbanColumns({}, interrupted);
  assert.equal(columns[0].cards.find(card => card.id === 'unfinished').status, 'uncertain');
  const markup = render({ runs: [interrupted] });
  assert.doesNotMatch(markup, /data-status="running"|Respond in Conversation/);
  assert.match(markup, /Interrupted/);
  const legacy = render({ runs: [{ ...run, status: 'completed', agents: undefined }] });
  assert.match(legacy, /Agent history unavailable/);
  assert.doesNotMatch(legacy, /No agent activity recorded|0 subagents/);
  assert.match(legacy, /Root work item/);
});
