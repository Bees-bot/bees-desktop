import {
  FreeAiController, h, LocalAiController, React, useEffect, useRef, useState
} from "./runtime.js";
import {
  ask, Button, NAVIGATION, navigationItem, PinButton, request, scopeParts,
  sectionFor, ThemeToggle, usePreference, workItemsFor
} from "./shared.js";
import { Home, GuidePage } from "./home.js";
import { NeedsYouPage, WorkPage } from "./work.js";
import { ProcessesPage } from "./processes.js";
import { AgentsPage } from "./agents.js";
import { McpPage, SkillsPage, useCapabilities } from "./skills.js";
import { ActivityPage, FilesPage, KnowledgePage } from "./resources.js";
import { SettingsPage } from "./settings.js";

function ContextSwitcher({ data, organizationId, teamId, workspaceId, onChange, onCreateOrganization, onCreateTeam, onCreateWorkspace }) {
  const [query, setQuery] = useState("");
  const root = useRef(null);
  useEffect(() => {
    const dismiss = (event) => { if (!root.current?.contains(event.target)) root.current?.removeAttribute("open"); };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, []);
  const organization = data.organizations.find(({ id }) => id === organizationId);
  const team = data.teams.find(({ id }) => id === teamId);
  const workspace = data.workspaces.find(({ id }) => id === workspaceId);
  const needle = query.trim().toLocaleLowerCase();
  const matches = ({ name }) => !needle || name.toLocaleLowerCase().includes(needle);
  const close = (event) => event.currentTarget.closest("details")?.removeAttribute("open");
  const option = (row, active, select, closeAfter = false) => h("button", {
    className: `bees-context-option ${active ? "active" : ""}`, key: row.id,
    onClick: (event) => { select(); if (closeAfter) close(event); }
  }, h("span", { className: "bees-context-check", "aria-hidden": "true" }, active ? "✓" : ""), row.name);
  const add = (label, action, disabled = false) => h("button", {
    className: "bees-context-option bees-context-add", onClick: action, disabled
  }, h("span", { className: "bees-context-check", "aria-hidden": "true" }, "+"), label);
  const organizations = data.organizations.filter(matches);
  const teams = data.teams.filter((row) => row.organizationId === organizationId && matches(row));
  const workspaces = data.workspaces.filter((row) => row.teamId === teamId && matches(row));
  return h("details", { className: "bees-context-switcher", ref: root },
    h("summary", null,
      h("div", { className: "bees-context-summary" },
        h("div", { className: "bees-context-primary" }, organization?.name ?? "Choose organization"),
        h("div", { className: "bees-context-secondary" }, team ? `${team.name} · ${workspace?.name ?? "All workspaces"}` : "Choose team")),
      h("span", { className: "bees-context-arrow", "aria-hidden": "true" }, "▾")),
    h("div", { className: "bees-context-panel" },
      h("input", { className: "bees-input bees-context-search", value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Search contexts", "aria-label": "Search organizations, teams, and workspaces" }),
      h("div", { className: "bees-context-section" },
        h("div", { className: "bees-context-label" }, "Organizations"),
        ...organizations.map((row) => option(row, row.id === organizationId, () => onChange(`organization:${row.id}`))),
        add("New organization", onCreateOrganization)),
      h("div", { className: "bees-context-section" },
        h("div", { className: "bees-context-label" }, organization ? `Teams in ${organization.name}` : "Teams"),
        ...teams.map((row) => option(row, row.id === teamId, () => onChange(`team:${row.id}`))),
        add("New team", onCreateTeam, !organizationId)),
      h("div", { className: "bees-context-section" },
        h("div", { className: "bees-context-label" }, team ? `Workspaces in ${team.name}` : "Workspaces"),
        team && (!needle || "all workspaces".includes(needle)) ? option({ id: `all:${team.id}`, name: "All workspaces" }, !workspaceId, () => onChange(`team:${team.id}`), true) : null,
        ...workspaces.map((row) => option(row, row.id === workspaceId, () => onChange(`workspace:${row.id}`), true)),
        add("New workspace", onCreateWorkspace, !teamId)))
  );
}

export function BeesApp({ ctx, preferences, modelSettings }) {
  const preference = usePreference(preferences);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [route, setRoute] = useState("home");
  const [scope, setScopeState] = useState("");
  const [processId, setProcessId] = useState("");
  const [workItemId, setWorkItemId] = useState("");
  const [creating, setCreating] = useState("");
  const [processDraft, setProcessDraft] = useState(null);
  const [workProcessId, setWorkProcessId] = useState("");
  const load = async () => {
    try { const value = await request("/bees-api/snapshot"); setData(value); setError(""); return value; }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return null; }
  };
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 5000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!data) return;
    const valid = new Set([...data.organizations.map(({ id }) => `organization:${id}`), ...data.teams.map(({ id }) => `team:${id}`), ...data.workspaces.map(({ id }) => `workspace:${id}`)]);
    const preferred = valid.has(preference.lastScope) ? preference.lastScope
      : data.workspaces[0] ? `workspace:${data.workspaces[0].id}` : `organization:${data.organizations[0]?.id ?? ""}`;
    setScopeState((current) => valid.has(current) ? current : preferred);
  }, [data, preference.lastScope]);
  const setScope = (next) => {
    setScopeState(next); setProcessId(""); setWorkItemId(""); setCreating(""); setProcessDraft(null); setWorkProcessId("");
    void preferences.set("lastScope", next);
  };
  const parts = data ? scopeParts(data, scope) : { workspaceId: "", teamId: "", organizationId: "" };
  const workspaceIds = data ? (parts.workspaceId ? [parts.workspaceId] : data.workspaces.filter(({ teamId }) => teamId === parts.teamId).map(({ id }) => id)) : [];
  const act = async (command) => {
    try { const result = await request("/bees-api/command", { method: "POST", body: JSON.stringify(command) }); await load(); return result; }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return null; }
  };
  const askBees = async (outcome) => {
    if (!parts.workspaceId) return null;
    const result = await act({ action: "ask_bees", workspaceId: parts.workspaceId, outcome });
    if (result?.sessionId) setRoute("runs");
    return result;
  };
  const navigate = (id) => {
    if (id === "dsh-settings") {
      document.querySelector('button[aria-haspopup="dialog"][aria-expanded]')?.click();
      return;
    }
    const section = NAVIGATION.find((row) => row.id === id);
    setRoute(section ? section.defaultChild : id); setProcessId(""); setWorkItemId(""); setCreating(""); setProcessDraft(null); setWorkProcessId("");
  };
  const createOrganization = async () => {
    const name = await ask("Organization name", ""); if (!name) return;
    const result = await act({ action: "create_organization", name });
    if (result?.id) setScope(`organization:${result.id}`);
  };
  const createTeam = async () => {
    const organization = data.organizations.find(({ id }) => id === parts.organizationId); if (!organization) return;
    const name = await ask("Team name", ""); if (!name) return;
    const result = await act({ action: "create_team", organizationId: organization.id, name });
    if (result?.id) setScope(`team:${result.id}`);
  };
  const createWorkspace = async () => {
    let team = data.teams.find(({ id }) => id === parts.teamId);
    const teams = data.teams.filter(({ organizationId }) => organizationId === parts.organizationId);
    if (!team) { const name = await ask(`Team:\n${teams.map(({ name }) => name).join("\n")}`); team = teams.find((row) => row.name === name); }
    if (!team) return;
    const name = await ask("Workspace name", ""); if (!name) return;
    const result = await act({ action: "create_workspace", teamId: team.id, name });
    if (result?.id) setScope(`workspace:${result.id}`);
  };
  const createWork = () => { setRoute("all-work"); setWorkItemId(""); setWorkProcessId(""); setCreating("work"); };
  const createGoal = () => { setRoute("goals"); setWorkItemId(""); setCreating("goal"); };
  const createProcess = () => { setRoute("all-processes"); setProcessId(""); setProcessDraft(null); setCreating("process"); };
  const createRun = async () => {
    const processes = data.processes.filter((row) => row.workspaceId === parts.workspaceId && row.kind === "standard");
    const processName = await ask(`Process:\n${processes.map(({ name }) => name).join("\n")}`, processes[0]?.name ?? "");
    const process = processes.find(({ name }) => name === processName); if (!process) return;
    const title = await ask("One-off run name", `New ${process.name} run`); if (!title) return;
    const work = await act({ action: "create_run", processId: process.id, title });
    if (work?.id) { setRoute("all-work"); setWorkItemId(work.id); }
  };
  const createAgent = () => { setRoute("all-agents"); setCreating("agent"); };
  const capabilities = useCapabilities();
  const localAi = h(LocalAiController, { modelSettings, preferences, onError: setError });
  const freeAi = h(FreeAiController, { modelSettings, onError: setError });
  if (!data) return h(React.Fragment, null, localAi, freeAi,
    h("div", { className: "bees-app bees-loading" }, error || "Opening Bees…"));
  const section = sectionFor(route);
  const routeLabel = section.children.find(([id]) => id === route)?.[1] ?? section.label;
  const pins = (preference.pins ?? []).filter((id) => navigationItem(id));
  const setPins = (next) => preferences.set("pins", next);
  const openProcess = (id) => { setRoute("all-processes"); setProcessId(id); setWorkItemId(""); setCreating(""); };
  const openWorkItem = (id, processForWork = "") => {
    setRoute("all-work"); setProcessId(""); setWorkItemId(id ?? "");
    setWorkProcessId(processForWork); setCreating(id ? "" : "work");
  };
  const pinnedRows = (targetRoute) => {
    const target = sectionFor(targetRoute);
    const openRoute = () => navigate(targetRoute);
    if (target.id === "work") return workItemsFor(data, targetRoute, workspaceIds)
      .map((item) => ({ id: item.id, label: item.title, open: () => openWorkItem(item.id) }));
    if (target.id === "processes") {
      if (targetRoute === "schedules") return data.schedules.filter((row) => workspaceIds.includes(row.workspaceId))
        .map((row) => ({ id: row.id, label: row.name, open: openRoute }));
      if (targetRoute === "templates") return (data.templates ?? []).filter((row) => workspaceIds.includes(row.workspaceId))
        .map((row) => ({ id: row.id, label: row.name, open: openRoute }));
      return data.processes.filter((row) => workspaceIds.includes(row.workspaceId))
        .map((row) => ({ id: row.id, label: row.name, open: () => { setRoute("all-processes"); setProcessId(row.id); } }));
    }
    if (target.id === "agents") {
      const assignments = data.assignments.filter((row) => workspaceIds.includes(row.workspaceId));
      if (targetRoute === "skills") return [];
      if (targetRoute === "presets") return data.presets.map((row) => ({ id: row.id, label: row.name, open: openRoute }));
      if (targetRoute === "mcp") return (capabilities.data?.servers ?? [])
        .map((row) => ({ id: row.id, label: row.label, open: openRoute }));
      if (targetRoute === "pools") return data.pools.filter((row) => workspaceIds.includes(row.workspaceId))
        .map((row) => ({ id: row.id, label: row.name, open: openRoute }));
      return assignments.map((row) => ({ id: row.id, label: row.name, open: openRoute }));
    }
    if (target.id === "files" || targetRoute === "sources") return data.locations.filter((row) => row.teamId === parts.teamId && !row.archivedAt)
      .map((row) => ({ id: row.id, label: row.name, open: openRoute }));
    if (targetRoute === "runs") return data.runs.filter((row) => workspaceIds.includes(row.workspaceId)).map((row) => ({
      id: row.id, label: data.items.find(({ id }) => id === row.workItemId)?.title ?? "Ask Bees",
      open: openRoute
    }));
    if (targetRoute === "artifacts") return data.runs.filter((row) => row.workspaceId === parts.workspaceId && row.outputs.length)
      .map((row) => ({ id: row.id, label: data.items.find(({ id }) => id === row.workItemId)?.title ?? "Run", open: openRoute }));
    if (targetRoute === "workspace-settings" && parts.workspace) return [{ id: parts.workspace.id, label: parts.workspace.name, open: openRoute }];
    if (targetRoute === "team-settings") {
      const team = data.teams.find(({ id }) => id === parts.teamId);
      return team ? [{ id: team.id, label: team.name, open: openRoute }] : [];
    }
    if (targetRoute === "organization-settings") {
      const organization = data.organizations.find(({ id }) => id === parts.organizationId);
      return organization ? [{ id: organization.id, label: organization.name, open: openRoute }] : [];
    }
    return [];
  };
  const page = route === "home" ? h(Home, { data, workspaceId: parts.workspaceId, act, askBees })
    : route === "guide" ? h(GuidePage)
    : section.id === "work" ? route === "waiting"
      ? h(NeedsYouPage, { ctx, data, workspaceIds, openWorkItem })
      : h(WorkPage, { ctx, data, route, workspaceIds, workspaceId: parts.workspaceId, teamId: parts.teamId, workItemId, setWorkItemId, creating, setCreating, defaultProcessId: workProcessId, act })
      : section.id === "processes" ? h(ProcessesPage, { data, route, workspaceIds, workspaceId: parts.workspaceId, teamId: parts.teamId, processId, setProcessId, openWorkItem, creating, setCreating, processDraft, setProcessDraft, act })
        : route === "skills" ? h(SkillsPage, { capabilities, onAddTools: () => navigate("mcp") })
        : route === "mcp" ? h(McpPage, { ctx, capabilities })
        : section.id === "agents" ? h(AgentsPage, { ctx, data, servers: capabilities.data?.servers ?? [], route, workspaceIds, workspaceId: parts.workspaceId, creating, setCreating, act, openDshSettings: () => navigate("dsh-settings") })
          : section.id === "files" ? h(FilesPage, { ctx, data, route, teamId: parts.teamId, act })
            : section.id === "activity" ? h(ActivityPage, { data, route, workspaceIds, setRoute, openWorkItem, openProcess })
              : section.id === "knowledge" ? h(KnowledgePage, { data, route, workspaceId: parts.workspaceId, teamId: parts.teamId })
                : h(SettingsPage, { ctx, data, route, workspaceId: parts.workspaceId, teamId: parts.teamId, organizationId: parts.organizationId, modelSettings, preferences, reload: load });
  return h(React.Fragment, null, localAi, freeAi, h("div", { className: "bees-app" },
    h("aside", { className: "bees-sidebar" },
      h("div", { className: "bees-brand" }, h("span", { className: "bees-mark" }, "B"), h("span", null, "Bees")),
      h(ContextSwitcher, { data, organizationId: parts.organizationId, teamId: parts.teamId, workspaceId: parts.workspaceId,
        onChange: setScope, onCreateOrganization: createOrganization, onCreateTeam: createTeam, onCreateWorkspace: createWorkspace }),
      h("nav", { className: "bees-nav", "aria-label": "Bees navigation" },
        ...pins.map((id) => {
          const pinned = navigationItem(id);
          return h("div", { className: "bees-nav-group", key: `pin:${id}` },
            h("div", { className: "bees-nav-group-head" },
              h("button", { className: `bees-nav-link ${route === pinned.route ? "active" : ""}`, onClick: () => navigate(pinned.route) }, h("span", null, pinned.icon), h("span", null, pinned.label)),
              h(PinButton, { id: pinned.id, label: pinned.label, pins, setPins })),
            ...pinnedRows(pinned.route).map((row) => h("button", { className: "bees-nav-link bees-nav-record", title: row.label, key: `${pinned.id}:${row.id}`, onClick: row.open }, row.label))
          );
        }),
        h("div", { className: "bees-nav-standard" }, ...NAVIGATION.flatMap((item) => [
          h("div", { className: "bees-nav-menu", key: item.id },
            h("button", { className: `bees-nav-link ${section.id === item.id ? "active" : ""}`, onClick: () => navigate(item.id) }, h("span", null, item.icon), h("span", null, item.label)),
            h(PinButton, { id: item.id, label: item.label, pins, setPins })),
          ...(section.id === item.id ? item.children.map(([child, label]) =>
            h("div", { className: "bees-nav-menu", key: `${item.id}:${child}` },
              h("button", { className: `bees-nav-link bees-nav-child ${route === child ? "active" : ""}`, onClick: () => navigate(child) }, label),
              h(PinButton, { id: child, label, pins, setPins }))) : [])
        ]))
      )
    ),
    h("section", { className: "bees-main" },
      h("header", { className: "bees-top" }, h("div", { className: "bees-title" }, routeLabel),
        route !== "home" ? h("div", { className: "bees-context" }, parts.workspace?.name ?? parts.team?.name ?? parts.organization?.name ?? "") : null,
        route !== "home" ? h(PinButton, { id: route, label: routeLabel, pins, setPins }) : null,
        h("div", { className: "bees-grow" }),
        h("details", { className: "bees-create" }, h("summary", { className: "bees-btn", title: "Create", role: "button", "aria-label": "Create" }, "+"), h("div", { className: "bees-menu" },
          h("button", { className: "bees-nav-link", onClick: createOrganization }, "New organization"),
          h("button", { className: "bees-nav-link", disabled: !parts.teamId && !data.teams.some(({ organizationId }) => organizationId === parts.organizationId), onClick: createWorkspace }, "New workspace"),
          h("button", { className: "bees-nav-link", disabled: !parts.workspaceId, onClick: createWork }, "New work"),
          h("button", { className: "bees-nav-link", disabled: !parts.workspaceId, onClick: createGoal }, "New goal"),
          h("button", { className: "bees-nav-link", disabled: !parts.workspaceId, onClick: createProcess }, "New process"),
          h("button", { className: "bees-nav-link", disabled: !parts.workspaceId, onClick: createRun }, "New one-off run"),
          h("button", { className: "bees-nav-link", disabled: !parts.workspaceId, onClick: createAgent }, "New agent"),
          h("button", { className: "bees-nav-link", disabled: !parts.organizationId, onClick: createTeam }, "New team")
        )),
        h(ThemeToggle, { ctx })),
      error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
      h("main", { className: "bees-content" }, h("div", { className: `bees-panel ${section.id === "work" && workItemId ? "bees-panel-wide" : ""}` }, page))
    )
  ));
}


