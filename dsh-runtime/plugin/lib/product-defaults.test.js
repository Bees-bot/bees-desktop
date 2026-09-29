import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { ProductDefaults, refreshProductDefaults, shippedModelCatalog } from "./product-defaults.js";
import { ProductSettings } from "../client/product-settings.js";
import { Config } from "./index.js";
import { Config as SubscriptionConfig } from "../../plugins/subscriptions/lib/index.js";
import { workItemLayoutFrom } from "../client/dashboard-model.js";
import { boot, composeEntries, loadOverlayPatches, readProfilePatches } from "@deepseek-ai/dsh-app-boot";

const shippedPath = new URL("../cordis.patch.yml", import.meta.url);
async function fixture(t, apply) {
  const root = await mkdtemp(join(tmpdir(), "bees-product-defaults-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "dsh-runtime/plugin"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"name":"@bees/desktop"}');
  await writeFile(join(root, "dsh-runtime/plugin/cordis.patch.yml"), await readFile(shippedPath));
  const account = { userId: "admin", enabled: true };
  const connected = { allowed: true, offline: false, calls: 0,
    accounts: () => [account], account: (id) => id === account.userId ? account : null,
    async request(path, options) {
      this.calls++;
      assert.equal(path, "/api/me");
      assert.equal(options.accountUserId, account.userId);
      if (this.offline) throw new Error("Offline");
      return { user: { id: account.userId }, isPlatformAdmin: this.allowed };
    }
  };
  const service = new ProductDefaults(connected, root, apply);
  return { root, service, connected, account };
}

test("saving defaults applies the saved document and rolls back a failed runtime refresh", async (t) => {
  let applied, broken = false;
  const { service } = await fixture(t, async (text) => {
    assert.equal(await readFile(service.path, "utf8"), text);
    if (broken) throw new Error("Runtime refresh failed");
    applied = text;
  });
  let state = await service.status();
  state = await service.update({ accountUserId: "admin", namespace: "bees", key: "darkThemePreset", value: "night", revision: state.revision });
  state = await service.update({ accountUserId: "admin", namespace: "bees", key: "localModelCatalog",
    value: state.values.bees.localModelCatalog.map((model) => ({ ...model, name: `${model.name} updated` })), revision: state.revision });
  const catalog = state.values.bees.localModelCatalog;
  state = await service.update({ accountUserId: "admin", namespace: "agent-default-model", key: "selection",
    value: { provider: `local-openai-${catalog[0].id}`, model: "active" }, revision: state.revision });
  const entries = composeEntries([[{ insert: [{ id: "agent-default-model", name: "@deepseek-ai/dsh-agent-default-model" }] }], loadOverlayPatches("bees", service.path)]);
  assert.equal(entries.find((row) => row.id === "bees").config.darkThemePreset, "night");
  assert.equal(entries.find((row) => row.id === "agent-default-model").config.provider, `local-openai-${catalog[0].id}`);
  assert.deepEqual(service.catalog, catalog);
  broken = true;
  await assert.rejects(service.update({ accountUserId: "admin", namespace: "bees", key: "colorMode", value: "light", revision: state.revision }), /Runtime refresh failed/);
  assert.equal(await readFile(service.path, "utf8"), applied);
  assert.equal((await service.status()).revision, state.revision);
});

test("runtime refresh updates fresh settings and preserves personal themes and model selection", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bees-defaults-reload-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "profile"), bundle = join(dir, "node_modules/defaults-test");
  await mkdir(bundle, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ dsh: { profile: { bundles: ["defaults-test"] } } }));
  await writeFile(join(bundle, "package.json"), JSON.stringify({ name: "defaults-test", version: "1.0.0", dsh: { bundle: { patch: "defaults.yml" } } }));
  const path = join(bundle, "defaults.yml");
  const plugin = join(root, "preferences.mjs");
  await writeFile(plugin, `import { Config } from ${JSON.stringify(new URL("./index.js", import.meta.url).href)};
export { Config };
export function apply() {}`);
  const modelPlugin = fileURLToPath(import.meta.resolve("@deepseek-ai/dsh-agent-default-model"));
  const defaults = (theme, provider) => JSON.stringify([{ insert: [
    { id: "bees", name: plugin, config: { darkThemePreset: theme, lightThemePreset: "cmyk" } },
    { id: "agent-default-model", name: modelPlugin, config: { provider, model: "active" } }
  ] }]);
  const profile = { dir, home: root, installAnchor: join(dir, "package.json"), patchPath: join(dir, "cordis.patch.yml"), overlays: [] };
  await writeFile(profile.patchPath, "[]\n");
  await writeFile(path, defaults("halloween", "local-openai"));
  const config = join(root, "base.yml");
  await writeFile(config, "[]\n");
  const ctx = await boot("bees-test", config, readProfilePatches("bees-test", profile), (host) => host.provide("profileContext", profile));
  t.after(() => ctx.fiber.dispose());
  const themes = () => [...ctx.loader.entries()].find((entry) => entry.options.id === "bees").fiber.config;
  await refreshProductDefaults(ctx, defaults("business", "local-openai-qwen"), path);
  assert.equal(themes().darkThemePreset.get(), "business");
  assert.equal(themes().lightThemePreset.get(), "cmyk");
  assert.equal(ctx.agentDefaultModel.currentSelection().provider, "local-openai-qwen");
  assert.equal(await readFile(profile.patchPath, "utf8"), "[]\n");
  const personal = JSON.stringify([
    { id: "bees", config: { darkThemePreset: "night", lightThemePreset: "bumblebee" } },
    { id: "agent-default-model", config: { provider: "personal", model: "mine" } }
  ]);
  await writeFile(profile.patchPath, personal);
  await refreshProductDefaults(ctx, defaults("forest", "local-openai-another"), path);
  assert.equal(themes().darkThemePreset.get(), "night");
  assert.equal(themes().lightThemePreset.get(), "bumblebee");
  assert.equal(ctx.agentDefaultModel.currentSelection().provider, "personal");
  assert.equal(await readFile(profile.patchPath, "utf8"), personal);
  const saved = await readFile(path, "utf8");
  await assert.rejects(refreshProductDefaults(ctx, "invalid: [yaml", path));
  assert.equal(await readFile(path, "utf8"), saved);
  assert.equal(ctx.agentDefaultModel.currentSelection().provider, "personal");
});

