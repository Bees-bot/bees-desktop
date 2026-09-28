import { h, React, useEffect, useState } from "./runtime.js";
import { accountLabel, Button, confirmAction, Empty, openExternal, ProposalCard, useSubmit } from "./shared.js";
import { addDashboardWidget, applyDashboardLayout, dashboardsFrom, DEFAULT_WIDGETS } from "./dashboard-model.js";
import { FlexibleGrid } from "./flexible-grid.js";
import { needsYouRows, NeedsYouWidget, useNeedsYouQueue, WorkItemControls } from "./work.js";
import { ProcessListActions } from "./processes.js";
import { AgentListActions, useMcpPreflight } from "./agents.js";
import { AskBeesSetup, workFromOutcome } from "./ask-bees.js";

export function OutcomeWidget({ ctx, data, workspaceId, outcome, setOutcome, configuration, configureGoal, clearConfiguration, act, openWorkItem, capabilities }) {
  const [error, setError] = useState("");
  const role = data.teams.find(({ id }) => id === data.workspaces.find((row) => row.id === workspaceId)?.teamId)?.role;
  const allowed = ["admin", "member"].includes(role);
  const [guardRun, preflight] = useMcpPreflight({ ctx, data, workspaceId, capabilities, act });
  const [busy, submit] = useSubmit(async () => {
    if (!allowed || !workspaceId || !outcome.trim()) return;
    setError("");
    const process = data.processes.find((row) => row.id === configuration?.processId)
      ?? data.processes.find((row) => row.workspaceId === workspaceId && row.kind === "goals");
    if (!await guardRun(process?.id)) return;
    try {
      const target = process?.kind === "goals" || !process ? { workspaceId } : { processId: process.id };
      const result = await act(workFromOutcome(outcome, target, configuration ? {
        inputLocationIds: configuration.inputLocationIds, outputLocationId: configuration.outputLocationId
      } : {}));
      if (result?.id) { setOutcome(""); clearConfiguration(); openWorkItem(result.id); }
      else setError("Could not start this work. Please try again.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  });
  return h(React.Fragment, null, preflight, h("form", {
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
      h("span", { className: "bees-composer-hint" }, "Runs as a goal with the team's agents · ⌘ / Ctrl + Enter"),
      h("div", { className: "bees-detail-actions", style: { gap: "14px" } },
        h("button", { type: "button", disabled: busy || !allowed || !workspaceId, onClick: configureGoal,
          style: { border: 0, padding: 0, color: "var(--bees-accent)", background: "transparent", font: "inherit", fontWeight: 650, cursor: "pointer", textDecoration: "none" } }, "Configure"),
        h("button", { type: "submit", className: "bees-btn primary", disabled: busy || !allowed || !workspaceId || !outcome.trim() },
          busy ? "Starting…" : "Run")))
  ));
}

function TemplatesWidget({ ctx, data, workspaceId, act, openWorkItem }) {
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
      h("div", { className: "bees-template-card-meta" }, [card.description || "Process template",
        accountLabel(data, card.accountUserId) ? `Created by ${accountLabel(data, card.accountUserId)}` : null].filter(Boolean).join(" · ")))),
    cards.length > 10 && !showAllTemplates ? h("button", { type: "button", className: "bees-dashboard-view-all", onClick: () => setShowAllTemplates(true) }, `Show all ${cards.length} process templates`) : null
  );
}

function ListWidget({ definition, rowsForRoute, navigate, data, act, openWorkItem }) {
  const rows = rowsForRoute(definition.route).slice(0, definition.limit ?? 20);
  if (!rows.length) {
    return h(Empty, { style: { height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", border: "none" } }, definition.empty ?? "Nothing here yet.");
  }
  return h("div", { className: "bees-dashboard-list" },
    rows.map((row) => {
      const process = definition.route === "all-processes" ? data.processes.find(({ id }) => id === row.id) : null;
      const agent = definition.route === "all-agents" ? data.assignments.find(({ id }) => id === row.id) : null;
      const workItem = row.item;
      const link = h("div", {
        className: "bees-dashboard-row", key: row.id, onClick: row.open, title: row.label, style: { display: "flex", alignItems: "center", gap: "10px" },
        role: "button", tabIndex: 0,
        // a nested action button handles its own Enter/Space, so only react when the row itself is focused
        onKeyDown: (event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); row.open?.(); }
        }
      },
        h("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", flex: 1 } }, row.label),
        workItem ? h("span", { className: `bees-status bees-${workItem.runtimePhase || workItem.status || "unknown"}`, style: { flex: "0 0 130px" } }, (workItem.runtimePhase || workItem.status).replaceAll("_", " ")) : null,
        workItem ? h("div", { className: "bees-flex-widget-actions", style: { marginLeft: 0 }, onPointerDown: (e) => e.stopPropagation(), onClick: (e) => e.stopPropagation() },
          h(WorkItemControls, { item: workItem, act, showUnavailable: false, data, allowReRun: true })
        ) : null
      );
      return process || agent ? h("div", { className: "bees-row", key: row.id, style: { flexWrap: "wrap" } },
        h("div", { className: "bees-row-main" }, link), process ? h(ProcessListActions, { process, act, openWorkItem }) : h(AgentListActions, { agent, act })) : link;
    }),
    h("button", { type: "button", className: "bees-dashboard-view-all", onClick: () => navigate(definition.route) }, "View more")
  );
}

