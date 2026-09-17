import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it, vi } from "vitest";
// @ts-expect-error Installation patch is plain JavaScript.
import { batchDshClientModules } from "../scripts/batch-dsh-client-modules.mjs";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const { Context } = require("@deepseek-ai/cordis");
const { ClientModuleRegistry } = require("@deepseek-ai/dsh-client-modules");

it.each([true, false])("batches boot bundles while preserving early reads and live updates (appReady: %s)", async (withReady) => {
  const directory = mkdtempSync(join(tmpdir(), "bees-client-startup-"));
  const ctx = new Context();
  const entries: any[] = [];
  let ready!: () => void;
  const unsubscribe = vi.fn();
  ctx.provide("loader", { entries: () => entries });
  ctx.provide("webServer", { register: () => () => {} });
  if (withReady) ctx.provide("appReady", { onReady(callback: () => void) { ready = callback; return unsubscribe; } });
  const registry = new ClientModuleRegistry(ctx);
  const compose = vi.spyOn(registry, "compose");
  const changed = vi.fn(() => registry.graph()); // HMR reads the graph on notification.
  registry.onGraphChanged(changed);
  const add = async (id: string) => {
    const folder = join(directory, id);
    mkdirSync(folder);
    writeFileSync(join(folder, "package.json"), JSON.stringify({ name: id, type: "module",
      exports: { ".": "./index.js", "./client": "./client.js" }, dsh: { client: { platform: "web" } } }));
    writeFileSync(join(folder, "index.js"), "export default {};");
    writeFileSync(join(folder, "client.js"), `globalThis.${id} = 1;\n`);
    const entry = { options: { name: join(folder, "index.js") }, fiber: {},
      parent: { tree: { ctx: { baseUrl: pathToFileURL(join(directory, "root.js")).href } } } };
    entries.push(entry);
    ctx.emit("internal/plugin", { entry });
    await Promise.resolve();
  };
  try {
    for (const id of ["first", "second", "third"]) await add(id);
    expect(compose).toHaveBeenCalledTimes(withReady ? 0 : 3);
    // Even a request before appReady must get the current graph and bundles.
    const injections: any[] = [];
    ctx.emit("webserver/index-inject", injections);
    expect(injections.find(row => row.name === "__DSH_BOOT__").value.entries.map((entry: any) => entry.id))
      .toEqual(["first", "second", "third"]);
    const count = compose.mock.calls.length;
    await add("fourth");
    if (withReady) {
      expect(compose).toHaveBeenCalledTimes(count);
      ready();
    }
    expect(compose).toHaveBeenCalledTimes(count + 1);
    expect(registry.graph().entries).toHaveLength(4);
    await add("fifth");
    expect(registry.graph().entries).toHaveLength(5);
    expect(compose).toHaveBeenCalledTimes(count + 2);
    const oldUrl = registry.graph().entries.find((entry: any) => entry.id === "first").url;
    writeFileSync(join(directory, "first/client.js"), "globalThis.first = 2;\n");
    registry.rebuilt("first");
    const newUrl = registry.graph().entries.find((entry: any) => entry.id === "first").url;
    expect(newUrl).not.toBe(oldUrl);
    for (const [url, value] of [[oldUrl, 1], [newUrl, 2]]) {
      const response = registry.fetchBundle(new Request(`http://localhost${url}`));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(`globalThis.first = ${value}`);
      const map = registry.fetchBundle(new Request(`http://localhost${url.replace("client.js&", "client.js.map&")}`));
      expect(map.status).toBe(200);
      expect(await map.json()).toMatchObject({ version: 3, sections: [expect.objectContaining({ offset: { line: 0, column: 0 } })] });
    }
    expect(changed).toHaveBeenCalledTimes(compose.mock.calls.length);
  } finally {
    await ctx.fiber.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
  if (withReady) expect(unsubscribe).toHaveBeenCalledOnce();
});

it("reapplies the pinned client startup patch and rejects an incompatible upgrade", () => {
  const source = readFileSync(require.resolve("@deepseek-ai/dsh-client-modules"), "utf8");
  const patched = batchDshClientModules(source);
  expect(batchDshClientModules(patched)).toBe(patched);
  expect(() => batchDshClientModules("upstream changed")).toThrow("no longer matches");
});
