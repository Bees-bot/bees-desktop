import {
  AI_PROVIDER_LABEL,
  listAiConnections,
  type AiProvider
} from "./ai-connections.js";
import {
  ApiError
} from "./api.js";
import {
  applicable,
  effectiveAgentEligibility,
  modelLabel,
  sameChoice,
  type ResolvedAction
} from "./assistant.js";
import {
  CLI_TOOLS,
  detectCliTools,
  type CliToolPath
} from "./cli-tools.js";
import {
  listMcpConnections
} from "./connections.js";
import {
  conversationToSnapshotV1,
  type BeesConversationSnapshotV1
} from "./conversation-snapshot.js";
import {
  UNUSED_AFTER_DAYS,
  skillSlugOf
} from "./curator.js";
import type {
  Agent,
  Board,
  Execution,
  FileLocation,
  Process,
  WorkItem
} from "./domain.js";
import {
  activeExecutionForItem,
  errorText,
  fileTree,
  isFiltered,
  logicalFileReference,
  parseLogicalFileReference,
  processRuns,
  type FileTreeNode,
  type ProcessRun
} from "./domain.js";
import { COMMUNITY_URL, HELP_PAGES } from "./help.js";
import {
  isKnowledgeConnection,
  type KnowledgePolicy
} from "./knowledge.js";
import {
  duration,
  runView,
  statusBadge,
  when,
  workItemView
} from "./launch-views.js";
import {
  modelRef,
  parseModelRef,
  thinkingOptionsForModel,
  type LocalModelView
} from "./local-models.js";
import type { MainViewHost, OrgTab, PrefsTab, TeamTab, ThemePreset } from "./main.js";
import {
  PROCESS_LIBRARY,
  processModule,
  type ProcessLibraryEntry
} from "./processes/registry.js";
import {
  registryCapabilities,
  selectedAgentCapabilities
} from "./registries.js";
import { BROWSER_TOOL_REF, BROWSER_WRITE_GRANT } from "./run-config.js";
import type { WorkState } from "./supervision.js";
import { needsAttention } from "./supervision.js";

export interface Tab<Id extends string> {
  id: Id;
  label: string;
  content: () => string | Promise<string>;
}

export interface EditorOption {
  label: string;
  value: string;
  description?: string;
}

export interface EditorField {
  name: string;
  label: string;
  value?: string;
  type?: "text" | "password" | "textarea" | "select" | "toggle" | "checkboxes" | "color" | "file" | "note";
  placeholder?: string;
  options?: EditorOption[];
  checked?: string[];
  /** Optional directly selectable section. Most dialogs remain a single short form. */
  step?: "basics" | "instructions" | "capabilities";
  /** Small line under the control. */
  hint?: string;
}

export interface FileSource {
  id: string;
  name: string;
  files: string[];
}

