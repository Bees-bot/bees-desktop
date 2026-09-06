import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
// @ts-expect-error Client modules are plain JavaScript.
import { connectionIdForScope, defaultOrgColor, nextThemePreset, THEME_PRESETS } from "../dsh-runtime/plugin/client/shared.js";
import { clientBundle, clientSource as client } from "./client-source.js";

describe("Bees work cockpit UI", () => {
  it("switches directly from a connected organization to a private one", () => {
    const data = {
      organizations: [{ id: "private" }, { id: "regular" }], teams: [], workspaces: [],
      connections: [{ id: "regular-connection", organizationId: "regular" }], connectionTeams: []
    };
    expect(connectionIdForScope(
      data, "organization:private", "", "regular-connection"
    )).toBe("");
    expect(connectionIdForScope(
      data, "organization:regular", "", "regular-connection"
    )).toBe("regular-connection");
    expect(connectionIdForScope(data, "")).toBe("");
  });

  it("assigns stable, distinct fallback organization colors", () => {
    expect(defaultOrgColor("Acme")).toBe(defaultOrgColor("Acme"));
    expect(defaultOrgColor("Acme")).not.toBe(defaultOrgColor("Ace"));
    expect(defaultOrgColor("Acme")).toMatch(/^hsl\(\d+ 55% 45%\)$/);
  });

  it("restores every old Bees theme without duplicate ids", () => {
    expect(THEME_PRESETS).toHaveLength(35);
    expect(new Set(THEME_PRESETS.map(({ id }: { id: string }) => id)).size).toBe(35);
    const labels = THEME_PRESETS.map(({ label }: { label: string }) => label);
    expect(labels).toEqual([...labels].sort((left, right) => left.localeCompare(right)));
    expect(THEME_PRESETS.map(({ id }: { id: string }) => id)).toEqual(expect.arrayContaining([
      "forest", "dracula", "nord", "caramellatte", "abyss", "silk"
    ]));
    expect(THEME_PRESETS.find(({ id }: { id: string }) => id === "forest")).toEqual(expect.objectContaining({
      dark: true,
      colors: expect.arrayContaining(["oklch(68.628% 0.185 148.958)"]),
      surface: "oklch(20.84% 0.008 17.911)"
    }));
  });

  it("switches through the selected dark and light theme defaults", () => {
    expect(nextThemePreset({ themePreset: "forest", lightThemePreset: "cupcake" }).id).toBe("cupcake");
    expect(nextThemePreset({ themePreset: "cupcake", darkThemePreset: "dracula" }).id).toBe("dracula");
    expect(nextThemePreset({ themePreset: "valentine", colorMode: "light",
      lightThemePreset: "valentine", darkThemePreset: "light" }).id).toBe("light");
    expect(nextThemePreset({ themePreset: "light", colorMode: "dark",
      lightThemePreset: "valentine", darkThemePreset: "light" }).id).toBe("valentine");
  });

  it("ships a parseable client bundle", () => {
    expect(() => new Script(clientBundle)).not.toThrow();
  });

  it("keeps Google account sign-in separate from Drive authorization", () => {
    expect(client).toContain('onStart("social_start", { provider: "google" })');
    expect(client).not.toContain('onStart("google_start", { provider: "google" })');
  });

  it("refreshes agent state from push notifications with polling only as a fallback", () => {
    expect(client).toContain('new window.EventSource("/bees-api/events")');
    expect(client).toContain('window.dispatchEvent(new window.CustomEvent("bees-change"');
    expect(client).toContain('window.addEventListener("bees-change", changed)');
    expect(client).toContain("setInterval(() => void load(), 30_000)");
    expect(client).toContain('run?.status === "queued" ? "Agent is starting..." : "Agent is working..."');
  });

  it("registers the bundled client module", () => {
    let registration: any;
    new Script(clientBundle).runInNewContext({
      window: { __ModuleLoader__: { load: (value: any) => { registration = value; } } }
    });
    const noop = (): undefined => undefined;
    const React = {
      Component: class {}, createElement: noop, useEffect: noop, useMemo: noop, useRef: noop, useState: noop
    };
    const modules: Record<string, any> = {
      react: React,
      "@deepseek-ai/dsh-client-ui-primitives": { MarkdownText: noop },
      "@deepseek-ai/dsh-client-ui-user-questions": { PendingQuestion: class {} },
      "@bees/dsh-local-ai": {
        LocalAiController: noop, LocalAiSettings: noop, ExternalLocalAiSettings: noop
      },
      "@bees/dsh-free-ai": { FreeAiController: noop, FreeAiSettings: noop },
      "@bees/dsh-custom-ai": { CustomAiSettings: noop },
      "@bees/dsh-subscriptions": { SubscriptionSettings: noop }
    };
    const plugin = registration.factory((id: string) => modules[id]);
    expect(plugin.inject).toContain("slots");
    expect(plugin.apply).toBeTypeOf("function");
  });

  it("routes terminal and archived work to Completed", () => {
    expect(client).toContain('item.completed || item.archivedAt || ["completed", "cancelled"].includes(item.runtimePhase)');
    expect(client).toContain('route === "completed" ? isDone(item) : !isDone(item)');
  });

  it("opens the process-run form from process-template cards", () => {
    expect(client).toContain("if (p?.id) openWorkItem(null, p.id)");
    expect(client).toContain("openWorkItem(null, card.id)");
    expect(client).toContain('setCreating(id ? "" : processForWork ? "run" : "work")');
    expect(client).toContain('action: processRun ? "create_run" : "create_item"');
    expect(client).not.toContain('title: `New ${card.name} run`');
  });

  it("uses the full content width and separates the detail views into tabs", () => {
    expect(client).toContain('"bees-panel-wide"');
    expect(client).toContain('"bees-panel-full-height"');
    expect(client).toContain('setActiveTab("details")');
    expect(client).toContain('setActiveTab("files")');
    expect(client).toContain('setActiveTab("runs")');
    expect(client).toContain('setActiveTab("audit")');
    expect(client).toContain('role: "tablist"');
    expect(client).toContain('role: "tabpanel"');
    expect(client).toContain('className: "bees-tab-actions"');
    expect(client).toContain('"run-status": { label: "Status & controls", hideHeader: true, sizeToContent: true, minW: 12');
    const tabContents = client.slice(client.indexOf('const details = h('), client.indexOf('return h(FlexibleGrid,'));
    expect(tabContents).not.toContain('className: "bees-action-ribbon"');
    expect(tabContents).not.toContain('"Files & folders"');
  });

  it("collapses long user messages in work-item details", () => {
    expect(client).toContain("children.length > 280");
    expect(client).toContain('expanded ? "Show less" : "Show more"');
    expect(client).toContain('"aria-expanded": expanded');
    expect(client.match(/h\(UserMessage,/g)).toHaveLength(2);
  });

  it("lets the Kanban grow with the page instead of scrolling inside its widget", () => {
    expect(client).toContain('"gs-size-to-content": panel.sizeToContent || undefined');
    expect(client).toContain('borderless: true, sizeToContent: true');
    expect(client).not.toContain('.bees-flex-widget-body>.bees-cockpit-board{height:100%');
    expect(client).toContain('flex-direction: row !important');
    expect(client).toContain('overflow-x: auto !important');
    expect(client).toContain('gap: 12px !important');
    expect(client).toContain('.bees-column { flex: 0 0 300px !important; background: var(--dsw-specific-sidebar-fill) !important;');
    expect(client).toContain('.bees-cockpit-board { display: flex !important;');
    expect(client.match(/sizeToContent: true/g)).toHaveLength(4);
    expect(client).toContain('.bees-work-item-grid .bees-convo-history,');
    expect(client).toContain('return h("div", { style: { display: "flex", flexDirection: "column" } },');
  });

  it("wraps process-template routing controls inside narrow stage columns", () => {
    expect(client).toContain('.bees-routing-board .bees-row{align-items:flex-start;flex-wrap:wrap}');
    expect(client).toContain('.bees-routing-board .bees-row-main{flex-basis:100%;overflow-wrap:anywhere}');
    expect(client).toContain('.bees-routing-board .bees-row>.bees-select{min-width:0;flex:1 1 130px}');
  });

  it("uses theme-aware conversation bubbles, expandable tool cards, and a compact composer", () => {

    expect(client).toContain('className: "bees-agent-turn"');
    expect(client).toContain('className: "bees-composer-send"');
    expect(client).toContain('background: var(--dsw-alias-interactive-bg-hover) !important;');
    expect(client).not.toContain("#9F8BFF");
  });

  it("renders descriptions as markdown and makes audit evidence inspectable", () => {
    expect(client).toContain('h(MarkdownText, { text: process.description })');
    expect(client).toContain('h(MarkdownText, { text: item.description })');
    expect(client).toContain("function AuditEvent");
    expect(client).toContain('openLabel: run ? "Open execution" : item ? "Open work item" : "Open process template"');
  });

  it("uses one agent interaction card in Needs you and the dashboard", () => {
    expect(client).toContain("function AgentInteractionPanel");
    expect(client.match(/h\(AgentInteractionPanel,/g)).toHaveLength(1);
    expect(client.match(/className: "bees-box bees-answer-card"/g)).toHaveLength(1);
    expect(client).toContain('"aria-expanded": isSelected');
    expect(client).toContain('className: "bees-dashboard-launch"');
    expect(client).toContain("const listedItemIds = new Set(records.map(({ id }) => id));");
    expect(client).toContain("function NeedsYouControls");
    expect(client).toContain('h(NeedsYouControls, { item, act, onDone: onControlled })');
    expect(client).toContain('busy === "retry_item" ? "Retrying…" : "Retry"');
    expect(client).toContain('act({ action: "retry_item", itemId: item.id })');
    expect(client).not.toContain('action: "retry_run"');
    expect(client).toContain('busy === "cancel_item" ? "Stopping…" : "Stop"');
    expect(client).toContain('busy === "archive_item" ? "Archiving…" : "Archive"');
    expect(client).not.toContain("The prior request was interrupted");
  });

  it("omits archived work from every Needs you list", () => {
    expect(client).toContain("const activeRuns = data.runs.filter");
    expect(client).toContain("!isDone(data.items.find(({ id }) => id === run.workItemId) ?? {})");
    expect(client).toContain("const blocked = activeRuns.filter");
  });

  it("uses explicit review decisions with isolated future-run learning", () => {
    expect(client).toContain("function WorkReviewPanel");
    expect(client).not.toContain("function ReviewDecisionPanel");
    expect(client).not.toContain("function reviewOptions");
    expect(client).toContain('pendingRun?.pendingInteraction === "work-review"');
    expect(client).toContain('"Reject and send feedback"');
    expect(client).toContain('`Future ${recurring.name} runs`');
    expect(client).toContain('action: "apply_specialist_feedback"');
    expect(client).toContain('selected: outcome === "approve" ? ["Approve"] : []');
    expect(client).toContain('...(detail ? { custom: detail } : {})');
    expect(client).toContain("This feedback applies to this goal only");
    expect(client).toContain('className: "bees-notice"');
    expect(client).toContain('h("strong", null, "Learned change")');
    expect(client).toContain('busy === "approve" ? "Approving…" : "Approve"');
  });

  it("exposes recurring schedules and editable specialist playbooks", () => {
    expect(client).toContain("function ScheduleForm");
    expect(client).toContain('action: recurring ? "edit_recurring_work" : "create_recurring_work"');
    expect(client).toContain('h(Cron, {');
    expect(client).toContain("HEADER.MINUTES, HEADER.HOURLY, HEADER.DAILY");
    expect(client).not.toContain('headers: ["minutes"');
    expect(client).toContain('.bees-cron-generator .cron_builder .dropdown-content { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-button-elevated-fill); }');
    expect(client).toContain('.bees-cron-generator .cron_builder .nav-tabs .nav-link.active');
    expect(client).toContain("schedulable && !item.parentId");
    expect(client).toContain("result.sourceWorkItemId");
    expect(client).toContain('!item.parentId && item.kind !== "run" && Boolean(item.recurringWorkId)');
    expect(client).toContain('item.kind === "run" ? "scheduled run" : item.kind');
    expect(client).toContain('item.kind === "run" && data.processes.find');
    expect(client).toContain('route !== "goals" || process?.kind === "goals"');
    expect(client).not.toContain('workspaceId) && item.kind !== "run"');
    expect(client).toContain('"Specialist playbooks"');
    expect(client).toContain('action: "edit_specialist_playbook"');
    expect(client).toContain('action: "undo_specialist_playbook"');
    expect(client).toContain('action: "reset_specialist_playbook"');
    expect(client).toContain("Bees must be open and the device must be available");
  });

  it("names work items precisely and opens runs whose work item is unavailable", () => {
    expect(client).toContain('{ id: "work", label: "Process Runs"');
    expect(client).toContain('["all-work", "All process runs"], ["schedules", "Schedules"]');
    expect(client).toContain('{ id: "processes", label: "Process Templates"');
    expect(client).toContain('["runs", "Executions"], ["evaluations", "Evaluations"]');
    expect(client).not.toContain('["all-processes", "All processes"], ["templates", "Templates"]');
    expect(client).toContain('route === "schedules" ? isScheduleDefinition(item) : !isScheduleDefinition(item)');
    expect(client).toContain('placeholder: "Search by task name"');
    expect(client).toContain('"Filter by status"');
    expect(client).toContain('"Filter by type"');
    expect(client).toContain('`Plan outcome: ${run.purpose}`');
  });

  it("documents scheduling behavior for end users", () => {
    expect(client).toContain('openExternal("https://bees.bot/help/scheduling")');
    expect(client).toContain('"Open Scheduling guide"');
    expect(client).toContain('"Open Architecture Panel guide"');
    expect(client).not.toContain("Schedules use the SKIP overlap policy");
  });

  it("links to canonical company brain and privacy guides", () => {
    expect(client).toContain('openExternal("https://bees.bot/help/company-brain")');
    expect(client).toContain('openExternal("https://bees.bot/help/privacy")');
  });

  it("lets the user edit instructions shared by every agent", () => {
    expect(client).toContain('["system-instructions", "System instructions"]');
    expect(client).toContain('"System-wide instructions"');
    expect(client).toContain('preferences.set("systemInstructions", value)');
    expect(client).toContain("Added to every planning, work, and review agent's system prompt");
    expect(client).toContain('"Example scenarios"');
    expect(client).toContain("After each delegated task finishes, ask me to approve its result before starting the next task.");
    expect(client).toContain("If required information is missing, ask me instead of guessing.");
  });

  it("merges the requested navigation screens", () => {
    expect(client).toContain('["all-agents", "Agents & presets"]');
    expect(client).toContain('agents: { label: "Agents"');
    expect(client).not.toContain('pools: { label: "Agent pools"');
    expect(client).toContain('presets: { label: "Agent presets"');
    expect(client).toContain('{ id: "files", label: "Files & Folders", icon: FilesIcon, defaultChild: "locations", children: [] }');
    expect(client).toContain('label: "Knowledge Base"');
    expect(client).toContain('["search", "Search & sources"]');
    expect(client).toContain('["organization-settings", "Organization general"]');
    expect(client).toContain('["organization-members", "Organization members"]');
    expect(client).toContain('["organization-invitations", "Organization invitations"]');
    expect(client).toContain('["organization-workspace", "Organization workspace"]');
    expect(client).toContain('["organization-authentication", "Organization authentication"]');
    expect(client).toContain('["team-settings", "Team members"]');
    expect(client).toContain('collaboration("delete_organization"');
    expect(client).toContain('action: "delete_organization", organizationId: organization.id');
    expect(client).toContain('name !== organization.name');
    expect(client).toContain('collaboration("delete_team"');
    expect(client).toContain('action: "delete_team", teamId: team.id');
    expect(client).toContain('name !== team.name');
  });

  it("uses the old Bees organization and team hierarchy", () => {
    expect(client).toContain('className: "bees-org-tiles"');
    expect(client).toContain('className: "bees-org-summary"');
    expect(client).toContain('const type = row.connectionId ? "Regular" : "Private"');
    expect(client).toContain('title: row.details, "aria-label": row.details');
    expect(client).toContain('"Only on this device"');
    expect(client).toContain('defaultOrgColor(row.name)');
    expect(client).toContain('"aria-label": "Add organization"');
    expect(client).not.toContain('"Private / Local org only (no team sharing)"');
    expect(client).not.toContain('"Local organization name"');
    expect(client).toContain('className: "bees-team-list"');
    expect(client).toContain('className: `bees-team-section');
    expect(client).toContain('className: "bees-team-nav"');
    expect(client).toContain('"aria-label": "Add team"');
    expect(client).toContain('className: "bees-team-settings"');
    expect(client).toContain('"aria-label": "Global and organization settings"');
    expect(client).toContain('NAVIGATION.filter(({ id }) => id !== "settings")');
    expect(client).toContain('const [expandedMenus, setExpandedMenus] = useState(() => new Set());');
    expect(client).toContain('"aria-expanded": item.children && item.children.length > 0 ? menuExpanded : null');
    expect(client).toContain('onClick: () => navigate("appearance")');
    expect(client).not.toContain('key: `top-settings:${child}`');
    expect(client).not.toContain('aria-label": "Bees navigation"');
    expect(client).toContain('className: "bees-settings-layout"');
    expect(client).toContain('className: "bees-theme-grid"');
    expect(client).toContain('"data-theme-default": "dark"');
    expect(client).toContain('"data-theme-default": "light"');
    expect(client).not.toContain('["local-ai", "Local models"]');
    expect(client).toContain('h(LocalAiSettings, { modelSettings, preferences, systemDefault');
    expect(client).toContain('type: "color", className: "bees-color-input"');
    expect(client).toContain('value: organizationColor');
    expect(client).toContain('preferences?.set("organizationColors"');
    expect(client).not.toContain('["permissions", "Permissions"]');
  });

  it("keeps account controls at the bottom of the main sidebar", () => {
    expect(client).toContain('onClick: () => navigate("accounts")');
    expect(client).toContain('h("span", null, "Accounts")');
    expect(client).toContain('role: "switch"');
    expect(client).toContain('run("set_account_enabled"');
    expect(client).toContain('"Sign up/in with Google"');
    expect(client).toContain('"Sign up/in with GitHub"');
    expect(client).toContain('"Continue with Company SSO"');
    expect(client).toContain('["organizations", "Organizations"]');
    expect(client).not.toContain('"Accounts & organizations"');
    expect(client.match(/h\(AccountSignInButtons/g)).toHaveLength(2);
    expect(client).not.toContain('"Sign in & Create"');
    expect(client).not.toContain('"Create account & Org"');
    expect(client.match(/before\.get\(userId\) !== updatedAt/g)).toHaveLength(2);
  });

  it("keeps work-item navigation inside the Bees task screen", () => {
    expect(client).toContain("onClick: () => setWorkItemId(item.id)");
    expect(client).toContain('type: "button", className: "bees-row bees-work-item-row"');
    expect(client).not.toContain('className: "primary bees-work-item-open"');
    expect(client).not.toContain("ctx.sessions.open(");
  });

  it("puts creation actions in widget headers and uses ordered stage participants", () => {
    expect(client).toContain('panel.actions ? h("div", { className: "bees-flex-widget-actions"');
    expect(client).toContain('agents: { label: "Agents", actions: h(Button');
    expect(client).toContain('processes: { label: "Process Templates", actions: h(Button');
    expect(client).toContain('"Add participant"');
    expect(client).toContain('"Discussion lead"');
  });

  it("shows delegated peers only through their ordinary work-item lifecycle", () => {
    expect(client).not.toContain("sessions.subagentsByParent");
    expect(client).not.toContain("setSubagentCatalogOpen");
    expect(client).toContain('`Parent: ${parentPath}`');
    expect(client).toContain("item.runtimePhase");
  });

  it("selects automatic or pinned agent models with a separate reasoning effort", () => {
    expect(client).toContain("function AgentModelSelect");
    expect(client).toContain('request("/bees-api/llm-models")');
    expect(client).toContain('"System default (auto-updates)"');
    expect(client).toContain('`System default — ${systemDefault.provider}/${systemDefault.model}');
    expect(client).toContain('${channel.name} (auto-updates)`');
    expect(client).toContain('"sol", "Sol"');
    expect(client).toContain('"terra", "Terra"');
    expect(client).toContain('"luna", "Luna"');
    expect(client).toContain('"CLI default (auto-updates)"');
    expect(client).toContain('"Model default (recommended)"');
    expect(client).toContain('name: "reasoningEffort"');
    expect(client).toContain('left.name.localeCompare(right.name, undefined, { sensitivity: "base" })');
    expect(client).toContain('`Current: ${route} (unavailable)`');
    expect(client).toContain('key: `provider:${group.id}` }, group.name');
    expect(client).not.toContain('h("optgroup", { label: group.name');
    expect(client.match(/h\(AgentModelSelect,/g)).toHaveLength(4);
    expect(client).not.toContain('"Model route (optional provider/model)"');
  });

  it("shows and saves a required, visually separate system default", () => {
    expect(client).toContain("function SystemDefaultSettings");
    expect(client).toContain('className: "bees-box bees-system-default"');
    expect(client).toContain('allowSystemDefault: false');
    expect(client).toContain('required: !allowSystemDefault');
    expect(client).toContain('request("/bees-api/system-default-model"');
    expect(client).toContain("Choose another default before turning this connection off.");
  });
});
