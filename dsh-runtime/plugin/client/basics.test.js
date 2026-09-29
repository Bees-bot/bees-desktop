import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: 'export { BasicsPage } from "./basics.js"; export { configureRuntime } from "./runtime.js";',
    resolveDir: fileURLToPath(new URL(".", import.meta.url))
  },
  bundle: true, write: false, format: "cjs", platform: "node",
  external: ["react", "react-dom"]
});
const bundle = { exports: {} };
new Function("require", "module", "exports", "document", outputFiles[0].text)(require, bundle, bundle.exports, {
  createElement: () => ({}), head: { appendChild() {} }
});
bundle.exports.configureRuntime((name) => ["react", "react-dom"].includes(name) ? require(name) : {});
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

test("Bees basics renders every section and FAQ with single and multiple children", () => {
  const html = renderToStaticMarkup(createElement(bundle.exports.BasicsPage, {
    navigate() {}, onStart() {}
  }));
  assert.equal((html.match(/class="bb-section"/g) ?? []).length, 8);
  assert.equal((html.match(/class="bb-faq-body"/g) ?? []).length, 3);
  assert.match(html, /class="bb-faq-body"><p>Team membership grants access/);
  assert.match(html, /class="bb-faq-body"><p>An execution is one agent attempt/);
  assert.match(html, /when you need them\.<\/p><p><button[^>]*>Open detailed guides/);
});
