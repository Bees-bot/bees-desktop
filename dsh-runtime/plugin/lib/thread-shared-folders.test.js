import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ThreadClient } from './thread-client.js';
import { ThreadFolders } from './thread-folders.js';
import { SHARED_FOLDER_MARKER, sharedControlFile } from './shared-folder-files.js';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bees-shared-'))), privateRoot = join(root, 'private');
  mkdirSync(privateRoot);
  const folders = new ThreadFolders(join(privateRoot, 'folders.json'), { defaultRoot: join(root, 'work'), privateRoot });
  const clients = ['alice', 'bob'].map(name => new ThreadClient(join(privateRoot, name), { folders }));
  return { root, privateRoot, folders, clients, close() { for (const client of clients) client.store.close(); rmSync(root, { recursive: true, force: true }); } };
}
const location = (client, doc, purpose = 'input') => client.sharedFolders.view(doc).folders.find(row => row.purpose === purpose);
const marker = directory => JSON.parse(readFileSync(join(directory, SHARED_FOLDER_MARKER), 'utf8'));

test('new teams and threads get separate folder identities, scoped to their organization, without sharing machine paths', async () => {
  const f = fixture(), [client] = f.clients;
  try {
    const organization = await client.command({ action: 'createLocalOrganization', name: 'Studio' });
    const team = client.store.get(client.ensureOrganizationTeam(organization));
    const thread = await client.command({ action: 'create', teamId: team.id });
    const ids = new Set();
    for (const doc of [team, thread]) for (const purpose of ['input', 'output']) {
      const row = location(client, doc, purpose), identity = marker(row.directory);
      assert.equal(row.status, 'recognized');
      assert.equal(identity.orgId, organization.id); assert.equal(identity.teamId, team.id);
      assert.equal(identity.threadId, doc === team ? null : thread.id); assert.equal(identity.purpose, purpose);
      ids.add(identity.folderId);
      assert(!JSON.stringify(client.store.document(doc.id)).includes(f.root));
    }
    assert.equal(ids.size, 4);
    const made = await client.command({ action: 'createTeam', name: 'Another' });
    assert.equal(location(client, made).status, 'recognized');
    client.store.mutate(made.id, randomUUID(), value => { value.shared = true; });
    client.refresh = async () => { throw Error('Server offline'); };
    const offline = await client.command({ action: 'sharedFolders', threadId: made.id });
    assert(offline.folders.every(row => row.status === 'recognized'), 'Local recognition works while Bees Server is offline');
  } finally { f.close(); }
});

test('mapping validates folder identity, keeps prior markers, persists locally, and never recreates a missing marker on restart', async () => {
  const f = fixture(); let [client] = f.clients;
  try {
    const doc = client.store.get(client.store.preference('defaultTeam')), old = location(client, doc).directory;
    const target = join(f.root, 'Google Drive'), wrong = join(f.root, 'Other'); mkdirSync(target); mkdirSync(wrong);
    await assert.rejects(client.command({ action: 'setSharedFolder', threadId: doc.id, purpose: 'input', directory: target }), /ENOENT/);
    assert.equal(location(client, doc).directory, old);
    await client.command({ action: 'setSharedFolder', threadId: doc.id, purpose: 'input', directory: target, initialize: true });
    assert(existsSync(join(old, SHARED_FOLDER_MARKER)));
    copyFileSync(join(target, SHARED_FOLDER_MARKER), join(wrong, SHARED_FOLDER_MARKER));
    await assert.rejects(client.command({ action: 'setSharedFolder', threadId: doc.id, purpose: 'output', directory: wrong }), /different team/);
    await client.command({ action: 'setSharedFolder', threadId: doc.id, purpose: 'input', directory: wrong });
    assert(existsSync(join(target, SHARED_FOLDER_MARKER)));
    client.store.close(); client = f.clients[0] = new ThreadClient(join(f.privateRoot, 'alice'), { folders: f.folders });
    assert.equal(location(client, doc).directory, wrong);
    rmSync(join(wrong, SHARED_FOLDER_MARKER));
    client.store.close(); client = f.clients[0] = new ThreadClient(join(f.privateRoot, 'alice'), { folders: f.folders });
    assert.equal(location(client, doc).status, 'missing'); assert(!existsSync(join(wrong, SHARED_FOLDER_MARKER)));
    const output = location(client, doc, 'output').directory; rmSync(output, { recursive: true });
    client.store.close(); client = f.clients[0] = new ThreadClient(join(f.privateRoot, 'alice'), { folders: f.folders });
    assert(!existsSync(output), 'An unavailable mapped folder must not be recreated on startup');
    await client.command({ action: 'setSharedFolder', threadId: doc.id, purpose: 'input', directory: null });
    client.store.close(); client = f.clients[0] = new ThreadClient(join(f.privateRoot, 'alice'), { folders: f.folders });
    assert.equal(location(client, doc).status, 'unmapped');
  } finally { f.close(); }
});

