import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { expect, it, vi } from "vitest";

const source = readFileSync(new URL("../dsh-runtime/plugin/client/agents.js", import.meta.url), "utf8");
const flatten = (node: any): any[] => !node || typeof node !== "object" ? []
  : [node, ...(node.children ?? []).flat(Infinity).flatMap(flatten)];

it("offers duplicate/archive for active agents, restore for archived agents, and filters by scope", async () => {
  const act = vi.fn();
  const ask = vi.fn().mockResolvedValue(" Copy name ");
  const confirmAction = vi.fn().mockResolvedValue(false);
  const setState = vi.fn();
  let status = "active";
  const { AgentListActions, AgentsPage } = new Script(source.slice(source.indexOf("export function AgentListActions("))
    .replaceAll("export function", "function") + "; ({ AgentListActions, AgentsPage })").runInNewContext({
    Error, h: (tag: any, props: any, ...children: any[]) => ({ tag, props, children }),
    Button: "button", Empty: "empty", GridStackPage: "grid", AGENTS_LAYOUT: [], React: { Fragment: "fragment" },
    ask, confirmAction, useState: (initial: any) => [initial === "active" ? status : initial, setState],
    useSubmit: (handler: any) => [false, handler]
  });
  const agent = { id: "agent", name: "Agent", workspaceId: "team", enabled: true };
  const buttons = (extra = {}) => flatten(AgentListActions({ agent: { ...agent, ...extra }, act })).filter((node) => node.tag === "button");
  await buttons()[0].props.onClick({});
  expect(act).toHaveBeenLastCalledWith({ action: "copy_agent_assignment", agentAssignmentId: "agent", name: "Copy name" });
  act.mockClear();
  ask.mockResolvedValue(null);
  await buttons()[0].props.onClick({});
  await buttons()[1].props.onClick({});
  expect(act).not.toHaveBeenCalled();
  confirmAction.mockResolvedValue(true);
  await buttons()[1].props.onClick({});
  expect(act).toHaveBeenLastCalledWith({ action: "archive_agent_assignment", agentAssignmentId: "agent" });
  expect(buttons({ systemRole: "worker" }).map((node) => [node.children[0], node.props.disabled]))
    .toEqual([["Duplicate", false], ["Delete", true]]);
  const restored = buttons({ archivedAt: "2026-09-10" });
  expect(restored.map((node) => node.children[0])).toEqual(["Restore"]);
  await restored[0].props.onClick({});
  expect(act).toHaveBeenLastCalledWith({ action: "restore_agent_assignment", agentAssignmentId: "agent" });
  act.mockRejectedValue(new Error("Not allowed"));
  await restored[0].props.onClick({});
  expect(setState).toHaveBeenLastCalledWith("Not allowed");
  const data = { presets: [], assignments: [agent,
    { ...agent, id: "archived", archivedAt: "2026-09-10", enabled: false },
    { ...agent, id: "disabled", enabled: false },
    { ...agent, id: "other", workspaceId: "other" }] };
  const rows = () => {
    const page = AgentsPage({ data, workspaceIds: ["team"], workspaceId: "team", act });
    const grid = flatten(page).find((node) => node.tag === "grid");
    return flatten(grid.props.panels.agents.content).filter((node) => node.props?.className === "bees-row").map((node) => node.props.key);
  };
  expect(rows()).toEqual(["agent", "disabled"]);
  status = "archived";
  expect(rows()).toEqual(["archived"]);
});
