import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { configureRuntime } from '../client/runtime.js';
import { ThreadFiles, readFilePreview } from '../client/thread-files.js';

configureRuntime(name => ({ react: React, 'react-dom': {}, '@deepseek-ai/dsh-client-ui-primitives': {} })[name], { hosted: true });
const file = (name, extra = {}) => ({ id: name, name, size: 1024, ...extra });
const render = (artifacts, props = {}) => renderToStaticMarkup(React.createElement(ThreadFiles, {
  thread: { artifacts, folders: [] }, canWrite: true, busy: false, ...props,
}));

test('Files separates uploads from generated results, including nested and older files', () => {
  const markup = render([
    file('brief.txt', { authorId: 'local' }),
    file('legacy.txt'),
    file('reference.txt', { authorId: 'colleague', path: 'research/reference.txt' }),
    file('uploaded-result.txt', { authorId: 'local', path: 'results/uploaded-result.txt' }),
    file('report.txt', { authorId: 'bees', path: 'results/run-1/report.txt' }),
    file('previous-report.txt', { authorId: 'bees' }),
  ]);
  const [inputs, outputs] = markup.split('aria-label="Output files"');
  assert.match(inputs, /aria-label="Input files"/);
  assert.match(inputs, /brief.txt/);
  assert.match(inputs, /legacy.txt/);
  assert.match(inputs, /<strong>research<\/strong>/);
  assert.match(inputs, /<strong>results<\/strong>/);
  assert.doesNotMatch(inputs, /report.txt/);
  assert.match(outputs, /results\/run-1\/report.txt/);
  assert.match(outputs, /previous-report.txt/);
  assert.doesNotMatch(outputs, /brief.txt|reference.txt|uploaded-result.txt/);
});

test('Files keeps empty states and disables uploads for viewers', () => {
  const markup = render([], { canWrite: false });
  assert.match(markup, /This folder is empty/);
  assert.match(markup, /No output files yet/);
  assert.match(markup, /<button disabled="">Add files<\/button>/);
  assert.match(markup, /<button disabled="">Add folder<\/button>/);
  assert.match(markup, /bc-files-toolbar"><h3>Input files<\/h3>/);
  assert.doesNotMatch(markup, /<h3>Files<\/h3>|Create folder|New folder name|Files you and your collaborators|Results Bees creates/);
});

test('File previews keep the file list above the preview and allow another selection', () => {
  const url = '/bees-api/thread-file?thread=example&artifact=report';
  const markup = render([file('report.txt'), file('other.txt')], { preview: file('report.txt', { url }) });
  assert.match(markup, /aria-label="File preview"/);
  assert.match(markup, /Close preview/);
  assert.match(markup, /Loading preview/);
  assert.match(markup, /href="\/bees-api\/thread-file\?thread=example&amp;artifact=report" download="report.txt"/);
  assert.match(markup, /Add files/);
  assert.match(markup, /aria-pressed="true"><span><strong>report.txt/);
  assert.match(markup, /aria-pressed="false"><span><strong>other.txt/);
  assert.ok(markup.indexOf('bc-files-list') < markup.indexOf('bc-file-preview'));
});

test('Files reserves a preview pane before a file is selected', () => {
  assert.match(render([]), /Select a file above to preview it here/);
});

test('Previews identify media, render UTF-8 files and reject binary data', async t => {
  let bytes = 'File contents';
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes));
  for (const [name, type] of [['photo.PNG', 'image/png'], ['document.pdf', 'application/pdf'], ['song.mp3', 'audio/mpeg'], ['clip.mp4', 'video/mp4']]) {
    const preview = await readFilePreview({ name, url: '/file' });
    assert.equal(preview.type, type);
    assert.equal(preview.blob.type, type);
  }
  for (const [name, type] of [['README.md', 'md'], ['index.html', 'html'], ['data.json', 'text'], ['LICENSE', 'text']]) {
    assert.deepEqual(await readFilePreview({ name, url: '/file' }), { type, text: bytes });
  }
  bytes = new Uint8Array([0, 1, 2]);
  assert.deepEqual(await readFilePreview({ name: 'archive.zip', url: '/file' }), {});
  bytes = new Uint8Array([255]);
  assert.deepEqual(await readFilePreview({ name: 'unknown.bin', url: '/file' }), {});
});

test('Previews report unavailable files and pass cancellation to fetch', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    assert.equal(signal, controller.signal);
    return new Response('', { status: 404 });
  });
  await assert.rejects(readFilePreview({ name: 'missing.txt', url: '/file' }, controller.signal), /File has not arrived yet/);
});
