import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
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
const { ResourceFields, AttachedResourceFields, inheritedInputs, WorkFiles, FilePreview } = require("./plugin/client/location-fields.js");
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
  const markup = renderToStaticMarkup(React.createElement(WorkFiles, {
    data, references: [{ locationId: "input", relativePath: "quarterly" }, { locationId: "missing" }],
    inherited: [{ locationId: "input", relativePath: "quarterly", source: "Process" }],
    defaultOutputId: "output", runs: [
      { id: "new", status: "completed", updatedAt: 1, outputs: ["analysis/summary.md", "analysis\\data\\totals.csv", "summary.md"] },
      { id: "old", status: "completed", updatedAt: 0, outputs: ["summary.md"] }
    ]
  }));
  expect(markup).toContain("/shared/briefs/quarterly");
  expect(markup).toContain("Work item + Process");
  expect(markup.match(/<strong>Briefs\/quarterly<\/strong>/g)).toHaveLength(1);
  expect(markup).toContain("/shared/reports");
  expect(markup).toContain("From process");
  expect(markup).toContain("Unavailable input");
  expect(markup).toContain('disabled=""');
  expect(markup).not.toMatch(/<select|<input|Add folder|Add file|Remove/);
  expect(markup).toContain("Run 2 · completed · 3 files");
  expect(markup).toContain("Run 1 · completed · 1 file");
  expect(markup).toContain("<summary>analysis/</summary>");
  expect(markup).toContain("<summary>data/</summary>");
  expect(markup).toContain('title="analysis/data/totals.csv"');
  expect(markup.match(/>summary.md<\/button>/g)).toHaveLength(3);
  expect(client).toContain("h(WorkFiles, { key: item.id, data, runs: itemRuns");
});

it("shows missing destinations and empty runs without configuration controls", () => {
  const props = { data: { locations: [] }, references: [], runs: [] };
  const markup = renderToStaticMarkup(React.createElement(WorkFiles, props));
  expect(markup).toContain("No input files or folders selected.");
  expect(markup).toContain("Bees only — no output folder selected.");
  expect(markup).toContain("Generated files will appear here");
  const missing = renderToStaticMarkup(React.createElement(WorkFiles, { ...props, outputId: "missing" }));
  expect(missing).toContain("Unavailable output folder");
  expect(missing).not.toContain("Bees only");
  const preview = renderToStaticMarkup(React.createElement(FilePreview, { target: { executionId: "run", path: "outputs/report.md" } }));
  expect(preview).toContain(">Full screen</button>");
  expect(preview).toContain('<dialog class="bees-file-dialog" aria-label="Full-screen file preview">');
});
