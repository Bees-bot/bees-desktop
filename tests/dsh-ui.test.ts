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
      createElement: noop, useEffect: noop, useMemo: noop, useRef: noop, useState: noop
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
    expect(client).toContain('import { h, React } from "./runtime.js";');
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

  it("names work items precisely and opens runs whose work item is unavailable", () => {
    expect(client).toContain('{ id: "work", label: "Work", icon: WorkIcon, defaultChild: "all-work", children: [] }');
    expect(client).toContain('placeholder: "Search by task name"');
    expect(client).toContain('"Filter by status"');
    expect(client).toContain('"Filter by type"');
    expect(client).toContain('`Plan outcome: ${run.purpose}`');
    expect(client).toContain('openLabel: selected.item ? "Open work" : "Open run"');
    expect(client).toContain('item ? () => openWorkItem(item.id) : () => openRun(run.id)');
    expect(client).toContain('setRunId(result.executionId)');
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
    expect(client).toContain('import { ask, Button, confirmAction, Empty, request } from "./shared.js";');
    expect(client).toContain('className: "bees-box bees-system-default"');
    expect(client).toContain('allowSystemDefault: false');
    expect(client).toContain('required: !allowSystemDefault');
    expect(client).toContain('request("/bees-api/system-default-model"');
    expect(client).toContain("Choose another default before turning this connection off.");
  });
});