function MetricsWidget({ rowsForRoute, records }) {
  const metrics = [
    ["Needs you", records.length],
    ["Active process runs", rowsForRoute("all-work").length],
    ["Process templates", rowsForRoute("all-processes").length],
    ["Agents", rowsForRoute("all-agents").length]
  ];
  return h("div", { className: "bees-dashboard-metrics" }, ...metrics.map(([label, value]) =>
    h("div", { className: "bees-dashboard-metric", key: label },
      h("strong", null, String(value)), h("span", null, label))));
}

function QuickActionsWidget({ workspaceId, createWork, createProcess, createRun, createAgent }) {
  const actions = [
    ["New work item", createWork], ["New process template", createProcess],
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
  { kind: "goals", label: "Goals", description: "Current goals", route: "goals", w: 6, h: 5, component: ListWidget , helpText: "High-level outcomes you've asked Bees to achieve. Bees handles the step-by-step planning.", helpExamples: ["Migrate the database to the new server","Prepare the Q3 financial report"]},
  { kind: "completed", label: "Completed process runs", description: "Recently completed process runs", route: "completed", w: 6, h: 5, component: ListWidget , helpText: "Process runs that have finished successfully or failed.", helpExamples: []},
  { kind: "templates", label: "Process templates", description: "Reusable process definitions", w: 4, h: 5, component: TemplatesWidget , helpText: "Reusable definitions for your common processes. They define the stages and agents used for repeatable work.", helpExamples: ["Employee Onboarding process","Blog Post Publication process","Weekly Report Generation"]},
  { kind: "agents", label: "Agents", description: "Team agents", route: "all-agents", w: 6, h: 5, component: ListWidget , helpText: "The AI workers available in your team.", helpExamples: []},
  { kind: "runs", label: "Executions", description: "Recent agent executions", route: "runs", w: 6, h: 5, component: ListWidget , helpText: "Recent individual agent executions.", helpExamples: []},
];

const widgetByKind = new Map(WIDGETS.map((widget) => [widget.kind, widget]));

function DashboardGrid({ dashboard, editing, onLayout, onRemove, widgetProps }) {
  const panels = Object.fromEntries(dashboard.widgets.map((widget) => {
    const definition = widgetByKind.get(widget.kind);
    const label = definition?.label ?? widget.kind;
    return [widget.kind, {
      label, helpText: definition?.helpText, helpExamples: definition?.helpExamples,
      actions: editing ? h("button", {
        type: "button", className: "bees-dashboard-remove", title: `Remove ${label}`, "aria-label": `Remove ${label}`,
        onClick: () => onRemove(widget.kind)
      }, "×") : null,
      content: definition?.component
        ? h(definition.component, { ...widgetProps, definition })
        : h(Empty, null, "This widget is no longer available.")
    }];
  }));
  return h(FlexibleGrid, {
    key: dashboard.id, className: "bees-dashboard-grid", layout: dashboard.widgets, editing, onLayout, panels
  });
}

export function Home({ ctx, data, workspaceId, act, openWorkItem, navigate, rowsForRoute, preference, preferences, setPageActions, createWork, createProcess, createRun, createAgent, capabilities }) {
  const [outcome, setOutcome] = useState("");
  const [setup, setSetup] = useState(false);
  const [outcomeConfiguration, setOutcomeConfiguration] = useState(null);
  useEffect(() => { setSetup(false); setOutcomeConfiguration(null); }, [workspaceId]);
  const dashboards = dashboardsFrom(preference.dashboards).map((candidate) => ({
    ...candidate, widgets: candidate.widgets.filter(({ kind }) => widgetByKind.has(kind))
  }));
  const activeId = dashboards.some(({ id }) => id === preference.activeDashboardId) ? preference.activeDashboardId : "home";
  const dashboard = dashboards.find(({ id }) => id === activeId) ?? dashboards[0];
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [dashboard.id]);
  const saveDashboard = (nextDashboard) => {
    void preferences.set("dashboards", dashboards.map((candidate) => candidate.id === dashboard.id ? nextDashboard : candidate));
  };
  const resetDashboard = async () => {
    if (!await confirmAction("Reset this layout back to the default arrangement?")) return;
    const shipped = preferences.getSnapshot().base?.dashboards?.find(({ id }) => id === dashboard.id)?.widgets;
    saveDashboard({ ...dashboard, widgets: (preferences.productDefaults ? DEFAULT_WIDGETS : shipped ?? DEFAULT_WIDGETS).map((widget) => ({ ...widget })) });
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
  const queue = useNeedsYouQueue(ctx, data, (data.workspaces ?? []).map(({ id }) => id), "", false);
  const widgetProps = { ctx, data, workspaceId, act, openWorkItem, navigate, rowsForRoute, queue, capabilities,
    records: needsYouRows(queue, data, rowsForRoute), createWork, createProcess, createRun, createAgent,
    outcome, setOutcome, configuration: outcomeConfiguration, configureGoal: () => setSetup(true),
    clearConfiguration: () => setOutcomeConfiguration(null) };

  useEffect(() => {
    setPageActions(h("div", { className: "bees-page-actions" },
      editing ? h("details", { className: "bees-dashboard-add" },
        h("summary", { className: "bees-btn" }, "Add widget"),
        h("div", { className: "bees-dashboard-widget-menu" },
          availableWidgets.length ? availableWidgets.map((definition) => h("button", {
            type: "button", key: definition.kind, onClick: (event) => addWidget(definition, event)
          }, h("strong", null, definition.label), h("span", null, definition.description)))
            : h("div", { className: "bees-muted" }, "Every widget is already on this dashboard."))
      ) : null,
      editing ? h(Button, { onClick: resetDashboard }, "Reset") : null,
      editing && dashboard.id !== "home" ? h(Button, { className: "danger", onClick: deleteDashboard }, "Delete dashboard") : null,
      h(Button, { className: editing ? "primary" : "", onClick: () => setEditing((value) => !value) },
        editing ? "Done" : "Customize")));
    return () => setPageActions(null);
  }, [editing, preference.activeDashboardId, preference.dashboards, setPageActions]);

  return h("div", null,
    setup ? h(AskBeesSetup, {
      key: workspaceId, ctx, data, workspaceId, initial: outcomeConfiguration, act, capabilities,
      onCancel: () => setSetup(false), onSave: (configuration) => { setOutcomeConfiguration(configuration); setSetup(false); }
    }) : null,
    h("div", { className: "bees-dashboard" },
    h(ProposalsWidget, { data, workspaceIds: [workspaceId], act }),
    dashboard.widgets.length ? h(DashboardGrid, {
      dashboard,
      editing,
      widgetProps,
      onLayout: (layout) => saveDashboard(applyDashboardLayout(dashboard, layout)),
      onRemove: (kind) => saveDashboard({ ...dashboard, widgets: dashboard.widgets.filter((widget) => widget.kind !== kind) })
    }) : h(Empty, null, editing ? "Add a widget to build this dashboard." : "This dashboard is empty. Choose Customize to add widgets."))
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
