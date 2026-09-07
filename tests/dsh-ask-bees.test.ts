import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { BeesProduct } from "../dsh-runtime/plugin/lib/product.js";
import { NodeDatabase } from "./node-database.js";
// @ts-expect-error Client modules are plain JavaScript.
import { configureRuntime } from "../dsh-runtime/plugin/client/runtime.js";
// @ts-expect-error Client modules are plain JavaScript.
import { AskBeesSetup } from "../dsh-runtime/plugin/client/ask-bees.js";
// @ts-expect-error Client modules are plain JavaScript.
import { OutcomeWidget } from "../dsh-runtime/plugin/client/home.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
configureRuntime((id: string) => id === "react" ? React : {});

it("shows Goals, stage agents, connections and folders without starting anything", () => {
  const data = {
    teams: [{ id: "team", name: "Research", role: "admin" }], workspaces: [{ id: "workspace", teamId: "team" }],
    processes: [{ id: "goals", workspaceId: "workspace", kind: "goals" }],
    stages: [{ id: "work", name: "Work", processId: "goals", driver: "agent" },
      { id: "review", name: "Review", processId: "goals", driver: "review", agentIds: ["reviewer"] }],
    assignments: [{ id: "worker", name: "Worker", workspaceId: "workspace", systemRole: "worker", enabled: true, mcpAccess: "none" },
      { id: "reviewer", name: "Reviewer", workspaceId: "workspace", model: "provider/reviewer", enabled: true, mcpAccess: "all" }],
    processAttachments: [{ processId: "goals", locationId: "brief", relativePath: "project" }],
    agentAttachments: [{ agentAssignmentId: "worker", locationId: "brief", relativePath: "" }],
    locations: [{ id: "brief", name: "Brief", teamId: "team", kind: "folder", mapped: true }],
    systemDefaultModel: { provider: "provider", model: "default" }, proposals: []
  };
  let started = false;
  const render = (snapshot: any) => renderToStaticMarkup(React.createElement(AskBeesSetup, {
    ctx: { uiSession: {} }, data: snapshot, workspaceId: "workspace", outcome: "Research CRM options", capabilities: { data: {
      servers: [
        { id: "news", label: "News MCP", enabled: true, status: "connected" },
        { id: "drive", label: "Drive MCP", enabled: true, status: "connected" },
        { id: "browser", label: "Browser MCP", enabled: true, status: "connected" },
        { id: "mail", label: "Mail MCP", enabled: true, status: "connected" }
      ],
      catalog: [], tools: [], presets: [], skillsComplete: true,
      skills: [
        { name: "Source research", description: "Find reliable sources" },
        { name: "Writing" }, { name: "Review" }, { name: "Planning" }
      ]
    } },
    onOutcome: () => {}, onBack: () => {}, act: () => { started = true; }
  }));
  const markup = render(data);
  expect(markup).toContain("Configure advanced");
  expect(markup).toContain("Run process");
  expect(markup).toContain("Process template");
  expect(markup).toContain('value="goals" selected=""');
  expect(markup).toContain("bees-routing-board");
  expect(markup).toContain("Worker");
  expect(markup).toContain("Reviewer");
  expect(markup).toContain("Default agent");
  expect(markup).toContain("MCP connections");
  expect(markup).toContain("News MCP");
  expect(markup).toContain("Source research");
  expect(markup).toContain("See more");
  expect(markup).not.toContain("Mail MCP");
  expect(markup).not.toContain("Planning");
  expect(markup).not.toContain("Tools from MCP servers");
  expect(markup).toContain("Brief/project");
  expect(markup).toContain("Output folder");
  expect(markup).not.toContain("AI Model");
  expect(markup).not.toContain('name="model"');
  expect(started).toBe(false);
  expect(render({ ...data, teams: [{ ...data.teams[0], role: "viewer" }] })).toMatch(/<fieldset[^>]*disabled=""[^>]*>/);
});

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  configureRuntime((id: string) => id === "react" ? React : {});
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "bees-ask-"));
  roots.push(root);
  const database = new NodeDatabase().connection;
  const runtime: any = new AgentRuntime({
    on: () => () => undefined,
    agentPresets: { defaultId: "standard", mount: async () => undefined },
    tools: { schemas: () => [{ name: "mcp__news__read" }, { name: "mcp__other__read" }] }
  }, database);
  const dispatch = vi.spyOn(runtime, "dispatch").mockResolvedValue({ sessionId: "ask-session", status: "queued" });
  const processes = {
    startItem: vi.fn(async () => ({ status: "started" })),
    isAutomatic: () => true,
    createRecurring: vi.fn(async () => ({}))
  };
  const capabilities = {
    presetTools: async () => [{ id: "standard", skills: [{ name: "research", description: "Research sources" }] }],
    command: vi.fn(async () => ({ id: "installed" }))
  };
  const product = new BeesProduct(database, runtime, processes, root, { capabilities });
  const workspaceId = database.prepare("SELECT id FROM workspaces LIMIT 1").get()!.id as string;
  const propose = (changes: any[], runSettings = {}) => product.storeProposal({
    workspaceId, sessionId: "ask-session", title: "Requested work", changes, runSettings
  });
  return { database, runtime, dispatch, processes, capabilities, product, workspaceId, propose };
}

