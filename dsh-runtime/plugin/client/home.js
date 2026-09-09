import { GridStack } from "gridstack";
import { h, useEffect, useRef, useState } from "./runtime.js";
import { ask, Button, confirmAction, Empty, HelpTooltip, openExternal, ProposalCard, useSubmit } from "./shared.js";
import { saveGridLayout, addDashboardWidget, applyDashboardLayout, dashboardsFrom } from "./dashboard-model.js";
import { NeedsYouWidget } from "./work.js";
import { AskBeesSetup, workFromOutcome } from "./ask-bees.js";

export function OutcomeWidget({ data, workspaceId, outcome, setOutcome, configureGoal, act, openWorkItem, openNeedsYou }) {
  const [error, setError] = useState("");
  const role = data.teams.find(({ id }) => id === data.workspaces.find((row) => row.id === workspaceId)?.teamId)?.role;
  const allowed = ["admin", "member"].includes(role);
  const [planId, setPlanId] = useState("");
  const [mode, setMode] = useState("");
  const [busy, submit] = useSubmit(async (event, plan = false) => {
    if (!allowed || !workspaceId || !outcome.trim()) return;
    setError(""); setPlanId(""); setMode(plan ? "plan" : "run");
    try {
      const result = await act(workFromOutcome(outcome, { workspaceId, plan }));
      if (result?.id) { setOutcome(""); openWorkItem(result.id); }
      else if (result?.executionId) setPlanId(result.executionId);
      else setError("Could not start this work. Please try again.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  });
  const plan = planId ? data.runs.find((row) => row.id === planId) : null;
  const ready = plan && plan.status !== "queued" && plan.status !== "running";
  // Planning answers with a run, not a work item, so the composer stands in for it until the plan
  // is ready: clearing the box on submit read as the click having done nothing.
  if (plan) return h("div", { className: "bees-stack" },
    h("strong", null, ready ? "Your plan is ready" : "Bees is planning this"),
    h("p", { className: "bees-muted" }, ready
      ? "Open it to see the process, agents and schedule Bees proposes, and approve or change it."
      : "Working out the process, agents, tools and schedule for this. It takes about a minute."),
    h("blockquote", { className: "bees-muted", style: { margin: 0, whiteSpace: "pre-wrap" } }, outcome),
    h("div", { className: "bees-card-actions" },
      ready ? h(Button, { className: "bees-btn-primary", onClick: () => { setOutcome(""); setPlanId(""); openNeedsYou?.(); } }, "Open the plan") : null,
      h(Button, { onClick: () => setPlanId("") }, ready ? "Ask for something else" : "Write another")));
  return h("form", {
    className: "bees-composer bees-dashboard-composer",
    onSubmit: submit
  },
    h("textarea", {
      className: "bees-composer-input",
      placeholder: workspaceId ? "e.g., Research top CRM software and draft a comparison report" : "Choose a team first",
      disabled: busy || !workspaceId || !allowed,
      "aria-label": "What would you like Bees to do?",
      value: outcome,
      onInput: (event) => setOutcome(event.target.value),
      onKeyDown: (event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          void submit(event);
        }
      }
    }),
    error ? h("p", { className: "bees-error", role: "alert" }, error) : null,
    h("div", { className: "bees-composer-foot", style: { flexWrap: "wrap" } },
      h("span", { className: "bees-composer-hint" }, "Goals with default agents · ⌘ / Ctrl + Enter"),
      h("div", { className: "bees-detail-actions" },
        h("button", { type: "submit", className: "bees-btn primary", disabled: busy || !allowed || !workspaceId || !outcome.trim() },
          busy && mode === "run" ? "Starting…" : "Run using defaults"),
        h(Button, { disabled: busy || !allowed || !workspaceId || !outcome.trim(), onClick: (event) => void submit(event, true) },
          busy && mode === "plan" ? "Planning…" : "Plan and do"),
        h(Button, { disabled: busy || !allowed || !workspaceId, onClick: configureGoal }, "Configure advanced")))
  );
}

function TemplatesWidget({ data, workspaceId, act, openWorkItem }) {
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  // creating a process is a real write, so a double click must not make two
  const [starting, setStarting] = useState("");
  const processes = data.processes.filter((row) => row.workspaceId === workspaceId && row.kind === "standard");
  const templates = (data.templates ?? []).filter((row) => row.workspaceId === workspaceId);
  const cards = [...templates.map((row) => ({ ...row, isTemplate: true })), ...processes.map((row) => ({ ...row, isTemplate: false }))];
  const visibleCards = showAllTemplates ? cards : cards.slice(0, 10);
  if (!cards.length) return h(Empty, null, workspaceId ? "No process templates available." : "Choose a team to see process templates.");
  return h("div", { className: "bees-home-templates" },
    ...visibleCards.map((card) => h("button", {
      className: "bees-template-card",
      disabled: Boolean(starting),
      onClick: async () => {
        if (starting) return;
        setStarting(card.id);
        try {
          if (card.isTemplate) {
            const p = await act({ action: "create_process", workspaceId, name: `New from ${card.name}`, templateId: card.id });
            if (p?.id) openWorkItem(null, p.id);
          } else {
            openWorkItem(null, card.id);
          }
        } finally { setStarting(""); }
      },
      key: card.id
    },
      h("div", { className: "bees-template-card-title" }, card.name),
      h("div", { className: "bees-template-card-meta" }, card.description || "Process template"))),
    cards.length > 10 && !showAllTemplates ? h(Button, { onClick: () => setShowAllTemplates(true) }, `Show all ${cards.length} process templates`) : null
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
    ["Needs you", rowsForRoute("waiting").length],
    ["Process runs", rowsForRoute("all-work").length],
    ["Process templates", rowsForRoute("all-processes").length],
    ["Agents", rowsForRoute("all-agents").length]
  ];
  return h("div", { className: "bees-dashboard-metrics" }, ...metrics.map(([label, value]) =>
    h("div", { className: "bees-dashboard-metric", key: label },
      h("strong", null, String(value)), h("span", null, label))));
}

function QuickActionsWidget({ workspaceId, createWork, createGoal, createProcess, createRun, createAgent }) {
  const actions = [
    ["New goal", createGoal], ["New work item", createWork], ["New process template", createProcess],
    ["Start process run", createRun], ["New agent", createAgent]
  ];
  return h("div", { className: "bees-dashboard-list" }, ...actions.map(([label, action]) =>
    h("button", { type: "button", className: "bees-btn bees-dashboard-row", key: label, disabled: !workspaceId, onClick: action }, label)));
}

function ProposalsWidget({ data, workspaceIds, act }) {
  const proposals = data.proposals.filter((row) => workspaceIds.includes(row.workspaceId) && row.status === "pending");
  if (!proposals.length) return null;
  return h("div", { className: "bees-dashboard-list" }, ...proposals.map((proposal) =>
    h(ProposalCard, { key: proposal.id, proposal,
      onApply: () => act({ action: "apply_proposal", proposalId: proposal.id }),
      onDismiss: () => act({ action: "reject_proposal", proposalId: proposal.id }) })));
}

const WIDGETS = [
  { kind: "outcome", label: "Ask Bees", description: "Create a goal from an outcome", w: 8, h: 5, component: OutcomeWidget , helpText: "Tell Bees what you want to achieve, and it will plan and execute the work to reach that outcome.", helpExamples: ["Research top CRM software and draft a comparison report","Launch the new marketing website","Summarize the latest product feedback"]},
  { kind: "quick-actions", label: "Quick actions", description: "Create work, goals, process templates, process runs, and agents", w: 4, h: 5, component: QuickActionsWidget , helpText: "Shortcuts to create new items in your workspace quickly.", helpExamples: []},
  { kind: "metrics", label: "Metrics", description: "Key team counts", w: 12, h: 3, component: MetricsWidget , helpText: "Quick overview of your team's activity and current capacity.", helpExamples: []},
  { kind: "waiting", label: "Needs your attention", description: "Blocked and waiting work", route: "waiting", limit: 8, w: 6, h: 4, component: NeedsYouWidget , helpText: "Work items that are blocked and waiting for your input, approval, or intervention.", helpExamples: ["An agent needs your approval before sending an email","A process requires you to answer a clarifying question","A task failed and needs your attention to retry"]},
  { kind: "recent-work", label: "Recent process runs", description: "Latest active process runs", route: "all-work", limit: 8, w: 6, h: 4, component: ListWidget , helpText: "The most recently active process runs in your workspace.", helpExamples: []},
  { kind: "all-work", label: "Process runs", description: "Active process runs", route: "all-work", w: 6, h: 5, component: ListWidget , helpText: "Active process runs. These act as Kanban boards where work items move through stages.", helpExamples: ["Track the status of the 'Weekly Newsletter' process","See which agent is working on the 'Bug Triage' run"]},
  { kind: "goals", label: "Goals", description: "Current goals", route: "goals", w: 6, h: 5, component: ListWidget , helpText: "High-level outcomes you've asked Bees to achieve. Bees handles the step-by-step planning.", helpExamples: ["Migrate the database to the new server","Prepare the Q3 financial report"]},
  { kind: "completed", label: "Completed process runs", description: "Recently completed process runs", route: "completed", w: 6, h: 5, component: ListWidget , helpText: "Process runs that have finished successfully or failed.", helpExamples: []},
  { kind: "templates", label: "Process templates", description: "Reusable process definitions", w: 4, h: 5, component: TemplatesWidget , helpText: "Reusable definitions for your common processes. They define the stages and agents used for repeatable work.", helpExamples: ["Employee Onboarding process","Blog Post Publication process","Weekly Report Generation"]},
  { kind: "processes", label: "Process templates", description: "Reusable process definitions", route: "all-processes", w: 6, h: 5, component: ListWidget , helpText: "Reusable definitions for your common processes. They define the stages and agents used for repeatable work.", helpExamples: ["Employee Onboarding process","Blog Post Publication process","Weekly Report Generation"]},
  { kind: "agents", label: "Agents", description: "Team agents", route: "all-agents", w: 6, h: 5, component: ListWidget , helpText: "The AI workers available in your team.", helpExamples: []},
  { kind: "agent-presets", label: "Agent presets", description: "Reusable agent presets", route: "presets", w: 6, h: 5, component: ListWidget , helpText: "Reusable configurations to quickly spawn new agents with specific skills.", helpExamples: []},
  { kind: "mcp-servers", label: "MCP servers", description: "Connected MCP servers", route: "mcp", w: 6, h: 5, component: ListWidget , helpText: "Connected Model Context Protocol servers that give your agents access to external tools and data.", helpExamples: ["A GitHub MCP server to read repositories","A Postgres MCP server to query your database","A Slack MCP server to send messages"]},
  { kind: "files", label: "Files & folders", description: "Team locations", route: "locations", w: 6, h: 5, component: ListWidget , helpText: "Folders and files connected to your workspace.", helpExamples: []},
  { kind: "knowledge-sources", label: "Knowledge sources", description: "Approved knowledge locations", route: "sources", w: 6, h: 5, component: ListWidget , helpText: "Approved locations where Bees indexes knowledge for your agents.", helpExamples: []},
  { kind: "runs", label: "Executions", description: "Recent agent executions", route: "runs", w: 6, h: 5, component: ListWidget , helpText: "Recent individual agent executions.", helpExamples: []},
  { kind: "artifacts", label: "Artifacts", description: "Outputs from completed executions", route: "artifacts", w: 6, h: 5, component: ListWidget , helpText: "Outputs produced by completed agent executions.", helpExamples: []},
];

const widgetByKind = new Map(WIDGETS.map((widget) => [widget.kind, widget]));

function DashboardGrid({ dashboard, editing, onLayout, onRemove, widgetProps }) {
  const root = useRef(null);
  const gridRef = useRef(null);
  // The grid outlives the render that set it up, so the save has to read the current handler.
  const onLayoutRef = useRef(onLayout);
  onLayoutRef.current = onLayout;
  const widgetKey = dashboard.widgets.map(({ kind }) => kind).join("|");
  const layoutKey = dashboard.widgets.map(({ kind, x, y, w, h }) => `${kind}:${x}:${y}:${w}:${h}`).join("|");
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
      const layout = saveGridLayout(grid);
      if (Array.isArray(layout)) onLayoutRef.current(layout);
    };
    // The stop event precedes GridStack's responsive-layout cache update.
    grid.on("dragstop resizestop", () => queueMicrotask(save));
    gridRef.current = grid;
    return () => { gridRef.current = null; grid.offAll().destroy(false); };
  }, [dashboard.id, widgetKey]);
  useEffect(() => {
    gridRef.current?.enableMove(editing);
    gridRef.current?.enableResize(editing);
  }, [editing]);
  useEffect(() => {
    gridRef.current?.load(dashboard.widgets.map(({ kind, ...position }) => ({ id: kind, ...position })));
  }, [layoutKey]);

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
          h("strong", null, definition?.label ?? widget.kind), h("span", { style: { flex: 1 } }), h(HelpTooltip, { text: definition?.helpText, examples: definition?.helpExamples }),
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

export function Home({ ctx, data, workspaceId, workspaceIds, act, openWorkItem, openNeedsYou, navigate, rowsForRoute, preference, preferences, setPageActions, createWork, createGoal, createProcess, createRun, createAgent, capabilities }) {
  const [outcome, setOutcome] = useState("");
  const [setup, setSetup] = useState(false);
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
  const widgetProps = { ctx, data, workspaceId, workspaceIds, act, openWorkItem, openNeedsYou, navigate, rowsForRoute, createWork, createGoal, createProcess, createRun, createAgent,
    outcome, setOutcome, configureGoal: () => setSetup(true) };

  useEffect(() => {
    if (setup) { setPageActions(null); return; }
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
  }, [setup, editing, preference.activeDashboardId, preference.dashboards, setPageActions]);

  return h("div", null,
    setup ? h("div", null, h(AskBeesSetup, {
      key: workspaceId, ctx, data, workspaceId, outcome, onOutcome: setOutcome, act, capabilities,
      onBack: () => setSetup(false), onStarted: (id) => { setSetup(false); setOutcome(""); openWorkItem(id); }
    })) : null,
    h("div", { className: "bees-dashboard", hidden: setup },
    h(ProposalsWidget, { data, workspaceIds: [workspaceId], act }),
    dashboard.widgets.length ? h(DashboardGrid, {
      dashboard,
      editing,
      widgetProps,
      onLayout: (layout) => saveDashboard(applyDashboardLayout(dashboard, layout)),
      onRemove: (kind) => saveDashboard({ ...dashboard, widgets: dashboard.widgets.filter((widget) => widget.kind !== kind) })
    }) : h(Empty, null, editing ? "Add a widget to build this dashboard." : "This dashboard is empty. Choose Edit to add widgets."))
  );
}

export function GuidePage() {
  const guides = [
    ["Getting started", "Create an organization and team, connect AI, then start your first process run.", () => void openExternal("https://bees.bot/help/getting-started")],
    ["Understanding Bees", "Learn organizations, teams, process templates, process runs, work items, executions, and schedules.", () => void openExternal("https://bees.bot/help/understanding-basics")],
    ["Loop Engineering", "See how Goals, stages, peer delegation, review, retries, and recovery work together.", () => void openExternal("https://bees.bot/help/loop-engineering")],
    ["Graph workflow", "Learn why business state drives routing and the graph remains a derived view.", () => void openExternal("https://bees.bot/help/graph-workflow")],
    ["Human in the loop", "Understand questions, protected-action approval, completed-work review, and manual stages.", () => void openExternal("https://bees.bot/help/human-in-the-loop")],
    ["Self-improving agents", "See how scheduled specialists inherit, learn, version, undo, and reset guidance.", () => void openExternal("https://bees.bot/help/self-improving-agents")],
    ["Company Brain", "Use logical team locations, local indexes, and local execution for shared company knowledge.", () => void openExternal("https://bees.bot/help/company-brain")],
    ["Privacy", "See exactly what synchronizes and what stays on each desktop.", () => void openExternal("https://bees.bot/help/privacy")],
    ["Scheduling", "Create recurring process runs and manage timing, overlaps, approvals, and specialist learning.", () => void openExternal("https://bees.bot/help/scheduling"), "Open Scheduling guide"],
    ["Architecture panel", "Build a multi-model discussion with independent roles and human sign-off.", () => void openExternal("https://bees.bot/help/software-development"), "Open Architecture Panel guide"]
  ];
  return h("div", { className: "bees-stack" },
    h("div", { className: "bees-callout" }, h("h3", null, "Bees documentation"),
      h("div", null, "The website help center is the canonical guide to Bees. Open a topic below for the current product model and instructions.")),
    h("div", { className: "bees-grid bees-help-grid" },
      ...guides.map(([title, description, open, buttonLabel = "Open guide"]) => h("section", { className: "bees-box", key: title },
        h("h3", null, title), h("p", null, description),
        h(Button, { onClick: open }, buttonLabel)))
    ),
    h(Button, { className: "primary", onClick: () => void openExternal("https://bees.bot/help/") }, "Open all documentation")
  );
}
