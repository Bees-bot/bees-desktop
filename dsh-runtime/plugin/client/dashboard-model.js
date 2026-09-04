const COLUMNS = 12;

const DEFAULT_WIDGETS = [
  { kind: "metrics", x: 0, y: 0, w: 12, h: 3 },
  { kind: "outcome", x: 0, y: 3, w: 8, h: 5 },
  { kind: "quick-actions", x: 8, y: 3, w: 4, h: 5 },
  { kind: "waiting", x: 0, y: 8, w: 6, h: 4 },
  { kind: "recent-work", x: 6, y: 8, w: 6, h: 4 }
];

const DEFAULT_WORK_ITEM_WIDGETS = [
  { kind: "kanban", x: 0, y: 0, w: 12, h: 4 },
  { kind: "run-status", x: 0, y: 4, w: 12, h: 2 },
  { kind: "conversation", x: 0, y: 6, w: 6, h: 8 },
  { kind: "details", x: 6, y: 6, w: 6, h: 8 }
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
    h: number(value.h, 4, 2, 20)
  };
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
      widgets
    });
  }
  if (!dashboardIds.has("home")) dashboards.unshift(defaultDashboard());
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
