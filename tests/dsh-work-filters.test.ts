import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
// @ts-expect-error Client modules are plain JavaScript.
import { configureRuntime } from "../dsh-runtime/plugin/client/runtime.js";
// @ts-expect-error Client modules are plain JavaScript.
import { WorkPage } from "../dsh-runtime/plugin/client/work.js";

// @ts-expect-error Client modules are plain JavaScript.
import { ResourceFields } from "../dsh-runtime/plugin/client/location-fields.js";

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

it("starts a fresh run from the list and adds work inside the opened run without losing navigation", async () => {
  const slots = new Map<string, any[]>();
  let current: any[] = [], cursor = 0;
  let effects: (() => void)[] = [];
  const hooks = { ...React,
    useState(initial: any) {
      const values = current, index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [values[index], (next: any) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
    },
    useRef(initial: any) {
      const index = cursor++;
      return current[index] ??= { current: initial };
    },
    useEffect(callback: () => void, deps: any[]) {
      const index = cursor++;
      if (!current[index] || deps.some((value, i) => value !== current[index][i])) effects.push(callback);
      current[index] = deps;
    }
  };
  const render = (key: string, component: any, props: any) => {
    current = slots.get(key) ?? []; slots.set(key, current); cursor = 0; effects = [];
    const tree = component(props);
    for (const effect of effects) effect();
    return tree;
  };
  const elements = (tree: any): any[] => !React.isValidElement(tree) ? []
    : [tree, ...React.Children.toArray(tree.props.children).flatMap(elements)];
  const button = (tree: any, label: string) => elements(tree).find((el) => el.props.children === label);
  const parent = { id: "news", title: "Hacker News", processId: "qwen", stageId: "done",
    kind: "run", runtimePhase: "completed", completed: true, outputLocationId: "results" };
  const data = { processes: [{ id: "goals", name: "Goals", workspaceId: "workspace" },
    { id: "qwen", name: "Goals Qwen", workspaceId: "workspace" }],
    workspaces: [{ id: "workspace", teamId: "team" }], assignments: [], runs: [], locations: [],
    processAttachments: [], agentAttachments: [], attachments: [{ workItemId: "news", locationId: "source" }],
    items: [parent], stages: [{ id: "work", processId: "qwen", name: "Work", driver: "agent" },
      { id: "done", processId: "qwen", name: "Done", driver: "terminal" }] };
  let actions: any;
  const props: any = { data, route: "all-work", workspaceIds: ["workspace"], workspaceId: "workspace", teamId: "team",
    preference: {}, preferences: {}, workItemId: "", defaultProcessId: "qwen",
    act: vi.fn(async () => ({ id: "chart" })), setWorkItemId: vi.fn(),
    setCreating: (value: string) => { props.creating = value; },
    setWorkProcessId: (value: string) => { props.defaultProcessId = value; },
    setPageActions: (value: any) => { actions = value; } };
  configureRuntime((id: string) => id === "react" ? hooks : {});
  vi.stubGlobal("FormData", class { constructor(public values: Map<string, string>) {} get(key: string) { return this.values.get(key); } });
  const submit = (form: any) => form.props.onSubmit({ preventDefault() {},
    currentTarget: new Map([["title", "Pie chart"], ["description", "Chart the article counts"]]) });
  try {
    const list = render("page", WorkPage, props);
    button(list, "New work").props.onClick();
    expect(props.creating).toBe("run");
    expect(props.defaultProcessId).toBe("");
    const fresh = render("page", WorkPage, props);
    await submit(render("fresh-form", fresh.type, fresh.props));
    expect(props.act).toHaveBeenLastCalledWith(expect.objectContaining({ action: "create_run", processId: "goals" }));
    expect(props.act.mock.calls.at(-1)[0]).not.toHaveProperty("parentId");
    props.workItemId = parent.id;
    const cockpit = render("page", WorkPage, props);
    render("cockpit", cockpit.type, cockpit.props);
    expect(button(actions, "New work")).toBeUndefined();
    button(actions, "Add work item").props.onClick();
    const add = render("cockpit", cockpit.type, cockpit.props);
    expect(add.props.parent).toBe(parent);
    const form = render("add-form", add.type, add.props);
    expect(elements(form).some((el) => el.props.name === "processId")).toBe(false);
    expect(button(form, "Add work item")).toBeTruthy();
    const resources = elements(form).find((el) => el.type === ResourceFields);
    expect(resources.props.defaultOutputId).toBe("results");
    expect(resources.props.inherited).toContainEqual(expect.objectContaining({ locationId: "source", source: "Process run" }));
    props.setWorkItemId.mockClear();
    await submit(form);
    expect(props.act).toHaveBeenLastCalledWith(expect.objectContaining({ action: "create_item", processId: "qwen", parentId: "news" }));
    const child = { ...parent, id: "chart", parentId: "news", title: "Pie chart", stageId: "work", completed: false };
    data.items.push(child);
    const details = render("cockpit", cockpit.type, cockpit.props).props.children[0];
    expect(details.props.item.id).toBe("chart");
    expect(props.setWorkItemId).not.toHaveBeenCalled();
    button(actions, "Add work item").props.onClick();
    render("cockpit", cockpit.type, cockpit.props).props.onCancel();
    expect(render("cockpit", cockpit.type, cockpit.props).props.children[0].props.item.id).toBe("chart");
  } finally {
    vi.unstubAllGlobals();
    configureRuntime((id: string) => id === "react" ? React : {});
  }
});
