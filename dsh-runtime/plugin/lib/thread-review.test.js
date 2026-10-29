import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { configureRuntime } from '../client/runtime.js';
import { ReviewScreen } from '../client/thread-review.js';
import { validateReview, reviewValueErrors } from './thread-review.js';
import { mountReviewTool, consumeReviewedAction } from './thread-review-tool.js';
import { ThreadRunner } from './thread-runner.js';
import { ThreadClient } from './thread-client.js';

configureRuntime(name => ({ react: React, 'react-dom': {}, '@deepseek-ai/dsh-client-ui-primitives': {} })[name], { hosted: true });
const customer = () => ({ title: 'Review API customer update', effect: 'Use these corrected customer values for the next step.',
  values: Object.fromEntries(Array.from({ length: 10 }, (_, index) => ['field' + index, index ? 'Value ' + index : ''])),
  view: { type: 'split', children: [{ type: 'sources', label: 'API evidence', items: [{ label: 'Customer API', text: 'Retrieved customer record, including missing contact information.' }] },
    { type: 'stack', label: 'Customer fields', children: Array.from({ length: 10 }, (_, index) => ({ type: 'field', key: 'field' + index, label: 'Field ' + index, kind: 'text', required: true })) }] } });
const shortlist = () => ({ title: 'Choose suppliers from search', effect: 'Continue research on the selected suppliers.',
  values: { suppliers: [{ name: 'Acme', selected: false }, { name: 'Example', selected: true }] },
  view: { type: 'tabs', label: 'Supplier review', children: [
    { type: 'table', label: 'Search results', key: 'suppliers', editable: true, columns: [
      { key: 'name', label: 'Supplier', kind: 'text', readOnly: true }, { key: 'selected', label: 'Research this supplier', kind: 'boolean', required: true }] },
    { type: 'sources', label: 'Evidence', items: [{ label: 'Supplier site', url: 'https://example.com', text: 'Evidence from agent search.' }] }] } });
const email = () => ({ title: 'Review outgoing message', effect: 'Send this message once through the connected mail account.', action: { toolName: 'mcp__mail__send' },
  values: { to: 'customer@example.com', body: 'Thank you for your interest.' }, view: { type: 'split', children: [
    { type: 'diff', label: 'Message comparison', before: 'Original draft', after: 'Thank you for your interest.' },
    { type: 'stack', children: [{ type: 'field', key: 'to', label: 'Recipient', kind: 'text', required: true }, { type: 'field', key: 'body', label: 'Message', kind: 'textarea', required: true }] }] } });

function harness(request = customer()) {
  const root = mkdtempSync(join(tmpdir(), 'bees-review-')), runner = new ThreadRunner({});
  const client = new ThreadClient(root, { pending: id => runner.pending.get(id), answer: (id, input) => runner.answer(id, input) });
  const thread = client.store.create('Review workflow'), runId = randomUUID();
  client.store.mutate(thread.id, randomUUID(), doc => { doc.runs.push({ id: runId, status: 'running', prompt: 'Prepare work' }); });
  let tool; const owner = {};
  mountReviewTool({ tools: { register: value => { tool = value; } } }, { owner, runner, store: client.store, threadId: thread.id, runId });
  const begin = (screen = request, controller = new AbortController()) => ({ controller,
    result: tool.execute({ screen: JSON.stringify(screen) }, { agent: owner, signal: controller.signal }) });
  const read = () => client.store.document(thread.id).runs.find(run => run.id === runId);
  const command = (decision, extra = {}) => {
    const review = read().reviews[0];
    return client.localCommand(thread.id, { action: 'review', operationId: randomUUID(), runId, reviewId: review.id,
      revision: review.revision, values: review.values, decision, ...extra }, 'local');
  };
  const close = () => { client.store.close(); rmSync(root, { recursive: true, force: true }); };
  return { root, client, runner, thread, runId, begin, read, command, close, tool, owner };
}

test('API, search and MCP screens render through the same contract; ten fields share one approval', () => {
  for (const request of [customer(), shortlist(), email()]) {
    validateReview(request);
    const markup = renderToStaticMarkup(React.createElement(ReviewScreen, { review: { id: randomUUID(), revision: 1, state: 'open', request, values: request.values } }));
    assert.match(markup, /Save and approve/);
    assert.equal(markup.match(/Save and approve/g).length, 1);
    assert.doesNotMatch(markup, /<script|<iframe/);
    if (request.title.includes('API')) assert.equal(markup.match(/<input/g).length, 10);
    if (request.action) assert.match(markup, /External action:.*mcp__mail__send/);
  }
  const request = customer();
  assert.equal(reviewValueErrors(request, request.values).field0, 'This field is required.');
  request.values.field0 = 'Corrected';
  assert.deepEqual(reviewValueErrors(request, request.values), {});
});

