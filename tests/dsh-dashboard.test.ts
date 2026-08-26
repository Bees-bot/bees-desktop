import { describe, expect, it } from "vitest";
// @ts-expect-error The DSH browser client is intentionally plain JavaScript.
import { addDashboardWidget, applyDashboardLayout, applyFixedLayout, applyWorkItemLayout, dashboardsFrom, fixedLayoutFrom, workItemLayoutFrom } from "../dsh-runtime/plugin/client/dashboard-model.js";
import { clientBundle, clientSource as client } from "./client-source.js";

describe("personal dashboards", () => {
  it("provides the default Home layout without writing settings", () => {
    const dashboards = dashboardsFrom(undefined);
    expect(dashboards).toHaveLength(1);
    expect(dashboards[0]).toMatchObject({ id: "home", name: "Home" });
    expect(dashboards[0].widgets.map((widget: { kind: string }) => widget.kind))
      .toEqual(["outcome", "templates", "waiting", "recent-work"]);
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
  });

  it("provides and sanitizes the fixed work-item layout", () => {
    expect(workItemLayoutFrom(undefined)).toEqual([
      { kind: "kanban", x: 0, y: 0, w: 12, h: 4 },
      { kind: "conversation", x: 0, y: 4, w: 6, h: 8 },
      { kind: "details", x: 6, y: 4, w: 6, h: 8 }
    ]);
    expect(workItemLayoutFrom([
      { kind: "details", x: 50, y: -1, w: 50, h: 1 },
      { kind: "unknown", x: 0, y: 0, w: 2, h: 2 }
    ])).toEqual([
      { kind: "kanban", x: 0, y: 0, w: 12, h: 4 },
      { kind: "conversation", x: 0, y: 4, w: 6, h: 8 },
      { kind: "details", x: 0, y: 0, w: 12, h: 2 }
    ]);
  });

  it("applies and exposes the resizable work-item GridStack layout", () => {
    expect(applyWorkItemLayout([
      { id: "conversation", x: 0, y: 4, w: 7, h: 8 },
      { id: "details", x: 7, y: 4, w: 5, h: 8 }
    ])).toEqual([
      { kind: "kanban", x: 0, y: 0, w: 12, h: 4 },
      { kind: "conversation", x: 0, y: 4, w: 7, h: 8 },
      { kind: "details", x: 7, y: 4, w: 5, h: 8 }
    ]);
    expect(client).toContain('draggable: { handle: ".bees-flex-widget-handle" }');
    expect(client).toContain('preferences.set("workItemLayout"');
    expect(client).toContain('editing ? "Done" : "Edit layout"');
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
    expect(client).toContain('layoutId: "agent-pool"');
    expect(client).toContain('layoutId: "processes"');
    expect(client).toContain('layoutId: "process-templates"');
    expect(client).toContain('layoutId: "process-detail"');
    expect(client).toContain('preferences.set("pageLayouts"');
    expect(client).toContain('className: "bees-page-actions"');
    expect(client).not.toContain('className: "bees-flex-toolbar"');
    expect(client).toContain('h("div", { className: "bees-grow" }),\n        pageActions,\n        h(ThemeToggle');
  });
});
