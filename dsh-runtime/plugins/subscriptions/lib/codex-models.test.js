import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, fetchCodexModels } from "./index.js";
import { apply as applyPiAi, Config as PiAiConfig } from "@deepseek-ai/dsh-llm-pi-ai";

const listed = (slug, extra = {}) => ({ slug, display_name: slug, visibility: "list", context_window: 272000,
  input_modalities: ["text", "image"], supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "max" }, { effort: "ultra" }], ...extra });
const grant = { type: "oauth", access: "test-access", refresh: "test-refresh", accountId: "test-account", expires: Date.now() + 86_400_000 };

test("account discovery accepts new model IDs and advertises capabilities the runtime can serve", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new URL(url).origin, "https://chatgpt.com");
    assert.equal(new URL(url).pathname, "/backend-api/codex/models");
    assert.equal(options.headers.authorization, "Bearer test-access");
    assert.equal(options.headers["chatgpt-account-id"], "test-account");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ models: [listed("gpt-6-sol"), listed("gpt-6-luna"), listed("gpt-99-future"),
      listed("hidden", { visibility: "hide" }), listed("invalid/id"), null] });
  });
  const models = await fetchCodexModels(grant);
  assert.deepEqual(models.map(({ id }) => id), ["gpt-6-sol", "gpt-6-luna", "gpt-99-future"]);
  let adapter;
  applyPiAi({
    fiber: { entry: { options: { id: "llm-pi-ai" } } }, inject() {}, on() {},
    llm: { registerModelDiscovery() {}, registerConfigurableProviders: () => ({ replace() {} }),
      registerAdapter(_routes, value) { adapter = value; return { replace() {} }; } }
  }, PiAiConfig({ providers: { "openai-codex": { models } } }));
  assert.deepEqual((await adapter.listModels("openai-codex")).map(({ id }) => id), models.map(({ id }) => id));
  const model = await adapter.resolveModel("openai-codex", "gpt-99-future");
  assert.equal(model.context.contextWindow, 272000);
  assert.deepEqual(model.inputModalities, ["text", "image"]);
  assert.deepEqual(model.reasoning.efforts.map(({ id }) => id), ["low", "medium", "max"]);
});

async function subscriptions(t, { connected = true, enabled = true } = {}) {
  let excluded = [], mutations = 0, handler;
  const credentials = new Map(connected ? [["BEES_CODEX_OAUTH", JSON.stringify(grant)], ["BEES_CODEX_ACCESS_TOKEN", grant.access]] : []);
  const saved = [{ id: "gpt-5.6-sol", name: "Saved Sol" }, { id: "custom-model", maxTokens: 1234 }];
  const section = { ns: "llm-pi-ai", revision: 0, value: { providers: {
    unrelated: { models: [{ id: "untouched" }] },
    ...(enabled ? { "openai-codex": { apiKeyEnv: "BEES_CODEX_ACCESS_TOKEN", displayName: "My Codex", models: saved } } : {})
  } } };
  const warnings = [];
  const ctx = {
    fiber: { entry: { options: { id: "bees-subscriptions" } } },
    credentials: {
      resolve: async (key) => credentials.has(key) ? { value: credentials.get(key) } : undefined,
      set: async (key, value) => credentials.set(key, value), unset: async (key) => credentials.delete(key)
    },
    settings: {
      describe: () => [structuredClone(section)],
      async mutate(ns, [op], revision) {
        assert.equal(ns, "llm-pi-ai");
        assert.equal(revision, section.revision);
        assert.deepEqual(op.path, ["providers", "openai-codex", "models"]);
        section.value.providers["openai-codex"].models = op.value;
        section.revision++; mutations++;
      },
      async update(ns, value) { assert.equal(ns, "bees-subscriptions"); excluded = value.codexExcludedModels; }
    },
    logger: { warn: (message) => warnings.push(message) }, llm: {},
    effect(fn) { const dispose = fn(); t.after(() => dispose?.()); },
    webServer: { register(route) { handler = route.handler; return () => {}; } }
  };
  await apply(ctx, { models: { get: () => ["default"] }, codexExcludedModels: { get: () => excluded } });
  return {
    section, warnings, credentials, mutations: () => mutations,
    async request(input) {
      let status, body;
      await handler({ method: input ? "POST" : "GET", async *[Symbol.asyncIterator]() { yield JSON.stringify(input); } },
        { writeHead(value) { status = value; }, end(value) { body = JSON.parse(value); } });
      return { status, body };
    }
  };
}

