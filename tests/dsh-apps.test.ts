import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { BeesProduct } from "../dsh-runtime/plugin/lib/product.js";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { NodeDatabase } from "./node-database.js";
// @ts-expect-error Plain JS app boundary.
import { AppPlatform } from "../dsh-runtime/plugin/lib/app-platform.js";
// @ts-expect-error Plain JS app contract.
import { validateApp, appToolDenial } from "../dsh-runtime/plugin/lib/app-contract.js";
// @ts-expect-error Plain JS source boundary.
import { publicIPv4 } from "../dsh-runtime/plugin/lib/app-source.js";
// @ts-expect-error Plain JS tool boundary.
import { mountAppTools } from "../dsh-runtime/plugin/lib/app-tools.js";
// @ts-expect-error Plain JS client module.
import { AppsPage } from "../dsh-runtime/plugin/client/apps.js";
// @ts-expect-error Plain JS client runtime.
import { configureRuntime } from "../dsh-runtime/plugin/client/runtime.js";

const manifest = {
  schemaVersion: 1, id: "example-app", version: "0.1.0", name: "Example app", description: "An unrelated research app",
  author: "Test", license: "UNLICENSED", permissions: ["public-sources", "draft-actions"],
  inputs: [{ key: "topic", label: "Topic", required: true }],
  sources: [{ key: "public-feed", label: "Public source", url: "https://example.com/feed", queryParam: "q" }],
  task: "Research a topic, save an app record.", review: "Verify the actual source evidence."
};
const databases: any[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of databases.splice(0)) db.close(); });
function setup() {
  const db = new NodeDatabase().connection;
  databases.push(db);
  const runtime: any = new AgentRuntime({ on: () => () => undefined, tools: { schemas: () => [] },
    agentPresets: { defaultId: "standard", mount: async () => undefined } }, db);
  const processes = { isAutomatic: () => true, startItem: vi.fn(async () => ({ status: "started" })) };
  const product = new BeesProduct(db, runtime, processes, "/tmp/bees-app-tests");
  const fetcher = vi.fn(async () => ({ url: "https://example.com/feed?q=help", observedAt: "2026-09-08T00:00:00Z", content: "Public request for help" }));
  const apps = new AppPlatform(product, fetcher);
  runtime.apps = apps;
  const workspaceId = (db.prepare("SELECT id FROM workspaces LIMIT 1").get() as any).id;
  const install = (m = manifest, scope = workspaceId) => apps.install(scope, { manifest: m, config: { topic: "Useful research" } });
  const run = (id: string) => apps.command({ action: "run", installationId: id, workspaceId });
  return { db, apps, runtime, product, processes, fetcher, workspaceId, install, run };
}

it("validates the declarative boundary and rejects executable hooks, secrets and unknown fields", () => {
  expect(validateApp(manifest)).toEqual(manifest);
  for (const patch of [{ schemaVersion: 2 }, { entrypoint: "malware.js" }, { permissions: ["shell"] },
    { inputs: [...manifest.inputs, ...manifest.inputs] }, { id: "../escape" }, { task: "" },
    { sources: [{ ...manifest.sources[0], url: "http://localhost:3000" }] },
    { sources: [{ ...manifest.sources[0], url: "https://example.com/?token=secret" }] }])
    expect(() => validateApp({ ...manifest, ...patch })).toThrow();
});

it("installs real processes/routes without running or scheduling; reinstall is idempotent", async () => {
  const s = setup(); const first = await s.install(); const second = await s.install();
  expect(second.id).toBe(first.id); expect(second.reused).toBe(true);
  expect(s.processes.startItem).not.toHaveBeenCalled();
  expect((s.db.prepare("SELECT COUNT(*) AS n FROM recurring_work").get() as any).n).toBe(0);
  const stages = s.db.prepare("SELECT driver FROM stages WHERE process_id=? ORDER BY position").all(first.processId);
  expect(stages.map((r: any) => r.driver)).toEqual(["agent", "review", "terminal"]);
  expect(first.agentIds).toHaveLength(2); expect(new Set(first.agentIds).size).toBe(2);
  await expect(s.install({ ...manifest, version: "0.2.0" })).rejects.toThrow("Remove");
});

