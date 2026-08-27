import { GridStack } from "gridstack";
import { h, useEffect, useRef, useState } from "./runtime.js";
import { ask, Button, confirmAction, Empty } from "./shared.js";
import { addDashboardWidget, applyDashboardLayout, dashboardsFrom } from "./dashboard-model.js";
import { NeedsYouWidget } from "./work.js";

function OutcomeWidget({ workspaceId, act, openWorkItem }) {
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (!workspaceId || !outcome.trim()) return;
    setBusy(true); setError("");
    try {
      const text = outcome.trim();
      const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
      const title = lines[0].length > 60 ? `${lines[0].substring(0, 57)}...` : lines[0];
      const created = await act({ action: "create_goal", workspaceId, title, description: text, priority: "normal" });
      if (created?.id) openWorkItem(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return h("form", {
    className: "bees-composer bees-dashboard-composer",
    onSubmit: (event) => { event.preventDefault(); void submit(); }
  },
    h("textarea", {
      className: "bees-composer-input",
      placeholder: workspaceId ? "e.g., Research top CRM software and draft a comparison report" : "Choose a workspace first",
      disabled: !workspaceId || busy,
      value: outcome,
      onInput: (event) => setOutcome(event.target.value),
      onKeyDown: (event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault(); void submit();
        }
      }
    }),
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
    h("div", { className: "bees-composer-foot" },
      h("span", { className: "bees-composer-hint" }, "Press ⌘ + Enter to start"),
      h("button", { className: "bees-btn primary", disabled: !workspaceId || !outcome.trim() || busy }, busy ? "Starting..." : "Ask Bees"))
  );
}

function TemplatesWidget({ data, workspaceId, act, openWorkItem }) {
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const processes = data.processes.filter((row) => row.workspaceId === workspaceId && row.kind === "standard");
  const templates = (data.templates ?? []).filter((row) => row.workspaceId === workspaceId);
  const cards = [...templates.map((row) => ({ ...row, isTemplate: true })), ...processes.map((row) => ({ ...row, isTemplate: false }))];
  const visibleCards = showAllTemplates ? cards : cards.slice(0, 10);
  if (!cards.length) return h(Empty, null, workspaceId ? "No templates available." : "Choose a workspace to see templates.");
  return h("div", { className: "bees-home-templates" },
    ...visibleCards.map((card) => h("button", {
      className: "bees-template-card",
      onClick: async () => {
        if (card.isTemplate) {
          const p = await act({ action: "create_process", workspaceId, name: `New from ${card.name}`, templateId: card.id });
          if (p?.id) openWorkItem(null, p.id);
        } else {
          openWorkItem(null, card.id);
        }
      },
      key: card.id
    },
      h("div", { className: "bees-template-card-title" }, card.name),
      h("div", { className: "bees-template-card-meta" }, card.description || (card.isTemplate ? "Template" : "Process")))),
    cards.length > 10 && !showAllTemplates ? h(Button, { onClick: () => setShowAllTemplates(true) }, `Show all ${cards.length} templates`) : null
  );
}

function ListWidget({ definition, rowsForRoute, navigate }) {
  const rows = rowsForRoute(definition.route).slice(0, definition.limit ?? 20);
  return h("div", { className: "bees-dashboard-list" },
    rows.length ? rows.map((row) => h("button", {
      className: "bees-dashboard-row", key: row.id, onClick: row.open, title: row.label
    }, row.label)) : h(Empty, null, definition.empty ?? "Nothing here yet."),
    h(Button, { className: "bees-dashboard-view-all", onClick: () => navigate(definition.route) }, "View all")
  );
}

function MetricsWidget({ rowsForRoute }) {
  const metrics = [
    ["Active work", rowsForRoute("all-work").length],
    ["Needs you", rowsForRoute("waiting").length],
    ["Processes", rowsForRoute("all-processes").length],
    ["Agents", rowsForRoute("all-agents").length]
  ];
  return h("div", { className: "bees-dashboard-metrics" }, ...metrics.map(([label, value]) =>
    h("div", { className: "bees-dashboard-metric", key: label },
      h("strong", null, String(value)), h("span", null, label))));
}

function ProposalsWidget({ data, workspaceIds, act }) {
  const proposals = (data.proposals ?? []).filter((row) => workspaceIds.includes(row.workspaceId) && row.status === "pending");
  if (!proposals.length) return h(Empty, null, "No proposals waiting for review.");
  return h("div", { className: "bees-dashboard-list" }, ...proposals.map((proposal) =>
    h("article", { className: "bees-dashboard-proposal", key: proposal.id },
      h("strong", null, proposal.title),
      proposal.summary ? h("p", { className: "bees-muted" }, proposal.summary) : null,
      h("div", { className: "bees-card-actions" },
        h(Button, { className: "primary", onClick: () => act({ action: "apply_proposal", proposalId: proposal.id }) }, "Apply"),
        h(Button, { onClick: () => act({ action: "reject_proposal", proposalId: proposal.id }) }, "Dismiss")))));
}

const WIDGETS = [
  { kind: "outcome", label: "Ask Bees", description: "Create a goal from an outcome", w: 8, h: 5, component: OutcomeWidget },
  { kind: "metrics", label: "Metrics", description: "Key workspace counts", w: 12, h: 3, component: MetricsWidget },
  { kind: "waiting", label: "Needs your attention", description: "Blocked and waiting work", route: "waiting", limit: 8, w: 6, h: 4, component: NeedsYouWidget },
  { kind: "recent-work", label: "Recent work", description: "Latest active work items", route: "all-work", limit: 8, w: 6, h: 4, component: ListWidget },
  { kind: "all-work", label: "All work", description: "Active work items", route: "all-work", w: 6, h: 5, component: ListWidget },
  { kind: "goals", label: "Goals", description: "Current goals", route: "goals", w: 6, h: 5, component: ListWidget },
  { kind: "completed", label: "Completed work", description: "Recently completed work", route: "completed", w: 6, h: 5, component: ListWidget },
  { kind: "templates", label: "Templates", description: "Processes and reusable templates", w: 4, h: 5, component: TemplatesWidget },
  { kind: "processes", label: "Processes", description: "Active processes", route: "all-processes", w: 6, h: 5, component: ListWidget },
  { kind: "agents", label: "Agents", description: "Workspace agents", route: "all-agents", w: 6, h: 5, component: ListWidget },
  { kind: "files", label: "Files & folders", description: "Team locations", route: "locations", w: 6, h: 5, component: ListWidget },
  { kind: "runs", label: "Runs", description: "Recent agent runs", route: "runs", w: 6, h: 5, component: ListWidget },
  { kind: "artifacts", label: "Artifacts", description: "Outputs from completed runs", route: "artifacts", w: 6, h: 5, component: ListWidget },
  { kind: "proposals", label: "Proposals", description: "Changes awaiting review", w: 6, h: 5, component: ProposalsWidget }
];

const widgetByKind = new Map(WIDGETS.map((widget) => [widget.kind, widget]));

function DashboardGrid({ dashboard, editing, onLayout, onRemove, widgetProps }) {
  const root = useRef(null);
  const gridRef = useRef(null);
  const widgetKey = dashboard.widgets.map(({ kind }) => kind).join("|");
  useEffect(() => {
    const grid = GridStack.init({
      column: 12,
      columnOpts: { breakpoints: [{ w: 700, c: 1 }, { w: 1000, c: 6 }] },
      cellHeight: 72,
      margin: 6,
      animate: true,
      disableDrag: !editing,
      disableResize: !editing,
      draggable: { handle: ".bees-dashboard-widget-handle" },
      resizable: { handles: "e,se,s,sw,w" }
    }, root.current);
    if (!grid) return undefined;
    const save = () => {
      const layout = grid.save(false);
      if (Array.isArray(layout)) onLayout(layout);
    };
    grid.on("dragstop resizestop", save);
    gridRef.current = grid;
    return () => { gridRef.current = null; grid.offAll().destroy(false); };
  }, [dashboard.id, widgetKey]);
  useEffect(() => {
    gridRef.current?.enableMove(editing);
    gridRef.current?.enableResize(editing);
  }, [editing]);

  return h("div", { className: `grid-stack bees-dashboard-grid ${editing ? "editing" : ""}`, ref: root },
    ...dashboard.widgets.map((widget) => {
      const definition = widgetByKind.get(widget.kind);
      const Component = definition?.component;
      return h("section", {
        className: "grid-stack-item",
        key: widget.kind,
        "gs-id": widget.kind,
        "gs-x": widget.x,
        "gs-y": widget.y,
        "gs-w": widget.w,
        "gs-h": widget.h
      }, h("div", { className: "grid-stack-item-content bees-dashboard-widget" },
        h("header", { className: "bees-dashboard-widget-handle" },
          h("strong", null, definition?.label ?? widget.kind),
          editing ? h("button", {
            type: "button", className: "bees-dashboard-remove", title: `Remove ${definition?.label ?? widget.kind}`,
            "aria-label": `Remove ${definition?.label ?? widget.kind}`,
            onPointerDown: (event) => event.stopPropagation(), onClick: () => onRemove(widget.kind)
          }, "×") : null),
        h("div", { className: "bees-dashboard-widget-body" },
          Component ? h(Component, { ...widgetProps, definition }) : h(Empty, null, "This widget is no longer available."))));
    })
  );
}

const newDashboardId = () => globalThis.crypto?.randomUUID?.() ?? `dashboard-${Date.now()}`;

export function Home({ ctx, data, workspaceId, workspaceIds, act, openWorkItem, openNeedsYou, navigate, rowsForRoute, preference, preferences, setPageActions }) {
  const dashboards = dashboardsFrom(preference.dashboards);
  const activeId = dashboards.some(({ id }) => id === preference.activeDashboardId) ? preference.activeDashboardId : "home";
  const dashboard = dashboards.find(({ id }) => id === activeId) ?? dashboards[0];
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [dashboard.id]);
  const saveDashboard = (nextDashboard) => {
    void preferences.set("dashboards", dashboards.map((candidate) => candidate.id === dashboard.id ? nextDashboard : candidate));
  };
  const createDashboard = async () => {
    if (dashboards.length >= 20) return;
    const name = await ask("Dashboard name", "New dashboard");
    if (!name) return;
    const created = { id: newDashboardId(), name, widgets: dashboard.widgets.map((widget) => ({ ...widget })) };
    await preferences.set("dashboards", [...dashboards, created]);
    await preferences.set("activeDashboardId", created.id);
  };
  const renameDashboard = async () => {
    const name = await ask("Dashboard name", dashboard.name);
    if (name) saveDashboard({ ...dashboard, name });
  };
  const deleteDashboard = async () => {
    if (dashboard.id === "home" || !(await confirmAction(`Delete “${dashboard.name}”?`))) return;
    await preferences.set("dashboards", dashboards.filter(({ id }) => id !== dashboard.id));
    await preferences.set("activeDashboardId", "home");
  };
  const addWidget = (definition, event) => {
    saveDashboard(addDashboardWidget(dashboard, definition));
    event.currentTarget.closest("details")?.removeAttribute("open");
  };
  const availableWidgets = WIDGETS.filter(({ kind }) => !dashboard.widgets.some((widget) => widget.kind === kind));
  const widgetProps = { ctx, data, workspaceId, workspaceIds, act, openWorkItem, openNeedsYou, navigate, rowsForRoute };

  useEffect(() => {
    setPageActions(h("div", { className: "bees-page-actions" },
      h(Button, { onClick: createDashboard, disabled: dashboards.length >= 20 }, "+ Dashboard"),
      editing ? h("details", { className: "bees-dashboard-add" },
        h("summary", { className: "bees-btn" }, "+ Widget"),
        h("div", { className: "bees-dashboard-widget-menu" },
          availableWidgets.length ? availableWidgets.map((definition) => h("button", {
            type: "button", key: definition.kind, onClick: (event) => addWidget(definition, event)
          }, h("strong", null, definition.label), h("span", null, definition.description)))
            : h("div", { className: "bees-muted" }, "Every widget is already on this dashboard."))
      ) : null,
      editing ? h(Button, { onClick: renameDashboard }, "Rename") : null,
      editing && dashboard.id !== "home" ? h(Button, { className: "danger", onClick: deleteDashboard }, "Delete") : null,
      h(Button, { className: editing ? "primary" : "", onClick: () => setEditing((value) => !value) }, editing ? "Done" : "Edit")));
    return () => setPageActions(null);
  }, [editing, preference.activeDashboardId, preference.dashboards, setPageActions]);

  return h("div", { className: "bees-dashboard" },
    dashboard.widgets.length ? h(DashboardGrid, {
      dashboard,
      editing,
      widgetProps,
      onLayout: (layout) => saveDashboard(applyDashboardLayout(dashboard, layout)),
      onRemove: (kind) => saveDashboard({ ...dashboard, widgets: dashboard.widgets.filter((widget) => widget.kind !== kind) })
    }) : h(Empty, null, editing ? "Add a widget to build this dashboard." : "This dashboard is empty. Choose Edit to add widgets.")
  );
}

