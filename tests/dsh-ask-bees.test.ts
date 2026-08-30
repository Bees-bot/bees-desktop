import { createRequire } from "node:module";
import { expect, it } from "vitest";
// @ts-expect-error Client modules are plain JavaScript.
import { configureRuntime } from "../dsh-runtime/plugin/client/runtime.js";
// @ts-expect-error Client modules are plain JavaScript.
import { AskBeesSetup, goalSetup } from "../dsh-runtime/plugin/client/ask-bees.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
configureRuntime((id: string) => id === "react" ? React : {});

it("shows workflow defaults and inherited inputs without starting anything", () => {
  const data = {
    teams: [{ id: "team", name: "Research", role: "admin" }], workspaces: [{ id: "workspace", teamId: "team" }],
    processes: [{ id: "goals", workspaceId: "workspace", kind: "goals" }],
    stages: [{ id: "work", name: "Work", processId: "goals", driver: "agent" },
      { id: "review", name: "Review", processId: "goals", driver: "review", routeType: "pool", routeTargetId: "pool" }],
    assignments: [{ id: "worker", name: "Worker", workspaceId: "workspace", systemRole: "worker", enabled: true, mcpAccess: "none" },
      { id: "reviewer", name: "Reviewer", workspaceId: "workspace", model: "provider/reviewer", enabled: true, mcpAccess: "all" }],
    poolMembers: [{ poolId: "pool", agentAssignmentId: "reviewer", enabled: true }],
    processAttachments: [{ processId: "goals", locationId: "brief", relativePath: "project" }],
    agentAttachments: [{ agentAssignmentId: "worker", locationId: "brief", relativePath: "" }],
    locations: [{ id: "brief", name: "Brief", teamId: "team", kind: "folder", mapped: true }],
    systemDefaultModel: { provider: "provider", model: "default" }
  };
  let started = false;
  const render = (snapshot: any) => renderToStaticMarkup(React.createElement(AskBeesSetup, {
    ctx: {}, data: snapshot, workspaceId: "workspace", outcome: "Research CRM options", capabilities: { data: { servers: [] } },
    onOutcome: () => {}, onBack: () => {}, act: () => { started = true; }
  }));
  const markup = render(data);
  expect(markup).toContain("Review &amp; start");
  expect(markup).toContain("Start with defaults");
  expect(markup).toContain("provider/default");
  expect(markup).toContain("provider/reviewer");
  expect(markup).toContain("Brief/project");
  expect(markup).toContain("No extra tools connected");
  expect(markup).toContain("Connect tools");
  expect(markup).toContain("Connect a model provider");
  expect(started).toBe(false);
  expect(goalSetup(data, "other-team").stages).toEqual([]);
  expect(render({ ...data, assignments: [] })).toMatch(/<button[^>]*disabled=""[^>]*>Start with defaults/);
  expect(render({ ...data, teams: [{ ...data.teams[0], role: "viewer" }] })).toContain('<fieldset class="bees-ask-fields" disabled="">');
});