it("repairs a partial install without duplicating agents or processes", async () => {
  const s = setup(); const original = s.product.command.bind(s.product); let failed = false;
  vi.spyOn(s.product, "command").mockImplementation(async (input: any) => {
    if (input.action === "set_stage_route" && !failed) { failed = true; throw new Error("Interrupted"); }
    return original(input);
  });
  await expect(s.install()).rejects.toThrow("Interrupted");
  const before = (s.db.prepare("SELECT COUNT(*) AS n FROM processes").get() as any).n;
  const repaired = await s.install();
  expect((s.db.prepare("SELECT COUNT(*) AS n FROM processes").get() as any).n).toBe(before);
  expect(s.apps.installation(repaired.id).status).toBe("active");
});

it("does not copy app processes into unguarded native workflows", async () => {
  const s = setup(); const installed = await s.install();
  await expect(s.product.command({ action: "copy_process", processId: installed.processId, name: "Copy" }))
    .rejects.toThrow("permission boundary");
});

it("sources real tool results, scopes receipts and deduplicates records", async () => {
  const s = setup(); const installed = await s.install(); const work = await s.run(installed.id);
  const app = s.apps.context(work.id);
  const receipt = await s.apps.source(app, work.id, "public-feed", "help");
  const record = { key: "canonical-url", kind: "opportunity", title: "A request", body: "Source says help; buying intent unknown", evidenceIds: [receipt.id] };
  const first = s.apps.record(app, work.id, record);
  expect(s.apps.record(app, work.id, record).id).toBe(first.id);
  expect(s.apps.read(app).records).toHaveLength(1);
  const other = await s.install({ ...manifest, id: "other-app", name: "Other app" });
  const otherWork = await s.run(other.id); const otherApp = s.apps.context(otherWork.id);
  expect(s.apps.read(otherApp).records).toHaveLength(0);
  expect(() => s.apps.record(otherApp, otherWork.id, record)).toThrow("Evidence belongs");
  await expect(s.apps.source(app, work.id, "unknown", "help")).rejects.toThrow("not declared");
  for (let i = 1; i < 20; i++) await s.apps.source(app, work.id, "public-feed", "help");
  await expect(s.apps.source(app, work.id, "public-feed", "help")).rejects.toThrow("20-request");
});

it("rejects cross-workspace operations and requires explicit portfolio-read permission", async () => {
  const s = setup(); const first = await s.install(); const work = await s.run(first.id); const app = s.apps.context(work.id);
  s.apps.record(app, work.id, { key: "one", kind: "finding", title: "Finding", body: "Uncertain", evidenceIds: [] });
  const reviewer = await s.install({ ...manifest, id: "portfolio-review", name: "Review", permissions: ["public-sources", "portfolio-read"] });
  const reviewWork = await s.run(reviewer.id);
  expect(s.apps.read(s.apps.context(reviewWork.id)).records).toHaveLength(1);
  const org = (s.db.prepare("SELECT organization_id AS id FROM teams LIMIT 1").get() as any).id;
  const team = await s.product.command({ action: "create_team", organizationId: org, name: "Other" });
  const otherWorkspace = (s.db.prepare("SELECT id FROM workspaces WHERE team_id=?").get(team.id) as any).id;
  await expect(s.apps.command({ action: "run", workspaceId: otherWorkspace, installationId: first.id })).rejects.toThrow("another workspace");
  expect(s.apps.snapshot(otherWorkspace).records).toHaveLength(0);
});

it("caps native work admission across apps while allowing retries of the same item", async () => {
  const s = setup(); const installed = await s.install();
  await s.apps.command({ action: "portfolio", workspaceId: s.workspaceId, goal: "Learn", capCents: 0, maxRuns: 1 });
  const first = await s.run(installed.id); s.apps.context(first.id); s.apps.context(first.id);
  const second = await s.run(installed.id);
  expect(() => s.apps.context(second.id)).toThrow("daily app-run limit");
});

