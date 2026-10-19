import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function harness({ providers = {}, preferences = {}, keys = {}, systemDefault, props = 0, rejectSave = false, rejectTest = false } = {}) {
  let client, cursor = 0;
  const states = [], answers = [], prompts = [], requests = [];
  const scope = (value) => ({ getSnapshot: () => ({ value }), subscribe: () => () => {},
    set: async (key, next) => { if (!rejectSave) value[key] = next; } });
  const modelSettings = scope({ providers }), prefs = scope(preferences);
  const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: (initial) => { const i = cursor++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
      return [states[i], (value) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; }, useEffect: () => {} };
  vm.runInNewContext(readFileSync(new URL("./client.js", import.meta.url), "utf8"), {
    URL, AbortSignal, crypto: { randomUUID: () => "test-session" },
    fetch: async (url) => { requests.push(url); return { ok: !rejectTest, json: async () => ({ default_generation_settings: { n_ctx: props }, error: rejectTest ? "Model unavailable" : undefined }) }; },
    window: { __ModuleLoader__: { load: ({ factory }) => { client = factory(() => React); } } }
  });
  const credentials = { set: async (ref, key) => { keys[ref] = key; return { ok: true }; },
    describe: async (refs) => ({ ok: true, value: Object.fromEntries(refs.map((ref) => [ref, { configured: Boolean(keys[ref]) }])) }) };
  const Button = "button";
  const render = () => { cursor = 0; return client.OpenAiServersSettings({ ctx: { remote: { credentials } }, modelSettings,
    preferences: prefs, systemDefault, Button, ask: async (...args) => { prompts.push(args); assert(answers.length, "Unexpected prompt"); return answers.shift(); } }); };
  const nodes = (tree) => tree && typeof tree === "object" ? [tree, ...tree.children.flatMap(nodes)] : [];
  const button = (label, tree = render()) => nodes(tree).find((node) => node.type === Button && node.children.includes(label));
  const text = (tree) => tree && typeof tree === "object" ? tree.children.map(text).join(" ") : String(tree ?? "");
  const click = async (label, values = []) => { answers.push(...values); await button(label).props.onClick(); return render(); };
  return { render, click, button, nodes, text, keys, prompts, requests, providers: () => modelSettings.getSnapshot().value.providers, preferences };
}

test("one server form connects local servers without a key and hosted APIs with a saved key", async () => {
  const ui = harness({ props: 16384 });
  await ui.click("Add server", ["http://127.0.0.1:1234/v1/", "qwen", ""]);
  const local = ui.providers()["custom-openai"];
  assert.equal(local.baseURL, "http://127.0.0.1:1234/v1");
  assert.equal(local.headers.authorization, "Bearer local");
  assert.equal(local.apiKeyEnv, undefined);
  assert.equal(local.models[0].contextWindow, 16384);
  assert.equal(local.models[0].maxTokens, 8192);
  await ui.click("Add server", ["https://api.example.com/v1", "remote-model", "secret-key"]);
  const hosted = ui.providers()["custom-openai-2"];
  assert.equal(hosted.apiKeyEnv, "BEES_CUSTOM_OPENAI_2_API_KEY");
  assert.equal(ui.keys[hosted.apiKeyEnv], "secret-key");
  assert.equal(hosted.headers.authorization, undefined);
  assert(!JSON.stringify(ui.preferences).includes("secret-key"));
  assert.equal(hosted.models[0].contextWindow, 131072);
  assert.equal(ui.requests.length, 3);
  assert(!/Bees AI|Suggested for this computer|Another local AI server/.test(ui.text(ui.render())));
});

test("legacy connections retain their IDs, keys, headers, context windows and disabled model lists", async () => {
  const models = [{ id: "old", name: "Old model", contextWindow: 65536, maxTokens: 4096 }];
  const ui = harness({ providers: { "custom-openai": { baseURL: "https://api.example.com/v1", apiKeyEnv: "BEES_CUSTOM_OPENAI_API_KEY", models } },
    preferences: { externalLocalAiProfile: { baseURL: "http://localhost:1234/v1", models } }, keys: { BEES_CUSTOM_OPENAI_API_KEY: "stored" } });
  await ui.click("Edit endpoint", ["http://localhost:4321/v1", ""]);
  const local = ui.providers()["external-local-ai"];
  assert.equal(local.baseURL, "http://localhost:4321/v1");
  assert.equal(local.models[0].contextWindow, 65536);
  const toggle = ui.nodes(ui.render()).find((node) => node.props["aria-label"] === "Enable http://localhost:4321/v1");
  await toggle.props.onChange({ target: { checked: false } });
  assert(!ui.providers()["external-local-ai"]);
  await ui.click("Add model", ["extra"]);
  assert(!ui.providers()["external-local-ai"]);
  assert.equal(ui.preferences.openAiServerProfiles["external-local-ai"].models.length, 2);

});

