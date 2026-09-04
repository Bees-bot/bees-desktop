import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";
import {
  agentCapabilities, currentIdentity, initializeProductDatabase, iso, itemContext, mcpGrantFor, message,
  processStages, required, requireTeam, workspaceContext
} from "./product-database.js";
import {
  inputManifest, logicalRelativePath, outputFiles, outputLocation, previewFiles, stageInputs,
  mappedLocation, stagedLocation, stageLocation, TEXT_EXTENSIONS
} from "./product-files.js";
import { TeamKnowledgeSearch } from "./product-knowledge.js";
import { AgentCapacityError, resolveStageAgent } from "./product-routing.js";
import { namePreset } from "./preset-names.js";
import { executeProductCommand } from "./product-commands.js";

export { initializeProductDatabase };

const GOALS_WORK_PROTOCOL = "Decide first whether the outcome needs a plan. If one run can finish it, do the work directly. Otherwise execute only the next safe wave, use todos, and use bees_delegate_work only for isolated tracked work. Use the seated DSH Agent Team when this is a discussion stage. Do not plan dependent future waves before current evidence is available. Continue until the outcome and any explicit stop condition are genuinely satisfied, then submit the deliverable for review.";
const GOALS_REVIEW_PROTOCOL = "Independently inspect the candidate deliverables and evidence against the requested outcome, parent goal, and any explicit stop condition. Pass only when the outcome is actually complete; never pass an ongoing campaign whose stop condition is unmet. Otherwise return specific revision feedback.";

export class BeesProduct {
  constructor(database, agents, processes, defaultWorkspace, services = {}) {
    this.database = database;
    this.agents = agents;
    this.processes = processes;
    this.defaultWorkspace = defaultWorkspace;
    this.workspaceRegistry = services.workspaceRegistry;
    this.knowledge = new TeamKnowledgeSearch(defaultWorkspace, services.googleDrive);
    this.agentPresets = services.agentPresets;
    this.capabilities = services.capabilities;
    this.tools = services.tools;
    this.notify = services.notify ?? (() => {});
    initializeProductDatabase(database);
    this.agents?.setProposalStore?.((proposal) => this.storeProposal(proposal));
    this.agents?.setKnowledgeSearch?.((query, workspaceId) => this.search(query, workspaceId));
    this.agents?.setKnowledgeReader?.((resultId, workspaceId) => this.readKnowledge(resultId, workspaceId));
    this.agents?.setSubitemStore?.({
      create: (input) => this.createSubitems(input),
      cancel: (workItemId) => this.processes.signal(workItemId, "cancel")
    });
    this.agents?.setWorkStarter?.((input) => this.startWork(input));
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
    this.agents.resumeQueued?.();
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
      body = `Plan this outcome for the current Bees team. Propose reviewable changes with bees_propose_changes; do not apply them yourself.\n\nOutcome: ${data.purpose}`;
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
    if (["question", "work-review"].includes(pending?.kind))
      body += pending.kind === "work-review"
        ? `\n\nThe application restarted during human review. Re-present this unresolved review with bees_request_work_review before continuing:\n${pending.questions}`
        : `\n\nThe application restarted while waiting for the user. Re-present this unresolved question with ask_user_question before continuing:\n${pending.questions}`;
    return [this.agents.admit("bees-run", run.executionId, {
      idempotencyKey: `runtime-recovery:${run.executionId}:${Number(run.recoveryCount) + 1}`,
      body
    })];
  }

