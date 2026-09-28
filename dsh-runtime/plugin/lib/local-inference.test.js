import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { Context } from "@deepseek-ai/cordis";
import { LlmRuntime, markAgentLoopRequest } from "@deepseek-ai/dsh-llm";
import { apply as mountPiAi } from "@deepseek-ai/dsh-llm-pi-ai";
import { LocalInference, mountLocalInference } from "./local-inference.js";

const base = "http://127.0.0.1:1234/v1";
const drain = async (stream) => { for await (const _ of stream) { /* consume all output */ } };

function mounted() {
  const hooks = {};
  const providers = { "local-openai": { baseURL: base }, "local-openai-qwen": { baseURL: base + "/" },
    "local-openai-other": { baseURL: "http://127.0.0.1:1235/v1" } };
  const inference = mountLocalInference({ on: (name, fn) => { hooks[name] = fn; },
    settings: { describe: () => [{ ns: "llm-pi-ai", value: { providers } }] } });
  return { inference, stream: hooks["llm/stream"], dispose: hooks.dispose };
}

test("five workers wait outside the adapter timer and background work follows them", async () => {
  const { inference, stream, dispose } = mounted();
  const release = await inference.acquire(base);
  const order = [];
  const completion = (name) => async function* () {
    order.push(name);
    await delay(5);
    yield { type: "finish", reason: { kind: "stop" } };
  };
  const title = drain(stream({ provider: "local-openai" }, completion("title")));
  const memory = inference.acquire(base, undefined, true).then((done) => { order.push("memory"); done(); });
  const workers = Array.from({ length: 5 }, (_, id) => drain(stream(Object.freeze(markAgentLoopRequest({
    provider: id % 2 ? "local-openai-qwen" : "local-openai"
  })), completion(`worker-${id}`))));
  await drain(stream({ provider: "openai" }, completion("cloud")));
  await drain(stream({ provider: "local-openai-other" }, completion("other-model")));
  await delay(30);
  assert.deepEqual(order, ["cloud", "other-model"], "queued requests must not enter the timed adapter");
  release();
  await Promise.all([...workers, title, memory]);
  assert.deepEqual(order, ["cloud", "other-model", ...Array.from({ length: 5 }, (_, i) => `worker-${i}`), "title", "memory"]);
  assert.equal(inference.queues.size, 0);
  dispose();
});

test("cancelling a queued request is immediate and never calls its adapter", async () => {
  const { inference, stream, dispose } = mounted();
  const release = await inference.acquire(base);
  const controller = new AbortController();
  const pending = drain(stream({ provider: "local-openai", signal: controller.signal }, () => {
    assert.fail("cancelled request reached the adapter");
  }));
  const rejected = assert.rejects(pending, { name: "AbortError" });
  controller.abort();
  await rejected;
  const next = inference.acquire(base);
  release();
  (await next)();
  assert.equal(inference.queues.size, 0);
  dispose();
});

test("short worker continuations reuse the slot with a four-request fairness bound", async () => {
  const inference = new LocalInference();
  const order = [];
  const release = await inference.acquire(base, undefined, false, "first");
  order.push("first");
  const second = inference.acquire(base, undefined, false, "second").then((done) => { order.push("second"); done(); });
  release();
  for (let i = 0; i < 4; i++) {
    await delay(5); // Simulate a fast local file tool between model requests.
    const done = await inference.acquire(base, undefined, false, "first");
    order.push("first"); done();
  }
  await second;
  assert.deepEqual(order, ["first", "first", "first", "first", "second", "first"]);
  inference.close();
  await delay(110);
  assert.equal(inference.queues.size, 0);
});

test("a worker waiting on a slow tool does not reserve the model slot", async () => {
  const inference = new LocalInference();
  const release = await inference.acquire(base, undefined, false, "slow");
  const ready = inference.acquire(base, undefined, false, "ready");
  release();
  const done = await ready;
  done(); inference.close();
  await delay(110);
  assert.equal(inference.queues.size, 0);
});

test("background jobs cannot interrupt a fast worker at the four-request boundary", async () => {
  const inference = new LocalInference();
  const order = [];
  let release = await inference.acquire(base, undefined, false, "worker");
  const memory = inference.acquire(base, undefined, true).then((done) => { order.push("memory"); done(); });
  for (let i = 0; i < 6; i++) {
    order.push("worker");
    release();
    if (i < 5) {
      await delay(5);
      release = await inference.acquire(base, undefined, false, "worker");
    }
  }
  await memory;
  assert.deepEqual(order, [...Array(6).fill("worker"), "memory"]);
  inference.close();
});