test("editing a keyed endpoint keeps the original credential reference and model metadata", async () => {
  const profile = { baseURL: "https://api.example.com/v1", apiKeyEnv: "BEES_CUSTOM_OPENAI_API_KEY",
    headers: { "x-routing": "existing" }, models: [{ id: "old", name: "Old", contextWindow: 65536, maxTokens: 4096 }] };
  const ui = harness({ providers: { "custom-openai": profile }, keys: { BEES_CUSTOM_OPENAI_API_KEY: "saved" } });
  await ui.click("Edit endpoint", ["https://api.example.com/v1", ""]);
  const saved = ui.providers()["custom-openai"];
  assert.equal(saved.apiKeyEnv, profile.apiKeyEnv);
  assert.equal(ui.keys[saved.apiKeyEnv], "saved");
  assert.equal(saved.headers["x-routing"], "existing");
  assert.equal(saved.models[0].contextWindow, 65536);
  assert.equal(ui.prompts.length, 2);
});

test("server form validates URLs, handles cancellation, and reports rejected settings writes", async () => {
  for (const url of ["file:///tmp/model", "javascript:alert(1)", "https://user:secret@example.com/v1", "not a URL"]) {
    const ui = harness();
    const tree = await ui.click("Add server", [url]);
    assert.equal(Object.keys(ui.providers()).length, 0);
    assert(ui.nodes(tree).some((node) => node.props.role === "alert"));
  }
  for (const answers of [[null], ["http://localhost/v1", null], ["http://localhost/v1", "model", null]]) {
    const ui = harness();
    await ui.click("Add server", answers);
    assert.equal(Object.keys(ui.providers()).length, 0);
  }
  const ui = harness({ rejectSave: true });
  const tree = await ui.click("Add server", ["https://api.example.com/v1", "model", ""]);
  assert.match(ui.text(tree), /did not save that connection/);
});

test("model edits reject duplicates and preserve the system default and the last model", async () => {
  const ui = harness({ providers: { "custom-openai": { baseURL: "https://api.example.com/v1", headers: { authorization: "Bearer local" },
    models: [{ id: "default" }, { id: "other" }] } }, systemDefault: { provider: "custom-openai", model: "default" } });
  assert.match(ui.text(await ui.click("Add model", ["other"])), /already connected/);
  const defaultButton = ui.nodes(ui.render()).find((node) => node.props["aria-label"] === "Remove default");
  assert(defaultButton.props.disabled);
  await defaultButton.props.onClick();
  assert.equal(ui.providers()["custom-openai"].models.length, 2);
  const toggle = ui.nodes(ui.render()).find((node) => node.props.role === "switch");
  assert(toggle.props.disabled);
  await toggle.props.onChange({ target: { checked: false } });
  assert(ui.providers()["custom-openai"]);
  const other = ui.nodes(ui.render()).find((node) => node.props["aria-label"] === "Remove other");
  await other.props.onClick();
  assert.equal(ui.providers()["custom-openai"].models.length, 1);
});


test("server connections are tested before saving keys and cannot reuse a key at another address", async () => {
  const rejected = harness({ rejectTest: true });
  assert.match(rejected.text(await rejected.click("Add server", ["https://api.example.com/v1", "model", "new-key"])), /Model unavailable/);
  assert.deepEqual(rejected.providers(), {});
  assert.deepEqual(rejected.keys, {});
  const profile = { baseURL: "https://api.example.com/v1", apiKeyEnv: "BEES_CUSTOM_OPENAI_API_KEY", models: [{ id: "model" }] };
  const existing = harness({ providers: { "custom-openai": profile }, keys: { BEES_CUSTOM_OPENAI_API_KEY: "saved" } });
  assert.match(existing.text(await existing.click("Edit endpoint", ["https://other.example.com/v1", ""])), /Enter the API key again/);
  assert.equal(existing.requests.length, 0);
  assert.equal(existing.providers()["custom-openai"].baseURL, profile.baseURL);
});
