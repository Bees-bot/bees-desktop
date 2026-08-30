import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { ConnectedAccount } from "../dsh-runtime/plugin/lib/connected-account.js";
import { ProcessRuntime } from "../dsh-runtime/plugin/lib/process-runtime.js";
import { BeesProduct, initializeProductDatabase } from "../dsh-runtime/plugin/lib/product.js";
import { NodeDatabase } from "./node-database.js";

describe("Bees DSH product plugin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("recreates old metadata with the final local ownership hierarchy", () => {
    const database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE teams (id TEXT PRIMARY KEY); INSERT INTO teams VALUES ('old-team')");
    initializeProductDatabase(database);
    expect(database.prepare(`
      SELECT o.name AS organization, t.name AS team, w.name AS workspace
      FROM organizations o JOIN teams t ON t.organization_id = o.id
      JOIN workspaces w ON w.team_id = t.id
    `).get()).toEqual({ organization: "Personal Org", team: "Team1", workspace: "Default workspace" });
    expect(database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
        ('organization_memberships','team_memberships','team_locations','device_location_mappings','agent_locations')
      ORDER BY name
    `).all()).toEqual([
      { name: "agent_locations" }, { name: "device_location_mappings" }, { name: "organization_memberships" },
      { name: "team_locations" }, { name: "team_memberships" }
    ]);
    expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: 13 });

    database.exec(`
      UPDATE organizations SET name = 'Personal';
      UPDATE teams SET name = 'Personal';
      UPDATE workspaces SET name = 'My workspace';
      INSERT INTO teams(id, organization_id, name, personal, created_by, status, created_at, updated_at)
        SELECT 'orphan-team', o.id, 'Orphan', 0, u.id, 'active', '2026-08-28', '2026-08-28'
        FROM organizations o CROSS JOIN users u LIMIT 1;
    `);
    database.exec("PRAGMA user_version = 10");
    initializeProductDatabase(database);
    expect(database.prepare("SELECT name FROM organizations").get()).toEqual({ name: "Personal Org" });
    expect(database.prepare("SELECT name FROM teams WHERE personal = 1").get()).toEqual({ name: "Team1" });
    expect(database.prepare("SELECT name FROM workspaces WHERE team_id = 'orphan-team'").get())
      .toEqual({ name: "Default workspace" });
    expect(database.prepare("SELECT count(*) AS count FROM workspaces WHERE name = 'Default workspace'").get())
      .toEqual({ count: 2 });
    expect(database.prepare("PRAGMA table_info(stages)").all().map(({ name }: any) => name))
      .not.toContain("completion_rules");
  });

  it("previews run text files without allowing paths outside inputs and outputs", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-preview-"));
    const database = new NodeDatabase();
    const agents = new AgentRuntime({ on: () => () => undefined }, database.connection);
    const product = new BeesProduct(database.connection, agents, null, root);
    const workspaceId = (await product.snapshot()).workspaces[0].id;
    const runDirectory = join(root, "runs", "preview-run");
    mkdirSync(join(runDirectory, "inputs"), { recursive: true });
    mkdirSync(join(runDirectory, "outputs"), { recursive: true });
    writeFileSync(join(runDirectory, "inputs", "brief.md"), "# Brief\n\nChoose **one**.");
    writeFileSync(join(runDirectory, "outputs", "notes.txt"), "agent notes");
    writeFileSync(join(runDirectory, "secret.md"), "not previewable");
    database.connection.prepare(`
      INSERT INTO execution_links
        (execution_id, workspace_id, agent_name, current_session_id, instance_uid,
         run_directory, config_json, status, created_at, updated_at)
      VALUES ('preview-run', ?, 'Preview agent', 'preview-session', 'preview-instance',
        ?, '{"mode":"planning","purpose":"Preview outcome"}', 'waiting_for_input',
        '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')
    `).run(workspaceId, runDirectory);

    expect((await product.snapshot()).runs[0]).toMatchObject({
      mode: "planning", purpose: "Preview outcome",
      files: ["inputs/brief.md", "outputs/notes.txt"]
    });
    expect(product.runFile("preview-run", "inputs/brief.md")).toEqual({
      name: "brief.md", path: "inputs/brief.md", format: "markdown",
      content: "# Brief\n\nChoose **one**."
    });
    expect(() => product.runFile("preview-run", "outputs/../secret.md")).toThrow("cannot leave");
    expect(() => product.runFile("preview-run", "secret.md")).toThrow("Only run inputs and outputs");
    rmSync(root, { recursive: true });
  });

  it("browses mapped inputs before runs and rejects unavailable or escaped files", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-location-preview-"));
    try {
      const database = new NodeDatabase();
      const agents = new AgentRuntime({ on: () => () => undefined }, database.connection);
      const product = new BeesProduct(database.connection, agents, null, root);
      const initial = await product.snapshot();
      const teamId = initial.teams[0].id;
      const folder = join(root, "approved");
      mkdirSync(join(folder, "nested"), { recursive: true });
      writeFileSync(join(folder, "nested", "brief.md"), "# Brief");
      writeFileSync(join(folder, ".hidden.md"), "hidden");
      writeFileSync(join(folder, "large.txt"), "x".repeat(1_000_001));
      writeFileSync(join(folder, "image.png"), "binary");
      writeFileSync(join(root, "private.md"), "private");
      symlinkSync(join(root, "private.md"), join(folder, "escape.md"));
      const location = await product.command({ action: "add_location", teamId, name: "Inputs", kind: "folder", path: folder });
      expect(product.locationFile(location.id).entries.map((row: any) => row.name))
        .toEqual(["nested", "image.png", "large.txt"]);
      expect(product.locationFile(location.id, "nested").entries)
        .toEqual([{ name: "brief.md", path: "nested/brief.md", kind: "file" }]);
      expect(product.locationFile(location.id, "nested/brief.md"))
        .toMatchObject({ format: "markdown", content: "# Brief" });
      for (const path of ["../private.md", "/private.md", "escape.md", ".hidden.md", "large.txt", "image.png"])
        expect(() => product.locationFile(location.id, path)).toThrow();
      const file = await product.command({ action: "add_location", teamId, name: "Brief", kind: "file", path: join(folder, "nested", "brief.md") });
      expect(product.locationFile(file.id).content).toBe("# Brief");
      expect(() => product.locationFile(file.id, "other.md")).toThrow("already a file");
      await product.command({ action: "unmap_location", locationId: file.id });
      expect(() => product.locationFile(file.id)).toThrow("not mapped");
      database.connection.prepare("UPDATE team_memberships SET status = 'removed' WHERE team_id = ?").run(teamId);
      database.connection.prepare("UPDATE organization_memberships SET status = 'removed'").run();
      expect(() => product.locationFile(location.id)).toThrow("permission");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("stages process, work, and agent inputs once and follows process changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-inherited-inputs-"));
    try {
      const database = new NodeDatabase();
      const agents = new AgentRuntime({ on: () => () => undefined }, database.connection);
      const product = new BeesProduct(database.connection, agents, { startItem: async () => ({}) }, root);
      const initial = await product.snapshot();
      const { id: workspaceId } = initial.workspaces[0];
      const { id: teamId } = initial.teams[0];
      writeFileSync(join(root, "process.md"), "process");
      writeFileSync(join(root, "agent.md"), "agent");
      writeFileSync(join(root, "work.md"), "work");
      const locations = [];
      for (const name of ["process", "agent", "work"])
        locations.push(await product.command({ action: "add_location", teamId, name, kind: "file", path: join(root, `${name}.md`) }));
      const workflow = await product.command({ action: "create_process", workspaceId, name: "Attachments", stages: ["Draft", "Done"], inputLocationIds: [locations[0].id] });
      const agent = await product.command({ action: "add_agent_assignment", workspaceId, presetId: "standard", name: "Writer", inputLocationIds: [locations[0].id, locations[1].id] });
      const work = await product.command({ action: "create_item", processId: workflow.id, title: "Write", inputLocationIds: [locations[2].id] });
      const { stageInputs } = createRequire(import.meta.url)("../dsh-runtime/plugin/lib/product-files.js");
      const first = stageInputs(database.connection, work.id, join(root, "run-1"), agent.id);
      expect(first.map((row: any) => row.name)).toEqual(["agent", "process", "work"]);
      for (const row of first)
        expect(readFileSync(join(root, "run-1", row.stagedPath, `${row.name}.md`), "utf8")).toBe(row.name);
      await product.command({ action: "detach_location", processId: workflow.id, locationId: locations[0].id });
      expect(stageInputs(database.connection, work.id, join(root, "run-2"), null).map((row: any) => row.name)).toEqual(["work"]);
      expect((await product.snapshot()).attachments.filter((row: any) => row.workItemId === work.id))
        .toEqual([{ workItemId: work.id, locationId: locations[2].id, relativePath: "" }]);
      const folder = await product.command({ action: "add_location", teamId, name: "Folder", kind: "folder", path: root });
      for (const owner of [{ itemId: work.id }, { processId: workflow.id }]) {
        for (const relativePath of ["process.md", "agent.md"])
          await product.command({ ...owner, action: "attach_location", locationId: folder.id, relativePath });
        await product.command({ ...owner, action: "detach_location", locationId: folder.id, relativePath: "process.md" });
        const snapshot = await product.snapshot();
        const refs = owner.itemId ? snapshot.attachments : snapshot.processAttachments;
        expect(refs.filter((row: any) => row.locationId === folder.id).map((row: any) => row.relativePath)).toEqual(["agent.md"]);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps goal model and tool settings isolated and inherits them before delegated work starts", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-goal-setup-"));
    try {
      const database = new NodeDatabase();
      const agents = new AgentRuntime({ on: () => () => undefined }, database.connection);
      const execute = vi.spyOn(agents, "executeStage").mockResolvedValue({ outcome: "candidate" } as any);
      const starts: any[] = [];
      const product = new BeesProduct(database.connection, agents, { startItem: async (id: string) => {
        starts.push({ item: database.connection.prepare("SELECT * FROM work_items WHERE id = ?").get(id),
          inputs: database.connection.prepare("SELECT * FROM work_item_locations WHERE work_item_id = ?").all(id) });
        return {};
      } }, root);
      const initial = await product.snapshot();
      const workspaceId = initial.workspaces[0].id;
      const teamId = initial.teams[0].id;
      const process = initial.processes.find((row: any) => row.kind === "goals");
      const stages = initial.stages.filter((row: any) => row.processId === process.id && !row.isTerminal);
      writeFileSync(join(root, "brief.md"), "approved context");
      const input = await product.command({ action: "add_location", teamId, name: "Brief", kind: "file", path: join(root, "brief.md") });
      const output = await product.command({ action: "add_location", teamId, name: "Results", kind: "folder", path: root });
      const settings = { model: "test/goal-model", reasoningEffort: "high", mcpAccess: "none", mcpServers: [] };
      const goal = await product.command({ action: "create_goal", workspaceId, title: "Research", runSettings: settings,
        inputLocationIds: [input.id], outputLocationId: output.id });
      expect(JSON.parse(starts[0].item.run_settings_json)).toEqual(settings);
      expect(starts[0].inputs).toHaveLength(1);
      for (const stage of stages) await product.runProcessStage({ executionId: `goal-${stage.id}`, workItemId: goal.id,
        stageId: stage.id, stageName: stage.name, purpose: stage.driver === "review" ? "reviewer" : "worker" }, undefined);
      const configs = execute.mock.calls.map((call: any) => call[1].initialData);
      expect(configs).toHaveLength(2);
      for (const config of configs) expect(config).toMatchObject(settings);
      expect(configs[0].agentId).not.toBe(configs[1].agentId);
      expect(configs.find((config: any) => config.mode === "review").grants).toEqual([]);
      const child = (await product.createSubitems({ parentId: goal.id, items: [{ title: "Research sources" }] }))[0];
      expect(JSON.parse(starts[1].item.run_settings_json)).toEqual(settings);
      expect(starts[1].inputs.map((row: any) => row.location_id)).toEqual([input.id]);
      expect(starts[1].item.output_location_id).toBe(output.id);
      const snapshot = await product.snapshot();
      expect(snapshot.items.find((row: any) => row.id === child.id).runSettings).toEqual(settings);
      expect(snapshot.assignments).toEqual(initial.assignments);
      const ordinary = await product.command({ action: "create_goal", workspaceId, title: "Unchanged defaults" });
      expect((await product.snapshot()).items.find((row: any) => row.id === ordinary.id).runSettings).toEqual({});
      const system = await product.command({ action: "create_goal", workspaceId, title: "System model", runSettings: { model: null } });
      expect((await product.snapshot()).items.find((row: any) => row.id === system.id).runSettings)
        .toEqual({ model: null, reasoningEffort: null });
      const count = snapshot.items.length + 2;
      for (const runSettings of [[], { model: "bad-route" }, { model: 42 }, { mcpAccess: "invalid" },
        { mcpAccess: "listed", mcpServers: [] }, { reasoningEffort: "high" }, { grants: [output.id] }]) {
        await expect(product.command({ action: "create_goal", workspaceId, title: "Invalid", runSettings })).rejects.toThrow();
      }
      expect((await product.snapshot()).items).toHaveLength(count);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("intersects a goal's selected connections with the agent policy", async () => {
    const database = new NodeDatabase();
    database.connection.exec(`INSERT INTO mcp_servers (id, server_name, label, transport, enabled, created_at)
      VALUES ('a', 'alpha', 'Alpha', 'stdio', 1, ''), ('b', 'beta', 'Beta', 'stdio', 1, ''), ('off', 'offline', 'Offline', 'stdio', 0, '');`);
    const { mcpGrantFor } = createRequire(import.meta.url)("../dsh-runtime/plugin/lib/product-database.js");
    const agent = String(database.connection.prepare("SELECT id FROM agent_assignments LIMIT 1").get()!.id);
    const selected = { mcpAccess: "listed", mcpServers: ["a", "b", "off"] };
    expect(mcpGrantFor(database.connection, agent, selected)).toEqual({ mcpAccess: "listed", mcpServers: ["alpha", "beta"] });
    database.connection.prepare("UPDATE agent_assignments SET mcp_access = 'listed', mcp_servers_json = '[\"b\"]' WHERE id = ?").run(agent);
    expect(mcpGrantFor(database.connection, agent, selected)).toEqual({ mcpAccess: "listed", mcpServers: ["beta"] });
    expect(mcpGrantFor(database.connection, agent, { mcpAccess: "none" })).toEqual({ mcpAccess: "none", mcpServers: [] });
    database.connection.prepare("UPDATE agent_assignments SET mcp_access = 'none' WHERE id = ?").run(agent);
    expect(mcpGrantFor(database.connection, agent, { mcpAccess: "all" })).toEqual({ mcpAccess: "none", mcpServers: [] });
  });

  it("restarts a standalone planning question without changing its waiting state", async () => {
    const database = new NodeDatabase();
    const first = new AgentRuntime({ on: () => () => undefined }, database.connection);
    const workspace = database.connection.prepare(
      "SELECT id FROM workspaces ORDER BY created_at LIMIT 1"
    ).get() as { id: string };
    database.connection.prepare(`
      INSERT INTO execution_links
        (execution_id, workspace_id, agent_name, current_session_id, instance_uid,
         run_directory, config_json, status, created_at, updated_at)
      VALUES ('planning-run', ?, 'bees-run', 'planning-session', 'uid', '/tmp/planning-run',
        ?, 'running', '2026-01-01', '2026-01-01')
    `).run(workspace.id, JSON.stringify({
      version: 1, mode: "planning", purpose: "Launch safely", workspaceId: workspace.id
    }));
    first.onSessionEvent({ id: "planning-session" }, {
      type: "tool/call", seq: 4,
      data: { name: "ask_user_question", callId: "question-1", arguments: "Which market?" }
    });

    const replacement = new AgentRuntime({ on: () => () => undefined }, database.connection);
    const admit = vi.spyOn(replacement, "admit").mockResolvedValue({ submissionId: "replacement", uid: "uid" });
    const product = new BeesProduct(database.connection, replacement, null, "/tmp");
    await product.recoverRuns();

    expect(admit).toHaveBeenCalledWith("bees-run", "planning-run", {
      idempotencyKey: "runtime-recovery:planning-run:1",
      body: expect.stringMatching(/Outcome: Launch safely[\s\S]*Which market\?/)
    });
    expect(database.connection.prepare(
      "SELECT status FROM execution_links WHERE execution_id = 'planning-run'"
    ).get()).toEqual({ status: "waiting_for_input" });
  });

  it("restarts active standalone processing from its checkpoint", async () => {
    const database = new NodeDatabase();
    new AgentRuntime({ on: () => () => undefined }, database.connection);
    const workspace = database.connection.prepare(
      "SELECT id FROM workspaces ORDER BY created_at LIMIT 1"
    ).get() as { id: string };
    database.connection.prepare(`
      INSERT INTO execution_links
        (execution_id, workspace_id, agent_name, current_session_id, instance_uid,
         run_directory, config_json, status, created_at, updated_at)
      VALUES ('planning-run', ?, 'bees-run', 'planning-session', 'uid', '/tmp/planning-run',
        ?, 'running', '2026-01-01', '2026-01-01')
    `).run(workspace.id, JSON.stringify({
      version: 1, mode: "planning", purpose: "Launch safely", workspaceId: workspace.id
    }));

    const replacement = new AgentRuntime({ on: () => () => undefined }, database.connection);
    const admit = vi.spyOn(replacement, "admit").mockResolvedValue({ submissionId: "replacement", uid: "uid" });
    const product = new BeesProduct(database.connection, replacement, null, "/tmp");
    await product.recoverRuns();

    expect(admit).toHaveBeenCalledWith("bees-run", "planning-run", {
      idempotencyKey: "runtime-recovery:planning-run:1",
      body: expect.stringContaining("Outcome: Launch safely")
    });
    expect(database.connection.prepare(
      "SELECT status FROM execution_links WHERE execution_id = 'planning-run'"
    ).get()).toEqual({ status: "running" });
  });

  it("shares team locations and starts every process with visible default agents", async () => {
    const files = mkdtempSync(join(tmpdir(), "bees-product-"));
    const runRoot = mkdtempSync(join(tmpdir(), "bees-runs-"));
    writeFileSync(join(files, "brief.md"), "Honey launch requirements and milestones");
    const database = new NodeDatabase();
    const agents = new AgentRuntime({ on: () => () => undefined }, database.connection);
    const stageRuns: any[] = [];
    (agents as any).executeStage = async (...args: any[]) => { stageRuns.push(args); return { outcome: "candidate", summary: "Ready" }; };
    const temporalStarts: any[] = [];
    const scheduleCreates: any[] = [];
    const scheduleHandle = {
      describe: async () => ({ info: { nextActionTimes: [new Date("2026-08-24T16:00:00.000Z")] } }),
      update: async () => undefined, pause: async () => undefined,
      unpause: async () => undefined, delete: async () => undefined
    };
    const processes = new ProcessRuntime(database.connection, { client: {
      workflow: {
        start: async (name: string, options: any) => { temporalStarts.push({ name, ...options }); },
        getHandle: () => ({ signal: async () => undefined, cancel: async () => undefined })
      },
      schedule: {
        create: async (options: any) => { scheduleCreates.push(options); return scheduleHandle; },
        getHandle: () => scheduleHandle
      }
    } });
    const product = new BeesProduct(database.connection, agents, processes, runRoot);
    await product.initialize();
    const initial = await product.snapshot();
    const workspace = initial.workspaces[0];
    const team = initial.teams[0];
    const organization = await product.command({ action: "create_organization", name: "Acme" });
    const organizationTeam = await product.command({ action: "create_team", organizationId: organization.id, name: "Marketing" });
    const organizationSnapshot = await product.snapshot();
    expect(organizationSnapshot.organizations).toContainEqual(expect.objectContaining({ id: organization.id, name: "Acme", role: "owner" }));
    expect(organizationSnapshot.teams).toContainEqual(expect.objectContaining({ id: organizationTeam.id, organizationId: organization.id, name: "Marketing" }));
    expect(organizationSnapshot.workspaces.filter(({ teamId }: any) => teamId === organizationTeam.id))
      .toEqual([expect.objectContaining({
        id: organizationTeam.workspaceId, name: "Default workspace"
      })]);
    const goals = initial.processes.find(({ workspaceId, kind }: any) => workspaceId === workspace.id && kind === "goals");
    const work = initial.stages.find(({ processId, name }: any) => processId === goals.id && name === "Work");
    expect(initial.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Bees work agent", systemRole: "worker" }),
      expect.objectContaining({ name: "Bees reviewer", systemRole: "reviewer" })
    ]));
    const reviewer = initial.assignments.find(({ systemRole }: any) => systemRole === "reviewer");
    await product.command({
      action: "edit_agent_assignment", agentAssignmentId: reviewer.id, name: reviewer.name,
      presetId: "standard", description: "Review independently", instructions: "Challenge every claim",
      model: "test/reviewer", reasoningEffort: "high", capabilities: ["review"]
    });
    expect((await product.snapshot()).assignments).toContainEqual(expect.objectContaining({
      id: reviewer.id, name: "Bees reviewer", instructions: "Challenge every claim",
      model: "test/reviewer", reasoningEffort: "high"
    }));

    const created = await product.command({
      action: "create_goal", workspaceId: workspace.id, title: "Ship Stage 1",
      description: "Make DSH the product runtime", runSettings: { model: "test/goal", mcpAccess: "none" }
    });
    expect((await product.snapshot()).items).toContainEqual(expect.objectContaining({
      id: created.id, stageId: work.id, kind: "goal", title: "Ship Stage 1", runtimePhase: "running",
      agentAssignmentId: null
    }));
    await expect(product.command({ action: "move_item", itemId: created.id, stageId: work.id }))
      .rejects.toThrow("Temporal moves");
    expect(temporalStarts).toContainEqual(expect.objectContaining({ workflowId: `bees/work-item/${created.id}` }));
    const location = await product.command({
      action: "add_location", teamId: team.id, name: "Work", kind: "folder", path: files
    });
    const resourcedGoal = await product.command({
      action: "create_goal", workspaceId: workspace.id, title: "Shortlist candidates",
      inputLocationIds: [location.id], outputLocationId: location.id
    });
    expect((await product.snapshot()).items).toContainEqual(expect.objectContaining({
      id: resourcedGoal.id, outputLocationId: location.id
    }));
    expect((await product.snapshot()).attachments).toContainEqual(expect.objectContaining({
      workItemId: resourcedGoal.id, locationId: location.id
    }));
    await expect(product.command({
      action: "attach_location", itemId: created.id, locationId: location.id, relativePath: "../outside"
    })).rejects.toThrow("cannot leave");
    await product.command({ action: "attach_location", itemId: created.id, locationId: location.id });
    const delegated = await product.command({
      action: "create_item", processId: goals.id, parentId: created.id, title: "Delegated research"
    });
    await expect(product.command({
      action: "create_recurring_work", itemId: delegated.id, name: "Child schedule",
      frequency: "daily", hour: 9, minute: 0, timezone: "America/Los_Angeles"
    })).rejects.toThrow("child work cannot be scheduled");
    const recurring = await product.command({
      action: "create_recurring_work", itemId: created.id, name: "Daily Stage 1",
      frequency: "daily", hour: 9, minute: 0, timezone: "America/Los_Angeles"
    });
    const scheduled = await product.snapshot();
    expect(scheduled.items).toContainEqual(expect.objectContaining({
      id: recurring.sourceWorkItemId, parentId: null, stageId: work.id,
      title: "Ship Stage 1", runtimePhase: "ready", recurringWorkId: recurring.id,
      runSettings: { model: "test/goal", reasoningEffort: null, mcpAccess: "none", mcpServers: [] }
    }));
    expect(scheduled.items.some(({ parentId }: any) => parentId === recurring.sourceWorkItemId)).toBe(false);
    expect(scheduled.attachments).toContainEqual(expect.objectContaining({
      workItemId: recurring.sourceWorkItemId, locationId: location.id
    }));
    expect(temporalStarts.some(({ workflowId }) => workflowId === `bees/work-item/${recurring.sourceWorkItemId}`)).toBe(false);
    expect(scheduleCreates).toContainEqual(expect.objectContaining({
      scheduleId: `bees/recurring/${recurring.id}`,
      spec: { calendars: [{ hour: 9, minute: 0 }], timezone: "America/Los_Angeles" }
    }));
    const occurrence = await processes.createRecurringWorkItem(recurring.id);
    expect((await product.snapshot()).items.find((item: any) => item.id === occurrence.workItemId)?.runSettings)
      .toEqual({ model: "test/goal", reasoningEffort: null, mcpAccess: "none", mcpServers: [] });

    expect((await product.snapshot()).attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ workItemId: created.id, locationId: location.id }),
      expect.objectContaining({ workItemId: resourcedGoal.id, locationId: location.id })
    ]));

    const after = await product.snapshot();
    expect(after.locations).toContainEqual(expect.objectContaining({
      teamId: team.id, name: "Work", localPath: realpathSync(files), mapped: true
    }));
    expect(await product.search("Stage", workspace.id)).toContainEqual(expect.objectContaining({ id: created.id }));
    expect(await product.search("Honey", workspace.id)).toContainEqual(expect.objectContaining({
      kind: "file", title: "Work/brief.md"
    }));

    const newProcess = await product.command({
      action: "create_process", workspaceId: workspace.id, name: "Publishing", stages: ["Draft", "Published"],
      inputLocationIds: [location.id], outputLocationId: location.id
    });
    await product.command({
      action: "edit_process", processId: newProcess.id, name: "Editorial",
      description: "Publish reviewed work", stages: ["Draft", "Polish", "Review", "Published"]
    });
    expect((await product.snapshot()).processes).toContainEqual(expect.objectContaining({
      id: newProcess.id, workspaceId: workspace.id, name: "Editorial", outputLocationId: location.id
    }));
    const writer = await product.command({
      action: "add_agent_assignment", workspaceId: workspace.id, presetId: "standard",
      name: "Content writer", capabilities: ["writing"], instructions: "Use the editorial voice",
      inputLocationIds: [location.id]
    });
    const backupReviewer = await product.command({
      action: "add_agent_assignment", workspaceId: workspace.id, presetId: "standard",
      name: "Backup reviewer", capabilities: ["review"]
    });
    const reviewPool = await product.command({
      action: "add_agent_pool", workspaceId: workspace.id, name: "Editorial reviewers",
      description: "Independent review"
    });
    await product.command({
      action: "set_agent_pool_member", agentPoolId: reviewPool.id,
      agentAssignmentId: reviewer.id, priority: 10
    });
    await product.command({
      action: "set_agent_pool_member", agentPoolId: reviewPool.id,
      agentAssignmentId: backupReviewer.id, priority: 10
    });
    const routed = await product.snapshot();
    const draft = routed.stages.find(({ processId, name }: any) => processId === newProcess.id && name === "Draft");
    const polish = routed.stages.find(({ processId, name }: any) => processId === newProcess.id && name === "Polish");
    const review = routed.stages.find(({ processId, name }: any) => processId === newProcess.id && name === "Review");
    await product.command({
      action: "set_stage_route", stageId: draft.id, targetType: "agent", targetId: writer.id,
      requiredCapabilities: ["writing"]
    });
    await product.command({
      action: "set_stage_route", stageId: polish.id, targetType: "agent", targetId: writer.id,
      requiredCapabilities: ["writing"]
    });
    await product.command({
      action: "set_stage_route", stageId: review.id, targetType: "pool", targetId: reviewPool.id,
      requiredCapabilities: ["review"]
    });
    expect((await product.snapshot()).stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: draft.id, routeType: "agent", routeTargetId: writer.id, requiredCapabilities: ["writing"] }),
      expect.objectContaining({ id: polish.id, routeType: "agent", routeTargetId: writer.id, requiredCapabilities: ["writing"] }),
      expect.objectContaining({ id: review.id, routeType: "pool", routeTargetId: reviewPool.id, requiredCapabilities: ["review"] })
    ]));
    expect((await product.snapshot()).agentAttachments).toContainEqual(expect.objectContaining({
      agentAssignmentId: writer.id, locationId: location.id
    }));
    const automaticItem = await product.command({
      action: "create_run", processId: newProcess.id, title: "Publish this week"
    });
    const executionId = "editorial-stage";
    await product.runProcessStage({ workItemId: automaticItem.id, stageId: draft.id, executionId, purpose: "worker", instructions: "Draft it" });
    expect(stageRuns.at(-1)[1].initialData).toMatchObject({
      agentId: writer.id, agentName: "Content writer", grants: [location.id]
    });
    expect(stageRuns.at(-1)[1].body).toContain("When the goal explicitly requires a delegation protocol or count, follow it exactly");
    expect(stageRuns.at(-1)[1].body).toContain(`Available input snapshots:\n- Work: inputs/Work-${location.id.slice(0, 8)}`);
    database.connection.prepare(`
      INSERT INTO execution_links
        (execution_id, workspace_id, work_item_id, agent_name, current_session_id,
         instance_uid, run_directory, config_json, status, created_at, updated_at)
      VALUES (?, ?, ?, 'Content writer', 'draft-session', 'draft-instance', ?, ?,
        'completed', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')
    `).run(executionId, workspace.id, automaticItem.id, join(runRoot, "runs", executionId), JSON.stringify({
      workItemId: automaticItem.id, workspaceId: workspace.id, grants: [location.id]
    }));
    await product.command({ action: "set_output_location", processId: newProcess.id, locationId: null });
    await expect(product.command({ action: "publish_run", executionId, locationId: location.id }))
      .rejects.toThrow("not granted");
    await product.command({ action: "set_output_location", processId: newProcess.id, locationId: location.id });
    database.connection.prepare(`
      INSERT INTO bees_stage_results VALUES (?, 'worker', 'candidate', ?, '2026-08-23T00:00:00.000Z')
    `).run(executionId, "Draft complete; do not repeat it");
    writeFileSync(join(runRoot, "runs", executionId, "outputs", "draft.md"), "finished draft");
    await product.runProcessStage({ workItemId: automaticItem.id, stageId: polish.id,
      executionId: "editorial-polish", candidateExecutionId: executionId,
      purpose: "worker", stageName: "Polish", instructions: "Polish it" });
    expect(stageRuns.at(-1)[1].initialData).toMatchObject({
      agentId: writer.id, agentName: "Content writer"
    });
    expect(stageRuns.at(-1)[1].body).toContain("do not recreate completed work or repeat approvals/actions");
    expect(stageRuns.at(-1)[1].body).toContain("Draft complete; do not repeat it");
    expect(readFileSync(join(runRoot, "runs", "editorial-polish", "outputs", "draft.md"), "utf8"))
      .toBe("finished draft");
    await product.command({
      action: "edit_agent_assignment", agentAssignmentId: writer.id, presetId: "standard",
      name: "Content writer", capabilities: ["writing"], instructions: "Use a changed voice"
    });
    await product.runProcessStage({ workItemId: automaticItem.id, stageId: draft.id, executionId, purpose: "worker", instructions: "Draft it" });
    expect(stageRuns.at(-1)[1].initialData.instructions).toBe("Use the editorial voice");
    const expectedReviewers = [reviewer.id, backupReviewer.id].sort();
    await product.runProcessStage({ workItemId: automaticItem.id, stageId: review.id,
      executionId: "editorial-review", candidateExecutionId: executionId,
      purpose: "reviewer", instructions: "Review it" });
    expect(stageRuns.at(-1)[1].initialData).toMatchObject({
      agentId: expectedReviewers[0], grants: []
    });
    expect(stageRuns.at(-1)[1].body).toContain("inputs/execution-evidence.json");
    expect(JSON.parse(readFileSync(
      join(runRoot, "runs", "editorial-review", "inputs", "execution-evidence.json"), "utf8"
    ))).toMatchObject({ candidateExecutionId: executionId, executions: [{ executionId }] });
    await product.runProcessStage({ workItemId: automaticItem.id, stageId: review.id,
      executionId: "editorial-review-2", purpose: "reviewer", instructions: "Review it again" });
    expect(stageRuns.at(-1)[1].initialData.agentId).toBe(expectedReviewers[1]);
    await product.command({
      action: "edit_agent_assignment", agentAssignmentId: reviewer.id, name: reviewer.name,
      presetId: "standard", description: "Review independently", instructions: "Challenge every claim",
      model: "test/reviewer", capabilities: ["review"], maxConcurrency: 1
    });
    await product.command({
      action: "edit_agent_assignment", agentAssignmentId: backupReviewer.id,
      name: "Backup reviewer", presetId: "standard", capabilities: ["review"], maxConcurrency: 1
    });
    await expect(product.runProcessStage({ workItemId: automaticItem.id, stageId: review.id,
      executionId: "editorial-review-3", purpose: "reviewer", instructions: "Review when free" }))
      .resolves.toEqual({ outcome: "waiting", summary: "The Editorial reviewers pool is at capacity" });
    expect(database.connection.prepare(`
      SELECT target_type, target_id, agent_assignment_id, reason
      FROM agent_dispatches WHERE execution_id = 'editorial-review'
    `).get()).toEqual(expect.objectContaining({
      target_type: "pool", target_id: reviewPool.id,
      agent_assignment_id: expectedReviewers[0], reason: expect.stringContaining("least recently assigned")
    }));
    expect(temporalStarts).toContainEqual(expect.objectContaining({ workflowId: `bees/work-item/${automaticItem.id}` }));
    expect((await product.snapshot()).processAttachments).toContainEqual(expect.objectContaining({
      processId: newProcess.id, locationId: location.id
    }));
    expect(readFileSync(join(
      runRoot, "runs", executionId, "inputs", `Work-${location.id.slice(0, 8)}`, "brief.md"
    ), "utf8")).toContain("Honey launch");

    const savedTemplate = await product.command({
      action: "save_process_template", processId: newProcess.id, name: "Editorial blueprint"
    });
    expect((await product.snapshot()).templates).toContainEqual(expect.objectContaining({
      id: savedTemplate.id, name: "Editorial blueprint",
      stages: ["Draft", "Polish", "Review", "Published"]
    }));
    await product.command({ action: "archive_process_template", templateId: savedTemplate.id });
    expect((await product.snapshot()).templates).not.toContainEqual(expect.objectContaining({ id: savedTemplate.id }));
    const oldProcess = await product.command({
      action: "create_process", workspaceId: workspace.id, name: "Old process", stages: ["Start", "Done"]
    });
    await product.command({ action: "archive_process", processId: oldProcess.id });
    expect((await product.snapshot()).processes).not.toContainEqual(expect.objectContaining({ id: oldProcess.id }));

    await product.command({
      action: "attach_location", itemId: automaticItem.id, locationId: location.id, relativePath: "brief.md"
    });
    const [child] = await product.createSubitems({ parentId: automaticItem.id, items: [{ title: "Check links" }] });
    expect((await product.snapshot()).items).toContainEqual(expect.objectContaining({
      id: child.id, parentId: automaticItem.id, agentAssignmentId: null,
      runtimePhase: "running"
    }));
    expect((await product.snapshot()).attachments).toContainEqual(expect.objectContaining({
      workItemId: child.id, locationId: location.id, relativePath: "brief.md"
    }));
    const [sameChild] = await product.createSubitems({
      parentId: automaticItem.id, items: [{ title: "Check links", description: "Recovery retry" }]
    });
    expect(sameChild.id).toBe(child.id);
    await expect(product.createSubitems({
      parentId: automaticItem.id, items: [{ title: "One" }, { title: "Two" }]
    })).rejects.toThrow("exactly one");
    database.connection.prepare("UPDATE execution_links SET status = 'running' WHERE execution_id = ?")
      .run(executionId);
    await product.runProcessStage({
      workItemId: child.id, stageId: draft.id, executionId: "child-shared",
      purpose: "worker", instructions: "Use the shared workspace"
    });
    expect(stageRuns.at(-1)[1].workspace).toBe(join(runRoot, "runs", executionId));

    const proposal = product.storeProposal({
      workspaceId: workspace.id, sessionId: "planning-session", title: "Launch plan", summary: "Visible work",
      changes: [
        { action: "create_process", name: "Launch", description: "Repeatable release", stages: ["Plan", "Release"] },
        { action: "create_item", process: "Launch", title: "Launch safely", description: "Review every handoff" }
      ]
    });
    expect(() => product.storeProposal({
      workspaceId: workspace.id, sessionId: "planning-session", title: "Bad order", summary: "Invalid",
      changes: [
        { action: "create_item", process: "Later", title: "Too early" },
        { action: "create_process", name: "Later", stages: ["Work", "Done"] }
      ]
    })).toThrow("created earlier");
    await product.command({ action: "apply_proposal", proposalId: proposal.id });
    const applied = await product.snapshot();
    expect(applied.proposals).toContainEqual(expect.objectContaining({ id: proposal.id, status: "applied" }));
    const launch = applied.processes.find(({ name }: any) => name === "Launch");
    expect(launch).toBeTruthy();
    expect(applied.items).toContainEqual(expect.objectContaining({
      title: "Launch safely", kind: "work", processId: launch!.id
    }));

    rmSync(files, { recursive: true });
    rmSync(runRoot, { recursive: true });
  });

  it("isolates file knowledge between teams", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-knowledge-"));
    const firstFiles = join(root, "first-files");
    const secondFiles = join(root, "second-files");
    mkdirSync(firstFiles);
    mkdirSync(secondFiles);
    writeFileSync(join(firstFiles, "alpha.md"), `---
source_id: google-doc-123
created_at: 2026-08-01T10:00:00.000Z
modified_at: 2026-08-28T11:30:00.000Z
authority: current
supersedes: alpha-v1
---
Alpha workspace knowledge`);
    writeFileSync(join(secondFiles, "beta.md"), "Beta private team knowledge");
    const database = new NodeDatabase();
    const agents = new AgentRuntime({ on: () => () => undefined }, database.connection);
    const product = new BeesProduct(database.connection, agents, null, root);
    const initial = await product.snapshot();
    const firstWorkspace = initial.workspaces[0];
    const firstTeam = initial.teams[0];
    const organization = await product.command({ action: "create_organization", name: "Other org" });
    const secondTeam = await product.command({
      action: "create_team", organizationId: organization.id, name: "Other team"
    });
    await product.command({
      action: "add_location", teamId: firstTeam.id, name: "First", kind: "folder", path: firstFiles
    });
    await product.command({
      action: "add_location", teamId: secondTeam.id, name: "Second", kind: "folder", path: secondFiles
    });

    const alpha = (await product.search("Alpha", firstWorkspace.id)).find(({ kind }) => kind === "file");
    expect(alpha).toMatchObject({
      kind: "file", title: "First/alpha.md", sourceId: "google-doc-123", authority: "current",
      createdAt: "2026-08-01T10:00:00.000Z", modifiedAt: "2026-08-28T11:30:00.000Z",
      supersedes: "alpha-v1"
    });
    expect(product.readKnowledge(alpha.id, firstWorkspace.id)).toMatchObject({
      id: alpha.id, title: "First/alpha.md", authority: "current", truncated: false,
      content: expect.stringContaining("Alpha workspace knowledge")
    });
    expect(await product.search("Beta", firstWorkspace.id)).toEqual([]);
    expect(await product.search("Beta", secondTeam.workspaceId)).toContainEqual(expect.objectContaining({
      kind: "file", title: "Second/beta.md"
    }));
    expect(readdirSync(join(root, "knowledge"), { withFileTypes: true }).filter((entry) => entry.isDirectory()))
      .toHaveLength(2);
    rmSync(root, { recursive: true });
  });

  it("indexes local Google Workspace exports with source dates", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-google-knowledge-"));
    const pointers = join(root, "pointers");
    const exported = join(root, "exported");
    mkdirSync(pointers);
    writeFileSync(join(pointers, "strategy.gdoc"), JSON.stringify({ doc_id: "google-strategy" }));
    const googleDrive = {
      exportLocation: vi.fn(async (_teamId: string, location: any) => {
        mkdirSync(exported, { recursive: true });
        writeFileSync(join(exported, "strategy.md"), `---
source_id: google-strategy
created_at: 2026-08-01T10:00:00.000Z
modified_at: 2026-08-29T09:00:00.000Z
---

Current international expansion strategy`);
        return { ...location, id: "google-export", name: `${location.name} · Google`, kind: "folder", localPath: exported };
      })
    };
    const database = new NodeDatabase();
    const agents = new AgentRuntime({ on: () => () => undefined }, database.connection);
    const product = new BeesProduct(database.connection, agents, null, root, { googleDrive });
    const initial = await product.snapshot();
    await product.command({
      action: "add_location", teamId: initial.teams[0].id,
      name: "Executive Drive", kind: "folder", path: pointers
    });

    const result = (await product.search("international expansion", initial.workspaces[0].id))
      .find(({ kind }) => kind === "file");
    expect(result).toMatchObject({
      title: "Executive Drive · Google/strategy.md",
      sourceId: "google-strategy",
      createdAt: "2026-08-01T10:00:00.000Z",
      modifiedAt: "2026-08-29T09:00:00.000Z"
    });
    expect(product.readKnowledge(result.id, initial.workspaces[0].id).content)
      .toContain("Current international expansion strategy");
    expect(googleDrive.exportLocation).toHaveBeenCalledOnce();
    rmSync(root, { recursive: true });
  });

  it("keeps one connected account and mirrors its organization and team roles", async () => {
    const database = new DatabaseSync(":memory:");
    initializeProductDatabase(database);
    let storedToken = "";
    const credentials = {
      resolve: async () => storedToken ? { value: storedToken, source: "test" } : undefined,
      set: async (_ref: string, value: string) => { storedToken = value; },
      unset: async () => { storedToken = ""; }
    };
    const seen: { url: string; authorization: string | null; organization: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      seen.push({
        url,
        authorization: headers.get("authorization"),
        organization: headers.get("x-organization-id")
      });
      const body = url.endsWith("/api/auth/sign-in/email")
        ? { user: { id: "remote-user", email: "you@example.com", name: "You" } }
        : url.endsWith("/api/organizations")
          ? { organizations: [{ id: "remote-org", name: "Acme", role: "admin" }] }
          : url.endsWith("/api/teams")
            ? { teams: [{ id: "remote-team", name: "Design" }] }
            : url.endsWith("/api/teams/remote-team/members")
              ? { members: [{ id: "member-1", teamId: "remote-team", userId: "remote-user", role: "admin" }] }
              : url.includes("/api/sync/pull")
                ? { records: [], cursor: "0" }
                : url.endsWith("/api/sync/push")
                  ? { cursor: "0" }
              : url.endsWith("/api/me/organization-invitations")
                ? { invitations: [] }
                : { candidates: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          "content-type": "application/json",
          ...(url.endsWith("/api/auth/sign-in/email") ? { "set-auth-token": "session-token" } : {})
        }
      });
    }));

    const connected = new ConnectedAccount(database, credentials, "https://api.example");
    await connected.signIn("you@example.com", "password123");
    expect(connected.publicAccount()).toEqual({
      userId: "remote-user", email: "you@example.com", name: "You"
    });
    expect(database.prepare(`
      SELECT o.name, om.role, om.status FROM organizations o
      JOIN organization_memberships om ON om.organization_id = o.id
      WHERE o.id = 'remote-org'
    `).get()).toEqual({ name: "Acme", role: "admin", status: "active" });
    expect(database.prepare("SELECT name FROM teams WHERE id = 'remote-team'").get())
      .toEqual({ name: "Design" });
    expect(database.prepare("SELECT name FROM workspaces WHERE team_id = 'remote-team'").get())
      .toEqual({ name: "Default workspace" });
    expect(database.prepare(`
      SELECT min(created_at) AS createdAt FROM agent_assignments
      WHERE workspace_id = (SELECT id FROM workspaces WHERE team_id = 'remote-team')
    `).get()).toEqual({ createdAt: "1970-01-01T00:00:00.000Z" });
    expect(seen).toContainEqual(expect.objectContaining({
      url: "https://api.example/api/teams", authorization: "Bearer session-token",
      organization: "remote-org"
    }));
    expect(seen.some(({ url }) => url.includes("/api/sync/pull"))).toBe(true);

    await connected.signOut();
    expect(connected.publicAccount()).toBeNull();
    expect(database.prepare(`
      SELECT status FROM organization_memberships WHERE organization_id = 'remote-org'
    `).get()).toEqual({ status: "suspended" });
  });

  it("keeps supported sign-in choices visible when an older server has no public config", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    const connected = new ConnectedAccount({} as never, {} as never, "https://api.example");

    await expect(connected.authConfig()).resolves.toEqual({
      socialProviders: ["google", "github"],
      ssoEnabled: true,
      googleDriveDesktopClientId: ""
    });
  });

  it("expands the documented local server alias for browser sign-in", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    const connected = new ConnectedAccount({} as never, {} as never, "dev");

    await expect((connected as any).startBrowserSignIn("social", "google", 31415))
      .resolves.toMatchObject({
        url: expect.stringMatching(/^http:\/\/localhost:3000\/api\/auth\/desktop\/start\?/)
      });
  });
});
