import {
  FreeAiController, h, LocalAiController, React, useEffect, useRef, useState
} from "./runtime.js";
import {
  artifactRuns, ask, collaboration, confirmAction, connectionIdForScope, defaultOrgColor, headerEmitter, NAVIGATION, request, scopeParts, runTitle, sectionFor, Button, openExternal,
  THEME_PRESETS, ThemeToggle, usePreference, workItemsFor
} from "./shared.js";
import { AccountIcon, BookIcon, ChevronDownIcon, CloseIcon, EditIcon, KnowledgeIcon, SettingsIcon } from "./icons.js";
import { Home, GuidePage } from "./home.js";
import { GettingStarted, GettingStartedBar, onboardingAiKey, planningAgents, starterDescription } from "./getting-started.js";
import { BasicsPage } from "./basics.js";
import { dashboardsFrom } from "./dashboard-model.js";
import { WorkPage } from "./work.js";
import { ProcessesPage } from "./processes.js";
import { AppsPage } from "./apps.js";
import { AgentsPage } from "./agents.js";
import { McpPage, SkillsPage, useCapabilities } from "./skills.js";
import { ActivityPage, FilesPage, KnowledgePage } from "./resources.js";
import { AccountsPage, AccountSignInButtons, SettingsPage } from "./settings.js";
import { ProductSettings } from "./product-settings.js";
import brandMark from "../../../src/brand-mark.png";

const newDashboardId = () => globalThis.crypto?.randomUUID?.() ?? `dashboard-${Date.now()}`;

function ScopeSwitcher({
  data, organizationId, teamId, connectionId, onChange,
  onCreateOrganization, onCreateTeam, onOpenTeamSettings, onNavigate,
  route, sectionId, dashboards, activeDashboardId, onOpenDashboard, onCreateDashboard, onRenameDashboard, onDeleteDashboard, organizationColors
}) {
  const [expandedTeams, setExpandedTeams] = useState(() => new Set(teamId ? [teamId] : []));
  const [expandedMenus, setExpandedMenus] = useState(() => new Set(teamId ? [`${teamId}:home`] : []));
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
    (!allowedTeams || allowedTeams.has(row.id))).map((row) => ({ ...row,
      role: data.connectionTeams?.find((access) =>
        access.connectionId === connectionId && access.teamId === row.id)?.role ?? row.role
    }));
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
        "aria-label": "Add organization", onClick: onCreateOrganization }, h(CloseIcon))),
    selectedOrganization ? h("div", { className: "bees-org-summary", "aria-live": "polite" },
      h("div", { className: "bees-org-summary-title" },
        h("strong", { title: selectedOrganization.name }, selectedOrganization.name),
        h("span", { className: "bees-badge" }, selectedOrganization.type)),
      h("div", { className: "bees-org-summary-meta", title: selectedOrganization.meta }, selectedOrganization.meta)) : null,
    h("div", { className: "bees-team-heading" },
      h("span", null, "Teams"),
      h("button", { type: "button", className: "bees-scope-add", disabled: !organizationId,
        title: "Add team", "aria-label": "Add team", onClick: onCreateTeam }, h(CloseIcon))),
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
          h("span", { className: `bees-team-chevron ${expanded ? "expanded" : ""}`, "aria-hidden": "true" }, h(ChevronDownIcon)),
          h("span", { className: "bees-team-initial", "aria-hidden": "true" }, row.name.trim().charAt(0).toLocaleUpperCase() || "•"),
          h("span", { className: "bees-team-name" }, row.name)),
          h("button", { type: "button", className: "bees-team-settings", title: `${row.name} settings`,
            "aria-label": `${row.name} settings`, onClick: () => onOpenTeamSettings(row) }, h(SettingsIcon))),
        expanded ? h("nav", { className: "bees-team-nav", "aria-label": `${row.name} navigation` },
          ...NAVIGATION.filter(({ id }) => !["apps", "settings"].includes(id)).map((item) => {
            const menuKey = `${row.id}:${item.id}`;
            const menuExpanded = expandedMenus.has(menuKey);
            const hasChildren = item.id === "home" || item.children.length > 0;
            return h(React.Fragment, { key: menuKey },
            h("div", { className: `bees-nav-menu ${active && sectionId === item.id ? "active" : ""} ${menuExpanded ? "expanded" : ""}` },
              h("button", { className: `bees-nav-link ${active && sectionId === item.id ? "active" : ""}`,
                "aria-current": active && sectionId === item.id ? "page" : null,
                "aria-expanded": hasChildren ? menuExpanded : null, onClick: () => {
                  if (item.id === "home") {
                    if (!active) onChange(`team:${row.id}`, connectionId);
                    onOpenDashboard(activeDashboardId);
                  } else open(item.id);
                  if (hasChildren) setExpandedMenus((current) => {
                    const next = new Set(current);
                    if (next.has(menuKey)) next.delete(menuKey); else next.add(menuKey);
                    return next;
                  });
                } },
              h("span", { style: { display: "flex", width: 18, color: "var(--dsw-alias-label-secondary)" } }, h(item.icon)),
              h("span", null, item.label),
              item.id === "home" ? h("span", { className: "bees-nav-count", "aria-label": `${dashboards.length} dashboard${dashboards.length === 1 ? "" : "s"}` }, dashboards.length) : null,
              hasChildren ? h("span", { className: `bees-nav-chevron ${menuExpanded ? "expanded" : ""}`, "aria-hidden": "true" }, h(ChevronDownIcon)) : null),
              item.children && item.children.length > 0 && menuExpanded ? h("div", { className: "bees-nav-flyout" },
                ...item.children.map(([child, label]) => h("div", {
                  className: `bees-nav-flyout-item ${active && route === child ? "active" : ""}`,
                  key: `${row.id}:${item.id}:${child}`
                }, h("button", { className: `bees-nav-link bees-nav-child ${active && route === child ? "active" : ""}`,
                  "aria-current": active && route === child ? "page" : null, onClick: () => open(child) }, label)))
              ) : null),
            item.id === "home" && menuExpanded ? h("div", { className: "bees-nav-dashboards" },
              ...dashboards.map((dashboard) => h("div", { className: "bees-dashboard-item", key: `${row.id}:${dashboard.id}` },
                h("button", {
                  type: "button", title: dashboard.name,
                  className: `bees-nav-link bees-nav-child bees-dashboard-link ${active && route === "home" && dashboard.id === activeDashboardId ? "active" : ""}`,
                  "aria-current": active && route === "home" && dashboard.id === activeDashboardId ? "page" : null,
                  onClick: () => {
                    if (!active) onChange(`team:${row.id}`, connectionId);
                    onOpenDashboard(dashboard.id);
                  }
                }, dashboard.name),
                h("button", {
                  type: "button", className: "bees-dashboard-action", title: `Rename ${dashboard.name}`,
                  "aria-label": `Rename ${dashboard.name}`, onClick: () => onRenameDashboard(dashboard)
                }, h(EditIcon)),
                dashboard.id !== "home" ? h("button", {
                  type: "button", className: "bees-dashboard-remove bees-dashboard-action", title: `Delete ${dashboard.name}`,
                  "aria-label": `Delete ${dashboard.name}`, onClick: () => onDeleteDashboard(dashboard)
                }, h(CloseIcon)) : null)),
              h("button", {
                type: "button", className: "bees-nav-link bees-nav-child bees-dashboard-create",
                disabled: dashboards.length >= 20, title: dashboards.length >= 20 ? "Dashboard limit reached" : "Create dashboard",
                onClick: () => {
                  if (!active) onChange(`team:${row.id}`, connectionId);
                  onCreateDashboard();
                }
              }, h("span", { className: "bees-add-icon", "aria-hidden": "true" }, h(CloseIcon)), h("span", null, "New dashboard"))
            ) : null
          ); })) : null);
      })));
}

