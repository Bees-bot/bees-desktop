import { expect, it, vi } from 'vitest';
// @ts-expect-error Plain JS host action boundary.
import { actionDigest, reviewAction, decideAction, claimAction, settleAction, reconcileAction, AppActionDispatcher } from '../dsh-runtime/plugin/lib/app-actions.js';

const at = '2026-09-09T12:00:00.000Z';
const payload = { destination: 'https://example.com/thread', account: 'test-account', connectorId: 'test-channel',
  content: 'Exact synthetic test content', rationale: 'No live action', costCents: 0 };
const context = { at, actorUserId: 'owner', approverUserId: 'owner', suppressed: false, capCents: 0, reservedCents: 0,
  connectorId: 'test-channel', account: 'test-account' };
function draft() {
  return { id: 'test-action', payload, digest: actionDigest(payload), cost_cents: 0, status: 'draft', execution: {}, reviewed_digest: null };
}
function approved() {
  const row: any = draft(); Object.assign(row, reviewAction(row, { digest: row.digest, decision: 'pass' }));
  return Object.assign(row, decideAction(row, { ...context, digest: row.digest, decision: 'approve' }));
}
function running() {
  const row = approved(); return Object.assign(row, claimAction(row, { ...context, digest: row.digest, attemptId: 'attempt' }));
}

it('requires exact independent review and the designated human; rejects tampering', () => {
  const row: any = draft(); const decide = (extra = {}) => decideAction(row, { ...context, digest: row.digest, decision: 'approve', ...extra });
  expect(() => decide()).toThrow('Independent review');
  Object.assign(row, reviewAction(row, { digest: row.digest, decision: 'pass' }));
  expect(() => decide({ actorUserId: 'worker' })).toThrow('designated approver');
  expect(() => decide({ approverUserId: null })).toThrow('designated approver');
  expect(() => decide({ suppressed: true })).toThrow('suppressed');
  expect(() => decideAction({ ...row, payload: { ...payload, content: 'Changed' } }, { ...context, digest: row.digest })).toThrow('changed');
  Object.assign(row, reviewAction(row, { digest: row.digest, decision: 'revise' }));
  expect(() => decide()).toThrow('Independent review');
});

it('binds execution to the approved channel/account, expiry, cap and one attempt', () => {
  const row = approved(); const claim = (extra = {}) => claimAction(row, { ...context, digest: row.digest, ...extra });
  expect(() => claim({ connectorId: 'other' })).toThrow('exact approved');
  expect(() => claim({ account: 'other' })).toThrow('exact approved');
  expect(() => claim({ at: row.expires_at })).toThrow('expired');
  expect(() => claim({ reservedCents: 1 })).toThrow('cap');
  expect(() => claim({ suppressed: true })).toThrow('suppressed');
  Object.assign(row, claim());
  expect(() => claim()).toThrow('unattempted');
  expect(() => settleAction(row, { attemptId: 'wrong', at, result: { outcome: 'accepted', receipt: { id: 'receipt' } } })).toThrow('this attempt');
});

it('distinguishes accepted receipts from delivery and records unknown evidence without retry', () => {
  const row = running();
  expect(() => settleAction(row, { attemptId: 'attempt', at, result: { outcome: 'accepted' } })).toThrow('receipt');
  const accepted = settleAction(row, { attemptId: 'attempt', at, result: { outcome: 'accepted', receipt: { id: 'provider-id' } } });
  expect(accepted).toMatchObject({ status: 'succeeded', execution: { outcome: 'accepted', receipt: { id: 'provider-id' } } });
  const uncertain = { ...row, ...settleAction(row, { attemptId: 'attempt', at, result: { outcome: 'unknown' } }) };
  const reconciled = { ...uncertain, ...reconcileAction(uncertain, { ...context, attemptId: 'attempt', evidence: 'Provider history checked; not conclusive.' }) };
  expect(reconciled.status).toBe('unknown');
  expect(() => claimAction(reconciled, { ...context, digest: row.digest })).toThrow('unattempted');
});

function dispatcher(send: any, overrides: any = {}) {
  let row = approved(); const events: string[] = [];
  const claim = vi.fn(async (input: any) => { events.push('claim'); row = { ...row, ...claimAction(row, { ...context, ...input }) }; return row; });
  const settle = vi.fn(async (input: any) => { events.push('settle'); row = { ...row, ...settleAction(row, input) }; return row; });
  const runtime = new AppActionDispatcher({ load: async () => row, claim, settle, now: () => at,
    connector: { id: 'test-channel', account: 'test-account', send: async (...args: any[]) => { events.push('send'); return send(...args); } }, ...overrides });
  return { runtime, claim, settle, events, input: { actionId: row.id, digest: row.digest, actorUserId: 'owner' } };
}

it('commits the claim before calling the adapter, then persists the receipt', async () => {
  const send = vi.fn(async (_payload: unknown) => ({ outcome: 'accepted', receipt: { id: 'synthetic-only' } }));
  const s = dispatcher(send); const result = await s.runtime.dispatch(s.input);
  expect(s.events).toEqual(['claim', 'send', 'settle']); expect(result.status).toBe('succeeded');
  expect(send.mock.calls[0]?.[0]).toEqual(payload);
  await expect(s.runtime.dispatch(s.input)).rejects.toThrow('unattempted'); expect(send).toHaveBeenCalledTimes(1);
});

it('never calls a provider when disconnected, mismatched or a shared claim fails', async () => {
  const send = vi.fn();
  const disconnected = dispatcher(send, { connector: null });
  await expect(disconnected.runtime.dispatch(disconnected.input)).rejects.toThrow('No approved-action connector');
  const rejected = dispatcher(send, { claim: async () => { throw new Error('CAS conflict'); } });
  await expect(rejected.runtime.dispatch(rejected.input)).rejects.toThrow('CAS conflict'); expect(send).not.toHaveBeenCalled();
});

it('treats timeout after possible acceptance and all thrown provider errors as unknown', async () => {
  const send = vi.fn(() => new Promise(() => {})); const s = dispatcher(send, { timeoutMs: 5 });
  expect((await s.runtime.dispatch(s.input)).status).toBe('unknown');
  await expect(s.runtime.dispatch(s.input)).rejects.toThrow('unattempted'); expect(send).toHaveBeenCalledTimes(1);
  const thrown = dispatcher(async () => { throw new Error('secret token must not enter history'); });
  const result = await thrown.runtime.dispatch(thrown.input);
  expect(result.status).toBe('unknown'); expect(JSON.stringify(result)).not.toContain('secret token');
});

it('retains an executing claim if receipt persistence fails; never retries the send', async () => {
  const send = vi.fn(async () => ({ outcome: 'accepted', receipt: { id: 'accepted' } }));
  const s = dispatcher(send, { settle: async () => { throw new Error('Offline after acceptance'); } });
  await expect(s.runtime.dispatch(s.input)).rejects.toThrow('Offline after acceptance');
  await expect(s.runtime.dispatch(s.input)).rejects.toThrow('unattempted'); expect(send).toHaveBeenCalledTimes(1);
});
