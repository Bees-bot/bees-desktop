import { createRequire } from "node:module";
import { expect, it } from "vitest";
// @ts-expect-error Client modules are plain JavaScript.
import { configureRuntime } from "../dsh-runtime/plugin/client/runtime.js";
// @ts-expect-error Client modules are plain JavaScript.
import { AskBeesSetup } from "../dsh-runtime/plugin/client/ask-bees.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
configureRuntime((id: string) => id === "react" ? React : {});

it("shows the planner form without starting anything", () => {
  const data = {
    teams: [{ id: "team", name: "Research", role: "admin" }], workspaces: [{ id: "workspace", teamId: "team" }],
    processes: [{ id: "goals", workspaceId: "workspace", kind: "goals" }],
    stages: [{ id: "work", name: "Work", processId: "goals", driver: "agent" },
      { id: "review", name: "Review", processId: "goals", driver: "review", agentIds: ["reviewer"] }],
    assignments: [{ id: "worker", name: "Worker", workspaceId: "workspace", systemRole: "worker", enabled: true, mcpAccess: "none" },
      { id: "reviewer", name: "Reviewer", workspaceId: "workspace", model: "provider/reviewer", enabled: true, mcpAccess: "all" }],
    processAttachments: [{ processId: "goals", locationId: "brief", relativePath: "project" }],
    agentAttachments: [{ agentAssignmentId: "worker", locationId: "brief", relativePath: "" }],
    locations: [{ id: "brief", name: "Brief", teamId: "team", kind: "folder", mapped: true }],
    systemDefaultModel: { provider: "provider", model: "default" }, proposals: []
  };
  let started = false;
  const render = (snapshot: any) => renderToStaticMarkup(React.createElement(AskBeesSetup, {
    ctx: {}, data: snapshot, workspaceId: "workspace", outcome: "Research CRM options", capabilities: { data: { servers: [] } },
    onOutcome: () => {}, onBack: () => {}, act: () => { started = true; }
  }));
  const markup = render(data);
  expect(markup).toContain("What should Bees build?");
  expect(markup).toContain("Plan it");
  expect(markup).toContain("provider/default");
  expect(markup).toContain("No MCP servers are connected yet");
  expect(markup).toContain("Manage connected tools");
  expect(markup).toContain("Connect another model provider");
  expect(started).toBe(false);
  expect(render({ ...data, teams: [{ ...data.teams[0], role: "viewer" }] })).toMatch(/<fieldset[^>]*disabled=""[^>]*>/);
});
