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
const { ResourceFields, AttachedResourceFields, inheritedInputs } = require("./plugin/client/location-fields.js");
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
