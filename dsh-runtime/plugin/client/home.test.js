import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { dashboardsFrom, DEFAULT_WIDGETS } from "./dashboard-model.js";

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

test("dashboard attention rows follow the selected team, including plans without work items", () => {
  const data = {
    teams: [], workspaces: ["A", "B"].map((id) => ({ id, teamId: `team-${id}` })),
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
      preference: { dashboards: [{ id: "home", name: "Home", widgets: [{ kind: "waiting", w: 5, h: 6 }] }] },
      rowsForRoute: (route) => workItemsFor(data, route, workspaceId ? [workspaceId] : [])
        .map((item) => ({ id: item.id, label: item.title }))
    }));
    for (const team of ["A", "B"]) {
      for (const kind of ["question", "approval", "plan"]) {
        assert.equal(html.includes(`${team} ${kind}`), team === workspaceId, `${workspaceId || "no team"}: ${team} ${kind}`);
      }
      assert(!html.includes(`${team} completed`));
    }
  }
});

test("Home uses the new layout and upgrades the old default without replacing a custom layout", () => {
  assert.deepEqual(DEFAULT_WIDGETS.map(({ kind, x, y, w, h }) => [kind, x, y, w, h]), [
    ["outcome", 0, 0, 10, 4], ["quick-actions", 10, 0, 2, 4],
    ["waiting", 0, 4, 5, 7], ["recent-work", 5, 4, 7, 7], ["completed", 0, 11, 12, 6]
  ]);
  const old = [
    { kind: "metrics", x: 0, y: 0, w: 12, h: 3 },
    { kind: "outcome", x: 0, y: 3, w: 8, h: 5 },
    { kind: "quick-actions", x: 8, y: 3, w: 4, h: 5 },
    { kind: "waiting", x: 0, y: 8, w: 6, h: 4 },
    { kind: "recent-work", x: 6, y: 8, w: 6, h: 4 }
  ];
  assert.deepEqual(dashboardsFrom([{ id: "home", widgets: old }])[0].widgets, DEFAULT_WIDGETS);
  const previous = [
    { kind: "outcome", x: 0, y: 0, w: 10, h: 4 },
    { kind: "quick-actions", x: 10, y: 0, w: 2, h: 4 },
    { kind: "waiting", x: 0, y: 4, w: 5, h: 6 },
    { kind: "recent-work", x: 5, y: 4, w: 7, h: 6 },
    { kind: "completed", x: 0, y: 10, w: 12, h: 6 }
  ];
  assert.deepEqual(dashboardsFrom([{ id: "home", widgets: previous }])[0].widgets, DEFAULT_WIDGETS);
  assert.equal(dashboardsFrom([{ id: "home", widgets: old.map((widget) =>
    widget.kind === "outcome" ? { ...widget, w: 7 } : widget) }])[0].widgets[1].w, 7);
});

test("completed widget excludes cancelled and archived work", () => {
  const data = {
    teams: [], workspaces: [{ id: "team", teamId: "team" }],
    processes: [{ id: "active", workspaceId: "team" }, { id: "archived-process", workspaceId: "team", archivedAt: "today" }],
    items: [
      { id: "done", processId: "active", title: "Finished run", runtimePhase: "completed" },
      { id: "cancelled", processId: "active", title: "Cancelled run", runtimePhase: "cancelled" },
      { id: "archived", processId: "active", title: "Archived run", runtimePhase: "completed", archivedAt: "today" },
      { id: "old-process", processId: "archived-process", title: "Archived process run", runtimePhase: "completed" }
    ], runs: [], proposals: []
  };
  const rowsForRoute = (route) => workItemsFor(data, route, ["team"])
    .map((item) => ({ id: item.id, label: item.title, item }));
  assert.deepEqual(rowsForRoute("completed").map(({ id }) => id), ["done"]);
  assert.deepEqual(rowsForRoute("all-work").map(({ id }) => id), []);
  const html = renderToStaticMarkup(createElement(Home, {
    ctx: { sessions: {}, uiSession: {} }, data, workspaceId: "team", preferences: {},
    preference: { dashboards: [{ id: "home", name: "Home", widgets: [{ kind: "completed", w: 12, h: 6 }] }] },
    rowsForRoute, act() {}, navigate() {}, openWorkItem() {}
  }));
  assert(html.includes("Finished run"));
  for (const title of ["Cancelled run", "Archived run", "Archived process run"]) assert(!html.includes(title));
});
