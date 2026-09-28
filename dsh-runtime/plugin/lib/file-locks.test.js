import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { createScope } from "@deepseek-ai/dsh-scope";
import * as nativeToolsPlugin from "@deepseek-ai/dsh-tool-fs";
import * as observationPolicy from "@deepseek-ai/dsh-fs-observation-policy";
import { apply as nativeFileTools, Config } from "@deepseek-ai/dsh-tool-fs";
import { FileLocks } from "./file-locks.js";
import { commitFile, mountFileLocks } from "./file-lock-tools.js";
import { mountToolDiscovery } from "./tool-discovery.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "bees-file-locks-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ctx = new Context();
  const fiber = await ctx.plugin(LocalFileSystem, { cwd: root, diffBasisMaxBytes: 1_000_000 });
  t.after(() => fiber.dispose());
  const locks = new FileLocks(join(root, ".locks"));
  t.after(async () => { for (const owner of locks.owners.keys()) await locks.releaseOwner(owner).catch(() => {}); });
  return { root, locks, fs: ctx.fs, ctx };
}

function agent(root, fs, locks) {
  const owner = { session: { header: { cwd: root } } };
  const tools = new Map(), hooks = new Map();
  const ctx = {
    fs, tools: { register: (tool) => tools.set(tool.name, tool) },
    sandboxPolicy: { resolve: () => ({ mode: "read-only" }) },
    get: (name) => ctx[name],
    on: (name, fn) => hooks.set(name, fn),
    emit: (name, ...args) => hooks.get(name)?.(...args),
    waterfall: async (_name, _target, _exec, next) => next(),
    inject() {}, systemPrompt: { section() {}, getSectionOrder: () => 1 }
  };
  nativeFileTools(ctx, Config({}));
  mountFileLocks(ctx, owner, locks);
  const call = (name, args, signal = new AbortController().signal) => {
    const exec = { agent: owner, name, arguments: args, signal };
    return hooks.get("tools/execute")(exec, () => tools.get(name).execute(args, exec));
  };
  return { owner, ctx, call, lock: async (paths) => JSON.parse((await call("bees_acquire_file_locks", { paths })).result),
    unlock: (token) => call("bees_release_file_locks", { token }) };
}

test("parallel agents preserve every update across multiple files", { timeout: 15_000 }, async (t) => {
  const { root, fs, locks } = await fixture(t);
  const paths = [join(root, "one.txt"), join(root, "two.txt")];
  for (const path of paths) await writeFile(path, "");
  await Promise.all(Array.from({ length: 12 }, async (_, index) => {
    const a = agent(root, fs, locks);
    const { token } = await a.lock(index % 2 ? paths : [...paths].reverse());
    try {
      for (const path of paths) {
        await a.call("read", { file_path: path });
        const before = await readFile(path, "utf8");
        await delay(index % 3);
        await a.call("write", { file_path: path, content: `${before}${index}\n` });
      }
    } finally { await a.unlock(token); }
  }));
  const values = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  assert.equal(values[0], values[1]);
  assert.deepEqual(values[0].trim().split("\n").map(Number).sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i));
  assert.equal(locks.owners.size, 0);
});

test("five single-call appends preserve every contribution and release their locks", async (t) => {
  const { root, fs, locks } = await fixture(t);
  const path = join(root, "counter.txt");
  const words = ["first", "second", "third", "fourth", "fifth"];
  await Promise.all(words.map(async (word) => {
    const a = agent(root, fs, locks);
    await a.call("bees_append_file", { file_path: path, content: word + "\n" });
    assert(!locks.owners.has(a.owner));
  }));
  assert.deepEqual((await readFile(path, "utf8")).trim().split("\n").sort(), [...words].sort());
  assert.equal(locks.owners.size, 0);
  const a = agent(root, fs, locks);
  await a.lock([path]);
  await a.call("bees_append_file", { file_path: path, content: "sixth\n" });
  assert(!locks.owners.has(a.owner), "an existing exclusive lock is reused and released");
  const before = await readFile(path, "utf8");
  const controller = new AbortController();
  fs.internals.inspectTemp = async () => controller.abort();
  await assert.rejects(a.call("bees_append_file", { file_path: path, content: "cancelled\n" }, controller.signal), /abort/i);
  assert.equal(await readFile(path, "utf8"), before);
  assert.equal(locks.owners.size, 0);
  const fenced = Object.create(fs);
  Object.defineProperty(fenced, "sandboxMode", { value: "read-only" });
  fenced.checkedTarget = async () => { throw new Error("sandbox denied"); };
  await assert.rejects(agent(root, fenced, locks).call("bees_append_file", { file_path: path, content: "denied" }), /sandbox denied/);
  assert.equal(await readFile(path, "utf8"), before);
  assert.equal(locks.owners.size, 0);
});

