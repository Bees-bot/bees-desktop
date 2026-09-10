import { createRequire } from "node:module";
import { expect, it } from "vitest";
import {
  installContextPolicy, pruneToolResults, readToolResult,
  TOOL_PREVIEW_CHARS, TOOL_RECEIPT_CHARS, TOOL_READ_CHARS
} from "../dsh-runtime/plugin/lib/context-policy.js";
import { safeRecoverySeed } from "../dsh-runtime/plugin/lib/agent-runtime.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const { Context } = require("@deepseek-ai/cordis");
const { Session, SessionStore } = require("@deepseek-ai/dsh-session");
const { createAssistantMessage, createToolResultMessage } = require("@deepseek-ai/dsh-llm");
const { SessionProjectionRegistry } = require("@deepseek-ai/dsh-session-projection");
const { TokenMeter } = require("@deepseek-ai/dsh-token-meter");
const { toolPairingBalancedAfter } = require("@deepseek-ai/dsh-compaction");

function runtime() {
  const ctx = new Context();
  new SessionStore(ctx);
  new SessionProjectionRegistry(ctx);
  const meter = new TokenMeter(ctx);
  return { ctx, meter };
}

function appendResult(session: any, step: number, content: any[], error = false) {
  const callId = `call-${step}`;
  session.append("step/start", { turn: 1, step });
  session.append("assistant/message", {
    turn: 1, step, message: createAssistantMessage({
      source: { provider: "test", model: "test" },
      content: [{ type: "tool-call", id: callId, name: "fetch", arguments: "{}" }]
    })
  }, { surfaceOp: "append" });
  session.append("tool/call", { turn: 1, step, callId, name: "fetch", arguments: "{}" });
  const result = session.append("tool/result", {
    turn: 1, step, message: createToolResultMessage({ callId, content, isError: error }),
    ...(error ? { error: { name: "FetchError", code: "HTTP_ERROR" } } : {}),
    meta: { source: "https://example.com/feed", audit: step }
  }, { surfaceOp: "append" });
  session.append("step/end", { turn: 1, step });
  return result;
}

const resultEvents = (session: any) => session.surface.nodes.map((seq: number) => session.eventAt(seq))
  .filter((event: any) => event.type === "tool/result");
const resultText = (event: any) => event.data.message.content[0].content
  .filter((block: any) => block.type === "text").map((block: any) => block.text).join("");

it("bounds first-request tool text, ages it, and preserves immutable originals, metadata, errors and rich blocks", () => {
  const { meter } = runtime();
  const session = Session.create("bounded");
  const image = { type: "image", attachment: {
    attachmentId: "image-1", mediaType: "image/png", bytes: 10, width: 1, height: 1
  } };
  const original = appendResult(session, 1, [
    { type: "text", text: "ERROR: fetch failed\n" + "😀".repeat(6_000) }, image,
    { type: "text", text: "x".repeat(5_000) + "\nRetry-After: 60" }
  ], true);
  const originalJson = JSON.stringify(original);
  const before = meter.measure(session).surfaceTokens;
  expect(pruneToolResults(session, meter).pruned).toBe(1);
  const preview = resultEvents(session)[0];
  expect(Array.from(resultText(preview))).toHaveLength(TOOL_PREVIEW_CHARS);
  expect(resultText(preview)).toContain("ERROR: fetch failed");
  expect(resultText(preview)).toContain("Retry-After: 60");
  expect(resultText(preview)).toContain('bees_read_tool_result({"call_id":"call-1"})');
  expect(preview.data.message.content[0].content[1]).toEqual(image);
  expect(preview.data.message.content[0].isError).toBe(true);
  expect(preview.data.error).toEqual(original.data.error);
  expect(preview.data.meta).toEqual(original.data.meta);
  expect(preview.data.message.id).toBe(original.data.message.id);
  expect(preview.data.message.source).toEqual(original.data.message.source);
  expect(JSON.stringify(session.eventAt(original.seq))).toBe(originalJson);
  expect(meter.measure(session).surfaceTokens).toBeLessThan(before);
  expect(pruneToolResults(session, meter).pruned).toBe(0);

  appendResult(session, 2, [{ type: "text", text: "second" }]);
  appendResult(session, 3, [{ type: "text", text: "third" }]);
  expect(pruneToolResults(session, meter).pruned).toBe(1);
  expect(Array.from(resultText(resultEvents(session)[0]))).toHaveLength(TOOL_RECEIPT_CHARS);
  expect(pruneToolResults(session, meter).pruned).toBe(0);
  expect(toolPairingBalancedAfter(session, session.surface.nodes.at(-1))).toBe(true);
});

