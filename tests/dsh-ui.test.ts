import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { clientBundle, clientSource as client } from "./client-source.js";

describe("Bees work cockpit UI", () => {
  it("ships a parseable client bundle", () => {
    expect(() => new Script(clientBundle)).not.toThrow();
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

  it("opens the work form from home cards instead of starting work", () => {
    expect(client).toContain("if (p?.id) openWorkItem(null, p.id)");
    expect(client).toContain("openWorkItem(null, card.id)");
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
    expect(client.indexOf('className: "bees-tab-actions"'))
      .toBeLessThan(client.indexOf('className: "bees-tab-panel"'));
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
    expect(client.match(/sizeToContent: true/g)).toHaveLength(3);
    expect(client).toContain('.bees-work-item-grid .bees-convo-history,');
    expect(client).toContain('return h("div", { style: { display: "flex", flexDirection: "column" } },');
  });

  it("uses theme-aware conversation bubbles, expandable tool cards, and a compact composer", () => {
    expect(client).toContain('className: `bees-tool-card ${isWorking ? "working"');
    expect(client).toContain('className: "bees-tool-summary"');
    expect(client).toContain('className: "bees-agent-turn"');
    expect(client).toContain('className: "bees-composer-send"');
    expect(client).toContain('background: var(--dsw-alias-interactive-bg-hover) !important;');
    expect(client).not.toContain("#9F8BFF");
  });

  it("renders descriptions as markdown and makes audit evidence inspectable", () => {
    expect(client).toContain('h(MarkdownText, { text: process.description })');
    expect(client).toContain('h(MarkdownText, { text: item.description })');
    expect(client).toContain("function AuditEvent");
    expect(client).toContain('openLabel: "Open run"');
    expect(client).toContain('openLabel: run ? "Open run" : item ? "Open work item" : "Open process"');
  });

  it("uses one agent interaction card in Needs you and the dashboard", () => {
    expect(client).toContain("function AgentInteractionPanel");
    expect(client.match(/h\(AgentInteractionPanel,/g)).toHaveLength(2);
    expect(client.match(/className: "bees-box bees-answer-card"/g)).toHaveLength(1);
    expect(client).toContain('"aria-expanded": live.run.id === selected?.run.id');
    expect(client).toContain('className: "bees-dashboard-launch"');
    expect(client).toContain("function NeedsYouControls");
    expect(client).toContain('h(NeedsYouControls, { item, act, onDone: onControlled })');
    expect(client).toContain('busy === "retry_item" ? "Retrying…" : "Retry"');
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
    expect(client).toContain("function ReviewDecisionPanel");
    expect(client).toContain('"Reject and send feedback"');
    expect(client).toContain('`Future ${recurring.name} runs`');
    expect(client).toContain('action: "apply_specialist_feedback"');
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
    expect(client).toContain('item.kind !== "run" && Boolean(item.recurringWorkId)');
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
    expect(client).toContain('["all-work", "All work"], ["schedules", "Schedules"]');
    expect(client).toContain('route === "schedules" ? isScheduleDefinition(item) : !isScheduleDefinition(item)');
    expect(client).toContain('placeholder: "Search by task name"');
    expect(client).toContain('"Filter by status"');
    expect(client).toContain('"Filter by type"');
    expect(client).toContain('`Plan outcome: ${run.purpose}`');
    expect(client).toContain('openLabel: selected.item ? "Open work" : "Open run"');
    expect(client).toContain('item ? () => openWorkItem(item.id) : () => openRun(run.id)');
    expect(client).toContain('setRunId(result.executionId)');
  });

  it("documents scheduling behavior for end users", () => {
    expect(client).toContain('openExternal("https://bees.bot/help/scheduling")');
    expect(client).toContain('"Open Scheduling guide"');
    expect(client).not.toContain("Schedules use the SKIP overlap policy");
  });

  it("links to canonical company brain and privacy guides", () => {
    expect(client).toContain('openExternal("https://bees.bot/help/company-brain")');
    expect(client).toContain('openExternal("https://bees.bot/help/privacy")');
  });

  it("merges the requested navigation screens", () => {
    expect(client).toContain('["all-agents", "Agents, pools & presets"]');
    expect(client).toContain('agents: { label: "Agents"');
    expect(client).toContain('pools: { label: "Agent pools"');
    expect(client).toContain('presets: { label: "Agent presets"');
    expect(client).toContain('{ id: "files", label: "Files & Folders", icon: FilesIcon, defaultChild: "locations", children: [] }');
    expect(client).toContain('label: "Knowledge Base"');
    expect(client).toContain('["search", "Search & sources"]');
  });

  it("keeps work-item navigation inside the Bees task screen", () => {
    expect(client).toContain("onClick: () => setWorkItemId(item.id)");
    expect(client).toContain('type: "button", className: "bees-row bees-work-item-row"');
    expect(client).not.toContain('className: "primary bees-work-item-open"');
    expect(client).not.toContain("ctx.sessions.open(");
  });

  it("puts creation actions in widget headers and uses a selectable pool member", () => {
    expect(client).toContain('panel.actions ? h("div", { className: "bees-flex-widget-actions"');
    expect(client).toContain('agents: { label: "Agents", actions: h(Button');
    expect(client).toContain('pools: { label: "Agent pools", actions: h(Button');
    expect(client).toContain('processes: { label: "Processes", actions: h(Button');
    expect(client).toContain('"aria-label": "Agent to add"');
    expect(client).toContain('resizeAlways: true');
  });

  it("shows delegated peers only through their ordinary work-item lifecycle", () => {
    expect(client).not.toContain("sessions.subagentsByParent");
    expect(client).not.toContain("setSubagentCatalogOpen");
    expect(client).toContain('parentPath || "Delegated work"');
    expect(client).toContain("item.runtimePhase");
  });

  it("selects automatic or pinned agent models with a separate reasoning effort", () => {
    expect(client).toContain("function AgentModelSelect");
    expect(client).toContain('api.llm.models({})');
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
    expect(client).toContain('`Current: ${value} (unavailable)`');
    expect(client).toContain('key: `provider:${group.id}` }, group.name');
    expect(client).not.toContain('h("optgroup", { label: group.name');
    expect(client.match(/h\(AgentModelSelect,/g)).toHaveLength(3);
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