test("real tool dispatch and observation policy route parent and child locks independently", async (t) => {
  const { root, locks, ctx } = await fixture(t);
  for (const plugin of [SystemPrompt, ToolRuntime, nativeToolsPlugin, observationPolicy]) {
    const fiber = await ctx.plugin(plugin, {});
    t.after(() => fiber.dispose());
  }
  const parent = { session: { header: { cwd: root } } }, child = { session: { header: { cwd: root } } };
  // Agent-loop scopes inject tools/systemPrompt, but not the filesystem service.
  const mounted = await ctx.plugin({ inject: ["tools", "systemPrompt"], apply(base) {
    for (const owner of [parent, child]) {
      const scope = createScope(base, owner, owner === child ? { parent } : undefined);
      mountToolDiscovery(scope.ctx, { resolve: async () => undefined });
      mountFileLocks(scope.ctx, owner, locks, ctx.fs);
    }
  } });
  t.after(() => mounted.dispose());
  const call = (agent, name, args) => ctx.tools.execute({ agent, name, arguments: args,
    callId: `${name}-${Math.random()}`, signal: new AbortController().signal });
  const path = join(root, "scoped.txt");
  for (const owner of [parent, child]) {
    const assembly = await ctx.systemPrompt.assemble({ scope: owner, signal: new AbortController().signal });
    assert(assembly.tools.some(({ name }) => name === "bees_append_file"), "single-call append must be visible without discovery");
  }
  await writeFile(path, "first");
  assert.equal((await call(parent, "write", { file_path: path, content: "unlocked" })).isError, true);
  for (const owner of [parent, child]) {
    const acquired = await call(owner, "bees_acquire_file_locks", { paths: [path] });
    assert(!acquired.isError, JSON.stringify(acquired));
    const { token } = JSON.parse(acquired.content[0].text);
    assert(!(await call(owner, "read", { file_path: path })).isError);
    const written = await call(owner, "write", { file_path: path, content: `${await readFile(path, "utf8")} next` });
    assert(!written.isError, JSON.stringify(written));
    assert(!(await call(owner, "bees_release_file_locks", { token })).isError);
  }
  assert.equal(await readFile(path, "utf8"), "first next next");
});

test("ownership, fresh reads, canonical aliases, independent files and cancellation", async (t) => {
  const { root, fs, locks } = await fixture(t);
  const a = agent(root, fs, locks), b = agent(root, fs, locks);
  const path = join(root, "file.txt"), alias = join(root, "alias.txt");
  await writeFile(path, "original");
  await symlink(path, alias);
  await a.call("read", { file_path: path });
  await assert.rejects(a.call("write", { file_path: path, content: "unlocked" }), /Acquire/);
  const { token } = await a.lock([alias, path]);
  assert.equal(locks.owners.get(a.owner).paths.length, 1);
  await assert.rejects(a.call("write", { file_path: path, content: "stale" }), /Read the current file/);
  await assert.rejects(a.lock([join(root, "another")]), /Release your current/);
  await assert.rejects(b.unlock(token), /does not belong/);
  const independent = await b.lock([join(root, "independent")]);
  await b.call("write", { file_path: "independent", content: "allowed" });
  await b.unlock(independent.token);
  const controller = new AbortController();
  const waiting = b.call("bees_acquire_file_locks", { paths: [path] }, controller.signal);
  const rejected = assert.rejects(waiting, /abort/i);
  await delay(30); controller.abort(); await rejected;
  assert.equal(locks.owners.has(b.owner), false);
  await a.call("read", { file_path: alias });
  await a.call("edit", { file_path: path, old_string: "original", new_string: "updated" });
  assert.equal(await readFile(alias, "utf8"), "updated");
  await a.unlock(token);
  await assert.rejects(a.unlock(token), /does not belong/);
  const next = await b.lock([path]);
  await assert.rejects(b.call("edit", { file_path: path, old_string: "updated", new_string: "stale" }), /Read the current file/);
  await b.unlock(next.token);
});

test("release and lifecycle cleanup wait for an actual in-flight write", async (t) => {
  const { root, fs, locks } = await fixture(t);
  const a = agent(root, fs, locks), b = agent(root, fs, locks);
  const path = join(root, "file");
  const { token } = await a.lock([path]);
  const started = Promise.withResolvers(), finish = Promise.withResolvers();
  fs.internals.inspectTemp = async () => { started.resolve(); await finish.promise; };
  const writing = a.call("write", { file_path: path, content: "complete" });
  await started.promise;
  let released = false, acquired = false;
  const releasing = a.unlock(token).then(() => { released = true; });
  const acquiring = b.lock([path]).then((value) => { acquired = true; return value; });
  await delay(40);
  assert.equal(released, false); assert.equal(acquired, false);
  finish.resolve(); await writing; await releasing; await acquiring;
  assert.equal(await readFile(path, "utf8"), "complete");
  await locks.releaseOwner(b.owner);
  assert.equal(locks.owners.size, 0);
});

