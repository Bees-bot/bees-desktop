import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import test from "node:test";
import vm from "node:vm";

function loadClient(React = {}, bindings = {}) {
  let client;
  vm.runInNewContext(readFileSync(new URL("./client.js", import.meta.url), "utf8"), {
    URL, crypto: webcrypto,
    ...bindings,
    window: { ...bindings.window, __ModuleLoader__: { load: ({ factory }) => { client = factory(() => React); } } }
  });
  return client;
}
const { recommendedLocalModel } = loadClient();
const GiB = 1024 ** 3;
const hardware = { totalMemory: 32 * GiB, availableMemory: 9 * GiB, availableDisk: 79.1 * GiB };
const qwen = { id: "qwen3-4b", name: "Qwen3 4B", bytes: 2497281120, runsProcesses: false };

test("hardware suggestions include Qwen 4B regardless of the process capability flag", () => {
  assert.equal(recommendedLocalModel(hardware, [qwen], {}), qwen);
  const custom = { ...qwen, runsProcesses: undefined };
  assert.equal(recommendedLocalModel(hardware, [custom], {}), custom);
  const tooLarge = { id: "large", bytes: 30 * GiB, runsProcesses: true };
  assert.equal(recommendedLocalModel(hardware, [tooLarge, qwen], {}), qwen);
});

test("temporary memory pressure does not reject a model that fits the installed RAM", () => {
  for (const availableMemory of [0, 3 * GiB, undefined])
    assert.equal(recommendedLocalModel({ ...hardware, availableMemory }, [qwen], {}), qwen);
});

test("suggestions respect installed RAM and the space needed for a new download", () => {
  assert.equal(recommendedLocalModel({ ...hardware, totalMemory: 4 * GiB }, [qwen], {}), null);
  const lowDisk = { ...hardware, availableDisk: GiB };
  assert.equal(recommendedLocalModel(lowDisk, [qwen], {}), null);
  assert.equal(recommendedLocalModel(lowDisk, [qwen], { [qwen.id]: { state: "ready" } }), qwen);
  assert.equal(recommendedLocalModel({ ...hardware, availableDisk: null }, [qwen], {}), null);
  assert.equal(recommendedLocalModel(null, [qwen], {}), null);
});

test("an already running model stays usable even when no resources remain for another model", () => {
  const statuses = { [qwen.id]: { running: true, state: "running" } };
  assert.equal(recommendedLocalModel({ ...hardware, availableMemory: 0, availableDisk: 0 }, [qwen], statuses), qwen);
  assert.equal(recommendedLocalModel(null, [qwen], statuses), qwen);
});

test("automatic startup waits for the product catalog and restores personal models too", async () => {
  const effects = [], calls = [], started = { current: false };
  const React = { useRef: () => started, useState: (initial) => [initial(), () => {}],
    useEffect: (effect) => effects.push(effect) };
  const client = loadClient(React, { window: { __TAURI__: { core: { invoke: async (command, args) => {
    calls.push([command, args]);
    if (command === "local_model_status") return { running: true };
    if (command === "local_model_connection") return { baseUrl: "http://127.0.0.1:1234/v1", contextWindow: 8192 };
  } } } } });
  const personal = { id: "user-custom", name: "Custom", fileName: "custom.gguf", url: "https://example.com/custom.gguf", bytes: 0 };
  const preferences = { subscribe: () => () => {}, getSnapshot: () => ({ status: "ready", value: {
    localModelWantedIds: [qwen.id, personal.id], localModels: [personal], localModelCatalog: [], removedLocalModelIds: [qwen.id]
  } }) };
  const errors = [];
  const props = { preferences, onError: (error) => errors.push(error),
    modelSettings: { getSnapshot: () => ({ value: {} }), set: async () => {} } };
  client.LocalAiController(props);
  effects.splice(0).forEach((effect) => effect());
  assert.equal(started.current, false);
  assert.equal(calls.length, 0);
  client.LocalAiController({ ...props, catalog: [qwen] });
  effects.splice(0).forEach((effect) => effect());
  await new Promise(setImmediate);
  assert.deepEqual(calls.filter(([command]) => command === "start_local_model").map(([, args]) => args.spec.id), [qwen.id, personal.id]);
  assert.deepEqual(errors, []);
});

