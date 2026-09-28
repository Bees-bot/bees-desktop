import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

// Bundle the browser modules as the app does; GridStack's imports need bundling in Node.
const require = createRequire(new URL("../../package.json", import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: 'export { Home } from "./home.js"; export { configureRuntime } from "./runtime.js"; export { workItemsFor } from "./shared.js";',
    resolveDir: fileURLToPath(new URL(".", import.meta.url))
  },
  bundle: true, write: false, format: "cjs", platform: "node",
  external: ["react", "react-dom"], loader: { ".css": "text" }
});
const bundle = { exports: {} };
new Function("require", "module", "exports", outputFiles[0].text)(require, bundle, bundle.exports);
const { Home, configureRuntime, workItemsFor } = bundle.exports;
configureRuntime((name) => ["react", "react-dom"].includes(name) ? require(name) : {});
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

test("dashboard attention rows and count follow the selected team, including plans without work items", () => {
  const data = {
    workspaces: ["A", "B"].map((id) => ({ id, teamId: `team-${id}` })),
    processes: ["A", "B"].map((workspaceId) => ({ id: `process-${workspaceId}`, workspaceId })),
    items: ["A", "B"].flatMap((team) => ["question", "approval", "completed"].map((kind) => ({
      id: `${team}-${kind}`, processId: `process-${team}`, title: `${team} ${kind}`,
      runtimePhase: kind === "completed" ? "completed" : "waiting"
    }))),
    runs: ["A", "B"].flatMap((workspaceId) => ["question", "approval", "plan", "completed"].map((kind) => ({
      id: `run-${workspaceId}-${kind}`, workspaceId, sessionId: `session-${workspaceId}-${kind}`,
      workItemId: kind === "plan" ? null : `${workspaceId}-${kind}`,
      mode: kind === "plan" ? "planning" : "work", purpose: `${workspaceId} plan`,
      status: kind === "approval" ? "waiting_for_approval" : "waiting_for_input"
    }))),
    proposals: []
  };
  for (const workspaceId of ["A", "B", "", "missing"]) {
    const html = renderToStaticMarkup(createElement(Home, {
      ctx: { sessions: {}, uiSession: {} }, data, workspaceId, preferences: {},
      preference: { dashboards: [{ id: "home", name: "Home", widgets: [
        { kind: "metrics", w: 12, h: 3 }, { kind: "waiting", w: 6, h: 4 }
      ] }] },
      rowsForRoute: (route) => workItemsFor(data, route, workspaceId ? [workspaceId] : [])
        .map((item) => ({ id: item.id, label: item.title }))
    }));
    for (const team of ["A", "B"]) {
      for (const kind of ["question", "approval", "plan"]) {
        assert.equal(html.includes(`${team} ${kind}`), team === workspaceId, `${workspaceId || "no team"}: ${team} ${kind}`);
      }
      assert(!html.includes(`${team} completed`));
    }
    assert.match(html, new RegExp(`<strong>${["A", "B"].includes(workspaceId) ? 3 : 0}</strong><span>Needs you</span>`));
  }
});
