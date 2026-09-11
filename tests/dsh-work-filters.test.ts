import { createRequire } from "node:module";
import { expect, it } from "vitest";
// @ts-expect-error Client modules are plain JavaScript.
import { configureRuntime } from "../dsh-runtime/plugin/client/runtime.js";
// @ts-expect-error Client modules are plain JavaScript.
import { WorkPage } from "../dsh-runtime/plugin/client/work.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const React = require("react");

it("combines template, scope, owner, search, and status filters independently of item kind", () => {
  const state: any[] = [];
  let cursor = 0;
  configureRuntime((id: string) => id === "react" ? {
    ...React, useEffect: () => {},
    useState: (initial: any) => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value: any) => { state[index] = value; }];
    }
  } : {});
  const item = (id: string, processId: string, extra = {}) => ({
    id, title: id, processId, kind: "work", runtimePhase: "running", ...extra
  });
  const data = {
    processes: [
      { id: "goals", name: "Goals", kind: "goals", workspaceId: "team" },
      { id: "custom", name: "Custom", kind: "standard", workspaceId: "team" },
      { id: "empty", name: "Unused template", kind: "standard", workspaceId: "team" },
      { id: "other", name: "Other workspace", kind: "goals", workspaceId: "other" }
    ], stages: [], items: [
      item("daily news summary", "goals", { accountUserId: "alice", runtimePhase: "completed" }),
      item("goal", "goals", { kind: "goal" }),
      item("child", "goals", { accountUserId: "alice", parentId: "goal" }),
      item("grandchild", "goals", { parentId: "child" }),
      item("scheduled occurrence", "goals", { kind: "run", recurringWorkId: "recurring" }),
      item("schedule definition", "goals", { recurringWorkId: "recurring" }),
      item("custom work", "custom"), item("other work", "other")
    ]
  };
  const render = () => {
    cursor = 0;
    const tree = WorkPage({ data, route: "all-work", workspaceIds: ["team"] });
    const [toolbar, grid] = tree.props.children;
    const controls = Object.fromEntries(toolbar.props.children.filter((el: any) => el?.props?.["aria-label"])
      .map((el: any) => [el.props["aria-label"], el.props]));
    const ids = Object.values(grid.props.panels).flatMap((panel: any) => {
      const rows = panel.content.type === "table" ? panel.content.props.children[1].props.children : panel.content;
      return [rows].flat().filter((row: any) => row?.key != null).map((row: any) => row.key);
    });
    return { controls, ids };
  };
  try {
    let view = render();
    expect(view.ids.sort()).toEqual(["custom work", "daily news summary", "goal", "scheduled occurrence"]);
    expect(view.controls["Filter by work item scope"].value).toBe("primary");
    const template = view.controls["Filter by process template"];
    expect(template.value).toBe("all");
    expect(React.Children.toArray(template.children).map((el: any) => el.props.value))
      .toEqual(["all", "custom", "goals", "empty"]);
    template.onChange({ target: { value: "goals" } });
    view = render();
    expect(view.ids.sort()).toEqual(["daily news summary", "goal", "scheduled occurrence"]);
    view.controls["Filter by work item scope"].onChange({ target: { value: "all" } });
    view = render();
    expect(view.ids.sort()).toEqual(["child", "daily news summary", "goal", "grandchild", "scheduled occurrence"]);
    view.controls["Filter by owner"].onChange({ target: { value: "alice" } });
    view = render();
    expect(view.ids.sort()).toEqual(["child", "daily news summary"]);
    view.controls["Search work items by task name"].onChange({ target: { value: " CHILD " } });
    view = render();
    expect(view.ids).toEqual(["child"]);
    view.controls["Filter by status"].onChange({ target: { value: "completed" } });
    expect(render().ids).toEqual([]);
    view.controls["Search work items by task name"].onChange({ target: { value: "" } });
    expect(render().ids).toEqual(["daily news summary"]);
    view.controls["Filter by process template"].onChange({ target: { value: "empty" } });
    expect(render().ids).toEqual([]);
  } finally {
    configureRuntime((id: string) => id === "react" ? React : {});
  }
});
