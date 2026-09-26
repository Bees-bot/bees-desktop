import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { ProductDefaults } from "./product-defaults.js";
import { ProductSettings } from "../client/product-settings.js";
import { Config } from "./index.js";
import { Config as SubscriptionConfig } from "../../plugins/subscriptions/lib/index.js";
import { workItemLayoutFrom } from "../client/dashboard-model.js";

const shippedPath = new URL("../cordis.patch.yml", import.meta.url);
async function fixture(t) {
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
  const service = new ProductDefaults(connected, root);
  return { root, service, connected, account };
}

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
  const results = await Promise.allSettled(["light", "dark"].map((value) => service.update({ ...input, revision: state.revision, key: "colorMode", value })));
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
  assert.deepEqual(parsed.value.localModelCatalog.get(), state.values.bees.localModelCatalog);
  assert.deepEqual(workItemLayoutFrom(parsed.value.workItemLayout.get()).find((w) => w.kind === "kanban"), layout[3]);
  const subscriptions = SubscriptionConfig["~standard"].validate({ models: ["custom-claude"] });
  assert.equal(subscriptions.issues, undefined);
  assert.deepEqual(subscriptions.value.models.get(), ["custom-claude"]);
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
  assert.deepEqual(form.getSnapshot().value.localModels, []);
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