test("Settings suggests Qwen under memory pressure and refreshes its advisory without reopening", async () => {
  let cursor = 0, snapshot = { ...hardware, availableMemory: 0 };
  let installed = true, running = false;
  const state = [], effects = [], timers = new Set();
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useMemo: (fn) => fn(), useEffect: (fn) => effects.push(fn),
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    }
  };
  const client = loadClient(React, {
    setInterval: (fn) => { timers.add(fn); return fn; }, clearInterval: (fn) => timers.delete(fn),
    window: { __TAURI__: { core: { invoke: async (command) => {
      if (command === "local_model_hardware") return snapshot;
      if (command === "delete_local_model") { installed = false; return; }
      if (command === "ensure_local_model") { installed = true; return; }
      if (command === "start_local_model") { running = true; return; }
      if (command === "stop_local_model") { running = false; return; }
      if (command === "cancel_local_model_download") return;
      if (command === "local_model_connection") return { baseUrl: "http://127.0.0.1:1234/v1", contextWindow: 8192 };
      assert.equal(command, "local_model_status");
      return { state: running ? "running" : installed ? "ready" : "missing", running,
        totalBytes: qwen.bytes, downloadedBytes: installed ? qwen.bytes : 0 };
    } }, event: { listen: async () => () => {} } } }
  });
  const value = { localModelCatalog: [], removedLocalModelIds: [qwen.id], localModels: [] };
  const preferences = { getSnapshot: () => ({ status: "ready", value }), subscribe: () => () => {},
    set: async (key, next) => { assert.equal(key, "localModelWantedIds"); value[key] = next; } };
  const modelSettings = { getSnapshot: () => ({ value: { providers: {} } }),
    set: async (key) => assert.equal(key, "providers") };
  const outer = client.LocalAiSettings({ preferences, modelSettings, catalog: [qwen],
    confirmAction: async () => true, Button: "button" });
  const models = outer.children.find((node) => typeof node?.type === "function");
  const render = () => { cursor = 0; return models.type(models.props); };
  const text = (node) => typeof node === "string" ? node : node?.children?.map(text).join(" ") ?? "";
  const nodes = (node) => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(nodes)] : [];
  const toggle = (kind) => nodes(render()).find((node) => node.props?.["data-model-toggle"] === kind);
  render();
  const dispose = effects.splice(0).map((effect) => effect());
  await new Promise(setImmediate);
  try {
    const tree = render();
    assert.match(text(tree), /Suggested for this computer: Qwen3 4B/);
    assert.match(text(tree), /Available memory is low/);
    assert.match(text(tree), /Add a model/);
    assert.equal(nodes(tree).filter((node) => node.type === "button" && text(node) === "Delete").length, 0);
    const start = tree.children[0].children.find((node) => node?.type === "button");
    assert.equal(start.props.disabled, false);
    assert.equal(text(start), "Use installed model");

    snapshot = hardware;
    for (const refresh of timers) refresh();
    await new Promise(setImmediate);
    const refreshed = text(render());
    assert.match(refreshed, /9\.0 GB estimated available/);
    assert.doesNotMatch(refreshed, /Available memory is low|No automatic suggestion/);

    await toggle("run").props.onChange({ target: { checked: true } });
    assert.equal(running, true);
    await toggle("run").props.onChange({ target: { checked: false } });
    assert.equal(running, false);
    await toggle("download").props.onChange({ target: { checked: false } });
    assert.equal(installed, false);
    assert.equal(toggle("download").props.checked, false);
    assert.equal(toggle("run").props.checked, false);
    assert.equal(nodes(render()).filter((node) => node.props?.["data-model-id"] === qwen.id).length, 1);
  } finally { for (const cleanup of dispose) cleanup?.(); }
  assert.equal(timers.size, 0);
});