it("briefs Ask with existing resources in its workspace and keeps new setup reviewable", async () => {
  const { database, product, dispatch, workspaceId, propose, capabilities } = setup();
  const goals = database.prepare("SELECT id FROM processes WHERE workspace_id = ? AND kind = 'goals'").get(workspaceId)!;
  const team = database.prepare("SELECT team_id AS id FROM workspaces WHERE id = ?").get(workspaceId) as { id: string };
  const organization = database.prepare("SELECT organization_id AS id FROM teams WHERE id = ?").get(team.id)!;
  const other = await product.command({ action: "create_team", organizationId: organization.id, name: "Other team" });
  const otherWorkspace = database.prepare("SELECT id FROM workspaces WHERE team_id = ?").get(other.id)!;
  const privateProcess = await product.command({ action: "create_process", workspaceId: otherWorkspace.id, name: "Private launch", stages: ["Work", "Done"] });
  const privateAgent = await product.command({ action: "add_agent_assignment", workspaceId: otherWorkspace.id, name: "Private agent", presetId: "standard" });
  await product.command({ action: "create_process", workspaceId, name: "News brief", description: "Summarize news", stages: ["Work", "Done"] });
  const archived = await product.command({ action: "create_process", workspaceId, name: "Old brief", stages: ["Work", "Done"] });
  database.prepare("UPDATE processes SET archived_at = '2026-09-06' WHERE id = ?").run(archived.id);
  await product.command({ action: "ask_bees", workspaceId, outcome: "Brief me every morning", mcpAccess: "none" });
  const payload: any = dispatch.mock.calls[0]![2];
  expect(payload.body).toContain(String(goals.id));
  expect(payload.body).toContain('"name":"News brief"');
  expect(payload.body).toContain('"name":"research"');
  expect(payload.body).toContain('"systemRole":"reviewer"');
  expect(payload.body).not.toContain("Private launch");
  expect(payload.body).not.toContain("Private agent");
  expect(payload.body).not.toContain("Old brief");
  expect(payload.initialData.instructions).toContain("default to Goals");
  expect(() => propose([{ action: "create_item", process: privateProcess.id, title: "Wrong workspace" }])).toThrow("active in this workspace");
  expect(() => propose([{ action: "set_stage_route", process: "Goals", stage: "Work", agents: [privateAgent.id] }])).toThrow("active in this workspace");

  const proposal = propose([
    { action: "add_agent_assignment", name: "Editor", instructions: "Check the copy" },
    { action: "create_process", name: "Publishing", stages: [{ name: "Edit", driver: "agent", requiresHumanApproval: true }, "Done"] },
    { action: "set_stage_route", process: "Publishing", stage: "Edit", agents: ["Editor"] },
    { action: "install_skill", repo: "example/skills", directory: "editor" }
  ]);
  expect(database.prepare("SELECT id FROM processes WHERE name = 'Publishing'").get()).toBeUndefined();
  expect(capabilities.command).not.toHaveBeenCalled();
  await product.command({ action: "apply_proposal", proposalId: proposal.id });
  expect(database.prepare("SELECT name FROM agent_assignments WHERE name = 'Editor'").get()).toEqual({ name: "Editor" });
  expect(database.prepare("SELECT requires_human_approval AS approval FROM stages WHERE name = 'Edit'").get()).toEqual({ approval: 1 });
  expect(capabilities.command).toHaveBeenCalledWith(expect.objectContaining({ action: "install_skill" }));
});

