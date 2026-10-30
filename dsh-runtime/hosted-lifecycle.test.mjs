import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hostedClientActivity } from './hosted-lifecycle.mjs';

const directoryUrl = 'https://directory.test', idleMs = 5 * 60_000;
const id = name => createHash('sha256').update(directoryUrl + '\n' + name).digest('hex');
const free = { balance: 0, heldTokens: 0, autoRenew: false, paymentPending: false };

function fixture() {
  let clock = 0;
  const clients = new Map(), stopped = [], calls = [];
  const provision = Object.assign(async () => { throw Error('Cleanup must never start a client'); }, {
    running: async () => [...clients].map(([user, state]) => ({ id: state.id ?? id(user).slice(0, 32), url: 'http://' + user, token: 'private-' + user })),
    stop: async user => { stopped.push(user.id); clients.delete(user.id); },
  });
  const activity = hostedClientActivity({ provision, directoryUrl, now: () => clock, fetcher: async (url, options) => {
    const user = new URL(url).hostname, state = clients.get(user);
    assert.equal(options.headers.authorization, 'Bearer private-' + user); calls.push(url);
    if (state.fail) return new Response('{}', { status: 503 });
    if (url.endsWith('/snapshot')) return Response.json({ user: { id: state.user ?? user } });
    if (url.endsWith('/active-runs')) { state.onActivity?.(); return Response.json(state.active ?? 0); }
    assert.deepEqual(JSON.parse(options.body), { action: 'credits' });
    return Response.json({ message: state.message ?? '', credits: state.credits === undefined ? free : state.credits });
  } });
  return { clients, stopped, calls, activity, advance: ms => { clock += ms; } };
}

test('old free workers get a startup grace period, then stop without being provisioned or deleting saved data', async () => {
  const f = fixture(); f.clients.set('alice', {});
  await f.activity.sweep(); assert.equal(f.calls.length, 0);
  f.advance(idleMs - 1); await f.activity.sweep(); assert.equal(f.calls.length, 0);
  f.advance(1); await f.activity.sweep(); assert.deepEqual(f.stopped, ['alice']);
});

test('browser contact keeps accounts alive; busy, paid, unknown and failed credit checks never stop clients', async () => {
  const f = fixture();
  for (const [user, state] of Object.entries({
    alice: {}, purchased: { credits: { ...free, balance: 1 } }, reserved: { credits: { ...free, heldTokens: 1 } },
    renewal: { credits: { ...free, autoRenew: true } }, payment: { credits: { ...free, paymentPending: true } },
    unknown: { credits: null }, unavailable: { fail: true }, stale: { message: 'Could not refresh credits' },
    busy: { active: 1 }, wrongowner: { user: 'alice' }, missingfields: { credits: { balance: 0 } },
  })) f.clients.set(user, state);
  f.advance(idleMs - 1); f.activity.touch({ id: 'alice' }); f.advance(1);
  await f.activity.sweep(); assert.deepEqual(f.stopped, []);
  f.advance(idleMs); await f.activity.sweep(); assert.deepEqual(f.stopped, ['alice']);
  f.clients.get('busy').active = 0; await f.activity.sweep(); assert.deepEqual(f.stopped, ['alice', 'busy']);
});

test('fresh browser contact during an idle check prevents shutdown, including Docker full-length identities', async () => {
  const f = fixture();
  f.clients.set('alice', { id: id('alice'), onActivity: () => f.activity.touch({ id: 'alice' }) });
  f.advance(idleMs); await f.activity.sweep(); assert.deepEqual(f.stopped, []);
});

test('overlapping cleanup passes cannot issue duplicate stops', async () => {
  const f = fixture(); f.clients.set('alice', {}); f.advance(idleMs);
  await Promise.all([f.activity.sweep(), f.activity.sweep()]); assert.deepEqual(f.stopped, ['alice']);
});