test("users can add, download, run and delete personal models without editing defaults", async () => {
  let cursor = 0;
  const state = [], effects = [], listeners = new Set(), calls = [], writes = [], answers = [];
  const installed = new Set(), running = new Set([qwen.id]);
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useEffect: (fn) => effects.push(fn),
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    }
  };
  const client = loadClient(React, {
    setInterval: () => 0, clearInterval: () => {},
    window: { __TAURI__: { core: { invoke: async (command, args) => {
      calls.push([command, args]);
      const id = args?.spec?.id;
      if (command === "local_model_hardware") return hardware;
      if (command === "ensure_local_model") installed.add(id);
      if (command === "start_local_model") running.add(id);
      if (command === "stop_local_model") running.delete(args.modelId);
      if (command === "delete_local_model") { installed.delete(id); running.delete(id); }
      if (command === "local_model_status") return { running: running.has(id), state: installed.has(id) ? "ready" : "missing" };
      if (command === "local_model_connection") return {
        baseUrl: `http://127.0.0.1:${args?.modelId === qwen.id ? 1234 : 1235}/v1`, contextWindow: 8192
      };
    } }, event: { listen: async () => () => {} } } }
  });
  const value = { localModels: [], localModelWantedIds: [] };
  const preferences = { getSnapshot: () => ({ status: "ready", value }),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    set: async (key, next) => { writes.push(key); value[key] = next; for (const fn of listeners) fn(); } };
  const modelValue = { providers: {} };
  const modelSettings = { getSnapshot: () => ({ value: modelValue }), set: async (key, next) => { modelValue[key] = next; } };
  const catalog = [{ ...qwen, fileName: "shared.gguf" }];
  const outer = client.LocalAiSettings({ preferences, modelSettings, catalog,
    ask: async () => answers.shift(), confirmAction: async () => true, Button: "button" });
  const models = outer.children.find((node) => typeof node?.type === "function");
  const render = () => { cursor = 0; return models.type(models.props); };
  const nodes = (node) => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(nodes)] : [];
  const text = (node) => typeof node === "string" ? node : node?.children?.map(text).join(" ") ?? "";
  const add = () => nodes(render()).find((node) => node.type === "button" && text(node) === "Add a model").props.onClick();
  const row = (id) => nodes(render()).find((node) => node.props?.["data-model-id"] === id);
  const toggle = (id, kind) => nodes(row(id)).find((node) => node.props?.["data-model-toggle"] === kind);
  const remove = (id) => nodes(row(id)).find((node) => node.type === "button" && text(node) === "Delete");
  render();
  const cleanup = effects.splice(0).map((fn) => fn());
  await new Promise(setImmediate);
  try {
    for (const invalid of ["http://example.com/model.gguf", "https://example.com/model.txt", "https://example.com/a%2Fb.gguf"]) {
      answers.push("Custom", invalid);
      await add();
      assert.equal(value.localModels.length, 0);
      assert.match(text(render()), /https:\/\/ model link|directly to a \.gguf file/);
    }
    answers.push(null);
    await add();
    assert.deepEqual(writes, []);

    answers.push(" Personal model ", "https://example.com/shared.gguf");
    await add();
    const personal = value.localModels[0];
    assert.equal(personal.name, "Personal model");
    // Downloaded bytes must never overwrite a default with the same remote filename.
    assert.notEqual(personal.fileName, catalog[0].fileName);
    assert.match(personal.fileName, /^[a-z0-9-]+\.gguf$/);
    assert.match(text(row(personal.id)), /Personal/);
    assert.equal(remove(qwen.id), undefined);

    await toggle(personal.id, "download").props.onChange({ target: { checked: true } });
    assert.ok(installed.has(personal.id));
    await toggle(personal.id, "run").props.onChange({ target: { checked: true } });
    assert.ok(running.has(personal.id));
    const provider = `local-openai-${personal.id}`;
    assert.equal(modelValue.providers[provider].models[0].name, personal.name);
    assert.ok(modelValue.providers["local-openai-qwen3-4b"]);

    for (const selected of [provider, "local-openai"]) {
      models.props.systemDefault = { provider: selected, model: "active" };
      assert.equal(remove(personal.id).props.disabled, true);
      await remove(personal.id).props.onClick();
      assert.ok(running.has(personal.id));
    }
    models.props.systemDefault = { provider: "local-openai-qwen3-4b", model: "active" };
    await remove(personal.id).props.onClick();
    assert.equal(value.localModels.length, 0);
    assert.equal(value.localModelWantedIds.length, 0);
    assert.equal(installed.has(personal.id), false);
    assert.equal(running.has(personal.id), false);
    assert.equal(modelValue.providers[provider], undefined);
    assert.ok(modelValue.providers["local-openai-qwen3-4b"]);
    assert.equal(row(personal.id), undefined);
    assert.equal(catalog.length, 1);
    assert.ok(writes.every((key) => ["localModels", "localModelWantedIds"].includes(key)));
    assert.equal(calls.filter(([command]) => command === "delete_local_model").length, 1);
  } finally { for (const fn of cleanup) fn?.(); }
});
