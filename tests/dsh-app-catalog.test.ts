import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { NodeDatabase } from './node-database.js';
// @ts-expect-error Plain JS app boundary.
import { AppCatalog } from '../dsh-runtime/plugin/lib/app-catalog.js';

const manifest = { schemaVersion: 1, id: 'catalog-test', version: '0.1.0', name: 'Catalog test', description: 'Synthetic test package',
  author: 'Test', license: 'UNLICENSED', permissions: [], inputs: [], sources: [], task: 'Save a finding', review: 'Verify it' };
const databases: any[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = new NodeDatabase().connection; databases.push(db);
  let bytes: Buffer = Buffer.from(JSON.stringify(manifest));
  const entry = (m: any, body = bytes) => {
    const sha256 = createHash('sha256').update(body).digest('hex');
    const { task, review, inputs, ...metadata } = m;
    return { ...metadata, sha256, path: `packages/${sha256}.json` };
  };
  let listing = { schemaVersion: 1, apps: [entry(manifest)] }; let offline = false;
  const urls: string[] = [];
  const catalog = new AppCatalog(db, 'https://catalog.example/apps/catalog.json', async (url: string, options: any) => {
    urls.push(url); expect(options.redirect).toBe('error'); expect(options.headers.authorization).toBeUndefined();
    if (offline) throw new Error('Offline');
    return new Response(url.endsWith('/catalog.json') ? JSON.stringify(listing) : new Uint8Array(bytes));
  });
  return { catalog, urls, entry, get listing() { return listing; }, set listing(v) { listing = v; },
    set bytes(v: Buffer) { bytes = v; }, set offline(v: boolean) { offline = v; } };
}

it('refresh discovers new apps without a host build; installs only the exact inspected version and digest', async () => {
  const f = fixture(); expect((await f.catalog.list()).apps).toHaveLength(1);
  const first = f.listing.apps[0];
  expect(await f.catalog.resolve(first.id, first.version, first.sha256)).toEqual(manifest);
  expect(f.urls.at(-1)).toBe(`https://catalog.example/apps/${first.path}`);
  f.listing.apps.push(f.entry({ ...manifest, id: 'second-app' }, Buffer.from('new package')));
  expect((await f.catalog.list()).apps).toHaveLength(2);
  f.listing.apps[0] = f.entry({ ...manifest, version: '0.2.0' }, Buffer.from('updated package'));
  await expect(f.catalog.resolve(first.id, first.version, first.sha256)).rejects.toThrow('listing changed');
});

it('fails closed on tampering and mismatched permissions; cached listings are browse-only offline', async () => {
  const f = fixture(); const selected = f.listing.apps[0];
  await f.catalog.list(); f.bytes = Buffer.from('tampered');
  await expect(f.catalog.resolve(selected.id, selected.version, selected.sha256)).rejects.toThrow('checksum');
  f.bytes = Buffer.from(JSON.stringify(manifest));
  f.listing.apps[0] = { ...selected, permissions: ['portfolio-read'] };
  await expect(f.catalog.resolve(selected.id, selected.version, selected.sha256)).rejects.toThrow('does not match');
  f.listing.apps[0] = selected; await f.catalog.list(); f.offline = true;
  expect(await f.catalog.list()).toMatchObject({ stale: true, apps: [selected] });
  await expect(f.catalog.resolve(selected.id, selected.version, selected.sha256)).rejects.toThrow('Reconnect');
});

it('rejects unsafe catalog paths, unsupported formats and missing first-load data', async () => {
  const f = fixture(); f.offline = true;
  expect(await f.catalog.list()).toMatchObject({ stale: true, apps: [], error: expect.stringContaining('unavailable') });
  for (const path of ['https://evil.example/package.json', '../package.json', '/package.json'])
    expect(() => f.catalog.validate({ schemaVersion: 1, apps: [{ ...f.listing.apps[0], path }] })).toThrow();
  expect(() => f.catalog.validate({ schemaVersion: 2, apps: [] })).toThrow();
  expect(() => f.catalog.validate(null)).toThrow();
  expect(() => new AppCatalog(null, 'http://example.com/catalog.json')).toThrow('HTTPS');
});
