import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { canonical, threadError, validId } from './thread-store.js';
import { SHARED_FOLDER_MARKER } from './shared-folder-files.js';

const purposes = ['input', 'output'];
const inside = (path, root) => path === root || path.startsWith(root + sep);
function readControl(path) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.size > 4096) throw threadError('Invalid shared folder marker or probe');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 4096) throw threadError('Invalid shared folder marker or probe');
    const bytes = Buffer.alloc(4097), length = readSync(fd, bytes, 0, bytes.length, 0);
    if (length > 4096) throw threadError('Invalid shared folder marker or probe');
    return JSON.parse(bytes.subarray(0, length).toString('utf8'));
  } finally { closeSync(fd); }
}
function writeControl(path, value) {
  try { writeFileSync(path, canonical(value), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST' || canonical(readControl(path)) !== canonical(value)) throw error; }
}

export class ThreadSharedFolders {
  constructor(client, folders) { this.client = client; this.store = client.store; this.folders = folders; }
  key(id, purpose) {
    validId(id); if (!purposes.includes(purpose)) throw threadError('Choose an input or output folder');
    return `sharedFolder:${id}:${purpose}`;
  }
  identity(doc, purpose) {
    this.key(doc.id, purpose);
    const team = doc.kind === 'team' ? doc : this.store.teamFor(doc.id);
    if (!doc.sharedFolders?.[purpose]) throw threadError('This client has not set up shared folders yet');
    return { version: 1, orgId: doc.organizationId ?? team?.organizationId ?? null, teamId: team?.id ?? null,
      threadId: doc.kind === 'team' ? null : doc.id, folderId: validId(doc.sharedFolders[purpose]), purpose };
  }
  defaultDirectory(doc, purpose) {
    const team = doc.kind === 'team' ? doc : this.store.teamFor(doc.id);
    const root = this.folders.organization(this.store, doc.organizationId ?? team?.organizationId);
    return join(root, 'teams', team?.id ?? 'Default', ...(doc.kind === 'team' ? [] : ['threads', doc.id]), 'shared', purpose);
  }
  directory(path) {
    if (typeof path !== 'string' || !isAbsolute(path) || !lstatSync(path, { throwIfNoEntry: false })?.isDirectory()) throw Object.assign(threadError('Choose an existing absolute folder on this computer'), { code: 'ENOENT' });
    const actual = realpathSync(path), privateRoot = realpathSync(this.folders.privateRoot);
    if (inside(actual, privateRoot) || inside(privateRoot, actual)) throw threadError('Choose a shared folder separate from Bees private application data');
    return actual;
  }
  verify(doc, purpose, directory) {
    const path = this.directory(directory), file = join(path, SHARED_FOLDER_MARKER);
    // a teammate often picks the folder before their file service has synced the marker
    if (!lstatSync(file, { throwIfNoEntry: false })) throw Object.assign(threadError('This folder has no Bees marker yet. Wait for it to finish syncing, or use Set up folder on the computer that owns it.'), { code: 'ENOENT' });
    const marker = readControl(file);
    if (canonical(marker) !== canonical(this.identity(doc, purpose))) throw threadError('This folder belongs to a different team, thread, or input/output folder');
    return path;
  }
  initialize(doc) {
    if (this.folders.hosted || doc.ownerClientId !== this.store.clientId || doc.staged || this.store.preference(`frozen:${doc.id}`)) return doc;
    if (!doc.sharedFolders) doc = this.store.mutate(doc.id, randomUUID(), value => { value.sharedFolders = { input: randomUUID(), output: randomUUID() }; });
    for (const purpose of purposes) {
      const key = this.key(doc.id, purpose);
      const directory = this.defaultDirectory(doc, purpose);
      const mapping = this.store.preference(key);
      if (mapping && (!mapping.automatic || mapping.directory === directory)) continue;
      // Remember setup before touching the disk, so startup never recreates a missing marker or mount.
      this.store.preference(key, { directory, automatic: true });
      try {
        const team = doc.kind === 'team' ? doc : this.store.teamFor(doc.id);
        const organizationId = doc.organizationId ?? team?.organizationId;
        const anchor = organizationId && this.folders.state.organizations[this.folders.key(this.store, organizationId)] || this.folders.state.root;
        if (!lstatSync(anchor).isDirectory()) throw threadError('The Bees root folder is unavailable');
        let cursor = anchor;
        for (const part of directory.slice(anchor.length).split(sep).filter(Boolean)) {
          cursor = join(cursor, part);
          try { if (lstatSync(cursor).isSymbolicLink()) throw threadError('Shared folders cannot contain symbolic links'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          mkdirSync(cursor, { recursive: true, mode: 0o700 });
        }
        writeControl(join(this.directory(directory), SHARED_FOLDER_MARKER), this.identity(doc, purpose));
      } catch { /* Folder status reports unavailable storage without preventing Bees from opening. */ }
    }
    return doc;
  }
  view(doc) {
    if (this.folders.hosted) return { editable: false, folders: [] };
    return { editable: true, canInitialize: doc.ownerClientId === this.store.clientId && !doc.staged && !this.store.preference(`frozen:${doc.id}`), folders: purposes.map(purpose => {
      const mapping = this.store.preference(this.key(doc.id, purpose)), directory = mapping?.directory ?? null;
      let status = directory ? 'recognized' : 'unmapped';
      if (directory) try { this.verify(doc, purpose, directory); }
      catch (error) { status = error.code === 'ENOENT' ? 'missing' : 'mismatch'; }
      return { purpose, directory, status };
    }) };
  }
  set(doc, purpose, directory, initialize = false) {
    if (this.folders.hosted) throw threadError('Choose shared folders in Bees Desktop', 403);
    const key = this.key(doc.id, purpose);
    if (directory === null) { this.store.preference(key, { directory: null }); return this.view(doc); }
    const path = this.directory(directory);
    if (initialize) {
      this.store.writable(doc);
      writeControl(join(path, SHARED_FOLDER_MARKER), this.identity(doc, purpose));
    }
    this.verify(doc, purpose, path);
    this.store.preference(key, { directory: path, automatic: false });
    return this.view(doc);
  }
  mapped(doc, purpose) {
    const directory = this.store.preference(this.key(doc.id, purpose))?.directory;
    if (!directory) throw threadError('Locate this shared folder on this computer first');
    return this.verify(doc, purpose, directory);
  }
  acknowledge(doc, purpose, probeId, sourceClientId) {
    validId(probeId); validId(sourceClientId);
    const directory = this.mapped(doc, purpose), path = join(directory, `.bees-probe-${sourceClientId}-${probeId}`);
    let probe;
    try { probe = readControl(path); } catch (error) { if (error.code === 'ENOENT') return { observed: false }; throw error; }
    if (probe.id !== probeId || probe.sourceClientId !== sourceClientId || probe.targetClientId !== this.store.clientId || probe.folderId !== this.identity(doc, purpose).folderId) throw threadError('Invalid shared folder probe');
    validId(probe.token);
    writeControl(join(directory, `.bees-ack-${sourceClientId}-${probeId}`), probe);
    return { observed: true };
  }
  cleanup(doc, purpose, probeId, sourceClientId) {
    validId(probeId); validId(sourceClientId);
    const directory = this.mapped(doc, purpose);
    for (const kind of ['probe', 'ack']) try { unlinkSync(join(directory, `.bees-${kind}-${sourceClientId}-${probeId}`)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { cleaned: true };
  }
  async probe(doc, purpose, targetClientId, timeout = 15000) {
    validId(targetClientId);
    if (!doc.shared || targetClientId === this.store.clientId) throw threadError('Choose another client with access to this shared team or thread');
    const directory = this.mapped(doc, purpose), id = randomUUID(), sourceClientId = this.store.clientId;
    const probe = { id, sourceClientId, targetClientId, folderId: this.identity(doc, purpose).folderId, token: randomUUID() };
    const challenge = join(directory, `.bees-probe-${sourceClientId}-${id}`), acknowledgment = join(directory, `.bees-ack-${sourceClientId}-${id}`);
    writeControl(challenge, probe);
    try {
      const end = Date.now() + timeout; let observed = false;
      do {
        this.client.directory.stop.signal.throwIfAborted();
        this.verify(doc, purpose, directory);
        if (!observed) {
          // The token travels only through the external folder, never through Bees peer transport.
          // an offline client never answers, so stop at this check's deadline instead of the transport's minute
          const result = await Promise.race([this.client.peer.send(doc.id, targetClientId, { kind: 'shared-folder-probe', purpose, probeId: id }), delay(end - Date.now())])
            .catch(error => { if (error.status !== 408) throw error; });
          observed = result?.observed === true;
        }
        try { if (canonical(readControl(acknowledgment)) === canonical(probe)) return { status: 'confirmed', targetClientId, checkedAt: new Date().toISOString() }; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await delay(500, undefined, { signal: this.client.directory.stop.signal });
      } while (Date.now() < end);
      return { status: 'unconfirmed', targetClientId };
    } finally {
      let cleanupFailed = false;
      // shortcut: unreachable peers may retain probes; add expired-file cleanup when background synchronization is introduced.
      void this.client.peer.send(doc.id, targetClientId, { kind: 'shared-folder-probe', purpose, probeId: id, cleanup: true }).catch(() => {});
      for (const path of [challenge, acknowledgment]) try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') cleanupFailed = true; }
      if (cleanupFailed) throw threadError('Some temporary synchronization check files could not be removed. Check the shared folder permissions.');
    }
  }
}
