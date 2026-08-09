import {
  isPermissionGranted,
  requestPermission,
  sendNotification
} from "@tauri-apps/plugin-notification";
import type { FileSource } from "./app-views.js";
import {
  sameChoice
} from "./assistant.js";
import {
  errorText
} from "./domain.js";
import { GETTING_STARTED } from "./help.js";
import {
  inboxView,
  overviewView,
  runsView,
  schedulesView,
  searchResultsView
} from "./launch-views.js";
import type { MainHost, OrgTab, PrefsTab, TeamTab, ThemePreset } from "./main.js";
import { renderMarkdown } from "./markdown.js";
import { type SearchHit } from "./repository.js";
import { escalationGroups } from "./supervision.js";
import { LAST_VIEW_KEY, RESTORABLE_VIEWS, type View } from "./views.js";

export function createAppShell(host: MainHost) {
  // daisyUI themes that ship a dark color-scheme (drive the native colorScheme + toggle icon).
  const DARK_THEMES = new Set<string>([
    "dark", "synthwave", "halloween", "forest", "aqua", "black", "luxury",
    "dracula", "business", "night", "coffee", "dim", "sunset", "abyss"
  ]);

  const LIGHT_DEFAULT: ThemePreset = "emerald";

  const DARK_DEFAULT: ThemePreset = "forest";

  const LIGHT_DEFAULT_KEY = "ui_light_theme_preset";

  const DARK_DEFAULT_KEY = "ui_dark_theme_preset";

  const themePresets: {
    id: ThemePreset;
    name: string;
  }[] = host.THEMES.map((id) => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1)
  }));

  let activeExecutionId = "";

  let activeItemId = "";

  // The process whose editor or run history is open, and the agent whose panel shows on the
  // editor. Every agent of the process is in the DOM, so switching panels is a visibility
  // toggle: unsaved edits survive it. Empty `configProcessId` on the editor means a new process.
  let configProcessId = "";

  let configAgentId = "";

  /** The work item whose pass through the process is open on the run history page. */
  let openRunItemId = "";

  let view: View = "overview";

  /** Last value written to LAST_VIEW_KEY, so the common render() does not re-write the same row. */
  let savedView = "";

  // The New work item page: the status column it lands in, and the folders its file picker browses.
  let newItemStageId = "";

  let newItemSources: FileSource[] = [];

  /** The team-record search on the Runs view. Empty shows the recent runs it shows anyway. */
  let searchQuery = "";

  let searchHits: SearchHit[] = [];

  let prefsTab: PrefsTab = "theme";

  let orgTab: OrgTab = "general";

  let teamTab: TeamTab = "members";

  let lightDefaultTheme: ThemePreset = LIGHT_DEFAULT;

  let darkDefaultTheme: ThemePreset = DARK_DEFAULT;

  let themePreset: ThemePreset = (host.THEMES as readonly string[]).includes(localStorage.getItem("bees-theme-preset") ?? "")
    ? (localStorage.getItem("bees-theme-preset") as ThemePreset)
    : "emerald";

  const app = document.querySelector<HTMLElement>("#app")!;

  const title = document.querySelector<HTMLElement>("#view-title")!;

  const context = document.querySelector<HTMLElement>("#view-context")!;

  const notice = document.querySelector<HTMLElement>("#notice")!;

  const newItem = document.querySelector<HTMLButtonElement>("#new-item")!;

  const themeToggle = document.querySelector<HTMLButtonElement>("#theme-toggle")!;

  const assistantPanel = document.querySelector<HTMLElement>("#assistant")!;

  const assistantToggle = document.querySelector<HTMLButtonElement>("#assistant-toggle")!;

  const assistantLog = document.querySelector<HTMLElement>("#assistant-log")!;

  const assistantForm = document.querySelector<HTMLFormElement>("#assistant-form")!;

  const assistantInput = document.querySelector<HTMLTextAreaElement>("#assistant-input")!;

  const assistantSend = document.querySelector<HTMLButtonElement>("#assistant-send")!;

  const assistantModelSlot = document.querySelector<HTMLElement>("#assistant-model")!;

  const orgRow = document.querySelector<HTMLElement>("#org-row")!;

  const orgStatus = document.querySelector<HTMLElement>("#org-status")!;

  const teamNav = document.querySelector<HTMLElement>("#team-nav")!;

  const sidebarHelp = document.querySelector<HTMLElement>("#sidebar-help")!;

  const dialog = document.querySelector<HTMLDialogElement>("#editor")!;

  const dialogTitle = document.querySelector<HTMLElement>("#editor-title")!;

  const dialogFields = document.querySelector<HTMLElement>("#editor-fields")!;

  const dialogForm = document.querySelector<HTMLFormElement>("#editor-form")!;

  const dialogFooter = document.querySelector<HTMLElement>("#editor-footer")!;

  const markdownDialog = document.querySelector<HTMLDialogElement>("#markdown-viewer")!;

  const markdownTitle = document.querySelector<HTMLElement>("#markdown-viewer-title")!;

  const markdownBody = document.querySelector<HTMLElement>("#markdown-viewer-body")!;

  const appDrawer = document.querySelector<HTMLInputElement>("#app-drawer")!;

  const appDrawerOpen = document.querySelector<HTMLButtonElement>("#app-drawer-open")!;

  const appNavigation = document.querySelector<HTMLElement>("#app-navigation")!;

  function escapeHtml(value: unknown): string {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatBytes(bytes: number): string {
    if (bytes >= 1024 ** 3)
      return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    return `${Math.round(bytes / 1024 ** 2)} MB`;
  }

  function isThemePreset(value: unknown): value is ThemePreset {
    return (host.THEMES as readonly string[]).includes(String(value));
  }

  function applyTheme(): void {
    const dark = DARK_THEMES.has(themePreset);
    document.documentElement.dataset.theme = themePreset;
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    localStorage.setItem("bees-theme-preset", themePreset);
    themeToggle.innerHTML = dark
      ? '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>'
      : '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.4 15.5A8.5 8.5 0 0 1 8.5 3.6 8.5 8.5 0 1 0 20.4 15.5Z"></path></svg>';
    const label = `Switch to ${dark ? "light" : "dark"} mode`;
    themeToggle.setAttribute("aria-label", label);
    themeToggle.title = label;
  }

  async function saveTheme(preset: ThemePreset): Promise<void> {
    themePreset = preset;
    applyTheme();
    await host.repository.setSetting("ui_theme_preset", preset);
  }

  async function saveDefaultTheme(mode: "light" | "dark", preset: ThemePreset): Promise<void> {
    if (mode === "light")
      lightDefaultTheme = preset;
    else
      darkDefaultTheme = preset;
    await host.repository.setSetting(mode === "light" ? LIGHT_DEFAULT_KEY : DARK_DEFAULT_KEY, preset);
  }

  async function loadTheme(): Promise<void> {
    const [storedPreset, storedLightDefault, storedDarkDefault] = await Promise.all([
      host.repository.getSetting("ui_theme_preset", themePreset),
      host.repository.getSetting(LIGHT_DEFAULT_KEY, LIGHT_DEFAULT),
      host.repository.getSetting(DARK_DEFAULT_KEY, DARK_DEFAULT)
    ]);
    if (isThemePreset(storedPreset))
      themePreset = storedPreset;
    if (isThemePreset(storedLightDefault))
      lightDefaultTheme = storedLightDefault;
    if (isThemePreset(storedDarkDefault))
      darkDefaultTheme = storedDarkDefault;
    applyTheme();
  }

  applyTheme();

  function swap(content: string): void {
    app.innerHTML = content;
    app.setAttribute("aria-busy", "false");
  }

  function showNotice(message: string, kind: "info" | "success" | "error" = "info", undo?: () => Promise<void>): void {
    const color = kind === "error" ? "alert-error" : kind === "success" ? "alert-success" : "alert-info";
    notice.innerHTML = `<div class="alert ${color} shadow-sm"><span>${escapeHtml(message)}</span>${undo ? '<button class="btn btn-ghost btn-sm">Undo</button>' : ""}</div>`;
    const shown = notice.firstElementChild;
    shown?.querySelector("button")?.addEventListener("click", () => {
      void undo?.().then(() => showNotice("Rule removed", "success")).catch((error) => showNotice(errorText(error), "error"));
    }, { once: true });
    window.setTimeout(() => {
      if (notice.firstElementChild === shown)
        notice.innerHTML = "";
    }, 5000);
  }

  function setHeader(name: string, detail?: string): void {
    title.textContent = name;
    context.textContent = detail ?? [host.session.currentOrganization()?.name, host.session.currentTeam()?.name].filter(Boolean).join(" / ");
    newItem.hidden = view !== "board" || !host.workspaceController.activeProcess;
  }

  function activeClass(selected: boolean): string {
    return selected ? "active font-semibold" : "";
  }

  /**
   * Remember where the user is so the next launch opens there. Recorded on render rather than at
   * every `view =` assignment, because render is the one thing all of them go through. Views that
   * cannot be restored are skipped, so opening a work item does not lose the board behind it.
   */
  function rememberView(): void {
    if (view === savedView || !RESTORABLE_VIEWS.has(view))
      return;
    savedView = view;
    void host.repository.setSetting(LAST_VIEW_KEY, view).catch(() => undefined);
  }

  function render(): void {
    rememberView();
    host.views.renderNavigation();
    if (view === "overview") {
      setHeader("Overview", host.session.currentOrganization()?.name);
      const models = host.assistant.overviewAssistantModels();
      swap(overviewView(host.workspaceController.teamItems, host.runs.executions, host.runs.executionOutputs.filter(({ status }) => status === "pending"), host.runs.dismissedRunIds, {
        projects: host.workspaceController.organizations,
        teams: host.workspaceController.teams,
        models: models.map(({ group, label }) => ({ group, label })),
        projectId: host.workspaceController.workspace.organizationId,
        teamId: host.workspaceController.workspace.teamId,
        modelIndex: Math.max(0, models.findIndex(({ choice }) => sameChoice(choice, host.assistant.assistantModel)))
      }));
    }
    if (view === "inbox") {
      setHeader("Inbox", "Work, approvals, and runs that need you");
      swap(inboxView(escalationGroups(host.runs.supervise(), host.workspaceController.teamItems), host.runs.executions));
    }
    if (view === "board")
      host.views.renderBoard();
    if (view === "process")
      host.views.renderProcessEditor();
    if (view === "process-runs")
      host.views.renderProcessRuns();
    if (view === "process-library")
      host.views.renderProcessLibrary();
    if (view === "item")
      void host.views.renderWorkItemDetail();
    if (view === "item-new")
      host.views.renderNewItem();
    if (view === "runs") {
      setHeader("Runs", host.session.currentTeam()?.name);
      swap(`${host.views.searchBox()}${searchQuery.trim() ? searchResultsView(searchHits) : runsView(host.workspaceController.teamItems, host.runs.executions)}`);
    }
    if (view === "run")
      void host.views.renderRunDetail();
    if (view === "schedules") {
      const process = host.workspaceController.processes.find(({ id }) => id === configProcessId);
      setHeader("Schedules", process?.name ?? host.session.currentTeam()?.name);
      const items = host.scheduleItems();
      const ids = new Set(items.map(({ id }) => id));
      swap(schedulesView(items, host.runs.schedules.filter(({ workItemId }) => ids.has(workItemId)), host.runs.executions));
    }
    if (view === "settings")
      void host.views.renderTeamSettings();
    if (view === "org-settings")
      void host.views.renderOrgSettings();
    if (view === "preferences")
      void host.views.renderPreferences();
    if (view === "getting-started") {
      setHeader("Getting Started", "Set up Bees on this computer");
      swap(`<article class="markdown-viewer mx-auto max-w-3xl rounded-box border border-base-300 bg-base-100 px-6 py-5">${renderMarkdown(GETTING_STARTED)}</article>`);
    }
  }

  /** The `<id>:<field>` entries of one agent, renamed back to what `applyAgentEdit` reads. */
  function scopedFormData(form: HTMLFormElement, agentId: string): FormData {
    const scoped = new FormData();
    const prefix = `${agentId}:`;
    for (const [key, value] of new FormData(form)) {
      if (key.startsWith(prefix))
        scoped.append(key.slice(prefix.length), value);
    }
    return scoped;
  }

  function notifyLocal(titleText: string, body: string): void {
    void (async () => {
      const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
      if (granted)
        sendNotification({ title: titleText, body });
    })().catch(() => undefined);
  }

  return {
    DARK_THEMES,
    themePresets,
    get activeExecutionId() { return activeExecutionId; },
    set activeExecutionId(value: typeof activeExecutionId) { activeExecutionId = value; },
    get activeItemId() { return activeItemId; },
    set activeItemId(value: typeof activeItemId) { activeItemId = value; },
    get configProcessId() { return configProcessId; },
    set configProcessId(value: typeof configProcessId) { configProcessId = value; },
    get configAgentId() { return configAgentId; },
    set configAgentId(value: typeof configAgentId) { configAgentId = value; },
    get openRunItemId() { return openRunItemId; },
    set openRunItemId(value: typeof openRunItemId) { openRunItemId = value; },
    get view() { return view; },
    set view(value: typeof view) { view = value; },
    get newItemStageId() { return newItemStageId; },
    set newItemStageId(value: typeof newItemStageId) { newItemStageId = value; },
    get newItemSources() { return newItemSources; },
    set newItemSources(value: typeof newItemSources) { newItemSources = value; },
    get searchQuery() { return searchQuery; },
    set searchQuery(value: typeof searchQuery) { searchQuery = value; },
    get searchHits() { return searchHits; },
    set searchHits(value: typeof searchHits) { searchHits = value; },
    get prefsTab() { return prefsTab; },
    set prefsTab(value: typeof prefsTab) { prefsTab = value; },
    get orgTab() { return orgTab; },
    set orgTab(value: typeof orgTab) { orgTab = value; },
    get teamTab() { return teamTab; },
    set teamTab(value: typeof teamTab) { teamTab = value; },
    get lightDefaultTheme() { return lightDefaultTheme; },
    set lightDefaultTheme(value: typeof lightDefaultTheme) { lightDefaultTheme = value; },
    get darkDefaultTheme() { return darkDefaultTheme; },
    set darkDefaultTheme(value: typeof darkDefaultTheme) { darkDefaultTheme = value; },
    get themePreset() { return themePreset; },
    set themePreset(value: typeof themePreset) { themePreset = value; },
    app,
    newItem,
    assistantPanel,
    assistantToggle,
    assistantLog,
    assistantForm,
    assistantInput,
    assistantSend,
    assistantModelSlot,
    orgRow,
    orgStatus,
    teamNav,
    sidebarHelp,
    dialog,
    dialogTitle,
    dialogFields,
    dialogForm,
    dialogFooter,
    markdownDialog,
    markdownTitle,
    markdownBody,
    appDrawer,
    appDrawerOpen,
    appNavigation,
    escapeHtml,
    formatBytes,
    isThemePreset,
    saveTheme,
    saveDefaultTheme,
    loadTheme,
    swap,
    showNotice,
    setHeader,
    activeClass,
    render,
    scopedFormData,
    notifyLocal
  };
}