it("binds human decisions to immutable drafts and reserves shared budget atomically", async () => {
  const s = setup(); const installed = await s.install(); const work = await s.run(installed.id); const app = s.apps.context(work.id);
  const propose = (destination: string) => s.apps.draft(app, work.id, { destination, account: "test-user", content: "Exact copy", rationale: "Test only", costCents: 60 });
  const first = propose("https://example.com/a"); const second = propose("https://example.com/b");
  const decide = (id: string, digest: string) => s.apps.command({ action: "decide", workspaceId: s.workspaceId, actionId: id, digest, decision: "approve" });
  const digest = (id: string) => s.apps.snapshot(s.workspaceId).actions.find((a: any) => a.id === id).digest;
  await expect(decide(first.id, "changed")).rejects.toThrow("changed");
  await expect(decide(first.id, digest(first.id))).rejects.toThrow("cap");
  await s.apps.command({ action: "portfolio", workspaceId: s.workspaceId, goal: "Learn", capCents: 100, maxRuns: 5 });
  expect((await decide(first.id, digest(first.id))).sent).toBe(false);
  await expect(decide(second.id, digest(second.id))).rejects.toThrow("cap");
  expect(s.apps.snapshot(s.workspaceId).reservedCents).toBe(60);
  await expect(decide(first.id, digest(first.id))).rejects.toThrow("already decided");
  s.db.prepare("UPDATE app_actions SET expires_at='2000-01-01' WHERE id=?").run(first.id);
  expect(s.apps.snapshot(s.workspaceId).reservedCents).toBe(0);
  await s.apps.command({ action: "suppress", workspaceId: s.workspaceId, destination: "https://example.com/b" });
  expect(s.apps.snapshot(s.workspaceId).actions.find((a: any) => a.id === second.id).status).toBe("cancelled");
  expect(() => propose("https://example.com/b")).toThrow("suppressed");
  expect(s.apps.snapshot(s.workspaceId).sendingEnabled).toBe(false);
});

it("retains data on removal and denies old process runs after reinstall", async () => {
  const s = setup(); const installed = await s.install(); const work = await s.run(installed.id);
  s.apps.record(s.apps.context(work.id), work.id, { key: "one", kind: "finding", title: "Keep", body: "Keep this", evidenceIds: [] });
  s.db.prepare("UPDATE work_items SET runtime_phase='completed' WHERE id=?").run(work.id);
  await s.apps.command({ action: "remove", installationId: installed.id, workspaceId: s.workspaceId });
  expect(() => s.apps.context(work.id)).toThrow("not active");
  expect(s.apps.snapshot(s.workspaceId).records).toHaveLength(1);
  const fresh = await s.install({ ...manifest, version: "0.2.0" });
  expect(fresh.id).toBe(installed.id);
  expect(() => s.apps.context(work.id)).toThrow("older app version");
  expect(s.apps.snapshot(s.workspaceId).records).toHaveLength(1);
});

it("guards every alternate execution path, including tools registered later", () => {
  const s = setup(); const guards: any[] = []; const definitions: any[] = [];
  const context = { tools: { restrict: vi.fn(), guard: (fn: any) => guards.push(fn), register: (tool: any) => definitions.push(tool) }, systemPrompt: { section: vi.fn() } };
  mountAppTools(context, s.apps, { id: "app", config: {}, manifest }, { stagePurpose: "worker", workItemId: "one" });
  for (const name of ["bash", "run_code", "mcp__browser__click", "mcp__mail__send", "bees_control", "bees_delegate_work", "bees_publish_outputs", "new_tool_registered_later"])
    expect(guards[0]({ name })).toContain("not permitted");
  expect(guards[0]({ name: "bees_app_record" })).toBeUndefined();
  expect(appToolDenial("bees_app_record", true)).toContain("not permitted");
  expect(appToolDenial("bees_app_read", true)).toBeUndefined();
  expect(definitions.some((d) => /send|execute_action|approve_action/.test(d.name))).toBe(false);
  expect(() => mountAppTools({ tools: {} }, s.apps, {}, {})).toThrow("cannot enforce");
});

