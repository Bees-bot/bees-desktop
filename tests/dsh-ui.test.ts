import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";

const client = readFileSync(new URL("../dsh-runtime/plugin/lib/client.js", import.meta.url), "utf8");

describe("Bees work cockpit UI", () => {
  it("ships a parseable client bundle", () => {
    expect(() => new Script(client)).not.toThrow();
  });

  it("routes terminal and archived work to Completed", () => {
    expect(client).toContain('item.completed || item.archivedAt || ["completed", "cancelled"].includes(item.runtimePhase)');
    expect(client).toContain('route === "completed" ? isDone(item) : !isDone(item)');
  });

  it("uses the full content width and separates the detail views into tabs", () => {
    expect(client).toContain('"bees-panel-wide"');
    expect(client).toContain('["needs", "Questions & approvals"]');
    expect(client).toContain('["description", "Process description"]');
    expect(client).toContain('["runs", "Runs & details"]');
    expect(client).toContain('["audit", "Audit"]');
    expect(client).toContain('role: "tablist"');
    expect(client).toContain('role: "tabpanel"');
  });

  it("uses one agent interaction card in Needs you and the Kanban detail tab", () => {
    expect(client).toContain("function AgentInteractionPanel");
    expect(client.match(/h\(AgentInteractionPanel,/g)).toHaveLength(2);
    expect(client.match(/className: "bees-box bees-answer-card"/g)).toHaveLength(1);
  });

  it("keeps live subagent catalogs open and projects their children immediately", () => {
    expect(client).toContain("sessions.subagentsByParent");
    expect(client).toContain("ctx.sessions.setSubagentCatalogOpen(sessionId, true)");
    expect(client).toContain("Object.values(sessions.byId).map((summary) => [summary.id, summary])");
    expect(client).toContain('entry.activity === "running"');
  });

  it("shows subagents from the current workflow attempt instead of merging retries", () => {
    expect(client).toContain("function runsForAttempt(item, data)");
    expect(client).toContain("item.runtimeAttempt");
    expect(client).toContain("items.flatMap((item) => runsForAttempt(item, data))");
  });
});