  async runProcessStage(stage, signal) {
    const item = itemContext(this.database, stage.workItemId, ["admin", "member"]);
    const executionId = required(stage.executionId, "Execution");
    const parentRun = item.parentId ? this.database.prepare(`
      SELECT run_directory AS runDirectory FROM execution_links
      WHERE work_item_id = ?
        AND status IN ('queued', 'running', 'waiting_for_input', 'waiting_for_approval')
      ORDER BY updated_at DESC LIMIT 1
    `).get(item.parentId) : null;
    const runDirectory = parentRun?.runDirectory ?? resolve(this.defaultWorkspace, "runs", executionId);
    const reviewer = stage.purpose === "reviewer";
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
    const discussion = assignment.discussion;
    const peers = discussion ? assignment.agents.slice(1) : [];
    const seatNames = peers.map((_peer, index) => `participant-${index + 1}`);
    const discussionMembers = peers.map((peer, index) => ({
      name: seatNames[index],
      description: peer.name,
      model: peer.model,
      reasoningEffort: peer.reasoningEffort,
      prompt: `Participate as ${peer.name}. ${peer.description || ""}\n\n${peer.instructions || ""}\n\nGoal: ${item.title}\n\n${item.description}\n\nDiscussion stage: ${stage.stageName || "Discussion"}.\n\nThe expected peer seats are ${seatNames.join(", ")}. Wait until list_agents shows all of them, then analyze independently and exchange ideas and challenges with lead and every other participant using send_message or followup_task. You may initiate a new round whenever it could improve the decision. Before becoming idle, send your current recommendation and reasoning to lead. Do not call bees_submit_stage_result; the lead submits the coherent conclusion.`
    }));
    const locations = stageInputs(this.database, item.id, runDirectory, assignment.id);
    const manifest = inputManifest(locations);
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
    const inputs = manifest ? `\n\n${manifest}` : "";
    const goalsProtocol = item.processKind === "goals"
      ? reviewer ? GOALS_REVIEW_PROTOCOL : discussion ? "" : GOALS_WORK_PROTOCOL
      : "";
    const approval = stage.requiresHumanApproval
      ? "\n\nThis stage cannot finish until the human approves the completed result through bees_request_work_review."
      : "";
    const discussionProtocol = discussion
      ? `\n\nThis is a DSH Agent Teams discussion. Bees has already seated ${discussionMembers.length} peers: ${discussionMembers.map(({ name, description }) => `${name} (${description})`).join(", ")}. They can message anyone without waiting for you. Read every participant's pitch, challenge weak assumptions, use followup_task for another round when useful, and synthesize a coherent decision only after all participants have reported.`
      : "";
    const delegationProtocol = discussion
      ? "Use the seated DSH Agent Team for discussion and follow-up; do not create separate delegated work for a seated participant."
      : "Do small, tightly coupled work yourself. Unless delegation is itself an explicit requirement, use bees_delegate_work only for a large separate piece a peer can own end to end; a tool call, lookup, or single-file edit is not enough. When the goal explicitly requires a delegation count, only the parent delegates and waits for each peer before launching the next. A delegated peer is a visible child work item and works in this same workspace, so continue from its changes already in outputs/ when it finishes.";
    const body = reviewer
      ? `Independently review the candidate under inputs/candidate.${shared} Verify the real deliverables and run relevant checks. When present, inputs/execution-evidence.json is system-generated from Bees runs and audit records; use it to verify procedural requirements such as human approvals. Call bees_submit_stage_result with pass or revise and concise evidence.\n\nGoal: ${item.title}\n\n${item.description}\n\nCurrent stage: ${stage.stageName || "Review"}.${inputs}${approval}`
      : `Complete only the ${stage.stageName || "current"} stage of this goal; do not perform later stages. ${delegationProtocol} Put every final deliverable under outputs/. If you are granted publication targets, you MUST publish the deliverables using bees_publish_outputs. Call bees_submit_stage_result with candidate only when this stage is genuinely ready for the next stage.\n\nGoal: ${item.title}\n\n${item.description}\n\nCurrent stage: ${stage.stageName || "Work"}.${handoff}${feedback}${inputs}${discussionProtocol}${approval}`;
    return this.agents.executeStage(executionId, {
      idempotencyKey: `process:${executionId}:start`,
      workspace: runDirectory,
      body,
      initialData: {
        version: 1, mode: reviewer ? "review" : "work", stagePurpose: reviewer ? "reviewer" : "worker",
        executionId, workItemId: item.id,
        agentId: assignment.id, agentName: assignment.name,
        purpose: item.title, model: assignment?.model || null,
        reasoningEffort: assignment?.reasoningEffort || null,
        instructions: [goalsProtocol, assignment?.instructions].filter(Boolean).join("\n\n"),
        capabilities: agentCapabilities(assignment),
        discussionMembers, requiresHumanApproval: Boolean(stage.requiresHumanApproval),
        workspaceId: item.workspaceId, agentPresetId: assignment?.presetId || this.agents.ctx.agentPresets.defaultId,
        ...mcpGrantFor(this.database, assignment?.id, item.runSettings),
        grants: reviewer ? [] : [outputLocation(this.database, item.id)].filter(Boolean)
      }
    }, signal);
  }

