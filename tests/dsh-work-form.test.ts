import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { clientSource as client } from "./client-source.js";

describe("New work form", () => {
  it("offers every process in the selected workspace", () => {
    expect(client).toContain(
      'const processes = data.processes.filter((process) => process.workspaceId === workspaceId);'
    );
  });

  it("creates work with multiple inputs and one optional output folder", () => {
    expect(client).toContain("inputLocationIds, outputLocationId");
    expect(client).toContain('h(ResourceFields, { ctx, data, teamId, act');
    expect(client).toContain('"Keep results in Bees only"');
    expect(client).toContain('Use process result folder');
    expect(client).toContain('"Save outputs to folder…"');
  });
});

// Exercise the shared selector with real React rendering, without a browser test framework.
const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { configureRuntime } = require("./plugin/client/runtime.js");
const { ResourceFields, AttachedResourceFields, inheritedInputs, WorkFiles, WorkLocations, LocationEntry, FilePreview } = require("./plugin/client/location-fields.js");
configureRuntime((id: string) => id === "react" ? React : {});

it("shows inherited subpaths and unmapped selections without saving them as direct inputs", async () => {
  const data = {
    teams: [{ id: "team", role: "admin" }],
    locations: [
      { id: "folder", teamId: "team", kind: "folder", name: "Shared", mapped: true, localPath: "/shared" },
      { id: "missing", teamId: "team", kind: "file", name: "Brief", mapped: false }
    ],
    processAttachments: [{ processId: "process", locationId: "folder", relativePath: "project" }],
    agentAttachments: [{ agentAssignmentId: "agent", locationId: "folder", relativePath: "project" }]
  };
  const inherited = inheritedInputs(data, "process", "agent");
  const markup = renderToStaticMarkup(React.createElement(ResourceFields, {
    data, teamId: "team", inputIds: ["missing"], inherited, onInputIds: () => {}, onOutputId: () => {}
  }));
  expect(markup).toContain("Shared/project");
  expect(markup).toContain("From Process + Agent");
  expect(markup).toContain("Not mapped on this device");
  expect(markup.match(/type="checkbox"/g)).toHaveLength(2);
  expect(markup.match(/checked=""/g)).toHaveLength(2);
  expect(markup).toContain('disabled=""');
  expect(inheritedInputs(data, "other-process", "other-agent")).toEqual([]);
  const commands: any[] = [];
  const fields = AttachedResourceFields({ data, teamId: "team", owner: { itemId: "item" },
    references: [{ locationId: "folder", relativePath: "project" }], inherited,
    act: async (command: any) => { commands.push(command); return {}; }
  });
  await fields.props.onInputIds(["folder", "missing"]);
  expect(commands).toEqual([{ action: "attach_location", itemId: "item", locationId: "missing" }]);
});

it("shows work locations read-only and groups generated files by run and directory", () => {
  const data = { locations: [
    { id: "input", name: "Briefs", kind: "folder", mapped: true, localPath: "/shared/briefs" },
    { id: "output", name: "Reports", kind: "folder", mapped: true, localPath: "/shared/reports" }
  ] };
  const props = {
    data, references: [{ locationId: "input", relativePath: "quarterly" }, { locationId: "missing" }],
    inherited: [{ locationId: "input", relativePath: "quarterly", source: "Process" }],
    defaultOutputId: "output", runs: [
      { id: "new", status: "completed", updatedAt: 1, outputs: ["analysis/summary.md", "analysis\\data\\totals.csv", "summary.md"] },
      { id: "old", status: "completed", updatedAt: 0, outputs: ["summary.md"] }
    ]
  };
  const markup = renderToStaticMarkup(React.createElement(WorkLocations, props));
  const files = renderToStaticMarkup(React.createElement(WorkFiles, props));
  expect(files).not.toMatch(/Input files|Output folder|shared\/briefs|shared\/reports/);
  expect(markup).not.toContain("<h3>Generated files</h3>");
  expect(markup).toContain("/shared/briefs/quarterly");
  expect(markup).toContain("Work item + Process");
  expect(markup.match(/>Briefs\/quarterly<\/summary>/g)).toHaveLength(1);
  expect(markup).toContain("/shared/reports");
  expect(markup).toContain("From process");
  expect(markup).toContain("Default output folder");
  expect(markup).toContain("Unavailable input");
  expect(markup).toContain('disabled=""');
  expect(markup).not.toMatch(/<select|<input|Add folder|Add file|Remove/);
  expect(files).toContain("Run 2 · 3 files");
  expect(files).toContain("Run 1 · 1 file");
  expect(files).toContain('class="bees-status bees-completed">completed</span>');
  expect(files).not.toContain("Select a file to read its contents.");
  expect(files.match(/class="bees-output-run"/g)).toHaveLength(2);
  expect(files).toContain(">analysis</summary>");
  expect(files).toContain(">data</summary>");
  expect(files).toContain('title="analysis/data/totals.csv"');
  expect(files.match(/>summary.md<\/button>/g)).toHaveLength(3);
  expect(client).toContain("h(WorkFiles, { key: processRunId, runs: fileRuns");
});