test('screens reject executable content, duplicate bindings, unsafe links and oversized trees', () => {
  for (const change of [
    request => { request.view = { type: 'html', text: '<script>alert(1)</script>' }; },
    request => { request.view.children[1].children[0].onClick = 'send()'; },
    request => { request.view.children[1].children[1].key = 'field0'; },
    request => { request.view.children[0].items[0].url = 'javascript:alert(1)'; },
    request => { request.view.children[0].items[0].url = 'https://user:secret@example.com'; },
    request => { request.values.unknown = 'hidden argument'; },
    request => { request.view.children[1].children[0].key = 'constructor'; },
    request => { request.view.children = Array(121).fill({ type: 'text', text: 'Large' }); },
  ]) {
    const request = customer(); change(request); assert.throws(() => validateReview(request));
  }
});

test('drafts allow incomplete values but approval validates dates, bounds, choices and table edits', () => {
  const request = { title: 'Validate data', effect: 'Use corrected data.', values: { date: '2026-02-30', amount: 0, choice: 'Other', enabled: false },
    view: { type: 'stack', children: [
      { type: 'field', key: 'date', label: 'Date', kind: 'date', required: true },
      { type: 'field', key: 'amount', label: 'Amount', kind: 'number', min: 1, max: 100 },
      { type: 'field', key: 'choice', label: 'Choice', kind: 'select', options: ['A', 'B'] },
      { type: 'field', key: 'enabled', label: 'Enabled', kind: 'boolean', required: true }] } };
  validateReview(request);
  assert.deepEqual(Object.keys(reviewValueErrors(request, request.values)), ['date', 'amount', 'choice']);
  assert.deepEqual(reviewValueErrors(request, request.values, false), {});
  assert.match(reviewValueErrors(request, { ...request.values, date: 'nonsense' }).date, /valid date/);
  assert.throws(() => reviewValueErrors(request, { ...request.values, amount: '100' }), /Invalid value/);
  const search = shortlist(), values = structuredClone(search.values);
  values.suppliers[0].selected = true; assert.deepEqual(reviewValueErrors(search, values), {});
  values.suppliers[0].name = 'Forged'; assert.throws(() => reviewValueErrors(search, values), /Read-only/);
  assert.throws(() => reviewValueErrors(search, { suppliers: [] }), /original review table rows/);
});

test('one review saves drafts, rejects stale or invalid approval, and returns corrected values once', async () => {
  const h = harness(), work = h.begin();
  try {
    assert.equal(h.runner.pending.size, 1); assert.equal(h.read().reviews.length, 1);
    await assert.rejects(h.command('approve'), /highlighted/);
    const values = { ...h.read().reviews[0].values, field0: 'Corrected customer' }, revision = h.read().reviews[0].revision;
    await h.command('save', { values, note: 'Contact checked against API.' });
    assert.equal(h.read().reviews[0].note, 'Contact checked against API.');
    assert.equal(h.read().reviews[0].state, 'open'); assert.equal(h.runner.pending.size, 1);
    await assert.rejects(h.command('approve', { revision, values }), /changed/);
    const operationId = randomUUID();
    await h.command('approve', { operationId });
    const answer = JSON.parse(await work.result);
    assert.equal(answer.decision, 'approve'); assert.equal(answer.values.field0, 'Corrected customer');
    assert.equal(h.read().reviews[0].request.values.field0, '');
    assert.equal(h.read().reviews[0].actorId, 'local'); assert.equal(h.read().pending, undefined);
    assert.equal(h.runner.pending.size, 0);
    await h.command('approve', { operationId });
    await assert.rejects(h.command('approve'), /changed/);
    assert.equal(h.read().decisions.length, 1);
  } finally { h.close(); }
});

test('owner permissions, generic-answer bypass and queued reviews preserve the approval boundary', async () => {
  const h = harness(shortlist()), first = h.begin(), second = h.begin(email());
  try {
    const pending = h.read().pending;
    await assert.rejects(h.client.localCommand(h.thread.id, { action: 'answer', operationId: randomUUID(), questionId: pending.id, approved: true }, 'local'), /review screen/);
    const doc = h.client.store.document(h.thread.id); doc.shared = true; doc.ownerUserId = 'owner'; h.client.store.save(doc);
    const review = h.read().reviews[0];
    // Exercise the same mutation boundary without a directory connection for this synthetic shared thread.
    const { saveReviewDecision } = await import('./thread-review-tool.js');
    assert.throws(() => saveReviewDecision(h.client.store, h.thread.id, { operationId: randomUUID(), runId: h.runId,
      reviewId: review.id, revision: 1, values: review.values, decision: 'approve' }, 'editor', h.runner.pending.get(pending.id)), /Only the thread owner/);
    doc.shared = false; h.client.store.save(doc);
    await h.command('request_changes', { note: 'Check this supplier again.' });
    assert.equal(JSON.parse(await first.result).decision, 'request_changes');
    assert.equal(h.read().pending.reviewId, h.read().reviews[1].id);
    const next = h.read().reviews[1];
    await h.command('reject', { reviewId: next.id, revision: next.revision, values: next.values });
    assert.equal(JSON.parse(await second.result).decision, 'reject');
    assert.equal(consumeReviewedAction(h.client.store, h.thread.id, h.runId, { name: 'mcp__mail__send', arguments: next.values }), false);
  } finally { h.close(); }
});

