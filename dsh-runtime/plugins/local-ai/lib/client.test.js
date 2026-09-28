import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadClient(React = {}, bindings = {}) {
  let client;
  vm.runInNewContext(readFileSync(new URL("./client.js", import.meta.url), "utf8"), {
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

test("automatic startup waits for the product catalog and ignores saved catalog overrides", async () => {
  const effects = [], calls = [], started = { current: false };
  const React = { useRef: () => started, useState: (initial) => [initial(), () => {}],
    useEffect: (effect) => effects.push(effect) };
  const client = loadClient(React, { window: { __TAURI__: { core: { invoke: async (command, args) => {
    calls.push([command, args]);
    if (command === "local_model_status") return { running: true };
    if (command === "local_model_connection") return { baseUrl: "http://127.0.0.1:1234/v1", contextWindow: 8192 };
  } } } } });
  const preferences = { subscribe: () => () => {}, getSnapshot: () => ({ status: "ready", value: {
    localModelWantedIds: [qwen.id], localModelCatalog: [], removedLocalModelIds: [qwen.id]
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
  assert.deepEqual(calls.filter(([command]) => command === "start_local_model").map(([, args]) => args.spec.id), [qwen.id]);
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
  const value = { localModelCatalog: [], removedLocalModelIds: [qwen.id], localModels: [{ id: "old-custom" }] };
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
    assert.doesNotMatch(text(tree), /Add a model|Delete|old-custom/);
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