test("remote admin verification gates reads and every write, including revocation and offline", async (t) => {
  const { service, connected, account } = await fixture(t);
  connected.allowed = false;
  assert.deepEqual(await service.status(), { isPlatformAdmin: false });
  await assert.rejects(service.update({ accountUserId: "admin" }), /administrator/);
  connected.allowed = true;
  const allowed = await service.status();
  assert.equal(allowed.editable, true);
  connected.allowed = false;
  await assert.rejects(service.update({ accountUserId: "admin", namespace: "bees", key: "colorMode", value: "light", revision: allowed.revision }), /administrator/);
  connected.allowed = true; connected.offline = true;
  assert.deepEqual(await service.status(), { isPlatformAdmin: false });
  connected.offline = false; account.enabled = false;
  assert.deepEqual(await service.status(), { isPlatformAdmin: false });
  account.enabled = true;
  const packaged = new ProductDefaults(connected, null);
  assert.equal((await packaged.status()).editable, false);
  await assert.rejects(packaged.update({ accountUserId: "admin" }), /development checkout/);
});

test("saves use only the existing source YAML, preserve other entries, and survive fresh reads", async (t) => {
  const { service, connected, root } = await fixture(t);
  const before = await readFile(service.path, "utf8");
  await writeFile(join(root, "personal.yml"), "themePreset: forest\nlocalModels: [private-model]\n");
  let state = await service.status();
  const catalog = state.values.bees.localModelCatalog;
  const added = { id: "test-model", name: "Test model", fileName: "test.gguf", url: "https://example.com/test.gguf", bytes: 0 };
  state = await service.update({ accountUserId: "admin", namespace: "bees", key: "localModelCatalog", value: [...catalog, added], revision: state.revision });
  state = await service.update({ accountUserId: "admin", namespace: "bees", key: "colorMode", value: "light", revision: state.revision });
  const widgets = state.values.bees.dashboards.map((d) => ({ ...d, widgets: d.widgets.map((w) => ({ ...w, y: w.y + 1 })) }));
  state = await service.update({ accountUserId: "admin", namespace: "bees", key: "dashboards", value: widgets, revision: state.revision });
  const fresh = await new ProductDefaults(connected, root).status();
  assert.equal(fresh.values.bees.localModelCatalog.at(-1).id, "test-model");
  assert.equal(fresh.values.bees.colorMode, "light");
  assert.deepEqual(fresh.values.bees.dashboards, widgets);
  assert.equal(await readFile(join(root, "personal.yml"), "utf8"), "themePreset: forest\nlocalModels: [private-model]\n");
  const after = await readFile(service.path, "utf8");
  assert.ok(after.includes("!!js process.env.BEES_DSH_QUERY_PATH"));
  assert.ok(after.includes("# Provider transport remains in DSH's llm-pi-ai plugin."));
  assert.equal(before.slice(0, before.indexOf("    - id: bees\n")), after.slice(0, after.indexOf("    - id: bees\n")));
});

