import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, realpathSync, lstatSync, readdirSync, copyFileSync, constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { threadError, validId } from './thread-store.js';

const inside = (path, root) => path === root || path.startsWith(root + sep);
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function safeDirectory(anchor, path) {
  if (!inside(path, anchor)) throw threadError('Run folder left its configured root');
  let cursor = anchor;
  for (const part of path.slice(anchor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw threadError('Run folders cannot contain symbolic links');
    mkdirSync(cursor, { recursive: true, mode: 0o700 });
  }
}

// Copy completed work without overwriting a different file or following a link out of it.
function copyWork(source, target) {
  if (source === target || !existsSync(source)) return;
  if (inside(target, source) || inside(source, target)) throw threadError('Choose a folder outside the existing run folder');
  const copy = (from, to) => {
    const stat = lstatSync(from);
    if (stat.isSymbolicLink() || existsSync(to) && lstatSync(to).isSymbolicLink()) throw threadError('Run folders cannot contain symbolic links');
    if (stat.isDirectory()) {
      mkdirSync(to, { recursive: true, mode: 0o700 });
      for (const name of readdirSync(from)) copy(join(from, name), join(to, name));
    } else if (stat.isFile()) {
      if (existsSync(to)) { if (!lstatSync(to).isFile() || hash(from) !== hash(to)) throw threadError('The destination already contains different run files'); }
      else copyFileSync(from, to, constants.COPYFILE_EXCL);
    }
  };
  copy(source, target);
}

export class ThreadFolders {
  constructor(path, { defaultRoot, privateRoot, hosted = false }) {
    this.path = path; this.privateRoot = resolve(privateRoot); this.hosted = hosted;
    this.state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { root: resolve(defaultRoot), organizations: {} };
    if (!existsSync(path)) { mkdirSync(this.state.root, { recursive: true, mode: 0o700 }); this.state.root = realpathSync(this.state.root); this.save(this.state); }
  }
  save(state) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path + '.tmp', JSON.stringify(state), { mode: 0o600 });
    renameSync(this.path + '.tmp', this.path); this.state = state;
  }
  key(store, id) { return store.clientId + ':' + validId(id); }
  closedRoots() { return [this.state.root, ...Object.values(this.state.organizations)]; }
  organization(store, id, state = this.state) {
    return id && state.organizations[this.key(store, id)] || join(state.root, store.clientId, id ? 'org-' + validId(id) : 'Local');
  }
  snapshot(store, organizations = []) {
    return { root: this.state.root, editable: !this.hosted, missing: !existsSync(this.state.root), organizations: organizations.map(org => ({
      id: org.id, folder: this.organization(store, org.id), override: this.state.organizations[this.key(store, org.id)] ?? null,
    })) };
  }
  runPath(store, thread, team, run, state = this.state) {
    return join(this.organization(store, team?.organizationId, state), 'teams', team?.id ?? 'Default', 'threads', thread.id, 'runs', run.id);
  }
  runDirectory(store, thread, team, run) {
    const anchor = team?.organizationId && this.state.organizations[this.key(store, team.organizationId)] || this.state.root;
    if (!existsSync(anchor)) throw threadError('The Bees root folder is unavailable. Reconnect it or change it in Settings.');
    const path = this.runPath(store, thread, team, run);
    safeDirectory(anchor, path);
    if (!inside(realpathSync(path), realpathSync(anchor))) throw threadError('Run folder left its configured root');
    store.preference('runFolder:' + run.id, path); return path;
  }
  set(directory, clients, active, organizationId) {
    if (this.hosted) throw threadError('Root folders are managed by the hosted client', 403);
    if (clients.some(client => client.jobs.size)) throw threadError('Stop running work before changing folders');
    const state = { ...this.state, organizations: { ...this.state.organizations } };
    if (organizationId) {
      const org = active.organizations().find(org => org.id === organizationId);
      if (!org || !['owner', 'admin'].includes(org.role)) throw threadError('Organization administrator required', 403);
    }
    let target;
    if (directory !== null) {
      if (typeof directory !== 'string' || !isAbsolute(directory) || !existsSync(directory) || !lstatSync(directory).isDirectory()) throw threadError('Choose an existing absolute folder on this computer');
      target = realpathSync(directory);
      const privateRoot = realpathSync(this.privateRoot);
      if (inside(target, privateRoot) || inside(privateRoot, target)) throw threadError('Choose a work folder separate from Bees private application data');
    } else if (!organizationId) throw threadError('Choose a root folder');
    if (organizationId) {
      const key = this.key(active.store, organizationId);
      if (target) state.organizations[key] = target; else delete state.organizations[key];
    } else state.root = target;
    const moved = [];
    for (const client of clients) for (const row of client.store.list().filter(row => row.kind !== 'team')) {
      const thread = client.store.document(row.id), team = client.store.teamFor(row.id);
      if (organizationId && (client !== active || team?.organizationId !== organizationId)) continue;
      for (const run of thread.runs) {
        const prior = client.store.preference('runFolder:' + run.id) ?? join(client.store.root, 'runs', thread.id, run.id);
        const next = this.runPath(client.store, thread, team, run, state);
        if (prior !== next && existsSync(prior)) {
          const anchor = team?.organizationId && state.organizations[this.key(client.store, team.organizationId)] || state.root;
          if (!existsSync(anchor)) throw threadError('The destination root folder is unavailable');
          safeDirectory(anchor, next); copyWork(prior, next); moved.push({ store: client.store, id: run.id, path: next, prior });
        }
      }
    }
    this.save(state);
    for (const row of moved) {
      if (!row.store.preference('executionFolder:' + row.id)) row.store.preference('executionFolder:' + row.id, row.prior);
      row.store.preference('runFolder:' + row.id, row.path);
    }
    return this.snapshot(active.store, active.organizations());
  }
}
