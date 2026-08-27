import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";
import {
  currentIdentity, initializeProductDatabase, iso, itemContext, mcpGrantFor, message,
  processStages, required, workspaceContext
} from "./product-database.js";
import {
  logicalRelativePath, outputFiles, previewFiles, stageInputs, stageLocation, TEXT_EXTENSIONS
} from "./product-files.js";
import { TeamKnowledgeSearch } from "./product-knowledge.js";
import { AgentCapacityError, resolveStageAgent } from "./product-routing.js";
import { namePreset } from "./preset-names.js";
import { executeProductCommand } from "./product-commands.js";

export { initializeProductDatabase };

export class BeesProduct {
  constructor(database, agents, processes, defaultWorkspace, services = {}) {
    this.database = database;
    this.agents = agents;
    this.processes = processes;
    this.defaultWorkspace = defaultWorkspace;
    this.workspaceRegistry = services.workspaceRegistry;
    this.knowledge = new TeamKnowledgeSearch(defaultWorkspace);
    this.agentPresets = services.agentPresets;
    initializeProductDatabase(database);
    this.agents?.setProposalStore?.((proposal) => this.storeProposal(proposal));
    this.agents?.setKnowledgeSearch?.((query, workspaceId) => this.search(query, workspaceId));
    this.agents?.setSubitemStore?.({
      create: (input) => this.createSubitems(input),
      cancel: (workItemId) => this.processes.signal(workItemId, "cancel")
    });
  }

  async initialize() {
    mkdirSync(resolve(this.defaultWorkspace, "workspaces"), { recursive: true });
    mkdirSync(resolve(this.defaultWorkspace, "runs"), { recursive: true });
    if (!this.workspaceRegistry) return;
    for (const workspace of this.database.prepare(`
      SELECT id, name, dsh_workspace_id AS dshWorkspaceId FROM workspaces WHERE status = 'active'
    `).all()) {
      const path = resolve(this.defaultWorkspace, "workspaces", workspace.id);
      mkdirSync(path, { recursive: true });
      let record = workspace.dshWorkspaceId ? this.workspaceRegistry.get(workspace.dshWorkspaceId) : undefined;
      if (!record) record = await this.workspaceRegistry.create(path, workspace.name);
      if (String(record.id) !== workspace.dshWorkspaceId) this.database.prepare(`
        UPDATE workspaces SET dsh_workspace_id = ?, updated_at = ? WHERE id = ?
      `).run(String(record.id), iso(), workspace.id);
    }
  }

  async recoverRuns() {
    const runs = this.database.prepare(`
      SELECT execution_id AS executionId, work_item_id AS workItemId,
             recovery_count AS recoveryCount, config_json AS configJson
      FROM execution_links ORDER BY updated_at
    `).all().filter((run) => this.agents.needsRecovery(run.executionId));
    const recoveries = runs.flatMap((run) => {
      try { return this.recovery(run); }
      catch (error) {
        this.agents.ctx.logger.warn(`bees: could not recover ${run.executionId}: ${message(error)}`);
        return [];
      }
    });
    for (const settled of await Promise.allSettled(recoveries))
      if (settled.status === "rejected")
        this.agents.ctx.logger.warn(`bees: a run failed to resume: ${message(settled.reason)}`);
  }

  /** One unreadable row must not abort the whole recovery pass. */
  recovery(run) {
    const pending = this.agents.pendingInteraction(run.executionId);
    const data = JSON.parse(run.configJson);
    let body;
    if (!run.workItemId && data.mode === "planning") {
      body = `Plan this outcome for the current Bees workspace. Propose reviewable changes with bees_propose_changes; do not apply them yourself.\n\nOutcome: ${data.purpose}`;
    } else if (run.workItemId) {
      const lifecycle = this.database.prepare(`
        SELECT runtime_phase AS runtimePhase, archived_at AS archivedAt, deleted_at AS deletedAt
        FROM work_items WHERE id = ?
      `).get(run.workItemId);
      if (!lifecycle || lifecycle.archivedAt || lifecycle.deletedAt ||
        ["completed", "cancelled"].includes(lifecycle.runtimePhase)) return [];
      const item = itemContext(this.database, run.workItemId, ["admin", "member"]);
      if (this.processes?.isAutomatic(item.processId)) return [];
      body = `Complete this work item.\n\nTitle: ${item.title}\n\n${item.description}`;
    } else return [];
    if (pending?.kind === "question")
      body += `\n\nThe application restarted while waiting for the user. Re-present this unresolved question with ask_user_question before continuing:\n${pending.questions}`;
    return [this.agents.admit("bees-run", run.executionId, {
      idempotencyKey: `runtime-recovery:${run.executionId}:${Number(run.recoveryCount) + 1}`,
      body
    })];
  }

