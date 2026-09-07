import { GridStack } from "gridstack";
import { h, useEffect, useRef, useState } from "./runtime.js";
import { Button, HelpTooltip } from "./shared.js";
import { applyFixedLayout, fixedLayoutFrom, saveGridLayout } from "./dashboard-model.js";

const EMPTY_PAGE_LAYOUTS = Object.freeze({});

export function FlexibleGrid({ layout, editing, resizeAlways = false, onLayout, panels, className = "" }) {
  const root = useRef(null);
  const gridRef = useRef(null);
  const onLayoutRef = useRef(onLayout);
  onLayoutRef.current = onLayout;
  const visibleLayout = layout.filter(({ kind }) => panels[kind]);
  const layoutKey = visibleLayout.map(({ kind, x, y, w, h }) => `${kind}:${x}:${y}:${w}:${h}`).join("|");
  useEffect(() => {
    const grid = GridStack.init({
      column: 12,
      columnOpts: { breakpoints: [{ w: 780, c: 1 }] },
      cellHeight: 72,
      margin: 6,
      animate: true,
      disableDrag: !editing,
      disableResize: !(editing || resizeAlways),
      draggable: { handle: ".bees-flex-widget-handle, .bees-flex-widget-drag-surface", cancel: "a" },
      resizable: { handles: "e,se,s,sw,w" }
    }, root.current);
    if (!grid) return undefined;
    const save = () => {
      const value = saveGridLayout(grid);
      if (Array.isArray(value)) onLayoutRef.current(value);
    };
    // The stop event precedes GridStack's responsive-layout cache update.
    grid.on("dragstop resizestop", () => queueMicrotask(save));
    gridRef.current = grid;
    return () => { gridRef.current = null; grid.offAll().destroy(false); };
  }, []);
  useEffect(() => {
    gridRef.current?.enableMove(editing);
    gridRef.current?.enableResize(editing || resizeAlways);
  }, [editing, resizeAlways]);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    [...root.current.children].forEach((element) => {
      if (!element.gridstackNode) grid.makeWidget(element);
    });
    grid.load(visibleLayout.map(({ kind, ...position }) => ({ id: kind, ...position })));
  }, [layoutKey]);

  return h("div", { className: `grid-stack bees-flex-grid ${editing ? "editing" : ""} ${className}`.trim(), ref: root },
    ...visibleLayout.map((widget) => {
      const panel = panels[widget.kind];
      return h("section", {
        className: "grid-stack-item",
        key: widget.kind,
        "gs-id": widget.kind,
        "gs-x": widget.x,
        "gs-y": widget.y,
        "gs-w": widget.w,
        "gs-h": widget.h,
        "gs-min-w": panel.minW ?? 3,
        "gs-min-h": panel.minH ?? 2
      }, h("div", { className: `grid-stack-item-content bees-flex-widget ${panel.borderless ? "bees-flex-widget-borderless" : ""}` },
        !panel.hideHeader ? h("header", { className: "bees-flex-widget-handle" }, h("strong", null, panel.label), h("span", { style: { flex: 1 } }), h(HelpTooltip, { text: panel.helpText, examples: panel.helpExamples }),
          panel.actions ? h("div", { className: "bees-flex-widget-actions", onPointerDown: (event) => event.stopPropagation() }, panel.actions) : null) : null,
        h("div", { className: `bees-flex-widget-body${panel.hideHeader ? " bees-flex-widget-drag-surface" : ""}` }, panel.content)));
    })
  );
}

export function GridStackPage({ layoutId, defaults, panels, preference, preferences, setPageActions, pageActions, className = "", resizeAlways = false }) {
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [layoutId]);
  const layouts = preference.pageLayouts ?? EMPTY_PAGE_LAYOUTS;
  const layout = fixedLayoutFrom(defaults, layouts[layoutId]);
  const save = (value) => void preferences.set("pageLayouts", {
    ...layouts, [layoutId]: applyFixedLayout(defaults, value)
  });
  useEffect(() => {
    setPageActions(h("div", { className: "bees-page-actions" },
      pageActions,
      editing ? h(Button, { onClick: () => preferences.set("pageLayouts", { ...layouts, [layoutId]: [] }) }, "Reset") : null,
      h(Button, { className: editing ? "primary" : "", onClick: () => setEditing((value) => !value) }, editing ? "Done" : "Edit layout")));
    return () => setPageActions(null);
  }, [editing, layoutId, layouts, preferences, setPageActions, pageActions]);
  return h("div", { className: "bees-flex-page" },
    h(FlexibleGrid, { layout, editing, resizeAlways, onLayout: save, panels, className: `bees-page-grid ${className}`.trim() })
  );
}