it("reuses Goals and custom processes without replacing routes or same-title work", async () => {
  const { database, product, processes, workspaceId, propose } = setup();
  const existing = await product.command({ action: "create_process", workspaceId, name: "Research", stages: ["Work", "Done"] });
  const before = database.prepare("SELECT * FROM stage_routes ORDER BY stage_id").all();
  const agentsBefore = database.prepare("SELECT count(*) AS count FROM agent_assignments").get();
  const processesBefore = database.prepare("SELECT count(*) AS count FROM processes").get();
  const changes = [{ action: "create_goal", title: "Brief" }, { action: "create_item", process: "research", title: "Brief" }];
  const first = await product.command({ action: "apply_proposal", proposalId: propose(changes).id });
  const second = await product.command({ action: "apply_proposal", proposalId: propose(changes).id });
  expect(second.results[0].id).not.toBe(first.results[0].id);
  expect(second.results[1].id).not.toBe(first.results[1].id);
  expect(database.prepare("SELECT process_id AS processId FROM work_items WHERE id = ?").get(second.results[1].id))
    .toEqual({ processId: existing.id });
  expect(database.prepare("SELECT * FROM stage_routes ORDER BY stage_id").all()).toEqual(before);
  expect(database.prepare("SELECT count(*) AS count FROM agent_assignments").get()).toEqual(agentsBefore);
  expect(database.prepare("SELECT count(*) AS count FROM processes").get()).toEqual(processesBefore);
  expect(processes.startItem).toHaveBeenCalledTimes(4);
});

it.each(["create_goal", "create_item"])("retries %s and its schedule without starting the work twice", async (action) => {
  const { database, product, processes, propose } = setup();
  const proposal = propose([
    { action, process: "Goals", title: "Morning brief" },
    { action: "create_recurring_work", item: "Morning brief", name: "Daily brief", frequency: "daily", hour: 9, timezone: "America/Los_Angeles" }
  ]);
  processes.createRecurring.mockRejectedValueOnce(new Error("Scheduler offline"));
  await expect(product.command({ action: "apply_proposal", proposalId: proposal.id })).rejects.toThrow("Scheduler offline");
  expect(database.prepare("SELECT status FROM bees_proposals WHERE id = ?").get(proposal.id)).toEqual({ status: "pending" });
  const applied = await product.command({ action: "apply_proposal", proposalId: proposal.id });
  expect(applied.results[0].reused).toBe(true);
  expect(processes.startItem).toHaveBeenCalledTimes(1);
  expect(database.prepare("SELECT count(*) AS count FROM recurring_work").get()).toEqual({ count: 1 });
  await expect(product.command({ action: "apply_proposal", proposalId: proposal.id })).rejects.toThrow("no longer pending");
  expect(() => propose([
    { action: "create_recurring_work", item: "Later", name: "Too early", frequency: "daily", hour: 9 },
    { action: "create_goal", title: "Later" }
  ])).toThrow("created earlier");
});

it("validates reused resources in the proposal workspace and again when applying", async () => {
  const { database, product, workspaceId, propose } = setup();
  const existing = await product.command({ action: "create_process", workspaceId, name: "Publishing", stages: ["Work", "Done"] });
  const worker = database.prepare("SELECT id, name FROM agent_assignments WHERE workspace_id = ? AND system_role = 'worker'").get(workspaceId) as { id: string; name: string };
  const proposal = propose([{ action: "set_stage_route", process: "Publishing", stage: "Work", agents: [worker.name] }]);
  const work = propose([{ action: "create_item", process: "Publishing", title: "Publish" }]);
  database.prepare("UPDATE processes SET name = 'Renamed' WHERE id = ?").run(existing.id);
  database.prepare("UPDATE agent_assignments SET name = 'Renamed worker' WHERE id = ?").run(worker.id);
  await product.command({ action: "create_process", workspaceId, name: "Publishing", stages: ["Work", "Done"] });
  await product.command({ action: "apply_proposal", proposalId: proposal.id });
  const applied = await product.command({ action: "apply_proposal", proposalId: work.id });
  expect(database.prepare("SELECT process_id AS id FROM work_items WHERE id = ?").get(applied.results[0].id)).toEqual({ id: existing.id });
  expect(database.prepare(`SELECT r.agent_assignment_id AS id FROM stage_routes r JOIN stages s ON s.id = r.stage_id
    WHERE s.process_id = ? AND s.name = 'Work'`).get(existing.id)).toEqual({ id: worker.id });
  expect(() => propose([{ action: "create_item", process: "Missing", title: "No" }])).toThrow("active in this workspace");
  expect(() => propose([{ action: "set_stage_route", process: existing.id, stage: "Done", agents: [worker.id] }])).toThrow("does not run an agent");
  const pending = propose([{ action: "create_item", process: existing.id, title: "Later" }]);
  database.prepare("UPDATE processes SET archived_at = '2026-09-06' WHERE id = ?").run(existing.id);
  await expect(product.command({ action: "apply_proposal", proposalId: pending.id })).rejects.toThrow("active in this workspace");
  database.prepare("UPDATE agent_assignments SET enabled = 0 WHERE id = ?").run(worker.id);
  expect(() => propose([{ action: "set_stage_route", process: "Goals", stage: "Work", agents: [worker.id] }])).toThrow("active in this workspace");
});