test('root changes update automatic locations, preserve old markers and keep explicit mappings', async () => {
  const f = fixture(), [client] = f.clients;
  try {
    const doc = client.store.get(client.store.preference('defaultTeam')), before = location(client, doc).directory;
    const custom = join(f.root, 'SharePoint'), next = join(f.root, 'New root'); mkdirSync(custom); mkdirSync(next);
    client.sharedFolders.set(doc, 'output', custom, true);
    f.folders.set(next, f.clients, client);
    assert(location(client, doc).directory.startsWith(next)); assert(existsSync(join(before, SHARED_FOLDER_MARKER)));
    assert.equal(location(client, doc, 'output').directory, custom);
  } finally { f.close(); }
});

test('scheduled threads initialize their own folder markers', async () => {
  const f = fixture(), [client] = f.clients;
  try {
    client.options.execute = async () => 'Done';
    const id = client.store.preference('defaultTeam');
    await client.command({ action: 'configure', threadId: id, operationId: randomUUID(), schedule: { frequency: 'daily', hour: 9, timezone: 'UTC', prompt: 'Daily summary' } });
    client.store.mutate(id, randomUUID(), doc => { doc.schedule.nextAt = new Date(Date.now() - 1000).toISOString(); });
    await client.scheduled(); await Promise.all([...client.finishing]);
    const thread = client.store.get(client.store.preference(`scheduled-thread:${id}`));
    assert.equal(location(client, thread).status, 'recognized');
    assert.equal(marker(location(client, thread).directory).threadId, thread.id);
  } finally { f.close(); }
});

function pair(f) {
  const [a, b] = f.clients, original = a.store.get(a.store.preference('defaultTeam'));
  const doc = a.store.mutate(original.id, randomUUID(), value => { value.shared = true; });
  b.store.save(doc);
  const first = location(a, doc).directory, second = join(f.root, 'Bobs OneDrive'); mkdirSync(second);
  copyFileSync(join(first, SHARED_FOLDER_MARKER), join(second, SHARED_FOLDER_MARKER));
  b.sharedFolders.set(doc, 'input', second);
  const grant = { thread_id: doc.id, epoch: doc.epoch, source_client_id: a.store.clientId };
  return { a, b, doc, first, second, grant };
}

test('different local paths recognize the same folder and confirm external synchronization in both directions', async () => {
  const f = fixture();
  try {
    const { a, b, doc, first, second, grant } = pair(f);
    assert.notEqual(first, second); assert.equal(location(b, doc).status, 'recognized');
    a.peer = { send: async (id, target, input) => {
      assert.equal(id, doc.id); assert.equal(target, b.store.clientId);
      if (input.cleanup) return b.receive(grant, input);
      assert.deepEqual(Object.keys(input).sort(), ['kind', 'probeId', 'purpose']);
      const challenge = readdirSync(first).find(name => name.startsWith('.bees-probe-'));
      copyFileSync(join(first, challenge), join(second, challenge));
      const answer = await b.receive(grant, input);
      assert.deepEqual(answer, { observed: true });
      const ack = readdirSync(second).find(name => name.startsWith('.bees-ack-'));
      copyFileSync(join(second, ack), join(first, ack));
      return answer;
    } };
    const result = await a.sharedFolders.probe(doc, 'input', b.store.clientId);
    assert.equal(result.status, 'confirmed'); assert.equal(result.targetClientId, b.store.clientId);
    assert.deepEqual(readdirSync(first), [SHARED_FOLDER_MARKER]);
    assert.deepEqual(readdirSync(second), [SHARED_FOLDER_MARKER]);
  } finally { f.close(); }
});