test("a parent must release its file locks before delegating or waiting", async (t) => {
  const { root, fs, locks } = await fixture(t);
  const parent = agent(root, fs, locks), child = agent(root, fs, locks);
  const path = join(root, "counter.txt");
  const { token } = await parent.lock([path]);
  await parent.call("write", { file_path: path, content: "" });
  let calls = 0;
  const handoffs = ["bees_delegate_work", "bees_revise_work", "bees_resolve_failed_work", "bees_wait_for_peers",
    "ask_user_question", "bees_ask_team", "bees_request_work_review", "bees_publish_outputs", "bees_submit_stage_result"];
  for (const name of handoffs) {
    const tool = { name, execute: () => { calls++; return {}; } };
    parent.ctx.tools.register(tool);
    child.ctx.tools.register(tool);
    await assert.rejects(parent.call(name, {}), (error) =>
      error.message.includes("bees_release_file_locks") && error.message.includes(token));
  }
  assert.equal(calls, 0); // No children or human waits were started while the parent held the lock.
  await child.call("bees_wait_for_peers", {}); // Only the calling agent's locks matter.
  assert.equal(calls, 1);
  assert.equal(locks.owners.get(parent.owner).token, token); // Never evict a live writer.
  await parent.unlock(token);
  parent.ctx.tools.register({ name: "bees_delegate_work", execute: async () => {
    const locked = await child.lock([path]);
    await child.call("read", { file_path: path });
    await child.call("write", { file_path: path, content: "first\n" });
    await child.unlock(locked.token);
  } });
  await parent.call("bees_delegate_work", {});
  assert.equal(await readFile(path, "utf8"), "first\n");
  assert.equal(locks.owners.size, 0);
});

test("native text write cancellation preserves the old file and cleans staging", async (t) => {
  const { root, fs, locks } = await fixture(t);
  const a = agent(root, fs, locks), path = join(root, "file.txt");
  await writeFile(path, "old");
  await a.lock([path]); await a.call("read", { file_path: path });
  const controller = new AbortController();
  fs.internals.inspectTemp = async () => { assert.equal(await readFile(path, "utf8"), "old"); controller.abort(); };
  await assert.rejects(a.call("write", { file_path: path, content: "new" }, controller.signal), /abort/i);
  assert.equal(await readFile(path, "utf8"), "old");
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith(".tmpdir")), []);
});

test("binary publication is atomic, preserves modes, and checks permissions", async (t) => {
  const { root, fs, locks } = await fixture(t);
  const source = join(root, "staged.bin"), target = join(root, "final.bin");
  const bytes = Buffer.from([0, 255, 1, 128, 0, 42]);
  await writeFile(source, bytes); await writeFile(target, "old", { mode: 0o640 });
  const controller = new AbortController();
  await assert.rejects(commitFile(source, target, controller.signal, async () => {
    assert.equal(await readFile(target, "utf8"), "old"); controller.abort();
  }), /abort/i);
  assert.equal(await readFile(target, "utf8"), "old");
  assert.deepEqual((await readdir(root)).filter((name) => name.includes(".bees-")), []);
  const a = agent(root, fs, locks);
  await assert.rejects(a.call("bees_commit_file", { file_path: target, source_path: source }), /Acquire/);
  await a.lock([target]);
  await a.call("bees_commit_file", { file_path: target, source_path: source });
  assert.deepEqual(await readFile(target), bytes);
  assert.equal((await stat(target)).mode & 0o777, 0o640);
  assert.deepEqual(await readFile(source), bytes);
  // The pinned sandbox provider's fence must still run before this host-side operation.
  const fenced = Object.create(fs);
  Object.defineProperty(fenced, "sandboxMode", { value: "read-only" });
  fenced.checkedTarget = async () => { throw new Error("sandbox denied"); };
  const b = agent(root, fenced, locks);
  b.ctx.sandboxPolicy = { resolve: () => ({ mode: "read-only" }) };
  await assert.rejects(b.call("bees_commit_file", { file_path: target, source_path: source }), /sandbox denied/);
});

test("a killed process leaves the old destination intact and its locks recover", { timeout: 10_000 }, async (t) => {
  const { root, locks } = await fixture(t);
  const path = join(root, "file.bin"), source = join(root, "source.bin");
  await writeFile(path, "old"); await writeFile(source, "complete new file");
  const script = `
    import { FileLocks } from ${JSON.stringify(new URL("./file-locks.js", import.meta.url).href)};
    import { commitFile } from ${JSON.stringify(new URL("./file-lock-tools.js", import.meta.url).href)};
    const locks = new FileLocks(${JSON.stringify(locks.directory)});
    await locks.acquire("child", [${JSON.stringify(path)}]);
    await commitFile(${JSON.stringify(source)}, ${JSON.stringify(path)}, undefined, async () => {
      process.stdout.write("staged");
      await new Promise(() => { setInterval(() => {}, 1000); });
    });`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  await once(child.stdout, "data");
  assert.equal(await readFile(path, "utf8"), "old");
  const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
  const { token } = await locks.acquire("parent", [path]);
  await commitFile(source, path);
  await locks.release("parent", token);
  assert.equal(await readFile(path, "utf8"), "complete new file");
});