  async snapshot() {
    const { userId, deviceId } = currentIdentity(this.database);
    const accounts = this.database.prepare(`
      SELECT user_id AS userId, email, name FROM bees_accounts ORDER BY created_at, user_id
    `).all();
    const organizations = this.database.prepare(`
      SELECT o.id, o.name, o.personal, om.role,
             EXISTS (SELECT 1 FROM bees_connections c WHERE c.organization_id = o.id) AS connected
      FROM organizations o
      LEFT JOIN organization_memberships om ON om.organization_id = o.id AND om.user_id = ?
      WHERE o.status = 'active' AND (
        om.status = 'active'
        OR EXISTS (SELECT 1 FROM bees_connections c WHERE c.organization_id = o.id)
      ) ORDER BY o.created_at
    `).all(userId).map((row) => ({
      ...row, personal: Boolean(row.personal), connected: Boolean(row.connected)
    }));
    const teams = this.database.prepare(`
      SELECT DISTINCT t.id, t.organization_id AS organizationId, t.name, t.personal,
             coalesce(tm.role, CASE WHEN om.role IN ('owner','admin') THEN 'admin' END) AS role
      FROM teams t JOIN organizations o ON o.id = t.organization_id
      LEFT JOIN organization_memberships om ON om.organization_id = t.organization_id AND om.user_id = ?
      LEFT JOIN team_memberships tm ON tm.team_id = t.id AND tm.user_id = ? AND tm.status = 'active'
      WHERE t.status = 'active' AND (
        (om.status = 'active' AND (tm.user_id IS NOT NULL OR om.role IN ('owner','admin')))
        OR EXISTS (SELECT 1 FROM bees_connection_teams ct WHERE ct.team_id = t.id)
      )
      ORDER BY t.created_at
    `).all(userId, userId).map((row) => ({ ...row, personal: Boolean(row.personal) }));
    const connections = this.database.prepare(`
      SELECT c.id, c.organization_id AS organizationId, c.account_user_id AS accountUserId,
             c.role, o.name AS organizationName, a.email, a.name AS accountName
      FROM bees_connections c JOIN organizations o ON o.id = c.organization_id
      JOIN bees_accounts a ON a.user_id = c.account_user_id
      ORDER BY o.name, a.email
    `).all();
    const connectionTeams = this.database.prepare(`
      SELECT connection_id AS connectionId, team_id AS teamId, role
      FROM bees_connection_teams ORDER BY connection_id, team_id
    `).all();
    const allowedTeams = teams.map(({ id }) => id);
    const workspaces = allowedTeams.length ? this.database.prepare(`
      SELECT id, team_id AS teamId, dsh_workspace_id AS dshWorkspaceId, name, authority, hosting, status
      FROM workspaces WHERE team_id IN (SELECT value FROM json_each(?)) AND status = 'active'
      ORDER BY created_at
    `).all(JSON.stringify(allowedTeams)) : [];
    const workspaceIds = workspaces.map(({ id }) => id);
    const processes = workspaceIds.length ? this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, name, description, kind,
             output_location_id AS outputLocationId FROM processes
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
             requires_human_approval AS requiresHumanApproval, is_terminal AS isTerminal,
             r.agent_ids_json AS agentIds,
             r.required_capabilities_json AS requiredCapabilities
      FROM stages s LEFT JOIN stage_routes r ON r.stage_id = s.id
      WHERE process_id IN (SELECT value FROM json_each(?)) AND archived_at IS NULL
      ORDER BY process_id, position
    `).all(JSON.stringify(processIds)).map((row) => ({
      ...row, requiresHumanApproval: Boolean(row.requiresHumanApproval),
      isTerminal: Boolean(row.isTerminal),
      agentIds: JSON.parse(row.agentIds || "[]"),
      requiredCapabilities: JSON.parse(row.requiredCapabilities || "[]")
    })) : [];
    const items = processIds.length ? this.database.prepare(`
      SELECT w.id, w.process_id AS processId, w.stage_id AS stageId, w.parent_id AS parentId,
             w.kind, w.title, w.description, w.owner, w.agent_assignment_id AS agentAssignmentId,
             w.agent_ids_json AS agentIds,
             w.priority, w.run_settings_json AS runSettingsJson, w.runtime_phase AS runtimePhase, w.runtime_attempt AS runtimeAttempt,
             w.runtime_review_cycle AS runtimeReviewCycle,
             w.runtime_execution_id AS runtimeExecutionId, w.runtime_error AS runtimeError,
             w.output_location_id AS outputLocationId, w.recurring_work_id AS recurringWorkId,
             w.account_user_id AS accountUserId,
             w.archived_at AS archivedAt, w.updated_at AS updatedAt,
             s.is_terminal AS completed
      FROM work_items w JOIN stages s ON s.id = w.stage_id
      WHERE w.process_id IN (SELECT value FROM json_each(?)) AND w.deleted_at IS NULL
      ORDER BY w.updated_at DESC
    `).all(JSON.stringify(processIds)).map(({ runSettingsJson, agentIds, ...row }) => ({
      ...row, agentIds: JSON.parse(agentIds || "[]"),
      runSettings: JSON.parse(runSettingsJson), completed: Boolean(row.completed)
    })) : [];
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
    const agentAttachments = workspaceIds.length ? this.database.prepare(`
      SELECT agent_assignment_id AS agentAssignmentId, location_id AS locationId,
             relative_path AS relativePath FROM agent_locations
      WHERE agent_assignment_id IN (
        SELECT id FROM agent_assignments WHERE workspace_id IN (SELECT value FROM json_each(?))
      ) ORDER BY agent_assignment_id, location_id
    `).all(JSON.stringify(workspaceIds)) : [];
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
    const recurringWork = workspaceIds.length ? this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, process_id AS processId,
             source_work_item_id AS sourceWorkItemId, name,
             schedule_kind AS scheduleKind, schedule_json AS schedule,
             timezone, temporal_schedule_id AS temporalScheduleId,
             status, next_run_at AS nextRunAt, created_at AS createdAt, updated_at AS updatedAt
      FROM recurring_work WHERE workspace_id IN (SELECT value FROM json_each(?))
      ORDER BY created_at DESC
    `).all(JSON.stringify(workspaceIds)).map((row) => ({
      ...row, schedule: JSON.parse(row.schedule)
    })) : [];
    const recurringExecutors = recurringWork.length ? this.database.prepare(`
      SELECT recurring_work_id AS recurringWorkId, account_user_id AS accountUserId,
             temporal_schedule_id AS temporalScheduleId, next_run_at AS nextRunAt
      FROM bees_recurring_executors
      WHERE recurring_work_id IN (SELECT value FROM json_each(?))
      ORDER BY recurring_work_id, account_user_id
    `).all(JSON.stringify(recurringWork.map(({ id }) => id))) : [];
    const specializations = recurringWork.length ? this.database.prepare(`
      SELECT s.id, s.recurring_work_id AS recurringWorkId,
             s.agent_assignment_id AS agentAssignmentId, s.name, s.playbook,
             s.revision, s.created_at AS createdAt, s.updated_at AS updatedAt
      FROM agent_specializations s
      WHERE s.recurring_work_id IN (SELECT value FROM json_each(?))
      ORDER BY s.updated_at DESC
    `).all(JSON.stringify(recurringWork.map(({ id }) => id))) : [];
    const specializationVersions = specializations.length ? this.database.prepare(`
      SELECT id, specialization_id AS specializationId, revision, playbook, source,
             feedback, execution_id AS executionId, created_at AS createdAt
      FROM agent_specialization_versions
      WHERE specialization_id IN (SELECT value FROM json_each(?))
      ORDER BY specialization_id, revision DESC
    `).all(JSON.stringify(specializations.map(({ id }) => id))) : [];
    const runs = workspaceIds.length ? this.database.prepare(`
      SELECT e.execution_id AS id, e.workspace_id AS workspaceId, e.work_item_id AS workItemId,
             e.current_session_id AS sessionId, e.previous_session_id AS previousSessionId,
             e.status, json_extract(e.config_json, '$.mode') AS mode,
             json_extract(e.config_json, '$.purpose') AS purpose,
             e.run_directory AS runDirectory, e.updated_at AS updatedAt,
             starts.startedAt,
             d.stage_id AS dispatchStageId, d.agent_assignment_id AS resolvedAgentId,
             d.agent_ids_json AS resolvedAgentIds,
             d.specialization_id AS specializationId,
             d.target_type AS dispatchTargetType, d.target_id AS dispatchTargetId,
             d.reason AS dispatchReason, d.agent_revision AS agentRevision,
             r.outcome AS resultOutcome, r.summary AS resultSummary, r.created_at AS resultCreatedAt
      FROM execution_links e
      LEFT JOIN (SELECT execution_id, MIN(created_at) AS startedAt FROM dsh_audit_events
                 WHERE event_type = 'run-started' GROUP BY execution_id) starts
        ON starts.execution_id = e.execution_id
      LEFT JOIN agent_dispatches d ON d.execution_id = e.execution_id
      LEFT JOIN bees_stage_results r ON r.execution_id = e.execution_id
      WHERE workspace_id IN (SELECT value FROM json_each(?))
      ORDER BY updated_at DESC LIMIT 200
    `).all(JSON.stringify(workspaceIds)).map(({ runDirectory, resolvedAgentIds, ...run }) => ({
      ...run, resolvedAgentIds: JSON.parse(resolvedAgentIds || "[]"),
      pendingInteraction: this.agents?.pendingInteraction?.(run.id)?.kind ?? null,
      outputs: outputFiles(runDirectory),
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
      presets = this.agentPresets ? await Promise.all((await this.agentPresets.list()).map(async (preset) => {
        const { id, name, description } = namePreset(preset);
        return { id, name, description, broken: preset.broken || await this.presetGap(id).catch(message), trust: preset.trust };
      })) : [];
    } catch { /* the Agents page reports the empty roster honestly */ }
    return {
      currentUserId: userId, currentDeviceId: deviceId,
      accounts, organizations, connections, connectionTeams, teams, workspaces,
      processes, templates, stages, items, locations, attachments, processAttachments, agentAttachments,
      assignments, recurringWork, recurringExecutors,
      specializations, specializationVersions,
      presets, runs, proposals
    };
  }

  /** A stage writes under outputs/ and may have to ask a person. Without those tools a run cannot follow the persona. */
  async presetGap(presetId) {
    const names = new Set(this.tools.schemas(await this.agentPresets.standingKeyFor(presetId)).map(({ name }) => name));
    const missing = ["write", "ask_user_question"].filter((name) => !names.has(name));
    return missing.length ? `Has no ${missing.join(" or ")} tool, so it cannot run a stage` : null;
  }

  async references(query, workspaceId) {
    const workspace = workspaceContext(this.database, workspaceId);
    const term = `%${String(query ?? "").slice(0, 120)}%`;
    const lower = String(query ?? "").toLocaleLowerCase();
    const agents = this.database.prepare(`
      SELECT id, name AS label, 'agent' AS kind FROM agent_assignments
      WHERE workspace_id = ? AND name LIKE ? ORDER BY name LIMIT 20
    `).all(workspace.id, term);
    const team = this.database.prepare(`
      SELECT id, name AS label, 'team' AS kind FROM teams WHERE id = ?
    `).all(workspace.teamId);
    const work = this.database.prepare(`
      SELECT w.id, w.title AS label, 'work-item' AS kind
      FROM work_items w JOIN processes p ON p.id = w.process_id
      WHERE p.workspace_id = ? AND w.deleted_at IS NULL AND w.title LIKE ?
      ORDER BY w.updated_at DESC LIMIT 30
    `).all(workspace.id, term);
    const generic = [
      ...agents,
      ...this.database.prepare(`
        SELECT o.id, o.name AS label, 'organization' AS kind
        FROM organizations o JOIN teams t ON t.organization_id = o.id WHERE t.id = ?
      `).all(workspace.teamId),
      ...team,
      { id: workspace.id, label: workspace.name, kind: "workspace" },
      ...this.database.prepare(`
        SELECT DISTINCT u.id, u.name AS label, 'human' AS kind FROM users u
        LEFT JOIN team_memberships tm ON tm.user_id = u.id AND tm.team_id = ? AND tm.status = 'active'
        LEFT JOIN teams t ON t.id = ?
        LEFT JOIN organization_memberships om ON om.user_id = u.id
          AND om.organization_id = t.organization_id AND om.status = 'active'
        WHERE (tm.user_id IS NOT NULL OR om.role IN ('owner', 'admin')) AND u.name LIKE ?
        ORDER BY u.name LIMIT 20
      `).all(workspace.teamId, workspace.teamId, term),
      ...this.database.prepare(`
        SELECT id, name AS label, 'process' AS kind FROM processes
        WHERE workspace_id = ? AND archived_at IS NULL AND name LIKE ? ORDER BY name LIMIT 20
      `).all(workspace.id, term),
      ...this.database.prepare(`
        SELECT id, name AS label, 'process-template' AS kind FROM process_templates
        WHERE workspace_id = ? AND archived_at IS NULL AND name LIKE ? ORDER BY name LIMIT 20
      `).all(workspace.id, term),
      ...work,
      ...this.database.prepare(`
      SELECT id, name AS label, 'location' AS kind FROM team_locations
      WHERE team_id = ? AND archived_at IS NULL AND name LIKE ? ORDER BY name LIMIT 30
      `).all(workspace.teamId, term)
    ];
    const visible = (rows) => rows.filter(({ label }) => String(label).toLocaleLowerCase().includes(lower)).slice(0, 50);
    return {
      at: visible([...agents, ...team, ...work]),
      dollar: visible(generic)
    };
  }

  async search(query, workspaceId) {
    const { workspace, locations } = this.knowledgeLocations(workspaceId);
    // FTS5 reads bare punctuation as query syntax, so each word goes in as a quoted prefix term.
    const terms = String(query ?? "").replace(/"/g, "").trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
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

  knowledgeLocations(workspaceId) {
    const workspace = workspaceContext(this.database, workspaceId);
    const { deviceId } = currentIdentity(this.database);
    const locations = this.database.prepare(`
      SELECT l.id, l.name, l.kind, m.absolute_path AS localPath
      FROM team_locations l JOIN device_location_mappings m ON m.location_id = l.id
      WHERE l.team_id = ? AND l.archived_at IS NULL AND m.device_id = ?
    `).all(workspace.teamId, deviceId);
    return { workspace, locations };
  }

  readKnowledge(resultId, workspaceId) {
    const { workspace, locations } = this.knowledgeLocations(workspaceId);
    return this.knowledge.read(resultId, workspace.teamId, locations);
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

  locationFile(locationId, filePath = "") {
    const location = mappedLocation(this.database, required(locationId, "Location"));
    if (!location) throw new Error("Location is unavailable");
    requireTeam(this.database, location.teamId, ["admin", "member", "viewer"]);
    if (!location.localPath) throw new Error(`${location.name} is not mapped on this device`);
    const logical = logicalRelativePath(filePath);
    if (logical.split("/").some((part) => part.startsWith(".")))
      throw new Error("Hidden files cannot be previewed");
    const selected = stagedLocation(location, logical);
    if (selected.kind === "folder") {
      const entries = readdirSync(selected.localPath, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith(".") && !entry.isSymbolicLink() && (entry.isFile() || entry.isDirectory()))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      return { name: location.name, path: logical, truncated: entries.length > 200,
        entries: entries.slice(0, 200).map((entry) => ({ name: entry.name,
          path: [logical, entry.name].filter(Boolean).join("/"), kind: entry.isDirectory() ? "folder" : "file" })) };
    }
    const path = selected.localPath;
    const extension = extname(path).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) throw new Error("This file type cannot be previewed as text");
    const stat = lstatSync(path);
    if (!stat.isFile()) throw new Error("The file is unavailable");
    if (stat.size > 1_000_000) throw new Error("The file is too large to preview (1 MB limit)");
    return { name: basename(path), path: logical || basename(path),
      format: [".md", ".markdown"].includes(extension) ? "markdown" : "text", content: readFileSync(path, "utf8") };
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
    const proposedAgents = new Set();
    const proposedItems = new Set();
    const earlier = (set, name, what) => {
      if (!set.has(String(name).toLocaleLowerCase())) throw new Error(`${what} must name one created earlier in the same proposal`);
    };
    const normalized = changes.map((change) => {
      if (!change || typeof change !== "object" || Array.isArray(change)) throw new Error("Proposal changes must be objects");
      if (change.action === "create_goal") {
        const title = required(change.title, "Goal title");
        proposedItems.add(title.toLocaleLowerCase());
        return { action: "create_goal", title, description: String(change.description ?? "") };
      }
      if (change.action === "add_agent_assignment") {
        const name = required(change.name, "Agent name");
        proposedAgents.add(name.toLocaleLowerCase());
        return {
          action: "add_agent_assignment", presetId: String(change.presetId || "standard"), name,
          description: String(change.description ?? ""), instructions: String(change.instructions ?? ""),
          ...(change.model ? { model: String(change.model) } : {}),
          ...(change.mcpAccess ? { mcpAccess: change.mcpAccess, mcpServers: change.mcpServers ?? [] } : {})
        };
      }
      if (change.action === "set_stage_route") {
        const process = required(change.process, "Route process");
        earlier(proposedProcesses, process, "A proposed route's process");
        const agents = Array.isArray(change.agents) ? change.agents.map(String) : [];
        for (const agent of agents) earlier(proposedAgents, agent, "A proposed route's agent");
        return { action: "set_stage_route", process, stage: required(change.stage, "Route stage"), agents };
      }
      if (change.action === "create_recurring_work") {
        earlier(proposedItems, required(change.item, "Recurring work item"), "Proposed recurring work");
        return { ...change };
      }
      // Capabilities validates these when the proposal is applied.
      if (["install_mcp_server", "add_mcp_server", "install_skill"].includes(change.action)) return { ...change };
      if (change.action === "create_process") {
        const name = required(change.name, "Process name");
        const key = name.toLocaleLowerCase();
        if (proposedProcesses.has(key)) throw new Error("Proposed process names must be unique");
        proposedProcesses.add(key);
        const stages = Array.isArray(change.stages) ? [...change.stages] : [];
        const last = stages.at(-1);
        // The planner lists the steps; the last stage is the terminal one, so give it a real Done.
        if (last && !(typeof last === "object" ? last.driver === "terminal" : /\b(?:done|complete|completed|finished)\b/i.test(last)))
          stages.push("Done");
        return {
          action: "create_process", name, description: String(change.description ?? ""),
          stages: processStages(stages, "proposed process")
        };
      }
      if (change.action === "create_item") {
        const process = required(change.process, "Work item process");
        if (!proposedProcesses.has(process.toLocaleLowerCase()))
          throw new Error("A proposed work item must target a process created earlier in the same proposal");
        const title = required(change.title, "Work item title");
        proposedItems.add(title.toLocaleLowerCase());
        return { action: "create_item", process, title, description: String(change.description ?? "") };
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

  async startWork({ workspaceId, process, title, description, idempotencyKey }) {
    const key = required(idempotencyKey, "Idempotency key");
    const prior = this.database.prepare(`
      SELECT work_item_id AS id FROM bees_work_receipts
      WHERE workspace_id = ? AND idempotency_key = ?
    `).get(workspaceId, key);
    if (prior) return { ...prior, status: "existing" };
    workspaceContext(this.database, workspaceId, ["admin", "member"]);
    const selected = this.database.prepare(`
      SELECT id FROM processes WHERE workspace_id = ? AND archived_at IS NULL
        AND (id = ? OR lower(name) = lower(?))
      ORDER BY id = ? DESC LIMIT 1
    `).get(workspaceId, process, process, process);
    if (!selected) throw new Error("Process not found in this team");
    const created = await this.command({
      action: "create_item", processId: selected.id,
      title: required(title, "Title"), description: String(description ?? "")
    });
    this.database.prepare(`
      INSERT INTO bees_work_receipts VALUES (?, ?, ?, ?)
    `).run(workspaceId, key, created.id, iso());
    return { id: created.id, status: created.executionId ? "started" : "created" };
  }

  async createSubitems({ parentId, items }) {
    const parent = itemContext(this.database, parentId, ["admin", "member"]);
    if (!Array.isArray(items) || items.length !== 1)
      throw new Error("A run can delegate exactly one work item at a time");
    const item = items[0];
    const title = required(item?.title, "Delegated work title");
    const existing = this.database.prepare(`
      SELECT id FROM work_items WHERE parent_id = ? AND title = ?
        AND archived_at IS NULL AND deleted_at IS NULL LIMIT 1
    `).get(parent.id, title);
    const child = existing ?? await this.command({
      action: "create_item", processId: parent.processId, parentId: parent.id,
      title, description: String(item?.description ?? ""),
      agentAssignmentId: parent.agentAssignmentId, accountUserId: parent.accountUserId
    });
    return [child];
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
    for (const key of ["organizationId", "teamId", "workspaceId", "processId", "templateId", "stageId", "itemId", "parentId", "agentAssignmentId", "recurringWorkId", "specializationId", "locationId", "proposalId"])
      if (input[key]) metadata[key] = String(input[key]);
    if (result?.id) metadata.resultId = String(result.id);
    const executionId = result?.executionId ? String(result.executionId) : null;
    this.database.prepare(`
      INSERT INTO dsh_audit_events (id, event_type, execution_id, session_id, metadata_json, created_at)
      VALUES (?, ?, ?, NULL, ?, ?)
    `).run(randomUUID(), `domain-${action}`, executionId, JSON.stringify(metadata), iso());
    this.notify({ type: `domain-${action}`, executionId, ...metadata });
  }

  async execute(action, input) {
    return executeProductCommand.call(this, action, input);
  }
}