it.each(["provider/model", null])("carries Ask model %s and tool access through proposal, work and schedule", async (model) => {
  const { database, product, runtime, dispatch, workspaceId } = setup();
  database.prepare(`INSERT INTO mcp_servers
    (id, server_name, label, transport, command, args_json, enabled, created_at)
    VALUES ('news-id', 'news', 'News', 'stdio', 'news-server', '[]', 1, '2026-09-06')`).run();
  await product.command({ action: "ask_bees", workspaceId, outcome: "Morning brief", model,
    reasoningEffort: model ? "high" : null, mcpAccess: "listed", mcpServers: ["news-id"] });
  const payload: any = dispatch.mock.calls[0]![2];
  expect(payload.initialData.mcpServers).toEqual(["news"]);
  const tools: any[] = [];
  const prompts: string[] = [];
  const restrictions: string[] = [];
  await runtime.setup({
    systemPrompt: { section: ({ text }: any) => prompts.push(text), context: () => undefined },
    tools: { register: (tool: any) => tools.push(tool), restrict: ({ deny }: any) => restrictions.push(...deny) }
  }, payload.initialData, "ask-run", "/tmp");
  expect(restrictions).toContain("mcp__other__read");
  expect(restrictions).not.toContain("mcp__news__read");
  expect(prompts.join("\n")).toContain("Otherwise use create_goal");
  expect(prompts.join("\n")).toContain("Only propose create_process when the person explicitly asks");
  expect(tools.map(({ name }) => name)).not.toContain("bees_control");
  const proposal = await tools.find(({ name }) => name === "bees_propose_changes").execute({
    proposal_title: "Morning brief", proposal_summary: "Use Goals daily",
    changes_json: JSON.stringify([
      { action: "create_goal", title: "Brief", runSettings: { model: "unwanted/model", mcpAccess: "all" } },
      { action: "create_recurring_work", item: "Brief", name: "Daily brief", frequency: "daily", hour: 9 }
    ])
  }, { agent: { session: { id: "ask-session" } } });
  const settings = { ...(model ? { model, reasoningEffort: "high" } : {}), mcpAccess: "listed", mcpServers: ["news-id"] };
  const stored = JSON.parse(database.prepare("SELECT changes_json AS changes FROM bees_proposals WHERE id = ?").get(proposal.id)!.changes as string);
  expect(stored[0].runSettings).toEqual(settings);
  const applied = await product.command({ action: "apply_proposal", proposalId: proposal.id });
  for (const id of [applied.results[0].id, applied.results[1].sourceWorkItemId]) {
    expect(JSON.parse(database.prepare("SELECT run_settings_json AS settings FROM work_items WHERE id = ?").get(id)!.settings as string)).toEqual(settings);
  }
});

// Exercise the actual component handlers without adding a browser test dependency.
function component(component: any, props: any) {
  const state: any[] = [];
  let cursor = 0;
  configureRuntime((id: string) => id === "react" ? { ...React,
    useEffect: () => {}, useRef: () => ({ current: null }),
    useState: (initial: any) => {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (value: any) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    }
  } : {});
  return (match: (node: any) => boolean) => {
    cursor = 0;
    const visit = (node: any): any => {
      if (!node?.props) return;
      if (match(node)) return node;
      return React.Children.toArray(node.props.children).map(visit).find(Boolean);
    };
    const found = visit(component(props));
    expect(found).toBeTruthy();
    return found.props;
  };
}