it("retrieves bounded pages and focused Unicode matches from originals after durable replay and recovery", () => {
  const { meter } = runtime();
  const session = Session.create("original");
  const text = "😀".repeat(5_000) + "RELEVANT HEADLINE\n" + "tail".repeat(2_000);
  appendResult(session, 1, [{ type: "text", text }]);
  pruneToolResults(session, meter);
  session.append("turn/end", { turn: 1, reason: { kind: "completed" } });
  const restored = Session.create("recovered", safeRecoverySeed(JSON.parse(JSON.stringify(session.snapshotEvents()))));
  const before = restored.seq;
  expect(pruneToolResults(restored, meter).pruned).toBe(0);
  expect(restored.seq).toBe(before);
  expect(restored.deriveMessages()).toEqual(session.deriveMessages());
  expect(readToolResult(restored, { call_id: "call-1", find: "RELEVANT HEADLINE" })).toMatchObject({
    offset: 5_000, next_offset: 5_000 + TOOL_READ_CHARS, is_error: false
  });
  let content = "";
  let offset: number | null = 0;
  while (offset !== null) {
    const page = readToolResult(restored, { call_id: "call-1", offset });
    expect(Array.from(page.text).length).toBeLessThanOrEqual(TOOL_READ_CHARS);
    content += page.text;
    offset = page.next_offset;
  }
  expect(content).toBe(text);
  expect(readToolResult(restored, { call_id: "call-1", find: "MISSING" }).found).toBe(false);
  expect(() => readToolResult(restored, { call_id: "other-session" })).toThrow("this session");
  expect(() => readToolResult(restored, { call_id: "call-1", offset: -1 })).toThrow("nonnegative");
  expect(() => readToolResult(restored, { call_id: "call-1", offset: 1.5 })).toThrow("integer");
  expect(() => readToolResult(restored, { call_id: "call-1", offset: text.length + 1 })).toThrow("exceeds");
});

it("rebases pruning references when recovery removes intervening team events", () => {
  const { meter } = runtime();
  const session = Session.create("team-original");
  // These log-only discussion events disappear when Bees builds a recovery seed.
  session.append("team/test", { note: "before first result" });
  appendResult(session, 1, [{ type: "text", text: "Original full result ".repeat(1_000) }]);
  session.append("team/test", { note: "before first replacement" });
  pruneToolResults(session, meter);
  appendResult(session, 2, [{ type: "text", text: "second" }]);
  appendResult(session, 3, [{ type: "text", text: "third" }]);
  session.append("team/test", { note: "before aged replacement" });
  pruneToolResults(session, meter);
  session.append("turn/end", { turn: 1, reason: { kind: "completed" } });
  const seed = safeRecoverySeed(JSON.parse(JSON.stringify(session.snapshotEvents())));
  expect(seed.filter((event: any) => event.type.startsWith("team/"))).toHaveLength(0);
  const recovered = Session.create("team-recovered", seed);
  expect(recovered.deriveMessages()).toEqual(session.deriveMessages());
  expect(pruneToolResults(recovered, meter).pruned).toBe(0);
  expect(readToolResult(recovered, { call_id: "call-1" }).total_chars).toBe("Original full result ".repeat(1_000).length);
  expect(meter.measure(recovered).surfaceTokens).toBe(meter.measure(session).surfaceTokens);
});

it("flushes surface replacements before the request and keeps recall reads in the calling agent's session", async () => {
  const { ctx, meter } = runtime();
  const session = ctx.sessions.create("first");
  const unrelated = Session.create("unrelated");
  appendResult(session, 1, [{ type: "text", text: "private ".repeat(2_000) }]);
  const agent = { session };
  const hooks: any[] = [];
  const definitions: any[] = [];
  const agentCtx = {
    agent, tokenMeter: meter, sessions: ctx.sessions,
    tools: { register: (tool: any) => definitions.push(tool) },
    on: (_name: string, hook: any, options: any) => { hooks.push(hook); expect(options.prepend).toBe(true); }
  };
  installContextPolicy(agentCtx);
  installContextPolicy(agentCtx);
  expect(hooks).toHaveLength(1);
  let flushed: any[] = [];
  ctx.on("session/flush", (value: any) => { flushed = value.snapshotEvents(); });
  await hooks[0]({ agent, signal: new AbortController().signal }, async () => {
    expect(flushed).toEqual(session.snapshotEvents());
    expect(Array.from(resultText(resultEvents(session)[0]))).toHaveLength(TOOL_PREVIEW_CHARS);
  });
  const recall = definitions[0];
  const args = { call_id: "call-1" };
  const value = await recall.execute(args, { agent });
  expect(JSON.parse(value.result_json).text).toBe("private ".repeat(2_000).slice(0, TOOL_READ_CHARS));
  await expect(recall.execute(args, { agent: { session: unrelated } })).rejects.toThrow("this session");
});

it("cuts cumulative replay of four large RSS results by over 95% across 29 request frames without losing original text", () => {
  const { meter } = runtime();
  const oldSession = Session.create("baseline");
  const bounded = Session.create("bounded");
  const feed = '<item><title>Example business headline</title><link>https://example.com/story</link></item>'.repeat(600);
  let baselineTokens = 0;
  let boundedTokens = 0;
  for (let step = 1; step <= 29; step++) {
    const text = step <= 4 ? feed : `Fetch attempt ${step}: no additional articles.`;
    appendResult(oldSession, step, [{ type: "text", text }]);
    appendResult(bounded, step, [{ type: "text", text }]);
    pruneToolResults(bounded, meter);
    baselineTokens += meter.measure(oldSession).surfaceTokens;
    boundedTokens += meter.measure(bounded).surfaceTokens;
  }
  expect(boundedTokens / baselineTokens).toBeLessThan(0.05);
  expect(resultEvents(bounded)).toHaveLength(29);
  expect(toolPairingBalancedAfter(bounded, bounded.surface.nodes.at(-1))).toBe(true);
  expect(readToolResult(bounded, { call_id: "call-1" }).total_chars).toBe(feed.length);
  expect(bounded.snapshotEvents().filter((event: any) => event.type === "compaction/prune")).toHaveLength(8);
});
