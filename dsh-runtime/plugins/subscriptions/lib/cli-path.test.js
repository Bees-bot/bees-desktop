import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { apply, Config } from "./index.js";

async function subscriptions(t, credentials = new Map()) {
  let handler, adapter;
  await apply({
    credentials: {
      resolve: async (key) => credentials.has(key) ? { value: credentials.get(key) } : undefined,
      set: async (key, value) => credentials.set(key, value), unset: async (key) => credentials.delete(key)
    },
    llm: { registerAdapter(_routes, value) { adapter = value; return () => { adapter = null; }; } },
    logger: { warn() {} },
    effect(fn) { const dispose = fn(); t.after(() => dispose?.()); },
    webServer: { register(route) { handler = route.handler; return () => {}; } }
  }, Config({}));
  return {
    credentials, adapter: () => adapter,
    async request(input) {
      let status, body;
      await handler({ method: input ? "POST" : "GET", async *[Symbol.asyncIterator]() { yield JSON.stringify(input); } },
        { writeHead(value) { status = value; }, end(value) { body = JSON.parse(value); } });
      return { status, body };
    }
  };
}

test("a custom Claude executable is validated, persisted, and used for connections and runs", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bees-cli-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "my custom claude");
  await writeFile(path, `#!/bin/sh
case "$1" in
  --version) printf '%s\\n' '2.1.0 (Claude Code)' ;;
  auth) printf '%s\\n' '{"loggedIn":true}' ;;
  *) cat >/dev/null; printf '%s\\n' '{"type":"result","result":"From the chosen executable"}' ;;
esac
`, { mode: 0o755 });
  const app = await subscriptions(t);
  const configured = await app.request({ action: "claude_configure", path: ` ${path} ` });
  assert.equal(configured.status, 200);
  assert.equal(configured.body.path, path);
  assert.equal(configured.body.enabled, true);
  assert.equal((await app.request()).body.claude.path, path);
  assert.equal((await app.request({ action: "claude_test" })).status, 200);

  const restarted = await subscriptions(t, app.credentials);
  const chunks = await Array.fromAsync(restarted.adapter().stream({ model: "default", messages: [{ role: "user", content: "Hello" }] }));
  assert.ok(chunks.some((chunk) => chunk.type === "text-delta" && chunk.text === "From the chosen executable"));

  const before = new Map(app.credentials);
  for (const invalid of [root, join(root, "missing"), "claude --version", process.execPath, 123, "a\u0000b"]) {
    assert.equal((await app.request({ action: "claude_configure", path: invalid })).status, 409);
    assert.deepEqual(app.credentials, before, "invalid selections preserve the working connection");
  }
  await chmod(path, 0o644);
  assert.equal((await app.request({ action: "claude_configure", path })).status, 409);
  assert.deepEqual(app.credentials, before);
  await chmod(path, 0o755);

  const link = join(root, "claude symlink");
  await symlink(path, link);
  await app.request({ action: "claude_toggle", enabled: false });
  assert.equal((await app.request({ action: "claude_configure", path: link, enabled: false })).status, 200);
  assert.equal((await app.request()).body.claude.enabled, false);
  assert.equal(app.adapter(), null);
  assert.equal((await app.request()).body.claude.path, link);

  await app.request({ action: "claude_disconnect" });
  const oldEnv = process.env.BEES_CLAUDE_CLI;
  process.env.BEES_CLAUDE_CLI = path;
  try {
    assert.equal((await app.request({ action: "claude_configure" })).body.path, path, "blank paths retain auto-discovery");
  } finally {
    if (oldEnv === undefined) delete process.env.BEES_CLAUDE_CLI;
    else process.env.BEES_CLAUDE_CLI = oldEnv;
  }
});

test("Claude path controls support typing, browsing, cancellation, errors, and local-only settings", async () => {
  let cursor = 0, client, selected = null, pickerOptions, defaults = null, pendingRead;
  const state = [], dependencies = [], effects = [], calls = [];
  const status = { codex: false, codexModels: [], claude: {
    configured: true, enabled: false, path: "/old/claude", version: "Claude Code", models: ["default"]
  } };
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!dependencies[index] || deps.some((value, i) => value !== dependencies[index][i])) effects.push(fn);
      dependencies[index] = deps;
    }
  };
  vm.runInNewContext(readFileSync(new URL("./client.js", import.meta.url), "utf8"), {
    window: { __ModuleLoader__: { load: ({ factory }) => { client = factory(() => React); } } },
    fetch: async (_url, options) => {
      if (options?.method === "POST") {
        const input = JSON.parse(options.body); calls.push(input);
        if (input.path === "/invalid") return { ok: false, json: async () => ({ error: "Choose a working executable" }) };
        status.claude.path = input.path || "/detected/claude";
      }
      if (options?.method !== "POST") await pendingRead;
      return { ok: true, json: async () => options?.method === "POST" ? { path: status.claude.path } : structuredClone(status) };
    }
  });
  const scope = { getSnapshot: () => ({ value: {} }), subscribe: () => () => {} };
  const render = () => {
    cursor = 0;
    const tree = client.SubscriptionSettings({ modelSettings: scope, preferences: scope, Button: "button", productDefaults: defaults,
      pickFile: async (options) => { pickerOptions = options; return selected; } });
    effects.splice(0).forEach((fn) => fn());
    return tree;
  };
  const nodes = (node) => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(nodes)] : [];
  const text = (node) => typeof node === "string" ? node : node?.children?.map(text).join(" ") ?? "";
  const input = () => nodes(render()).find((node) => node.props?.id === "bees-claude-path");
  const browse = () => nodes(render()).find((node) => node.props?.["aria-label"] === "Browse for Claude Code CLI").props.onClick();
  const submit = async () => {
    nodes(render()).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
    await new Promise(setImmediate);
  };
  render(); await new Promise(setImmediate); render();
  assert.equal(input().props.value, "/old/claude");
  assert.match(text(render()), /no CLI installation/);
  input().props.onChange({ target: { value: "/custom location/claude" } });
  await browse();
  assert.equal(input().props.value, "/custom location/claude", "cancelling the picker retains edits");
  assert.equal(calls.length, 0);
  selected = "/picked/claude";
  await browse();
  assert.equal(pickerOptions.directory, false);
  assert.equal(pickerOptions.multiple, false);
  assert.equal(input().props.value, selected);
  assert.equal(calls.length, 0, "a selection waits for Save path");
  await submit();
  assert.deepEqual(calls.pop(), { action: "claude_configure", path: selected, enabled: false });
  input().props.onChange({ target: { value: "/invalid" } });
  await submit();
  assert.match(text(render()), /Choose a working executable/);
  assert.equal(input().props.value, "/invalid", "failed validation retains the draft for correction");
  assert.equal(status.claude.path, selected);
  input().props.onChange({ target: { value: "" } });
  await submit();
  assert.equal(input().props.value, "/detected/claude");
  defaults = { claudeModels: ["default"] };
  assert.equal(input(), undefined, "machine paths are hidden while editing product defaults");

  defaults = null; state.length = 0; dependencies.length = 0;
  let finishRead;
  pendingRead = new Promise((resolve) => { finishRead = resolve; });
  render();
  input().props.onChange({ target: { value: "/typed/while-loading/claude" } });
  finishRead(); await new Promise(setImmediate);
  assert.equal(input().props.value, "/typed/while-loading/claude", "a slow status response never overwrites the user's draft");
});
