import { createHash, randomUUID } from 'node:crypto';

const object = (value) => typeof value === 'string' ? JSON.parse(value) : value;
const timestamp = (value) => {
  const date = new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid action timestamp');
  return date.toISOString();
};
const cents = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid commitment amount');
  return value;
};
const text = (value, name, limit = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`Invalid ${name}`);
  return value;
};
export const actionDigest = (payload) => createHash('sha256').update(JSON.stringify(object(payload))).digest('hex');
export const ACTION_RESERVED_STATUSES = ['approved', 'executing', 'succeeded', 'unknown'];

function unchanged(row, digest) {
  if (!row || row.digest !== digest || actionDigest(row.payload) !== digest)
    throw new Error('This draft changed; refresh before reviewing');
  const payload = object(row.payload);
  if (cents(row.cost_cents) !== cents(payload.costCents)) throw new Error('Action commitment changed');
  return payload;
}

function approver(input) {
  if (!input.approverUserId || input.actorUserId !== input.approverUserId)
    throw new Error('Only the designated approver can decide or execute external actions');
}

/** Called only by the host's independent-reviewer tool, scoped to this app and item. */
export function reviewAction(row, { digest, decision }) {
  unchanged(row, digest);
  if (row.status !== 'draft') throw new Error('Only pending drafts can be reviewed');
  if (!['pass', 'revise'].includes(decision)) throw new Error('Choose pass or revise');
  return { reviewed_digest: decision === 'pass' ? digest : null };
}

/** Pure checks are shared with the host boundary; database changes must be atomic. */
export function decideAction(row, input) {
  unchanged(row, input.digest);
  if (row.status !== 'draft') throw new Error('This draft was already decided');
  approver(input);
  if (!['approve', 'reject'].includes(input.decision)) throw new Error('Choose approve or reject');
  if (input.decision === 'approve') {
    if (row.reviewed_digest !== row.digest) throw new Error('Independent review is required for this exact draft');
    if (input.suppressed) throw new Error('Destination is suppressed');
    if (cents(input.reservedCents) + row.cost_cents > cents(input.capCents))
      throw new Error('Portfolio commitment cap would be exceeded');
  }
  const at = timestamp(input.at);
  return { status: input.decision === 'approve' ? 'approved' : 'rejected', decided_by: input.actorUserId,
    decided_at: at, expires_at: new Date(Date.parse(at) + 48 * 3600_000).toISOString() };
}

/** Persist this claim before invoking any adapter. Never reclaim an uncertain attempt. */
export function claimAction(row, input) {
  const payload = unchanged(row, input.digest);
  approver(input);
  if (row.status !== 'approved' || Object.keys(object(row.execution) ?? {}).length)
    throw new Error('Only an approved, unattempted action can execute');
  if (row.decided_by !== input.actorUserId || row.reviewed_digest !== row.digest)
    throw new Error('The exact action requires its designated approver and independent review');
  const at = timestamp(input.at);
  if (!row.expires_at || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.parse(at))
    throw new Error('Action approval expired');
  if (input.suppressed) throw new Error('Destination is suppressed');
  if (cents(input.reservedCents) < row.cost_cents || input.reservedCents > cents(input.capCents))
    throw new Error('Portfolio commitment cap would be exceeded');
  if (!payload.connectorId || payload.connectorId !== input.connectorId || payload.account !== input.account)
    throw new Error('No connector is configured for the exact approved account and channel');
  return { status: 'executing', execution: {
    attemptId: input.attemptId ?? randomUUID(), connectorId: text(input.connectorId, 'connector'),
    account: text(input.account, 'account'), claimedBy: input.actorUserId, claimedAt: at,
    idempotencyKey: `bees-app-action:${text(row.id, 'action ID')}`
  } };
}

/** Adapter acceptance is a provider receipt, not proof of recipient delivery. */
export function settleAction(row, { attemptId, at, result }) {
  const execution = object(row.execution);
  if (row.status !== 'executing' || !execution?.attemptId || execution.attemptId !== attemptId)
    throw new Error('Action is not executing this attempt');
  if (!result || !['accepted', 'not_accepted', 'unknown'].includes(result.outcome))
    throw new Error('Invalid action outcome');
  let receipt;
  if (result.outcome === 'accepted') {
    receipt = { id: text(result.receipt?.id, 'provider receipt', 1000) };
    if (result.receipt.url !== undefined) {
      const url = new URL(text(result.receipt.url, 'receipt URL', 2000));
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid receipt URL');
      receipt.url = url.toString();
    }
  }
  const finishedAt = timestamp(at);
  if (Date.parse(finishedAt) < Date.parse(execution.claimedAt)) throw new Error('Outcome precedes its claim');
  return { status: { accepted: 'succeeded', not_accepted: 'failed', unknown: 'unknown' }[result.outcome],
    execution: { ...execution, finishedAt, outcome: result.outcome, ...(receipt ? { receipt } : {}),
      ...(result.reason ? { reason: text(result.reason, 'outcome reason', 2000) } : {}) } };
}

/** An operator can attach evidence to an unknown attempt; this never retries or frees its reservation. */
export function reconcileAction(row, { attemptId, actorUserId, approverUserId, at, evidence }) {
  approver({ actorUserId, approverUserId });
  const execution = object(row.execution);
  if (row.status !== 'unknown' || !execution?.attemptId || execution.attemptId !== attemptId)
    throw new Error('Only the same unknown attempt can receive reconciliation evidence');
  return { execution: { ...execution, reconciliation: {
    observedAt: timestamp(at), recordedBy: actorUserId, evidence: text(evidence, 'reconciliation evidence', 4000)
  } } };
}

/** Host-owned adapter seam. There is deliberately no default provider, account, HTTP request or agent tool.
 * load/claim/settle callbacks must enforce workspace access and return durably committed action rows.
 * A shared-state claim failure must throw before send; settlement failures leave the claim in place.
 */
export class AppActionDispatcher {
  constructor({ load, claim, settle, connector = null, timeoutMs = 30_000, now = () => new Date().toISOString() }) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid connector timeout');
    Object.assign(this, { load, claim, settle, connector, timeoutMs, now });
  }

  async dispatch(input) {
    const connector = this.connector;
    if (!connector || typeof connector.send !== 'function') throw new Error('No approved-action connector configured');
    const row = await this.load(input);
    const payload = unchanged(row, input.digest);
    if (payload.connectorId !== connector.id || payload.account !== connector.account)
      throw new Error('No connector is configured for the exact approved account and channel');
    const claimed = await this.claim({ ...input, connectorId: connector.id, account: connector.account, at: this.now() });
    const execution = object(claimed.execution);
    if (claimed.status !== 'executing' || !execution?.attemptId || claimed.digest !== row.digest)
      throw new Error('The action claim was not durably confirmed');
    const controller = new AbortController();
    let timer;
    let result;
    try {
      result = await Promise.race([
        Promise.resolve().then(() => connector.send(Object.freeze({ ...payload }), {
          signal: controller.signal, idempotencyKey: execution.idempotencyKey
        })),
        new Promise((_resolve, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new Error('Action connector timed out'));
        }, this.timeoutMs); })
      ]);
      // Validate before settlement. An invalid/missing receipt is ambiguous, never a retry cue.
      settleAction(claimed, { attemptId: execution.attemptId, at: this.now(), result });
    } catch {
      result = { outcome: 'unknown', reason: 'Provider acceptance is unknown. Reconcile the destination before any new action; do not retry this attempt.' };
    } finally { clearTimeout(timer); }
    return this.settle({ ...input, attemptId: execution.attemptId, at: this.now(), result });
  }
}