export function BeesApp({ ctx, preferences: personalPreferences, modelSettings: personalModelSettings }) {
  const productSettings = React.useMemo(() => new ProductSettings(request, (message) => setError(message)), []);
  const [platform, setPlatform] = useState(productSettings.state);
  const preferences = React.useMemo(() => productSettings.scope("bees", personalPreferences), [productSettings, personalPreferences, platform.scopeVersion]);
  const modelSettings = React.useMemo(() => productSettings.scope("llm-pi-ai", personalModelSettings), [productSettings, personalModelSettings, platform.scopeVersion]);
  useEffect(() => productSettings.subscribe(() => setPlatform({ ...productSettings.state })), [productSettings]);
  const personalPreference = usePreference(personalPreferences);
  const preference = platform.editing ? preferences.getSnapshot().value : personalPreference;
  const onboarding = preference.onboarding ?? {};
  const initializedOnboarding = useRef(false);
  const [aiTest, setAiTest] = useState(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const setupLock = useRef(false);
  const unstarted = useRef({});
  const [aiStatus, setAiStatus] = useState("Choose a model in AI connections, then test it here.");
  const personalModelConfig = usePreference(personalModelSettings);
  const modelConfig = platform.editing ? modelSettings.getSnapshot().value : personalModelConfig;
  const updateOnboarding = (patch) => preferences.set("onboarding", {
    ...(preferences.getSnapshot().value?.onboarding ?? {}), ...patch
  });
  const [data, setData] = useState(null);
  const [stillStarting, setStillStarting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const accountsKey = JSON.stringify((data?.accounts ?? []).map(({ userId }) => userId));
  useEffect(() => {
    productSettings.reset();
    // Independent of initial data loading; a disconnected app renders normally.
    if (data?.accounts?.length) void productSettings.check();
    const retry = () => {
      if (data?.accounts?.length && !productSettings.state.isPlatformAdmin && !productSettings.state.busy)
        void productSettings.check();
    };
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      productSettings.reset();
    };
  }, [accountsKey, productSettings]);
  // Approval/question waterfalls need a retained session even when its Chat tab is closed.
  const interactionSessions = useRef(new Map());
  useEffect(() => {
    const wanted = new Set((data?.runs ?? []).filter((run) => !run.ranElsewhere && run.sessionId &&
      ["running", "waiting_for_input", "waiting_for_approval"].includes(run.status)).map((run) => run.sessionId));
    for (const id of wanted) {
      if (interactionSessions.current.has(id)) continue;
      let reference;
      // a run recovered at boot lists its new session before the session store has it; the 30s reload retries
      try { reference = ctx.sessions.retain(id, { source: "bees" }); } catch { continue; }
      interactionSessions.current.set(id, reference);
      reference.ready.catch((reason) => {
        if (interactionSessions.current.get(id) !== reference) return;
        interactionSessions.current.delete(id); reference.release();
        setError(`Could not load the agent's request: ${reason instanceof Error ? reason.message : String(reason)}`);
      });
    }
    for (const [id, reference] of interactionSessions.current) if (!wanted.has(id)) {
      reference.release(); interactionSessions.current.delete(id);
    }
  }, [ctx, data]);
  useEffect(() => () => {
    for (const reference of interactionSessions.current.values()) reference.release();
    interactionSessions.current.clear();
  }, [ctx]);
  const startupRendered = useRef(false);
  useEffect(() => {
    void globalThis.fetch?.("/bees-api/startup?phase=ui.shell-mounted", { method: "POST" }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!data || startupRendered.current) return;
    startupRendered.current = true;
    // Report after the populated UI has had a frame to paint, not merely after fetching data.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      void globalThis.fetch?.("/bees-api/startup?phase=ui.data-rendered", { method: "POST" }).catch(() => {});
    }));
  }, [data]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [route, setRoute] = useState("home");
  const [scope, setScopeState] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [processId, setProcessId] = useState("");
  const [workItemId, setWorkItemId] = useState("");
  const [creating, setCreating] = useState("");
  // bumped by a sidebar click, so a page that keeps its own open item goes back to its list
  const [visit, setVisit] = useState(0);
  const [creatingOrganizationName, setCreatingOrganizationName] = useState("");
  const [processDraft, setProcessDraft] = useState(null);
  const [workProcessId, setWorkProcessId] = useState("");
  const setPageActions = (actions) => headerEmitter.setActions(actions);
  const setPageHeader = (header) => headerEmitter.setHeader(header);
  const load = async () => {
    try { const value = await request("/bees-api/snapshot"); setData(value); return value; }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return null; }
  };
  const retryStartup = async () => {
    if (retrying) return;
    setRetrying(true);
    try { await load(); } finally { setRetrying(false); }
  };
  // a hung first load never errors or resolves, so tell the user after 45s instead of animating forever
  useEffect(() => {
    if (data) { setStillStarting(false); return undefined; }
    const timer = setTimeout(() => setStillStarting(true), 45_000);
    return () => clearTimeout(timer);
  }, [data]);
  useEffect(() => ctx.slots.inject("conversation.composer", () => ctx.slots.register({
    name: "conversation.composer", id: "bees-managed-continuation", priority: 20,
    select: ({ sessionId, pendingInteraction }) => {
      const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
      const run = data?.runs.find(run => !run.ranElsewhere &&
        (run.sessionId === sessionId || (cwd && run.outputsPath === `${cwd}/outputs`)));
      if (!run || pendingInteraction) return null;
      if (run.sessionId !== sessionId) return {};
      const item = data.items.find(item => item.id === run.workItemId);
      return !["running", "waiting_for_input", "waiting_for_approval"].includes(run.status) || item?.archivedAt ? {} : null;
    }
  }, () => h("p", { className: "bees-muted", role: "status", style: { padding: "16px" } },
    "To continue this work, message the agent from the work item's Conversation panel."))), [ctx, data]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30_000); return () => clearInterval(timer); }, []);
  const content = useRef(null);
  // a new page starts at the top, not where the last page was scrolled to
  useEffect(() => { content.current?.scrollTo(0, 0); }, [route, processId, workItemId]);
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
    // A first render holds no values, so this would push the forest/dark default into DSH's theme and
    // persist it over the saved choice. Wait for the served settings; the effect re-runs when they land.
    if (preferences.getSnapshot().status !== "ready") return;
    const theme = ctx.get?.("theme") ?? ctx.theme;
    const preset = THEME_PRESETS.find(({ id }) => id === preference.themePreset)
      ?? THEME_PRESETS.find(({ id }) => id === "halloween");
    const colorMode = ["dark", "light"].includes(preference.colorMode)
      ? preference.colorMode : preset.dark ? "dark" : "light";
    if (!preferences.productDefaults && theme.getTheme().preference !== colorMode) theme.setTheme(colorMode);
    if (!preference.themePreset) void preferences.set("themePreset", "halloween");
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
  useEffect(() => {
    if (!data || initializedOnboarding.current) return;
    initializedOnboarding.current = true;
    if (!onboarding.version) {
      const active = data.items.length === 0;
      void updateOnboarding({ version: 1, active });
      if (active) setRoute("getting-started");
    } else if (onboarding.active) setRoute("getting-started");
  }, [data, onboarding.version]);
  useEffect(() => { setAiTest(null); }, [JSON.stringify(modelConfig), JSON.stringify(data?.systemDefaultModel)]);
  const setScope = (next, nextConnectionId = connectionId) => {
    setConnectionId(nextConnectionId);
    setScopeState(next); setProcessId(""); setWorkItemId(""); setCreating(""); setProcessDraft(null); setWorkProcessId("");
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
  // a pop-up passes its own onError, the page banner sits under its backdrop
  const act = async (command, context = parts, onError = setError) => {
    unstarted.current = {};
    try {
      const result = await request("/bees-api/command", {
        method: "POST",
        body: JSON.stringify({
          ...command, connectionId: context.connection?.id ?? "",
          accountUserId: context.accountUserId ?? ""
        })
      });
      await load();
      // a run saved but not started would sit at ready with no reason, so keep it until that run opens
      if (result?.id && (result.error || result.waitingFor)) {
        unstarted.current = { id: result.id, note: `Saved, but it could not start yet: ${result.error || result.waitingFor}` };
        setError(unstarted.current.note);
      }
      if (result?.learnedChange !== undefined) {
        setNotice(`Updated ${result.name}:\n${result.learnedChange || "No specialist guidance"}`);
        window.setTimeout(() => setNotice(""), 10_000);
      }
      return result;
    }
    catch (reason) { onError(reason instanceof Error ? reason.message : String(reason)); return null; }
  };
  const navigate = (id) => {
    if (id === "dsh-settings") {
      document.querySelector('button[aria-haspopup="dialog"][aria-expanded]')?.click();
      return;
    }
    if (id === "home") void preferences.set("activeDashboardId", "home");
    const section = NAVIGATION.find((row) => row.id === id);
    // an error belongs to the page it came from, so it must not follow you to the next one
    setError(""); setRoute(section ? section.defaultChild : id); setProcessId(""); setWorkItemId(""); setCreating(""); setProcessDraft(null); setWorkProcessId("");
  };
  const finishOrganization = async (organizationId, nextConnectionId = "") => {
    const fresh = await load();
    let team = fresh?.teams.find((row) => row.organizationId === organizationId && row.name === "Default")
      ?? fresh?.teams.find((row) => row.organizationId === organizationId);
    setScope(team ? `team:${team.id}` : `organization:${organizationId}`, nextConnectionId);
    if (!team && onboarding.active) {
      navigate("getting-started");
      await updateOnboarding({ step: 0 });
      team = nextConnectionId
        ? await collaboration("create_team", { name: "Default", connectionId: nextConnectionId })
        : await act({ action: "create_team", organizationId, name: "Default" }, {});
      if (!team?.id) throw new Error("Workspace created. Open it and add a team to continue.");
      await load();
    }
    setScope(team ? `team:${team.id}` : `organization:${organizationId}`, nextConnectionId);
    if (onboarding.active) {
      await updateOnboarding({ step: 1, teamId: team?.id || "", connectionId: nextConnectionId });
      navigate("getting-started");
    } else navigate("home");
  };
  const createLocalOrganization = async (name) => {
    const result = await act({ action: "create_organization", name }, {});
    if (!result?.id) throw new Error("Could not create the organization. Please try again.");
    await finishOrganization(result.id);
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
  const createProcess = () => { setRoute("all-processes"); setProcessId(""); setProcessDraft(null); setCreating("process"); };
  const createRun = () => { setRoute("all-work"); setWorkItemId(""); setWorkProcessId(""); setCreating("run"); };
  const createAgent = () => { setRoute("all-agents"); setCreating("agent"); };
  const capabilities = useCapabilities(route);
  const localAi = h(LocalAiController, { modelSettings: personalModelSettings, preferences: personalPreferences,
    catalog: data?.localModelCatalog, onError: setError });
  const freeAi = h(FreeAiController, { modelSettings: personalModelSettings, onError: setError });
  if (!data) return h(React.Fragment, null, localAi, freeAi,
    h("div", { className: "bees-app bees-loading", style: { display: "flex", flexDirection: "column", gap: "16px", background: "#111315" } }, 
      error || h(React.Fragment, null,
        h("style", null, `@keyframes hover { 50% { transform: translateY(-6px); } }`),
        h("img", { src: brandMark, style: { width: "54px", height: "54px", borderRadius: "16px", objectFit: "cover", animation: "hover 1.8s ease-in-out infinite" } }),
        h("strong", { style: { fontSize: "20px", color: "#f5f5f5" } }, "Bees Desktop"),
        stillStarting ? h(React.Fragment, null,
          h("span", { style: { color: "#f5f5f5" }, role: "status" }, "Still starting"),
          h(Button, { onClick: retryStartup, disabled: retrying }, retrying ? "Retrying…" : "Retry")
        ) : null
      )));
  const dashboards = dashboardsFrom(preference.dashboards);
  const activeDashboard = dashboards.find(({ id }) => id === preference.activeDashboardId) ?? dashboards[0];
  const createDashboard = async () => {
    if (dashboards.length >= 20) return;
    const name = await ask("Dashboard name", "New dashboard");
    if (!name) return;
    const created = { id: newDashboardId(), name, widgets: activeDashboard.widgets.map((widget) => ({ ...widget })) };
    await preferences.set("dashboards", [...dashboards, created]);
    await preferences.set("activeDashboardId", created.id);
    setRoute("home");
  };
  const deleteDashboard = async (dashboard) => {
    if (dashboard.id === "home" || !(await confirmAction(`Delete “${dashboard.name}”?`))) return;
    await preferences.set("dashboards", dashboards.filter(({ id }) => id !== dashboard.id));
    if (activeDashboard.id === dashboard.id) await preferences.set("activeDashboardId", "home");
  };
  const renameDashboard = async (dashboard) => {
    const name = await ask("Dashboard name", dashboard.name);
    if (name) await preferences.set("dashboards", dashboards.map((candidate) => candidate.id === dashboard.id ? { ...dashboard, name } : candidate));
  };
  const activeTheme = THEME_PRESETS.find(({ id }) => id === preference.themePreset)
    ?? THEME_PRESETS.find(({ id }) => id === "halloween");
  const section = sectionFor(route);
  const routeLabel = route === "getting-started" ? "Getting started" : route === "basics" ? "Bees basics" : route === "guide" ? "Detailed guides" : route === "create-organization" ? "Create organization" : route === "home" ? activeDashboard.name : route === "accounts" ? "Accounts"
    : section.children.find(([id]) => id === route)?.[1] ?? section.label;
  const openProcess = (id) => { setError(""); setRoute("all-processes"); setProcessId(id); setWorkItemId(""); setCreating(""); };
  const openWorkItem = (id, processForWork = "") => {
    setError(id && unstarted.current.id === id ? unstarted.current.note : ""); setRoute("all-work"); setProcessId(""); setWorkItemId(id ?? "");
    setWorkProcessId(processForWork); setCreating(id ? "" : processForWork ? "run" : "work");
  };
  // A question waiting for you is not a workspace thing, so that route covers every workspace. The
  // Needs you count and the page it opens both read this, or the number and the list disagree.
  const scopeFor = (targetRoute) => targetRoute === "waiting" ? (data.workspaces ?? []).map(({ id }) => id) : workspaceIds;
  const rowsForRoute = (targetRoute) => {
    const target = sectionFor(targetRoute);
    const openRoute = () => navigate(targetRoute);
    if (target.id === "work") return workItemsFor(viewData, targetRoute, scopeFor(targetRoute))
      .map((item) => ({ id: item.id, label: item.title, item, open: () => {
        // a waiting row can belong to another team, so open it inside that team
        const workspace = data.workspaces.find(({ id }) => id === data.processes.find(({ id }) => id === item.processId)?.workspaceId);
        if (workspace && workspace.id !== parts.workspaceId)
          setScope(`team:${workspace.teamId}`, connectionIdForScope(data, `team:${workspace.teamId}`, connectionId));
        openWorkItem(item.id);
      } }));
    if (target.id === "processes") {
      if (targetRoute === "templates") return (data.templates ?? []).filter((row) => workspaceIds.includes(row.workspaceId))
        .map((row) => ({ id: row.id, label: row.name, open: openRoute }));
      return data.processes.filter((row) => workspaceIds.includes(row.workspaceId))
        .map((row) => ({ id: row.id, label: row.name, open: () => { setRoute("all-processes"); setProcessId(row.id); } }));
    }
    if (target.id === "agents") {
      const assignments = data.assignments.filter((row) => workspaceIds.includes(row.workspaceId) && !row.archivedAt);
      if (targetRoute === "skills") return [];
      if (targetRoute === "presets") return data.presets.map((row) => ({ id: row.id, label: row.name, open: openRoute }));
      if (targetRoute === "mcp") return (capabilities.data?.servers ?? [])
        .map((row) => ({ id: row.id, label: row.label, open: openRoute }));
      return assignments.map((row) => ({ id: row.id, label: row.name, open: openRoute }));
    }
    if (target.id === "files" || targetRoute === "sources") return data.locations.filter((row) => row.teamId === parts.teamId && !row.archivedAt)
      .map((row) => ({ id: row.id, label: row.name, open: openRoute }));
    if (targetRoute === "runs") return viewData.runs.filter((row) => workspaceIds.includes(row.workspaceId)).map((row) => ({
      id: row.id, label: runTitle(viewData, row), open: () => openWorkItem(row.workItemId ?? row.id)
    }));
    if (targetRoute === "artifacts") return artifactRuns(viewData.runs, parts.workspaceId).map((row) => ({ id: row.id, label: runTitle(viewData, row), open: openRoute }));
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
  const aiKey = onboardingAiKey(data, parts.workspaceId, modelConfig);
  // the passed test is saved too, so a restart does not send the tester back to step 2
  const aiReady = aiKey === (aiTest ?? onboarding.aiTested);
  const saveAgentModel = async (agent, model) => {
    // Every other agent, CEO and the rest included, runs on the system default. Left unset they fall
    // back to a provider nobody signed in to, so a delegated peer dies on "Connection error".
    const [provider, ...rest] = String(model?.model ?? "").split("/");
    if (rest.length) await request("/bees-api/system-default-model", { method: "POST",
      body: JSON.stringify({ provider, model: rest.join("/"), reasoningEffort: model.reasoningEffort ?? "" }) });
    const result = await act({ ...agent, action: "edit_agent_assignment", agentAssignmentId: agent.id, model: "", reasoningEffort: "" });
    if (!result?.id) throw new Error("Could not save the agent's AI");
    setAiTest(null);
    return { ...agent, ...model };
  };
  const savePlanningAi = async (agent, model) => {
    if (setupLock.current) return;
    setupLock.current = true; setSetupBusy(true);
    try { await saveAgentModel(agent, model); setAiStatus("AI choice saved. Test the selected AI before starting."); }
    catch (reason) { setAiStatus(`Connection test failed: ${reason.message || reason}`); }
    finally { setupLock.current = false; setSetupBusy(false); }
  };
  const testAi = async () => {
    if (setupLock.current) return;
    setupLock.current = true; setSetupBusy(true); setAiTest(null); setAiStatus("Testing your selected model…");
    try {
      const [planner, reviewer] = planningAgents(data, parts.workspaceId);
      if (planner?.enabled === false || reviewer?.enabled === false) throw new Error("Enable the agents in Agents first.");
      const result = await request("/bees-api/onboarding/test-ai", { method: "POST",
        body: JSON.stringify({ plannerModel: planner?.model || null, reviewerModel: reviewer?.model || null,
          plannerReasoningEffort: planner?.reasoningEffort || null, reviewerReasoningEffort: reviewer?.reasoningEffort || null }) });
      let testedData = data;
      if (result.fallback && reviewer) {
        const saved = await saveAgentModel(reviewer, { model: planner?.model || null, reasoningEffort: planner?.reasoningEffort || null });
        testedData = { ...data, assignments: data.assignments.map((agent) => agent.id === saved.id ? saved : agent) };
      }
      const tested = onboardingAiKey(testedData, parts.workspaceId, modelConfig);
      setAiTest(tested);
      void updateOnboarding({ aiTested: tested });
      setAiStatus(result.fallback
        ? `Reviewer AI was unavailable. Both agents now use ${result.plannerModel}. Ready for your first task.`
        : "Your selected AI responded successfully. Ready for your first task.");
    } catch (reason) {
      setAiTest("");
      void updateOnboarding({ aiTested: "" });
      setAiStatus(`Connection test failed: ${reason.message || reason}`);
    }
    finally { setupLock.current = false; setSetupBusy(false); }
  };
  const goSetup = (step, focus) => {
    void updateOnboarding({ active: true, step, ...(step === 2 ? { filesChoice: "own" } : {}) });
    navigate(step === 0 ? "create-organization" : step === 1 ? "personal-ai" : "locations");
    if (focus) void preferences.set("onboardingAiFocus", focus);
  };
  const openStarter = (id) => {
    const item = data.items.find((row) => row.id === id);
    const team = data.teams.find((row) => data.workspaces.some((workspace) => workspace.id === item?.workspaceId && workspace.teamId === row.id));
    if (team) setScope(`team:${team.id}`, onboarding.connectionId || "");
    openWorkItem(id);
  };
  const startFirstTask = async (prompt) => {
    if (setupLock.current || !aiReady || !parts.workspaceId || !prompt.trim()) return;
    if (data.items.some(({ id, runtimePhase }) => id === onboarding.workItemId && runtimePhase !== "cancelled")) return openStarter(onboarding.workItemId);
    setupLock.current = true; setSetupBusy(true);
    try {
      const inputLocationIds = (onboarding.inputLocationIds || []).filter((id) => data.locations.some((row) => row.id === id && row.teamId === parts.teamId && row.mapped && !row.archivedAt));
      const result = await act({ action: "create_goal", workspaceId: parts.workspaceId, inputLocationIds,
        title: prompt.trim().split("\n")[0].slice(0, 120), description: starterDescription(prompt, onboarding.filesChoice, inputLocationIds.length) });
      if (!result?.id) return;
      await updateOnboarding({ workItemId: result.id, teamId: parts.teamId, connectionId, step: 3 });
      openWorkItem(result.id);
    } finally { setupLock.current = false; setSetupBusy(false); }
  };
  const page = route === "home" ? h(Home, {
    key: parts.workspaceId, capabilities,
    ctx, data: viewData, workspaceId: parts.workspaceId, act, openWorkItem, navigate,
    rowsForRoute, preference, preferences, setPageActions, setPageHeader, createWork, createProcess, createRun, createAgent
  })
    : route === "getting-started" ? h(GettingStarted, { ctx, data, parts, state: onboarding, update: updateOnboarding, saveAgentModel: savePlanningAi,
        aiReady, aiStatus: setupBusy ? aiStatus : aiReady ? (aiTest ? aiStatus : "Your selected AI passed its test. Ready for your first task.") : aiStatus.startsWith("Connection test failed") ? aiStatus : "Choose your AI and test the selected model before starting.", testAi, busy: setupBusy, ensureTeam: async () => {
          if (setupLock.current) return;
          setupLock.current = true; setSetupBusy(true);
          try { await finishOrganization(parts.organizationId, connectionId); }
          catch (reason) { setError(reason.message || String(reason)); }
          finally { setupLock.current = false; setSetupBusy(false); }
        }, go: goSetup, start: startFirstTask, openWorkItem: openStarter, navigate })
    : route === "create-organization" ? h(CreateOrganizationPage, { reload: load, createLocal: createLocalOrganization, onboarding: onboarding.active, onCreated: finishOrganization })
    : route === "basics" ? h(BasicsPage, { navigate, onStart: async () => {
        await updateOnboarding({ active: true, step: parts.teamId ? 3 : 0 });
        navigate("getting-started");
      } })
    : route === "guide" ? h(GuidePage)
    : route === "accounts" ? h(AccountsPage, { reload: load })
    : route === "apps" ? h(AppsPage, { key: `${parts.workspaceId}:${connectionId}`, workspaceId: parts.workspaceId, connectionId, openWorkItem })
    : section.id === "work" ? h(WorkPage, { ctx, data: viewData, route, workspaceIds: scopeFor(route), workspaceId: parts.workspaceId, teamId: parts.teamId, workItemId, setWorkItemId, creating, setCreating, defaultProcessId: workProcessId, setWorkProcessId, act, capabilities, preference, preferences, setPageActions, setPageHeader })
      : section.id === "processes" ? h(ProcessesPage, { ctx, data: viewData, servers: capabilities.data?.servers ?? [], tools: capabilities.data?.tools ?? [], catalog: capabilities.data?.catalog ?? [], onServerAction: capabilities.act, route, workspaceIds, workspaceId: parts.workspaceId, teamId: parts.teamId, processId, setProcessId, openWorkItem, creating, setCreating, processDraft, setProcessDraft, act, preference, preferences, setPageActions, setPageHeader })
        : route === "skills" ? h(SkillsPage, { capabilities })
        : route === "mcp" ? h(McpPage, { ctx, capabilities })
        : section.id === "agents" ? h(AgentsPage, { ctx, data: viewData, servers: capabilities.data?.servers ?? [], tools: capabilities.data?.tools ?? [], catalog: capabilities.data?.catalog ?? [], onServerAction: capabilities.act, workspaceIds, workspaceId: parts.workspaceId, creating, setCreating, act, openDshSettings: () => navigate("dsh-settings"), preference, preferences, setPageActions, setPageHeader })
          : section.id === "files" ? h(FilesPage, { ctx, data: viewData, teamId: parts.teamId, act })
            : section.id === "activity" ? h(ActivityPage, { data: viewData, route, workspaceIds, openWorkItem, openProcess })
              : section.id === "knowledge" ? h(KnowledgePage, { data: viewData, route, workspaceId: parts.workspaceId, teamId: parts.teamId, openWorkItem })
                : h(SettingsPage, { key: platform.scopeVersion, ctx, data: viewData, act, route, teamId: parts.teamId,
                    organizationId: parts.organizationId, connectionId, modelSettings, preferences, preference, reload: load,
                    navigate, productSettings, platform,
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
      "--dsw-alias-label-secondary": `color-mix(in srgb, ${activeTheme.foreground} 88%, transparent)`,
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
            className: `bees-brand-settings-button ${section.id === "settings" && !["accounts", "team-settings", "team-members", "team-invitations", "team-memory", "team-folders"].includes(route) ? "active" : ""}`,
            title: "Global and organization settings", "aria-label": "Global and organization settings",
            onClick: () => navigate("personal-ai") }, h(SettingsIcon)))),
      h(ScopeSwitcher, { data, organizationId: parts.organizationId, teamId: parts.teamId, connectionId,
        onChange: setScope, onCreateOrganization: createOrganizationFromSwitcher, onCreateTeam: createTeam,
        onOpenTeamSettings: (team) => { setScope(`team:${team.id}`, connectionId); navigate("team-settings"); },
        onNavigate: (id) => { setVisit((value) => value + 1); navigate(id); }, route, sectionId: section.id, dashboards, activeDashboardId: activeDashboard.id,
        onOpenDashboard: (dashboardId) => { setRoute("home"); void preferences.set("activeDashboardId", dashboardId); },
        onCreateDashboard: createDashboard,
        onRenameDashboard: renameDashboard,
        onDeleteDashboard: deleteDashboard,
        organizationColors: preference.organizationColors ?? {} }),
      h("div", { className: "bees-sidebar-foot" },
        h("button", { className: `bees-nav-link bees-utility-link ${route === "getting-started" ? "active" : ""}`, "aria-current": route === "getting-started" ? "page" : null, onClick: () => { void updateOnboarding({ active: true }); navigate("getting-started"); } }, h("span", { style: { display: "flex", width: 18, color: "var(--dsw-alias-label-secondary)" } }, h(BookIcon)), h("span", null, "Getting started")),
        h("button", { className: `bees-nav-link bees-utility-link ${route === "basics" ? "active" : ""}`, "aria-current": route === "basics" ? "page" : null, onClick: () => navigate("basics") }, h("span", { style: { display: "flex", width: 18, color: "var(--dsw-alias-label-secondary)" } }, h(KnowledgeIcon)), h("span", null, "Bees basics")),
        h("button", { className: `bees-nav-link bees-utility-link bees-accounts-link ${route === "accounts" ? "active" : ""}`, "aria-current": route === "accounts" ? "page" : null, onClick: () => navigate("accounts") },
          (() => {
            const accounts = Array.from(new Map((data.accounts ?? []).filter((c) => c.email || c.name).map((c) => [c.userId || c.email, c.name || c.email])).values());
            if (accounts.length === 0) return h(React.Fragment, null, h("span", { style: { display: "flex", width: 18, color: "var(--dsw-alias-label-secondary)" } }, h(AccountIcon)), h("span", null, "Accounts"));
            return h(React.Fragment, null,
              h("span", { style: { display: "flex", color: "var(--dsw-alias-label-secondary)" } },
                h("div", { className: "bees-account-avatars" },
                  ...accounts.slice(0, 3).map((name, i) => h("div", { className: "bees-account-avatar", key: i }, name.charAt(0).toUpperCase())),
                  accounts.length > 3 ? h("div", { className: "bees-account-avatar" }, `+${accounts.length - 3}`) : null
                )
              ),
              h("span", null, "Accounts")
            );
          })()
        )
      )
    ),
    h("section", { className: "bees-main" },
      h(AppHeader, { routeLabel, parts, ctx, preferences }),
      platform.editing ? h("div", { className: "bees-callout", role: "status", "data-product-defaults": true },
        "Editing product defaults — model lists, layouts and appearance save immediately for future builds.") : null,
      onboarding.active && route === "home" ? h(GettingStartedBar, { state: onboarding, update: updateOnboarding, navigate, aiStatus: aiReady ? "AI ready" : "AI setup can continue while you explore.", data, openWorkItem: openStarter }) : null,
      error ? h("div", { className: "bees-error", role: "alert", style: { display: "flex", alignItems: "center", gap: "12px" } },
        h("span", { style: { flex: 1, minWidth: 0, overflowWrap: "anywhere" } }, error),
        h(Button, { onClick: () => setError(""), "aria-label": "Dismiss error" }, "Dismiss")) : null,
      notice ? h("div", { className: "bees-notice", role: "status" }, h("strong", null, "Learned change"), h("pre", null, notice)) : null,
      h("main", { className: "bees-content", ref: content }, h("div", { key: visit, className: `bees-panel ${route === "home" || section.id === "work" && workItemId ? "bees-panel-wide" : ""} ${section.id === "work" && workItemId ? "bees-panel-full-height" : ""}` }, page))
    )
  ));
}

