import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: 'export { GettingStartedBar } from "./getting-started.js"; export { configureRuntime } from "./runtime.js";',
    resolveDir: fileURLToPath(new URL(".", import.meta.url))
  },
  bundle: true, write: false, format: "cjs", platform: "node",
  external: ["react", "react-dom"], loader: { ".css": "text" }
});
const bundle = { exports: {} };
new Function("require", "module", "exports", outputFiles[0].text)(require, bundle, bundle.exports);
const { GettingStartedBar, configureRuntime } = bundle.exports;
configureRuntime((name) => ["react", "react-dom"].includes(name) ? require(name) : {});
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
globalThis.document = { createElement: () => ({}), head: { appendChild() {} } };

test("setup strip offers Finished only after the first result is ready", () => {
  const data = {
    teams: [{ id: "team" }], locations: [],
    items: [{ id: "first", runtimePhase: "running" }], runs: []
  };
  const render = () => renderToStaticMarkup(createElement(GettingStartedBar, {
    state: { teamId: "team", workItemId: "first", step: 3 },
    data, aiReady: true, aiStatus: "AI ready", update() {}, navigate() {}, openWorkItem() {}
  }));
  assert.match(render(), /Open setup/);
  assert.doesNotMatch(render(), /Finished/);
  data.items[0].runtimePhase = "completed";
  data.runs.push({ workItemId: "first", outputs: ["first-result.md"] });
  assert.match(render(), /Finished/);
  assert.doesNotMatch(render(), /Open setup/);
});