test("existing connections refresh automatically, preserve choices, and keep removals hidden", async (t) => {
  let now = Date.now(), calls = 0;
  t.mock.method(Date, "now", () => now);
  let upstream = [listed("gpt-6-sol"), listed("gpt-6-luna")];
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ models: upstream }); });
  const app = await subscriptions(t);
  const profile = app.section.value.providers["openai-codex"];
  assert.deepEqual(profile.models.map(({ id }) => id), ["gpt-5.6-sol", "custom-model", "gpt-6-sol", "gpt-6-luna"]);
  assert.equal(profile.displayName, "My Codex");
  assert.equal(profile.models[1].maxTokens, 1234);
  assert.equal(app.section.value.providers.unrelated.models[0].id, "untouched");
  assert.equal((await app.request()).body.codex, true);
  assert.equal(calls, 1);
  assert.equal(app.mutations(), 1);
  // Settings may serialize fields in schema order; that must not trigger a write every minute.
  profile.models = profile.models.map((model) => Object.fromEntries(Object.entries(model).reverse()));
  await app.request();
  assert.equal(app.mutations(), 1);

  // Model removal is remembered independently of the automatically discovered list.
  assert.equal((await app.request({ action: "codex_models", models: ["gpt-5.6-sol", "custom-model", "gpt-6-sol"] })).status, 200);
  await app.request();
  assert.ok(!profile.models.some(({ id }) => id === "gpt-6-luna"));
  upstream.push(listed("gpt-99-future"));
  now += 15 * 60_000;
  await app.request();
  assert.equal(calls, 2);
  assert.ok(profile.models.some(({ id }) => id === "gpt-99-future"));
  assert.ok(!profile.models.some(({ id }) => id === "gpt-6-luna"));
  await app.request({ action: "codex_models", models: [...profile.models.map(({ id }) => id), "gpt-6-luna"] });
  await app.request();
  assert.ok(profile.models.some(({ id }) => id === "gpt-6-luna"));
  assert.equal((await app.request({ action: "codex_models", models: [] })).status, 409);
  assert.equal((await app.request({ action: "codex_models", models: ["invalid/id"] })).status, 409);
});

test("discovery failures keep the last working catalog and do not disconnect Codex", async (t) => {
  let failure = false, calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (failure) throw new Error("offline");
    return Response.json({ models: [listed("gpt-6-sol"), listed("gpt-6-luna")] });
  });
  const app = await subscriptions(t);
  const before = structuredClone(app.section.value);
  failure = true;
  assert.equal((await app.request({ action: "codex_test" })).status, 200);
  const status = (await app.request()).body;
  assert.equal(status.codex, true);
  assert.match(status.codexModelError, /saved models/);
  assert.deepEqual(app.section.value, before);
  assert.equal(calls, 2);
  assert.equal(app.mutations(), 1);

  const offlineStartup = await subscriptions(t);
  assert.equal(offlineStartup.mutations(), 0);
  assert.deepEqual(offlineStartup.section.value.providers["openai-codex"].models.map(({ id }) => id), ["gpt-5.6-sol", "custom-model"]);
});

test("disabled or signed-out connections stay disabled, and invalid catalogs fail safely", async (t) => {
  let body = { models: [listed("gpt-6-sol")] };
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(body));
  const disabled = await subscriptions(t, { enabled: false });
  assert.equal(disabled.mutations(), 0);
  assert.equal(disabled.section.value.providers["openai-codex"], undefined);
  const signedOut = await subscriptions(t, { connected: false });
  assert.equal((await signedOut.request()).body.codex, false);
  assert.equal(fetch.mock.callCount(), 1);
  for (body of [{}, { models: [] }, { models: [listed("hidden", { visibility: "hide" })] }])
    await assert.rejects(fetchCodexModels(grant), /catalog|visible models/);
  fetch.mock.mockImplementation(async () => new Response("untrusted body", { status: 401 }));
  await assert.rejects(fetchCodexModels(grant), /HTTP 401/);
});
