import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
// @ts-expect-error The DSH browser client is intentionally plain JavaScript.
import { addDashboardWidget, applyDashboardLayout, applyFixedLayout, applyWorkItemLayout, dashboardsFrom, fixedLayoutFrom, workItemLayoutFrom } from "../dsh-runtime/plugin/client/dashboard-model.js";
import { clientBundle, clientSource as client } from "./client-source.js";

describe("personal dashboards", () => {
  it("cannot miss preferences loaded between render and subscription", () => {
    const hook = client.slice(client.indexOf("export function usePreference"), client.indexOf("export function useSnapshot"));
    expect(hook).toContain("const unsubscribe = scope.subscribe(update)");
    expect(hook.indexOf("scope.subscribe(update)")).toBeLessThan(hook.indexOf("update();"));
  });

  it("keeps page header setters callable", () => {
    expect(client).toContain("const setPageActions = (actions) => headerEmitter.setActions(actions)");
    expect(client).toContain("const setPageHeader = (header) => headerEmitter.setHeader(header)");
    expect(client).toContain('import { h, React, useEffect, useRef, useState } from "./runtime.js"');
    expect(client).not.toContain('const setPageActions = "actions"');
  });

  it("provides the default Home layout without writing settings", () => {
    const dashboards = dashboardsFrom(undefined);
    expect(dashboards).toHaveLength(1);
    expect(dashboards[0]).toMatchObject({ id: "home", name: "Home" });
    expect(dashboards[0].widgets.map((widget: { kind: string }) => widget.kind))
      .toEqual(["metrics", "outcome", "quick-actions", "waiting", "recent-work"]);
  });

  it("sanitizes persisted layouts and preserves one widget of each kind", () => {
    const dashboards = dashboardsFrom([{ id: "custom", name: "  Files  ", widgets: [
      { kind: "files", x: 99, y: -4, w: 99, h: 1 },
      { kind: "files", x: 2, y: 2, w: 2, h: 2 }
    ] }]);
    expect(dashboards[0]).toEqual({ id: "home", name: "Home", widgets: expect.any(Array) });
    const custom = dashboards.find(({ id }: { id: string }) => id === "custom");
    expect(custom).toEqual({ id: "custom", name: "Files", widgets: [
      { kind: "files", x: 0, y: 0, w: 12, h: 2 }
    ] });
  });

  it("adds widgets below existing content and applies GridStack coordinates", () => {
    const dashboard = { id: "x", name: "X", widgets: [{ kind: "metrics", x: 0, y: 0, w: 12, h: 3 }] };
    const added = addDashboardWidget(dashboard, { kind: "runs", w: 6, h: 5 });
    expect(added.widgets[1]).toEqual({ kind: "runs", x: 0, y: 3, w: 6, h: 5 });
    expect(applyDashboardLayout(added, [{ id: "runs", x: 6, y: 0, w: 6, h: 4 }]).widgets[1])
      .toEqual({ kind: "runs", x: 6, y: 0, w: 6, h: 4 });
  });

  it("bundles GridStack and exposes dashboard controls", () => {
    expect(clientBundle).toContain("GridStack");
    expect(client).toContain('preferences.set("dashboards"');
    expect(client).toContain('preferences.set("activeDashboardId"');
    expect(client).toContain('draggable: { handle: ".bees-dashboard-widget-handle" }');
    expect(client).toContain('columnOpts: { breakpoints: [{ w: 700, c: 1 }, { w: 1000, c: 6 }] }');
    expect(client).toContain('const layoutKey = dashboard.widgets.map(({ kind, x, y, w, h })');
    expect(client).toContain('gridRef.current?.load(dashboard.widgets.map(({ kind, ...position }) => ({ id: kind, ...position })))');
    expect(client).toContain('className: "bees-nav-dashboards"');
    expect(client).toContain('widgets: dashboard.widgets.map((widget) => ({ ...widget }))');
    expect(client).toContain('className: `bees-nav-link bees-dashboard-link');
    expect(client).toContain('rowsForRoute, preference, preferences, setPageActions');
    expect(client).not.toContain('className: "bees-select bees-dashboard-select"');
    expect(client).toContain('kind: "quick-actions"');
    expect(client).toContain('kind: "knowledge-sources"');
  });

  it("provides and sanitizes the fixed work-item layout", () => {
    expect(workItemLayoutFrom(undefined)).toEqual([
      { kind: "kanban", x: 0, y: 0, w: 12, h: 4 },
      { kind: "run-status", x: 0, y: 4, w: 12, h: 1 },
      { kind: "conversation", x: 0, y: 5, w: 6, h: 8 },
      { kind: "details", x: 6, y: 5, w: 6, h: 8 }
    ]);
    expect(workItemLayoutFrom([
      { kind: "details", x: 50, y: -1, w: 50, h: 1 },
      { kind: "unknown", x: 0, y: 0, w: 2, h: 2 }
    ])).toEqual([
      { kind: "kanban", x: 0, y: 0, w: 12, h: 4 },
      { kind: "run-status", x: 0, y: 4, w: 12, h: 1 },
      { kind: "conversation", x: 0, y: 5, w: 6, h: 8 },
      { kind: "details", x: 0, y: 0, w: 12, h: 2 }
    ]);
  });

  it("applies and exposes the resizable work-item GridStack layout", () => {
    expect(applyWorkItemLayout([
      { id: "conversation", x: 0, y: 4, w: 7, h: 8 },
      { id: "details", x: 7, y: 4, w: 5, h: 8 }
    ])).toEqual([
      { kind: "kanban", x: 0, y: 0, w: 12, h: 4 },
      { kind: "run-status", x: 0, y: 4, w: 12, h: 1 },
      { kind: "conversation", x: 0, y: 5, w: 7, h: 8 },
      { kind: "details", x: 7, y: 5, w: 5, h: 8 }
    ]);
    expect(client).toContain('draggable: { handle: ".bees-flex-widget-handle, .bees-flex-widget-drag-surface", cancel: "a" }');
    expect(client).toContain("if (!element.gridstackNode) grid.makeWidget(element)");
    expect(client).toContain('preferences.set("workItemLayout"');
    expect(client).toContain('editing ? "Done" : "Edit layout"');
  });

  it("keeps headerless widget content identical while editing with a background drag handle", () => {
    const source = client.slice(client.indexOf("export function FlexibleGrid("), client.indexOf("export function GridStackPage("));
    const render = runInNewContext(source.replace("export function", "function") + "; FlexibleGrid", {
      h: (tag: string, props: any, ...children: any[]) => ({ tag, props, children }),
      useRef: (current: any) => ({ current }), useEffect: () => {}, HelpTooltip: () => {}
    });
    const props = {
      layout: [{ kind: "board", x: 0, y: 0, w: 12, h: 4 }, { kind: "named", x: 0, y: 4, w: 12, h: 4 }],
      panels: { board: { label: "Board", hideHeader: true, borderless: true, content: "Board content" },
        named: { label: "Visible title", content: "Named content" } }, onLayout: () => {}
    };
    const editing = render({ ...props, editing: true });
    expect(editing.children).toEqual(render({ ...props, editing: false }).children);
    const board = editing.children[0].children[0];
    expect(board.children[0]).toBeNull();
    expect(board.children[1].props.className).toContain("bees-flex-widget-drag-surface");
    expect(editing.children[1].children[0].children[0].tag).toBe("header");
  });

  it("inserts status below a saved Kanban and preserves the migrated layout on reload", () => {
    const migrated = workItemLayoutFrom([
      { kind: "kanban", x: 0, y: 0, w: 12, h: 6 },
      { kind: "conversation", x: 0, y: 6, w: 7, h: 8 },
      { kind: "details", x: 7, y: 6, w: 5, h: 8 }, null
    ]);
    expect(migrated.find(({ kind }: any) => kind === "run-status"))
      .toEqual({ kind: "run-status", x: 0, y: 6, w: 12, h: 1 });
    expect(migrated.filter(({ kind }: any) => ["conversation", "details"].includes(kind))
      .map(({ y }: any) => y)).toEqual([7, 7]);
    expect(workItemLayoutFrom(migrated)).toEqual(migrated);
  });

  it("preserves a compact status row when saving and reloading", () => {
    const layout = workItemLayoutFrom(undefined);
    const saved = applyWorkItemLayout(layout.map(({ kind, ...position }: any) => ({ id: kind, ...position })));
    expect(saved).toEqual(layout);
    expect(workItemLayoutFrom(saved)).toEqual(layout);
    expect(saved.find(({ kind }: any) => kind === "run-status")?.h).toBe(1);
  });

  it("sanitizes reusable fixed page layouts", () => {
    const defaults = [
      { kind: "top", x: 0, y: 0, w: 12, h: 4 },
      { kind: "bottom", x: 0, y: 4, w: 12, h: 4 }
    ];
    expect(fixedLayoutFrom(defaults, [{ kind: "top", x: 7, y: 2, w: 5, h: 6 }])).toEqual([
      { kind: "top", x: 7, y: 2, w: 5, h: 6 },
      { kind: "bottom", x: 0, y: 4, w: 12, h: 4 }
    ]);
    expect(applyFixedLayout(defaults, [{ id: "bottom", x: 0, y: 6, w: 8, h: 5 }])[1])
      .toEqual({ kind: "bottom", x: 0, y: 6, w: 8, h: 5 });
  });

  it("uses persisted GridStack pages for work, agents, and processes", () => {
    expect(client).toContain('layoutId: "work"');
    expect(client).toContain('{ kind: "active-work", x: 0, y: 0, w: 12, h: 6 }');
    expect(client).toContain('{ kind: "finished-work", x: 0, y: 6, w: 12, h: 6 }');
    expect(client).toContain('label: "Completed, archived & stopped"');
    expect(client).toContain('layoutId: "agents"');
    expect(client).not.toContain('layoutId: "agent-pool"');
    expect(client).toContain('layoutId: "processes"');
    expect(client).toContain('layoutId: "process-templates"');
    expect(client).toContain('preferences.set("pageLayouts"');
    expect(client).toContain('className: "bees-page-actions"');
    expect(client).not.toContain('className: "bees-flex-toolbar"');
  });
});
