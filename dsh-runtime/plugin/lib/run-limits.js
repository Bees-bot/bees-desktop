import { randomUUID } from "node:crypto";

export const RUN_LIMIT_CODE = "BEES_RUN_LIMIT_EXCEEDED";
// 64 requests died long before the tokens did; a small local model answers in many short calls.
export const DEFAULT_RUN_LIMITS = Object.freeze({ maxRequests: 250, maxTokens: 250_000, reserveOutputTokens: 4096 });

const count = (value) => Number.isFinite(value) && value >= 0 ? Math.ceil(value) : 0;

/** DSH input/cache fields are disjoint; reasoning is already included in output. */
export function processedTokens(usage) {
  if (!usage || typeof usage !== "object") return null;
  const fields = ["inputTokens", "cacheReadTokens", "cacheWriteTokens", "outputTokens"];
  if (!fields.some((field) => Number.isFinite(usage[field])) && !Number.isFinite(usage.totalTokens)) return null;
  return Math.max(count(usage.totalTokens), fields.reduce((total, field) => total + count(usage[field]), 0));
}

/** Admission estimate only; provider usage replaces it when the request finishes. */
export function estimateRequestTokens(options) {
  let imageTokens = 0;
  const text = JSON.stringify({ system: options.system, messages: options.messages, tools: options.tools }, (_key, value) => {
    if (value?.type !== "image") return value;
    // Image bytes are not text tokens. The provider's actual accounting wins at settlement.
    imageTokens += 1536;
    return { type: "image" };
  });
  // Three bytes a token is already pessimistic; a byte a token booked a 60 KB request as 60,000.
  return Math.ceil(Buffer.byteLength(text ?? "", "utf8") / 3) + imageTokens;
}

/** One durable admission ledger shared by a goal, its children, reviews and recovered sessions. */
export class RunLimits {
  constructor(database, limits = {}) {
    this.database = database;
    this.limits = { ...DEFAULT_RUN_LIMITS, ...limits };
    for (const [key, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid run limit: ${key}`);
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS bees_run_limit_sessions (
        session_id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS bees_run_limit_requests (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        reserved_tokens INTEGER NOT NULL,
        used_tokens INTEGER,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS bees_run_limit_requests_root ON bees_run_limit_requests(root_id);
    `);
  }

  rootForSession(sessionId, executionId = null) {
    const id = String(sessionId);
    const known = this.database.prepare("SELECT root_id AS rootId FROM bees_run_limit_sessions WHERE session_id = ?").get(id);
    if (known) return known.rootId;
    const run = this.database.prepare(`
      SELECT execution_id AS executionId, work_item_id AS workItemId FROM execution_links
      WHERE current_session_id = ? OR previous_session_id = ? OR execution_id = ? LIMIT 1
    `).get(id, id, executionId);
    if (!run) return null;
    let itemId = run.workItemId;
    const seen = new Set();
    while (itemId && !seen.has(itemId)) {
      seen.add(itemId);
      const parent = this.database.prepare("SELECT parent_id AS parentId FROM work_items WHERE id = ?").get(itemId)?.parentId;
      if (!parent) break;
      itemId = parent;
    }
    const rootId = itemId ? `work:${itemId}` : `execution:${run.executionId}`;
    this.bind(id, rootId);
    return rootId;
  }

  bind(sessionId, rootId) {
    this.database.prepare("INSERT OR IGNORE INTO bees_run_limit_sessions VALUES (?, ?)").run(String(sessionId), rootId);
  }

  /** Call for session/agent creation as well as events, so discussion peers inherit their lead's budget. */
  observeSession(session, executionId = null) {
    const id = String(session.id);
    const own = this.rootForSession(id, executionId);
    if (own) return own;
    const parent = session.header?.parentSession;
    const rootId = parent ? this.rootForSession(parent) : null;
    if (rootId) this.bind(id, rootId);
    return rootId;
  }

  usage(rootId) {
    const row = this.database.prepare(`
      SELECT count(*) AS requests, coalesce(sum(coalesce(used_tokens, reserved_tokens)), 0) AS tokens,
             coalesce(sum(CASE WHEN used_tokens IS NULL THEN reserved_tokens ELSE 0 END), 0) AS reservedTokens
      FROM bees_run_limit_requests WHERE root_id = ?
    `).get(rootId);
    return { rootId, requests: Number(row.requests), tokens: Number(row.tokens), reservedTokens: Number(row.reservedTokens) };
  }

  reserve(rootId, sessionId, tokens) {
    const id = randomUUID();
    // One SQL statement serializes admissions even when peers use different DB connections.
    const result = this.database.prepare(`
      INSERT INTO bees_run_limit_requests (id, root_id, session_id, reserved_tokens, created_at)
      SELECT ?, ?, ?, ?, ? WHERE
        (SELECT count(*) FROM bees_run_limit_requests WHERE root_id = ?) < ? AND
        (SELECT coalesce(sum(coalesce(used_tokens, reserved_tokens)), 0)
         FROM bees_run_limit_requests WHERE root_id = ?) + ? <= ?
    `).run(id, rootId, String(sessionId), tokens, new Date().toISOString(), rootId,
      this.limits.maxRequests, rootId, tokens, this.limits.maxTokens);
    return Number(result.changes) ? id : null;
  }

  /** Each live stream attempt gets one receipt; replayed cumulative/final session events are never recharged. */
  async *stream(options, next) {
    const rootId = options.sessionId ? this.rootForSession(options.sessionId) : null;
    if (!rootId) { yield* next(); return; }
    const reservation = estimateRequestTokens(options) + (count(options.maxTokens) || this.limits.reserveOutputTokens);
    const id = this.reserve(rootId, options.sessionId, reservation);
    if (!id) {
      yield { type: "finish", reason: { kind: "error", failure: {
        code: RUN_LIMIT_CODE,
        message: `This workflow reached its shared usage limit (${this.limits.maxRequests} model requests or ${this.limits.maxTokens.toLocaleString("en-US")} processed tokens, including child agents and reviews). No further model request was sent. Split the outcome into smaller work items and run them separately.`,
      } } };
      return;
    }
    let observed = null;
    let finished = false;
    try {
      for await (const chunk of next()) {
        if (chunk.type === "usage") {
          const total = processedTokens(chunk.usage);
          if (total !== null) observed = Math.max(observed ?? 0, total);
        }
        if (chunk.type === "finish") finished = chunk.reason?.kind === "stop" || chunk.reason?.kind === "tool-calls" || chunk.reason?.kind === "max-tokens";
        yield chunk;
      }
    } finally {
      // A provider that reports no usage still spent its estimate; one that never answered spent no
      // tokens, but it keeps its request slot so a stream that dies every time cannot retry for ever.
      // ponytail: estimated admission may undershoot provider tokenization; actual overages block the next request.
      if (observed !== null) this.database.prepare("UPDATE bees_run_limit_requests SET used_tokens = ? WHERE id = ?")
        .run(finished ? observed : Math.max(reservation, observed), id);
      else if (finished) this.database.prepare("UPDATE bees_run_limit_requests SET used_tokens = ? WHERE id = ?")
        .run(reservation, id);
      else this.database.prepare("UPDATE bees_run_limit_requests SET used_tokens = 0 WHERE id = ?").run(id);
    }
  }
}
