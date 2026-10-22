import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ThreadClient } from './thread-client.js';
import { ThreadFolders } from './thread-folders.js';

test('root folders auto-assign, persist and copy existing work while preserving account and org isolation', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bees-roots-'))), privateRoot = join(root, 'private'); mkdirSync(privateRoot);
  const client = new ThreadClient(join(privateRoot, 'one')), other = new ThreadClient(join(privateRoot, 'two'));
  const path = join(privateRoot, 'folders.json'), options = { defaultRoot: join(root, 'Bees'), privateRoot };
  let folders = new ThreadFolders(path, options);
  try {
    assert(existsSync(options.defaultRoot)); assert.equal(folders.snapshot(client.store).root, options.defaultRoot);
    const orgId = randomUUID(); client.store.preference('organizations', [{ id: orgId, name: 'Studio', role: 'owner' }]);
    const team = client.store.create('Design', 'local', undefined, undefined, 'team', { organizationId: orgId });
    const thread = client.store.create('Plan', 'local', undefined, team.id), run = { id: randomUUID(), status: 'completed' };
    client.store.mutate(thread.id, randomUUID(), doc => doc.runs.push(run));
    const before = folders.runDirectory(client.store, thread, team, run); writeFileSync(join(before, 'result.txt'), 'Keep this result');
    const global = join(root, 'New root'), override = join(root, 'Org work'); mkdirSync(global); mkdirSync(override);
    folders.set(global, [client, other], client);
    let moved = client.store.preference('runFolder:' + run.id);
    assert(moved.startsWith(global)); assert.equal(readFileSync(join(moved, 'result.txt'), 'utf8'), 'Keep this result'); assert(existsSync(join(before, 'result.txt')));
    assert.equal(client.store.preference('executionFolder:' + run.id), before);
    folders.set(override, [client, other], client, orgId);
    moved = client.store.preference('runFolder:' + run.id); assert(moved.startsWith(override));
    assert(!folders.organization(other.store, orgId).startsWith(override));
    folders = new ThreadFolders(path, options); assert.equal(folders.snapshot(client.store).root, global); assert.equal(folders.organization(client.store, orgId), override);
    folders.set(null, [client, other], client, orgId); assert(folders.organization(client.store, orgId).startsWith(global));
    assert(!JSON.stringify(client.store.document(thread.id)).includes(root), 'Machine paths never enter shared documents');
    client.jobs.set('busy', {}); assert.throws(() => folders.set(global, [client], client), /Stop running/); client.jobs.clear();
    assert.throws(() => folders.set(privateRoot, [client], client), /private application data/);
    assert.throws(() => folders.set(global, [other], other, orgId), /administrator/);
    folders.hosted = true; assert.throws(() => folders.set(global, [client], client), /hosted/);
  } finally { client.jobs.clear(); await client.close(); await other.close(); rmSync(root, { recursive: true, force: true }); }
});

test('root changes reject conflicting files and symlink escapes without losing the old location', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bees-root-conflict-'))), privateRoot = join(root, 'private'); mkdirSync(privateRoot);
  const client = new ThreadClient(join(privateRoot, 'profile')), folders = new ThreadFolders(join(privateRoot, 'folders.json'), { defaultRoot: join(root, 'Bees'), privateRoot });
  try {
    const thread = await client.command({ action: 'create' }), team = client.store.teamFor(thread.id), run = { id: randomUUID(), status: 'completed' };
    client.store.mutate(thread.id, randomUUID(), doc => doc.runs.push(run));
    const before = folders.runDirectory(client.store, thread, team, run); writeFileSync(join(before, 'result.txt'), 'original');
    const target = join(root, 'Target'); mkdirSync(target);
    const next = folders.runPath(client.store, thread, team, run, { root: target, organizations: {} }); mkdirSync(next, { recursive: true }); writeFileSync(join(next, 'result.txt'), 'different');
    assert.throws(() => folders.set(target, [client], client), /different run files/); assert.equal(folders.state.root, join(root, 'Bees'));
    assert.equal(readFileSync(join(before, 'result.txt'), 'utf8'), 'original');
    rmSync(join(target, client.store.clientId), { recursive: true }); symlinkSync(privateRoot, join(target, client.store.clientId), 'dir');
    assert.throws(() => folders.set(target, [client], client), /symbolic links/);
  } finally { await client.close(); rmSync(root, { recursive: true, force: true }); }
});