  async runProcessStage(stage, signal) {
    const item = itemContext(this.database, stage.workItemId, ["admin", "member"]);
    const executionId = required(stage.executionId, "Execution");
    let assignment;
    try {
      assignment = resolveStageAgent(this.database, {
        executionId, item, stageId: required(stage.stageId, "Stage"), purpose: stage.purpose,
        candidateExecutionId: stage.candidateExecutionId
      });
    } catch (error) {
      if (error instanceof AgentCapacityError) return { outcome: "waiting", summary: error.message };
      throw error;
    }
    const parentRun = item.parentId ? this.database.prepare(`
      SELECT run_directory AS runDirectory FROM execution_links
      WHERE work_item_id = ?
        AND status IN ('queued', 'running', 'waiting_for_input', 'waiting_for_approval')
      ORDER BY updated_at DESC LIMIT 1
    `).get(item.parentId) : null;
    const runDirectory = parentRun?.runDirectory ?? resolve(this.defaultWorkspace, "runs", executionId);
    const locations = stageInputs(this.database, item.id, runDirectory);
    const reviewer = stage.purpose === "reviewer";
    let candidateSummary = "";
    if (stage.candidateExecutionId) {
      const candidate = this.database.prepare(`
        SELECT e.run_directory AS runDirectory, r.summary
        FROM execution_links e
        LEFT JOIN bees_stage_results r ON r.execution_id = e.execution_id
        WHERE e.execution_id = ? AND e.work_item_id = ?
      `).get(stage.candidateExecutionId, item.id);
      if (!candidate) throw new Error("The review candidate is unavailable");
      candidateSummary = candidate.summary || "";
      const destination = reviewer
        ? resolve(runDirectory, "inputs", "candidate")
        : resolve(runDirectory, "outputs");
      mkdirSync(destination, { recursive: true });
      const source = resolve(candidate.runDirectory, "outputs");
      if (source !== destination)
        stageLocation({ name: "candidate", kind: "folder", localPath: source }, destination);
      if (reviewer) {
        const evidence = await this.agents.reviewEvidence(stage.candidateExecutionId);
        writeFileSync(resolve(runDirectory, "inputs", "execution-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
      }
    }
    const feedback = stage.feedback ? `\n\nPrior review feedback:\n${stage.feedback}` : "";
    const handoff = stage.candidateExecutionId && !reviewer
      ? `\n\nPrior-stage handoff: the previous deliverables are already copied into outputs/. Continue from them; do not recreate completed work or repeat approvals/actions already recorded. If they already satisfy this stage, preserve them and submit the candidate without redoing the goal.${candidateSummary ? `\n\nPrior-stage summary:\n${candidateSummary}` : ""}`
      : "";
    // A delegated peer runs in its caller's workspace, so files it never wrote are sitting next to its own.
    const shared = item.parentId
      ? " This work was delegated by another agent and ran in that caller's workspace, so files it did not write are present. Judge only what this stage was asked to produce, and never fail it for a file the caller left there."
      : "";
    const body = reviewer
      ? `Independently review the candidate under inputs/candidate.${shared} Verify the real deliverables and run relevant checks. When present, inputs/execution-evidence.json is system-generated from Bees runs and audit records; use it to verify procedural requirements such as human approvals. Call bees_submit_stage_result with pass or revise and concise evidence.\n\nGoal: ${item.title}\n\n${item.description}\n\nStage instructions: ${stage.instructions || "Review the completed work."}`
      : `Complete only the ${stage.stageName || "current"} stage of this goal; do not perform later stages. Do the work yourself. Unless delegation is itself an explicit requirement, only use bees_delegate_work for a large separate piece a peer can own end to end; a tool call, lookup or single-file edit is not enough, and delegate at most one peer once. When the goal explicitly requires a delegation protocol or count, follow it exactly; only the parent delegates, and it waits for each peer before launching the next. The caller waits while a peer works in this same workspace, so continue from its changes already in outputs/ when it finishes. Put every final deliverable under outputs/. Call bees_submit_stage_result with candidate only when this stage is genuinely ready for the next stage.\n\nGoal: ${item.title}\n\n${item.description}\n\nStage instructions: ${stage.instructions || `Complete only the ${stage.stageName || "current"} stage.`}${handoff}${feedback}`;
    return this.agents.executeStage(executionId, {
      idempotencyKey: `process:${executionId}:start`,
      workspace: runDirectory,
      body,
      initialData: {
        version: 1, mode: reviewer ? "review" : "work", stagePurpose: stage.purpose,
        executionId, workItemId: item.id,
        agentId: assignment.id, agentName: assignment.name,
        purpose: item.title, model: assignment?.model || null,
        reasoningEffort: assignment?.reasoningEffort || null,
        instructions: [assignment?.instructions, stage.instructions].filter(Boolean).join("\n\n"),
        workspaceId: item.workspaceId, agentPresetId: assignment?.presetId || "standard",
        ...mcpGrantFor(this.database, assignment?.id),
        grants: reviewer ? [] : [...new Set(locations.map(({ id }) => id))]
      }
    }, signal);
  }

  async snapshot() {
    const { userId, deviceId } = currentIdentity(this.database);
    const organizations = this.database.prepare(`
      SELECT o.id, o.name, o.personal, om.role,
             connected.organization_id IS NOT NULL AS connected
      FROM organizations o JOIN organization_memberships om ON om.organization_id = o.id
      LEFT JOIN bees_connected_organizations connected ON connected.organization_id = o.id
      WHERE om.user_id = ? AND om.status = 'active' AND o.status = 'active' ORDER BY o.created_at
    `).all(userId).map((row) => ({
      ...row, personal: Boolean(row.personal), connected: Boolean(row.connected)
    }));
    const teams = this.database.prepare(`
      SELECT DISTINCT t.id, t.organization_id AS organizationId, t.name, t.personal,
             CASE WHEN connected.organization_id IS NOT NULL THEN tm.role
               ELSE coalesce(tm.role, CASE WHEN om.role IN ('owner','admin') THEN 'admin' END)
             END AS role
      FROM teams t JOIN organization_memberships om ON om.organization_id = t.organization_id
      LEFT JOIN team_memberships tm ON tm.team_id = t.id AND tm.user_id = ? AND tm.status = 'active'
      LEFT JOIN bees_connected_organizations connected ON connected.organization_id = t.organization_id
      WHERE om.user_id = ? AND om.status = 'active' AND t.status = 'active'
        AND (tm.user_id IS NOT NULL OR om.role IN ('owner','admin'))
      ORDER BY t.created_at
    `).all(userId, userId).map((row) => ({ ...row, personal: Boolean(row.personal) }));
    const allowedTeams = teams.map(({ id }) => id);
    const workspaces = allowedTeams.length ? this.database.prepare(`
      SELECT id, team_id AS teamId, dsh_workspace_id AS dshWorkspaceId, name, authority, hosting, status
      FROM workspaces WHERE team_id IN (SELECT value FROM json_each(?)) AND status = 'active'
      ORDER BY created_at
    `).all(JSON.stringify(allowedTeams)) : [];
    const workspaceIds = workspaces.map(({ id }) => id);
    const processes = workspaceIds.length ? this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, name, description, kind FROM processes
      WHERE workspace_id IN (SELECT value FROM json_each(?)) AND archived_at IS NULL ORDER BY created_at
    `).all(JSON.stringify(workspaceIds)) : [];
    const templates = workspaceIds.length ? this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, name, description, stages_json AS stages
      FROM process_templates
      WHERE workspace_id IN (SELECT value FROM json_each(?)) AND archived_at IS NULL
      ORDER BY created_at
    `).all(JSON.stringify(workspaceIds)).map((row) => ({ ...row, stages: JSON.parse(row.stages) })) : [];
    const processIds = processes.map(({ id }) => id);
    const stages = processIds.length ? this.database.prepare(`
      SELECT id, process_id AS processId, name, position, driver,
             completion_rules AS instructions, is_terminal AS isTerminal,
             CASE WHEN r.agent_assignment_id IS NOT NULL THEN 'agent'
                  WHEN r.agent_pool_id IS NOT NULL THEN 'pool' END AS routeType,
             coalesce(r.agent_assignment_id, r.agent_pool_id) AS routeTargetId,
             r.required_capabilities_json AS requiredCapabilities
      FROM stages s LEFT JOIN stage_routes r ON r.stage_id = s.id
      WHERE process_id IN (SELECT value FROM json_each(?)) AND archived_at IS NULL
      ORDER BY process_id, position
    `).all(JSON.stringify(processIds)).map((row) => ({
      ...row, isTerminal: Boolean(row.isTerminal),
      requiredCapabilities: JSON.parse(row.requiredCapabilities || "[]")
    })) : [];
    const items = processIds.length ? this.database.prepare(`
      SELECT w.id, w.process_id AS processId, w.stage_id AS stageId, w.parent_id AS parentId,
             w.kind, w.title, w.description, w.owner, w.agent_assignment_id AS agentAssignmentId,
             w.priority, w.runtime_phase AS runtimePhase, w.runtime_attempt AS runtimeAttempt,
             w.runtime_review_cycle AS runtimeReviewCycle,
             w.runtime_execution_id AS runtimeExecutionId, w.runtime_error AS runtimeError,
             w.archived_at AS archivedAt, w.updated_at AS updatedAt,
             s.is_terminal AS completed
      FROM work_items w JOIN stages s ON s.id = w.stage_id
      WHERE w.process_id IN (SELECT value FROM json_each(?)) AND w.deleted_at IS NULL
      ORDER BY w.updated_at DESC
    `).all(JSON.stringify(processIds)).map((row) => ({ ...row, completed: Boolean(row.completed) })) : [];
    const locations = allowedTeams.length ? this.database.prepare(`
      SELECT l.id, l.team_id AS teamId, l.logical_id AS logicalId, l.name, l.kind, l.description,
             l.archived_at AS archivedAt, m.absolute_path AS localPath
      FROM team_locations l
      LEFT JOIN device_location_mappings m ON m.location_id = l.id AND m.device_id = ?
      WHERE l.team_id IN (SELECT value FROM json_each(?)) ORDER BY l.name
    `).all(deviceId, JSON.stringify(allowedTeams)).map((row) => ({ ...row, mapped: Boolean(row.localPath) })) : [];
    const attachments = processIds.length ? this.database.prepare(`
      SELECT a.work_item_id AS workItemId, a.location_id AS locationId, a.relative_path AS relativePath
      FROM work_item_locations a JOIN work_items w ON w.id = a.work_item_id
      WHERE w.process_id IN (SELECT value FROM json_each(?)) ORDER BY a.work_item_id, a.location_id
    `).all(JSON.stringify(processIds)) : [];
    const processAttachments = processIds.length ? this.database.prepare(`
      SELECT process_id AS processId, location_id AS locationId, relative_path AS relativePath
      FROM process_locations WHERE process_id IN (SELECT value FROM json_each(?))
      ORDER BY process_id, location_id
    `).all(JSON.stringify(processIds)) : [];
    const assignments = workspaceIds.length ? this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, preset_id AS presetId, name, description,
             instructions, model, reasoning_effort AS reasoningEffort,
             system_role AS systemRole, capabilities_json AS capabilities,
             enabled, max_concurrency AS maxConcurrency, updated_at AS updatedAt,
             mcp_access AS mcpAccess, mcp_servers_json AS mcpServers
      FROM agent_assignments WHERE workspace_id IN (SELECT value FROM json_each(?)) ORDER BY name
    `).all(JSON.stringify(workspaceIds)).map((row) => ({
      ...row, enabled: Boolean(row.enabled), capabilities: JSON.parse(row.capabilities || "[]"),
      mcpServers: JSON.parse(row.mcpServers || "[]")
    })) : [];
    const pools = workspaceIds.length ? this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, name, description
      FROM agent_pools WHERE workspace_id IN (SELECT value FROM json_each(?)) AND archived_at IS NULL
      ORDER BY name
    `).all(JSON.stringify(workspaceIds)) : [];
    const poolMembers = pools.length ? this.database.prepare(`
      SELECT pool_id AS poolId, agent_assignment_id AS agentAssignmentId,
             priority, enabled, last_assigned_at AS lastAssignedAt
      FROM agent_pool_members WHERE pool_id IN (SELECT value FROM json_each(?))
      ORDER BY pool_id, priority, agent_assignment_id
    `).all(JSON.stringify(pools.map(({ id }) => id))).map((row) => ({
      ...row, enabled: Boolean(row.enabled)
    })) : [];
    const runs = workspaceIds.length ? this.database.prepare(`
      SELECT e.execution_id AS id, e.workspace_id AS workspaceId, e.work_item_id AS workItemId,
             e.current_session_id AS sessionId, e.previous_session_id AS previousSessionId,
             e.status, json_extract(e.config_json, '$.mode') AS mode,
             json_extract(e.config_json, '$.purpose') AS purpose,
             e.run_directory AS runDirectory, e.updated_at AS updatedAt,
             d.stage_id AS dispatchStageId, d.agent_assignment_id AS resolvedAgentId,
             d.target_type AS dispatchTargetType, d.target_id AS dispatchTargetId,
             d.reason AS dispatchReason, d.agent_revision AS agentRevision
      FROM execution_links e LEFT JOIN agent_dispatches d ON d.execution_id = e.execution_id
      WHERE workspace_id IN (SELECT value FROM json_each(?))
      ORDER BY updated_at DESC LIMIT 200
    `).all(JSON.stringify(workspaceIds)).map(({ runDirectory, ...run }) => ({
      ...run, outputs: outputFiles(runDirectory),
      files: ["waiting_for_input", "waiting_for_approval"].includes(run.status)
        ? previewFiles(runDirectory) : []
    })) : [];
    const proposals = workspaceIds.length ? this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, dsh_session_id AS sessionId, title, summary,
             changes_json AS changes, status, created_at AS createdAt
      FROM bees_proposals WHERE workspace_id IN (SELECT value FROM json_each(?))
      ORDER BY created_at DESC LIMIT 100
    `).all(JSON.stringify(workspaceIds)).map((row) => ({ ...row, changes: JSON.parse(row.changes) })) : [];
    let presets = [];
    try {
      presets = this.agentPresets ? (await this.agentPresets.list()).map((preset) => {
        const { id, name, description } = namePreset(preset);
        return { id, name, description, broken: preset.broken || null, trust: preset.trust };
      }) : [];
    } catch { /* the Agents page reports the empty roster honestly */ }
    return {
      currentUserId: userId, currentDeviceId: deviceId, organizations, teams, workspaces,
      processes, templates, stages, items, locations, attachments, processAttachments,
      assignments, pools, poolMembers, presets, runs, proposals
    };
  }

  async references(query, workspaceId) {
    const workspace = workspaceContext(this.database, workspaceId);
    const term = `%${String(query ?? "").slice(0, 120)}%`;
    const lower = String(query ?? "").toLocaleLowerCase();
    const at = [
      ...this.database.prepare(`
        SELECT id, name AS label, 'agent' AS kind FROM agent_assignments
        WHERE workspace_id = ? AND name LIKE ? ORDER BY name LIMIT 20
      `).all(workspace.id, term),
      ...this.database.prepare(`SELECT id, name AS label, 'team' AS kind FROM teams WHERE id = ?`).all(workspace.teamId),
      ...this.database.prepare(`
        SELECT w.id, w.title AS label, 'work-item' AS kind
        FROM work_items w JOIN processes p ON p.id = w.process_id
        WHERE p.workspace_id = ? AND w.deleted_at IS NULL AND w.title LIKE ?
        ORDER BY w.updated_at DESC LIMIT 30
      `).all(workspace.id, term)
    ];
    const dollar = this.database.prepare(`
      SELECT id, name AS label, 'location' AS kind FROM team_locations
      WHERE team_id = ? AND archived_at IS NULL AND name LIKE ? ORDER BY name LIMIT 30
    `).all(workspace.teamId, term);
    return {
      at: at.filter(({ label }) => String(label).toLocaleLowerCase().includes(lower)).slice(0, 50),
      dollar: dollar.filter(({ label }) => String(label).toLocaleLowerCase().includes(lower)).slice(0, 50)
    };
  }

  async search(query, workspaceId) {
    const workspace = workspaceContext(this.database, workspaceId);
    // FTS5 reads bare punctuation as query syntax, so each word goes in as a quoted prefix term.
    const terms = String(query ?? "").replace(/"/g, "").trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const { deviceId } = currentIdentity(this.database);
    const locations = this.database.prepare(`
      SELECT l.id, l.name, l.kind, m.absolute_path AS localPath
      FROM team_locations l JOIN device_location_mappings m ON m.location_id = l.id
      WHERE l.team_id = ? AND l.archived_at IS NULL AND m.device_id = ?
    `).all(workspace.teamId, deviceId);
    const items = this.database.prepare(`
      SELECT bees_search.kind, bees_search.ref_id AS id, bees_search.title,
             snippet(bees_search, 3, '', '', ' … ', 18) AS excerpt
      FROM bees_search
      JOIN work_items w ON w.id = bees_search.ref_id
      JOIN processes p ON p.id = w.process_id
      WHERE bees_search MATCH ? AND bees_search.kind = 'item'
        AND p.workspace_id = ? AND w.deleted_at IS NULL
      ORDER BY bm25(bees_search) LIMIT 50
    `).all(terms.map((term) => `"${term}"*`).join(" "), workspace.id);
    let files = [];
    try { files = await this.knowledge.search(String(query), workspace.teamId, locations); }
    catch (error) { this.agents?.ctx?.logger?.warn?.(`bees: knowledge search unavailable: ${message(error)}`); }
    return [...items, ...files].slice(0, 50);
  }

  audit() {
    return this.database.prepare(`
      SELECT id, event_type AS type, execution_id AS executionId, metadata_json AS metadata,
             created_at AS createdAt FROM dsh_audit_events ORDER BY created_at DESC LIMIT 100
    `).all().map((row) => ({ ...row, metadata: JSON.parse(row.metadata) }));
  }

  async runHistory(executionId) {
    const id = required(executionId, "Run");
    const row = this.database.prepare(`
      SELECT workspace_id AS workspaceId FROM execution_links WHERE execution_id = ?
    `).get(id);
    if (!row) throw new Error("Run not found");
    workspaceContext(this.database, row.workspaceId);
    return this.agents.history(id);
  }

  runFile(executionId, filePath) {
    const id = required(executionId, "Run");
    const row = this.database.prepare(`
      SELECT workspace_id AS workspaceId, run_directory AS runDirectory
      FROM execution_links WHERE execution_id = ?
    `).get(id);
    if (!row) throw new Error("Run not found");
    workspaceContext(this.database, row.workspaceId);
    const logical = logicalRelativePath(required(filePath, "File"));
    const [rootName] = logical.split("/");
    if (!["inputs", "outputs"].includes(rootName)) throw new Error("Only run inputs and outputs can be previewed");
    if (!TEXT_EXTENSIONS.has(extname(logical).toLowerCase())) throw new Error("This file type cannot be previewed as text");
    const runsRoot = realpathSync(resolve(this.defaultWorkspace, "runs"));
    const runDirectory = realpathSync(row.runDirectory);
    if (runDirectory !== runsRoot && !runDirectory.startsWith(`${runsRoot}${sep}`))
      throw new Error("The run directory is outside the Bees workspace");
    const root = realpathSync(resolve(runDirectory, rootName));
    const path = realpathSync(resolve(runDirectory, logical));
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error("The file escaped its run directory");
    const stat = lstatSync(path);
    if (!stat.isFile()) throw new Error("The run file is unavailable");
    if (stat.size > 1_000_000) throw new Error("The run file is too large to preview");
    const extension = extname(path).toLowerCase();
    return {
      name: basename(path), path: logical,
      format: [".md", ".markdown"].includes(extension) ? "markdown" : "text",
      content: readFileSync(path, "utf8")
    };
  }

  storeProposal({ workspaceId, sessionId, title, summary, changes }) {
    workspaceContext(this.database, workspaceId, ["admin", "member"]);
    if (!Array.isArray(changes) || !changes.length || changes.length > 20)
      throw new Error("A proposal needs between 1 and 20 changes");
    const proposedProcesses = new Set();
    const normalized = changes.map((change) => {
      if (!change || typeof change !== "object" || Array.isArray(change)) throw new Error("Proposal changes must be objects");
      if (change.action === "create_goal") return {
        action: "create_goal", title: required(change.title, "Goal title"),
        description: String(change.description ?? "")
      };
      if (change.action === "create_process") {
        const name = required(change.name, "Process name");
        const key = name.toLocaleLowerCase();
        if (proposedProcesses.has(key)) throw new Error("Proposed process names must be unique");
        proposedProcesses.add(key);
        return {
          action: "create_process", name, description: String(change.description ?? ""),
          stages: processStages(change.stages, "proposed process")
        };
      }
      if (change.action === "create_item") {
        const process = required(change.process, "Work item process");
        if (!proposedProcesses.has(process.toLocaleLowerCase()))
          throw new Error("A proposed work item must target a process created earlier in the same proposal");
        return {
          action: "create_item", process, title: required(change.title, "Work item title"),
          description: String(change.description ?? "")
        };
      }
      throw new Error(`Unsupported proposed action: ${change.action}`);
    });
    const id = randomUUID();
    const at = iso();
    this.database.prepare(`
      INSERT INTO bees_proposals VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, workspaceId, sessionId || null, required(title, "Proposal title"), String(summary ?? ""), JSON.stringify(normalized), at, at);
    return { id, changes: normalized.length };
  }

  async createSubitems({ parentId, items }) {
    const parent = itemContext(this.database, parentId, ["admin", "member"]);
    if (!Array.isArray(items) || items.length !== 1)
      throw new Error("A run can delegate exactly one work item at a time");
    const created = [];
    for (const item of items) {
      const title = required(item?.title, "Delegated work title");
      const description = String(item?.description ?? "");
      const existing = this.database.prepare(`
        SELECT id FROM work_items WHERE parent_id = ? AND title = ?
          AND archived_at IS NULL AND deleted_at IS NULL LIMIT 1
      `).get(parent.id, title);
      const child = existing ?? await this.command({ action: "create_item",
        processId: parent.processId, parentId: parent.id, title, description,
        agentAssignmentId: parent.agentAssignmentId
      });
      this.database.prepare(`
        INSERT OR IGNORE INTO work_item_locations
        SELECT ?, location_id, relative_path FROM work_item_locations WHERE work_item_id = ?
      `).run(child.id, parent.id);
      created.push(child);
    }
    return created;
  }

  async command(input) {
    const action = required(input?.action, "Action");
    try {
      const result = await this.execute(action, input);
      this.record(action, input, result, "ok");
      return result;
    } catch (error) {
      this.record(action, input, null, "error");
      throw error;
    }
  }

  record(action, input, result, outcome) {
    const metadata = { action, outcome };
    for (const key of ["organizationId", "teamId", "workspaceId", "processId", "templateId", "stageId", "itemId", "parentId", "agentAssignmentId", "agentPoolId", "locationId", "proposalId"])
      if (input[key]) metadata[key] = String(input[key]);
    if (result?.id) metadata.resultId = String(result.id);
    const executionId = result?.executionId ? String(result.executionId) : null;
    this.database.prepare(`
      INSERT INTO dsh_audit_events (id, event_type, execution_id, session_id, metadata_json, created_at)
      VALUES (?, ?, ?, NULL, ?, ?)
    `).run(randomUUID(), `domain-${action}`, executionId, JSON.stringify(metadata), iso());
  }

  async execute(action, input) {
    return executeProductCommand.call(this, action, input);
  }
}