test("rejects secrets, private paths, invalid layouts, stale saves and removal of the selected model", async (t) => {
  const { service } = await fixture(t);
  let state = await service.status();
  const input = { accountUserId: "admin", namespace: "bees", revision: state.revision };
  for (const [key, value] of [["localModelWantedIds", ["a"]], ["externalLocalAiProfile", { baseURL: "/Users/me" }],
    ["colorMode", "bogus"], ["localModelCatalog", [{ id: "a", name: "A", fileName: "../a.gguf", url: "https://example.com/a.gguf", bytes: 0 }]],
    ["workItemLayout", [{ kind: "metrics", x: 11, y: 0, w: 12, h: 2 }]]]) {
    await assert.rejects(service.update({ ...input, key, value }));
  }
  await assert.rejects(service.update({ ...input, namespace: "llm-pi-ai", key: "providers", value: { openai: { apiKey: "secret" } } }));
  const provider = `local-openai-${state.values.bees.localModelCatalog[0].id}`;
  state = await service.update({ ...input, namespace: "agent-default-model", key: "selection", value: { provider, model: "active" } });
  await assert.rejects(service.update({ ...input, revision: state.revision, key: "localModelCatalog", value: state.values.bees.localModelCatalog.slice(1) }), /another product default/);
  // Both saves must change the revision; writing the current color mode is a valid no-op.
  const results = await Promise.allSettled(["one", "two"].map((suffix) => service.update({ ...input,
    revision: state.revision, key: "themePreset", value: `${state.values.bees.themePreset}-${suffix}` })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(results.find((r) => r.status === "rejected").reason.message, /changed elsewhere/);
});

test("the shipped runtime schemas consume edited defaults and preserve explicit layouts", async (t) => {
  const { service } = await fixture(t);
  let state = await service.status();
  const layout = [
    { kind: "run-status", x: 0, y: 0, w: 12, h: 1 },
    { kind: "conversation", x: 0, y: 1, w: 6, h: 8 },
    { kind: "details", x: 6, y: 1, w: 6, h: 8 },
    { kind: "kanban", x: 0, y: 9, w: 12, h: 4 }
  ];
  state = await service.update({ accountUserId: "admin", namespace: "bees", key: "workItemLayout", value: layout, revision: state.revision });
  const parsed = Config["~standard"].validate(state.values.bees);
  assert.equal(parsed.issues, undefined);
  assert.deepEqual(workItemLayoutFrom(parsed.value.workItemLayout.get()).find((w) => w.kind === "kanban"), layout[3]);
  const subscriptions = SubscriptionConfig["~standard"].validate({ models: ["custom-claude"] });
  assert.equal(subscriptions.issues, undefined);
  assert.deepEqual(subscriptions.value.models.get(), ["custom-claude"]);
});

test("the product catalog is independent of saved settings and is not a writable preference", () => {
  const shipped = loadOverlayPatches("bees", fileURLToPath(shippedPath));
  const defaults = composeEntries([shipped]).find((row) => row.id === "bees").config;
  assert.ok(shippedModelCatalog.length);
  assert.deepEqual(shippedModelCatalog, defaults.localModelCatalog);
  const personal = { localModelWantedIds: [defaults.localModelCatalog[0].id], colorMode: "light" };
  const resolve = (config) => {
    const row = composeEntries([shipped, [{ id: "bees", config }]]).find((row) => row.id === "bees");
    const parsed = Config["~standard"].validate(row.config);
    assert.equal(parsed.issues, undefined);
    return parsed.value;
  };
  const parsed = resolve(personal);
  assert.deepEqual(parsed.localModelWantedIds.get(), personal.localModelWantedIds);
  assert.equal(parsed.colorMode.get(), "light");
  for (const key of ["localModelCatalog", "localModels", "removedLocalModelIds"]) assert.equal(Config.dict[key], undefined);
  resolve({ ...personal, localModelCatalog: [], removedLocalModelIds: personal.localModelWantedIds });
  assert.deepEqual(shippedModelCatalog, defaults.localModelCatalog);
});

function personalForm(value) {
  const listeners = new Set();
  return { writes: [], getSnapshot: () => ({ status: "ready", value }),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    async set(key, next) { value[key] = next; this.writes.push(key); for (const listener of listeners) listener(); }
  };
}
test("existing forms switch scope without copying or overwriting personal models and layouts", async (t) => {
  const { service, connected } = await fixture(t);
  const errors = [];
  const store = new ProductSettings((_path, options) => options ? service.update(JSON.parse(options.body)) : service.status(), (error) => errors.push(error));
  const personal = personalForm({ colorMode: "dark", themePreset: "forest", localModels: [{ id: "private-model" }], dashboards: [] });
  let form = store.scope("bees", personal);
  assert.equal(store.state.isPlatformAdmin, false);
  await store.check();
  assert.equal(store.state.isPlatformAdmin, true);
  await store.toggle(true);
  await assert.rejects(form.set("themePreset", "forest"), /scope changed/);
  errors.length = 0;
  form = store.scope("bees", personal);
  assert.equal(form.getSnapshot().value.themePreset, "halloween");
  await form.set("colorMode", "light");
  assert.deepEqual(personal.writes, []);
  assert.equal(form.getSnapshot().value.colorMode, "light");
  connected.offline = true;
  await assert.rejects(form.set("colorMode", "dark"), /Offline/);
  assert.equal(errors.length, 1);
  assert.deepEqual(personal.writes, []);
  await store.toggle(false);
  await assert.rejects(form.set("colorMode", "dark"), /scope changed/);
  form = store.scope("bees", personal);
  assert.equal(form.getSnapshot().value.themePreset, "forest");
  assert.deepEqual(form.getSnapshot().value.localModels, [{ id: "private-model" }]);
  await form.set("colorMode", "light");
  assert.deepEqual(personal.writes, ["colorMode"]);
  const beforeReset = store.scope("bees", personal);
  store.reset();
  await beforeReset.set("onboarding", { version: 1 });
  assert.equal(personal.writes.at(-1), "onboarding");
});

test("a late remote response cannot re-enable the menu after the account signs out", async () => {
  let resolve;
  const store = new ProductSettings(() => new Promise((r) => { resolve = r; }), () => {});
  const pending = store.check();
  assert.equal(store.state.isPlatformAdmin, false);
  store.reset();
  resolve({ isPlatformAdmin: true, editable: true });
  await pending;
  assert.equal(store.state.isPlatformAdmin, false);
  const enabling = store.toggle(true);
  await new Promise(setImmediate);
  store.reset();
  resolve({ isPlatformAdmin: true, editable: true });
  await enabling;
  assert.equal(store.state.editing, false);
});

test("a model dialog opened before switching modes cannot write after re-enabling product editing", async (t) => {
  const { service } = await fixture(t);
  const store = new ProductSettings((_path, options) => options ? service.update(JSON.parse(options.body)) : service.status(), () => {});
  await store.toggle(true);
  const generation = store.generation;
  await store.toggle(false);
  await store.toggle(true);
  await assert.rejects(store.save("bees-subscriptions", "models", ["late-model"], generation), /no longer active/);
  assert.ok(!store.state.values["bees-subscriptions"].models.includes("late-model"));
});

test("existing local-model delete control edits the shipped catalog without invoking native deletion", async (t) => {
  const { service } = await fixture(t);
  const state = await service.status();
  const catalog = state.values.bees.localModelCatalog;
  const writes = [];
  const preferences = { productDefaults: true, getSnapshot: () => ({ value: { localModelCatalog: catalog } }),
    set: async (key, value) => writes.push({ key, value }) };
  const React = { createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    useEffect: () => {}, useRef: (current) => ({ current }), useMemo: (fn) => fn() };
  let exported;
  const nativeCalls = [];
  const window = { __TAURI__: { core: { invoke: (...args) => { nativeCalls.push(args); } } },
    __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React); } } };
  vm.runInNewContext(await readFile(new URL("../../plugins/local-ai/lib/client.js", import.meta.url), "utf8"), { window, URL });
  const outer = exported.LocalAiSettings({ preferences, confirmAction: async () => true, Button: "button" });
  const child = outer.children.find((node) => typeof node?.type === "function");
  const tree = child.type(child.props);
  const nodes = [];
  const walk = (node) => { if (!node || typeof node !== "object") return; nodes.push(node); node.children?.flat(Infinity).forEach(walk); };
  walk(tree);
  const remove = nodes.find((node) => node.type === "button" && node.children[0] === "Delete");
  assert.equal(remove.props.disabled, false);
  await remove.props.onClick();
  assert.equal(writes[0].key, "localModelCatalog");
  assert.equal(writes[0].value.length, catalog.length - 1);
  assert.deepEqual(nativeCalls, []);
  assert.ok(nodes.filter((node) => node.props?.["data-model-toggle"]).every((node) => node.props.disabled));
});
