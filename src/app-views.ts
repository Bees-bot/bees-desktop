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
  AUTO_MODEL_CHOICE,
  effectiveAgentEligibility,
  isAutoChoice,
  modelLabel,
  preferredModelChoice,
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
  ExecutionOutput,
  FileLocation,
  Process,
  WorkItem
} from "./domain.js";
import {
  activeExecutionForItem,
  errorText,
  fileTree,
  isFiltered,
  itemTree,
  logicalFileReference,
  parseLogicalFileReference,
  processRuns,
  workItemCondition,
  type FileTreeNode,
  type ProcessRun
} from "./domain.js";
import { COMMUNITY_URL, HELP_PAGES } from "./help.js";
import {
  isKnowledgeConnection,
  type KnowledgePolicy
} from "./knowledge.js";
import {
  approvalCard,
  duration,
  runView,
  statusBadge,
  taskPlanOutput,
  when
} from "./launch-views.js";
import { renderMarkdown } from "./markdown.js";
import { PENDING_FILE_PREFIX } from "./workspaces.js";
import {
  modelRef,
  parseModelRef,
  thinkingOptionsForModel,
  type LocalModelView
} from "./local-models.js";
import type { MainHost, OrgTab, PrefsTab, TeamTab, ThemePreset } from "./main.js";
import {
  PROCESS_LIBRARY,
  processEngine,
  type ProcessLibraryEntry
} from "./processes/registry.js";
import {
  registryCapabilities,
  selectedAgentCapabilities
} from "./registries.js";
import type { PlannedTask } from "./processes/goals/index.js";
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

