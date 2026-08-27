import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
    `).get()).toEqual({ organization: "Personal Org", team: "Team1", workspace: "My workspace" });
    expect(database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
        ('organization_memberships','team_memberships','team_locations','device_location_mappings')
      ORDER BY name
    `).all()).toEqual([
      { name: "device_location_mappings" }, { name: "organization_memberships" },
      { name: "team_locations" }, { name: "team_memberships" }
    ]);
    expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: 9 });

    database.exec("UPDATE organizations SET name = 'Personal'; UPDATE teams SET name = 'Personal'");
    database.exec("UPDATE stages SET completion_rules = 'Old goal instructions' WHERE name IN ('Work', 'Review'); PRAGMA user_version = 7");
    initializeProductDatabase(database);
    expect(database.prepare("SELECT name FROM organizations").get()).toEqual({ name: "Personal Org" });
    expect(database.prepare("SELECT name FROM teams").get()).toEqual({ name: "Team1" });
    expect(database.prepare("SELECT completion_rules AS instructions FROM stages WHERE name = 'Work'").get())
      .toEqual({ instructions: expect.stringContaining("next safe wave") });
    expect(database.prepare("SELECT completion_rules AS instructions FROM stages WHERE name = 'Review'").get())
      .toEqual({ instructions: expect.stringContaining("stop condition") });
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
    const processes = new ProcessRuntime(database.connection, { client: {
      workflow: {
        start: async (name: string, options: any) => { temporalStarts.push({ name, ...options }); },
        getHandle: () => ({ signal: async () => undefined, cancel: async () => undefined })
      }
    } });
    const product = new BeesProduct(database.connection, agents, processes, runRoot);
    await product.initialize();
    const initial = await product.snapshot();
    const workspace = initial.workspaces[0];
    const team = initial.teams[0];
    const organization = await product.command({ action: "create_organization", name: "Acme" });
    const organizationTeam = await product.command({ action: "create_team", organizationId: organization.id, name: "Marketing" });
    expect((await product.snapshot()).organizations).toContainEqual(expect.objectContaining({ id: organization.id, name: "Acme", role: "owner" }));
    expect((await product.snapshot()).teams).toContainEqual(expect.objectContaining({ id: organizationTeam.id, organizationId: organization.id, name: "Marketing" }));
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
      description: "Make DSH the product runtime"
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
    await expect(product.command({
      action: "attach_location", itemId: created.id, locationId: location.id, relativePath: "../outside"
    })).rejects.toThrow("cannot leave");
    await product.command({ action: "attach_location", itemId: created.id, locationId: location.id });

    const secondWorkspace = await product.command({ action: "create_workspace", teamId: team.id, name: "Campaigns" });
    const secondSnapshot = await product.snapshot();
    const secondGoals = secondSnapshot.processes.find(({ workspaceId, kind }: any) =>
      workspaceId === secondWorkspace.id && kind === "goals");
    const secondItem = await product.command({
      action: "create_goal", workspaceId: secondWorkspace.id, title: "Reuse team files"
    });
    await product.command({ action: "attach_location", itemId: secondItem.id, locationId: location.id });
    expect((await product.snapshot()).attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ workItemId: created.id, locationId: location.id }),
      expect.objectContaining({ workItemId: secondItem.id, locationId: location.id })
    ]));
    expect(secondGoals).toBeTruthy();

    const after = await product.snapshot();
    expect(after.locations).toContainEqual(expect.objectContaining({
      teamId: team.id, name: "Work", localPath: realpathSync(files), mapped: true
    }));
    expect(await product.search("Stage", workspace.id)).toContainEqual(expect.objectContaining({ id: created.id }));
    expect(await product.search("Honey", workspace.id)).toContainEqual(expect.objectContaining({
      kind: "file", title: "Work/brief.md"
    }));

    const newProcess = await product.command({
      action: "create_process", workspaceId: workspace.id, name: "Publishing", stages: ["Draft", "Published"]
    });
    await product.command({ action: "attach_location", processId: newProcess.id, locationId: location.id });
    await product.command({
      action: "edit_process", processId: newProcess.id, name: "Editorial",
      description: "Publish reviewed work", stages: ["Draft", "Polish", "Review", "Published"]
    });
    expect((await product.snapshot()).processes).toContainEqual(expect.objectContaining({
      id: newProcess.id, workspaceId: workspace.id, name: "Editorial"
    }));
    const writer = await product.command({
      action: "add_agent_assignment", workspaceId: workspace.id, presetId: "standard",
      name: "Content writer", capabilities: ["writing"], instructions: "Use the editorial voice"
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
    const automaticItem = await product.command({
      action: "create_run", processId: newProcess.id, title: "Publish this week"
    });
    const executionId = "editorial-stage";
    await product.runProcessStage({ workItemId: automaticItem.id, stageId: draft.id, executionId, purpose: "worker", instructions: "Draft it" });
    expect(stageRuns.at(-1)[1].initialData).toMatchObject({
      agentId: writer.id, agentName: "Content writer", grants: [location.id]
    });
    database.connection.prepare(`
      INSERT INTO execution_links
        (execution_id, workspace_id, work_item_id, agent_name, current_session_id,
         instance_uid, run_directory, config_json, status, created_at, updated_at)
      VALUES (?, ?, ?, 'Content writer', 'draft-session', 'draft-instance', ?, '{}',
        'completed', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')
    `).run(executionId, workspace.id, automaticItem.id, join(runRoot, "runs", executionId));
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
    expect(stageRuns.at(-1)[1].initialData.instructions).toBe("Use the editorial voice\n\nDraft it");
    await expect(product.command({
      action: "set_stage_route", stageId: draft.id, targetType: null, targetId: null
    })).rejects.toThrow("Finish or cancel active automatic work");
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

  it("shares file knowledge within a team and isolates it from other teams", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-knowledge-"));
    const firstFiles = join(root, "first-files");
    const secondFiles = join(root, "second-files");
    mkdirSync(firstFiles);
    mkdirSync(secondFiles);
    writeFileSync(join(firstFiles, "alpha.md"), "Alpha workspace knowledge");
    writeFileSync(join(secondFiles, "beta.md"), "Beta private team knowledge");
    const database = new NodeDatabase();
    const agents = new AgentRuntime({ on: () => () => undefined }, database.connection);
    const product = new BeesProduct(database.connection, agents, null, root);
    const initial = await product.snapshot();
    const firstWorkspace = initial.workspaces[0];
    const firstTeam = initial.teams[0];
    const siblingWorkspace = await product.command({
      action: "create_workspace", teamId: firstTeam.id, name: "Sibling"
    });
    const organization = await product.command({ action: "create_organization", name: "Other org" });
    const secondTeam = await product.command({
      action: "create_team", organizationId: organization.id, name: "Other team"
    });
    const secondWorkspace = await product.command({
      action: "create_workspace", teamId: secondTeam.id, name: "Other workspace"
    });
    await product.command({
      action: "add_location", teamId: firstTeam.id, name: "First", kind: "folder", path: firstFiles
    });
    await product.command({
      action: "add_location", teamId: secondTeam.id, name: "Second", kind: "folder", path: secondFiles
    });

    expect(await product.search("Alpha", firstWorkspace.id)).toContainEqual(expect.objectContaining({
      kind: "file", title: "First/alpha.md"
    }));
    expect(await product.search("Alpha", siblingWorkspace.id)).toContainEqual(expect.objectContaining({
      kind: "file", title: "First/alpha.md"
    }));
    expect(await product.search("Beta", firstWorkspace.id)).toEqual([]);
    expect(await product.search("Beta", secondWorkspace.id)).toContainEqual(expect.objectContaining({
      kind: "file", title: "Second/beta.md"
    }));
    expect(readdirSync(join(root, "knowledge"), { withFileTypes: true }).filter((entry) => entry.isDirectory()))
      .toHaveLength(2);
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
    expect(seen).toContainEqual(expect.objectContaining({
      url: "https://api.example/api/teams", authorization: "Bearer session-token",
      organization: "remote-org"
    }));

    await connected.signOut();
    expect(connected.publicAccount()).toBeNull();
    expect(database.prepare(`
      SELECT status FROM organization_memberships WHERE organization_id = 'remote-org'
    `).get()).toEqual({ status: "suspended" });
  });
});
