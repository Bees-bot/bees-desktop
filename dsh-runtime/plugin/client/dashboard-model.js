const COLUMNS = 12;

export const DEFAULT_WIDGETS = [
  { kind: "outcome", x: 0, y: 0, w: 12, h: 4 },
  { kind: "metrics", x: 0, y: 4, w: 12, h: 2 },
  { kind: "waiting", x: 0, y: 6, w: 5, h: 6 },
  { kind: "recent-work", x: 5, y: 6, w: 7, h: 6 },
  { kind: "completed", x: 0, y: 12, w: 12, h: 6 },
  { kind: "goals", x: 0, y: 18, w: 6, h: 5 },
  { kind: "runs", x: 6, y: 18, w: 6, h: 5 }
];

const DEFAULT_WORK_ITEM_WIDGETS = [
  { kind: "kanban", x: 0, y: 0, w: 12, h: 4 },
  { kind: "run-status", x: 0, y: 4, w: 12, h: 1 },
  { kind: "conversation", x: 0, y: 5, w: 6, h: 8 },
  { kind: "details", x: 6, y: 5, w: 6, h: 8 }
];

const number = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
};

function normalizeWidget(value) {
  const kind = typeof value?.kind === "string" ? value.kind.trim().slice(0, 80) : "";
  if (!kind) return null;
  const w = number(value.w, 4, 1, COLUMNS);
  return {
    kind,
    x: Math.min(number(value.x, 0, 0, COLUMNS - 1), COLUMNS - w),
    y: number(value.y, 0, 0, 1000),
    w,
    h: number(value.h, 4, kind === "run-status" ? 1 : 2, 20)
  };
}

/** A saved layout can carry boxes that sit on top of each other; GridStack paints them overlapping
 *  rather than moving them, so a widget ends up half hidden under its neighbour. */
function withoutOverlap(widgets) {
  const placed = new Map();
  for (const widget of [...widgets].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let y = widget.y;
    while ([...placed.values()].some((other) => other.x < widget.x + widget.w && widget.x < other.x + other.w
      && other.y < y + widget.h && y < other.y + other.h)) y += 1;
    placed.set(widget.kind, { ...widget, y });
  }
  return widgets.map((widget) => placed.get(widget.kind));
}

const defaultDashboard = () => ({
  id: "home",
  name: "Home",
  widgets: DEFAULT_WIDGETS.map((widget) => ({ ...widget }))
});

export function dashboardsFrom(value) {
  const dashboards = [];
  const dashboardIds = new Set();
  for (const candidate of Array.isArray(value) ? value : []) {
    const id = typeof candidate?.id === "string" ? candidate.id.trim().slice(0, 120) : "";
    if (!id || dashboardIds.has(id) || dashboards.length >= 20) continue;
    const widgets = [];
    const widgetKinds = new Set();
    for (const candidateWidget of Array.isArray(candidate.widgets) ? candidate.widgets : []) {
      const widget = normalizeWidget(candidateWidget);
      if (!widget || widgetKinds.has(widget.kind) || widgets.length >= 30) continue;
      widgetKinds.add(widget.kind);
      widgets.push(widget);
    }
    dashboardIds.add(id);
    dashboards.push({
      id,
      name: String(candidate.name ?? "Untitled dashboard").trim().slice(0, 80) || "Untitled dashboard",
      widgets: withoutOverlap(widgets)
    });
  }
    if (!dashboardIds.has("home")) dashboards.unshift(defaultDashboard());
  else {
    const homeDash = dashboards.find(d => d.id === "home");
    // Force migration if they have the old default layout
    if (homeDash && (homeDash.widgets.some(w => w.kind === "quick-actions") || homeDash.widgets.find(w => w.kind === "waiting")?.h === 9 || homeDash.widgets.find(w => w.kind === "metrics")?.h === 3 && homeDash.widgets.find(w => w.kind === "outcome")?.h === 4)) {
      homeDash.widgets = DEFAULT_WIDGETS.map(widget => ({ ...widget }));
    }
  }
  return dashboards.slice(0, 20);
}

export function addDashboardWidget(dashboard, definition) {
  if (dashboard.widgets.some(({ kind }) => kind === definition.kind)) return dashboard;
  const y = dashboard.widgets.reduce((bottom, widget) => Math.max(bottom, widget.y + widget.h), 0);
  const widget = normalizeWidget({ kind: definition.kind, x: 0, y, w: definition.w, h: definition.h });
  return widget ? { ...dashboard, widgets: [...dashboard.widgets, widget] } : dashboard;
}

export function applyDashboardLayout(dashboard, layout) {
  const positions = new Map((Array.isArray(layout) ? layout : []).map((item) => [String(item.id ?? ""), item]));
  return {
    ...dashboard,
    widgets: dashboard.widgets.map((widget) => normalizeWidget({ ...widget, ...positions.get(widget.kind), kind: widget.kind }) ?? widget)
  };
}

export function fixedLayoutFrom(defaults, value) {
  const saved = new Map();
  for (const candidate of Array.isArray(value) ? value : []) {
    const widget = normalizeWidget(candidate);
    if (widget && defaults.some(({ kind }) => kind === widget.kind) && !saved.has(widget.kind)) {
      saved.set(widget.kind, widget);
    }
  }
  return defaults.map((widget) => normalizeWidget({
    ...widget, ...saved.get(widget.kind), kind: widget.kind
  }) ?? { ...widget });
}

export function applyFixedLayout(defaults, layout) {
  const positions = new Map((Array.isArray(layout) ? layout : []).map((item) => [String(item.id ?? ""), item]));
  return fixedLayoutFrom(defaults, defaults.map((widget) => ({
    ...widget, ...positions.get(widget.kind), kind: widget.kind
  })));
}

export function workItemLayoutFrom(value) {
  // Explicit arrangements, including ones matching an older default, are authoritative.
  const widgets = fixedLayoutFrom(DEFAULT_WORK_ITEM_WIDGETS, value);
  if (!Array.isArray(value) || !value.length || value.some((widget) => widget?.kind === "run-status")) return widgets;
  const kanban = widgets.find(({ kind }) => kind === "kanban");
  const status = widgets.find(({ kind }) => kind === "run-status");
  status.y = kanban.y + kanban.h;
  for (const widget of widgets) {
    if (!["kanban", "run-status"].includes(widget.kind) && widget.y + widget.h > status.y) {
      widget.y = Math.max(widget.y, status.y + status.h);
    }
  }
  return widgets;
}
export const applyWorkItemLayout = (layout) => workItemLayoutFrom(
  (Array.isArray(layout) ? layout : []).map((widget) => ({ ...widget, kind: widget?.id }))
);

// GridStack omits dimensions equal to its minimums; our persisted layout needs explicit values.
export const saveGridLayout = (grid) => grid.save(false, false, (_node, widget) => {
  widget.w ??= widget.minW ?? 1;
  widget.h ??= widget.minH ?? 1;
});