it("mounts app restrictions in the actual agent setup without browser or unrelated tools", async () => {
  const s = setup(); const installed = await s.install(); const work = await s.run(installed.id);
  const registered: any[] = []; const guards: any[] = [];
  const browser = vi.spyOn(s.runtime, "startBrowserIfGranted");
  const folders = vi.spyOn(s.runtime, "boundFolders");
  await s.runtime.setup({
    systemPrompt: { section: vi.fn(), context: vi.fn() },
    tools: { register: (tool: any) => registered.push(tool), restrict: vi.fn(), guard: (fn: any) => guards.push(fn) }
  }, { mode: "work", stagePurpose: "worker", agentPresetId: "standard", workspaceId: s.workspaceId,
    workItemId: work.id, mcpAccess: "none", mcpServers: [], grants: [] }, "app-test", "/tmp");
  expect(browser).not.toHaveBeenCalled(); expect(folders).not.toHaveBeenCalled();
  expect(registered.map((t) => t.name)).toEqual(expect.arrayContaining(["bees_app_read", "bees_app_record", "bees_submit_stage_result"]));
  for (const tool of registered) expect(appToolDenial(tool.name)).toBeUndefined();
  expect(guards[0]({ name: "mcp__mail__send" })).toContain("not permitted");
});

it("blocks private, reserved and IPv6 source addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.1.1", "192.168.1.1", "169.254.169.254", "100.64.1.1", "0.0.0.0", "224.0.0.1", "198.18.1.1", "203.0.113.1", "::1", "::ffff:127.0.0.1"])
    expect(publicIPv4(address)).toBe(false);
  expect(publicIPv4("8.8.8.8")).toBe(true);
});

it("the actual DSH execution pipeline denies sending even when another policy allows it", async () => {
  const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
  const { Context } = require("@deepseek-ai/cordis");
  const { ToolRuntime, defineTool } = require("@deepseek-ai/dsh-tools");
  const ctx: any = new Context();
  ctx.systemPrompt = { tools: () => {}, section: () => {} };
  const tools = new ToolRuntime(ctx);
  let sent = false;
  tools.register(defineTool({ name: "send_test", description: "Harmless denied-send fixture", parameters: {},
    output: { schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean", required: true } } } },
    execute: async () => { sent = true; return { ok: true }; }
  }));
  const unguard = tools.guard((exec: any) => appToolDenial(exec.name));
  try {
    const result: any = await tools.execute({ callId: "app-denial-test" as any, name: "send_test", arguments: {}, signal: new AbortController().signal });
    expect(result.isError).toBe(true);
    expect(sent).toBe(false);
    expect(JSON.stringify(result)).toContain("not permitted");
  } finally { unguard(); }
});

it("does not change a running item's configuration when future work is configured", async () => {
  const s = setup(); const installed = await s.install(); const first = await s.run(installed.id);
  expect(s.apps.context(first.id).config.topic).toBe("Useful research");
  await s.apps.command({ action: "configure", workspaceId: s.workspaceId, installationId: installed.id, config: { topic: "Next topic" } });
  expect(s.apps.context(first.id).config.topic).toBe("Useful research");
  const second = await s.run(installed.id);
  expect(s.apps.context(second.id).config.topic).toBe("Next topic");
});

it("renders a small empty UI without starting any work", () => {
  const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
  const React = require("react"); const { renderToStaticMarkup } = require("react-dom/server");
  configureRuntime((id: string) => id === "react" ? React : {});
  const markup = renderToStaticMarkup(React.createElement(AppsPage, { workspaceId: "local", openWorkItem: () => {} }));
  expect(markup).toContain("Install an app package");
  expect(markup).toContain("no sending or paid execution");
  expect(markup).not.toContain("ACCOUNT-001");
});
