import { createHash } from 'node:crypto';
import { validateApp } from './app-contract.js';

const httpsUrl = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
    throw new Error('App catalog must use credential-free HTTPS');
  return url;
};

export class AppCatalog {
  constructor(database, url = process.env.BEES_APP_CATALOG_URL ?? 'https://bees-bot.github.io/bees-apps/catalog.json', fetcher = fetch) {
    this.db = database; this.url = httpsUrl(url).href; this.fetcher = fetcher;
    database.exec(`CREATE TABLE IF NOT EXISTS app_catalog_cache (url TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at TEXT NOT NULL)`);
  }

  async download(url, limit) {
    const response = await this.fetcher(httpsUrl(url).href, { redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`App directory returned HTTP ${response.status}`);
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length; if (size > limit) throw new Error('App directory response is too large');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks);
  }

  validate(value) {
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.apps) || value.apps.length > 1000) throw new Error('Unsupported app directory format');
    const ids = new Set();
    for (const app of value.apps) {
      if (!app || !/^[a-z][a-z0-9-]{1,63}$/.test(app.id) || ids.has(app.id) || !/^\d+\.\d+\.\d+$/.test(app.version) ||
        !/^[a-f0-9]{64}$/.test(app.sha256) || app.path !== `packages/${app.sha256}.json` ||
        !Array.isArray(app.sources) || app.sources.length > 12 ||
        app.sources.some((s) => !s || typeof s.label !== 'string' || typeof s.url !== 'string') ||
        !Array.isArray(app.permissions) || app.permissions.some((p) => !['public-sources', 'draft-actions', 'portfolio-read'].includes(p)))
        throw new Error('Invalid app directory entry');
      for (const key of ['name', 'description', 'author', 'license'])
        if (typeof app[key] !== 'string' || !app[key].trim() || app[key].length > 4000) throw new Error('Invalid app directory metadata');
      ids.add(app.id);
    }
    return value;
  }

  async list() {
    try {
      const catalog = this.validate(JSON.parse((await this.download(this.url, 2_000_000)).toString('utf8')));
      const fetchedAt = new Date().toISOString();
      this.db.prepare('INSERT INTO app_catalog_cache VALUES (?,?,?) ON CONFLICT(url) DO UPDATE SET body=excluded.body,fetched_at=excluded.fetched_at')
        .run(this.url, JSON.stringify(catalog), fetchedAt);
      return { ...catalog, fetchedAt, stale: false };
    } catch (error) {
      const cached = this.db.prepare('SELECT * FROM app_catalog_cache WHERE url=?').get(this.url);
      if (!cached) return { apps: [], stale: true, error: `App directory unavailable. ${error.message}` };
      return { ...this.validate(JSON.parse(cached.body)), fetchedAt: cached.fetched_at, stale: true, error: 'Showing the last downloaded directory. Reconnect to install.' };
    }
  }

  async resolve(id, version, checksum) {
    const catalog = await this.list();
    if (catalog.stale) throw new Error('Reconnect to the app directory before installing');
    const entry = catalog.apps.find((app) => app.id === id && app.version === version && app.sha256 === checksum);
    if (!entry) throw new Error('This app listing changed. Refresh the directory before installing.');
    if (![1, 2].includes(entry.schemaVersion)) throw new Error('This app needs a newer Bees runtime');
    const bytes = await this.download(new URL(entry.path, this.url).href, 64_000);
    if (createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error('App package checksum did not match the directory');
    const manifest = validateApp(JSON.parse(bytes.toString('utf8')));
    for (const key of ['schemaVersion', 'id', 'version', 'name', 'description', 'author', 'license', 'permissions', 'sources', ...(entry.recordTypes !== undefined ? ['recordTypes'] : [])])
      if (JSON.stringify(manifest[key]) !== JSON.stringify(entry[key])) throw new Error('App package does not match its listing');
    return manifest;
  }
}