it("shows missing destinations and empty runs without configuration controls", () => {
  const props = { data: { locations: [] }, references: [], runs: [] };
  const markup = renderToStaticMarkup(React.createElement(WorkLocations, props));
  expect(markup).toBe("");
  expect(renderToStaticMarkup(React.createElement(WorkFiles, props))).toContain("Generated files will appear here");
  const missing = renderToStaticMarkup(React.createElement(WorkLocations, { ...props, outputId: "missing" }));
  expect(missing).toContain("Unavailable output folder");
  expect(missing).not.toContain("Input files");
  expect(missing).not.toContain("Bees only");
  const onClose = vi.fn();
  const previewElement = FilePreview({ target: { executionId: "run", path: "outputs/report.md" }, onClose });
  expect(previewElement.props.onClose).toBe(onClose);
  expect(previewElement.type.name).toBe("NativeRunFilePreview");
});

it("expands files inline below and collapses on toggle or close", () => {
  let viewer: any = null;
  const runs = [{ id: "run", status: "completed", updatedAt: 0, outputs: ["report.md"] }];
  const filesRef = { current: null };
  configureRuntime((id: string) => id === "react" ? {
    ...React, useState: () => [viewer, (next: any) => { viewer = next; }]
  } : {});
  try {
    const initial = WorkFiles({ runs, filesRef });
    const explorer = initial.props.children[0];
    expect(explorer.ref).toBe(filesRef);
    const directory = explorer.props.children.props.children[1];
    directory.props.onOpen({ executionId: "run", path: "outputs/report.md" });
    expect(viewer).toEqual({ executionId: "run", path: "outputs/report.md" });
    const opened = WorkFiles({ runs, filesRef });
    const openedDir = opened.props.children[0].props.children.props.children[1];
    expect(openedDir.props.viewer).toEqual({ executionId: "run", path: "outputs/report.md" });
    const preview = opened.props.children[1];
    expect(preview.type).toBe(FilePreview);
    expect(preview.props.target).toEqual(viewer);
    preview.props.onClose();
    expect(viewer).toBeNull();
  } finally {
    configureRuntime((id: string) => id === "react" ? React : {});
  }
});

it("expands folders lazily, renders nested entries, and opens files", async () => {
  // Exercise the one component's state/effect cycle without adding a DOM dependency.
  const state: any[] = [];
  let index = 0;
  let dependencies: any[] = [];
  let effect: (() => (() => void) | undefined) | undefined;
  let cleanup: (() => void) | undefined;
  const hooks = { ...React,
    useState(initial: any) {
      const slot = index++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], (next: any) => { state[slot] = typeof next === "function" ? next(state[slot]) : next; }];
    },
    useEffect(callback: typeof effect, next: any[]) {
      if (next.some((value, i) => value !== dependencies[i])) {
        cleanup?.(); dependencies = next; effect = callback;
      }
    }
  };
  const onOpen = vi.fn();
  const props = { locationId: "folder", path: "", name: "Reports", kind: "folder", onOpen };
  const render = (values = props) => {
    index = 0;
    configureRuntime((id: string) => id === "react" ? hooks : {});
    const tree = LocationEntry(values);
    configureRuntime((id: string) => id === "react" ? React : {});
    if (effect) { cleanup = effect(); effect = undefined; }
    return tree;
  };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entries: [
    { name: "nested", path: "nested", kind: "folder" },
    { name: "summary.md", path: "summary.md", kind: "file" }
  ] }) });
  vi.stubGlobal("fetch", fetch);
  try {
    const tree = render();
    expect(fetch).not.toHaveBeenCalled();
    const target = { open: true };
    tree.props.onToggle({ target, currentTarget: target });
    render();
    await vi.waitFor(() => expect(state[1]?.entries).toHaveLength(2));
    expect(fetch.mock.calls[0]?.[0]).toBe("/bees-api/location-file?locationId=folder&path=");
    const markup = renderToStaticMarkup(render());
    expect(markup).toContain('<summary title="nested"><svg');
    expect(markup).toContain(">nested</summary>");
    expect(markup).toContain(">summary.md</button>");
    render({ ...props, kind: "file", name: "summary.md", path: "summary.md" }).props.onClick();
    expect(onOpen).toHaveBeenCalledWith({ locationId: "folder", path: "summary.md" });
  } finally {
    cleanup?.();
    configureRuntime((id: string) => id === "react" ? React : {});
    vi.unstubAllGlobals();
  }
});
