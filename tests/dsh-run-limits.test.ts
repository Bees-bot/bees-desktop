import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { RunLimits, RUN_LIMIT_CODE, processedTokens, estimateRequestTokens } from "../dsh-runtime/plugin/lib/run-limits.js";

const databases: DatabaseSync[] = [];
function fixture(limits = {}) {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(`
    CREATE TABLE work_items (id TEXT PRIMARY KEY, parent_id TEXT);
    CREATE TABLE execution_links (execution_id TEXT PRIMARY KEY, work_item_id TEXT, current_session_id TEXT, previous_session_id TEXT);
    INSERT INTO work_items VALUES ('root', NULL), ('child', 'root'), ('unrelated', NULL);
    INSERT INTO execution_links VALUES ('lead', 'root', 'lead-session', 'old-lead'), ('child-run', 'child', 'child-session', NULL),
      ('review', 'root', 'review-session', NULL), ('other', 'unrelated', 'other-session', NULL), ('planning', NULL, 'planning-session', NULL);
  `);
  return { database, budget: new RunLimits(database, { maxTokens: 1000, maxRequests: 10, reserveOutputTokens: 10, ...limits }) };
}
const request = (sessionId = "lead-session") => ({ sessionId, messages: [], maxTokens: 10 });
async function collect(stream: AsyncIterable<any>) { const result = []; for await (const chunk of stream) result.push(chunk); return result; }
async function* response(totalTokens = 40) {
  yield { type: "usage", usage: { inputTokens: 20, outputTokens: 1, totalTokens: 21 } };
  yield { type: "usage", usage: { inputTokens: 20, outputTokens: totalTokens - 20, totalTokens } };
  yield { type: "finish", reason: { kind: "stop" } };
}
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

describe("shared workflow usage limits", () => {
  it("charges live calls once across descendants, review, discussion and recovery", async () => {
    const { database, budget } = fixture();
    expect(budget.observeSession({ id: "discussion", header: { parentSession: "lead-session" } })).toBe("work:root");
    for (const sessionId of ["lead-session", "child-session", "review-session", "discussion", "old-lead"])
      await collect(budget.stream(request(sessionId), () => response()));
    const restarted = new RunLimits(database);
    expect(restarted.usage("work:root")).toEqual({ rootId: "work:root", requests: 5, tokens: 200, reservedTokens: 0 });
    await collect(restarted.stream(request("other-session"), () => response()));
    expect(restarted.usage("work:root").requests).toBe(5);
    expect(restarted.rootForSession("planning-session")).toBe("execution:planning");
    expect(restarted.observeSession({ id: "replacement", header: {} }, "lead")).toBe("work:root");
    expect(restarted.rootForSession("replacement")).toBe("work:root");
  });

  it("reserves parallel requests before dispatch and does not call providers over the limit", async () => {
    const { budget } = fixture({ maxTokens: 100 });
    const options = { ...request(), maxTokens: 70 };
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => { finish = resolve; });
    let started = 0;
    const pending = collect(budget.stream(options, async function* () {
      started++;
      await waiting;
      yield* response();
    }));
    expect(budget.usage("work:root").reservedTokens).toBeGreaterThan(70);
    const denied = await collect(budget.stream({ ...options, sessionId: "child-session" }, async function* () { started++; yield* response(); }));
    expect(denied[0].reason.failure.code).toBe(RUN_LIMIT_CODE);
    expect(started).toBe(1);
    finish();
    await pending;
    expect(budget.usage("work:root").tokens).toBe(40);
  });

  it("counts retries, preserves interrupted reservations and fails closed after restart", async () => {
    const { database, budget } = fixture({ maxRequests: 2 });
    await collect(budget.stream(request(), async function* () {
      yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
      yield { type: "finish", reason: { kind: "error", failure: { code: "TRANSIENT", message: "Interrupted" } } };
    }));
    const reserved = estimateRequestTokens(request()) + 10;
    expect(budget.usage("work:root").tokens).toBe(reserved);
    await collect(budget.stream(request(), async function* () { yield { type: "finish", reason: { kind: "stop" } }; }));
    expect(budget.usage("work:root").tokens).toBe(reserved * 2);
    const restarted = new RunLimits(database, { maxRequests: 2 });
    const denied = await collect(restarted.stream(request(), () => { throw new Error("must not dispatch"); }));
    expect(denied[0].reason.failure.code).toBe(RUN_LIMIT_CODE);
  });

  it("includes cache usage and avoids adding reasoning twice", () => {
    expect(processedTokens({ inputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 5, outputTokens: 7, reasoningTokens: 6 })).toBe(42);
    expect(processedTokens({ inputTokens: 10, outputTokens: 7, totalTokens: 22 })).toBe(22);
    expect(processedTokens({})).toBeNull();
    expect(estimateRequestTokens({ messages: [{ content: [{ type: "image", data: "a".repeat(1_000_000) }] }] })).toBeLessThan(1650);
  });

  it.each(["stop", "tool-calls", "max-tokens"])("settles provider usage on DSH's %s finish", async (kind) => {
    const { budget } = fixture();
    await collect(budget.stream(request(), async function* () {
      yield { type: "usage", usage: { inputTokens: 2, outputTokens: 3 } };
      yield { type: "finish", reason: { kind } };
    }));
    expect(budget.usage("work:root")).toEqual({ rootId: "work:root", requests: 1, tokens: 5, reservedTokens: 0 });
  });

  it("binds nested workflow descendants and preserves aborted usage reservations", async () => {
    const { budget } = fixture();
    budget.observeSession({ id: "workflow-worker", header: { parentSession: "lead-session" } });
    expect(budget.observeSession({ id: "nested-worker", header: { parentSession: "workflow-worker" } })).toBe("work:root");
    await collect(budget.stream(request("nested-worker"), async function* () {
      yield { type: "usage", usage: { inputTokens: 2, outputTokens: 3 } };
      yield { type: "finish", reason: { kind: "aborted", failure: { code: "ABORTED", message: "Cancelled" } } };
    }));
    expect(budget.usage("work:root").tokens).toBe(estimateRequestTokens(request()) + 10);
  });

  it("passes unmanaged sessions through and rejects invalid limits", async () => {
    const { database, budget } = fixture();
    expect(await collect(budget.stream(request("unmanaged"), () => response()))).toHaveLength(3);
    expect(() => new RunLimits(database, { maxRequests: 0 })).toThrow("Invalid run limit");
    expect(budget.usage("work:root").requests).toBe(0);
  });
});
