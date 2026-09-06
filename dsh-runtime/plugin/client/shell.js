import {
  FreeAiController, h, LocalAiController, React, useEffect, useState
} from "./runtime.js";
import {
  ask, askWithCheckbox, choose, collaboration, connectionIdForScope, defaultOrgColor, headerEmitter, NAVIGATION, request, scopeParts, runTitle, sectionFor, Button, Empty, openExternal,
  THEME_PRESETS, ThemeToggle, usePreference, workItemsFor
} from "./shared.js";
import { AccountIcon, BookIcon, SettingsIcon } from "./icons.js";
import { Home, GuidePage } from "./home.js";
import { dashboardsFrom } from "./dashboard-model.js";
import { WorkPage } from "./work.js";
import { ProcessesPage } from "./processes.js";
import { AgentsPage } from "./agents.js";
import { McpPage, SkillsPage, useCapabilities } from "./skills.js";
import { ActivityPage, FilesPage, KnowledgePage } from "./resources.js";
import { AccountsPage, AccountSignInButtons, SettingsPage } from "./settings.js";
import brandMark from "../../../src/brand-mark.png";

function ScopeSwitcher({
  data, organizationId, teamId, connectionId, onChange,
  onCreateOrganization, onCreateTeam, onOpenTeamSettings, onNavigate,
  route, sectionId, dashboards, activeDashboardId, onOpenDashboard, organizationColors
}) {
  const [expandedTeams, setExpandedTeams] = useState(() => new Set(teamId ? [teamId] : []));
  const [expandedMenus, setExpandedMenus] = useState(() => new Set());
  useEffect(() => {
    if (!teamId) return;
    setExpandedTeams((current) => current.has(teamId) ? current : new Set([...current, teamId]));
  }, [teamId]);
  const organizations = [
    ...data.organizations.filter((organization) => !(data.connections ?? []).some(
      ({ organizationId: id }) => id === organization.id
    )).map((row) => ({
      ...row, contextId: `local:${row.id}`, connectionId: ""
    })),
    ...(data.connections ?? []).map((row) => ({
      id: row.organizationId, name: row.organizationName, email: row.email,
      role: row.role, contextId: row.id, connectionId: row.id
    }))
  ].map((row) => {
    const role = row.role
      ? row.role.charAt(0).toLocaleUpperCase() + row.role.slice(1)
      : "";
    const type = row.connectionId ? "Regular" : "Private";
    const meta = row.email ? [row.email, role].filter(Boolean).join(" · ") : "Only on this device";
    return { ...row, type, meta, details: [row.name, type, meta].join(" — ") };
  });
  const selectedOrganization = organizations.find((row) =>
    row.id === organizationId && row.connectionId === connectionId);
  const allowedTeams = connectionId
    ? new Set((data.connectionTeams ?? []).filter((row) => row.connectionId === connectionId)
      .map(({ teamId: id }) => id))
    : null;
  const teams = data.teams.filter((row) => row.organizationId === organizationId &&
    (!allowedTeams || allowedTeams.has(row.id)));
  return h("div", { className: "bees-scope-switcher" },
    h("div", { className: "bees-org-tiles", "aria-label": "Organizations" },
      ...organizations.map((row) => h("button", {
        type: "button", key: row.contextId ?? row.id,
        className: `bees-org-tile ${row.id === organizationId && row.connectionId === connectionId ? "active" : ""}`,
        style: { "--bees-org-color": organizationColors[row.id] || row.color || defaultOrgColor(row.name) },
        title: row.details, "aria-label": row.details,
        onClick: () => onChange(`organization:${row.id}`, row.connectionId)
      }, row.name.trim().charAt(0).toLocaleUpperCase() || "•")),
      h("button", { type: "button", className: "bees-org-tile bees-scope-add", title: "Add organization",
        "aria-label": "Add organization", onClick: onCreateOrganization }, "+")),
    selectedOrganization ? h("div", { className: "bees-org-summary", "aria-live": "polite" },
      h("div", { className: "bees-org-summary-title" },
        h("strong", { title: selectedOrganization.name }, selectedOrganization.name),
        h("span", { className: "bees-badge" }, selectedOrganization.type)),
      h("div", { className: "bees-org-summary-meta", title: selectedOrganization.meta }, selectedOrganization.meta)) : null,
    h("div", { className: "bees-team-heading" },
      h("span", null, "Teams"),
      h("button", { type: "button", className: "bees-scope-add", disabled: !organizationId,
        title: "Add team", "aria-label": "Add team", onClick: onCreateTeam }, "+")),
    h("div", { className: "bees-team-list" },
      ...teams.map((row) => {
        const active = row.id === teamId;
        const expanded = expandedTeams.has(row.id);
        const open = (target) => {
          if (!active) onChange(`team:${row.id}`, connectionId);
          onNavigate(target);
        };
        return h("section", {
          className: `bees-team-section ${active ? "active" : ""} ${expanded ? "expanded" : ""}`,
          key: row.id
        },
        h("div", { className: "bees-team-row" },
          h("button", { type: "button", className: "bees-team-toggle", title: row.name,
            "aria-expanded": expanded, onClick: () => {
              if (!active) onChange(`team:${row.id}`, connectionId);
              setExpandedTeams((current) => {
                const next = new Set(current);
                if (active && next.has(row.id)) next.delete(row.id); else next.add(row.id);
                return next;
              });
            } },
          h("span", { className: "bees-team-chevron", "aria-hidden": "true" }, expanded ? "⌄" : "›"),
          h("span", { className: "bees-team-initial", "aria-hidden": "true" }, row.name.trim().charAt(0).toLocaleUpperCase() || "•"),
          h("span", { className: "bees-team-name" }, row.name)),
          h("button", { type: "button", className: "bees-team-settings", title: `${row.name} settings`,
            "aria-label": `${row.name} settings`, onClick: () => onOpenTeamSettings(row) }, h(SettingsIcon))),
        expanded ? h("nav", { className: "bees-team-nav", "aria-label": `${row.name} navigation` },
          ...NAVIGATION.filter(({ id }) => id !== "settings").map((item) => {
            const menuKey = `${row.id}:${item.id}`;
            const menuExpanded = expandedMenus.has(menuKey);
            return h(React.Fragment, { key: menuKey },
            h("div", { className: `bees-nav-menu ${active && sectionId === item.id ? "active" : ""} ${menuExpanded ? "expanded" : ""}` },
              h("button", { className: `bees-nav-link ${active && sectionId === item.id ? "active" : ""}`,
                "aria-current": active && sectionId === item.id ? "page" : null,
                "aria-expanded": item.children && item.children.length > 0 ? menuExpanded : null, onClick: () => {
                  open(item.id);
                  if (item.children && item.children.length > 0) setExpandedMenus((current) => {
                    const next = new Set(current);
                    if (next.has(menuKey)) next.delete(menuKey); else next.add(menuKey);
                    return next;
                  });
                } },
              h("span", { style: { display: "flex", width: 18, color: "var(--dsw-alias-label-secondary)" } }, h(item.icon)),
              h("span", null, item.label),
              item.children && item.children.length > 0 ? h("span", { className: "bees-nav-chevron", "aria-hidden": "true" }, menuExpanded ? "⌄" : "›") : null),
              item.children && item.children.length > 0 && menuExpanded ? h("div", { className: "bees-nav-flyout" },
                ...item.children.map(([child, label]) => h("div", {
                  className: `bees-nav-flyout-item ${active && route === child ? "active" : ""}`,
                  key: `${row.id}:${item.id}:${child}`
                }, h("button", { className: `bees-nav-link bees-nav-child ${active && route === child ? "active" : ""}`,
                  "aria-current": active && route === child ? "page" : null, onClick: () => open(child) }, label)))
              ) : null),
            item.id === "home" ? h("div", { className: "bees-nav-dashboards" },
              ...dashboards.filter(({ id }) => id !== "home").map((dashboard) => h("button", {
                className: `bees-nav-link bees-dashboard-link ${active && route === "home" && activeDashboardId === dashboard.id ? "active" : ""}`,
                "aria-current": active && route === "home" && activeDashboardId === dashboard.id ? "page" : null,
                title: dashboard.name, key: `${row.id}:${dashboard.id}`, onClick: () => {
                  if (!active) onChange(`team:${row.id}`, connectionId);
                  onOpenDashboard(dashboard.id);
                }
              }, h("span", null, dashboard.name)))) : null
          ); })) : null);
      })));
}