export function GuidePage() {
  return h("div", { className: "bees-stack" },
    h("div", { className: "bees-callout" }, h("h3", null, "Bees in one sentence"),
      h("div", null, "Tell Bees the outcome, choose the repeatable path, and let agents move the work through it.")),
    h("div", { className: "bees-grid bees-help-grid" },
      h("section", { className: "bees-box" }, h("h3", null, "Goal = the outcome"),
        h("p", null, "Use a goal when you care about the result but do not want to plan every task."),
        h("p", { className: "bees-muted" }, "Example: “Launch the new website.” Bees may create or coordinate several work items to reach it.")),
      h("section", { className: "bees-box" }, h("h3", null, "Work item = one piece of work"),
        h("p", null, "Use a work item for one concrete deliverable that follows a process."),
        h("p", { className: "bees-muted" }, "Example: “Write the launch announcement.” It moves through Draft → Review → Done.")),
      h("section", { className: "bees-box" }, h("h3", null, "Process = the path"),
        h("p", null, "A process is a live sequence of stages that routes real work to agents."),
        h("p", { className: "bees-muted" }, "Create one when work should repeatedly follow the same handoffs.")),
      h("section", { className: "bees-box" }, h("h3", null, "Template = a saved blueprint"),
        h("p", null, "A template remembers a process design but runs nothing."),
        h("p", { className: "bees-muted" }, "Create one directly under Processes → Templates, or save an existing process as a template.")),
      h("section", { className: "bees-box" }, h("h3", null, "Agent pool = interchangeable agents"),
        h("p", null, "Use a pool when several agents can handle the same stage and Bees may choose any available match."),
        h("p", { className: "bees-muted" }, "Use one named agent when context, ownership, or continuity matters.")),
      h("section", { className: "bees-box" }, h("h3", null, "Needs you = blocked work"),
        h("p", null, "This queue collects questions, approvals, failures, and other work an agent cannot continue alone."),
        h("p", { className: "bees-muted" }, "It is not a stage and you do not assign an agent to it. Assign agents on a process stage or override one on the work item."))
    )
  );
}
