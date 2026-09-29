import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: 'export { SkillsPage, McpPage } from "./skills.js"; export { configureRuntime } from "./runtime.js";',
    resolveDir: fileURLToPath(new URL(".", import.meta.url))
  },
  bundle: true, write: false, format: "cjs", platform: "node",
  external: ["react", "react-dom"], loader: { ".css": "text" }
});
const bundle = { exports: {} };
new Function("require", "module", "exports", outputFiles[0].text)(require, bundle, bundle.exports);
const react = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

test("skills and add-ons expose customization and restore their own saved panel layouts", () => {
  const capabilities = { data: {
    skills: [{ name: "Writer", description: "Write clearly", removable: true }], skillsComplete: true,
    tools: [{ name: "read_file", description: "Read a file" }], servers: [],
    catalog: [{ id: "calendar", label: "Calendar", summary: "Manage events" }], skillPacks: []
  } };
  for (const [Component, layoutId, kinds] of [
    [bundle.exports.SkillsPage, "skills", ["skills", "install", "tools"]],
    [bundle.exports.McpPage, "mcp", ["connected", "available", "registry"]]
  ]) {
    let actions;
    const setPageActions = (value) => { actions = value; };
    const preferences = {};
    // Run the header effect while leaving GridStack's DOM effects to the browser.
    bundle.exports.configureRuntime((name) => name === "react" ? {
      ...react, useEffect: (effect, dependencies) => {
        if (dependencies?.includes(setPageActions)) effect();
      }
    } : name === "react-dom" ? require(name) : {});
    const render = (preference) => renderToStaticMarkup(react.createElement(Component, {
      capabilities, preference, preferences, setPageActions, ctx: {}
    }));
    const defaultHtml = render({});
    for (const kind of kinds) assert(defaultHtml.includes(`gs-id="${kind}"`));
    assert.equal((defaultHtml.match(/class="grid-stack-item"/g) ?? []).length, 3);
    const header = renderToStaticMarkup(actions);
    assert(header.includes("Customize"));
    if (layoutId === "mcp") {
      assert(!header.includes("Connect Add-on"));
      assert(defaultHtml.indexOf("Connect Add-on") < defaultHtml.indexOf("bees-mcp-intro"));
      assert(defaultHtml.indexOf("bees-mcp-intro") < defaultHtml.indexOf('gs-id="connected"'));
    }
    const savedHtml = render({ pageLayouts: {
      [layoutId]: [{ kind: kinds[0], x: 6, y: 2, w: 6, h: 4 }],
      [layoutId === "skills" ? "mcp" : "skills"]: [{ kind: kinds[0], x: 0, y: 0, w: 3, h: 2 }]
    } });
    assert(savedHtml.includes(`gs-id="${kinds[0]}" gs-x="6" gs-y="2" gs-w="6" gs-h="4"`));
    for (const text of layoutId === "skills"
      ? ["Writer", "Write clearly", "Remove", "Install more skills", "read_file", "Search skills and tools"]
      : ["Connected add-ons", "No add-ons connected yet", "Calendar", "Search available add-ons", "Community registry", "Search the add-on registry"])
      assert(savedHtml.includes(text), `Missing ${layoutId} content: ${text}`);
  }
});