test('MCP approvals match the complete final arguments, are single use and never carry to another run', async () => {
  const h = harness(email()), work = h.begin();
  try {
    const values = { ...h.read().reviews[0].values, body: 'The corrected message.' };
    await h.command('approve', { values }); await work.result;
    const consume = (args, name = 'mcp__mail__send', run = h.runId) => consumeReviewedAction(h.client.store, h.thread.id, run, { name, arguments: args });
    assert.equal(consume(email().values), false);
    assert.equal(consume(values, 'mcp__other__send'), false);
    assert.equal(consume(values, undefined, randomUUID()), false);
    assert.equal(consume(values), true); assert.equal(consume(values), false);
    const doc = h.client.store.document(h.thread.id); doc.runs[0].reviews[0].values.body = 'Changed after approval';
    assert.throws(() => h.client.store.save(doc), /Invalid approved review/);
  } finally { h.close(); }
});

test('interrupted reviews survive reopening; deciding never replays work or authorizes a later action', async () => {
  const h = harness(email()), work = h.begin(); let reopened;
  try {
    const review = h.read().reviews[0], values = { ...review.values, body: 'Saved before restart' };
    await h.command('save', { values });
    reopened = new ThreadClient(h.root);
    const run = reopened.store.document(h.thread.id).runs[0];
    assert.equal(run.status, 'uncertain'); assert.equal(run.reviews[0].values.body, values.body);
    await assert.rejects(reopened.localCommand(h.thread.id, { action: 'run', operationId: randomUUID(), text: 'Continue' }, 'local'), /Resolve the saved review/);
    await reopened.localCommand(h.thread.id, { action: 'review', operationId: randomUUID(), runId: h.runId,
      reviewId: review.id, revision: run.reviews[0].revision, values, decision: 'approve' }, 'local');
    assert.equal(reopened.jobs.size, 0);
    const saved = reopened.store.document(h.thread.id);
    assert.equal(saved.runs[0].reviews[0].resumeRequired, true);
    assert.match(saved.messages.at(-1).text, /fresh action approval/);
    assert.equal(consumeReviewedAction(reopened.store, h.thread.id, randomUUID(), { name: 'mcp__mail__send', arguments: values }), false);
    assert.equal(consumeReviewedAction(reopened.store, h.thread.id, h.runId, { name: 'mcp__mail__send', arguments: values }), false);
    // End the original synthetic waiter without touching the reopened decision.
    const rejected = assert.rejects(work.result, /Work stopped/); work.controller.abort(); await rejected;
  } finally { reopened?.store.close(); h.close(); }
});

test('closing the client preserves pending reviews while explicit Stop cancels them', async () => {
  for (const stopping of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), 'bees-review-shutdown-')), runner = new ThreadRunner({});
    let tool, reopened;
    const owner = {}, client = new ThreadClient(root, { pending: id => runner.pending.get(id), answer: (id, input) => runner.answer(id, input),
      execute: async ({ thread, run, signal, store }) => {
        mountReviewTool({ tools: { register: value => { tool = value; } } }, { owner, runner, store, threadId: thread.id, runId: run.id });
        return tool.execute({ screen: JSON.stringify(email()) }, { agent: owner, signal });
      } });
    try {
      const thread = client.store.create('Shutdown review');
      await client.localCommand(thread.id, { action: 'run', operationId: randomUUID(), text: 'Prepare message' }, 'local');
      assert.equal(client.store.document(thread.id).runs[0].reviews[0].state, 'open');
      if (stopping) { await client.localCommand(thread.id, { action: 'stop', operationId: randomUUID() }, 'local'); await Promise.all(client.finishing); }
      await client.close(); reopened = new ThreadClient(root);
      const run = reopened.store.document(thread.id).runs[0];
      assert.equal(run.reviews[0].state, stopping ? 'cancelled' : 'open');
      assert.equal(run.status, stopping ? 'cancelled' : 'uncertain');
      assert.equal(run.pending?.kind, stopping ? undefined : 'review');
    } finally { reopened?.store.close(); rmSync(root, { recursive: true, force: true }); }
  }
});