it("runs defaults immediately through Goals without changing templates or opening configuration", async () => {
  const { database, product, processes, workspaceId, dispatch } = setup();
  const data = await product.snapshot();
  const act = vi.fn((command) => product.command(command));
  const configureGoal = vi.fn();
  const openWorkItem = vi.fn();
  const routes = database.prepare("SELECT * FROM stage_routes").all();
  const props = { data, workspaceId, outcome: "Research CRM options\nCompare pricing", setOutcome: vi.fn(), act, configureGoal, openWorkItem };
  const find = component(OutcomeWidget, props);
  expect(find((node) => node.props.children === "Run using defaults").type).toBe("submit");
  find((node) => node.props.children === "Configure advanced").onClick();
  expect(configureGoal).toHaveBeenCalledOnce();
  expect(act).not.toHaveBeenCalled();
  await find((node) => node.type === "form").onSubmit({ preventDefault() {} });
  // The form delegates to the async handler; allow its command to finish.
  await vi.waitFor(() => expect(openWorkItem).toHaveBeenCalledOnce());
  const id = openWorkItem.mock.calls[0]![0];
  expect(database.prepare("SELECT kind, title, description, run_settings_json AS settings FROM work_items WHERE id = ?").get(id))
    .toEqual({ kind: "goal", title: "Research CRM options", description: props.outcome, settings: "{}" });
  expect(processes.startItem).toHaveBeenCalledWith(id);
  expect(database.prepare("SELECT * FROM stage_routes").all()).toEqual(routes);
  expect(dispatch).not.toHaveBeenCalled();
});

it("starts the selected process with its agents and chosen folders", async () => {
  const { database, product, processes, workspaceId } = setup();
  const custom = await product.command({ action: "create_process", workspaceId, name: "Research", stages: ["Work", "Done"] });
  const data = await product.snapshot();
  const teamId = data.workspaces.find((row: any) => row.id === workspaceId)!.teamId;
  const folder = await product.command({ action: "add_location", teamId, name: "Brief", kind: "folder", path: roots.at(-1) });
  const onStarted = vi.fn();
  const act = vi.fn((command) => product.command(command));
  const find = component(AskBeesSetup, { data: await product.snapshot(), workspaceId, outcome: "Research options", act,
    capabilities: { data: {
      servers: ["One", "Two", "Three", "Four"].map((label, index) =>
        ({ id: String(index), label, enabled: true, status: "connected" })),
      skills: ["Read", "Write", "Review", "Plan"].map((name) => ({ name }))
    } }, onStarted, reload: vi.fn() });
  const form = () => find((node) => node.props.id === "bees-ask-run");
  expect(find((node) => node.props.name === "processId").value)
    .toBe(data.processes.find((row: any) => row.kind === "goals")!.id);
  find((node) => node.props.name === "processId").onChange({ target: { value: custom.id } });
  const resources = () => find((node) => node.type.name === "ResourceFields");
  resources().onInputIds([folder.id]);
  resources().onOutputId(folder.id);
  expect(() => find((node) => node.props.children === "Four")).toThrow();
  find((node) => node.props["aria-expanded"] === false).onClick();
  expect(find((node) => node.props.children === "Four")).toBeTruthy();
  find((node) => node.props["aria-expanded"] === false).onClick();
  expect(find((node) => node.props.children === "Plan")).toBeTruthy();
  expect(resources().inputIds).toEqual([folder.id]);
  expect(resources().outputId).toBe(folder.id);
  const board = find((node) => node.type.name === "ProcessRoutingBoard");
  expect(board.stages.every((stage: any) => stage.processId === custom.id)).toBe(true);
  const worker = data.assignments.find((agent: any) => agent.systemRole === "worker")!;
  board.onOpenAgent(worker.id);
  const agent = find((node) => node.type.name === "AgentEditForm");
  expect(agent.selected.id).toBe(worker.id);
  await form().onSubmit({ preventDefault() {} });
  expect(act).not.toHaveBeenCalled(); // Unsaved agent settings cannot be bypassed with Enter.
  agent.onSaved();
  await form().onSubmit({ preventDefault() {} });
  expect(onStarted).toHaveBeenCalledOnce();
  const id = onStarted.mock.calls[0]![0];
  expect(database.prepare("SELECT process_id AS processId, output_location_id AS outputId FROM work_items WHERE id = ?").get(id))
    .toEqual({ processId: custom.id, outputId: folder.id });
  expect(database.prepare("SELECT location_id AS id FROM work_item_locations WHERE work_item_id = ?").all(id)).toEqual([{ id: folder.id }]);
  expect(processes.startItem).toHaveBeenCalledWith(id);
});
