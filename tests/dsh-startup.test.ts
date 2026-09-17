import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
// @ts-expect-error Runtime diagnostics are plain JavaScript.
import { observePlugins, step } from "../dsh-runtime/plugin/lib/startup.js";
// @ts-expect-error Installation patches are plain JavaScript.
import { bootTimings, loaderTimings, profileTimings, timeDshStartup } from "../scripts/time-dsh-startup.mjs";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const { Context } = require("@deepseek-ai/cordis");
const temporary: string[] = [];
function logfile() {
  const directory = mkdtempSync(join(tmpdir(), "bees-startup-test-"));
  temporary.push(directory);
  const path = join(directory, "startup.log");
  vi.stubEnv("BEES_STARTUP_LOG", path);
  return path;
}
const events = (path: string) => readFileSync(path, "utf8").trim().split("\n")
  .map(line => JSON.parse(line.replace(/^\[bees-startup\] /, "")));
afterEach(() => { vi.unstubAllEnvs(); temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });

it("preserves sync/async results and errors, without logging error contents or failing on log I/O", async () => {
  const path = logfile();
  const value = {};
  const failure = new Error("private-token-must-not-be-logged");
  expect(step("sync", () => value)).toBe(value);
  expect(await step("async", () => Promise.resolve(value))).toBe(value);
  expect(() => step("sync-error", () => { throw failure; })).toThrow(failure);
  await expect(step("async-error", () => Promise.reject(failure))).rejects.toBe(failure);
  const lines = events(path);
  expect(lines.map(({ phase, event }) => [phase, event])).toEqual([
    ["sync", "start"], ["sync", "done"], ["async", "start"], ["async", "done"],
    ["sync-error", "start"], ["sync-error", "failed"], ["async-error", "start"], ["async-error", "failed"]
  ]);
  expect(lines.filter(row => row.event !== "start").every(row => row.durationMs >= 0)).toBe(true);
  expect(readFileSync(path, "utf8")).not.toContain(failure.message);
  vi.stubEnv("BEES_STARTUP_LOG", join(path, "missing", "startup.log"));
  expect(step("unwritable", () => value)).toBe(value);
});

it("times real Cordis dependency waits and activation, then detaches the startup observer", async () => {
  const path = logfile();
  const ctx = new Context();
  const stop = observePlugins(ctx);
  try {
    const consumer = ctx.plugin({ name: "timed-consumer", inject: ["startupDependency"],
      async apply() { await new Promise(resolve => setTimeout(resolve, 5)); } });
    const provider = ctx.plugin({ name: "timed-provider", apply(inner: any) { inner.provide("startupDependency", {}); } });
    await provider;
    await consumer;
    const rows = events(path);
    for (const prefix of ["plugin.wait:timed-consumer#", "plugin.init:timed-consumer#"])
      expect(rows.some(row => row.phase.startsWith(prefix) && row.event === "done")).toBe(true);
    stop();
    const count = events(path).length;
    await ctx.plugin({ name: "after-boot", apply() {} });
    expect(events(path)).toHaveLength(count);
  } finally { stop(); await ctx.fiber.dispose(); }
});

it("reapplies checked instrumentation to the pinned DSH packages and boots the CLI wrapper", () => {
  const root = new URL("../dsh-runtime/node_modules/@deepseek-ai/", import.meta.url);
  const profileDirectory = new URL("dsh/lib/", root);
  const profile = readdirSync(profileDirectory).filter(name => name.startsWith("profile-boot-"))
    .map(name => readFileSync(new URL(name, profileDirectory), "utf8"))
    .find(source => source.includes("async function runProfile(options)"))!;
  for (const [source, patches] of [
    [readFileSync(new URL("dsh-app-boot/lib/index.js", root), "utf8"), bootTimings],
    [readFileSync(new URL("cordis-plugin-loader/lib/index.js", root), "utf8"), loaderTimings],
    [profile, profileTimings]
  ] as Array<[string, Array<[string, string]>]>) {
    const original = patches.reduce((text, [before, after]) => text.replace(after, before), source);
    const patched = timeDshStartup(original, patches);
    expect(timeDshStartup(patched, patches)).toBe(patched);
    expect(() => timeDshStartup("upstream changed", patches)).toThrow("no longer matches");
  }
  const path = logfile();
  const output = execFileSync(process.execPath, [new URL("../dsh-runtime/start.mjs", import.meta.url).pathname, "--help"], {
    encoding: "utf8", env: { ...process.env, BEES_STARTUP_LOG: path }, timeout: 30_000
  });
  expect(output).toContain("boot a DeepSeek Harness profile");
  expect(events(path).some(row => row.phase === "dsh.cli.import" && row.event === "done")).toBe(true);
}, 35_000);