export function BeesApp({ ctx, preferences, modelSettings }) {
  const preference = usePreference(preferences);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [route, setRoute] = useState("home");
  const [scope, setScopeState] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [processId, setProcessId] = useState("");
  const [workItemId, setWorkItemId] = useState("");
  const [creating, setCreating] = useState("");
  const [creatingOrganizationName, setCreatingOrganizationName] = useState("");
  const [processDraft, setProcessDraft] = useState(null);
  const [workProcessId, setWorkProcessId] = useState("");
  const [runId, setRunId] = useState("");
  const [needsYouRunId, setNeedsYouRunId] = useState("");
  const setPageActions = (actions) => headerEmitter.setActions(actions);
  const setPageHeader = (header) => headerEmitter.setHeader(header);
  const load = async () => {
    try { const value = await request("/bees-api/snapshot"); setData(value); setError(""); return value; }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return null; }
  };
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (typeof window.EventSource !== "function") return undefined;
    const source = new window.EventSource("/bees-api/events");
    let refreshTimer;
    const changed = (event) => {
      let detail = null;
      try { detail = JSON.parse(event.data); } catch {}
      window.dispatchEvent(new window.CustomEvent("bees-change", { detail }));
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void load(), 50);
    };
    source.addEventListener("change", changed);
    return () => { clearTimeout(refreshTimer); source.close(); };
  }, []);
  useEffect(() => {
    const theme = ctx.get?.("theme") ?? ctx.theme;
    const preset = THEME_PRESETS.find(({ id }) => id === preference.themePreset)
      ?? THEME_PRESETS.find(({ id }) => id === "forest");
    const colorMode = ["dark", "light"].includes(preference.colorMode)
      ? preference.colorMode : preset.dark ? "dark" : "light";
    if (theme.getTheme().preference !== colorMode) theme.setTheme(colorMode);
    if (!preference.themePreset) void preferences.set("themePreset", "forest");
    if (preference.colorMode !== colorMode) void preferences.set("colorMode", colorMode);
  }, [ctx, preferences, preference.colorMode, preference.themePreset]);
  useEffect(() => {
    if (!data) return;
    const connections = data.connections ?? [];
    const selectedConnectionId = connectionIdForScope(
      data, scope, connectionId, preference.lastConnectionId
    );
    if (selectedConnectionId !== connectionId) setConnectionId(selectedConnectionId);
    const selected = scopeParts(data, scope, selectedConnectionId);
    if (selected.organizationId) return;
    const saved = scopeParts(data, preference.lastScope, selectedConnectionId);
    if (saved.organizationId) { setScopeState(preference.lastScope); return; }
    const teamIds = selectedConnectionId
      ? new Set((data.connectionTeams ?? []).filter((row) => row.connectionId === selectedConnectionId)
        .map(({ teamId }) => teamId))
      : new Set(data.teams.filter(({ personal }) => personal).map(({ id }) => id));
    const team = data.teams.find(({ id }) => teamIds.has(id));
    const organizationId = selectedConnectionId
      ? connections.find(({ id }) => id === selectedConnectionId)?.organizationId
      : data.organizations.find(({ personal }) => personal)?.id;
    setScopeState(team ? `team:${team.id}` : `organization:${organizationId ?? ""}`);
  }, [data, preference.lastScope, preference.lastConnectionId, connectionId, scope]);
  const setScope = (next, nextConnectionId = connectionId) => {
    setConnectionId(nextConnectionId);
    setScopeState(next); setProcessId(""); setWorkItemId(""); setCreating(""); setProcessDraft(null); setWorkProcessId(""); setRunId(""); setNeedsYouRunId("");
    void preferences.set("lastScope", next);
    void preferences.set("lastConnectionId", nextConnectionId);
  };
  const parts = data ? scopeParts(data, scope, connectionId)
    : { workspaceId: "", teamId: "", organizationId: "", accountUserId: null };
  const viewData = data ? {
    ...data,
    organizations: data.organizations.map((organization) =>
      organization.id === parts.organizationId && parts.connection
        ? { ...organization, role: parts.connection.role }
        : organization),
    teams: data.teams.map((team) => team.id === parts.teamId && parts.team
      ? { ...team, role: parts.team.role }
      : team),
  } : data;
  const workspaceIds = parts.workspaceId ? [parts.workspaceId] : [];
  const act = async (command) => {
    try {
      const result = await request("/bees-api/command", {
        method: "POST",
        body: JSON.stringify({
          ...command, connectionId: parts.connection?.id ?? "",
          accountUserId: parts.accountUserId ?? ""
        })
      });
      await load();
      if (result?.learnedChange !== undefined) {
        setNotice(`Updated ${result.name}:\n${result.learnedChange || "No specialist guidance"}`);
        window.setTimeout(() => setNotice(""), 10_000);
      }
      return result;
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return null; }
  };
  const navigate = (id) => {
    if (id === "dsh-settings") {
      document.querySelector('button[aria-haspopup="dialog"][aria-expanded]')?.click();
      return;
    }
    if (id === "home") void preferences.set("activeDashboardId", "home");
    const section = NAVIGATION.find((row) => row.id === id);
    setRoute(section ? section.defaultChild : id); setProcessId(""); setWorkItemId(""); setCreating(""); setProcessDraft(null); setWorkProcessId(""); setRunId(""); setNeedsYouRunId("");
  };
  const createLocalOrganization = async (name) => {
    const beforeCount = data?.organizations?.length || 0;
    const result = await act({ action: "create_organization", name });
    
    // Attempt to find the newly created organization in the updated data
    // since act() calls load() which updates the snapshot.
    // If result.id exists, we use it directly.
    let newOrgId = result?.id;
    if (!newOrgId) {
       // fallback: find the org that wasn't there before, or just use the last local org
       const newOrg = data?.organizations?.find(o => !o.connectionId && o.name === name);
       if (newOrg) newOrgId = newOrg.id;
    }
    
    if (newOrgId) {
      setScope(`organization:${newOrgId}`, "");
      navigate("home");
    } else {
      // Even if we couldn't find the ID, we should navigate back to home
      // because the creation action was dispatched.
      navigate("home");
    }
  };
  const createOrganizationFromSwitcher = () => {
    setRoute("create-organization");
  };
  const createTeam = async () => {
    const organization = data.organizations.find(({ id }) => id === parts.organizationId); if (!organization) return;
    const name = await ask("Team name", ""); if (!name) return;
    try {
      const result = parts.connection
        ? await collaboration("create_team", { name, connectionId: parts.connection.id })
        : await act({ action: "create_team", organizationId: organization.id, name });
      if (parts.connection) await load();
      if (result?.id) setScope(`team:${result.id}`, result.connectionId ?? connectionId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const createWork = () => { setRoute("all-work"); setWorkItemId(""); setWorkProcessId(""); setCreating("work"); };
  const createGoal = () => { setRoute("goals"); setWorkItemId(""); setCreating("goal"); };
  const createProcess = () => { setRoute("all-processes"); setProcessId(""); setProcessDraft(null); setCreating("process"); };
  const createRun = async () => {
    const processes = data.processes.filter((row) => row.workspaceId === parts.workspaceId && row.kind === "standard");
    const processName = await ask(`Process template:\n${processes.map(({ name }) => name).join("\n")}`, processes[0]?.name ?? "");
    const process = processes.find(({ name }) => name === processName); if (!process) return;
    const title = await ask("Process run name", `New ${process.name} run`); if (!title) return;
    const work = await act({ action: "create_run", processId: process.id, title });
    if (work?.id) { setRoute("all-work"); setWorkItemId(work.id); }
  };
  const createAgent = () => { setRoute("all-agents"); setCreating("agent"); };
  const capabilities = useCapabilities(route);
  const localAi = h(LocalAiController, { modelSettings, preferences, onError: setError });
  const freeAi = h(FreeAiController, { modelSettings, onError: setError });
  if (!data) return h(React.Fragment, null, localAi, freeAi,
    h("div", { className: "bees-app bees-loading" }, error || "Opening Bees…"));
  const dashboards = dashboardsFrom(preference.dashboards);
  const activeDashboard = dashboards.find(({ id }) => id === preference.activeDashboardId) ?? dashboards[0];
  const activeTheme = THEME_PRESETS.find(({ id }) => id === preference.themePreset)
    ?? THEME_PRESETS.find(({ id }) => id === "forest");
  const section = sectionFor(route);
  const routeLabel = route === "home" ? activeDashboard.name : route === "accounts" ? "Accounts"
    : section.children.find(([id]) => id === route)?.[1] ?? section.label;
  const openProcess = (id) => { setRoute("all-processes"); setProcessId(id); setWorkItemId(""); setCreating(""); };
  const openRun = (id) => { setRoute("runs"); setRunId(id); setProcessId(""); setWorkItemId(""); setCreating(""); };
  const openNeedsYou = (id) => {
    setRoute("waiting"); setNeedsYouRunId(id); setProcessId(""); setWorkItemId(""); setCreating(""); setProcessDraft(null); setWorkProcessId(""); setRunId("");
  };
  const openWorkItem = (id, processForWork = "") => {
    setRoute("all-work"); setProcessId(""); setWorkItemId(id ?? "");
    setWorkProcessId(processForWork); setCreating(id ? "" : processForWork ? "run" : "work");
  };
  const rowsForRoute = (targetRoute) => {
    const target = sectionFor(targetRoute);
    const openRoute = () => navigate(targetRoute);
    if (target.id === "work") return workItemsFor(viewData, targetRoute, workspaceIds)
      .map((item) => ({ id: item.id, label: item.title, open: () => openWorkItem(item.id) }));
    if (target.id === "processes") {
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
      return assignments.map((row) => ({ id: row.id, label: row.name, open: openRoute }));
    }
    if (target.id === "files" || targetRoute === "sources") return data.locations.filter((row) => row.teamId === parts.teamId && !row.archivedAt)
      .map((row) => ({ id: row.id, label: row.name, open: openRoute }));
    if (targetRoute === "runs") return viewData.runs.filter((row) => workspaceIds.includes(row.workspaceId)).map((row) => ({
      id: row.id, label: runTitle(viewData, row), open: () => openRun(row.id)
    }));
    if (targetRoute === "artifacts") return viewData.runs.filter((row) =>
      row.workspaceId === parts.workspaceId && row.outputs.length)
      .map((row) => ({ id: row.id,
        label: viewData.items.find(({ id }) => id === row.workItemId)?.title ?? "Run", open: openRoute }));
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
  const page = route === "home" ? h(Home, {
    key: parts.workspaceId, capabilities, modelSettings, reload: load,
    ctx, data: viewData, workspaceId: parts.workspaceId, workspaceIds, act, openWorkItem, openNeedsYou, navigate,
    rowsForRoute, preference, preferences, setPageActions, setPageHeader, createWork, createGoal, createProcess, createRun, createAgent
  })
    : route === "create-organization" ? h(CreateOrganizationPage, { reload: load, setScope, navigate, createLocal: createLocalOrganization })
    : route === "guide" ? h(GuidePage)
    : route === "accounts" ? h(AccountsPage, { reload: load })
    : section.id === "work" ? h(WorkPage, { ctx, data: viewData, route, workspaceIds, workspaceId: parts.workspaceId, teamId: parts.teamId, workItemId, setWorkItemId, creating, setCreating, defaultProcessId: workProcessId, setWorkProcessId, act, preference, preferences, setPageActions, setPageHeader })
      : section.id === "processes" ? h(ProcessesPage, { ctx, data: viewData, servers: capabilities.data?.servers ?? [], route, workspaceIds, workspaceId: parts.workspaceId, teamId: parts.teamId, processId, setProcessId, openWorkItem, creating, setCreating, processDraft, setProcessDraft, act, preference, preferences, setPageActions, setPageHeader })
        : route === "skills" ? h(SkillsPage, { capabilities, onAddTools: () => navigate("mcp") })
        : route === "mcp" ? h(McpPage, { ctx, capabilities })
        : section.id === "agents" ? h(AgentsPage, { ctx, data: viewData, servers: capabilities.data?.servers ?? [], workspaceIds, workspaceId: parts.workspaceId, creating, setCreating, act, openDshSettings: () => navigate("dsh-settings"), preference, preferences, setPageActions, setPageHeader })
          : section.id === "files" ? h(FilesPage, { ctx, data: viewData, teamId: parts.teamId, act, onOpenConnections: () => navigate("connections") })
            : section.id === "activity" ? h(ActivityPage, { data: viewData, route, workspaceIds, setRoute, openWorkItem, openProcess, runId, setRunId })
              : section.id === "knowledge" ? h(KnowledgePage, { data: viewData, route, workspaceId: parts.workspaceId, teamId: parts.teamId, onOpenConnections: () => navigate("connections") })
                : h(SettingsPage, { ctx, data: viewData, route, teamId: parts.teamId,
                    organizationId: parts.organizationId, connectionId, modelSettings, preferences, preference, reload: load,
                    navigate,
                    openOrganization: async (organization) => {
                      await load();
                      setScope(`organization:${organization.id}`, organization.connectionId);
                      navigate("organization-settings");
                    } });
  return h(React.Fragment, null, localAi, freeAi, h("div", {
    className: "bees-app", "data-bees-theme": activeTheme.id,
    style: {
      "--bees-accent": activeTheme.colors[0],
      "--bees-accent-soft": `color-mix(in srgb, ${activeTheme.colors[0]} 20%, transparent)`,
      "--bees-accent-contrast": activeTheme.primaryContent,
      "--dsw-alias-bg-base": activeTheme.surfaceAlt,
      "--dsw-specific-sidebar-fill": activeTheme.surface,
      "--dsw-alias-label-primary": activeTheme.foreground,
      "--dsw-alias-label-secondary": `color-mix(in srgb, ${activeTheme.foreground} 68%, transparent)`,
      "--dsw-alias-border-l1": `color-mix(in srgb, ${activeTheme.foreground} 12%, transparent)`,
      "--dsw-alias-border-l2": `color-mix(in srgb, ${activeTheme.foreground} 20%, transparent)`,
      "--dsw-alias-interactive-bg-hover": `color-mix(in srgb, ${activeTheme.colors[0]} 14%, transparent)`,
      "--dsw-alias-button-elevated-fill": activeTheme.surface,
      "--dsw-alias-button-floating-hover": activeTheme.surfaceRaised
    }
  },
    h("aside", { className: "bees-sidebar" },
      h("div", { className: "bees-brand" },
        h("span", { className: "bees-mark", style: { background: "transparent", overflow: "hidden" } },
          h("img", { src: brandMark, alt: "", width: 28, height: 28 })),
        h("span", null, "Bees"),
        h("div", { className: "bees-brand-settings" },
          h("button", { type: "button",
            className: `bees-brand-settings-button ${section.id === "settings" && !["accounts", "team-settings"].includes(route) ? "active" : ""}`,
            title: "Global and organization settings", "aria-label": "Global and organization settings",
            onClick: () => navigate("appearance") }, h(SettingsIcon)))),
      h(ScopeSwitcher, { data, organizationId: parts.organizationId, teamId: parts.teamId, connectionId,
        onChange: setScope, onCreateOrganization: createOrganizationFromSwitcher, onCreateTeam: createTeam,
        onOpenTeamSettings: (team) => { setScope(`team:${team.id}`, connectionId); navigate("team-settings"); },
        onNavigate: navigate, route, sectionId: section.id, dashboards, activeDashboardId: activeDashboard.id,
        onOpenDashboard: (dashboardId) => { setRoute("home"); void preferences.set("activeDashboardId", dashboardId); },
        organizationColors: preference.organizationColors ?? {} }),
      h("div", { className: "bees-sidebar-foot" },
        h("button", { className: `bees-nav-link ${route === "guide" ? "active" : ""}`, "aria-current": route === "guide" ? "page" : null, onClick: () => navigate("guide") }, h("span", { style: { display: "flex", width: 18, color: "var(--dsw-alias-label-secondary)" } }, h(BookIcon)), h("span", null, "How Bees works")),
        h("button", { className: `bees-nav-link ${route === "accounts" ? "active" : ""}`, "aria-current": route === "accounts" ? "page" : null, onClick: () => navigate("accounts") }, h("span", { style: { display: "flex", width: 18, color: "var(--dsw-alias-label-secondary)" } }, h(AccountIcon)), h("span", null, "Accounts"))
      )
    ),
    h("section", { className: "bees-main" },
      h(AppHeader, { route, routeLabel, parts, ctx, preferences }),
      error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
      notice ? h("div", { className: "bees-notice", role: "status" }, h("strong", null, "Learned change"), h("pre", null, notice)) : null,
      h("main", { className: "bees-content" }, h("div", { className: `bees-panel ${route === "home" || section.id === "work" && workItemId ? "bees-panel-wide" : ""} ${section.id === "work" && workItemId ? "bees-panel-full-height" : ""}` }, page))
    )
  ));
}

function AppHeader({ route, routeLabel, parts, ctx, preferences }) {
  const [header, setHeader] = useState(null);
  const [actions, setActions] = useState(null);
  useEffect(() => {
    const update = () => { setHeader(headerEmitter.header); setActions(headerEmitter.actions); };
    headerEmitter.listeners.add(update);
    update();
    return () => headerEmitter.listeners.delete(update);
  }, []);

  return h("header", { className: "bees-top" },
    header ? header : h(React.Fragment, null,
      h("div", { className: "bees-title" }, routeLabel),
      route !== "home" ? h("div", { className: "bees-context" }, parts.team?.name ?? parts.organization?.name ?? "") : null
    ),
    h("div", { className: "bees-grow" }),
    actions,
    h(ThemeToggle, { ctx, preferences })
  );
}




function CreateOrganizationPage({ reload, setScope, navigate, createLocal }) {
  const [name, setName] = useState("");
  const [isLocal, setIsLocal] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    collaboration().then((value) => {
      if (active) setData(value);
    }).catch(console.error);
    return () => { active = false; };
  }, []);

  const createWithAccount = async (accountUserId) => {
    setBusy(true);
    try {
      const result = await collaboration("create_organization", { name, accountUserId });
      await reload();
      if (result?.id) {
        setScope(`organization:${result.id}`, result.connectionId);
        navigate("home");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const browserAuth = async (action, values) => {
    setBusy(true);
    try {
      const before = new Map((data?.accounts ?? []).map(({ userId, updatedAt }) => [userId, updatedAt]));
      const { url } = await collaboration(action, values);
      await openExternal(url);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        const next = await collaboration();
        const newAccount = (next.accounts ?? []).find(({ userId, updatedAt }) =>
          before.get(userId) !== updatedAt);
        if (newAccount) {
          await createWithAccount(newAccount.userId);
          return;
        }
      }
      throw new Error("Sign in was not completed");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const handleLocalSubmit = async (event) => {
    event.preventDefault();
    if (!name.trim()) { setError("Organization name is required"); return; }
    setBusy(true);
    try {
      await createLocal(name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  const accounts = (data?.accounts ?? []).filter(({ enabled }) => enabled !== false);

  return h("div", { className: "bees-stack", style: { maxWidth: 540, margin: "0 auto", padding: "32px 0" } },
    h("h2", { style: { textAlign: "center", marginBottom: "24px" } }, "Create Organization"),
    
    h("section", { className: "bees-box" },
      h("h3", null, "Organization Details"),
      h("div", { className: "bees-form" },
        h("label", null, "Name",
          h("input", { 
            className: "bees-input", 
            value: name, 
            onChange: (e) => setName(e.target.value), 
            placeholder: "Acme Corp", 
            disabled: busy 
          })
        ),
        h("label", { style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", cursor: "pointer" } },
          h("input", { 
            type: "checkbox", 
            checked: isLocal, 
            onChange: (e) => setIsLocal(e.target.checked),
            disabled: busy
          }),
          "Make it private (organization will be local to this device and cannot be shared with teammates)"
        ),
        isLocal ? h(Button, { className: "primary", disabled: busy || !name.trim(), onClick: handleLocalSubmit, style: { marginTop: "16px" } }, "Create organization") : null
      )
    ),

    !isLocal ? h(React.Fragment, null,
      (!data || accounts.length) ? h("section", { className: "bees-box", style: !data ? { opacity: 0.6, pointerEvents: "none" } : {} },
        h("h3", null, "Use an existing account"),
        h("p", { className: "bees-muted" }, "You are already signed in. Select an account to create this organization."),
        h("form", { className: "bees-form-row", onSubmit: (event) => {
          event.preventDefault();
          if (!name.trim()) { setError("Organization name is required"); return; }
          const form = new FormData(event.currentTarget);
          createWithAccount(String(form.get("userId") ?? ""));
        }},
          h("select", { className: "bees-select", name: "userId", disabled: busy || !name.trim() || !data },
            ...(!data ? [h("option", { key: "loading", value: "" }, "Loading accounts…")] : accounts.map((account) => h("option", { value: account.userId, key: account.userId }, `${account.name || account.email} · ${account.email}`)))
          ),
          h(Button, { type: "submit", className: "primary", disabled: busy || !name.trim() || !data }, "Create organization")
        )
      ) : null,

      h("section", { className: "bees-box", style: !data ? { opacity: 0.6, pointerEvents: "none" } : {} },
        h("h3", null, (!data || accounts.length) ? "Or sign in with another account" : "Sign in to continue"),
        h("p", { className: "bees-muted" }, "Sign in to create a connected organization that you can share with your team."),
        h(AccountSignInButtons, { disabled: busy || !name.trim() || !data, onStart: browserAuth }))
    ) : null,
    
    error ? h("div", { className: "bees-error", role: "alert", style: { marginTop: "16px" } }, error) : null
  );
}
