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
import { LAST_VIEW_KEY, RESTORABLE_VIEWS, type BoardItemTab, type View } from "./views.js";

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

  // The kanban card expanded inline under the board, its active tab, and — inside the Files
  // tab — the file being previewed or edited. Empty `boardItemId` means no card is expanded.
  let boardItemId = "";

  /** Top-level task the board is scoped to — one run of the workflow. Empty shows every run. */
  let boardRootItemId = "";

  let boardTab: BoardItemTab = "details";

  let boardFileRef = "";

  let boardFileEditing = false;

  /** The Details tab flipped into its inline edit form. */
  let boardItemEditing = false;

  // The process whose editor or run history is open, and the agent whose panel shows on the
  // editor. Every agent of the process is in the DOM, so switching panels is a visibility
  // toggle: unsaved edits survive it. Empty `configProcessId` on the editor means a new process.
  let configProcessId = "";

  let configAgentId = "";

  /** The work item whose pass through the process is open on the run history page. */
  let openRunItemId = "";

  /** The step picked out of that run's sequence, whose details show under it. */
  let openRunStepId = "";

  let view: View = "overview";

  /** Last value written to LAST_VIEW_KEY, so the common render() does not re-write the same row. */
  let savedView = "";

  // The New task page: the workflow it runs on, the status column it lands in (empty when the
  // page was opened from the team's + and the workflow is still being chosen), and the folders
  // its file picker browses.
  let newItemProcessId = "";

  let newItemStageId = "";

  let newItemSources: FileSource[] = [];

  /** The team-record search on the Runs view. Empty shows the recent runs it shows anyway. */
  let searchQuery = "";

  let searchHits: SearchHit[] = [];

  /** Workflow ids hidden from the Inbox table. Empty means every workflow shows. */
  let inboxProcessFilter = new Set<string>();

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

  let lastContent = "";
  let lastRenderKey = "";

  function swap(content: string): void {
    // Re-renders arrive constantly (clicks, window focus, the 30s background sync). Replacing
    // the DOM wholesale drops every scroll position — the page clamps while empty and the
    // board's horizontal scroll resets, so the open card panel visibly jumps. Skip identical
    // content, and carry scroll positions across when it did change.
    // Scroll carry-over is only valid within the same view (and same board): restored by
    // element index, a stale offset from the previous view lands on whatever now sits at that
    // index and renders the new view half-scrolled.
    const renderKey = `${view}:${view === "board" ? host.workspaceController.activeBoard?.id ?? "" : ""}`;
    const sameView = renderKey === lastRenderKey;
    lastRenderKey = renderKey;
    if (content !== lastContent) {
      lastContent = content;
      const page = document.scrollingElement!;
      const pageTop = page.scrollTop;
      if (!sameView) {
        app.innerHTML = content;
        page.scrollTop = 0;
        app.setAttribute("aria-busy", "false");
        return;
      }
      // When the open card panel is on screen, keep it stationary across the swap:
      // late-arriving data (sync, run states) grows the content above it, which otherwise
      // shoves the panel the user is reading up or down on every render.
      const anchorBefore = app.querySelector("[data-scroll-anchor]")?.getBoundingClientRect() ?? null;
      const anchorOnScreen = anchorBefore !== null && anchorBefore.top < window.innerHeight && anchorBefore.bottom > 0;
      // Matched by tag+class ordinal rather than raw DOM index, so an element inserted or
      // removed elsewhere (an alert, a badge) does not shift every scroll onto the wrong node.
      const keyOf = (el: Element): string => `${el.tagName}|${el.className}`;
      const counts = new Map<string, number>();
      const scrolled: { key: string; nth: number; top: number; left: number }[] = [];
      for (const el of app.querySelectorAll<HTMLElement>("*")) {
        const key = keyOf(el);
        const nth = counts.get(key) ?? 0;
        counts.set(key, nth + 1);
        if (el.scrollTop || el.scrollLeft)
          scrolled.push({ key, nth, top: el.scrollTop, left: el.scrollLeft });
      }
      app.innerHTML = content;
      if (scrolled.length) {
        const seen = new Map<string, number>();
        for (const el of app.querySelectorAll<HTMLElement>("*")) {
          const key = keyOf(el);
          const nth = seen.get(key) ?? 0;
          seen.set(key, nth + 1);
          const match = scrolled.find((entry) => entry.key === key && entry.nth === nth);
          if (match) {
            el.scrollTop = match.top;
            el.scrollLeft = match.left;
          }
        }
      }
      page.scrollTop = pageTop;
      const anchorAfter = anchorOnScreen ? app.querySelector("[data-scroll-anchor]")?.getBoundingClientRect() : null;
      if (anchorBefore && anchorAfter)
        page.scrollTop = pageTop + (anchorAfter.top - anchorBefore.top);
    }
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
      setHeader("Inbox", host.session.currentTeam()?.name);
      swap(inboxView(
        escalationGroups(host.runs.supervise(), host.workspaceController.teamItems),
        host.runs.executions,
        host.workspaceController.processes,
        host.session.currentOrganization()?.name ?? "—",
        host.session.currentTeam()?.name ?? "—",
        inboxProcessFilter
      ));
    }
    if (view === "board")
      void host.views.renderBoard();
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
      // The same ground as the page below, except pointed at the real controls. Offered here
      // rather than launched automatically: a tooltip that opens itself over an app nobody has
      // looked at yet is something to dismiss, not something to follow.
      swap(`<div class="mx-auto max-w-3xl space-y-4">
        <div class="flex flex-wrap items-center gap-3 rounded-box border border-primary/30 bg-primary/5 px-5 py-4">
          <div class="min-w-0 flex-1">
            <strong class="block text-sm">Prefer to be shown?</strong>
            <span class="text-sm text-base-content/60">The guided tour walks the same setup inside the app, one control at a time.</span>
          </div>
          <button class="btn btn-primary btn-sm" data-action="start-tour">Start the guided tour</button>
        </div>
        <article class="markdown-viewer rounded-box border border-base-300 bg-base-100 px-6 py-5">${renderMarkdown(GETTING_STARTED)}</article>
      </div>`);
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
    get boardItemId() { return boardItemId; },
    set boardItemId(value: typeof boardItemId) { boardItemId = value; },
    get boardRootItemId() { return boardRootItemId; },
    set boardRootItemId(value: typeof boardRootItemId) { boardRootItemId = value; },
    get boardTab() { return boardTab; },
    set boardTab(value: typeof boardTab) { boardTab = value; },
    get boardFileRef() { return boardFileRef; },
    set boardFileRef(value: typeof boardFileRef) { boardFileRef = value; },
    get boardFileEditing() { return boardFileEditing; },
    set boardFileEditing(value: typeof boardFileEditing) { boardFileEditing = value; },
    get boardItemEditing() { return boardItemEditing; },
    set boardItemEditing(value: typeof boardItemEditing) { boardItemEditing = value; },
    get configProcessId() { return configProcessId; },
    set configProcessId(value: typeof configProcessId) { configProcessId = value; },
    get configAgentId() { return configAgentId; },
    set configAgentId(value: typeof configAgentId) { configAgentId = value; },
    get openRunItemId() { return openRunItemId; },
    set openRunItemId(value: typeof openRunItemId) { openRunItemId = value; },
    get openRunStepId() { return openRunStepId; },
    set openRunStepId(value: typeof openRunStepId) { openRunStepId = value; },
    get view() { return view; },
    set view(value: typeof view) { view = value; },
    get newItemProcessId() { return newItemProcessId; },
    set newItemProcessId(value: typeof newItemProcessId) { newItemProcessId = value; },
    get newItemStageId() { return newItemStageId; },
    set newItemStageId(value: typeof newItemStageId) { newItemStageId = value; },
    get newItemSources() { return newItemSources; },
    set newItemSources(value: typeof newItemSources) { newItemSources = value; },
    get searchQuery() { return searchQuery; },
    set searchQuery(value: typeof searchQuery) { searchQuery = value; },
    get searchHits() { return searchHits; },
    set searchHits(value: typeof searchHits) { searchHits = value; },
    get inboxProcessFilter() { return inboxProcessFilter; },
    set inboxProcessFilter(value: typeof inboxProcessFilter) { inboxProcessFilter = value; },
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