export function createMainViews(host: MainViewHost) {
  /** A settings page: left sub-menu + right content. `attr` is the data-* used to switch tabs. */
  function pageWithMenu(attr: string, items: {
    id: string;
    label: string;
  }[], active: string, content: string): string {
    return `<div class="grid gap-5 lg:grid-cols-[190px_1fr]">
      <aside class="h-max rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
        <ul class="menu menu-sm gap-0.5">${items
        .map(({ id, label }) => `<li><button class="${host.activeClass(id === active)}" data-${attr}="${id}">${host.escapeHtml(label)}</button></li>`)
        .join("")}</ul>
      </aside>
      <section class="min-w-0">${content}</section>
    </div>`;
  }

  /**
   * One list per settings page: the menu entry and the thing it renders stay together, so a tab
   * cannot be listed without a body or gain one it never shows. `stillHere` is re-checked after
   * the await — the user can navigate away while a tab's content is still loading.
   */
  async function renderTabs<Id extends string>(attr: string, tabs: [
    Tab<Id>,
    ...Tab<Id>[]
  ], active: Id, stillHere: () => boolean): Promise<void> {
    const content = await (tabs.find(({ id }) => id === active) ?? tabs[0]).content();
    if (!stillHere())
      return;
    host.swap(pageWithMenu(attr, tabs, active, content));
  }

  function gearIcon(cls = "size-5"): string {
    return `<svg viewBox="0 0 24 24" class="${cls}" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M8.94 4.61 10.06 4.24 10.14 1.46h3.72l.08 2.78 1.12.37 1.06.53 2.02-1.9 2.62 2.62-1.9 2.02.53 1.06.37 1.12 2.78.08v3.72l-2.78.08-.37 1.12-.53 1.06 1.9 2.02-2.62 2.62-2.02-1.9-1.06.53-1.12.37-.08 2.78h-3.72l-.08-2.78-1.12-.37-1.06-.53-2.02 1.9-2.62-2.62 1.9-2.02-.53-1.06-.37-1.12-2.78-.08v-3.72l2.78-.08.37-1.12.53-1.06-1.9-2.02 2.62-2.62 2.02 1.9ZM12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z" clip-rule="evenodd"></path></svg>`;
  }

  /** "Active org: <name> — <who>" line under the org row. Text opens preferences; gear opens org settings. */
  function renderActiveOrg(): void {
    const org = host.currentOrganization();
    if (!org) {
      host.orgStatus.innerHTML = "";
      return;
    }
    const who = host.orgIsConnected(org.id) ? (host.currentUser()?.email ?? "connected") : "local";
    host.orgStatus.innerHTML = `<div class="flex items-center gap-1 rounded-lg border border-base-300 bg-base-100 px-2 py-1.5 shadow-sm">
        <button class="min-w-0 flex-1 text-left" data-view="preferences">
          <span class="block text-[10px] font-bold uppercase tracking-widest text-base-content/45">Active org</span>
          <span class="block truncate text-xs font-semibold">${host.escapeHtml(org.name)} — ${host.escapeHtml(who)}</span>
        </button>
        <button class="btn btn-square btn-ghost btn-xs" data-view="org-settings" aria-label="Organization settings" title="Organization settings">
          ${gearIcon()}
        </button>
      </div>`;
  }

  /**
   * One process in the left menu — a single row. The name opens its board and always shows the open
   * task count plus run state (the avatar goes green while running). The four actions ride an overlay
   * on the right that appears on hover or keyboard focus, so a team of ten processes stays readable.
   */
  function processNavItem(teamId: string, board: Board, process: Process, count: number): string {
    const openBoard = host.view === "board" && host.activeBoard?.id === board.id;
    const editing = host.view === "process" && host.configProcessId === process.id;
    const history = host.view === "process-runs" && host.configProcessId === process.id;
    const scheduled = host.view === "schedules" && host.configProcessId === process.id;
    const running = host.runningProcesses.has(process.id);
    const studio = processModule(process.tags)?.mode === "studio";
    const icon = (action: string, label: string, svg: string, extra = ""): string => `<button class="btn btn-square btn-ghost btn-xs ${extra}" data-action="${action}" data-id="${process.id}" data-team="${teamId}" title="${host.escapeHtml(label)}" aria-label="${host.escapeHtml(label)}">${svg}</button>`;
    const open = editing || history || scheduled; // a right-hand view of this process is on screen
    return `<li class="group relative">
      <button class="${host.activeClass(openBoard)} gap-2 pr-[6.5rem]" data-board="${board.id}" data-team="${teamId}">
        <span class="grid size-5 shrink-0 place-items-center rounded text-[10px] font-bold ${running ? "bg-success/20 text-success" : "bg-secondary/15 text-secondary"}" title="${running ? "Running" : "Stopped"}">P</span>
        <span class="truncate">${host.escapeHtml(process.name)}</span>
        ${count
        ? `<span class="badge badge-ghost badge-xs ml-auto" title="${count} open task${count === 1 ? "" : "s"}">${count}</span>`
        : ""}
      </button>
      <div class="absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 ${open ? "opacity-100" : ""}">
        ${studio
        ? ""
        : icon(running ? "stop-process" : "start-process", running ? "Running. Click to stop." : "Stopped. Click to run.", running ? ACTION_ICONS.active : ACTION_ICONS.inactive, running ? "text-success" : "text-warning")}
        ${icon("open-process-runs", `Past runs of ${process.name}`, ACTION_ICONS.history, history ? "btn-active" : "")}
        ${icon("open-process-schedules", `Schedules of ${process.name}`, ACTION_ICONS.schedule, scheduled ? "btn-active" : "")}
        ${icon("edit-process", `Edit ${process.name}`, ACTION_ICONS.edit, editing ? "btn-active" : "")}
      </div>
    </li>`;
  }

  /**
   * The three items pinned under the team list. Getting Started renders in-app so a fresh install
   * has it without a browser; the rest of the pages, and the community, open externally.
   */
  function renderSidebarHelp(): void {
    // A popup rather than an accordion: this block is pinned to the bottom, so expanding in place
    // would push the three items around. dropdown-top keeps the panel inside the sidebar, which
    // .drawer-side clips.
    host.sidebarHelp.innerHTML = `<ul class="menu menu-sm w-full gap-0.5 px-0">
        <li><button class="${host.activeClass(host.view === "getting-started")}" data-view="getting-started">Getting Started</button></li>
        <li class="dropdown dropdown-top w-full">
          <button tabindex="0" class="w-full justify-between" aria-haspopup="menu">
            Help
            <svg viewBox="0 0 24 24" class="size-4 opacity-60" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
          </button>
          <ul tabindex="0" class="dropdown-content menu menu-sm z-50 mb-1 w-64 gap-0.5 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
            ${HELP_PAGES.map(({ label, url }) => `<li><button data-action="open-external" data-url="${host.escapeHtml(url)}">${host.escapeHtml(label)}</button></li>`).join("")}
          </ul>
        </li>
        <li><button data-action="open-external" data-url="${host.escapeHtml(COMMUNITY_URL)}">Join Community</button></li>
      </ul>`;
  }

  function renderNavigation(): void {
    renderSidebarHelp();
    // One icon per connection (org × account), so the same org shows twice if two accounts are in
    // it. Local orgs get one icon with no account. Hover shows the org name and account email.
    type Icon = {
      orgId: string;
      userId: string;
      name: string;
      email: string;
    };
    const icons: Icon[] = [];
    for (const key of host.connections) {
      const { orgId, userId } = host.connParts(key);
      const org = host.organizations.find(({ id }) => id === orgId);
      if (!org)
        continue;
      icons.push({ orgId, userId, name: org.name, email: host.accounts.get(userId)?.user.email ?? "" });
    }
    for (const org of host.organizations) {
      if (!host.orgIsConnected(org.id))
        icons.push({ orgId: org.id, userId: "", name: org.name, email: "local" });
    }
    icons.sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
    host.orgRow.innerHTML =
      icons
        .map(({ orgId, userId, name, email }) => {
          const active = orgId === host.workspace.organizationId && userId === host.activeUserId;
          const branding = host.brandingFor(orgId);
          const ring = active ? "ring-2 ring-primary ring-offset-1 ring-offset-base-100" : "";
          const inner = branding.logo
            ? `<img src="${host.escapeHtml(branding.logo)}" alt="" class="size-full object-cover">`
            : `<span class="grid size-full place-items-center text-[11px] font-black text-white" style="background:${host.escapeHtml(branding.color || host.defaultOrgColor(name))}">${host.escapeHtml(name.slice(0, 1).toUpperCase())}</span>`;
          const label = `${name} — ${email}`;
          return `<button class="btn btn-xs btn-square overflow-hidden p-0 ${ring}" data-action="switch-org" data-id="${orgId}" data-account="${host.escapeHtml(userId)}" title="${host.escapeHtml(label)}" aria-label="${host.escapeHtml(label)}">${inner}</button>`;
        })
        .join("") +
      `<button class="btn btn-xs btn-square btn-ghost tooltip tooltip-bottom border border-dashed border-base-300" data-action="new-organization" data-tip="Add organization" aria-label="Add organization">+</button>`;
    renderActiveOrg();
    // No active org (e.g. all deleted): teams need an org to belong to, so show nothing here.
    if (!host.workspace.organizationId) {
      host.teamNav.innerHTML = "";
      renderPrefsButton();
      return;
    }
    const inboxCount = [...host.supervise().values()].filter(needsAttention).length;
    host.teamNav.innerHTML = `<ul class="menu menu-sm mb-4 gap-0.5 px-0">
        <li><button class="${host.activeClass(host.view === "overview")}" data-view="overview">Overview</button></li>
        <li><button class="${host.activeClass(host.view === "inbox")}" data-view="inbox">Inbox${inboxCount
        ? ` <span class="badge badge-warning badge-xs ml-auto">${inboxCount}</span>`
        : ""}</button></li>
      </ul>
      <div class="mb-2 flex items-center justify-between px-2">
        <span class="text-[11px] font-bold uppercase tracking-widest text-base-content/45">Teams</span>
        <button class="btn btn-circle btn-ghost btn-xs" data-action="new-team" aria-label="Add team">+</button>
      </div>
      ${host.teams.length
        ? host.teams.map((team) => {
          const selected = team.id === host.workspace.teamId;
          const teamActions = `opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100`;
          return `<section class="group mb-3">
                  <div class="flex items-center">
                    <button class="btn btn-ghost btn-sm min-w-0 flex-1 justify-start gap-2 px-2 ${selected ? "font-bold" : ""}"
                      data-team-view="overview" data-team="${team.id}">
                      <span class="grid size-6 place-items-center rounded-md bg-primary/10 text-xs font-bold text-primary">${host.escapeHtml(team.name.slice(0, 1).toUpperCase())}</span>
                      <span class="truncate">${host.escapeHtml(team.name)}</span>
                    </button>
                    <div class="flex items-center pr-1 ${selected && host.view === "settings" ? "" : teamActions}">
                      <button class="btn btn-square btn-ghost btn-xs" data-action="browse-process-library" data-team="${team.id}" aria-label="Process library" title="Process library">${ACTION_ICONS.library}</button>
                      <button class="btn btn-square btn-ghost btn-xs" data-action="new-process" data-team="${team.id}" aria-label="New process" title="New process">${ACTION_ICONS.add}</button>
                      <button class="btn btn-square btn-ghost btn-xs ${selected && host.view === "settings" ? "btn-active" : ""}" data-team-view="settings" data-team="${team.id}" aria-label="Team settings" title="Team settings">
                        ${gearIcon()}
                      </button>
                    </div>
                  </div>
                  <ul class="menu menu-sm ml-3.5 gap-0.5 border-l border-base-300 py-0 pl-1 pr-0">
                    ${(host.dashboardsByTeam.get(team.id) ?? [])
              .map(({ board, process, count }) => processNavItem(team.id, board, process, count))
              .join("")}
                    ${(host.dashboardsByTeam.get(team.id) ?? []).length
              ? ""
              : `<li><p class="px-2 py-1 text-xs text-base-content/45">No processes yet — use + above.</p></li>`}
                  </ul>
                </section>`;
        })
          .join("")
        : `<div class="mx-2 rounded-box border border-dashed border-base-300 p-4 text-center text-xs text-base-content/50">
              Add a team to this organization.
            </div>`}`;
    renderPrefsButton();
  }

  /**
   * The Preferences button in the sidebar header, badged with the number of org invitations waiting
   * for any pooled account — otherwise an invite is only visible to someone who happens to open the
   * Orgs tab or click the emailed link.
   */
  function renderPrefsButton(): void {
    const prefs = document.querySelector<HTMLButtonElement>("#preferences-button");
    if (!prefs)
      return;
    prefs.classList.toggle("btn-active", host.view === "preferences");
    prefs.querySelector(".invite-badge")?.remove();
    if (!host.pendingInvitations.length)
      return;
    prefs.title = `Preferences — ${host.pendingInvitations.length} pending invitation${host.pendingInvitations.length === 1 ? "" : "s"}`;
    prefs.insertAdjacentHTML("beforeend", `<span class="invite-badge badge badge-warning badge-xs absolute -right-1 -top-1">${host.pendingInvitations.length}</span>`);
  }

  /**
   * Search runs on submit rather than on every keystroke: the results replace the view, and a
   * box that re-rendered itself under the cursor would lose focus on every letter.
   */
  function searchBox(): string {
    return `<form class="mb-4 flex gap-2" data-run-search>
      <input class="input input-bordered flex-1" name="query" type="search" autocomplete="off"
        placeholder="Search work items and settled runs" value="${host.escapeHtml(host.searchQuery)}" />
      <button class="btn btn-primary" type="submit">Search</button>
      ${host.searchQuery.trim() ? `<button class="btn btn-ghost border border-base-300" type="button" data-action="clear-search">Clear</button>` : ""}
    </form>`;
  }

  async function renderWorkItemDetail(): Promise<void> {
    const item = host.teamItems.find(({ id }) => id === host.activeItemId);
    if (!item) {
      host.view = "board";
      renderBoard();
      return;
    }
    host.setHeader(item.title, host.currentTeam()?.name);
    const runs = host.executions.filter(({ workItemId }) => workItemId === item.id);
    const process = host.processes.find(({ id }) => id === item.processId);
    const studio = process ? host.processStudios.find((candidate) => candidate.matches(process)) : null;
    // The same sentence the inbox shows, above whatever this item's view is — a person working on
    // the item should not have to visit the inbox to learn it is stuck.
    const banner = escalationBanner(host.supervise().get(item.id) ?? null);
    if (process && studio) {
      const content = await studio.render(item, process, runs);
      if (host.view !== "item" || host.activeItemId !== item.id)
        return;
      host.swap(`${banner}${content}`);
      return;
    }
    const locations = await host.repository.listAvailableFileLocations(host.workspace.teamId);
    if (host.view !== "item" || host.activeItemId !== item.id)
      return;
    host.swap(banner + workItemView({ ...item, logicalFiles: displayFileReferences(item.logicalFiles, locations) }, runs, runs.map(conversationFor).filter(Boolean) as BeesConversationSnapshotV1[], host.itemTab));
  }

  /**
   * Live runs are canonical in the runtime; a settled run reads the snapshot stored on its
   * receipt, which is why reopening one never needs the sidecar.
   */
  function conversationFor(execution: Execution): BeesConversationSnapshotV1 | null {
    const live = host.liveEvents.get(execution.id);
    return live?.length ? conversationToSnapshotV1(live) : execution.conversationSnapshot;
  }

  async function renderRunDetail(): Promise<void> {
    const execution = host.executions.find(({ id }) => id === host.activeExecutionId) ??
      (host.activeExecutionId ? await host.repository.getExecution(host.activeExecutionId) : null);
    if (!execution) {
      host.view = "runs";
      host.render();
      return;
    }
    host.setHeader("Run", host.teamItems.find(({ id }) => id === execution.workItemId)?.title);
    host.swap(runView({
      execution,
      item: host.teamItems.find(({ id }) => id === execution.workItemId) ?? null,
      outputs: host.executionOutputs.filter(({ executionId }) => executionId === execution.id),
      snapshot: conversationFor(execution),
      previews: host.outputPreviews,
      remoteConnections: (execution.config.mcpConnectionRefs ?? []).map((id) => {
        const connection = host.mcpConnections.find((candidate) => candidate.id === id);
        return connection ? `${connection.name}${connection.lastError ? " (offline)" : ""}` : "Unavailable connection";
      })
    }));
  }

  function workItemBadges(item: WorkItem): string {
    const execution = activeExecutionForItem(item.id, host.executions);
    const agent = execution
      ? host.agents.find(({ id }) => id === execution.agentId)
      : host.agentForItem(item);
    const run = execution?.status === "running"
      ? "Running"
      : execution?.status === "queued"
        ? "Queued"
        : "Idle";
    const runTone = execution?.status === "running"
      ? "badge-success"
      : execution?.status === "queued"
        ? "badge-warning"
        : "badge-ghost";
    return `<span class="badge badge-ghost badge-sm">Owner: ${host.escapeHtml(item.owner || "Unassigned")}</span>
      <span class="badge badge-ghost badge-sm">Agent: ${host.escapeHtml(agent?.name || (execution ? "Unknown agent" : "Unassigned"))}</span>
      <span class="badge ${runTone} badge-sm">Run: ${run}</span>`;
  }

  function renderBoard(): void {
    host.setHeader(host.activeBoard?.name ?? "Work", host.activeProcess ? `${host.currentTeam()?.name} / ${host.activeProcess.name}` : undefined);
    if (!host.activeBoard || !host.activeProcess) {
      host.swap(`<div class="hero min-h-80 rounded-box border border-dashed border-base-300 bg-base-100">
        <div class="hero-content text-center"><div class="max-w-md">
          <div class="mb-3 text-4xl">▦</div>
          <h2 class="text-xl font-bold">Create your first process</h2>
          <p class="py-3 text-sm text-base-content/60">Each process gets its own dashboard, with its statuses as columns.</p>
          <button class="btn btn-primary" data-action="new-process" data-team="${host.workspace.teamId}">New process</button>
        </div></div>
      </div>`);
      return;
    }
    const stages = host.activeProcess.stages.filter(({ id }) => host.activeBoard?.stageIds.includes(id));
    const projectStudio = processModule(host.activeProcess.tags)?.mode === "studio";
    const running = projectStudio || host.runningProcesses.has(host.activeProcess.id);
    const filters = host.activeBoard.filters;
    const waiting = host.supervise();
    const visible = host.items.filter((item) => !isFiltered(item, filters));
    const filtered = host.items.filter((item) => isFiltered(item, filters))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    host.swap(`<div class="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-3 text-sm text-base-content/55">
          <span class="eyebrow-pill"><span class="status status-primary"></span> Workflow board</span>
          ${processStateBadge(host.activeProcess.id)}
          <span class="badge badge-ghost">${stages.length} status${stages.length === 1 ? "" : "es"}</span>
          <span>${host.openWork(visible).length} item${host.openWork(visible).length === 1 ? "" : "s"}</span>
        </div>
        <div class="flex flex-wrap gap-2">
          ${processRunButtons(host.activeProcess.id, "btn-sm")}
          <button class="btn btn-ghost btn-sm border border-base-300" data-action="edit-board" data-id="${host.activeBoard.id}">Dashboard settings</button>
        </div>
      </div>
      ${running
        ? ""
        : '<div class="alert alert-warning mb-5 py-2 text-sm">This process is stopped — its agents will not pick up work until you press Run.</div>'}
      <div class="kanban">${stages
        .map((stage, stageIndex) => {
          const cards = visible.filter(({ stageId }) => stageId === stage.id);
          return `<section class="kanban-column p-3">
            <header class="flex items-center justify-between px-1 pb-3 pt-1">
              <div class="flex items-center gap-2">
                <span class="status ${stageIndex === stages.length - 1 ? "status-success" : "status-primary"}"></span>
                <h2 class="text-sm font-black tracking-[-.01em]">${host.escapeHtml(stage.name)}</h2>
              </div>
              <span class="badge badge-ghost badge-sm border-0">${cards.length}</span>
            </header>
            <div class="grid gap-3">${cards
              .map((item) => `<article class="kanban-card card border border-base-300">
                  <div class="card-body gap-3 p-4">
                    <div>
                      <p class="mb-2 text-[9px] font-black uppercase tracking-[.16em] text-primary">${host.escapeHtml(stage.name)}</p>
                      <h3 class="card-title text-sm font-black tracking-[-.015em]">${host.escapeHtml(item.title)}</h3>
                      <p class="mt-1 line-clamp-3 text-xs leading-relaxed text-base-content/60">${host.escapeHtml(item.description || "No description")}</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      ${workItemBadges(item)}
                      ${item.parentId ? '<span class="badge badge-outline badge-sm">Subtask</span>' : ""}
                      ${host.teamItems.some(({ parentId }) => parentId === item.id)
                  ? `<span class="badge badge-outline badge-sm">${host.teamItems.filter(({ parentId }) => parentId === item.id).length} tasks</span>`
                  : ""}
                      ${item.status === "blocked" ? '<span class="badge badge-error badge-sm">Blocked</span>' : ""}
                      ${
                // Silence is the normal look of stuck work, so the card always says which
                // of the four states this item is in. The badge carries the heading only —
                // a badge does not wrap, and a runtime error is long.
                needsAttention(waiting.get(item.id) ?? null)
                  ? `<span class="badge badge-sm ${waiting.get(item.id)!.kind === "stalled" ? "badge-error" : "badge-warning"}">${host.escapeHtml(waiting.get(item.id)!.label)}</span>`
                  : ""}
                      ${item.logicalFiles.length ? `<span class="badge badge-outline badge-sm">${item.logicalFiles.length} file${item.logicalFiles.length === 1 ? "" : "s"}</span>` : ""}
                    </div>
                    ${needsAttention(waiting.get(item.id) ?? null)
                  ? `<p class="line-clamp-2 break-words text-xs leading-relaxed ${waiting.get(item.id)!.kind === "stalled" ? "text-error" : "text-base-content/60"}">${host.escapeHtml(waiting.get(item.id)!.detail)}</p>`
                  : ""}
                    <div class="card-actions items-center justify-end">
                      <button class="btn btn-ghost btn-xs" data-action="open-item" data-id="${item.id}">Open</button>
                      <button class="btn btn-ghost btn-xs" data-action="edit-item" data-id="${item.id}">Edit</button>
                      ${!projectStudio && stageIndex > 0
                  ? `<button class="btn btn-square btn-ghost btn-xs" aria-label="Move left" data-action="move-item" data-id="${item.id}" data-stage="${stages[stageIndex - 1]!.id}">←</button>`
                  : ""}
                      ${!projectStudio && stageIndex < stages.length - 1
                  ? `<button class="btn btn-square btn-ghost btn-xs" aria-label="Move right" data-action="move-item" data-id="${item.id}" data-stage="${stages[stageIndex + 1]!.id}">→</button>`
                  : ""}
                    </div>
                  </div>
                </article>`)
              .join("")}
              ${!projectStudio || stageIndex === 0 ? `<button class="btn btn-ghost btn-sm border border-dashed border-base-300" data-action="new-item-in-stage" data-stage="${stage.id}">+ Add item</button>` : ""}
            </div>
          </section>`;
        })
        .join("")}</div>
      ${filtered.length
        ? `<details class="collapse-arrow mt-5 rounded-box border border-base-300 bg-base-100">
              <summary class="cursor-pointer px-4 py-3 text-sm font-semibold">Filtered items (${filtered.length})</summary>
              <ul class="divide-y divide-base-300 border-t border-base-300">${filtered
          .map((item) => `<li class="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span class="min-w-0">
                      <span class="font-semibold">${host.escapeHtml(item.title)}</span>
                      <span class="ml-2 badge badge-ghost badge-sm">${host.escapeHtml(item.status)}</span>
                      <span class="ml-2 text-xs text-base-content/55">${host.escapeHtml(new Date(item.updatedAt).toLocaleString())}</span>
                    </span>
                    <button class="btn btn-ghost btn-xs" data-action="open-item" data-id="${item.id}">Open</button>
                  </li>`)
          .join("")}</ul>
            </details>`
        : ""}`);
  }

  /** Agents this process starts, in status order — the population of its configuration screen. */
  function processAgents(process: Process): Agent[] {
    const order = new Map(process.stages.map(({ id }, index) => [id, index]));
    return host.agents.filter(({ triggerStageId }) => triggerStageId && order.has(triggerStageId))
      .sort((a, b) => (order.get(a.triggerStageId!) ?? 0) - (order.get(b.triggerStageId!) ?? 0) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  /**
   * The process page: its definition at the top, its statuses as lanes holding the agents that
   * run on them, and the selected agent's whole configuration underneath. Every agent panel stays
   * in the DOM — hidden, not unmounted — so moving between agents costs a click and loses nothing.
   * With no `configProcessId` the same page creates a process, then reopens itself on it.
   */
  function renderProcessEditor(): void {
    const process = host.processes.find(({ id }) => id === host.configProcessId) ?? null;
    host.setHeader(process ? process.name : "New process", host.currentTeam()?.name);
    const definition = `<form class="min-w-0 rounded-box border border-base-300 bg-base-100 p-5 shadow-sm" data-process-form>
      <div class="flex flex-wrap items-end gap-3">
        <label class="form-control grid min-w-0 flex-1 basis-56 gap-1.5"><span class="label-text text-sm font-semibold">Name</span>
          <input class="input input-bordered w-full" name="name" value="${host.escapeHtml(process?.name ?? "")}"
            placeholder="Support triage" required></label>
        <label class="form-control grid min-w-0 flex-[2] basis-72 gap-1.5"><span class="label-text text-sm font-semibold">Description</span>
          <input class="input input-bordered w-full" name="description" value="${host.escapeHtml(process?.description ?? "")}"></label>
        <div class="ml-auto flex shrink-0 items-center gap-2">
          ${process
        ? `${processStatusButton(process.id)}${actionIconButton("archive-process", `Archive ${process.name}`, ACTION_ICONS.archive, process.id, "btn-ghost text-error")}`
        : ""}
          <button class="btn btn-primary" type="submit">${process ? "Save process" : "Create process"}</button>
        </div>
      </div>
      <label class="form-control mt-4 grid min-w-0 gap-1.5"><span class="label-text text-sm font-semibold">Ordered statuses</span>
        <input class="input input-bordered w-full" name="stages" value="${host.escapeHtml(process ? process.stages.map(({ name }) => name).join(", ") : "To do, In progress, Done")}" required>
        <span class="text-xs text-base-content/55">Comma separated, in order. A removed status needs its work items moved first.</span></label>
    </form>`;
    if (!process) {
      host.swap(`<div class="grid gap-4">${definition}
        <p class="text-sm text-base-content/55">Saving creates the process, its board, and the agent lanes below.</p>
      </div>`);
      return;
    }
    const own = processAgents(process);
    const unassigned = host.agents.filter(({ triggerStageId }) => !triggerStageId);
    const selectable = [...own, ...unassigned];
    if (!selectable.some(({ id }) => id === host.configAgentId))
      host.configAgentId = selectable[0]?.id ?? "";
    const studio = processModule(process.tags)?.mode === "studio";
    const card = (agent: Agent): string => {
      const model = agent.config.provider && agent.config.model
        ? `${agent.config.provider} · ${agent.config.model}`
        : "No model";
      const eligibility = host.eligibilityForAgent(agent);
      return `<div class="grid gap-2 rounded-box border p-3 ${agent.id === host.configAgentId ? "border-primary bg-primary/5" : "border-base-300 bg-base-100"}" data-agent-row="${host.escapeHtml(agent.id)}">
        <div class="flex items-start justify-between gap-1">
          <button class="link link-hover text-left text-sm font-semibold" type="button"
            data-action="select-process-agent" data-id="${host.escapeHtml(agent.id)}">${host.escapeHtml(agent.name || "Untitled agent")}</button>
          <span class="flex">
            ${actionIconButton("duplicate-agent", `Duplicate ${agent.name}`, ACTION_ICONS.duplicate, agent.id)}
            ${actionIconButton("delete-agent", `Delete ${agent.name}`, ACTION_ICONS.delete, agent.id, "btn-ghost text-error")}
          </span>
        </div>
        <p class="truncate text-xs text-base-content/55" title="${host.escapeHtml(model)}">${host.escapeHtml(model)}</p>
        <div class="flex items-center justify-between gap-1">
          <label class="label cursor-pointer gap-1.5 text-xs" title="Active on this machine">
            <input class="checkbox checkbox-xs" type="checkbox" name="${host.escapeHtml(agent.id)}:enabled" ${host.disabledAgentIds.has(agent.id) ? "" : "checked"}><span>On</span>
          </label>
          ${eligibility.active
          ? ""
          : `<span class="badge badge-error badge-xs" title="${host.escapeHtml(eligibility.reason)}">Needs attention</span>`}
        </div>
      </div>`;
    };
    const lane = (title: string, cards: string, addStageId?: string, note = ""): string => `<div class="flex w-64 shrink-0 flex-col gap-2 rounded-box bg-base-200/50 p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="truncate text-xs font-semibold uppercase tracking-wide text-base-content/60">${host.escapeHtml(title)}</span>
          ${addStageId === undefined
        ? ""
        : `<button class="btn btn-ghost btn-xs" type="button" data-action="add-process-agent" data-stage="${host.escapeHtml(addStageId)}">+ Agent</button>`}
        </div>
        ${cards || `<p class="px-1 py-2 text-xs text-base-content/45">${host.escapeHtml(note)}</p>`}
      </div>`;
    const lanes = [
      ...process.stages.map((stage) => lane(stage.name, own
        .filter((agent) => agent.triggerStageId === stage.id)
        .map(card)
        .join(""), stage.id, "No agent yet.")),
      ...(unassigned.length
        ? [lane("No status", unassigned.map(card).join(""), undefined, "")]
        : [])
    ].join("");
    const panels = selectable
      .map((agent) => {
        const fields = agentEditorFields(agent)
          .map((field) => field.name === "trigger"
            ? {
              ...field,
              label: "Status",
              hint: "Which status of this process starts the agent.",
              options: [
                { label: "None", value: "" },
                ...process.stages.map(({ id, name }) => ({ label: name, value: id }))
              ]
            }
            : field);
        const sections = (["basics", "instructions", "capabilities"] as const)
          .map((step) => {
            const group = fields.filter((field) => field.step === step);
            if (!group.length)
              return "";
            // Collapsed sections still submit their inputs, so `scopedFormData` reads them either way.
            return `<details class="min-w-0 rounded-box border border-base-300 p-4" ${step === "basics" ? "open" : ""}>
              <summary class="cursor-pointer text-xs font-semibold uppercase tracking-wide text-base-content/45">${step}</summary>
              <div class="mt-4 grid min-w-0 gap-4">${group
                .map((field) => editorFieldHtml({ ...field, name: `${agent.id}:${field.name}` }))
                .join("")}</div>
            </details>`;
          })
          .join("");
        return `<section class="grid min-w-0 gap-3 p-5" data-agent-pane="${host.escapeHtml(agent.id)}" ${agent.id === host.configAgentId ? "" : "hidden"}>
          <h3 class="font-bold">${host.escapeHtml(agent.name || "Untitled agent")}</h3>
          ${sections}
        </section>`;
      })
      .join("");
    host.swap(`<div class="grid min-w-0 gap-4">
      ${definition}
      <form class="min-w-0" data-process-agents>
        <section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 p-4">
            <div><h3 class="font-bold">Agents by status</h3>
              <p class="mt-1 text-sm text-base-content/55">${studio
        ? "This process picks its agent by role, so several agents may share a status."
        : "One agent per status. Pick one to configure it below, then save once."}</p></div>
            <button class="btn btn-primary btn-sm" type="submit" ${selectable.length ? "" : "disabled"}>Save agents</button>
          </header>
          <div class="flex gap-3 overflow-x-auto p-4">${lanes}</div>
          <div class="border-t border-base-300">${panels ||
      '<p class="p-12 text-center text-sm text-base-content/50">Add an agent to a status to configure it.</p>'}</div>
        </section>
      </form>
    </div>`);
    linkProcessModelThinking();
  }

  /**
   * A model picked in an agent's panel narrows that agent's thinking levels. The shared icon
   * buttons carry no `type`, which inside a form means submit — the pass below keeps Save the
   * only thing that saves.
   */
  function linkProcessModelThinking(): void {
    for (const button of host.app.querySelectorAll<HTMLButtonElement>("form button:not([type])")) {
      button.type = "button";
    }
    for (const select of host.app.querySelectorAll<HTMLSelectElement>('select[name$=":model"]')) {
      const agentId = select.name.slice(0, -":model".length);
      select.addEventListener("change", () => {
        const thinking = host.app.querySelector<HTMLSelectElement>(`select[name="${agentId}:thinkingLevel"]`);
        if (!thinking)
          return;
        thinking.innerHTML = thinkingOptionsForModel(parseModelRef(select.value) ?? {})
          .map(({ label, value }) => `<option value="${host.escapeHtml(value)}">${host.escapeHtml(label)}</option>`)
          .join("");
        thinking.value = "";
      });
    }
  }

  /** One line of "why is this not moving", or nothing when it is. */
  function escalationBanner(state: WorkState | null): string {
    if (!needsAttention(state))
      return "";
    return `<div class="alert ${state!.kind === "stalled" ? "alert-error" : "alert-warning"} mb-4">
      <div class="min-w-0">
        <div class="font-semibold">${host.escapeHtml(state!.label)}</div>
        <div class="break-words text-sm">${host.escapeHtml(state!.detail)}</div>
      </div>
    </div>`;
  }

  /** Rows of past runs on the left, the selected run's lanes, sequence, and logs on the right. */
  function renderProcessRuns(): void {
    const process = host.processes.find(({ id }) => id === host.configProcessId);
    if (!process) {
      host.view = "board";
      renderBoard();
      return;
    }
    host.setHeader(`${process.name} — past runs`, host.currentTeam()?.name);
    const runs = processRuns(host.teamItems.filter(({ processId }) => processId === process.id), host.executions);
    if (!runs.some(({ item }) => item.id === host.openRunItemId))
      host.openRunItemId = runs[0]?.item.id ?? "";
    const open = runs.find(({ item }) => item.id === host.openRunItemId) ?? null;
    const list = runs
      .map(({ item, steps, startedAt }) => {
        const last = steps.at(-1);
        return `<li><button class="${host.activeClass(item.id === host.openRunItemId)} block h-auto py-2 text-left"
          data-action="open-process-run" data-id="${host.escapeHtml(item.id)}">
          <span class="block truncate text-sm font-semibold">${host.escapeHtml(item.title)}</span>
          <span class="mt-1 flex flex-wrap items-center gap-1 text-xs text-base-content/55">
            ${when(startedAt)} · ${steps.length} step${steps.length === 1 ? "" : "s"} ${last ? statusBadge(last.status) : '<span class="badge badge-ghost badge-sm">Not started</span>'}
          </span>
        </button></li>`;
      })
      .join("");
    host.swap(`<div class="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
        <h3 class="border-b border-base-300 p-4 font-bold">Runs, newest first</h3>
        ${runs.length
        ? `<ul class="menu menu-sm gap-1 p-2">${list}</ul>`
        : '<p class="p-8 text-center text-sm text-base-content/50">This process has no work items yet.</p>'}
      </section>
      <section class="grid min-w-0 gap-4">${open ? processRunDetail(process, open) : ""}</section>
    </div>`);
  }

  function processRunDetail(process: Process, run: ProcessRun): string {
    const { item, steps } = run;
    const stepCard = (execution: Execution): string => {
      const agent = host.agents.find(({ id }) => id === execution.agentId);
      const outputs = host.executionOutputs.filter(({ executionId }) => executionId === execution.id);
      const logs = execution.logs.trim().slice(-4000);
      return `<details class="rounded-box border border-base-300 bg-base-100 p-3">
        <summary class="cursor-pointer">
          <span class="text-sm font-semibold">${host.escapeHtml(agent?.name ?? "Removed agent")}</span>
          <span class="ml-2">${statusBadge(execution.status)}</span>
          <span class="mt-1 block text-xs text-base-content/55">${when(execution.startedAt ?? execution.createdAt)} · ${duration(execution)}</span>
        </summary>
        <div class="mt-3 grid gap-3 text-xs">
          ${execution.error
          ? `<div><div class="font-bold uppercase text-error">Error</div><pre class="mt-1 whitespace-pre-wrap break-words font-sans">${host.escapeHtml(execution.error)}</pre></div>`
          : ""}
          <div><div class="font-bold uppercase text-base-content/45">Logs</div>
            <pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans">${host.escapeHtml(logs) || "No logs recorded."}</pre></div>
          <div><div class="font-bold uppercase text-base-content/45">Files</div>
            ${outputs.length
          ? `<ul class="mt-1 grid gap-1">${outputs
            .map((output) => `<li>${host.escapeHtml(output.logicalOutput)} → ${host.escapeHtml(output.logicalDestination)} ${statusBadge(output.status)}</li>`)
            .join("")}</ul>`
          : '<p class="mt-1 text-base-content/45">No files proposed by this step.</p>'}
          </div>
          <div><button class="btn btn-ghost btn-xs border border-base-300" data-action="open-run" data-id="${execution.id}">Open full conversation</button></div>
        </div>
      </details>`;
    };
    const placed = new Set<string>();
    const lanes = process.stages
      .map((stage) => {
        const own = steps.filter((execution) => host.runStageId(execution) === stage.id);
        for (const execution of own)
          placed.add(execution.id);
        return `<div class="flex w-64 shrink-0 flex-col gap-2 rounded-box bg-base-200/50 p-3">
          <span class="truncate text-xs font-semibold uppercase tracking-wide text-base-content/60">${host.escapeHtml(stage.name)}${item.stageId === stage.id ? " · now here" : ""}</span>
          ${own.map(stepCard).join("") ||
          '<p class="px-1 py-2 text-xs text-base-content/45">Nothing ran here.</p>'}
        </div>`;
      })
      .join("");
    const orphans = steps.filter(({ id }) => !placed.has(id));
    const sequence = steps
      .map((execution, index) => {
        const stage = process.stages.find(({ id }) => id === host.runStageId(execution));
        return `${index ? '<span class="text-base-content/30">→</span>' : ""}<span class="badge badge-ghost badge-sm whitespace-nowrap">${host.escapeHtml(stage?.name ?? "No status")} · ${when(execution.startedAt ?? execution.createdAt).split(", ").at(-1) ?? ""}</span>`;
      })
      .join("");
    return `<article class="rounded-box border border-base-300 bg-base-100 shadow-sm">
        <header class="border-b border-base-300 p-4">
          <h3 class="font-bold">${host.escapeHtml(item.title)}</h3>
          <p class="mt-1 text-sm text-base-content/55">${steps.length ? "Started" : "Created"} ${when(run.startedAt)} · now on ${host.escapeHtml(process.stages.find(({ id }) => id === item.stageId)?.name ?? "an archived status")}</p>
          <div class="mt-3 flex flex-wrap items-center gap-1.5">${sequence || '<span class="text-sm text-base-content/45">No steps recorded.</span>'}</div>
        </header>
        <div class="flex gap-3 overflow-x-auto p-4">${lanes}${orphans.length
        ? `<div class="flex w-64 shrink-0 flex-col gap-2 rounded-box bg-base-200/50 p-3">
                <span class="text-xs font-semibold uppercase tracking-wide text-base-content/60">No status</span>
                ${orphans.map(stepCard).join("")}
              </div>`
        : ""}</div>
      </article>`;
  }

  function libraryAgentEligibility(definition: ProcessLibraryEntry["agents"][number]) {
    return effectiveAgentEligibility({
      name: definition.name,
      config: {
        prompt: definition.prompt,
        provider: definition.provider,
        model: definition.model
      }
    }, host.assistantModel, true, host.machineModelAvailability);
  }

  function renderProcessLibrary(): void {
    host.setHeader("Process library", host.currentTeam()?.name);
    host.swap(`<section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
      <header class="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 p-5">
        <div>
          <button class="link link-primary mb-2 text-sm" data-action="close-process-library">← Back to the board</button>
          <h2 class="font-bold">Process library</h2>
          <p class="mt-1 text-sm text-base-content/55">Curated processes bundled with Bees Desktop and available offline.</p>
        </div>
        <button class="btn btn-primary btn-sm" data-action="new-process">Create process</button>
      </header>
      <div class="grid gap-4 p-5 lg:grid-cols-2">${PROCESS_LIBRARY.map((entry) => {
      const installed = host.processes.some(({ name }) => name.toLowerCase() === entry.name.toLowerCase());
      const unavailable = entry.agents.filter((agent) => !libraryAgentEligibility(agent).active).length;
      const models = [...new Set(entry.agents.map(({ provider, model }) => `${provider}/${model}`))];
      return `<article class="card border border-base-300 bg-base-100">
          <div class="card-body gap-4 p-5">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div><h3 class="card-title text-base">${host.escapeHtml(entry.name)}</h3>
                <p class="mt-1 text-sm text-base-content/60">${host.escapeHtml(entry.description)}</p></div>
              <span class="badge badge-outline badge-sm">Bundled</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <span class="badge badge-ghost badge-sm">${entry.stages.length} statuses</span>
              <span class="badge badge-ghost badge-sm">${entry.agents.length} agents</span>
              ${models.map((model) => `<span class="badge badge-ghost badge-sm">${host.escapeHtml(model)}</span>`).join("")}
            </div>
            ${unavailable
          ? `<p class="text-xs text-warning">${unavailable} configured agent model${unavailable === 1 ? " is" : "s are"} unavailable on this computer. You can change them after adding.</p>`
          : `<p class="text-xs text-success">All configured agent models are available on this computer.</p>`}
            <div class="card-actions justify-end">
              <button class="btn btn-primary btn-sm" data-action="add-library-process" data-template="${host.escapeHtml(entry.id)}" ${installed ? "disabled" : ""}>${installed ? "Added to team" : "Add to team"}</button>
            </div>
          </div>
        </article>`;
    }).join("")}</div>
    </section>`);
  }

  const ACTION_ICONS = {
    add: '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>',
    active: '<svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>',
    inactive: '<svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z"></path><path d="M12 9v5M12 17.5v.5"></path></svg>',
    broken: '<svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg>',
    edit: '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m14 5 5 5M4 20l3.5-.7L19 7.8a2.1 2.1 0 0 0-3-3L4.7 16.5 4 20Z"></path></svg>',
    duplicate: '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>',
    delete: '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path></svg>',
    archive: '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16v13H4V7ZM3 4h18v3H3V4ZM9 11h6"></path></svg>',
    history: '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 4v4h4"></path><path d="M12 8v4l3 2"></path></svg>',
    schedule: '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>',
    library: '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16ZM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z"></path></svg>'
  } as const;

  function actionIconButton(action: string, label: string, icon: string, id?: string, classes = "btn-ghost", tooltip = "tooltip-left"): string {
    const escapedLabel = host.escapeHtml(label);
    return `<button class="btn btn-square btn-sm ${classes} tooltip ${tooltip}" data-action="${action}"${id ? ` data-id="${host.escapeHtml(id)}"` : ""} data-tip="${escapedLabel}" title="${escapedLabel}" aria-label="${escapedLabel}">${icon}</button>`;
  }

  /** Process and status for an id across the team. Null when it no longer exists. */
  function triggerContext(stageId: string | null): {
    process: Process;
    stageName: string;
  } | null {
    if (!stageId)
      return null;
    for (const process of host.processes) {
      const stage = process.stages.find(({ id }) => id === stageId);
      if (stage)
        return { process, stageName: stage.name };
    }
    return null;
  }

  function stageName(stageId: string | null): string | null {
    return triggerContext(stageId)?.stageName ?? null;
  }

  function agentRelation(agent: Agent): string {
    const trigger = triggerContext(agent.triggerStageId);
    return `${trigger?.process.name ?? "No process"} - ${trigger?.stageName ?? "No trigger"} - ${agent.name}`;
  }

  /** Why a local org can't do this, plus the way out. `upgrade` adds the button to create a connected org. */
  function localOrgNotice(message: string, upgrade = false): string {
    return `<div class="rounded-box border border-dashed border-base-300 bg-base-100 p-8 text-center text-sm text-base-content/55">${host.escapeHtml(message)}${upgradeButton(upgrade, "mt-4")}</div>`;
  }

  /** Button that starts the connected-org purchase flow. Empty unless `show`. */
  function upgradeButton(show: boolean, extraClass = ""): string {
    return show
      ? `<div class="${extraClass}"><button class="btn btn-primary btn-sm" data-action="create-connected-org">Create a connected org</button></div>`
      : "";
  }

  const LOCAL_ORG_UPGRADE_HINT = "You're using a local organization. Use a connected organization to invite teammates and synchronize across devices.";

  const CONNECTED_ORG_BETA_COPY = "Connected organizations are free during beta. We may introduce paid organization plans later, with advance notice. You'll never be charged automatically.";

  // ---- Team settings (tabbed: Members / Folder / Integrations) ----
  async function teamMembersContent(): Promise<string> {
    const token = host.orgToken();
    if (!token)
      return localOrgNotice(host.orgIsConnected() ? "Sign in to manage team members." : LOCAL_ORG_UPGRADE_HINT, !host.orgIsConnected());
    if (!host.activeOrgTeamEnabled())
      return localOrgNotice("Team features are off for this organization.");
    const orgId = host.workspace.organizationId;
    const [{ teams: serverTeams }, { plan }] = await Promise.all([
      host.api.listTeams(token, orgId),
      host.api.plan(token)
    ]);
    const trialEndsAt = host.activeServerOrg()?.trialEndsAt;
    const trialEnds = trialEndsAt ? new Date(trialEndsAt) : null;
    const memberLists = await Promise.all(serverTeams.map((team) => host.api.listTeamMembers(token, orgId, team.id).then(({ members }) => members)));
    const isAdmin = (members: {
      userId: string;
      role: string;
    }[]): boolean => members.some((member) => member.userId === host.currentUser()?.id && member.role === "admin");
    const planSummary = plan.freeDuringBeta
      ? `<div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-base-content/55">
          <span class="badge badge-primary badge-sm">Free during beta</span>
          <span>${host.escapeHtml(CONNECTED_ORG_BETA_COPY)}</span>
        </div>`
      : `<p class="mt-1 text-sm text-base-content/55">${serverTeams.length} of ${plan.freeTeams} free teams used — $${(plan.priceCents / 100).toFixed(2)}/${plan.interval} per team after that.${trialEnds && trialEnds > new Date()
        ? ` Trial runs to ${trialEnds.toLocaleDateString()}.`
        : ""}</p>`;
    return `<section class="space-y-4">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div><h2 class="font-bold">Teams</h2><p class="mt-1 text-sm text-base-content/55">Restricted membership — admins add teammates.</p>
          ${planSummary}
        </div>
        <div class="flex gap-2">
          ${plan.freeDuringBeta
        ? ""
        : `<button class="btn btn-ghost btn-sm" data-action="start-team-trial">${trialEnds && trialEnds > new Date() ? "Extend trial 30 days" : "Start 30-day trial"}</button>`}
          <button class="btn btn-primary btn-sm" data-action="new-server-team">New team</button>
        </div>
      </header>
      ${serverTeams.length
        ? serverTeams
          .map((team, index) => {
            const members = memberLists[index]!;
            const admin = isAdmin(members);
            return `<article class="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
                  <div class="flex items-center justify-between gap-3">
                    <h3 class="font-bold">${host.escapeHtml(team.name)}</h3>
                    ${admin
                ? `<button class="btn btn-primary btn-xs" data-action="invite-team-member" data-team="${team.id}">Invite</button>`
                : `<span class="badge badge-ghost badge-sm">Member</span>`}
                  </div>
                  <ul class="mt-3 divide-y divide-base-200">
                    ${members
                .map((member) => `<li class="flex items-center justify-between gap-2 py-2 text-sm">
                          <span class="truncate">${host.escapeHtml(member.userId === host.currentUser()?.id ? `${host.currentUser()?.email} (you)` : member.userId)}</span>
                          <span class="flex items-center gap-2">
                            <span class="badge badge-sm ${member.role === "admin" ? "badge-primary" : "badge-ghost"}">${member.role}</span>
                            ${admin && member.role === "member"
                    ? `<button class="btn btn-ghost btn-xs" data-action="promote-team-member" data-team="${team.id}" data-user="${host.escapeHtml(member.userId)}">Make admin</button>`
                    : ""}
                          </span>
                        </li>`)
                .join("")}
                  </ul>
                </article>`;
          })
          .join("")
        : `<div class="p-12 text-center text-sm text-base-content/50">No teams yet. Create one — you'll be its admin.</div>`}
    </section>`;
  }

  async function checkedFileLocations(locations: FileLocation[]): Promise<FileLocation[]> {
    return Promise.all(locations.map(async (location) => {
      if (!location.localPath)
        return location;
      const missing = await host.workspaces.validateDirectory(location.localPath).then(() => false, () => true);
      if (missing !== location.missing) {
        await host.repository.markFileLocationMissing(location.id, missing);
      }
      return { ...location, missing };
    }));
  }

  function fileLocationRows(locations: FileLocation[], removable: (location: FileLocation) => boolean): string {
    if (!locations.length) {
      return '<p class="rounded-box bg-base-200 p-4 text-sm text-base-content/50">No linked locations yet.</p>';
    }
    return locations
      .map((location) => `<div class="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2"><span class="font-semibold">${host.escapeHtml(location.name)}</span>
            <span class="badge badge-ghost badge-sm">${location.teamId ? "Team" : "Organization"}</span></div>
          <code class="mt-1 block break-all text-xs text-base-content/60">${host.escapeHtml(location.localPath || "Not mapped on this machine")}</code>
          ${location.missing ? '<p class="mt-1 text-xs font-semibold text-error">Folder is missing or unavailable.</p>' : ""}
        </div>
        <div class="flex gap-2">
          <button class="btn btn-ghost btn-xs" data-action="map-file-location" data-id="${location.id}">${location.localPath ? "Re-map" : "Map folder"}</button>
          ${removable(location) ? `<button class="btn btn-ghost btn-xs text-error" data-action="remove-file-location" data-id="${location.id}" data-name="${host.escapeHtml(location.name)}">Remove</button>` : ""}
        </div>
      </div>`)
      .join("");
  }

  async function teamFolderContent(): Promise<string> {
    let mapping = await host.repository.getResolvedTeamFolder(host.workspace.teamId);
    if (mapping) {
      try {
        await host.workspaces.validateDirectory(mapping.localPath);
        if (mapping.override && mapping.missing)
          await host.repository.markTeamFolderMissing(host.workspace.teamId, false);
        mapping = { ...mapping, missing: false };
      }
      catch {
        if (mapping.override && !mapping.missing)
          await host.repository.markTeamFolderMissing(host.workspace.teamId, true);
        mapping = { ...mapping, missing: true };
      }
    }
    const globalPath = await host.repository.getSetting("global_local_path", "");
    const locations = await checkedFileLocations(await host.repository.listAvailableFileLocations(host.workspace.teamId));
    return `<section class="card border border-base-300 bg-base-100 shadow-sm">
        <div class="card-body">
          <div class="flex items-start justify-between gap-3">
            <div><h2 class="card-title text-base">Primary team workspace</h2>
            <p class="mt-1 text-sm text-base-content/55">The default home for team files and all approved agent outputs.</p></div>
            <span class="badge ${mapping?.override ? "badge-primary" : "badge-ghost"}">${mapping?.override ? "Override" : "Inherited"}</span>
          </div>
          <div class="mt-3 rounded-box bg-base-200 p-4">
            <code class="break-all text-sm">${host.escapeHtml(mapping?.localPath || (globalPath ? "Team folder not found" : "Set a folder first"))}</code>
            ${mapping?.missing ? '<p class="mt-2 text-xs font-semibold text-error">Folder is missing or unavailable.</p>' : ""}
          </div>
          <div class="card-actions mt-3 justify-end">
            ${mapping?.override ? '<button class="btn btn-ghost btn-sm" data-action="use-default-folder">Use default</button>' : ""}
            <button class="btn btn-primary btn-sm" data-action="pick-folder">Choose override</button>
          </div>
        </div>
      </section>
      <section class="card mt-4 border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div><h2 class="card-title text-base">Linked file locations</h2>
            <p class="mt-1 text-sm text-base-content/55">Organization locations are inherited. Team locations can point anywhere on this machine, including different Google Drive folders.</p></div>
          <button class="btn btn-primary btn-sm" data-action="add-team-location">Add team location</button>
        </div>
        <div class="grid gap-2">${fileLocationRows(locations, (location) => location.teamId === host.workspace.teamId)}</div>
        <p class="text-xs text-base-content/50">Only the location name, scope, ID, and relative file reference sync. Absolute folder paths stay on this machine.</p>
      </div></section>`;
  }

  /**
   * Skill curation. The list is the pure half — no model runs to produce it, only which skills
   * agents select and which ones runs have reached for. "Tidy skills" is the other half, and like
   * every other proposal in Bees it lands as a preview the user applies.
   */
  function skillCurationContent(): string {
    const unused = host.skillReviews.filter(({ state }) => state === "unused");
    const proposal = host.curatorPlan ? `<div class="mt-3 rounded-box border border-warning/40 bg-warning/5 p-3">
          ${host.curatorPlan.summary ? `<p class="text-sm">${host.escapeHtml(host.curatorPlan.summary)}</p>` : ""}
          <div class="mt-2 grid gap-2">${host.curatorPlan.actions
        .map((entry) => `<div class="rounded bg-base-100 p-2 text-sm">
                <div class="${entry.error ? "text-error" : "font-semibold"}">${host.escapeHtml(entry.summary)}</div>
                ${entry.error ? `<div class="text-xs text-error">${host.escapeHtml(entry.error)}</div>` : ""}
              </div>`)
        .join("")}</div>
          <div class="mt-3 flex gap-2">
            <button class="btn btn-success btn-sm" data-action="apply-curator-plan" ${host.curatorPlan.actions.some(({ error }) => !error) ? "" : "disabled"}>Apply</button>
            <button class="btn btn-ghost btn-sm" data-action="discard-curator-plan">Discard</button>
          </div>
        </div>`
      : "";
    return `<div class="py-4">
      <div class="flex items-center justify-between gap-4">
        <div><h3 class="text-sm font-bold">Skill curation</h3><p class="text-xs text-base-content/55">Bees scores no run, so a skill is judged only by whether anything reaches for it. Retiring one moves its folder to <code>skills/.archive</code>; nothing is deleted and nothing is written until you apply it.</p></div>
        <button class="btn btn-ghost btn-sm border border-base-300" data-action="curate-skills" ${host.curatorBusy ? "disabled" : ""}>${host.curatorBusy ? "Reading…" : "Tidy skills"}</button>
      </div>
      <div class="mt-3 grid gap-2">${host.skillReviews.length
        ? host.skillReviews.map((review) => `<div class="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-3">
                <div><div class="font-semibold">${host.escapeHtml(review.capability.name)}</div>
                  <div class="text-xs text-base-content/50">${review.useCount ? `used ${review.useCount} time(s)` : "never used"} · ${review.selected ? "selected by an agent" : "selected by no agent"}</div></div>
                ${review.state === "unused"
            ? `<button class="btn btn-ghost btn-xs text-error" data-action="archive-skill" data-slug="${host.escapeHtml(skillSlugOf(review.capability))}" data-name="${host.escapeHtml(review.capability.name)}">Retire</button>`
            : `<span class="badge badge-ghost badge-sm">in use</span>`}
              </div>`)
          .join("")
        : `<p class="text-xs text-base-content/45">No skills yet.</p>`}</div>
      ${unused.length ? `<p class="mt-2 text-xs text-base-content/45">${unused.length} skill(s) nothing has reached for in ${UNUSED_AFTER_DAYS} days.</p>` : ""}
      ${proposal}
    </div>`;
  }

  function teamIntegrationsContent(): string {
    return `<section class="card border border-base-300 bg-base-100 shadow-sm">
        <div class="card-body">
          <h2 class="card-title text-base">Local integrations</h2>
          <div class="mt-2 divide-y divide-base-300">
            <div class="py-4">
              <div class="flex items-center justify-between gap-4">
                <div><h3 class="text-sm font-bold">Skills and tools</h3><p class="text-xs text-base-content/55">Trusted folders copied to Bees app-data and inventoried by filename. JavaScript and TypeScript tools run as trusted local code outside the file sandbox. Remote MCP services are added under Preferences → MCP servers.</p></div>
                <div class="flex gap-2">
                  <button class="btn btn-primary btn-sm" data-action="new-skill">New skill</button>
                  <button class="btn btn-ghost btn-sm border border-base-300" data-action="add-registry">Add folder</button>
                </div>
              </div>
              <div class="mt-3 grid gap-2">${host.registries.length
        ? host.registries.map((registry) => `<div class="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-3">
                          <div><div class="font-semibold">${host.escapeHtml(registry.name)}</div>
                            <div class="text-xs text-base-content/50">${registry.files.length} copied file(s) · ${registryCapabilities([
          registry
        ]).length} capability item(s)</div></div>
                          <div class="flex gap-2"><button class="btn btn-ghost btn-xs" data-action="refresh-registry" data-id="${registry.id}">Refresh</button><button class="btn btn-ghost btn-xs text-error" data-action="remove-registry" data-id="${registry.id}">Remove</button></div>
                        </div>`)
          .join("")
        : `<p class="text-xs text-base-content/45">No skills or tools folders added.</p>`}</div>
            </div>
            ${skillCurationContent()}
          </div>
        </div>
      </section>`;
  }

  function teamBrowserContent(): string {
    return `<section class="card border border-base-300 bg-base-100 shadow-sm">
        <div class="card-body">
          <div class="flex items-start justify-between gap-4">
            <div><h2 class="card-title text-base">Browser</h2>
            <p class="mt-1 text-sm text-base-content/55">Each team has its own isolated browser and browser profile. Open this team's Chrome instance to sign in to websites once. Agents can reuse your logged-in session, while your passwords and cookies remain on your computer. Bees never has access to your passwords or cookies.</p></div>
            <button class="btn btn-primary btn-sm" data-action="connect-site">Open Browser</button>
          </div>
        </div>
      </section>`;
  }

  async function teamArchivedContent(): Promise<string> {
    const archived = (await host.repository.listProcesses(host.workspace.teamId, true)).filter(({ archivedAt }) => archivedAt);
    return `<section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body">
        <h2 class="card-title text-base">Archived processes</h2>
        <p class="mt-1 text-sm text-base-content/55">Restoring brings back the process, its statuses, and its dashboards.</p>
        <div class="mt-3 grid gap-2">${archived.length
        ? archived
          .map((process) => `<div class="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-3">
                    <div><div class="font-semibold">${host.escapeHtml(process.name)}</div>
                      <div class="text-xs text-base-content/50">Archived ${host.escapeHtml(new Date(process.archivedAt!).toLocaleDateString())} · ${process.stages.length} status(es)</div></div>
                    <button class="btn btn-primary btn-xs" data-action="restore-process" data-id="${process.id}">Restore</button>
                  </div>`)
          .join("")
        : `<p class="text-xs text-base-content/45">No archived processes.</p>`}</div>
      </div></section>`;
  }

  function teamDangerContent(): string {
    return `<section class="card border border-error/40 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <h2 class="card-title text-base text-error">Danger zone</h2>
        <p class="text-sm text-base-content/60">Deletes this team and all its processes, dashboards, and work items on this machine. Cannot be undone.</p>
        <div class="card-actions justify-end"><button class="btn btn-error btn-sm" data-action="delete-team">Delete team</button></div>
      </div></section>`;
  }

  async function renderTeamSettings(): Promise<void> {
    host.setHeader("Team settings", host.currentTeam()?.name);
    await renderTabs<TeamTab>("team-tab", [
      { id: "members", label: "Members", content: teamMembersContent },
      { id: "folder", label: "Folder", content: teamFolderContent },
      { id: "integrations", label: "Integrations", content: teamIntegrationsContent },
      { id: "browser", label: "Browser", content: teamBrowserContent },
      { id: "archived", label: "Archived processes", content: teamArchivedContent },
      { id: "danger", label: "Danger zone", content: teamDangerContent }
    ], host.teamTab, () => host.view === "settings");
  }

  // ---- Organization settings (tabbed: General / Members / Invites / Folder) ----
  function orgGeneralContent(): string {
    const connected = host.orgIsConnected();
    const user = host.currentUser();
    const signedIn = host.orgSignedIn() && !!user;
    const social = Object.entries(host.providerLabel)
      .map(([provider, label]) => `<button class="btn btn-outline btn-sm" data-action="social-signin" data-provider="${provider}">Continue with ${label}</button>`)
      .join("");
    const authBlock = !connected
      ? ""
      : signedIn
        ? `<div class="flex flex-wrap items-center justify-between gap-3">
             <span class="text-sm">Signed in as <strong>${host.escapeHtml(user!.email)}</strong></span>
             <button class="btn btn-ghost btn-sm text-error" data-action="sign-out">Sign out</button>
           </div>`
        : `<div class="flex flex-wrap items-center gap-2">
             <span class="w-full text-sm text-base-content/60">Signed out of this organization.</span>
             ${social}
             <button class="btn btn-outline btn-sm" data-action="signin-email">Email sign in</button>
             <button class="btn btn-outline btn-sm" data-action="signup-email">Create account</button>
           </div>`;
    return `<div class="space-y-5">
      <section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class="card-title text-base">${connected ? "Connected organization" : "Local organization"}</h2>
          <div class="flex flex-wrap gap-2">
            <span class="badge ${connected ? "badge-success" : "badge-ghost"}">${connected ? "Connected" : "Local"}</span>
            ${connected ? '<span class="badge badge-primary">Free during beta</span>' : ""}
          </div>
        </div>
        <p class="text-sm text-base-content/60">${connected
        ? `Server-backed. Users and agents on different machines can coordinate on the same work items here. ${host.escapeHtml(CONNECTED_ORG_BETA_COPY)}`
        : "Bees Desktop is free. Work stays on this machine unless you use a connected organization."}</p>
        ${authBlock}${upgradeButton(!connected)}
      </div></section>
      <section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <h2 class="card-title text-base">Organization name</h2>
        <div class="flex items-center gap-2">
          <code class="flex-1 break-all rounded-box bg-base-200 p-3 text-sm">${host.escapeHtml(host.currentOrganization()?.name ?? "")}</code>
          <button class="btn btn-outline btn-sm" data-action="rename-org">Rename</button>
        </div>
      </div></section>
      <section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <div class="flex items-center gap-3">
          ${host.orgLogoPreview(host.workspace.organizationId, host.currentOrganization()?.name ?? "")}
          <div class="flex-1"><h2 class="card-title text-base">Branding</h2>
            <p class="text-sm text-base-content/55">Logo and color shown in the organization switcher.</p></div>
          ${host.brandingFor(host.workspace.organizationId).logo
        ? `<button class="btn btn-ghost btn-sm" data-action="remove-logo">Remove logo</button>`
        : ""}
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="form-control grid gap-1.5"><span class="label-text text-sm font-semibold">Color</span>
            <input class="h-10 w-full cursor-pointer rounded-lg border border-base-300 bg-base-100" type="color"
              data-branding="color" value="${host.escapeHtml(host.brandingFor(host.workspace.organizationId).color || "#4f46e5")}"></label>
          <label class="form-control grid gap-1.5"><span class="label-text text-sm font-semibold">Logo</span>
            <input class="file-input file-input-bordered w-full" type="file" accept="image/*" data-branding="logo"></label>
        </div>
      </div></section>
      <section class="card border border-error/40 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <h2 class="card-title text-base text-error">Danger zone</h2>
        <p class="text-sm text-base-content/60">Deletes this organization and all its teams, boards, and agents. Cannot be undone.${connected ? " Admins only." : ""}</p>
        <div class="card-actions justify-end"><button class="btn btn-error btn-sm" data-action="delete-org">Delete organization</button></div>
      </div></section>
    </div>`;
  }

  async function orgMembersContent(): Promise<string> {
    const token = host.orgToken();
    if (!host.orgIsConnected())
      return localOrgNotice(LOCAL_ORG_UPGRADE_HINT, true);
    if (!token)
      return localOrgNotice("Sign in to manage organization members.");
    let memberships;
    try {
      ({ memberships } = await host.api.listMemberships(token, host.workspace.organizationId));
    }
    catch {
      return `<div class="p-8 text-center text-sm text-base-content/50">Only organization admins can view members.</div>`;
    }
    return `<section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
        <header class="border-b border-base-300 p-5"><h2 class="font-bold">Members</h2></header>
        <ul class="divide-y divide-base-200 p-2">${memberships
        .map((member) => `<li class="flex items-center gap-2 px-3 py-2 text-sm">
              <span class="flex-1 truncate">${host.escapeHtml(member.userId === host.currentUser()?.id
          ? `${member.email ?? host.currentUser()?.email} (you)`
          : member.email ?? member.userId)}</span>
              <span class="badge badge-sm ${member.role === "member" ? "badge-ghost" : "badge-primary"}">${host.escapeHtml(member.role)}</span>
              <span class="w-20 text-right">${member.role !== "owner" && member.userId !== host.currentUser()?.id
            ? `<button class="btn btn-ghost btn-xs text-error" data-action="remove-org-member" data-user="${host.escapeHtml(member.userId)}" data-email="${host.escapeHtml(member.email ?? member.userId)}">Remove</button>`
            : ""}</span>
            </li>`)
        .join("")}</ul>
      </section>`;
  }

  async function orgInvitesContent(): Promise<string> {
    const connected = host.orgIsConnected();
    if (!connected)
      return localOrgNotice(LOCAL_ORG_UPGRADE_HINT, true);
    let pending: {
      email: string;
      role: string;
    }[] = [];
    const token = host.orgToken();
    try {
      if (token)
        pending = (await host.api.listOrgInvitations(token, host.workspace.organizationId)).invitations; // 403 for non-admins
    }
    catch {
      // not an admin, or none — leave the list empty
    }
    return `<section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
        <header class="flex items-center justify-between gap-3 border-b border-base-300 p-5">
          <div><h2 class="font-bold">Invitations</h2><p class="mt-1 text-sm text-base-content/55">Pending invites to this organization.</p></div>
          <button class="btn btn-primary btn-sm" data-action="invite-org-member">Invite someone</button>
        </header>
        <ul class="divide-y divide-base-200 p-2">${pending.length
        ? pending
          .map((invitation) => `<li class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span class="truncate">${host.escapeHtml(invitation.email)}</span>
                <span class="badge badge-ghost badge-sm">${host.escapeHtml(invitation.role)}</span>
              </li>`)
          .join("")
        : `<li class="px-3 py-6 text-center text-sm text-base-content/50">No pending invitations.</li>`}</ul>
      </section>`;
  }

  /** Preferences → Folder: the root all org/team folders default under. */
  async function prefsFolderContent(): Promise<string> {
    const globalPath = await host.repository.getSetting("global_local_path", "");
    return `<section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <h2 class="card-title text-base">Root Folder</h2>
        <p class="text-sm text-base-content/60">Every organization gets a folder at <code>&lt;root-folder&gt;/&lt;org-name&gt;</code>, with each team folder inside it. Changing this only affects folders resolved from here on.</p>
        <div class="rounded-box bg-base-200 p-4"><code class="break-all text-sm">${host.escapeHtml(globalPath || "No path selected")}</code></div>
        <div class="card-actions justify-end"><button class="btn btn-primary btn-sm" data-action="pick-global-folder">Change path</button></div>
      </div></section>`;
  }

  async function orgWorkspaceContent(): Promise<string> {
    const orgPath = await host.repository.getOrgFolder(host.workspace.organizationId);
    const locations = (await checkedFileLocations(await host.repository.listOrganizationFileLocations(host.workspace.organizationId))).filter(({ teamId }) => !teamId);
    return `<section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <h2 class="card-title text-base">Primary organization folder</h2>
        <p class="text-sm text-base-content/60">This organization's folder. Team folders resolve to <code>&lt;org folder&gt;/&lt;team-name&gt;</code> unless a team overrides it. Change the root under Preferences → Folder.</p>
        <div class="rounded-box bg-base-200 p-4"><code class="break-all text-sm">${host.escapeHtml(orgPath || "Set a folder first")}</code></div>
        <div class="card-actions justify-end"><button class="btn btn-primary btn-sm" data-action="pick-global-folder">Change default root</button></div>
      </div></section>
      <section class="card mt-4 border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div><h2 class="card-title text-base">Linked organization locations</h2>
            <p class="mt-1 text-sm text-base-content/55">Add as many organization-wide locations as needed. Every team can reference them.</p></div>
          <button class="btn btn-primary btn-sm" data-action="add-org-location">Add organization location</button>
        </div>
        <div class="grid gap-2">${fileLocationRows(locations, () => true)}</div>
        <p class="text-xs text-base-content/50">Each machine maps the shared location ID to its own local folder. Bees Cloud does not synchronize absolute paths or document files.</p>
      </div></section>`;
  }

  async function orgKnowledgeContent(): Promise<string> {
    let policy: KnowledgePolicy | null = null;
    try {
      policy = await host.loadKnowledgePolicy();
    }
    catch (error) {
      host.knowledgeError = errorText(error);
    }
    const availableSources = host.workspace.teamId
      ? await host.repository.listAvailableFileLocations(host.workspace.teamId)
      : [];
    const sources = policy?.mode === "remote"
      ? availableSources
      : availableSources.filter(({ localPath, missing }) => Boolean(localPath) && !missing);
    const sourceRows = sources.length
      ? sources
        .map((source) => `<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>${host.escapeHtml(source.name)}</span>
              <span class="badge badge-sm ${source.teamId ? "badge-ghost" : "badge-primary"}">${source.teamId ? "This team" : "Organization"}</span>
            </li>`)
        .join("")
      : `<li class="px-3 py-5 text-sm text-base-content/50">No mapped organization or team folders are available on this machine.</li>`;
    const active = policy
      ? `<span class="badge badge-success">${policy.mode === "local" ? "Local" : "Remote"}</span>`
      : `<span class="badge badge-ghost">Off</span>`;
    const detail = !policy
      ? "Choose local indexing on each machine or one organization-controlled remote worker."
      : policy.mode === "local"
        ? `This machine indexes ${sources.length} available source${sources.length === 1 ? "" : "s"}. Each source has its own local index.`
        : `All bees use one organization-controlled endpoint: <code class="break-all">${host.escapeHtml(policy.url)}</code>`;
    return `<div class="space-y-5">
      <section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <div class="flex items-center justify-between gap-3"><h2 class="card-title text-base">Knowledge mode</h2>${active}</div>
        <p class="text-sm text-base-content/60">${detail}</p>
        ${host.knowledgeError ? `<p class="text-sm text-error">${host.escapeHtml(host.knowledgeError)}</p>` : ""}
        <div class="card-actions justify-end gap-2">
          <button class="btn btn-outline btn-sm" data-action="knowledge-local">Use local</button>
          <button class="btn btn-primary btn-sm" data-action="knowledge-remote">${policy?.mode === "remote" ? "Set this team's token" : "Use remote"}</button>
          ${policy ? '<button class="btn btn-ghost btn-sm text-error" data-action="knowledge-disable">Disable</button>' : ""}
        </div>
        <p class="text-xs text-base-content/50">Indexes rebuild in full once a day. A failed rebuild keeps the previous index. Bees Cloud stores only the mode and remote URL, never files, chunks, embeddings, paths, or credentials.</p>
      </div></section>
      <section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
        <header class="border-b border-base-300 p-5"><h2 class="font-bold">Sources available to ${host.escapeHtml(host.currentTeam()?.name ?? "this team")}</h2><p class="mt-1 text-sm text-base-content/55">Organization sources plus this team's sources only. The worker enforces this again from the bearer token.</p></header>
        <ul class="divide-y divide-base-200 p-2">${sourceRows}</ul>
      </section>
    </div>`;
  }

  function localModelStatusLabel(state: string, downloadedBytes: number, totalBytes: number, error?: string): string {
    if (state === "running")
      return "Running";
    if (state === "downloading") {
      return totalBytes
        ? `Downloading ${Math.round((downloadedBytes / totalBytes) * 100)}%`
        : "Downloading…";
    }
    if (state === "ready")
      return "Loaded";
    if (state === "cancelled")
      return "Paused";
    if (state === "error")
      return error ?? "Download failed";
    return "Not loaded";
  }

  /** Download and Run are toggles: flipping one leaves the work running while the user moves on. */
  function localModelToggle(id: string, kind: "download" | "run", on: boolean, disabled: boolean, downloaded = false): string {
    const label = kind === "download" ? "Download" : "Run";
    return `<label class="flex cursor-pointer items-center gap-1.5 text-xs ${disabled ? "opacity-50" : ""}">
      <input type="checkbox" class="toggle toggle-xs toggle-primary" data-model-toggle="${kind}" data-model="${id}"
        ${downloaded ? `data-model-downloaded="1"` : ""} ${on ? "checked" : ""} ${disabled ? "disabled" : ""}>${label}
    </label>`;
  }

  function localModelRow(model: LocalModelView): string {
    const event = host.localModelProgress.get(model.id);
    const state = model.runtime.running ? "running" : (event?.state ?? model.runtime.state);
    const downloadedBytes = event?.downloadedBytes ?? model.runtime.downloadedBytes;
    const totalBytes = event?.totalBytes ?? model.runtime.totalBytes;
    const id = host.escapeHtml(model.id);
    // The wanted flag is persisted, so a Run toggled on during a long download stays on across a
    // page reload or an app restart.
    const starting = (host.localModelStarting.has(model.id) || host.localModels.wantedRunId === model.id) &&
      state !== "running";
    const status = starting && state !== "downloading"
      ? "Starting…"
      : localModelStatusLabel(state, downloadedBytes, totalBytes, event?.error);
    const downloaded = state === "ready" || state === "running";
    // Run implies Download: turning it on downloads first when the file isn't here yet, so both
    // toggles read as on. Flipping Download back off deletes the file and keeps the row — Delete is
    // for dropping the row too. A model picked off this computer has nothing to download at all.
    const action = localModelToggle(id, "download", downloaded || state === "downloading" || starting, !!model.localPath, downloaded) + localModelToggle(id, "run", state === "running" || starting, false);
    const source = model.localPath
      ? `<span class="truncate">${host.escapeHtml(model.localPath)}</span>`
      : `<button class="link" data-action="open-external" data-url="${host.escapeHtml(model.sourceUrl ?? model.url ?? "")}">${host.escapeHtml(model.sourceUrl ? "Hugging Face" : "Download link")}</button>`;
    const license = model.licenseUrl
      ? ` · <button class="link" data-action="open-external" data-url="${host.escapeHtml(model.licenseUrl)}">${host.escapeHtml(model.licenseName ?? "License")}</button>`
      : "";
    return `<tr>
      <td class="max-w-xs">
        <div class="truncate font-semibold">${host.escapeHtml(model.name)}</div>
        <div class="flex gap-1 truncate text-xs text-base-content/55">${source}${license}</div>
      </td>
      <td class="min-w-40">
        <div data-local-model-status="${id}">${host.escapeHtml(status)}</div>
        <progress class="progress progress-primary mt-1 w-full" data-local-model-progress="${id}"
          value="${downloadedBytes}" max="${totalBytes || 1}"></progress>
        <div class="text-xs text-base-content/55">${totalBytes ? host.escapeHtml(host.formatBytes(totalBytes)) : ""}</div>
      </td>
      <td class="text-right whitespace-nowrap">
        <div class="flex items-center justify-end gap-3">${action}
          <label class="flex items-center gap-1 text-xs text-base-content/55"
            title="Context window in tokens. Leave empty to size it from the model's own header and this computer's memory.">
            Context
            <input type="number" min="4096" step="1024" class="input input-xs w-24" placeholder="auto"
              data-model-context="${id}" value="${model.contextSize ?? ""}">
          </label>
          <button class="btn btn-ghost btn-xs text-error" data-action="delete-local-model" data-model="${id}">Delete</button>
        </div>
      </td>
    </tr>`;
  }

  async function prefsLocalModelsContent(): Promise<string> {
    const models = await host.localModels.list();
    return `<div class="space-y-5">
      <section>
        <h2 class="font-bold">Local models</h2>
        <p class="mt-1 text-sm text-base-content/60">Turn on Download to fetch a model, then Run to serve it. Run as many as this computer's memory can hold. Models and chats stay on this device.</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <input class="input input-bordered input-sm min-w-64 flex-1" data-local-model-source
            placeholder="https://huggingface.co/…/model.gguf" aria-label="Model link or file path">
          <button class="btn btn-outline btn-sm" data-action="browse-local-model">Browse…</button>
          <button class="btn btn-primary btn-sm" data-action="add-local-model">Add</button>
        </div>
        <div class="mt-3 overflow-x-auto rounded-box border border-base-300 bg-base-100">
          <table class="table table-sm">
            <thead><tr><th>Model</th><th>Status</th><th class="text-right">Actions</th></tr></thead>
            <tbody>${models.length
        ? models.map(localModelRow).join("")
        : `<tr><td colspan="3" class="py-6 text-center text-sm text-base-content/50">No local models yet.</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    </div>`;
  }

  /**
   * Claude Code and Codex are used through the CLIs already installed on this computer:
   * they hold their own login, so there is nothing to connect here — only whether Bees
   * found them, and the model an agent names to run through one.
   */
  async function cliToolsSection(): Promise<string> {
    const installed = await detectCliTools().catch(() => ({}) as Record<string, CliToolPath>);
    const rows = CLI_TOOLS.map((tool) => {
      const found = installed[tool.id];
      return `<li class="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
        <div class="min-w-0">
          <span class="block truncate font-semibold">${host.escapeHtml(tool.label)}</span>
          <span class="text-xs text-base-content/50">${found
          ? `agent model <code>${host.escapeHtml(tool.exampleModel)}</code> · <span class="truncate">${host.escapeHtml(found.path)}</span>`
          : `Not installed — <button class="link" data-action="open-external" data-url="${host.escapeHtml(tool.installUrl)}">install it</button>, or point Bees at it below`}</span>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <span class="badge badge-sm ${found ? "badge-success" : "badge-ghost"}">${found ? (found.custom ? "Chosen" : "Found") : "Missing"}</span>
          <button class="btn btn-ghost btn-xs" data-action="pick-cli-tool" data-tool="${host.escapeHtml(tool.id)}">Choose…</button>
          ${found?.custom
          ? `<button class="btn btn-ghost btn-xs" data-action="clear-cli-tool" data-tool="${host.escapeHtml(tool.id)}">Use detected</button>`
          : ""}
          ${found
          ? ""
          : `<button class="btn btn-outline btn-xs" data-action="install-cli-tool" data-tool="${host.escapeHtml(tool.id)}">Install</button>`}
        </div>
      </li>`;
    }).join("");
    return `<section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
      <header class="border-b border-base-300 p-5">
        <h2 class="font-bold">Command-line agents</h2>
        <p class="mt-1 text-sm text-base-content/60">Runs pointed at these use the CLI on this computer, signed in with your own account. The CLI works in the run's workspace folder and bills whatever plan it is logged into.</p>
      </header>
      <ul class="divide-y divide-base-200 p-2">${rows}</ul>
    </section>`;
  }

  async function prefsRemoteModelsContent(): Promise<string> {
    const connections = await listAiConnections(host.repository, host.aiConnectionScope());
    const providerButtons = (Object.keys(AI_PROVIDER_LABEL) as AiProvider[])
      .map((provider) => `<button class="btn btn-outline btn-sm" data-action="connect-ai" data-provider="${provider}">
          ${host.escapeHtml(AI_PROVIDER_LABEL[provider])}</button>`)
      .join("");
    const list = connections.length
      ? connections
        .map((connection) => `<li class="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <div class="min-w-0">
                <span class="block truncate font-semibold">${host.escapeHtml(connection.label)}</span>
                <span class="text-xs text-base-content/50">Added ${host.escapeHtml(new Date(connection.createdAt).toLocaleDateString())}${host.AI_PROVIDER_MODEL_PREFIX[connection.provider]
            ? ` · agent model <code>${host.escapeHtml(host.AI_PROVIDER_MODEL_PREFIX[connection.provider])}&lt;model&gt;</code>`
            : " · not usable by runs yet"}</span>
              </div>
              <button class="btn btn-ghost btn-xs text-error" data-action="remove-ai-connection" data-id="${host.escapeHtml(connection.id)}">Remove</button>
            </li>`)
        .join("")
      : `<li class="px-3 py-6 text-center text-sm text-base-content/50">No AI connections yet.</li>`;
    return `<div class="space-y-5">
      <section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <h2 class="card-title text-base">Cloud connections</h2>
        <p class="text-sm text-base-content/60">Give the current organization's agents access to hosted AI. These connections can be active at the same time.</p>
        <div class="flex flex-wrap gap-2">${providerButtons}</div>
      </div></section>
      <section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
        <header class="border-b border-base-300 p-5"><h2 class="font-bold">Active connections</h2></header>
        <ul class="divide-y divide-base-200 p-2">${list}</ul>
      </section>
      ${await cliToolsSection()}
    </div>`;
  }

  async function prefsMcpServersContent(): Promise<string> {
    const connections = (await listMcpConnections(host.repository, host.workspace.teamId)).filter((connection) => !isKnowledgeConnection(connection));
    const list = connections.length
      ? connections.map((connection) => `<li class="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
          <div class="min-w-0"><span class="block truncate font-semibold">${host.escapeHtml(connection.name)}</span>
            <span class="text-xs text-base-content/50">${host.escapeHtml(connection.url)} · ${connection.allowedTools.length}/${connection.tools.length} tools allowed · ${connection.optional ? "optional offline" : "required"}</span>
            ${connection.lastError ? `<div class="mt-1 text-xs text-error">${host.escapeHtml(connection.lastError)}</div>` : ""}
          </div>
          <div class="flex gap-1"><button class="btn btn-ghost btn-xs" data-action="test-mcp" data-id="${connection.id}">Test / allowlist</button><button class="btn btn-ghost btn-xs text-error" data-action="remove-mcp" data-id="${connection.id}">Remove</button></div>
        </li>`).join("")
      : `<li class="px-3 py-6 text-center text-sm text-base-content/50">No MCP servers yet.</li>`;
    return `<div class="space-y-5">
      <section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <h2 class="card-title text-base">MCP servers</h2>
        <p class="text-sm text-base-content/60">Remote MCP servers receive the data an agent sends through their selected tools. Credentials stay in the operating-system vault.</p>
        <div class="flex flex-wrap gap-2"><button class="btn btn-outline btn-sm" data-action="add-mcp-api">Add API-key MCP</button><button class="btn btn-outline btn-sm" data-action="add-mcp-oauth">Add OAuth MCP</button></div>
      </div></section>
      <section class="rounded-box border border-base-300 bg-base-100 shadow-sm"><ul class="divide-y divide-base-200 p-2">${list}</ul></section>
    </div>`;
  }

  async function renderOrgSettings(): Promise<void> {
    host.setHeader("Organization settings", host.currentOrganization()?.name);
    await renderTabs<OrgTab>("org-tab", [
      { id: "general", label: "General", content: orgGeneralContent },
      { id: "members", label: "Members", content: orgMembersContent },
      { id: "invites", label: "Invites", content: orgInvitesContent },
      { id: "folder", label: "Folder", content: orgWorkspaceContent },
      { id: "knowledge", label: "Knowledge", content: orgKnowledgeContent }
    ], host.orgTab, () => host.view === "org-settings");
  }

  // ---- Preferences (tabbed: Mode / Theme / Sign-ins / Org invites / Create org) ----
  function prefsThemeContent(): string {
    const themeOptions = (selected: ThemePreset) => host.themePresets.map((preset) => `<option value="${preset.id}" ${preset.id === selected ? "selected" : ""}>${preset.name}</option>`)
      .join("");
    const themeCards = host.themePresets.map((preset) => `<button class="theme-card ${preset.id === host.themePreset ? "selected" : ""}"
          data-action="set-theme-preset" data-theme-preset="${preset.id}"
          data-theme="${preset.id}" aria-pressed="${preset.id === host.themePreset}">
          <div class="theme-swatches">
            <span style="background:var(--color-primary)"></span>
            <span style="background:var(--color-secondary)"></span>
            <span style="background:var(--color-accent)"></span>
            <span style="background:var(--color-base-300)"></span>
          </div>
          <div><strong class="block text-sm">${preset.name}</strong></div>
        </button>`)
      .join("");
    return `<section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <h2 class="card-title text-base">Theme</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="form-control gap-1">
            <span class="text-sm font-medium">Default Dark Theme</span>
            <select class="select w-full" data-theme-default="dark">${themeOptions(host.darkDefaultTheme)}</select>
          </label>
          <label class="form-control gap-1">
            <span class="text-sm font-medium">Default Light Theme</span>
            <select class="select w-full" data-theme-default="light">${themeOptions(host.lightDefaultTheme)}</select>
          </label>
        </div>
        <h3 class="mt-2 font-semibold">All themes</h3>
        <div class="grid gap-3 sm:grid-cols-3">${themeCards}</div>
      </div></section>`;
  }

  async function prefsSigninsContent(): Promise<string> {
    const description = `<p class="text-sm text-base-content/60">You can sign in with multiple user IDs. Each user ID can belong to multiple organizations, and you can work across all of them at the same time.</p>`;
    const sso = Object.entries(host.providerLabel)
      .map(([provider, label]) => `<button class="btn btn-outline btn-sm justify-start" data-action="social-signin" data-provider="${provider}">Sign in to another account using ${host.escapeHtml(label)} SSO</button>`)
      .join("");
    const addBlock = `<section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-2">
        <h2 class="card-title text-base">Add a sign-in</h2>
        <div class="flex flex-col gap-2">
          ${sso}
          <button class="btn btn-outline btn-sm justify-start" data-action="signin-email">Sign in using an email</button>
          <button class="btn btn-outline btn-sm justify-start" data-action="signup-email">Create a new account using your email</button>
        </div>
      </div></section>`;
    if (host.accounts.size === 0)
      return `<div class="space-y-5">${description}${addBlock}</div>`;
    const label = (provider: string): string => provider === "credential" ? "Email" : (host.providerLabel[provider] ?? provider);
    // One row per signed-in account. Every account is always active — no single active one.
    const rows = await Promise.all([...host.accounts.values()].map(async ({ user, token }) => {
      const providers = await host.api.listAccounts(token).catch(() => []);
      const how = providers.length ? providers.map((a) => label(a.provider)).join(", ") : "—";
      return `<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span class="flex min-w-0 items-center gap-2">
            <span class="status status-success"></span>
            <span class="truncate font-medium">${host.escapeHtml(user.email)}</span>
            <span class="text-base-content/55">· ${host.escapeHtml(how)}</span>
          </span>
          <button class="btn btn-ghost btn-sm text-error" data-action="sign-out-account" data-id="${host.escapeHtml(user.id)}">Sign out</button>
        </li>`;
    }));
    const signedInBlock = `<section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
        <header class="border-b border-base-300 p-5"><h2 class="font-bold">Signed-in accounts</h2></header>
        <ul class="divide-y divide-base-200 p-2">${rows.length ? rows.join("") : `<li class="px-3 py-2 text-sm text-base-content/50">No signed-in accounts.</li>`}</ul>
      </section>`;
    return `<div class="space-y-5">${description}${addBlock}${signedInBlock}</div>`;
  }

  /**
   * One row per (organization, account) pair. The same org reachable by two accounts shows
   * twice — once per account. Each row's action already knows its account, so Login binds that
   * exact account with no prompt. Derived per account from its own memberships + invites.
   */
  async function prefsOrgsContent(): Promise<string> {
    // Two calls per pooled account, only while this tab is open. Fine for a handful of accounts.
    const perAccount = await Promise.all([...host.accounts.values()].map(async (account) => {
      // A failure here used to render as an empty list, which reads as "you have no organizations"
      // — the one thing it must not say. Keep the reason and show it on the row instead.
      const failed = (error: unknown): string => error instanceof ApiError && error.status === 401
        ? "Session expired — sign in again"
        : `Could not reach the server (${errorText(error)})`;
      const [orgs, invites] = await Promise.all([
        host.api.listOrganizations(account.token)
          .then((r) => ({ ok: true as const, value: r.organizations }))
          .catch((error: unknown) => ({ ok: false as const, reason: failed(error) })),
        host.api.myInvitations(account.token)
          .then((r) => r.invitations)
          .catch(() => [])
      ]);
      return { account, orgs, invites };
    }));
    type Row = {
      name: string;
      account: string;
      button: string;
    };
    const rows: Row[] = [];
    const acct = (id: string) => host.escapeHtml(id);
    for (const { account, orgs: orgResult, invites } of perAccount) {
      const email = account.user.email;
      if (!orgResult.ok) {
        rows.push({
          name: "Organizations unavailable",
          account: email,
          button: `<span class="badge badge-error badge-sm">${host.escapeHtml(orgResult.reason)}</span>`
        });
      }
      const orgs = orgResult.ok ? orgResult.value : [];
      for (const org of orgs) {
        const signedIn = host.connections.has(host.connKey(org.id, account.user.id)); // this exact pair connected
        rows.push({
          name: org.name,
          account: email,
          button: signedIn
            ? `<button class="btn btn-ghost btn-xs text-error" data-action="logout-org" data-id="${org.id}" data-account="${acct(account.user.id)}">Logout</button>`
            : `<button class="btn btn-primary btn-xs" data-action="login-org" data-id="${org.id}" data-account="${acct(account.user.id)}">Login</button>`
        });
      }
      for (const invite of invites) {
        rows.push({
          name: invite.organizationName,
          account: email,
          button: `<button class="btn btn-primary btn-xs" data-action="accept-invite" data-id="${invite.id}" data-account="${acct(account.user.id)}">Accept</button>`
        });
      }
    }
    // Local orgs have no account, but still belong in "all orgs".
    for (const org of host.organizations) {
      if (host.orgIsConnected(org.id))
        continue;
      rows.push({ name: org.name, account: "Local", button: `<span class="badge badge-ghost badge-sm">Local</span>` });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name) || a.account.localeCompare(b.account));
    return `<div class="space-y-5">${prefsCreateOrgContent()}<section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
        <header class="border-b border-base-300 p-5"><h2 class="font-bold">Organizations</h2>
          <p class="mt-1 text-sm text-base-content/55">Each organization per account. Log in or out of any without leaving the others.</p></header>
        <ul class="divide-y divide-base-200 p-2">${rows.length
        ? rows
          .map((row) => `<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div class="min-w-0"><strong class="block truncate">${host.escapeHtml(row.name)}</strong>
                  <span class="block text-xs text-base-content/55">${host.escapeHtml(row.account)}</span></div>
                ${row.button}
              </li>`)
          .join("")
        : `<li class="px-3 py-6 text-center text-sm text-base-content/50">No organizations yet.</li>`}</ul>
      </section></div>`;
  }

  function prefsCreateOrgContent(): string {
    return `<section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <h2 class="card-title text-base">Create an organization</h2>
        <p class="text-sm text-base-content/60"><strong>Local</strong>: Bees Desktop is free, and work stays on this machine.</p>
        <p class="text-sm text-base-content/60"><strong>Connected</strong>: free during beta; users and agents on different machines can coordinate on the same work items (needs a sign-in).</p>
        <div class="card-actions justify-end gap-2">
          <button class="btn btn-outline btn-sm" data-action="create-local-org">New local org</button>
          <button class="btn btn-primary btn-sm" data-action="create-connected-org">New connected org</button>
        </div>
      </div></section>`;
  }

  async function renderPreferences(): Promise<void> {
    host.setHeader("Preferences", host.currentUser()?.email ?? "Local");
    await renderTabs<PrefsTab>("prefs-tab", [
      { id: "local-models", label: "Local models", content: prefsLocalModelsContent },
      { id: "remote-models", label: "Remote models", content: prefsRemoteModelsContent },
      { id: "mcp-servers", label: "MCP servers", content: prefsMcpServersContent },
      { id: "signins", label: "Sign-ins", content: prefsSigninsContent },
      { id: "orgs", label: "Orgs", content: prefsOrgsContent },
      { id: "folder", label: "Root Folder", content: prefsFolderContent },
      { id: "theme", label: "Theme", content: prefsThemeContent }
    ], host.prefsTab, () => host.view === "preferences");
  }

  function agentEditorFields(agent?: Agent): EditorField[] {
    const config = agent?.config;
    const selected = config?.provider?.trim() && config.model?.trim()
      ? { provider: config.provider, model: config.model }
      : host.assistantModel;
    const selectedRef = modelRef(selected);
    const catalog = host.overviewAssistantModels();
    const modelOptions = catalog.map(({ group, label, choice }) => ({
      label: `${group} · ${label}`,
      value: modelRef(choice)
    }));
    // Keep an unavailable or custom model from an existing agent selectable instead of
    // silently rewriting the file on its next save.
    if (!modelOptions.some(({ value }) => value === selectedRef)) {
      modelOptions.unshift({ label: `Configured · ${selectedRef}`, value: selectedRef });
    }
    const capabilities = registryCapabilities(host.registries);
    const customTools = capabilities.filter(({ kind }) => kind === "tool");
    const selectedTools = config?.toolRefs ?? [BROWSER_TOOL_REF];
    const selectedGrants = config?.grants ?? [];
    return [
      { name: "name", label: "Name", value: agent?.name ?? "", step: "basics" },
      { name: "purpose", label: "Purpose", value: agent?.purpose ?? "", step: "basics" },
      {
        name: "description",
        label: "Description",
        type: "textarea",
        value: agent?.description ?? "",
        step: "basics"
      },
      {
        name: "trigger",
        label: "Trigger status",
        type: "select",
        value: agent?.triggerStageId ?? "",
        options: [
          { label: "None", value: "" },
          ...host.processes.flatMap((process) => process.stages.map((stage) => ({
            label: `${process.name} / ${stage.name}`,
            value: stage.id
          })))
        ],
        step: "basics"
      },
      {
        name: "model",
        label: "Model",
        type: "select",
        value: selectedRef,
        options: modelOptions,
        hint: "Models available to the dashboard assistant on this computer.",
        step: "instructions"
      },
      {
        name: "thinkingLevel",
        label: "Thinking",
        type: "select",
        value: config?.thinkingLevel ?? "",
        options: thinkingOptionsForModel(selected),
        hint: "Automatic uses the model or Flue default.",
        step: "instructions"
      },
      {
        name: "prompt",
        label: "Instructions",
        type: "textarea",
        value: config?.prompt ?? "",
        step: "instructions"
      },
      {
        name: "skills",
        label: "Skills",
        type: "checkboxes",
        options: capabilities.filter(({ kind }) => kind === "skill").map(({ ref, name, path, registryId }) => ({
          label: name,
          value: ref,
          description: `${host.registries.find(({ id }) => id === registryId)?.name ?? "Skill folder"} · ${path}`
        })),
        checked: config?.skillRefs ?? [],
        hint: "Reusable instructions copied into the run. Add more under Team settings → Integrations.",
        step: "capabilities"
      },
      {
        name: "tools",
        label: "Local tools",
        type: "checkboxes",
        options: [
          {
            label: "Browser",
            value: BROWSER_TOOL_REF,
            description: "Opens websites in the team browser profile. Choose read or write access below."
          },
          ...customTools.map(({ ref, name, path, registryId }) => ({
            label: name,
            value: ref,
            description: `Trusted local code · ${host.registries.find(({ id }) => id === registryId)?.name ?? "Tool folder"} · ${path}`
          }))
        ],
        checked: selectedTools,
        hint: "Selecting a local tool authorizes its trusted code to run on this machine.",
        step: "capabilities"
      },
      {
        name: "browserAccess",
        label: "Browser access",
        type: "toggle",
        value: selectedGrants.includes(BROWSER_WRITE_GRANT) ? "write" : "read",
        options: [
          { label: "Read only", value: "read" },
          { label: "Click and type", value: "write" }
        ],
        hint: "Used only when Browser is selected.",
        step: "capabilities"
      },
      {
        name: "mcps",
        label: "MCP connections",
        type: "checkboxes",
        options: host.mcpConnections.map((connection) => {
          const tools = connection.tools
            .filter(({ name }) => connection.allowedTools.includes(name))
            .slice(0, 4)
            .map(({ name, description }) => description ? `${name} — ${description}` : name);
          const more = Math.max(0, connection.allowedTools.length - tools.length);
          return {
            label: `${connection.name}${connection.lastError ? " · Offline" : ""}`,
            value: connection.id,
            description: `${connection.url} · ${connection.optional ? "Optional when offline" : "Required; submission fails when unavailable"}${tools.length ? ` · Tools: ${tools.join("; ")}${more ? `; +${more} more` : ""}` : " · No tools allowed"}`
          };
        }),
        checked: config?.mcpConnectionRefs ?? [],
        hint: "Remote services receive relevant prompts and tool arguments. Manage connections and their tool allowlists in Preferences → MCP servers.",
        step: "capabilities"
      },
      {
        name: "delegates",
        label: "Helpers",
        type: "checkboxes",
        options: host.agents.filter((candidate) => candidate.id !== agent?.id &&
          !(candidate.config.delegateRefs?.length) &&
          !(candidate.config.mcpConnectionRefs?.length) &&
          !selectedAgentCapabilities(host.registries, candidate.config).some(({ kind }) => kind === "tool"))
          .map(({ id, name, purpose }) => ({ label: name, value: id, description: purpose })),
        checked: config?.delegateRefs ?? [],
        hint: "Helpers can use skills only; they cannot run tools or contact remote services.",
        step: "capabilities"
      },
      {
        name: "environment",
        label: "Execution environment",
        type: "note",
        value: "Runs in the local Bees workspace. File access is sandboxed and the host shell is disabled.",
        step: "capabilities"
      }
    ];
  }

  function checkboxOptions(name: string, options: EditorOption[], checked: string[]): string {
    if (!options.length)
      return `<p class="p-2 text-sm text-base-content/45">None available yet.</p>`;
    return options
      .map((option) => `<label class="cursor-pointer">
          <input class="peer sr-only" type="checkbox" name="${host.escapeHtml(name)}" value="${host.escapeHtml(option.value)}" ${checked.includes(option.value) ? "checked" : ""}>
          <span class="block rounded-box border border-base-300 p-3 transition hover:bg-base-200 peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:[&_.selection-check]:opacity-100">
            <span class="flex items-center justify-between gap-3"><span class="text-sm font-semibold">${host.escapeHtml(option.label)}</span><span class="selection-check text-primary opacity-0" aria-hidden="true">✓</span></span>
            ${option.description ? `<span class="mt-1 block break-words text-xs leading-relaxed text-base-content/55">${host.escapeHtml(option.description)}</span>` : ""}
          </span>
        </label>`)
      .join("");
  }

  function editorFieldHtml({ name, label, value = "", type = "text", placeholder = "", options = [], checked = [], hint }: EditorField): string {
    if (type === "note")
      return `<p class="text-sm text-base-content/75">${host.escapeHtml(value)}</p>`;
    let control = `<input class="input input-bordered w-full" type="${type === "password" ? "password" : "text"}" name="${host.escapeHtml(name)}" value="${host.escapeHtml(value)}" placeholder="${host.escapeHtml(placeholder)}">`;
    if (type === "textarea") {
      control = `<textarea class="textarea textarea-bordered min-h-24 w-full" name="${host.escapeHtml(name)}" placeholder="${host.escapeHtml(placeholder)}">${host.escapeHtml(value)}</textarea>`;
    }
    if (type === "select") {
      control = `<select class="select select-bordered w-full" name="${host.escapeHtml(name)}">${options
        .map((option) => `<option value="${host.escapeHtml(option.value)}" ${option.value === value ? "selected" : ""}>${host.escapeHtml(option.label)}</option>`)
        .join("")}</select>`;
    }
    if (type === "toggle") {
      control = `<div class="join grid w-full" style="grid-template-columns: repeat(${Math.max(1, options.length)}, minmax(0, 1fr))" role="radiogroup" aria-label="${host.escapeHtml(label)}">${options
        .map((option) => `<input class="btn join-item min-w-0" type="radio" name="${host.escapeHtml(name)}" value="${host.escapeHtml(option.value)}" aria-label="${host.escapeHtml(option.label)}" ${option.value === value ? "checked" : ""}>`)
        .join("")}</div>`;
    }
    if (type === "checkboxes") {
      control = `<div data-editor-field="${host.escapeHtml(name)}" class="grid gap-2">${checkboxOptions(name, options, checked)}</div>`;
    }
    if (type === "color") {
      control = `<input class="h-10 w-full cursor-pointer rounded-lg border border-base-300 bg-base-100" type="color" name="${host.escapeHtml(name)}" value="${host.escapeHtml(value || "#4f46e5")}">`;
    }
    if (type === "file") {
      control = `<input class="file-input file-input-bordered w-full" type="file" accept="image/*" name="${host.escapeHtml(name)}">`;
    }
    return `<label class="form-control grid gap-1.5"><span class="label-text text-sm font-semibold">${host.escapeHtml(label)}</span>${control}${hint === undefined
      ? ""
      : `<span data-hint="${host.escapeHtml(name)}" class="text-xs text-base-content/55">${host.escapeHtml(hint)}</span>`}</label>`;
  }

  function renderNewItem(): void {
    host.setHeader("New work item", host.activeBoard?.name ?? host.currentTeam()?.name);
    const stage = host.activeProcess?.stages.find(({ id }) => id === host.newItemStageId);
    host.swap(`<form class="grid max-w-3xl gap-4" data-new-item>
        <label class="form-control">
          <span class="label-text mb-1">Title</span>
          <input class="input input-bordered" name="title" autofocus>
        </label>
        <label class="form-control">
          <span class="label-text mb-1">Description</span>
          <textarea class="textarea textarea-bordered min-h-40" name="description"></textarea>
        </label>
        <label class="form-control">
          <span class="label-text mb-1">Owner</span>
          <input class="input input-bordered" name="owner">
        </label>
        <div class="form-control">
          <span class="label-text mb-1">Files</span>
          ${filePickerHtml(host.newItemSources)}
        </div>
        <div class="flex items-center gap-2">
          <button class="btn btn-primary" type="submit">Create item</button>
          <button class="btn btn-ghost" type="button" data-action="cancel-new-item">Cancel</button>
          ${stage ? `<span class="text-sm text-base-content/50">Lands in ${host.escapeHtml(stage.name)}</span>` : ""}
        </div>
      </form>`);
  }

  function filePickerHtml(sources: FileSource[]): string {
    if (!sources.length) {
      return `<p class="rounded-box border border-dashed border-base-300 px-3 py-5 text-sm text-base-content/50">No folder is mapped on this machine. Set a team folder or map a linked location in Team settings → Folder.</p>`;
    }
    return `<div class="max-h-96 overflow-y-auto rounded-box border border-base-300 p-2">${sources
      .map(({ id, name, files }) => `<details>
          <summary class="cursor-pointer py-1 text-sm font-semibold">${host.escapeHtml(name)}${files.length ? "" : " — empty or unreadable"}</summary>
          <ul class="border-l border-base-300 pl-4">${fileTreeHtml(fileTree(files), id, "")}</ul>
        </details>`)
      .join("")}</div>`;
  }

  /**
   * Folders are `<details>` so the tree collapses without a line of script, and a folder's box is
   * a select-all for what is under it — only files are references, so only files carry a value.
   */
  function fileTreeHtml(node: FileTreeNode, locationId: string, prefix: string): string {
    const folders = [...node.folders]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => `<li><details>
          <summary class="cursor-pointer py-1 text-sm">
            <input class="checkbox checkbox-xs mr-2 align-middle" type="checkbox" data-folder-check>${host.escapeHtml(name)}/
          </summary>
          <ul class="border-l border-base-300 pl-4">${fileTreeHtml(child, locationId, `${prefix}${name}/`)}</ul>
        </details></li>`);
    const files = node.files.sort().map((name) => {
      const path = `${prefix}${name}`;
      const value = locationId ? logicalFileReference(locationId, path) : path;
      return `<li><label class="flex cursor-pointer items-center gap-2 py-1 text-sm">
          <input class="checkbox checkbox-xs" type="checkbox" name="files" value="${host.escapeHtml(value)}">${host.escapeHtml(name)}
        </label></li>`;
    });
    return [...folders, ...files].join("");
  }

  function fileReferenceHint(locations: FileLocation[]): string {
    const names = locations.map(({ name }) => `@${name}/path/to/file`).join(", ");
    return names
      ? `Primary workspace: path/to/file. Linked locations: ${names}.`
      : "Paths are relative to the primary team workspace. Add linked locations in Team settings → Folder.";
  }

  function displayFileReferences(references: string[], locations: FileLocation[]): string[] {
    return references.map((value) => {
      const reference = parseLogicalFileReference(value);
      if (!reference.locationId)
        return reference.path;
      const location = locations.find(({ id }) => id === reference.locationId);
      return location
        ? `@${location.name}/${reference.path}`
        : `@unavailable-${reference.locationId.slice(0, 8)}/${reference.path}`;
    });
  }

  function processStateBadge(processId: string): string {
    const process = host.processes.find(({ id }) => id === processId);
    if (process && processModule(process.tags)?.mode === "studio") {
      return '<span class="badge badge-primary badge-sm">Studio</span>';
    }
    return host.runningProcesses.has(processId)
      ? '<span class="badge badge-success badge-sm">Running</span>'
      : '<span class="badge badge-ghost badge-sm">Stopped</span>';
  }

  function processStatusButton(processId: string): string {
    const process = host.processes.find(({ id }) => id === processId);
    // ponytail: studio processes have no process-level run, so the footer shows nothing here.
    // The board header carries the explanation, where people look for Run.
    if (process && processModule(process.tags)?.mode === "studio")
      return "";
    const running = host.runningProcesses.has(processId);
    return actionIconButton(running ? "stop-process" : "start-process", running ? "Running. Click to stop." : "Stopped. Click to run.", running ? ACTION_ICONS.active : ACTION_ICONS.inactive, processId, running ? "btn-ghost text-success" : "btn-ghost text-warning");
  }

  function processRunButtons(processId: string, size: string): string {
    const process = host.processes.find(({ id }) => id === processId);
    if (process && processModule(process.tags)?.mode === "studio") {
      return `<button class="btn btn-ghost ${size}" disabled>Run from Project Studio</button>`;
    }
    const running = host.runningProcesses.has(processId);
    return `<button class="btn btn-primary ${size}" data-action="start-process" data-id="${processId}"${running ? " disabled" : ""}>Run</button><button class="btn btn-ghost ${size} text-error" data-action="stop-process" data-id="${processId}"${running ? "" : " disabled"}>Stop</button>`;
  }

  function assistantActionsHtml(actions: ResolvedAction[], index: number, applied: boolean): string {
    const cards = actions
      .map((entry) => {
        const titles = entry.items.slice(0, 5).map(({ title }) => host.escapeHtml(title));
        const more = entry.items.length > titles.length ? `, +${entry.items.length - titles.length} more` : "";
        return `<li class="border-t border-base-300 px-3 py-2 first:border-t-0">
          <p class="text-sm ${entry.error ? "text-base-content/50 line-through" : ""}">${host.escapeHtml(entry.summary)}</p>
          ${entry.error ? `<p class="mt-1 text-xs text-error">${host.escapeHtml(entry.error)}</p>` : ""}
          ${titles.length ? `<p class="mt-1 text-xs text-base-content/55">${titles.join(", ")}${more}</p>` : ""}
        </li>`;
      })
      .join("");
    const ready = applicable(actions).length;
    return `<div class="mt-2 overflow-hidden rounded-box border border-base-300">
      <ul>${cards}</ul>
      <div class="border-t border-base-300 bg-base-200/60 px-3 py-2">${applied
        ? '<span class="text-xs font-semibold text-success">Applied</span>'
        : ready
          ? `<button class="btn btn-primary btn-xs" data-assistant="apply" data-index="${index}">Apply ${ready} change${ready === 1 ? "" : "s"}</button>`
          : '<span class="text-xs text-base-content/50">Nothing here can be applied.</span>'}</div>
    </div>`;
  }

  function assistantModelHtml(): string {
    const current = host.escapeHtml(modelLabel(host.assistantModel, host.assistantCatalog));
    if (!host.assistantPickerOpen) {
      return `<button type="button" class="btn btn-ghost btn-xs max-w-full justify-start font-normal" data-assistant="picker">
        <span class="truncate text-base-content/60">Model: ${current}</span>
      </button>`;
    }
    const groups = [...new Set(host.assistantCatalog.map(({ group }) => group))];
    const rows = groups
      .map((group) => {
        const entries = host.assistantCatalog.map((option, index) => ({ option, index }))
          .filter(({ option }) => option.group === group)
          .map(({ option, index }) => `<li>
              <button type="button" class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-base-200" data-assistant="pick" data-index="${index}">
                <span class="w-3">${sameChoice(option.choice, host.assistantModel) ? "●" : ""}</span>
                <span class="flex-1 truncate">${host.escapeHtml(option.label)}</span>
                ${option.note ? `<span class="text-[10px] text-base-content/45">${host.escapeHtml(option.note)}</span>` : ""}
              </button>
            </li>`)
          .join("");
        return `<li class="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-base-content/40">${host.escapeHtml(group)}</li>${entries}`;
      })
      .join("");
    return `<div class="rounded-box border border-base-300 bg-base-100 shadow-lg">
      <ul class="max-h-64 overflow-y-auto">${rows || '<li class="px-3 py-2 text-sm text-base-content/50">No models available.</li>'}</ul>
      <div class="border-t border-base-300 p-2">
        <button type="button" class="btn btn-ghost btn-xs w-full justify-start font-normal" data-assistant="add-model">+ Add a model id…</button>
      </div>
    </div>`;
  }

  function renderAssistant(): void {
    host.assistantPanel.classList.toggle("translate-x-full", !host.assistantOpen);
    host.assistantPanel.setAttribute("aria-hidden", host.assistantOpen ? "false" : "true");
    host.assistantPanel.inert = !host.assistantOpen;
    host.assistantSend.disabled = host.assistantBusy;
    host.assistantSend.textContent = host.assistantBusy ? "Working…" : "Send";
    host.assistantModelSlot.innerHTML = assistantModelHtml();
    host.assistantLog.innerHTML = host.assistantLogEntries.length
      ? host.assistantLogEntries.map((entry, index) => {
        const mine = entry.role === "you";
        return `<div class="${mine ? "text-right" : ""}">
              <div class="inline-block max-w-full rounded-box px-3 py-2 text-left text-sm ${mine ? "bg-primary/10" : "bg-base-200"}"><span class="whitespace-pre-wrap">${host.escapeHtml(entry.text)}</span></div>
              ${entry.actions?.length ? assistantActionsHtml(entry.actions, index, entry.applied === true) : ""}
            </div>`;
      })
        .join("")
      : `<p class="px-1 text-sm text-base-content/50">Ask for a process, an agent, or a bulk change. Nothing is written until you approve it.</p>`;
    host.assistantLog.scrollTop = host.assistantLog.scrollHeight;
  }

  return {
    pageWithMenu,
    renderTabs,
    gearIcon,
    renderActiveOrg,
    processNavItem,
    renderSidebarHelp,
    renderNavigation,
    renderPrefsButton,
    searchBox,
    renderWorkItemDetail,
    conversationFor,
    renderRunDetail,
    workItemBadges,
    renderBoard,
    processAgents,
    renderProcessEditor,
    linkProcessModelThinking,
    escalationBanner,
    renderProcessRuns,
    processRunDetail,
    libraryAgentEligibility,
    renderProcessLibrary,
    ACTION_ICONS,
    actionIconButton,
    triggerContext,
    stageName,
    agentRelation,
    localOrgNotice,
    upgradeButton,
    LOCAL_ORG_UPGRADE_HINT,
    CONNECTED_ORG_BETA_COPY,
    teamMembersContent,
    checkedFileLocations,
    fileLocationRows,
    teamFolderContent,
    skillCurationContent,
    teamIntegrationsContent,
    teamBrowserContent,
    teamArchivedContent,
    teamDangerContent,
    renderTeamSettings,
    orgGeneralContent,
    orgMembersContent,
    orgInvitesContent,
    prefsFolderContent,
    orgWorkspaceContent,
    orgKnowledgeContent,
    localModelStatusLabel,
    localModelToggle,
    localModelRow,
    prefsLocalModelsContent,
    cliToolsSection,
    prefsRemoteModelsContent,
    prefsMcpServersContent,
    renderOrgSettings,
    prefsThemeContent,
    prefsSigninsContent,
    prefsOrgsContent,
    prefsCreateOrgContent,
    renderPreferences,
    agentEditorFields,
    checkboxOptions,
    editorFieldHtml,
    renderNewItem,
    filePickerHtml,
    fileTreeHtml,
    fileReferenceHint,
    displayFileReferences,
    processStateBadge,
    processStatusButton,
    processRunButtons,
    assistantActionsHtml,
    assistantModelHtml,
    renderAssistant
  };
}