test("middleware identifies continuations by session even when message identity changes", async () => {
  const { stream, dispose } = mounted();
  const order = [], started = Promise.withResolvers(), finish = Promise.withResolvers();
  const request = (sessionId, id) => Object.freeze(markAgentLoopRequest({
    provider: "local-openai", sessionId, messages: [{ id, role: "system", content: [] }]
  }));
  const first = drain(stream(request("first", "before"), async function* () {
    order.push("first"); started.resolve(); await finish.promise; yield "done";
  }));
  await started.promise;
  const second = drain(stream(request("second", "other"), async function* () { order.push("second"); yield "done"; }));
  finish.resolve(); await first;
  await drain(stream(request("first", "after"), async function* () { order.push("continuation"); yield "done"; }));
  await second;
  assert.deepEqual(order, ["first", "continuation", "second"]);
  dispose();
});

test("adapter errors and early stream closure both release the slot", async () => {
  const { inference, stream, dispose } = mounted();
  await assert.rejects(drain(stream({ provider: "local-openai" }, async function* () {
    throw new Error("upstream failed");
  })), /upstream failed/);
  const iterator = stream({ provider: "local-openai" }, async function* () { yield "token"; yield "more"; });
  assert.equal((await iterator.next()).value, "token");
  const next = inference.acquire(base);
  await iterator.return();
  (await next)();
  assert.equal(inference.queues.size, 0);
  dispose();
});

test("shutdown rejects pending requests without leaking queue entries", async () => {
  const inference = new LocalInference();
  const release = await inference.acquire(base);
  const pending = Array.from({ length: 5 }, () => assert.rejects(inference.acquire(base), { name: "AbortError" }));
  inference.close();
  await Promise.all(pending);
  release();
  assert.equal(inference.queues.size, 0);
  await assert.rejects(inference.acquire(base), { name: "AbortError" });
});

test("real pi-ai watchdog times out a server queue but accepts five admitted requests", async () => {
  let tail = Promise.resolve();
  const server = createServer((request, response) => {
    request.resume();
    tail = tail.then(async () => {
      await delay(150); // One inference slot, just like the bundled llama-server.
      if (response.destroyed) return;
      response.writeHead(200, { "content-type": "text/event-stream" });
      const event = { id: "completion", object: "chat.completion.chunk", created: 1, model: "active" };
      response.write(`data: ${JSON.stringify({ ...event, choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}\n\n`);
      response.end(`data: ${JSON.stringify({ ...event, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const providers = { "local-openai": { api: "openai-completions",
    baseURL: `http://127.0.0.1:${server.address().port}/v1`, headers: { authorization: "Bearer local" },
    streamIdleTimeoutMs: 500, models: [{ id: "active", contextWindow: 32768, maxTokens: 16 }] } };
  let adapter, inference;
  mountPiAi({ fiber: {}, inject() {}, on() {}, get() {}, llm: {
    registerConfigurableProviders: () => ({ replace() {} }), registerModelDiscovery() {},
    registerAdapter: (_routes, value) => { adapter = value; return { replace() {} }; }
  } }, { providers: { get: () => providers } });
  const ctx = new Context();
  const llm = await ctx.plugin(LlmRuntime);
  const mounted = await ctx.plugin({ apply(child) {
    inference = mountLocalInference(child.extend({
      settings: { describe: () => [{ ns: "llm-pi-ai", value: { providers } }] }
    }));
  } });
  ctx.llm.registerAdapter(["local-openai"], adapter);
  const options = () => markAgentLoopRequest({ provider: "local-openai", model: "active",
    messages: [{ role: "user", content: [{ type: "text", text: "Say OK" }] }] });
  try {
    const before = await Promise.allSettled(Array.from({ length: 5 }, () => drain(adapter.stream(options()))));
    assert(before.some((result) => result.status === "rejected" && result.reason.code === "TIMEOUT"));
    await tail;
    const after = await Promise.allSettled(Array.from({ length: 5 }, () => {
      const request = Object.freeze(options());
      return (async () => {
        for await (const chunk of ctx.llm.stream(request))
          if (chunk.type === "finish") assert.equal(chunk.reason.kind, "stop");
      })();
    }));
    assert.equal(after.filter(({ status }) => status === "fulfilled").length, 5);
    assert.equal(inference.queues.size, 0);
  } finally {
    inference.close();
    await mounted.dispose();
    await llm.dispose();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