test('copied markers, one-way synchronization and stale acknowledgments cannot confirm synchronization', async () => {
  const f = fixture();
  try {
    const { a, b, doc, first, second, grant } = pair(f);
    a.peer = { send: async (_id, _target, input) => b.receive(grant, input) };
    assert.equal((await a.sharedFolders.probe(doc, 'input', b.store.clientId, 1)).status, 'unconfirmed');
    a.peer.send = async (_id, _target, input) => {
      if (input.cleanup) return b.receive(grant, input);
      const challenge = readdirSync(first).find(name => name.startsWith('.bees-probe-'));
      copyFileSync(join(first, challenge), join(second, challenge));
      return b.receive(grant, input);
    };
    assert.equal((await a.sharedFolders.probe(doc, 'input', b.store.clientId, 1)).status, 'unconfirmed', 'An acknowledgment must reach the source through external synchronization');
    a.peer.send = async (_id, _target, input) => {
      if (input.cleanup) return b.receive(grant, input);
      const ack = `.bees-ack-${a.store.clientId}-${input.probeId}`;
      writeFileSync(join(first, ack), JSON.stringify({ token: randomUUID() }));
      return { observed: true };
    };
    assert.equal((await a.sharedFolders.probe(doc, 'input', b.store.clientId, 1)).status, 'unconfirmed');
    assert.deepEqual(readdirSync(first), [SHARED_FOLDER_MARKER]);
  } finally { f.close(); }
});

test('shared folder setup and probes reject private storage, links, wrong identity, stale grants and non-owners', async () => {
  const f = fixture();
  try {
    const { a, b, doc, first, second, grant } = pair(f);
    assert.throws(() => b.sharedFolders.set(doc, 'input', second, true), /owning client/);
    assert.throws(() => a.sharedFolders.set(doc, 'input', f.privateRoot, true), /private application data/);
    assert.throws(() => a.sharedFolders.set(doc, '../output', first), /input or output/);
    const escaped = join(f.root, 'Link'); mkdirSync(escaped); symlinkSync(join(first, SHARED_FOLDER_MARKER), join(escaped, SHARED_FOLDER_MARKER));
    assert.throws(() => a.sharedFolders.set(doc, 'input', escaped), /Invalid shared/);
    const oversized = join(f.root, 'Oversized'); mkdirSync(oversized); writeFileSync(join(oversized, SHARED_FOLDER_MARKER), 'x'.repeat(4097));
    assert.throws(() => a.sharedFolders.set(doc, 'input', oversized), /Invalid shared/);
    await assert.rejects(b.receive({ ...grant, epoch: grant.epoch + 1 }, { kind: 'shared-folder-probe', purpose: 'input', probeId: randomUUID() }), /access changed/);
    await assert.rejects(b.receive(grant, { kind: 'shared-folder-probe', purpose: 'input', probeId: '../escape' }), /Invalid identity/);
    a.peer = { send: async () => { throw Error('Other client unavailable'); } };
    await assert.rejects(a.sharedFolders.probe(doc, 'input', b.store.clientId), /unavailable/);
    assert.deepEqual(readdirSync(first), [SHARED_FOLDER_MARKER]);
    f.folders.hosted = true;
    assert.deepEqual(a.sharedFolders.view(doc), { editable: false, folders: [] });
    assert.throws(() => a.sharedFolders.set(doc, 'input', first), /Desktop/);
  } finally { f.close(); }
});

test('folder metadata validates identities and control files never become attachments', async () => {
  const f = fixture(), [client] = f.clients;
  try {
    const doc = client.store.get(client.store.preference('defaultTeam'));
    for (const sharedFolders of [{ input: randomUUID() }, { input: '../escape', output: randomUUID() }, { ...doc.sharedFolders, path: f.root }, { input: doc.sharedFolders.input, output: doc.sharedFolders.input }]) {
      assert.throws(() => client.store.validate({ ...doc, sharedFolders }));
    }
    for (const name of [SHARED_FOLDER_MARKER, '.bees-probe-anything', '.bees-ack-anything', '.BEES-SHARED.JSON']) {
      assert(sharedControlFile(name));
      assert.throws(() => client.store.attach(doc.id, randomUUID(), name, Buffer.from('secret'), 'local'), /not attachments/);
      assert.throws(() => client.store.attach(doc.id, randomUUID(), 'secret.txt', Buffer.from('secret'), 'local', name + '/secret.txt'), /not attachments/);
    }
    const content = Buffer.from('Previously uploaded file'), digest = client.store.putObject(content), id = randomUUID();
    client.store.save({ ...doc, artifacts: [{ id, name: SHARED_FOLDER_MARKER, path: 'old/' + SHARED_FOLDER_MARKER, digest, size: content.length, authorId: 'local' }] });
    client.store.message(doc.id, randomUUID(), 'Old attachments remain readable', 'local');
    assert.deepEqual(client.store.object(client.store.get(doc.id), id).bytes, content);
  } finally { f.close(); }
});