function AppHeader({ routeLabel, parts, ctx, preferences }) {
  const [header, setHeader] = useState(null);
  const [actions, setActions] = useState(null);
  const scopeName = parts.team?.name ?? parts.organization?.name ?? "";
  useEffect(() => {
    const update = () => { setHeader(headerEmitter.header); setActions(headerEmitter.actions); };
    headerEmitter.listeners.add(update);
    update();
    return () => headerEmitter.listeners.delete(update);
  }, []);

  return h("header", { className: "bees-top" },
    header ? header : h("div", { style: { minWidth: 0 } },
      h("div", { className: "bees-title" }, routeLabel),
      scopeName ? h("div", { className: "bees-context" }, scopeName) : null
    ),
    h("div", { className: "bees-grow" }),
    actions,
    h(ThemeToggle, { ctx, preferences })
  );
}




function CreateOrganizationPage({ reload, createLocal, onboarding, onCreated }) {
  const [name, setName] = useState(onboarding ? "My workspace" : "");
  const [isLocal, setIsLocal] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    collaboration().then((value) => {
      if (active) setData(value);
    // without this the first-run screen sits on "Loading accounts…" for ever and says nothing
    }, (reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, []);

  const createWithAccount = async (accountUserId) => {
    setBusy(true);
    try {
      const result = await collaboration("create_organization", { name, accountUserId });
      await reload();
      if (result?.id) {
        await onCreated(result.id, result.connectionId);
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
    } finally { setBusy(false); }
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
          "Private organization (kept on this device and cannot be shared with teammates)"
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
          h("select", { className: "bees-select", name: "userId", disabled: busy || !data },
            ...(!data ? [h("option", { key: "loading", value: "" }, "Loading accounts…")] : accounts.map((account) => h("option", { value: account.userId, key: account.userId }, `${account.name || account.email} · ${account.email}`)))
          ),
          h(Button, { type: "submit", className: "primary", disabled: busy || !name.trim() || !data }, "Create organization")
        )
      ) : null,

      h("section", { className: "bees-box", style: !data ? { opacity: 0.6, pointerEvents: "none" } : {} },
        h("h3", null, (!data || accounts.length) ? "Or sign in with another account" : "Sign in to continue"),
        h("p", { className: "bees-muted" }, "Sign in to create a Regular organization that you can share with your team."),
        h(AccountSignInButtons, { disabled: busy || !name.trim() || !data, onStart: browserAuth }))
    ) : null,
    
    error ? h("div", { className: "bees-error", role: "alert", style: { marginTop: "16px" } }, error) : null
  );
}