export function createMainViews(host: MainHost) {
  /** A settings page: left sub-menu + right content. `attr` is the data-* used to switch tabs. */
  function pageWithMenu(attr: string, items: {
    id: string;
    label: string;
  }[], active: string, content: string): string {
    return `<div class="grid gap-5 lg:grid-cols-[190px_1fr]">
      <aside class="h-max rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
        <ul class="menu menu-sm gap-0.5">${items
        .map(({ id, label }) => `<li><button class="${host.shell.activeClass(id === active)}" data-${attr}="${id}">${host.shell.escapeHtml(label)}</button></li>`)
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
    host.shell.swap(pageWithMenu(attr, tabs, active, content));
  }

  function gearIcon(cls = "size-5"): string {
    return `<svg viewBox="0 0 24 24" class="${cls}" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M8.94 4.61 10.06 4.24 10.14 1.46h3.72l.08 2.78 1.12.37 1.06.53 2.02-1.9 2.62 2.62-1.9 2.02.53 1.06.37 1.12 2.78.08v3.72l-2.78.08-.37 1.12-.53 1.06 1.9 2.02-2.62 2.62-2.02-1.9-1.06.53-1.12.37-.08 2.78h-3.72l-.08-2.78-1.12-.37-1.06-.53-2.02 1.9-2.62-2.62 1.9-2.02-.53-1.06-.37-1.12-2.78-.08v-3.72l2.78-.08.37-1.12.53-1.06-1.9-2.02 2.62-2.62 2.02 1.9ZM12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z" clip-rule="evenodd"></path></svg>`;
  }

  /** "Active org: <name> — <who>" line under the org row. Text opens preferences; gear opens org settings. */
  function renderActiveOrg(): void {
    const org = host.session.currentOrganization();
    if (!org) {
      host.shell.orgStatus.innerHTML = "";
      return;
    }
    const who = host.session.orgIsConnected(org.id) ? (host.session.currentUser()?.email ?? "connected") : "local";
    host.shell.orgStatus.innerHTML = `<div class="flex items-center gap-1 rounded-lg border border-base-300 bg-base-100 px-2 py-1.5 shadow-sm">
        <button class="min-w-0 flex-1 text-left" data-view="preferences">
          <span class="block text-[10px] font-bold uppercase tracking-widest text-base-content/45">Active org</span>
          <span class="block truncate text-xs font-semibold">${host.shell.escapeHtml(org.name)} — ${host.shell.escapeHtml(who)}</span>
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
  /**
   * One nav row per top-level task, not per workflow: the workflow's name says nothing about
   * what is being worked on, and a team runs the same workflow many times. Opening a row shows
   * that task's own run of the board — see `boardRootItemId`.
   */
  function taskNavItem(teamId: string, board: Board, process: Process, item: WorkItem, open: number): string {
    const active = host.shell.view === "board" &&
      host.workspaceController.activeBoard?.id === board.id &&
      host.shell.boardRootItemId === item.id;
    const running = host.runs.runningProcesses.has(process.id);
    return `<li>
      <button class="${host.shell.activeClass(active)} gap-2" data-board="${board.id}" data-root="${host.shell.escapeHtml(item.id)}" data-team="${teamId}"
        title="${host.shell.escapeHtml(`${item.title} — ${process.name}`)}">
        <span class="size-1.5 shrink-0 rounded-full ${running ? "bg-success" : "bg-base-content/25"}"></span>
        <span class="truncate">${host.shell.escapeHtml(item.title || "Untitled task")}</span>
        ${open
        ? `<span class="badge badge-ghost badge-xs ml-auto" title="${open} open task${open === 1 ? "" : "s"}">${open}</span>`
        : ""}
      </button>
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
    host.shell.sidebarHelp.innerHTML = `<ul class="menu menu-sm w-full gap-0.5 px-0">
        <li><button class="${host.shell.activeClass(host.shell.view === "getting-started")}" data-view="getting-started">Getting Started</button></li>
        <li class="dropdown dropdown-top w-full">
          <button tabindex="0" class="w-full justify-between" aria-haspopup="menu">
            Help
            <svg viewBox="0 0 24 24" class="size-4 opacity-60" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
          </button>
          <ul tabindex="0" class="dropdown-content menu menu-sm z-50 mb-1 w-64 gap-0.5 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
            ${HELP_PAGES.map(({ label, url }) => `<li><button data-action="open-external" data-url="${host.shell.escapeHtml(url)}">${host.shell.escapeHtml(label)}</button></li>`).join("")}
          </ul>
        </li>
        <li><button data-action="open-external" data-url="${host.shell.escapeHtml(COMMUNITY_URL)}">Join Community</button></li>
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
    for (const key of host.session.connections) {
      const { orgId, userId } = host.session.connParts(key);
      const org = host.workspaceController.organizations.find(({ id }) => id === orgId);
      if (!org)
        continue;
      icons.push({ orgId, userId, name: org.name, email: host.session.accounts.get(userId)?.user.email ?? "" });
    }
    for (const org of host.workspaceController.organizations) {
      if (!host.session.orgIsConnected(org.id))
        icons.push({ orgId: org.id, userId: "", name: org.name, email: "local" });
    }
    icons.sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
    host.shell.orgRow.innerHTML =
      icons
        .map(({ orgId, userId, name, email }) => {
          const active = orgId === host.workspaceController.workspace.organizationId && userId === host.session.activeUserId;
          const branding = host.session.brandingFor(orgId);
          const ring = active ? "ring-2 ring-primary ring-offset-1 ring-offset-base-100" : "";
          const inner = branding.logo
            ? `<img src="${host.shell.escapeHtml(branding.logo)}" alt="" class="size-full object-cover">`
            : `<span class="grid size-full place-items-center text-[11px] font-semibold text-white" style="background:${host.shell.escapeHtml(branding.color || host.session.defaultOrgColor(name))}">${host.shell.escapeHtml(name.slice(0, 1).toUpperCase())}</span>`;
          const label = `${name} — ${email}`;
          return `<button class="btn btn-xs btn-square overflow-hidden p-0 ${ring}" data-action="switch-org" data-id="${orgId}" data-account="${host.shell.escapeHtml(userId)}" title="${host.shell.escapeHtml(label)}" aria-label="${host.shell.escapeHtml(label)}">${inner}</button>`;
        })
        .join("") +
      `<button class="btn btn-xs btn-square btn-ghost tooltip tooltip-bottom border border-dashed border-base-300" data-action="new-organization" data-tip="Add organization" aria-label="Add organization">+</button>`;
    renderActiveOrg();
    // No active org (e.g. all deleted): teams need an org to belong to, so show nothing here.
    if (!host.workspaceController.workspace.organizationId) {
      host.shell.teamNav.innerHTML = "";
      renderPrefsButton();
      return;
    }
    // Only the active team has execution/agent state loaded, so only its row can show a live count.
    const inboxCount = [...host.runs.supervise().values()].filter(needsAttention).length;
    host.shell.teamNav.innerHTML = `<ul class="menu menu-sm mb-4 gap-0.5 px-0">
        <li><button class="${host.shell.activeClass(host.shell.view === "overview")}" data-view="overview">Overview</button></li>
      </ul>
      <div class="mb-2 flex items-center justify-between px-2">
        <span class="text-[11px] font-bold uppercase tracking-widest text-base-content/45">Teams</span>
        <button class="btn btn-circle btn-ghost btn-xs" data-action="new-team" aria-label="Add team">+</button>
      </div>
      ${host.workspaceController.teams.length
        ? host.workspaceController.teams.map((team) => {
          const selected = team.id === host.workspaceController.workspace.teamId;
          const teamActions = `opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100`;
          return `<section class="group mb-3">
                  <div class="flex items-center">
                    <button class="btn btn-ghost btn-sm min-w-0 flex-1 justify-start gap-2 px-2 ${selected ? "font-bold" : ""}"
                      data-team-view="overview" data-team="${team.id}">
                      <span class="grid size-6 place-items-center rounded-md bg-primary/10 text-xs font-bold text-primary">${host.shell.escapeHtml(team.name.slice(0, 1).toUpperCase())}</span>
                      <span class="truncate">${host.shell.escapeHtml(team.name)}</span>
                    </button>
                    <div class="flex items-center pr-1 ${selected && host.shell.view === "settings" ? "" : teamActions}">
                      <button class="btn btn-square btn-ghost btn-xs" data-action="browse-process-library" data-team="${team.id}" aria-label="Workflows" title="Workflows">${ACTION_ICONS.workflows}</button>
                      <button class="btn btn-square btn-ghost btn-xs" data-action="new-task" data-team="${team.id}" aria-label="New task" title="New task">${ACTION_ICONS.add}</button>
                      <button class="btn btn-square btn-ghost btn-xs ${selected && host.shell.view === "settings" ? "btn-active" : ""}" data-team-view="settings" data-team="${team.id}" aria-label="Team settings" title="Team settings">
                        ${gearIcon()}
                      </button>
                    </div>
                  </div>
                  <ul class="menu menu-sm ml-3.5 gap-0.5 border-l border-base-300 py-0 pl-1 pr-0">
                    <li><button class="${host.shell.activeClass(selected && host.shell.view === "inbox")}" data-team-view="inbox" data-team="${team.id}">Inbox${selected && inboxCount
        ? ` <span class="badge badge-warning badge-xs ml-auto">${inboxCount}</span>`
        : ""}</button></li>
                    ${(host.workspaceController.dashboardsByTeam.get(team.id) ?? [])
              .flatMap(({ board, process, roots }) => roots.map(({ item, open }) => taskNavItem(team.id, board, process, item, open)))
              .join("")}
                    ${(host.workspaceController.dashboardsByTeam.get(team.id) ?? []).some(({ roots }) => roots.length)
              ? ""
              : `<li><p class="px-2 py-1 text-xs text-base-content/45">No tasks yet — use + above.</p></li>`}
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
    prefs.classList.toggle("btn-active", host.shell.view === "preferences");
    prefs.querySelector(".invite-badge")?.remove();
    if (!host.session.pendingInvitations.length)
      return;
    prefs.title = `Preferences — ${host.session.pendingInvitations.length} pending invitation${host.session.pendingInvitations.length === 1 ? "" : "s"}`;
    prefs.insertAdjacentHTML("beforeend", `<span class="invite-badge badge badge-warning badge-xs absolute -right-1 -top-1">${host.session.pendingInvitations.length}</span>`);
  }

  /**
   * Search runs on submit rather than on every keystroke: the results replace the view, and a
   * box that re-rendered itself under the cursor would lose focus on every letter.
   */
  function searchBox(): string {
    return `<form class="mb-4 flex gap-2" data-run-search>
      <input class="input input-bordered flex-1" name="query" type="search" autocomplete="off"
        placeholder="Search work items and settled runs" value="${host.shell.escapeHtml(host.shell.searchQuery)}" />
      <button class="btn btn-primary" type="submit">Search</button>
      ${host.shell.searchQuery.trim() ? `<button class="btn btn-ghost border border-base-300" type="button" data-action="clear-search">Clear</button>` : ""}
    </form>`;
  }

  /**
   * The `item` view exists only for processes with their own renderer (e.g. the software-project
   * studio). Every other item opens as an expanded card on its board.
   */
  async function renderWorkItemDetail(): Promise<void> {
    const item = host.workspaceController.teamItems.find(({ id }) => id === host.shell.activeItemId);
    const process = item ? host.workspaceController.processes.find(({ id }) => id === item.processId) : null;
    const renderer = process
      ? host.workspaceController.processRenderers.find(
          (candidate) => candidate.id === processEngine.renderer(process)
        )
      : null;
    if (!item || !process || !renderer) {
      host.shell.view = "board";
      void renderBoard();
      return;
    }
    host.shell.setHeader(item.title, host.session.currentTeam()?.name);
    const runs = host.runs.executions.filter(({ workItemId }) => workItemId === item.id);
    const banner = escalationBanner(host.runs.supervise().get(item.id) ?? null);
    const content = await renderer.render(item, process, runs);
    if (host.shell.view !== "item" || host.shell.activeItemId !== item.id)
      return;
    host.shell.swap(`${banner}${content}`);
  }

  /**
   * Live runs are canonical in the runtime; a settled run reads the snapshot stored on its
   * receipt, which is why reopening one never needs the sidecar.
   */
  function conversationFor(execution: Execution): BeesConversationSnapshotV1 | null {
    const live = host.runs.liveEvents.get(execution.id);
    return live?.length ? conversationToSnapshotV1(live) : execution.conversationSnapshot;
  }

  async function renderRunDetail(): Promise<void> {
    const execution = host.runs.executions.find(({ id }) => id === host.shell.activeExecutionId) ??
      (host.shell.activeExecutionId ? await host.repository.getExecution(host.shell.activeExecutionId) : null);
    if (!execution) {
      host.shell.view = "runs";
      host.shell.render();
      return;
    }
    host.shell.setHeader("Run", host.workspaceController.teamItems.find(({ id }) => id === execution.workItemId)?.title);
    const banner = escalationBanner(host.runs.supervise().get(execution.workItemId) ?? null);
    host.shell.swap(banner + runView({
      execution,
      item: host.workspaceController.teamItems.find(({ id }) => id === execution.workItemId) ?? null,
      outputs: host.runs.executionOutputs.filter(({ executionId }) => executionId === execution.id),
      snapshot: conversationFor(execution),
      previews: host.runs.outputPreviews,
      remoteConnections: (execution.config.mcpConnectionRefs ?? []).map((id) => {
        const connection = host.workspaceController.mcpConnections.find((candidate) => candidate.id === id);
        return connection ? `${connection.name}${connection.lastError ? " (offline)" : ""}` : "Unavailable connection";
      })
    }));
  }

  function workItemBadges(item: WorkItem): string {
    const execution = activeExecutionForItem(item.id, host.runs.executions);
    const agent = execution
      ? host.workspaceController.agents.find(({ id }) => id === execution.agentId)
      : host.runs.agentForItem(item);
    const run = execution?.status === "running"
      ? "Running"
      : execution?.status === "queued"
        ? "Queued"
        : "Idle";
    // Owner/agent are context, not state — render them as quiet meta text and only badge a
    // run that is actually doing something; "Idle" on every card is noise.
    const runBadge = run === "Idle"
      ? ""
      : `<span class="badge ${run === "Running" ? "badge-success" : "badge-warning"} badge-sm">${run}</span>`;
    return `<span class="min-w-0 truncate text-xs text-base-content/55">${host.shell.escapeHtml(item.owner || "Unassigned")} · ${host.shell.escapeHtml(agent?.name || (execution ? "Unknown agent" : "No agent"))}</span>
      ${runBadge}`;
  }

  /** The Details tab: every field the item edit dialog offers, read-only or as an inline form. */
  async function boardItemDetails(item: WorkItem, runs: Execution[]): Promise<string> {
    const locations = await host.repository.listAvailableFileLocations(host.workspaceController.workspace.teamId);
    const files = displayFileReferences(item.logicalFiles, locations);
    if (host.shell.boardItemEditing) {
      return `<form data-board-item-form class="grid gap-3" data-id="${item.id}">
        <label class="form-control grid gap-1.5"><span class="label-text text-sm font-semibold">Title</span>
          <input class="input input-bordered w-full" name="title" value="${host.shell.escapeHtml(item.title)}" required></label>
        <label class="form-control grid gap-1.5"><span class="label-text text-sm font-semibold">Description</span>
          <textarea class="textarea textarea-bordered min-h-28 w-full" name="description">${host.shell.escapeHtml(item.description)}</textarea></label>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="form-control grid gap-1.5"><span class="label-text text-sm font-semibold">Owner</span>
            <input class="input input-bordered w-full" name="owner" value="${host.shell.escapeHtml(item.owner ?? "")}"></label>
          <label class="form-control grid gap-1.5"><span class="label-text text-sm font-semibold">Visibility</span>
            <select class="select select-bordered w-full" name="archived">
              <option value="active" ${item.archivedAt ? "" : "selected"}>Active</option>
              <option value="archived" ${item.archivedAt ? "selected" : ""}>Archived</option>
            </select></label>
        </div>
        <label class="form-control grid gap-1.5"><span class="label-text text-sm font-semibold">File references</span>
          <input class="input input-bordered w-full" name="files" value="${host.shell.escapeHtml(files.join(", "))}">
          <span class="text-xs text-base-content/55">${host.shell.escapeHtml(fileReferenceHint(locations))}</span></label>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn btn-ghost btn-sm" data-action="toggle-board-item-edit">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Save</button>
        </div>
      </form>`;
    }
    return `<dl class="grid gap-3 text-sm">
        <div><dt class="text-base-content/45">Description</dt><dd class="whitespace-pre-wrap leading-relaxed">${host.shell.escapeHtml(item.description || "No description.")}</dd></div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div><dt class="text-base-content/45">Status</dt><dd>${host.shell.escapeHtml(workItemCondition(item, runs))}</dd></div>
          <div><dt class="text-base-content/45">Owner</dt><dd>${host.shell.escapeHtml(item.owner || "Unassigned")}</dd></div>
          <div><dt class="text-base-content/45">Last checkpoint</dt><dd>${when(item.checkpointAt)}</dd></div>
          <div><dt class="text-base-content/45">Updated</dt><dd>${when(item.updatedAt)}</dd></div>
        </div>
        <div><dt class="text-base-content/45">Files</dt><dd>${host.shell.escapeHtml(files.join(", ") || "None")}</dd></div>
      </dl>`;
  }

  /** Last thing the agent said in a run — the summary a reviewer needs before approving. */
  function lastAssistantSummary(run: Execution): string {
    const snapshot = conversationFor(run);
    for (const message of [...(snapshot?.messages ?? [])].reverse()) {
      if (message.role !== "assistant")
        continue;
      const text = message.parts
        .flatMap((part) => (part.kind === "text" ? [part.text] : []))
        .join("\n")
        .trim();
      if (text)
        return text;
    }
    return "";
  }

  /**
   * One proposed task of a plan, inline: its own Approve button beside the title, every dialog
   * field editable in place. Field names match the approval dialog so both submit the same shape.
   * An already-approved task renders as a settled row — it exists as a work item now.
   */
  function planTaskCard(item: WorkItem, task: PlannedTask, index: number, approved: boolean, proposed: PlannedTask[] = []): string {
    if (approved) {
      return `<article class="rounded-box border border-success/30 bg-success/5 p-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="badge badge-ghost badge-sm shrink-0">${index + 1}</span>
          <span class="min-w-0 flex-1 truncate text-sm font-semibold">${host.shell.escapeHtml(task.title)}</span>
          <span class="badge badge-success badge-sm shrink-0">Approved</span>
        </div>
      </article>`;
    }
    const roles = host.runs.taskWorkerRoles();
    return `<article class="rounded-box border border-base-300 bg-base-100 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="badge badge-ghost badge-sm shrink-0">${index + 1}</span>
        <input class="input input-bordered input-sm min-w-0 flex-1 basis-56 font-semibold" name="task-${index}-title" value="${host.shell.escapeHtml(task.title)}">
        <button class="btn btn-success btn-xs shrink-0" type="submit" name="approveTask" value="${index}">Approve</button>
      </div>
      <div class="mt-2 grid gap-2">
        <textarea class="textarea textarea-bordered min-h-20 w-full text-xs leading-relaxed" name="task-${index}-description">${host.shell.escapeHtml(task.description)}</textarea>
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="form-control grid gap-1"><span class="label-text text-xs text-base-content/55">Worker role</span>
            <select class="select select-bordered select-sm w-full" name="task-${index}-role">
              ${roles.map(({ role }) => `<option value="${host.shell.escapeHtml(role)}" ${role === task.role ? "selected" : ""}>${host.shell.escapeHtml(role)}</option>`).join("")}
            </select></label>
          <label class="form-control grid gap-1"><span class="label-text text-xs text-base-content/55">Effect</span>
            <select class="select select-bordered select-sm w-full" name="task-${index}-effect">
              ${[["read", "Read only"], ["prepare", "Prepare outputs"], ["external_write", "External action"]]
                .map(([value, label]) => `<option value="${value}" ${value === task.effect ? "selected" : ""}>${label}</option>`).join("")}
            </select></label>
        </div>
        ${item.logicalFiles.length
          ? `<div><span class="label-text text-xs text-base-content/55">Approved inputs</span>
              <div class="mt-1 flex flex-wrap gap-3">${item.logicalFiles
                .map((path) => `<label class="label cursor-pointer gap-1.5 p-0"><input class="checkbox checkbox-xs" type="checkbox" name="task-${index}-inputs" value="${host.shell.escapeHtml(path)}" ${task.inputs.includes(path) ? "checked" : ""}><span class="text-xs">${host.shell.escapeHtml(path)}</span></label>`)
                .join("")}</div>
            </div>`
          : ""}
        ${task.inputs.some((input) => !item.logicalFiles.includes(input))
          ? `<div><span class="label-text text-xs text-warning">Needs approval first</span>
              <div class="mt-1 flex flex-wrap gap-3">${task.inputs
                .filter((input) => !item.logicalFiles.includes(input))
                .map((input) => {
                  const producer = proposed.findIndex((other) => other !== task && other.key === input);
                  const from = producer !== -1 ? ` (from task ${producer + 1})` : "";
                  return `<label class="label cursor-pointer gap-1.5 p-0"><input class="checkbox checkbox-xs checkbox-warning" type="checkbox" name="task-${index}-inputs" value="${host.shell.escapeHtml(input)}" checked><span class="text-xs text-warning">${host.shell.escapeHtml(input)}${from}</span></label>`;
                })
                .join("")}</div>
              <p class="mt-1 text-xs text-base-content/60">These files come from other tasks or runs that are not approved yet. Approve the task or file that produces them first — use the per-task Approve buttons in order — or untick to run without them.</p>
            </div>`
          : ""}
      </div>
    </article>`;
  }

  /** The whole proposed plan as one inline form: Approve All on top, one card per task with
   *  its own Approve button. The plan settles once nothing is left pending. */
  function taskPlanApprovalForm(item: WorkItem, output: ExecutionOutput, proposed: PlannedTask[], busy: boolean, blocked = false, blockingTasks: string[] = []): string {
    const approved = new Set(host.workspaceController.teamItems
      .filter(({ processId, goal }) => processId === item.processId && goal?.key)
      .map(({ goal }) => goal!.key));
    const remaining = proposed.filter(({ key }) => !approved.has(key)).length;
    return `<form data-approval-plan-form data-output="${output.id}" class="rounded-box border border-warning/40 bg-warning/5 p-4">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div class="text-xs font-bold uppercase tracking-wide text-warning">Task plan approval required${remaining < proposed.length ? ` · ${proposed.length - remaining}/${proposed.length} approved` : ""}</div>
        <div class="flex gap-2">
          <button class="btn btn-success btn-sm" type="submit" name="approveAll" value="1" data-id="${output.id}" ${busy || blocked || blockingTasks.length ? "disabled" : ""}>Approve all</button>
          <button class="btn btn-error btn-outline btn-sm" type="button" data-action="reject-output" data-id="${output.id}" ${busy ? "disabled" : ""}>Reject rest</button>
        </div>
      </div>
      ${blocked
        ? `<p class="mb-3 text-xs font-semibold text-warning">Approve or reject this run's file outputs first — the plan's tasks may depend on them.</p>`
        : ""}
      ${blockingTasks.length
        ? `<p class="mb-3 text-xs font-semibold text-warning">Blocked: these subtasks have files waiting for your review — open each one and approve or reject its files first: ${blockingTasks.map((title) => `"${host.shell.escapeHtml(title)}"`).join(", ")}.</p>`
        : ""}
      <p class="mb-3 text-xs text-base-content/60">Approve tasks one at a time — adjust a task's details first if needed — or approve all remaining at once. Rejecting discards the tasks not yet approved.</p>
      <fieldset class="contents" ${blocked || blockingTasks.length ? "disabled" : ""}>
        <div class="grid gap-2">${proposed.map((task, index) => planTaskCard(item, task, index, approved.has(task.key), proposed)).join("")}</div>
      </fieldset>
    </form>`;
  }

  /** The Approval tab: only what needs a decision — the agent's summary, the proposed plan
   *  spelled out with per-task approve toggles, and approve/reject per pending file. */
  async function boardItemApprovals(item: WorkItem, runs: Execution[]): Promise<string> {
    const pending = runs
      .map((run) => ({
        run,
        outputs: host.runs.executionOutputs.filter(({ executionId, status }) => executionId === run.id && status === "pending")
      }))
      .filter(({ outputs }) => outputs.length);
    // Each subtask's files are reviewed on the subtask's own item; the parent only reports
    // which subtasks still block its plan.
    const blockingChildren = host.workspaceController.teamItems
      .filter(({ parentId }) => parentId === item.id)
      .filter((child) => host.runs.executionOutputs.some(({ executionId, status }) => status === "pending" &&
        host.runs.executions.some(({ id, workItemId }) => id === executionId && workItemId === child.id)));
    if (!pending.length)
      return `<p class="text-sm text-base-content/55">Nothing is waiting for approval on this item.</p>`;
    const mapping = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
    const sections: string[] = [];
    for (const { run, outputs } of pending) {
      const summary = lastAssistantSummary(run);
      const busy = ["queued", "running"].includes(run.status);
      const cards: string[] = [];
      for (const output of outputs) {
        if (mapping && host.runs.taskPlanController.matchesOutput(output.logicalOutput, run)) {
          const proposed = await host.runs.taskPlanController
            .readTaskPlan(output, run, mapping.localPath)
            .catch(() => null);
          if (proposed) {
            cards.push(taskPlanApprovalForm(item, output, proposed, busy, outputs.length > 1, blockingChildren.map(({ title }) => title)));
            continue;
          }
        }
        cards.push(approvalCard(output, busy, taskPlanOutput(run)));
      }
      sections.push(`<section class="grid gap-3">
        <div class="flex flex-wrap items-center gap-2 text-sm text-base-content/55">
          ${statusBadge(run.status)}<span>${when(run.startedAt ?? run.createdAt)}</span>
        </div>
        ${summary
          ? `<article class="markdown-viewer rounded-box border border-base-300 bg-base-200/40 p-4 text-sm">${renderMarkdown(summary)}</article>`
          : ""}
        ${cards.join("")}
      </section>`);
    }
    return `<div class="grid gap-4">${sections.join("")}</div>`;
  }

  /** One `<details>` per run, mirroring `workItemView` — the most recent run first, open only
   *  when it is waiting on a person. */
  function boardItemConversation(item: WorkItem, runs: Execution[]): string {
    if (!runs.length)
      return `<p class="text-sm text-base-content/55">This item has not run yet.</p>`;
    const ordered = [...runs].sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt));
    return `<div class="grid gap-3">${ordered
      .map((run) => {
        const outputs = host.runs.executionOutputs.filter(({ executionId }) => executionId === run.id);
        const pending = outputs.some(({ status }) => status === "pending");
        return `<details class="rounded-box border border-base-300 bg-base-100" ${pending ? "open" : ""}>
            <summary class="flex cursor-pointer flex-wrap items-center gap-2 p-4 font-semibold">
              ${statusBadge(run.status)}
              <span class="text-sm font-normal text-base-content/55">${when(run.startedAt ?? run.createdAt)}</span>
              ${pending ? `<span class="badge badge-warning badge-sm">Needs you</span>` : ""}
            </summary>
            <div class="border-t border-base-300 p-4">${runView({
              execution: run,
              item,
              outputs,
              snapshot: conversationFor(run),
              previews: host.runs.outputPreviews
            })}</div>
          </details>`;
      })
      .join("")}</div>`;
  }

  /** File chips plus, once one is picked, its content — rendered as Markdown for `.md`/`.mdx`
   *  files and toggled into a plain-text editor that saves back to disk. Published team-folder
   *  files and still-pending run outputs both appear: a pending output is badged, reads from its
   *  run workspace, and edits save back there until approval publishes it to the team folder.
   *  A published file a pending output will overwrite is hidden while that output is pending —
   *  showing both invites editing the copy approval is about to replace. */
  async function boardItemFiles(item: WorkItem): Promise<string> {
    const runs = host.runs.executions.filter(({ workItemId }) => workItemId === item.id);
    const pending = host.runs.executionOutputs.filter(
      ({ executionId, status }) => status === "pending" && runs.some(({ id }) => id === executionId)
    );
    if (!item.logicalFiles.length && !pending.length)
      return `<p class="text-sm text-base-content/55">No files referenced.</p>`;
    const superseded = new Set(pending.map(({ logicalDestination }) => logicalDestination));
    const visibleFiles = item.logicalFiles.filter((value) => {
      try {
        const reference = parseLogicalFileReference(value);
        return reference.locationId !== null || !superseded.has(reference.path);
      } catch {
        return true;
      }
    });
    const locations = await host.repository.listAvailableFileLocations(host.workspaceController.workspace.teamId);
    const labels = displayFileReferences(visibleFiles, locations);
    const references = [...visibleFiles, ...pending.map(({ id }) => `${PENDING_FILE_PREFIX}${id}`)];
    const selected = references.includes(host.shell.boardFileRef) ? host.shell.boardFileRef : "";
    const chip = (reference: string, label: string, badge: string): string =>
      `<button class="btn btn-xs ${reference === selected ? "btn-primary" : "btn-ghost border border-base-300"}" data-action="select-board-file" data-ref="${host.shell.escapeHtml(reference)}">${host.shell.escapeHtml(label)}${badge}</button>`;
    const list = `<div class="mb-4 flex flex-wrap gap-2">${[
      ...visibleFiles.map((reference, index) => chip(reference, labels[index] ?? reference, "")),
      ...pending.map((output) =>
        chip(`${PENDING_FILE_PREFIX}${output.id}`, output.logicalDestination, ` <span class="badge badge-warning badge-xs">awaiting approval</span>`))
    ].join("")}</div>`;
    if (!selected)
      return `${list}<p class="text-sm text-base-content/55">Select a file to preview it.</p>`;
    const pendingOutput = pending.find(({ id }) => `${PENDING_FILE_PREFIX}${id}` === selected);
    const fileName = pendingOutput?.logicalOutput ?? selected;
    const label = pendingOutput?.logicalDestination ?? labels[visibleFiles.indexOf(selected)] ?? selected;
    let content: string | null = null;
    try {
      const teamRoot = await host.workspaceController.requireTeamRoot();
      if (pendingOutput) {
        const workspaceRef = runs.find(({ id }) => id === pendingOutput.executionId)?.workspaceRef;
        if (!workspaceRef)
          return `${list}<div class="alert alert-error text-sm">The run workspace holding this output is no longer available.</div>`;
        content = await host.workspaces.readOutput(workspaceRef, pendingOutput.logicalOutput, teamRoot);
      }
      else {
        content = await host.workspaces.readLogicalFile(selected, teamRoot, locations);
      }
    }
    catch (error) {
      return `${list}<div class="alert alert-error text-sm">${host.shell.escapeHtml(errorText(error))}</div>`;
    }
    if (content === null)
      return `${list}<p class="text-sm text-base-content/55">${host.shell.escapeHtml(label)} does not exist yet.</p>`;
    const note = `<p class="mb-2 font-mono text-xs text-base-content/70">${host.shell.escapeHtml(label)}</p>${pendingOutput
      ? `<p class="mb-2 text-sm text-base-content/55">Awaiting approval — approve it in the Approval tab to publish it to the team folder.</p>`
      : ""}`;
    if (host.shell.boardFileEditing) {
      const markdown = /\.mdx?$/i.test(fileName);
      const preview = markdown
        ? renderMarkdown(content)
        : `<pre class="whitespace-pre-wrap break-words text-xs">${host.shell.escapeHtml(content)}</pre>`;
      return `${list}${note}<form data-board-file-form class="grid gap-3" ${markdown ? "data-markdown" : ""}>
          <input type="hidden" name="reference" value="${host.shell.escapeHtml(selected)}">
          <div class="grid grid-cols-2 gap-3">
            <textarea name="contents" class="textarea textarea-bordered h-[60vh] w-full font-mono text-xs" spellcheck="false">${host.shell.escapeHtml(content)}</textarea>
            <article data-board-file-preview class="markdown-viewer h-[60vh] overflow-auto rounded-box border border-base-300 bg-base-200/40 p-4 text-sm">${preview}</article>
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" class="btn btn-ghost btn-sm" data-action="toggle-board-file-edit">Cancel</button>
            <button type="submit" class="btn btn-primary btn-sm">Save</button>
          </div>
        </form>`;
    }
    return `${list}${note}<article class="markdown-viewer rounded-box border border-base-300 bg-base-200/40 p-4 text-sm">${/\.mdx?$/i.test(fileName)
        ? renderMarkdown(content)
        : `<pre class="whitespace-pre-wrap break-words text-xs">${host.shell.escapeHtml(content)}</pre>`}</article>`;
  }

  /** A card's detail, expanded in place under the board — Details / Approval / Conversation /
   *  Files tabs, so opening an item never navigates away from the board it lives on. */
  async function renderBoardItemPanel(item: WorkItem, process: Process): Promise<string> {
    const tab = host.shell.boardTab;
    const stage = process.stages.find(({ id }) => id === item.stageId);
    const runs = host.runs.executions.filter(({ workItemId }) => workItemId === item.id);
    const pendingCount = host.runs.executionOutputs
      .filter(({ executionId, status }) => status === "pending" && runs.some(({ id }) => id === executionId)).length;
    const tabButton = (id: typeof tab, label: string): string =>
      `<button role="tab" class="tab ${tab === id ? "tab-active" : ""}" data-board-tab="${id}">${label}</button>`;
    const body = tab === "conversation"
      ? boardItemConversation(item, runs)
      : tab === "files"
        ? await boardItemFiles(item)
        : tab === "approval"
          ? await boardItemApprovals(item, runs)
          : await boardItemDetails(item, runs);
    return `<div data-scroll-anchor class="mt-2 rounded-box border border-primary/30 bg-base-100 p-5 shadow-sm">
      ${escalationBanner(host.runs.supervise().get(item.id) ?? null)}
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="mb-1 text-[11px] font-medium uppercase tracking-[.06em] text-base-content/50">${host.shell.escapeHtml(stage?.name ?? "")}</p>
          <h3 class="text-lg font-semibold tracking-[-.01em]">${host.shell.escapeHtml(item.title)}</h3>
        </div>
        <div class="flex items-center gap-2">
          ${tab === "approval" || tab === "conversation"
            ? ""
            : `<button class="btn btn-ghost btn-sm"
                data-action="${tab === "files" ? "toggle-board-file-edit" : "toggle-board-item-edit"}"
                ${tab === "files" && !host.shell.boardFileRef ? "disabled" : ""}>Edit</button>`}
        </div>
      </div>
      <div role="tablist" class="tabs tabs-boxed mb-4 w-fit">
        ${tabButton("details", "Details")}
        ${tabButton("approval", `Approval${pendingCount ? ` <span class="badge badge-warning badge-xs">${pendingCount}</span>` : ""}`)}
        ${tabButton("conversation", `Conversation${runs.length ? ` (${runs.length})` : ""}`)}
        ${tabButton("files", `Files (${item.logicalFiles.length + pendingCount})`)}
      </div>
      ${body}
    </div>`;
  }

  async function renderBoard(): Promise<void> {
    // The board is scoped to one top-level task when the nav opened it that way, so the header
    // names that task rather than the workflow it happens to run on.
    const root = host.shell.boardRootItemId
      ? host.workspaceController.items.find(({ id }) => id === host.shell.boardRootItemId) ?? null
      : null;
    host.shell.setHeader(root?.title ?? host.workspaceController.activeBoard?.name ?? "Work", host.workspaceController.activeProcess ? `${host.session.currentTeam()?.name} / ${host.workspaceController.activeProcess.name}` : undefined);
    if (!host.workspaceController.activeBoard || !host.workspaceController.activeProcess) {
      host.shell.swap(`<div class="hero min-h-80 rounded-box border border-dashed border-base-300 bg-base-100">
        <div class="hero-content text-center"><div class="max-w-md">
          <div class="mb-3 text-4xl">▦</div>
          <h2 class="text-xl font-bold">Add your first workflow</h2>
          <p class="py-3 text-sm text-base-content/60">Each workflow gets its own dashboard, with its statuses as columns.</p>
          <button class="btn btn-primary" data-action="browse-process-library" data-team="${host.workspaceController.workspace.teamId}">Browse workflows</button>
        </div></div>
      </div>`);
      return;
    }
    const stages = host.workspaceController.activeProcess.stages.filter(({ id }) => host.workspaceController.activeBoard?.stageIds.includes(id));
    const interactive = processEngine.isInteractive(host.workspaceController.activeProcess);
    const running = interactive || host.runs.runningProcesses.has(host.workspaceController.activeProcess.id);
    const filters = host.workspaceController.activeBoard.filters;
    const waiting = host.runs.supervise();
    const scoped = root
      ? itemTree(host.workspaceController.items, root.id)
      : host.workspaceController.items;
    const visible = scoped.filter((item) => !isFiltered(item, filters));
    const filtered = scoped.filter((item) => isFiltered(item, filters))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const expandedItemId = host.shell.boardItemId;
    // Looked up in all items, not just visible cards: the Inbox opens filtered/stuck items too.
    const expandedItem = host.workspaceController.items.find(({ id }) => id === expandedItemId) ?? null;
    const panel = expandedItem ? await renderBoardItemPanel(expandedItem, host.workspaceController.activeProcess) : "";
    if (host.shell.view !== "board" || host.shell.boardItemId !== expandedItemId)
      return;
    host.shell.swap(`<div class="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-3 text-sm text-base-content/55">
          <span class="eyebrow-pill"><span class="status status-primary"></span> ${host.shell.escapeHtml(host.workspaceController.activeProcess.name)}</span>
          ${root
        ? `<button class="badge badge-primary badge-outline gap-1" data-board="${host.workspaceController.activeBoard.id}" title="Show every run of this workflow">${host.shell.escapeHtml(root.title)} ✕</button>`
        : ""}
          ${processStateBadge(host.workspaceController.activeProcess.id)}
          <span class="badge badge-ghost">${stages.length} status${stages.length === 1 ? "" : "es"}</span>
          <span>${host.workspaceController.openWork(visible).length} item${host.workspaceController.openWork(visible).length === 1 ? "" : "s"}</span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          ${processRunButtons(host.workspaceController.activeProcess.id, "btn-sm")}
          ${
          // These used to hang off the workflow's left-nav row, which tasks replaced.
          [
            ["open-process-runs", "Past runs", ACTION_ICONS.history],
            ["open-process-schedules", "Schedules", ACTION_ICONS.schedule],
            ["edit-process", "Edit workflow", ACTION_ICONS.edit]
          ].map(([action, label, icon]) => actionIconButton(action!, label!, icon!, host.workspaceController.activeProcess!.id, "btn-ghost border border-base-300", "tooltip-bottom")).join("")}
          <button class="btn btn-ghost btn-sm border border-base-300" data-action="edit-board" data-id="${host.workspaceController.activeBoard.id}">Dashboard settings</button>
        </div>
      </div>
      ${running
        ? ""
        : '<div class="alert alert-warning mb-5 py-2 text-sm">This process is stopped — its agents will not pick up work until you press Run.</div>'}
      <div class="kanban">${stages
        .map((stage) => {
          const cards = visible.filter(({ stageId }) => stageId === stage.id);
          return `<section class="kanban-column p-3">
            <header class="flex items-center justify-between px-1 pb-3 pt-1">
              <div class="flex items-center gap-2">
                <span class="status ${stage.isTerminal ? "status-success" : "status-primary"}"></span>
                <h2 class="text-[13px] font-semibold">${host.shell.escapeHtml(stage.name)}</h2>
              </div>
              <span class="badge badge-ghost badge-sm border-0">${cards.length}</span>
            </header>
            <div class="grid gap-3">${cards
              .map((item) => `<article class="kanban-card card cursor-pointer border ${item.id === expandedItemId ? "border-primary ring-1 ring-primary" : "border-base-300"}" data-action="toggle-board-item" data-id="${item.id}">
                  <div class="card-body gap-3 p-4">
                    <div>
                      <h3 class="card-title text-sm font-semibold leading-snug">${host.shell.escapeHtml(item.title)}</h3>
                      <p class="mt-1 line-clamp-3 text-xs leading-relaxed text-base-content/60">${host.shell.escapeHtml(item.description || "No description")}</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      ${workItemBadges(item)}
                      ${item.parentId ? '<span class="badge badge-outline badge-sm">Subtask</span>' : ""}
                      ${host.workspaceController.teamItems.some(({ parentId }) => parentId === item.id)
                  ? `<span class="badge badge-outline badge-sm">${host.workspaceController.teamItems.filter(({ parentId }) => parentId === item.id).length} tasks</span>`
                  : ""}
                      ${item.waits.some(({ resolvedAt }) => !resolvedAt) ? '<span class="badge badge-warning badge-sm">Waiting</span>' : ""}
                      ${
                // Silence is the normal look of stuck work, so the card always says which
                // of the four states this item is in. The badge carries the heading only —
                // a badge does not wrap, and a runtime error is long.
                needsAttention(waiting.get(item.id) ?? null)
                  ? `<span class="badge badge-sm ${waiting.get(item.id)!.kind === "stalled" ? "badge-error" : "badge-warning"}">${host.shell.escapeHtml(waiting.get(item.id)!.label)}</span>`
                  : ""}
                      ${item.logicalFiles.length ? `<span class="badge badge-outline badge-sm">${item.logicalFiles.length} file${item.logicalFiles.length === 1 ? "" : "s"}</span>` : ""}
                    </div>
                    ${needsAttention(waiting.get(item.id) ?? null)
                  ? `<p class="line-clamp-2 break-words text-xs leading-relaxed ${waiting.get(item.id)!.kind === "stalled" ? "text-error" : "text-base-content/60"}">${host.shell.escapeHtml(waiting.get(item.id)!.detail)}</p>`
                  : ""}
                  </div>
                </article>`)
              .join("")}
              <button class="btn btn-ghost btn-sm border border-dashed border-base-300" data-action="new-item-in-stage" data-stage="${stage.id}">+ Add item</button>
            </div>
          </section>`;
        })
        .join("")}</div>
      ${panel}
      ${filtered.length
        ? `<details class="collapse-arrow mt-5 rounded-box border border-base-300 bg-base-100">
              <summary class="cursor-pointer px-4 py-3 text-sm font-semibold">Filtered items (${filtered.length})</summary>
              <ul class="divide-y divide-base-300 border-t border-base-300">${filtered
          .map((item) => `<li class="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span class="min-w-0">
                      <span class="font-semibold">${host.shell.escapeHtml(item.title)}</span>
                      <span class="ml-2 badge badge-ghost badge-sm">${host.shell.escapeHtml(workItemCondition(item))}</span>
                      <span class="ml-2 text-xs text-base-content/55">${host.shell.escapeHtml(new Date(item.updatedAt).toLocaleString())}</span>
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
    return host.workspaceController.agents.filter(({ triggerStageId }) => triggerStageId && order.has(triggerStageId))
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
    const process = host.workspaceController.processes.find(({ id }) => id === host.shell.configProcessId) ?? null;
    host.shell.setHeader(process ? process.name : "New process", host.session.currentTeam()?.name);
    const definition = `<form class="min-w-0 rounded-box border border-base-300 bg-base-100 p-5 shadow-sm" data-process-form>
      <div class="flex flex-wrap items-end gap-3">
        <label class="form-control grid min-w-0 flex-1 basis-56 gap-1.5"><span class="label-text text-sm font-semibold">Name</span>
          <input class="input input-bordered w-full" name="name" value="${host.shell.escapeHtml(process?.name ?? "")}"
            placeholder="Support triage" required></label>
        <label class="form-control grid min-w-0 flex-[2] basis-72 gap-1.5"><span class="label-text text-sm font-semibold">Description</span>
          <input class="input input-bordered w-full" name="description" value="${host.shell.escapeHtml(process?.description ?? "")}"></label>
        <div class="ml-auto flex shrink-0 items-center gap-2">
          ${process
        ? `${processStatusButton(process.id)}${actionIconButton("archive-process", `Archive ${process.name}`, ACTION_ICONS.archive, process.id, "btn-ghost text-error")}`
        : ""}
          <button class="btn btn-primary" type="submit">${process ? "Save process" : "Create process"}</button>
        </div>
      </div>
      <label class="form-control mt-4 grid min-w-0 gap-1.5"><span class="label-text text-sm font-semibold">Ordered statuses</span>
        <input class="input input-bordered w-full" name="stages" value="${host.shell.escapeHtml(process ? process.stages.map(({ name, isTerminal }) => `${name}${isTerminal ? " *" : ""}`).join(", ") : "To do, In progress, Done *")}" required>
        <p class="mt-1 text-xs text-base-content/50">Add * after every terminal status.</p>
        <span class="text-xs text-base-content/55">Comma separated, in order. A removed status needs its work items moved first.</span></label>
    </form>`;
    if (!process) {
      host.shell.swap(`<div class="grid gap-4">${definition}
        <p class="text-sm text-base-content/55">Saving creates the process, its board, and the agent lanes below.</p>
      </div>`);
      return;
    }
    const own = processAgents(process);
    const unassigned = host.workspaceController.agents.filter(({ triggerStageId }) => !triggerStageId);
    const selectable = [...own, ...unassigned];
    if (!selectable.some(({ id }) => id === host.shell.configAgentId))
      host.shell.configAgentId = selectable[0]?.id ?? "";
    const allowsSeveralAgents = process.stages.some((stage) =>
      processEngine.allowsMultipleAgents(process, stage.id)
    );
    const card = (agent: Agent): string => {
      const eligibility = host.workspaceController.eligibilityForAgent(agent);
      const model = isAutoChoice(agent.config)
        ? `Auto · ${modelRef(eligibility.model)}`
        : agent.config.provider && agent.config.model
          ? `${agent.config.provider} · ${agent.config.model}`
          : "No model";
      return `<div class="grid gap-2 rounded-box border p-3 ${agent.id === host.shell.configAgentId ? "border-primary bg-primary/5" : "border-base-300 bg-base-100"}" data-agent-row="${host.shell.escapeHtml(agent.id)}">
        <div class="flex items-start justify-between gap-1">
          <button class="link link-hover text-left text-sm font-semibold" type="button"
            data-action="select-process-agent" data-id="${host.shell.escapeHtml(agent.id)}">${host.shell.escapeHtml(agent.name || "Untitled agent")}</button>
          <span class="flex">
            ${actionIconButton("duplicate-agent", `Duplicate ${agent.name}`, ACTION_ICONS.duplicate, agent.id)}
            ${actionIconButton("delete-agent", `Delete ${agent.name}`, ACTION_ICONS.delete, agent.id, "btn-ghost text-error")}
          </span>
        </div>
        <p class="truncate text-xs text-base-content/55" title="${host.shell.escapeHtml(model)}">${host.shell.escapeHtml(model)}</p>
        <div class="flex items-center justify-between gap-1">
          <label class="label cursor-pointer gap-1.5 text-xs" title="Active on this machine">
            <input class="checkbox checkbox-xs" type="checkbox" name="${host.shell.escapeHtml(agent.id)}:enabled" ${host.runs.disabledAgentIds.has(agent.id) ? "" : "checked"}><span>On</span>
          </label>
          ${eligibility.active
          ? ""
          : `<span class="badge badge-error badge-xs" title="${host.shell.escapeHtml(eligibility.reason)}">Needs attention</span>`}
        </div>
      </div>`;
    };
    const lane = (title: string, cards: string, addStageId?: string, note = ""): string => `<div class="flex w-64 shrink-0 flex-col gap-2 rounded-box bg-base-200/50 p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="truncate text-xs font-semibold uppercase tracking-wide text-base-content/60">${host.shell.escapeHtml(title)}</span>
          ${addStageId === undefined
        ? ""
        : `<button class="btn btn-ghost btn-xs" type="button" data-action="add-process-agent" data-stage="${host.shell.escapeHtml(addStageId)}">+ Agent</button>`}
        </div>
        ${cards || `<p class="px-1 py-2 text-xs text-base-content/45">${host.shell.escapeHtml(note)}</p>`}
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
        return `<section class="grid min-w-0 gap-3 p-5" data-agent-pane="${host.shell.escapeHtml(agent.id)}" ${agent.id === host.shell.configAgentId ? "" : "hidden"}>
          <h3 class="font-bold">${host.shell.escapeHtml(agent.name || "Untitled agent")}</h3>
          ${sections}
        </section>`;
      })
      .join("");
    host.shell.swap(`<div class="grid min-w-0 gap-4">
      ${definition}
      <form class="min-w-0" data-process-agents>
        <section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 p-4">
            <div><h3 class="font-bold">Agents by status</h3>
              <p class="mt-1 text-sm text-base-content/55">${allowsSeveralAgents
        ? "Statuses with several role bindings may use several agents."
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
    for (const button of host.shell.app.querySelectorAll<HTMLButtonElement>("form button:not([type])")) {
      button.type = "button";
    }
    for (const select of host.shell.app.querySelectorAll<HTMLSelectElement>('select[name$=":model"]')) {
      const agentId = select.name.slice(0, -":model".length);
      select.addEventListener("change", () => {
        const thinking = host.shell.app.querySelector<HTMLSelectElement>(`select[name="${agentId}:thinkingLevel"]`);
        if (!thinking)
          return;
        thinking.innerHTML = thinkingOptionsForModel(parseModelRef(select.value) ?? {})
          .map(({ label, value }) => `<option value="${host.shell.escapeHtml(value)}">${host.shell.escapeHtml(label)}</option>`)
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
        <div class="font-semibold">${host.shell.escapeHtml(state!.label)}</div>
        <div class="break-words text-sm">${host.shell.escapeHtml(state!.detail)}</div>
      </div>
    </div>`;
  }

  /** Rows of past runs on the left, the selected run's lanes, sequence, and logs on the right. */
  function renderProcessRuns(): void {
    const process = host.workspaceController.processes.find(({ id }) => id === host.shell.configProcessId);
    if (!process) {
      host.shell.view = "board";
      void renderBoard();
      return;
    }
    host.shell.setHeader(`${process.name} — past runs`, host.session.currentTeam()?.name);
    const runs = processRuns(host.workspaceController.teamItems.filter(({ processId }) => processId === process.id), host.runs.executions);
    if (!runs.some(({ item }) => item.id === host.shell.openRunItemId))
      host.shell.openRunItemId = runs[0]?.item.id ?? "";
    const open = runs.find(({ item }) => item.id === host.shell.openRunItemId) ?? null;
    const list = runs
      .map(({ item, steps, startedAt }) => {
        const last = steps.at(-1);
        return `<li><button class="${host.shell.activeClass(item.id === host.shell.openRunItemId)} block h-auto py-2 text-left"
          data-action="open-process-run" data-id="${host.shell.escapeHtml(item.id)}">
          <span class="block truncate text-sm font-semibold">${host.shell.escapeHtml(item.title)}</span>
          <span class="mt-1 flex flex-wrap items-center gap-1 text-xs text-base-content/55">
            ${when(startedAt)} · ${steps.length} step${steps.length === 1 ? "" : "s"} ${last ? statusBadge(last.status) : '<span class="badge badge-ghost badge-sm">Not started</span>'}
          </span>
        </button></li>`;
      })
      .join("");
    host.shell.swap(`<div class="grid gap-4 lg:grid-cols-[18rem_1fr]">
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
      const agent = host.workspaceController.agents.find(({ id }) => id === execution.agentId);
      const outputs = host.runs.executionOutputs.filter(({ executionId }) => executionId === execution.id);
      const logs = execution.logs.trim().slice(-4000);
      return `<details class="rounded-box border border-base-300 bg-base-100 p-3">
        <summary class="cursor-pointer">
          <span class="text-sm font-semibold">${host.shell.escapeHtml(agent?.name ?? "Removed agent")}</span>
          <span class="ml-2">${statusBadge(execution.status)}</span>
          <span class="mt-1 block text-xs text-base-content/55">${when(execution.startedAt ?? execution.createdAt)} · ${duration(execution)}</span>
        </summary>
        <div class="mt-3 grid gap-3 text-xs">
          ${execution.error
          ? `<div><div class="font-bold uppercase text-error">Error</div><pre class="mt-1 whitespace-pre-wrap break-words font-sans">${host.shell.escapeHtml(execution.error)}</pre></div>`
          : ""}
          <div><div class="font-bold uppercase text-base-content/45">Logs</div>
            <pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans">${host.shell.escapeHtml(logs) || "No logs recorded."}</pre></div>
          <div><div class="font-bold uppercase text-base-content/45">Files</div>
            ${outputs.length
          ? `<ul class="mt-1 grid gap-1">${outputs
            .map((output) => `<li>${host.shell.escapeHtml(output.logicalOutput)} → ${host.shell.escapeHtml(output.logicalDestination)} ${statusBadge(output.status)}</li>`)
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
        const own = steps.filter((execution) => host.runs.runStageId(execution) === stage.id);
        for (const execution of own)
          placed.add(execution.id);
        return `<div class="flex w-64 shrink-0 flex-col gap-2 rounded-box bg-base-200/50 p-3">
          <span class="truncate text-xs font-semibold uppercase tracking-wide text-base-content/60">${host.shell.escapeHtml(stage.name)}${item.stageId === stage.id ? " · now here" : ""}</span>
          ${own.map(stepCard).join("") ||
          '<p class="px-1 py-2 text-xs text-base-content/45">Nothing ran here.</p>'}
        </div>`;
      })
      .join("");
    const orphans = steps.filter(({ id }) => !placed.has(id));
    const sequence = steps
      .map((execution, index) => {
        const stage = process.stages.find(({ id }) => id === host.runs.runStageId(execution));
        return `${index ? '<span class="text-base-content/30">→</span>' : ""}<span class="badge badge-ghost badge-sm whitespace-nowrap">${host.shell.escapeHtml(stage?.name ?? "No status")} · ${when(execution.startedAt ?? execution.createdAt).split(", ").at(-1) ?? ""}</span>`;
      })
      .join("");
    return `<article class="rounded-box border border-base-300 bg-base-100 shadow-sm">
        <header class="border-b border-base-300 p-4">
          <h3 class="font-bold">${host.shell.escapeHtml(item.title)}</h3>
          <p class="mt-1 text-sm text-base-content/55">${steps.length ? "Started" : "Created"} ${when(run.startedAt)} · now on ${host.shell.escapeHtml(process.stages.find(({ id }) => id === item.stageId)?.name ?? "an archived status")}</p>
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
    }, host.assistant.assistantModel, true, host.assistant.machineModelAvailability, host.assistant.assistantCatalog);
  }

  /** One row per workflow this team already has — the only place to reach its editor by name. */
  function teamWorkflowRow(process: Process): string {
    const board = host.workspaceController.boards.find(({ processId }) => processId === process.id);
    const statuses = process.stages.map(({ name }) => name).join(" → ");
    const agents = host.workspaceController.agents.filter(({ triggerStageId }) =>
      process.stages.some(({ id }) => id === triggerStageId)).length;
    return `<article class="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 px-5 py-4 first:border-t-0">
      <div class="min-w-0">
        <h3 class="font-semibold">${host.shell.escapeHtml(process.name)}</h3>
        <p class="mt-0.5 truncate text-sm text-base-content/55">${host.shell.escapeHtml(statuses)}</p>
        <p class="mt-0.5 text-xs text-base-content/45">${agents} agent${agents === 1 ? "" : "s"}${process.definition.moduleId ? " · Bundled" : ""}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        ${board ? `<button class="btn btn-ghost btn-sm border border-base-300" data-board="${board.id}">Open board</button>` : ""}
        <button class="btn btn-ghost btn-sm border border-base-300 text-error" data-action="archive-process" data-confirm="1" data-id="${host.shell.escapeHtml(process.id)}">Delete</button>
        <button class="btn btn-primary btn-sm" data-action="edit-process" data-id="${host.shell.escapeHtml(process.id)}">Edit</button>
      </div>
    </article>`;
  }

  function renderProcessLibrary(): void {
    host.shell.setHeader("Workflows", host.session.currentTeam()?.name);
    host.shell.swap(`<section class="mb-5 rounded-box border border-base-300 bg-base-100 shadow-sm">
      <header class="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 p-5">
        <div>
          <button class="link link-primary mb-2 text-sm" data-action="close-process-library">← Back to the board</button>
          <h2 class="font-bold">In this team</h2>
          <p class="mt-1 text-sm text-base-content/55">Edit a workflow's statuses and agents, or delete one you no longer run.</p>
        </div>
        <button class="btn btn-primary btn-sm" data-action="new-process">Create workflow</button>
      </header>
      ${host.workspaceController.processes.length
      ? host.workspaceController.processes.map(teamWorkflowRow).join("")
      : `<p class="p-5 text-sm text-base-content/50">No workflows yet — add one below, or create your own.</p>`}
    </section>
    <section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
      <header class="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 p-5">
        <div>
          <h2 class="font-bold">Bundled</h2>
          <p class="mt-1 text-sm text-base-content/55">Curated workflows bundled with Bees Desktop and available offline. Add one as-is, or take a copy you can change — copies land in this team above.</p>
        </div>
      </header>
      <div class="grid gap-4 p-5 lg:grid-cols-2">${PROCESS_LIBRARY.map((entry) => {
      const installed = host.workspaceController.processes.some(({ name }) => name.toLowerCase() === entry.name.toLowerCase());
      const unavailable = entry.agents.filter((agent) => !libraryAgentEligibility(agent).active).length;
      const models = [...new Set(entry.agents.map((agent) => isAutoChoice(agent) ? "Auto" : `${agent.provider}/${agent.model}`))];
      return `<article class="card border border-base-300 bg-base-100">
          <div class="card-body gap-4 p-5">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div><h3 class="card-title text-base">${host.shell.escapeHtml(entry.name)}</h3>
                <p class="mt-1 text-sm text-base-content/60">${host.shell.escapeHtml(entry.description)}</p></div>
              <span class="badge badge-outline badge-sm">Bundled</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <span class="badge badge-ghost badge-sm">${entry.states.length} statuses</span>
              <span class="badge badge-ghost badge-sm">${entry.agents.length} agents</span>
              ${models.map((model) => `<span class="badge badge-ghost badge-sm">${host.shell.escapeHtml(model)}</span>`).join("")}
            </div>
            ${unavailable
          ? `<p class="text-xs text-warning">${unavailable} configured agent model${unavailable === 1 ? " is" : "s are"} unavailable on this computer. You can change them after adding.</p>`
          : `<p class="text-xs text-success">All configured agent models are available on this computer.</p>`}
            <div class="card-actions justify-end">
              <button class="btn btn-ghost btn-sm border border-base-300" data-action="copy-library-process" data-template="${host.shell.escapeHtml(entry.id)}">Create a copy</button>
              <button class="btn btn-primary btn-sm" data-action="add-library-process" data-template="${host.shell.escapeHtml(entry.id)}" ${installed ? "disabled" : ""}>${installed ? "Added to team" : "Add to team"}</button>
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
    // A flow of connected stages, not a shelf of books: this opens the workflows, not a library.
    workflows: '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="5" rx="1.2"></rect><rect x="14" y="3" width="7" height="5" rx="1.2"></rect><rect x="8.5" y="16" width="7" height="5" rx="1.2"></rect><path d="M6.5 8v3.5h11V8M12 11.5V16"></path></svg>'
  } as const;

  function actionIconButton(action: string, label: string, icon: string, id?: string, classes = "btn-ghost", tooltip = "tooltip-left"): string {
    const escapedLabel = host.shell.escapeHtml(label);
    return `<button class="btn btn-square btn-sm ${classes} tooltip ${tooltip}" data-action="${action}"${id ? ` data-id="${host.shell.escapeHtml(id)}"` : ""} data-tip="${escapedLabel}" title="${escapedLabel}" aria-label="${escapedLabel}">${icon}</button>`;
  }

  /** Process and status for an id across the team. Null when it no longer exists. */
  function triggerContext(stageId: string | null): {
    process: Process;
    stageName: string;
  } | null {
    if (!stageId)
      return null;
    for (const process of host.workspaceController.processes) {
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
    return `<div class="rounded-box border border-dashed border-base-300 bg-base-100 p-8 text-center text-sm text-base-content/55">${host.shell.escapeHtml(message)}${upgradeButton(upgrade, "mt-4")}</div>`;
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
    const token = host.session.orgToken();
    if (!token)
      return localOrgNotice(host.session.orgIsConnected() ? "Sign in to manage team members." : LOCAL_ORG_UPGRADE_HINT, !host.session.orgIsConnected());
    if (!host.session.activeOrgTeamEnabled())
      return localOrgNotice("Team features are off for this organization.");
    const orgId = host.workspaceController.workspace.organizationId;
    const [{ teams: serverTeams }, { plan }] = await Promise.all([
      host.api.listTeams(token, orgId),
      host.api.plan(token)
    ]);
    const trialEndsAt = host.session.activeServerOrg()?.trialEndsAt;
    const trialEnds = trialEndsAt ? new Date(trialEndsAt) : null;
    const memberLists = await Promise.all(serverTeams.map((team) => host.api.listTeamMembers(token, orgId, team.id).then(({ members }) => members)));
    const isAdmin = (members: {
      userId: string;
      role: string;
    }[]): boolean => members.some((member) => member.userId === host.session.currentUser()?.id && member.role === "admin");
    const planSummary = plan.freeDuringBeta
      ? `<div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-base-content/55">
          <span class="badge badge-primary badge-sm">Free during beta</span>
          <span>${host.shell.escapeHtml(CONNECTED_ORG_BETA_COPY)}</span>
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
                    <h3 class="font-bold">${host.shell.escapeHtml(team.name)}</h3>
                    ${admin
                ? `<button class="btn btn-primary btn-xs" data-action="invite-team-member" data-team="${team.id}">Invite</button>`
                : `<span class="badge badge-ghost badge-sm">Member</span>`}
                  </div>
                  <ul class="mt-3 divide-y divide-base-200">
                    ${members
                .map((member) => `<li class="flex items-center justify-between gap-2 py-2 text-sm">
                          <span class="truncate">${host.shell.escapeHtml(member.userId === host.session.currentUser()?.id ? `${host.session.currentUser()?.email} (you)` : member.userId)}</span>
                          <span class="flex items-center gap-2">
                            <span class="badge badge-sm ${member.role === "admin" ? "badge-primary" : "badge-ghost"}">${member.role}</span>
                            ${admin && member.role === "member"
                    ? `<button class="btn btn-ghost btn-xs" data-action="promote-team-member" data-team="${team.id}" data-user="${host.shell.escapeHtml(member.userId)}">Make admin</button>`
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
          <div class="flex items-center gap-2"><span class="font-semibold">${host.shell.escapeHtml(location.name)}</span>
            <span class="badge badge-ghost badge-sm">${location.teamId ? "Team" : "Organization"}</span></div>
          <code class="mt-1 block break-all text-xs text-base-content/60">${host.shell.escapeHtml(location.localPath || "Not mapped on this machine")}</code>
          ${location.missing ? '<p class="mt-1 text-xs font-semibold text-error">Folder is missing or unavailable.</p>' : ""}
        </div>
        <div class="flex gap-2">
          <button class="btn btn-ghost btn-xs" data-action="map-file-location" data-id="${location.id}">${location.localPath ? "Re-map" : "Map folder"}</button>
          ${removable(location) ? `<button class="btn btn-ghost btn-xs text-error" data-action="remove-file-location" data-id="${location.id}" data-name="${host.shell.escapeHtml(location.name)}">Remove</button>` : ""}
        </div>
      </div>`)
      .join("");
  }

  async function teamFolderContent(): Promise<string> {
    let mapping = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
    if (mapping) {
      try {
        await host.workspaces.validateDirectory(mapping.localPath);
        if (mapping.override && mapping.missing)
          await host.repository.markTeamFolderMissing(host.workspaceController.workspace.teamId, false);
        mapping = { ...mapping, missing: false };
      }
      catch {
        if (mapping.override && !mapping.missing)
          await host.repository.markTeamFolderMissing(host.workspaceController.workspace.teamId, true);
        mapping = { ...mapping, missing: true };
      }
    }
    const globalPath = await host.repository.getSetting("global_local_path", "");
    const locations = await checkedFileLocations(await host.repository.listAvailableFileLocations(host.workspaceController.workspace.teamId));
    return `<section class="card border border-base-300 bg-base-100 shadow-sm">
        <div class="card-body">
          <div class="flex items-start justify-between gap-3">
            <div><h2 class="card-title text-base">Primary team workspace</h2>
            <p class="mt-1 text-sm text-base-content/55">The default home for team files and all approved agent outputs.</p></div>
            <span class="badge ${mapping?.override ? "badge-primary" : "badge-ghost"}">${mapping?.override ? "Override" : "Inherited"}</span>
          </div>
          <div class="mt-3 rounded-box bg-base-200 p-4">
            <code class="break-all text-sm">${host.shell.escapeHtml(mapping?.localPath || (globalPath ? "Team folder not found" : "Set a folder first"))}</code>
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
        <div class="grid gap-2">${fileLocationRows(locations, (location) => location.teamId === host.workspaceController.workspace.teamId)}</div>
        <p class="text-xs text-base-content/50">Only the location name, scope, ID, and relative file reference sync. Absolute folder paths stay on this machine.</p>
      </div></section>`;
  }

  /**
   * Skill curation. The list is the pure half — no model runs to produce it, only which skills
   * agents select and which ones runs have reached for. "Tidy skills" is the other half, and like
   * every other proposal in Bees it lands as a preview the user applies.
   */
  function skillCurationContent(): string {
    const unused = host.assistant.skillReviews.filter(({ state }) => state === "unused");
    const proposal = host.assistant.curatorPlan ? `<div class="mt-3 rounded-box border border-warning/40 bg-warning/5 p-3">
          ${host.assistant.curatorPlan.summary ? `<p class="text-sm">${host.shell.escapeHtml(host.assistant.curatorPlan.summary)}</p>` : ""}
          <div class="mt-2 grid gap-2">${host.assistant.curatorPlan.actions
        .map((entry) => `<div class="rounded bg-base-100 p-2 text-sm">
                <div class="${entry.error ? "text-error" : "font-semibold"}">${host.shell.escapeHtml(entry.summary)}</div>
                ${entry.error ? `<div class="text-xs text-error">${host.shell.escapeHtml(entry.error)}</div>` : ""}
              </div>`)
        .join("")}</div>
          <div class="mt-3 flex gap-2">
            <button class="btn btn-success btn-sm" data-action="apply-curator-plan" ${host.assistant.curatorPlan.actions.some(({ error }) => !error) ? "" : "disabled"}>Apply</button>
            <button class="btn btn-ghost btn-sm" data-action="discard-curator-plan">Discard</button>
          </div>
        </div>`
      : "";
    return `<div class="py-4">
      <div class="flex items-center justify-between gap-4">
        <div><h3 class="text-sm font-bold">Skill curation</h3><p class="text-xs text-base-content/55">Bees scores no run, so a skill is judged only by whether anything reaches for it. Retiring one moves its folder to <code>skills/.archive</code>; nothing is deleted and nothing is written until you apply it.</p></div>
        <button class="btn btn-ghost btn-sm border border-base-300" data-action="curate-skills" ${host.assistant.curatorBusy ? "disabled" : ""}>${host.assistant.curatorBusy ? "Reading…" : "Tidy skills"}</button>
      </div>
      <div class="mt-3 grid gap-2">${host.assistant.skillReviews.length
        ? host.assistant.skillReviews.map((review) => `<div class="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-3">
                <div><div class="font-semibold">${host.shell.escapeHtml(review.capability.name)}</div>
                  <div class="text-xs text-base-content/50">${review.useCount ? `used ${review.useCount} time(s)` : "never used"} · ${review.selected ? "selected by an agent" : "selected by no agent"}</div></div>
                ${review.state === "unused"
            ? `<button class="btn btn-ghost btn-xs text-error" data-action="archive-skill" data-slug="${host.shell.escapeHtml(skillSlugOf(review.capability))}" data-name="${host.shell.escapeHtml(review.capability.name)}">Retire</button>`
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
              <div class="mt-3 grid gap-2">${host.workspaceController.registries.length
        ? host.workspaceController.registries.map((registry) => `<div class="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-3">
                          <div><div class="font-semibold">${host.shell.escapeHtml(registry.name)}</div>
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
    const archived = (await host.repository.listProcesses(host.workspaceController.workspace.teamId, true)).filter(({ archivedAt }) => archivedAt);
    return `<section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body">
        <h2 class="card-title text-base">Archived processes</h2>
        <p class="mt-1 text-sm text-base-content/55">Restoring brings back the process, its statuses, and its dashboards.</p>
        <div class="mt-3 grid gap-2">${archived.length
        ? archived
          .map((process) => `<div class="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-3">
                    <div><div class="font-semibold">${host.shell.escapeHtml(process.name)}</div>
                      <div class="text-xs text-base-content/50">Archived ${host.shell.escapeHtml(new Date(process.archivedAt!).toLocaleDateString())} · ${process.stages.length} status(es)</div></div>
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
    host.shell.setHeader("Team settings", host.session.currentTeam()?.name);
    await renderTabs<TeamTab>("team-tab", [
      { id: "members", label: "Members", content: teamMembersContent },
      { id: "folder", label: "Folder", content: teamFolderContent },
      { id: "integrations", label: "Integrations", content: teamIntegrationsContent },
      { id: "browser", label: "Browser", content: teamBrowserContent },
      { id: "archived", label: "Archived processes", content: teamArchivedContent },
      { id: "danger", label: "Danger zone", content: teamDangerContent }
    ], host.shell.teamTab, () => host.shell.view === "settings");
  }

  // ---- Organization settings (tabbed: General / Members / Invites / Folder) ----
  function orgGeneralContent(): string {
    const connected = host.session.orgIsConnected();
    const user = host.session.currentUser();
    const signedIn = host.session.orgSignedIn() && !!user;
    const social = Object.entries(host.session.providerLabel)
      .map(([provider, label]) => `<button class="btn btn-outline btn-sm" data-action="social-signin" data-provider="${provider}">Continue with ${label}</button>`)
      .join("");
    const authBlock = !connected
      ? ""
      : signedIn
        ? `<div class="flex flex-wrap items-center justify-between gap-3">
             <span class="text-sm">Signed in as <strong>${host.shell.escapeHtml(user!.email)}</strong></span>
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
        ? `Server-backed. Users and agents on different machines can coordinate on the same work items here. ${host.shell.escapeHtml(CONNECTED_ORG_BETA_COPY)}`
        : "Bees Desktop is free. Work stays on this machine unless you use a connected organization."}</p>
        ${authBlock}${upgradeButton(!connected)}
      </div></section>
      <section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <h2 class="card-title text-base">Organization name</h2>
        <div class="flex items-center gap-2">
          <code class="flex-1 break-all rounded-box bg-base-200 p-3 text-sm">${host.shell.escapeHtml(host.session.currentOrganization()?.name ?? "")}</code>
          <button class="btn btn-outline btn-sm" data-action="rename-org">Rename</button>
        </div>
      </div></section>
      <section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <div class="flex items-center gap-3">
          ${host.session.orgLogoPreview(host.workspaceController.workspace.organizationId, host.session.currentOrganization()?.name ?? "")}
          <div class="flex-1"><h2 class="card-title text-base">Branding</h2>
            <p class="text-sm text-base-content/55">Logo and color shown in the organization switcher.</p></div>
          ${host.session.brandingFor(host.workspaceController.workspace.organizationId).logo
        ? `<button class="btn btn-ghost btn-sm" data-action="remove-logo">Remove logo</button>`
        : ""}
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="form-control grid gap-1.5"><span class="label-text text-sm font-semibold">Color</span>
            <input class="h-10 w-full cursor-pointer rounded-lg border border-base-300 bg-base-100" type="color"
              data-branding="color" value="${host.shell.escapeHtml(host.session.brandingFor(host.workspaceController.workspace.organizationId).color || "#4f46e5")}"></label>
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
    const token = host.session.orgToken();
    if (!host.session.orgIsConnected())
      return localOrgNotice(LOCAL_ORG_UPGRADE_HINT, true);
    if (!token)
      return localOrgNotice("Sign in to manage organization members.");
    let memberships;
    try {
      ({ memberships } = await host.api.listMemberships(token, host.workspaceController.workspace.organizationId));
    }
    catch {
      return `<div class="p-8 text-center text-sm text-base-content/50">Only organization admins can view members.</div>`;
    }
    return `<section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
        <header class="border-b border-base-300 p-5"><h2 class="font-bold">Members</h2></header>
        <ul class="divide-y divide-base-200 p-2">${memberships
        .map((member) => `<li class="flex items-center gap-2 px-3 py-2 text-sm">
              <span class="flex-1 truncate">${host.shell.escapeHtml(member.userId === host.session.currentUser()?.id
          ? `${member.email ?? host.session.currentUser()?.email} (you)`
          : member.email ?? member.userId)}</span>
              <span class="badge badge-sm ${member.role === "member" ? "badge-ghost" : "badge-primary"}">${host.shell.escapeHtml(member.role)}</span>
              <span class="w-20 text-right">${member.role !== "owner" && member.userId !== host.session.currentUser()?.id
            ? `<button class="btn btn-ghost btn-xs text-error" data-action="remove-org-member" data-user="${host.shell.escapeHtml(member.userId)}" data-email="${host.shell.escapeHtml(member.email ?? member.userId)}">Remove</button>`
            : ""}</span>
            </li>`)
        .join("")}</ul>
      </section>`;
  }

  async function orgInvitesContent(): Promise<string> {
    const connected = host.session.orgIsConnected();
    if (!connected)
      return localOrgNotice(LOCAL_ORG_UPGRADE_HINT, true);
    let pending: {
      email: string;
      role: string;
    }[] = [];
    const token = host.session.orgToken();
    try {
      if (token)
        pending = (await host.api.listOrgInvitations(token, host.workspaceController.workspace.organizationId)).invitations; // 403 for non-admins
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
                <span class="truncate">${host.shell.escapeHtml(invitation.email)}</span>
                <span class="badge badge-ghost badge-sm">${host.shell.escapeHtml(invitation.role)}</span>
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
        <div class="rounded-box bg-base-200 p-4"><code class="break-all text-sm">${host.shell.escapeHtml(globalPath || "No path selected")}</code></div>
        <div class="card-actions justify-end"><button class="btn btn-primary btn-sm" data-action="pick-global-folder">Change path</button></div>
      </div></section>`;
  }

  async function orgWorkspaceContent(): Promise<string> {
    const orgPath = await host.repository.getOrgFolder(host.workspaceController.workspace.organizationId);
    const locations = (await checkedFileLocations(await host.repository.listOrganizationFileLocations(host.workspaceController.workspace.organizationId))).filter(({ teamId }) => !teamId);
    return `<section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <h2 class="card-title text-base">Primary organization folder</h2>
        <p class="text-sm text-base-content/60">This organization's folder. Team folders resolve to <code>&lt;org folder&gt;/&lt;team-name&gt;</code> unless a team overrides it. Change the root under Preferences → Folder.</p>
        <div class="rounded-box bg-base-200 p-4"><code class="break-all text-sm">${host.shell.escapeHtml(orgPath || "Set a folder first")}</code></div>
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
      policy = await host.session.loadKnowledgePolicy();
    }
    catch (error) {
      host.session.knowledgeError = errorText(error);
    }
    const availableSources = host.workspaceController.workspace.teamId
      ? await host.repository.listAvailableFileLocations(host.workspaceController.workspace.teamId)
      : [];
    const sources = policy?.mode === "remote"
      ? availableSources
      : availableSources.filter(({ localPath, missing }) => Boolean(localPath) && !missing);
    const sourceRows = sources.length
      ? sources
        .map((source) => `<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>${host.shell.escapeHtml(source.name)}</span>
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
        : `All bees use one organization-controlled endpoint: <code class="break-all">${host.shell.escapeHtml(policy.url)}</code>`;
    return `<div class="space-y-5">
      <section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
        <div class="flex items-center justify-between gap-3"><h2 class="card-title text-base">Knowledge mode</h2>${active}</div>
        <p class="text-sm text-base-content/60">${detail}</p>
        ${host.session.knowledgeError ? `<p class="text-sm text-error">${host.shell.escapeHtml(host.session.knowledgeError)}</p>` : ""}
        <div class="card-actions justify-end gap-2">
          <button class="btn btn-outline btn-sm" data-action="knowledge-local">Use local</button>
          <button class="btn btn-primary btn-sm" data-action="knowledge-remote">${policy?.mode === "remote" ? "Set this team's token" : "Use remote"}</button>
          ${policy ? '<button class="btn btn-ghost btn-sm text-error" data-action="knowledge-disable">Disable</button>' : ""}
        </div>
        <p class="text-xs text-base-content/50">Indexes rebuild in full once a day. A failed rebuild keeps the previous index. Bees Cloud stores only the mode and remote URL, never files, chunks, embeddings, paths, or credentials.</p>
      </div></section>
      <section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
        <header class="border-b border-base-300 p-5"><h2 class="font-bold">Sources available to ${host.shell.escapeHtml(host.session.currentTeam()?.name ?? "this team")}</h2><p class="mt-1 text-sm text-base-content/55">Organization sources plus this team's sources only. The worker enforces this again from the bearer token.</p></header>
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
    const event = host.assistant.localModelProgress.get(model.id);
    const state = model.runtime.running ? "running" : (event?.state ?? model.runtime.state);
    const downloadedBytes = event?.downloadedBytes ?? model.runtime.downloadedBytes;
    const totalBytes = event?.totalBytes ?? model.runtime.totalBytes;
    const id = host.shell.escapeHtml(model.id);
    // The wanted flag is persisted, so a Run toggled on during a long download stays on across a
    // page reload or an app restart.
    const starting = (host.assistant.localModelStarting.has(model.id) || host.localModels.wantedRunId === model.id) &&
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
      ? `<span class="truncate">${host.shell.escapeHtml(model.localPath)}</span>`
      : `<button class="link" data-action="open-external" data-url="${host.shell.escapeHtml(model.sourceUrl ?? model.url ?? "")}">${host.shell.escapeHtml(model.sourceUrl ? "Hugging Face" : "Download link")}</button>`;
    const license = model.licenseUrl
      ? ` · <button class="link" data-action="open-external" data-url="${host.shell.escapeHtml(model.licenseUrl)}">${host.shell.escapeHtml(model.licenseName ?? "License")}</button>`
      : "";
    return `<tr>
      <td class="max-w-xs">
        <div class="truncate font-semibold">${host.shell.escapeHtml(model.name)}</div>
        <div class="flex gap-1 truncate text-xs text-base-content/55">${source}${license}</div>
      </td>
      <td class="min-w-40">
        <div data-local-model-status="${id}">${host.shell.escapeHtml(status)}</div>
        <progress class="progress progress-primary mt-1 w-full" data-local-model-progress="${id}"
          value="${downloadedBytes}" max="${totalBytes || 1}"></progress>
        <div class="text-xs text-base-content/55">${totalBytes ? host.shell.escapeHtml(host.shell.formatBytes(totalBytes)) : ""}</div>
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
      // The CLI's own login file says which account and plan it would bill; no account in it
      // means it has never been signed in, and a run pointed at it would stop and ask.
      const signIn = `Not signed in — run <code>${host.shell.escapeHtml(tool.id)}</code> in a terminal once`;
      const account = found?.plan
        ? `${host.shell.escapeHtml(found.plan)}${found.account ? ` · ${host.shell.escapeHtml(found.account)}` : ""}`
        : signIn;
      return `<li class="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
        <div class="min-w-0">
          <span class="block truncate font-semibold">${host.shell.escapeHtml(tool.label)}</span>
          <span class="text-xs text-base-content/50">${found
          ? `${account} · agent model <code>${host.shell.escapeHtml(tool.exampleModel)}</code> · <span class="truncate">${host.shell.escapeHtml(found.path)}</span>`
          : `Not installed — <button class="link" data-action="open-external" data-url="${host.shell.escapeHtml(tool.installUrl)}">install it</button>, or point Bees at it below`}</span>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          ${found
          ? `<input type="checkbox" class="toggle toggle-sm" data-action="toggle-cli-tool" data-tool="${host.shell.escapeHtml(tool.id)}" ${found.enabled ? "checked" : ""} aria-label="Use ${host.shell.escapeHtml(tool.label)} for runs">`
          : ""}
          <span class="badge badge-sm ${!found ? "badge-ghost" : found.enabled ? "badge-success" : "badge-ghost"}">${found ? (found.enabled ? (found.custom ? "Chosen" : "Found") : "Off") : "Missing"}</span>
          <button class="btn btn-ghost btn-xs" data-action="pick-cli-tool" data-tool="${host.shell.escapeHtml(tool.id)}">Choose…</button>
          ${found?.custom
          ? `<button class="btn btn-ghost btn-xs" data-action="clear-cli-tool" data-tool="${host.shell.escapeHtml(tool.id)}">Use detected</button>`
          : ""}
          ${found
          ? ""
          : `<button class="btn btn-outline btn-xs" data-action="install-cli-tool" data-tool="${host.shell.escapeHtml(tool.id)}">Install</button>`}
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
    const connections = await listAiConnections(host.repository, host.session.aiConnectionScope());
    const providerButtons = (Object.keys(AI_PROVIDER_LABEL) as AiProvider[])
      .map((provider) => `<button class="btn btn-outline btn-sm" data-action="connect-ai" data-provider="${provider}">
          ${host.shell.escapeHtml(AI_PROVIDER_LABEL[provider])}</button>`)
      .join("");
    const list = connections.length
      ? connections
        .map((connection) => `<li class="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <div class="min-w-0">
                <span class="block truncate font-semibold">${host.shell.escapeHtml(connection.label)}</span>
                <span class="text-xs text-base-content/50">Added ${host.shell.escapeHtml(new Date(connection.createdAt).toLocaleDateString())}${host.session.AI_PROVIDER_MODEL_PREFIX[connection.provider]
            ? ` · agent model <code>${host.shell.escapeHtml(host.session.AI_PROVIDER_MODEL_PREFIX[connection.provider])}&lt;model&gt;</code>`
            : " · not usable by runs yet"}</span>
              </div>
              <button class="btn btn-ghost btn-xs text-error" data-action="remove-ai-connection" data-id="${host.shell.escapeHtml(connection.id)}">Remove</button>
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
    const connections = (await listMcpConnections(host.repository, host.workspaceController.workspace.teamId)).filter((connection) => !isKnowledgeConnection(connection));
    const list = connections.length
      ? connections.map((connection) => `<li class="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
          <div class="min-w-0"><span class="block truncate font-semibold">${host.shell.escapeHtml(connection.name)}</span>
            <span class="text-xs text-base-content/50">${host.shell.escapeHtml(connection.url)} · ${connection.allowedTools.length}/${connection.tools.length} tools allowed · ${connection.optional ? "optional offline" : "required"}</span>
            ${connection.lastError ? `<div class="mt-1 text-xs text-error">${host.shell.escapeHtml(connection.lastError)}</div>` : ""}
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
    host.shell.setHeader("Organization settings", host.session.currentOrganization()?.name);
    await renderTabs<OrgTab>("org-tab", [
      { id: "general", label: "General", content: orgGeneralContent },
      { id: "members", label: "Members", content: orgMembersContent },
      { id: "invites", label: "Invites", content: orgInvitesContent },
      { id: "folder", label: "Folder", content: orgWorkspaceContent },
      { id: "knowledge", label: "Knowledge", content: orgKnowledgeContent }
    ], host.shell.orgTab, () => host.shell.view === "org-settings");
  }

  // ---- Preferences (tabbed: Mode / Theme / Sign-ins / Org invites / Create org) ----
  function prefsThemeContent(): string {
    const themeOptions = (selected: ThemePreset) => host.shell.themePresets.map((preset) => `<option value="${preset.id}" ${preset.id === selected ? "selected" : ""}>${preset.name}</option>`)
      .join("");
    const themeCards = host.shell.themePresets.map((preset) => `<button class="theme-card ${preset.id === host.shell.themePreset ? "selected" : ""}"
          data-action="set-theme-preset" data-theme-preset="${preset.id}"
          data-theme="${preset.id}" aria-pressed="${preset.id === host.shell.themePreset}">
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
            <select class="select w-full" data-theme-default="dark">${themeOptions(host.shell.darkDefaultTheme)}</select>
          </label>
          <label class="form-control gap-1">
            <span class="text-sm font-medium">Default Light Theme</span>
            <select class="select w-full" data-theme-default="light">${themeOptions(host.shell.lightDefaultTheme)}</select>
          </label>
        </div>
        <h3 class="mt-2 font-semibold">All themes</h3>
        <div class="grid gap-3 sm:grid-cols-3">${themeCards}</div>
      </div></section>`;
  }

  async function prefsSigninsContent(): Promise<string> {
    const description = `<p class="text-sm text-base-content/60">You can sign in with multiple user IDs. Each user ID can belong to multiple organizations, and you can work across all of them at the same time.</p>`;
    const sso = Object.entries(host.session.providerLabel)
      .map(([provider, label]) => `<button class="btn btn-outline btn-sm justify-start" data-action="social-signin" data-provider="${provider}">Sign in to another account using ${host.shell.escapeHtml(label)} SSO</button>`)
      .join("");
    const addBlock = `<section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-2">
        <h2 class="card-title text-base">Add a sign-in</h2>
        <div class="flex flex-col gap-2">
          ${sso}
          <button class="btn btn-outline btn-sm justify-start" data-action="signin-email">Sign in using an email</button>
          <button class="btn btn-outline btn-sm justify-start" data-action="signup-email">Create a new account using your email</button>
        </div>
      </div></section>`;
    if (host.session.accounts.size === 0)
      return `<div class="space-y-5">${description}${addBlock}</div>`;
    const label = (provider: string): string => provider === "credential" ? "Email" : (host.session.providerLabel[provider] ?? provider);
    // One row per signed-in account. Every account is always active — no single active one.
    const rows = await Promise.all([...host.session.accounts.values()].map(async ({ user, token }) => {
      const providers = await host.api.listAccounts(token).catch(() => []);
      const how = providers.length ? providers.map((a) => label(a.provider)).join(", ") : "—";
      return `<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span class="flex min-w-0 items-center gap-2">
            <span class="status status-success"></span>
            <span class="truncate font-medium">${host.shell.escapeHtml(user.email)}</span>
            <span class="text-base-content/55">· ${host.shell.escapeHtml(how)}</span>
          </span>
          <button class="btn btn-ghost btn-sm text-error" data-action="sign-out-account" data-id="${host.shell.escapeHtml(user.id)}">Sign out</button>
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
    const perAccount = await Promise.all([...host.session.accounts.values()].map(async (account) => {
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
    const acct = (id: string) => host.shell.escapeHtml(id);
    for (const { account, orgs: orgResult, invites } of perAccount) {
      const email = account.user.email;
      if (!orgResult.ok) {
        rows.push({
          name: "Organizations unavailable",
          account: email,
          button: `<span class="badge badge-error badge-sm">${host.shell.escapeHtml(orgResult.reason)}</span>`
        });
      }
      const orgs = orgResult.ok ? orgResult.value : [];
      for (const org of orgs) {
        const signedIn = host.session.connections.has(host.session.connKey(org.id, account.user.id)); // this exact pair connected
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
    for (const org of host.workspaceController.organizations) {
      if (host.session.orgIsConnected(org.id))
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
                <div class="min-w-0"><strong class="block truncate">${host.shell.escapeHtml(row.name)}</strong>
                  <span class="block text-xs text-base-content/55">${host.shell.escapeHtml(row.account)}</span></div>
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
    host.shell.setHeader("Preferences", host.session.currentUser()?.email ?? "Local");
    await renderTabs<PrefsTab>("prefs-tab", [
      { id: "local-models", label: "Local models", content: prefsLocalModelsContent },
      { id: "remote-models", label: "Remote models", content: prefsRemoteModelsContent },
      { id: "mcp-servers", label: "MCP servers", content: prefsMcpServersContent },
      { id: "signins", label: "Sign-ins", content: prefsSigninsContent },
      { id: "orgs", label: "Orgs", content: prefsOrgsContent },
      { id: "folder", label: "Root Folder", content: prefsFolderContent },
      { id: "theme", label: "Theme", content: prefsThemeContent }
    ], host.shell.prefsTab, () => host.shell.view === "preferences");
  }

  function agentEditorFields(agent?: Agent): EditorField[] {
    const config = agent?.config;
    const auto = !agent || isAutoChoice(config ?? {});
    const selected = config?.provider?.trim() && config.model?.trim()
      ? { provider: config.provider, model: config.model }
      : host.assistant.assistantModel;
    const autoRef = modelRef(AUTO_MODEL_CHOICE);
    const selectedRef = auto ? autoRef : modelRef(selected);
    const catalog = host.assistant.overviewAssistantModels();
    const modelOptions = catalog.map(({ group, label, choice }) => ({
      label: `${group} · ${label}`,
      value: modelRef(choice)
    }));
    // Keep an unavailable or custom model from an existing agent selectable instead of
    // silently rewriting the file on its next save.
    if (!modelOptions.some(({ value }) => value === selectedRef) && selectedRef !== autoRef) {
      modelOptions.unshift({ label: `Configured · ${selectedRef}`, value: selectedRef });
    }
    modelOptions.unshift({
      label: `Auto · ${modelRef(preferredModelChoice(host.assistant.assistantCatalog))}`,
      value: autoRef
    });
    const capabilities = registryCapabilities(host.workspaceController.registries);
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
          ...host.workspaceController.processes.flatMap((process) => process.stages.map((stage) => ({
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
        hint: "Auto picks the best AI installed on the computer running this stage: Codex, then Claude Code, then any other agent CLI, then the largest local model, then the largest remote one.",
        step: "instructions"
      },
      {
        name: "thinkingLevel",
        label: "Thinking",
        type: "select",
        value: config?.thinkingLevel ?? "",
        options: thinkingOptionsForModel(auto ? { provider: "", model: "" } : selected),
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
          description: `${host.workspaceController.registries.find(({ id }) => id === registryId)?.name ?? "Skill folder"} · ${path}`
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
            description: `Trusted local code · ${host.workspaceController.registries.find(({ id }) => id === registryId)?.name ?? "Tool folder"} · ${path}`
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
        options: host.workspaceController.mcpConnections.map((connection) => {
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
        options: host.workspaceController.agents.filter((candidate) => candidate.id !== agent?.id &&
          !(candidate.config.delegateRefs?.length) &&
          !(candidate.config.mcpConnectionRefs?.length) &&
          !selectedAgentCapabilities(host.workspaceController.registries, candidate.config).some(({ kind }) => kind === "tool"))
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
          <input class="peer sr-only" type="checkbox" name="${host.shell.escapeHtml(name)}" value="${host.shell.escapeHtml(option.value)}" ${checked.includes(option.value) ? "checked" : ""}>
          <span class="block rounded-box border border-base-300 p-3 transition hover:bg-base-200 peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:[&_.selection-check]:opacity-100">
            <span class="flex items-center justify-between gap-3"><span class="text-sm font-semibold">${host.shell.escapeHtml(option.label)}</span><span class="selection-check text-primary opacity-0" aria-hidden="true">✓</span></span>
            ${option.description ? `<span class="mt-1 block break-words text-xs leading-relaxed text-base-content/55">${host.shell.escapeHtml(option.description)}</span>` : ""}
          </span>
        </label>`)
      .join("");
  }

  function editorFieldHtml({ name, label, value = "", type = "text", placeholder = "", options = [], checked = [], hint }: EditorField): string {
    if (type === "note")
      return `<p class="text-sm text-base-content/75">${host.shell.escapeHtml(value)}</p>`;
    let control = `<input class="input input-bordered w-full" type="${type === "password" ? "password" : "text"}" name="${host.shell.escapeHtml(name)}" value="${host.shell.escapeHtml(value)}" placeholder="${host.shell.escapeHtml(placeholder)}">`;
    if (type === "textarea") {
      control = `<textarea class="textarea textarea-bordered min-h-24 w-full" name="${host.shell.escapeHtml(name)}" placeholder="${host.shell.escapeHtml(placeholder)}">${host.shell.escapeHtml(value)}</textarea>`;
    }
    if (type === "select") {
      control = `<select class="select select-bordered w-full" name="${host.shell.escapeHtml(name)}">${options
        .map((option) => `<option value="${host.shell.escapeHtml(option.value)}" ${option.value === value ? "selected" : ""}>${host.shell.escapeHtml(option.label)}</option>`)
        .join("")}</select>`;
    }
    if (type === "toggle") {
      control = `<div class="join grid w-full" style="grid-template-columns: repeat(${Math.max(1, options.length)}, minmax(0, 1fr))" role="radiogroup" aria-label="${host.shell.escapeHtml(label)}">${options
        .map((option) => `<input class="btn join-item min-w-0" type="radio" name="${host.shell.escapeHtml(name)}" value="${host.shell.escapeHtml(option.value)}" aria-label="${host.shell.escapeHtml(option.label)}" ${option.value === value ? "checked" : ""}>`)
        .join("")}</div>`;
    }
    if (type === "checkboxes") {
      control = `<div data-editor-field="${host.shell.escapeHtml(name)}" class="grid gap-2">${checkboxOptions(name, options, checked)}</div>`;
    }
    if (type === "color") {
      control = `<input class="h-10 w-full cursor-pointer rounded-lg border border-base-300 bg-base-100" type="color" name="${host.shell.escapeHtml(name)}" value="${host.shell.escapeHtml(value || "#4f46e5")}">`;
    }
    if (type === "file") {
      control = `<input class="file-input file-input-bordered w-full" type="file" accept="image/*" name="${host.shell.escapeHtml(name)}">`;
    }
    return `<label class="form-control grid gap-1.5"><span class="label-text text-sm font-semibold">${host.shell.escapeHtml(label)}</span>${control}${hint === undefined
      ? ""
      : `<span data-hint="${host.shell.escapeHtml(name)}" class="text-xs text-base-content/55">${host.shell.escapeHtml(hint)}</span>`}</label>`;
  }

  function renderNewItem(): void {
    host.shell.setHeader("New task", host.session.currentTeam()?.name);
    const stage = host.workspaceController.activeProcess?.stages.find(({ id }) => id === host.shell.newItemStageId);
    // The workflow comes first: a task means nothing until you know which workflow runs it.
    // Fixed when the form was opened from a status column, since that column names one already.
    const workflows = host.workspaceController.processes;
    const selectedWorkflowId = host.shell.newItemProcessId || workflows[0]?.id || "";
    host.shell.swap(`<form class="grid max-w-3xl grid-cols-[7rem_1fr] items-center gap-x-4 gap-y-4" data-new-item>
        <label class="label-text" for="new-item-workflow">Workflow</label>
        ${stage
        ? `<p class="text-sm"><input type="hidden" name="workflow" value="${host.shell.escapeHtml(selectedWorkflowId)}">${host.shell.escapeHtml(workflows.find(({ id }) => id === selectedWorkflowId)?.name ?? "")}</p>`
        : `<select class="select select-bordered w-full" id="new-item-workflow" name="workflow">${workflows
          .map(({ id, name }) => `<option value="${host.shell.escapeHtml(id)}" ${id === selectedWorkflowId ? "selected" : ""}>${host.shell.escapeHtml(name)}</option>`)
          .join("")}</select>`}
        <label class="label-text" for="new-item-title">Title</label>
        <input class="input input-bordered w-full" id="new-item-title" name="title" autofocus>
        <label class="label-text self-start pt-3" for="new-item-description">Description</label>
        <textarea class="textarea textarea-bordered min-h-40 w-full" id="new-item-description" name="description"></textarea>
        <label class="label-text" for="new-item-owner">Owner</label>
        <input class="input input-bordered w-full" id="new-item-owner" name="owner">
        <span class="label-text self-start pt-2">Files</span>
        <div class="min-w-0">${filePickerHtml(host.shell.newItemSources)}</div>
        <div class="col-start-2 flex items-center gap-2">
          <button class="btn btn-primary" type="submit">Create task</button>
          <button class="btn btn-ghost" type="button" data-action="cancel-new-item">Cancel</button>
          <span class="text-sm text-base-content/50">${stage
        ? `Lands in ${host.shell.escapeHtml(stage.name)}`
        : "Starts at the workflow's first status"}</span>
        </div>
      </form>`);
  }

  function filePickerHtml(sources: FileSource[]): string {
    if (!sources.length) {
      return `<p class="rounded-box border border-dashed border-base-300 px-3 py-5 text-sm text-base-content/50">No folder is mapped on this machine. Set a team folder or map a linked location in Team settings → Folder.</p>`;
    }
    return `<div class="max-h-96 overflow-y-auto rounded-box border border-base-300 p-2">${sources
      .map(({ id, name, files }) => `<details>
          <summary class="cursor-pointer py-1 text-sm font-semibold">${host.shell.escapeHtml(name)}${files.length ? "" : " — empty or unreadable"}</summary>
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
            <input class="checkbox checkbox-xs mr-2 align-middle" type="checkbox" data-folder-check>${host.shell.escapeHtml(name)}/
          </summary>
          <ul class="border-l border-base-300 pl-4">${fileTreeHtml(child, locationId, `${prefix}${name}/`)}</ul>
        </details></li>`);
    const files = node.files.sort().map((name) => {
      const path = `${prefix}${name}`;
      const value = locationId ? logicalFileReference(locationId, path) : path;
      return `<li><label class="flex cursor-pointer items-center gap-2 py-1 text-sm">
          <input class="checkbox checkbox-xs" type="checkbox" name="files" value="${host.shell.escapeHtml(value)}">${host.shell.escapeHtml(name)}
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
    const process = host.workspaceController.processes.find(({ id }) => id === processId);
    if (process && processEngine.isInteractive(process)) {
      return '<span class="badge badge-primary badge-sm">Interactive</span>';
    }
    return host.runs.runningProcesses.has(processId)
      ? '<span class="badge badge-success badge-sm">Running</span>'
      : '<span class="badge badge-ghost badge-sm">Stopped</span>';
  }

  function processStatusButton(processId: string): string {
    const process = host.workspaceController.processes.find(({ id }) => id === processId);
    // ponytail: interactive processes have no process-level run, so the footer shows nothing here.
    // The board header carries the explanation, where people look for Run.
    if (process && processEngine.isInteractive(process))
      return "";
    const running = host.runs.runningProcesses.has(processId);
    return actionIconButton(running ? "stop-process" : "start-process", running ? "Running. Click to stop." : "Stopped. Click to run.", running ? ACTION_ICONS.active : ACTION_ICONS.inactive, processId, running ? "btn-ghost text-success" : "btn-ghost text-warning");
  }

  function processRunButtons(processId: string, size: string): string {
    const process = host.workspaceController.processes.find(({ id }) => id === processId);
    if (process && processEngine.isInteractive(process)) {
      return `<button class="btn btn-ghost ${size}" disabled>Run from the item view</button>`;
    }
    const running = host.runs.runningProcesses.has(processId);
    return `<button class="btn btn-primary ${size}" data-action="start-process" data-id="${processId}"${running ? " disabled" : ""}>Run</button><button class="btn btn-ghost ${size} text-error" data-action="stop-process" data-id="${processId}"${running ? "" : " disabled"}>Stop</button>`;
  }

  function assistantActionsHtml(actions: ResolvedAction[], index: number, applied: boolean): string {
    const cards = actions
      .map((entry) => {
        const titles = entry.items.slice(0, 5).map(({ title }) => host.shell.escapeHtml(title));
        const more = entry.items.length > titles.length ? `, +${entry.items.length - titles.length} more` : "";
        return `<li class="border-t border-base-300 px-3 py-2 first:border-t-0">
          <p class="text-sm ${entry.error ? "text-base-content/50 line-through" : ""}">${host.shell.escapeHtml(entry.summary)}</p>
          ${entry.error ? `<p class="mt-1 text-xs text-error">${host.shell.escapeHtml(entry.error)}</p>` : ""}
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
    const current = host.shell.escapeHtml(modelLabel(host.assistant.assistantModel, host.assistant.assistantCatalog));
    if (!host.assistant.assistantPickerOpen) {
      return `<button type="button" class="btn btn-ghost btn-xs max-w-full justify-start font-normal" data-assistant="picker">
        <span class="truncate text-base-content/60">Model: ${current}</span>
      </button>`;
    }
    const groups = [...new Set(host.assistant.assistantCatalog.map(({ group }) => group))];
    const rows = groups
      .map((group) => {
        const entries = host.assistant.assistantCatalog.map((option, index) => ({ option, index }))
          .filter(({ option }) => option.group === group)
          .map(({ option, index }) => `<li>
              <button type="button" class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-base-200" data-assistant="pick" data-index="${index}">
                <span class="w-3">${sameChoice(option.choice, host.assistant.assistantModel) ? "●" : ""}</span>
                <span class="flex-1 truncate">${host.shell.escapeHtml(option.label)}</span>
                ${option.note ? `<span class="text-[10px] text-base-content/45">${host.shell.escapeHtml(option.note)}</span>` : ""}
              </button>
            </li>`)
          .join("");
        return `<li class="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-base-content/40">${host.shell.escapeHtml(group)}</li>${entries}`;
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
    host.shell.assistantPanel.classList.toggle("translate-x-full", !host.assistant.assistantOpen);
    host.shell.assistantPanel.setAttribute("aria-hidden", host.assistant.assistantOpen ? "false" : "true");
    host.shell.assistantPanel.inert = !host.assistant.assistantOpen;
    host.shell.assistantSend.disabled = host.assistant.assistantBusy;
    host.shell.assistantSend.textContent = host.assistant.assistantBusy ? "Working…" : "Send";
    host.shell.assistantModelSlot.innerHTML = assistantModelHtml();
    host.shell.assistantLog.innerHTML = host.assistant.assistantLogEntries.length
      ? host.assistant.assistantLogEntries.map((entry, index) => {
        const mine = entry.role === "you";
        return `<div class="${mine ? "text-right" : ""}">
              <div class="inline-block max-w-full rounded-box px-3 py-2 text-left text-sm ${mine ? "bg-primary/10" : "bg-base-200"}"><span class="whitespace-pre-wrap">${host.shell.escapeHtml(entry.text)}</span></div>
              ${entry.actions?.length ? assistantActionsHtml(entry.actions, index, entry.applied === true) : ""}
            </div>`;
      })
        .join("")
      : `<p class="px-1 text-sm text-base-content/50">Ask for a process, an agent, or a bulk change. Nothing is written until you approve it.</p>`;
    host.shell.assistantLog.scrollTop = host.shell.assistantLog.scrollHeight;
  }

  return {
    pageWithMenu,
    renderTabs,
    gearIcon,
    renderActiveOrg,
    taskNavItem,
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
