import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: 'export { GettingStartedBar } from "./getting-started.js"; export { RootFolderSettings, SettingsPage } from "./settings.js"; export { BeesApp } from "./shell.js"; export { NativeContentHost } from "./native-conversation.js"; export { configureRuntime } from "./runtime.js";',
    resolveDir: fileURLToPath(new URL(".", import.meta.url))
  },
  bundle: true, write: false, format: "cjs", platform: "node",
  external: ["react", "react-dom"], loader: { ".css": "text", ".png": "dataurl" }
});
const bundle = { exports: {} };
new Function("require", "module", "exports", outputFiles[0].text)(require, bundle, bundle.exports);
const { GettingStartedBar, RootFolderSettings, SettingsPage, BeesApp, NativeContentHost, configureRuntime } = bundle.exports;
configureRuntime((name) => ["react", "react-dom"].includes(name) ? require(name) : {});
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
globalThis.document = { createElement: () => ({}), head: { appendChild() {} } };

test("setup strip allows Finished before the first result is ready", () => {
  const data = {
    teams: [{ id: "team" }], locations: [],
    items: [{ id: "first", runtimePhase: "running" }], runs: []
  };
  const render = () => renderToStaticMarkup(createElement(GettingStartedBar, {
    state: { teamId: "team", workItemId: "first", step: 3 },
    data, aiReady: true, aiStatus: "AI ready", update() {}, navigate() {}, openWorkItem() {}
  }));
  assert.match(render(), /Finished/);
  data.items[0].runtimePhase = "completed";
  data.runs.push({ workItemId: "first", outputs: ["first-result.md"] });
  assert.match(render(), /Finished/);
});


test("root folder setup offers the native picker and settings show unavailable folders", () => {
  const render = (rootFolder) => renderToStaticMarkup(createElement(RootFolderSettings, {
    ctx: { uiWorkspace: { pickDirectory() {} } }, data: { rootFolder }, act() {}
  }));
  const firstLaunch = render({ folder: "", missing: false });
  assert.match(firstLaunch, /Choose your Bees root folder/);
  assert.match(firstLaunch, /Choose root folder/);
  assert.match(firstLaunch, /organization and team settings/);
  const settings = render({ folder: "/Shared/Bees", missing: true });
  assert.match(settings, /Change root folder/);
  assert.match(settings, /\/Shared\/Bees/);
  assert.match(settings, /role="alert"/);
  assert.match(settings, /Reconnect it/);
});


test("first launch keeps root folder configuration inside the full Bees settings shell", () => {
  const React = require("react");
  const snapshot = { rootFolder: { folder: "", missing: false }, organizations: [], teams: [], workspaces: [],
    accounts: [], connections: [], items: [], runs: [], locations: [], processes: [], assignments: [] };
  let nullStates = 0;
  const runtimeReact = { ...React, useState(initial) {
    // Seed BeesApp's fetched data state; the first null state is the AI test result.
    return React.useState(initial === null && ++nullStates === 2 ? snapshot : initial);
  } };
  configureRuntime((name) => name === "react" ? runtimeReact : name === "react-dom" ? require(name)
    : { LocalAiController: () => null, FreeAiController: () => null });
  const preference = { status: "ready", value: {} };
  const preferences = { getSnapshot: () => preference, subscribe: () => () => {}, set: async () => true };
  try {
    const markup = renderToStaticMarkup(createElement(BeesApp, {
      ctx: { theme: { getTheme: () => ({ preference: "dark" }) } }, preferences, modelSettings: preferences
    }));
    assert.match(markup, /class="bees-app"/);
    assert.match(markup, /class="bees-sidebar"/);
    assert.match(markup, /class="bees-settings-layout"/);
    assert.match(markup, /aria-current="page"[^>]*>Root folder/);
    assert.match(markup, /Choose your Bees root folder/);
    assert.doesNotMatch(markup, /Manage presets &amp; skills/);
    assert.equal(renderToStaticMarkup(createElement(NativeContentHost, { kind: "main", content: "DSH workspace UI" })), "");
  } finally {
    configureRuntime((name) => ["react", "react-dom"].includes(name) ? require(name) : {});
  }
});

test("org folders have their own menu and team folders show one shared team row", () => {
  const data = {
    organizations: [{ id: "org", name: "Acme", role: "owner", connected: false }],
    teams: [{ id: "team", name: "Marketing3", role: "admin" }],
    workspaces: [{ id: "first", teamId: "team" }, { id: "second", teamId: "team" }],
    organizationFolders: [{ level: "organization", id: "org", name: "Acme", folder: "/Org" }],
    folders: ["first", "second"].flatMap((workspaceId) => [
      { level: "team", id: "team", name: "Marketing3", folder: "/Org/Marketing3", workspaceId },
      { level: "workspace", id: workspaceId, name: "Default workspace", folder: "/Old", workspaceId }
    ])
  };
  const render = (route) => renderToStaticMarkup(createElement(SettingsPage, {
    route, data, organizationId: "org", teamId: "team", preference: {},
    ctx: { uiWorkspace: { pickDirectory() {} } }, act() {}, navigate() {}
  }));
  const org = render("organization-root-folder");
  assert.match(org, /aria-current="page"[^>]*>Org Root Folder/);
  assert.match(org, /Choose folder/);
  assert.match(org, /\/Org/);
  assert.doesNotMatch(render("organization-settings"), /Choose folder|Organization · Acme/);
  const team = render("team-folders");
  assert.equal(team.match(/Team · Marketing3/g)?.length, 1);
  assert.doesNotMatch(team, /Workspace ·|Default workspace|\/Old/);
  assert.match(team, /All workspaces in this team use the team folder/);
});
