import { invoke } from "@tauri-apps/api/core";
import {
  newAgent,
  skillSlug
} from "./agent-files.js";
import {
  apiBaseUrl
} from "./api.js";
import type { RuntimeClaim, WorkItemCommand } from "./workflow-runtime.js";
import {
  isAutoChoice,
  resolveModelChoice
} from "./assistant.js";
import { withBridgeUrl } from "./api-bridge.js";
import {
  discoverMcpTools,
  mcpConnectionForAgent,
  saveMcpConnection,
  withMcpHealth
} from "./connections.js";
import {
  decide as decideControl,
  flushControlReports,
  reportHealth,
  reportMetric,
  requestException,
  syncControl,
  type PolicyDecision,
  type ReportIdentity
} from "./control.js";
import type {
  Agent,
  Execution,
  ExecutionOutput,
  FileLocation,
  GoalTaskEffect,
  McpConnection,
  Schedule,
  WorkItem
} from "./domain.js";
import {
  activeExecutionForItem,
  activeWorkItemWaits,
  autonomousRunKeys,
  errorText,
  isProposal,
  needsAutonomousRun,
  parseLogicalFileReference,
  workItemForRetry,
  workItemCondition
} from "./domain.js";
import {
  runtimeAgentName
} from "./flue-project.js";
import {
  when
} from "./launch-views.js";
import {
  modelRef
} from "./local-models.js";
import type { ControlInput, MainHost } from "./main.js";
import { TaskPlanController, taskPlanWaitKey } from "./processes/goals/controller.js";
import {
  completedTaskPlanParentsReadyForReview,
  hasTaskPlanCapability,
  requireTaskPlanAgentStage,
  taskPlanAgentStages,
  taskPlanContextForRun,
  taskPlanStages
} from "./processes/goals/runtime.js";
import {
  processEngine
} from "./processes/registry.js";
import {
  type ProcessAgentTurn
} from "./processes/software-project/controller.js";
import { drainConversationPurges, purgeNotice } from "./purges.js";
import {
  capabilityRefsFor,
  selectedAgentCapabilities
} from "./registries.js";
import { BROWSER_TOOL_REF, BROWSER_WRITE_GRANT } from "./run-config.js";
import { FlueRuntime, type RuntimeEvent } from "./runtime.js";
import type { WorkState } from "./supervision.js";
import { workState } from "./supervision.js";
import { HttpSyncTransport, MetadataSyncService } from "./sync.js";
import {
  type OutputPreview
} from "./workspaces.js";

export function createRunController(host: MainHost) {
  const taskPlanController = new TaskPlanController({
    findWorkItem: (itemId) => host.workspaceController.teamItems.find(({ id }) => id === itemId) ?? null,
    findProcess: (processId) => host.workspaceController.processes.find(({ id }) => id === processId) ?? null,
    readOutput: (execution, output, teamRoot) => {
      if (!execution.workspaceRef)
        throw new Error("Output workspace is unavailable");
      return host.workspaces.readOutput(execution.workspaceRef, output.logicalOutput, teamRoot);
    },
    approveTaskPlan: (outputId, itemId, sourceStageId, workStageId, waitingStageId, reviewStageId, tasks, finalize) => host.repository.approveTaskPlan(outputId, itemId, sourceStageId, workStageId, waitingStageId, reviewStageId, tasks, finalize),
    workerRoles: () => taskWorkerRoles().map(({ role }) => role),
    syncCheckpoint: (itemId, targetStageId) => syncCheckpoint(itemId, undefined, targetStageId),
    finishOutputReview: (execution) => finishOutputReview(execution),
    resolveWait: (itemId, correlationKey) => resolveRuntimeWait(itemId, correlationKey)
  });

  let executions: Execution[] = [];

  let executionOutputs: ExecutionOutput[] = [];

  /** Project-workspace items that already have a validated folder. */
  let projectFolderItemIds = new Set<string>();

  const DISMISSED_RUNS_KEY = "dismissed_runs";

  let dismissedRunIds = new Set<string>();

  let schedules: Schedule[] = [];

  let appVersion = "unknown";

  const liveEvents = new Map<string, RuntimeEvent[]>();

  const outputPreviews = new Map<string, OutputPreview>();

  let runnerId = "";

  const claimHeartbeats = new Map<string, ReturnType<typeof setInterval>>();

  const RUNNING_PROCESSES_KEY = "running_processes";

  // Processes the user switched on. Their items run themselves; a stopped process runs nothing.
  let runningProcesses = new Set<string>();

  let disabledAgentIds = new Set<string>();

  // `<itemId>:<stageId>` pairs autopilot already started this session — the loop brake.
  const autopilotDone = new Set<string>();

  let autopilotBusy = false;

  /** A decomposed goal resumes only after every approved child task has reached Done. */
  async function resumeCompletedTaskPlans(): Promise<number> {
    const ready = completedTaskPlanParentsReadyForReview(host.workspaceController.teamItems, host.workspaceController.processes);
    for (const { parent, review, logicalFiles } of ready) {
      await host.repository.checkpointWorkItem(parent.id, logicalFiles, review.id);
      await host.workflowRuntime.command(parent.id, { type: "move", targetStageId: review.id });
    }
    return ready.length;
  }

  /** An open item may sit untouched with nothing running for this long before it counts as stalled. */
  const STALL_AFTER_MS = 15 * 60000;

  /**
   * Where every failure a person can trigger ends up. The notice is transient and the record is
   * not, so a workflow that throws — anywhere, including in code that never thought about this —
   * escalates on its own instead of relying on whoever wrote it to report the problem.
   *
   * Attribution is best-effort: the item the failure names, else the one on screen. A wrong guess
   * costs a line in someone's inbox, which is cheaper than the silence it replaces.
   */
  function reportFailure(error: unknown, itemId?: string): void {
    const message = errorText(error);
    host.shell.showNotice(message, "error");
    const subject = [itemId, host.shell.view === "item" ? host.shell.activeItemId : ""].find((candidate) => host.workspaceController.teamItems.some(({ id }) => id === candidate));
    if (!subject)
      return;
    const item = host.workspaceController.teamItems.find(({ id }) => id === subject);
    void Promise.resolve(item)
      .then((current) => current?.waits.some(({ kind, resolvedAt }) => kind === "error" && !resolvedAt)
        ? undefined
        : createRuntimeWait(subject, { kind: "error", reason: message }))
      .then(() => host.workspaceController.refresh())
      .catch(() => undefined);
  }

  /**
   * The supervision sweep: what state every item in this team is in, keyed by item id.
   *
   * Assembles facts and hands them to `workState` — the decision itself lives in supervision.ts
   * so it is one ordered list of rules rather than conditionals spread across the views. Every
   * reader (board badge, inbox, item banner, nav count) reads this map, so they cannot disagree.
   */
  function supervise(): Map<string, WorkState> {
    const now = new Date().toISOString();
    const states = new Map<string, WorkState>();
    for (const item of host.workspaceController.teamItems) {
      const process = host.workspaceController.processes.find(({ id }) => id === item.processId);
      if (!process)
        continue;
      const interactive = processEngine.isInteractive(process);
      const projectWorkspace = Boolean(processEngine.capability(process, "project-workspace"));
      const agent = agentForItem(item);
      const eligibility = agent ? host.workspaceController.eligibilityForAgent(agent) : null;
      const runs = executions.filter(({ workItemId, id, status }) => workItemId === item.id &&
        // A dismissed failure is one a person has already answered for.
        !(dismissedRunIds.has(id) && (status === "failed" || status === "interrupted")));
      const state = workState({
        item,
        stageName: process.stages.find(({ id }) => id === item.stageId)?.name ?? "this status",
        runs,
        pendingApprovals: executionOutputs.filter(({ executionId, status }) => status === "pending" && runs.some(({ id }) => id === executionId)).length,
        ...(interactive
          ? {
            humanStep: projectFolderItemIds.has(item.id)
              || !projectWorkspace
              ? process.stages.find(({ id }) => id === item.stageId)?.name ?? "Open the item"
              : "Choose a folder"
          }
          : {}),
        openChildren: host.workspaceController.teamItems.filter(
          (child) => child.parentId === item.id && !child.isTerminal && !child.archivedAt
        ).length,
        ...(agent && eligibility && !eligibility.active ? { agentBlocked: eligibility.reason } : {}),
        // Interactive processes drive themselves from their renderer rather than a process run.
        hasAgent: interactive || Boolean(agent?.config.prompt.trim()),
        processRunning: interactive || runningProcesses.has(process.id),
        ...(schedules.find(({ workItemId, enabled }) => workItemId === item.id && enabled)?.nextRunAt
          ? {
            scheduledFor: when(schedules.find(({ workItemId, enabled }) => workItemId === item.id && enabled)!.nextRunAt)
          }
          : {}),
        now,
        stallAfterMs: STALL_AFTER_MS
      });
      if (state)
        states.set(item.id, state);
    }
    return states;
  }

  function runStageId(execution: Execution): string | null {
    return host.workspaceController.agents.find(({ id }) => id === execution.agentId)?.triggerStageId ?? null;
  }

  function syncService(): MetadataSyncService {
    return new MetadataSyncService(host.repository, new HttpSyncTransport(apiBaseUrl(), "x-workspace-id", host.session.orgToken));
  }

  const BACKGROUND_SYNC_MS = 30000;

  const CONTROL_HEALTH_MS = 15 * 60000;

  let lastControlHealthAt = 0;

  function controlIdentity(): ReportIdentity | null {
    const user = host.session.currentUser();
    if (!user || !runnerId || !host.session.orgIsConnected())
      return null;
    return {
      organizationId: host.workspaceController.workspace.organizationId,
      deviceId: runnerId,
      userId: user.id,
      appVersion,
      ...(host.workspaceController.workspace.teamId ? { teamId: host.workspaceController.workspace.teamId } : {})
    };
  }

  async function controlTick(): Promise<void> {
    const identity = controlIdentity();
    const token = host.session.orgToken();
    if (!identity || !token)
      return;
    await syncControl(host.repository, host.api, token, identity);
    if (Date.now() - lastControlHealthAt >= CONTROL_HEALTH_MS) {
      await reportHealth(host.repository, identity);
      lastControlHealthAt = Date.now();
    }
    await flushControlReports(host.repository, host.api, token, identity.organizationId);
  }

  /**
   * Nothing pushes from the server, so membership and shared work only converge when we ask. Two
   * cheap poll points: window focus (covers "created it in the browser, then tabbed back") and a
   * timer while the app is open. Failures are ignored — the next tick retries — and the UI is
   * re-rendered only when something actually changed, so typing is never interrupted.
   */
  function startBackgroundSync(): void {
    let running = false;
    const signature = async (): Promise<string> => JSON.stringify([
      [...host.session.connections].sort(),
      [...host.session.connectedOrgs].sort(),
      host.session.pendingInvitations.length,
      (await host.repository.listTeams(host.workspaceController.workspace.organizationId)).map(({ id, name }) => `${id}:${name}`)
    ]);
    const tick = async (): Promise<void> => {
      if (running)
        return;
      running = true;
      try {
        const runtimeChanged = (await Promise.all(
          host.workspaceController.teamItems.map(async (item) =>
            host.workflowRuntime.state(item.id)
              .then(({ revision }) => revision !== item.runtime?.revision)
              .catch(() => false)
          )
        )).some(Boolean);
        if (!host.session.accounts.size) {
          if (runtimeChanged) await host.workspaceController.refresh();
          return;
        }
        const before = await signature();
        await host.session.reconcileServerOrgs();
        let applied = 0;
        if (host.session.orgIsConnected() && host.session.orgToken()) {
          if (host.workspaceController.workspace.teamId) {
            applied = await syncService()
              .synchronize(host.workspaceController.workspace.organizationId, host.workspaceController.workspace.teamId)
              .catch(() => 0);
          }
          await controlTick();
        }
        if (runtimeChanged || applied > 0 || (await signature()) !== before) {
          await host.workspaceController.refresh();
          if (applied > 0) await host.workspaceController.seedInstalledWorkflows();
        }
      }
      catch {
        // Offline, or a request the server refused: keep the last-known state and try again later.
      }
      finally {
        running = false;
      }
    };
    window.addEventListener("focus", () => void tick());
    setInterval(() => void tick(), BACKGROUND_SYNC_MS);
    void tick();
  }

  function claimSetting(itemId: string): string {
    return `work_claim_${itemId}`;
  }

  async function createRuntimeWait(
    itemId: string,
    input: Omit<Extract<WorkItemCommand, { type: "wait" }>, "type" | "claimToken">
  ): Promise<void> {
    const claim = await host.repository.getSetting<RuntimeClaim | null>(claimSetting(itemId), null);
    const state = await host.workflowRuntime.command(itemId, {
      type: "wait",
      ...input,
      ...(claim?.token ? { claimToken: claim.token } : {})
    });
    if (!state.claim && claim) {
      stopClaimHeartbeat(itemId);
      await host.repository.setSetting(claimSetting(itemId), null);
    }
  }

  async function resolveRuntimeWait(itemId: string, correlationKey: string): Promise<void> {
    await host.workflowRuntime.command(itemId, { type: "resolve_wait", correlationKey });
  }

  async function attachExecution(itemId: string, agentId: string, executionId: string): Promise<void> {
    const claim = await host.repository.getSetting<RuntimeClaim | null>(claimSetting(itemId), null);
    if (!claim?.token) throw new Error("The work claim is unavailable");
    const state = await host.workflowRuntime.command(itemId, {
      type: "claim",
      machineId: runnerId,
      claimToken: claim.token,
      agentId,
      executionId
    });
    if (!state.claim) throw new Error("The work claim is unavailable");
    await host.repository.setSetting(claimSetting(itemId), state.claim);
  }

  function stopClaimHeartbeat(itemId: string): void {
    const heartbeat = claimHeartbeats.get(itemId);
    if (heartbeat) clearInterval(heartbeat);
    claimHeartbeats.delete(itemId);
  }

  function startClaimHeartbeat(itemId: string, organizationId: string): void {
    stopClaimHeartbeat(itemId);
    let renewing = false;
    const heartbeat = setInterval(async () => {
      if (renewing) return;
      renewing = true;
      try {
        const claim = await host.repository.getSetting<RuntimeClaim | null>(claimSetting(itemId), null);
        if (!claim) throw new Error("The work claim is unavailable");
        const renewed = await host.workflowRuntime.command(itemId, {
          type: "heartbeat",
          machineId: runnerId,
          claimToken: claim.token
        });
        if (!renewed.claim) throw new Error("The work claim is unavailable");
        await host.repository.setSetting(claimSetting(itemId), renewed.claim);
      }
      catch (error) {
        stopClaimHeartbeat(itemId);
        await host.repository.setSetting(claimSetting(itemId), null).catch(() => undefined);
        const active = executions.filter(({ workItemId, status }) =>
          workItemId === itemId && (status === "queued" || status === "running")
        );
        await Promise.all(active.map(({ id }) => host.runCoordinator.stop(id).catch(() => undefined)));
        host.shell.notifyLocal("Work stopped", `This device lost its work claim: ${errorText(error)}`);
      }
      finally {
        renewing = false;
      }
    }, 30_000);
    claimHeartbeats.set(itemId, heartbeat);
  }

  async function acquireClaim(
    item: WorkItem,
    agentId: string,
    executionId?: string
  ): Promise<RuntimeClaim> {
    if (host.session.orgIsConnected()) {
      if (!host.session.orgToken()) throw new Error("Sign in before running shared work");
      await syncService().synchronize(host.workspaceController.workspace.organizationId, host.workspaceController.workspace.teamId);
    }
    const organizationId = host.workspaceController.workspace.organizationId;
    const existingClaim = await host.repository.getSetting<RuntimeClaim | null>(
      claimSetting(item.id),
      null
    );
    const state = await host.workflowRuntime.command(item.id, {
      type: "claim",
      machineId: runnerId,
      ...(existingClaim?.token ? { claimToken: existingClaim.token } : {}),
      agentId,
      ...(executionId ? { executionId } : {})
    });
    const claim = state.claim;
    if (!claim || claim.machineId !== runnerId) throw new Error("The work item was not claimed");
    await host.repository.setSetting(claimSetting(item.id), claim);
    startClaimHeartbeat(item.id, organizationId);
    return claim;
  }

  async function releaseClaim(itemId: string, organizationId = host.workspaceController.workspace.organizationId): Promise<void> {
    const claim = await host.repository.getSetting<RuntimeClaim | null>(claimSetting(itemId), null);
    if (!claim)
      return;
    stopClaimHeartbeat(itemId);
    try {
      await host.workflowRuntime.command(itemId, {
        type: "release",
        machineId: runnerId,
        claimToken: claim.token
      });
    } finally {
      await host.repository.setSetting(claimSetting(itemId), null);
    }
  }

  async function syncCheckpoint(
    itemId: string,
    executionId?: string,
    targetStageId?: string
  ): Promise<void> {
    const claim = await host.repository.getSetting<RuntimeClaim | null>(claimSetting(itemId), null);
    if (!claim) return;
    const item = await host.repository.getWorkItem(itemId);
    if (!item) throw new Error("The completed work item is unavailable");
    stopClaimHeartbeat(itemId);
    const target = targetStageId ?? item.stageId;
    // A run whose outputs await approval keeps its claim, but the lease is renewed from memory:
    // quit the app while those outputs sit in the approvals tab and it expires. The decision still
    // has to land hours later, so a claim the runtime already dropped moves the item anyway —
    // otherwise `complete` is rejected and the item sits at this status for good.
    const live = await host.workflowRuntime.state(itemId).catch(() => null);
    await host.workflowRuntime.command(itemId, live?.claim?.token === claim.token
      ? {
          type: "complete",
          machineId: runnerId,
          claimToken: claim.token,
          executionId: executionId ?? claim.executionId ?? crypto.randomUUID(),
          targetStageId: target
        }
      : { type: "move", targetStageId: target });
    await host.repository.setSetting(claimSetting(itemId), null);
    if (host.session.orgIsConnected()) {
      await syncService().synchronize(
        host.workspaceController.workspace.organizationId,
        host.workspaceController.workspace.teamId
      );
    }
  }

  async function checkpointTargetId(itemId: string, requested?: string): Promise<string | undefined> {
    const item = await host.repository.getWorkItem(itemId);
    const process = item
      ? host.workspaceController.processes.find(({ id }) => id === item.processId)
      : undefined;
    if (!item || !process) throw new Error("The work item's process is unavailable");
    const target = requireTaskPlanAgentStage(
      process,
      processEngine.resolveTarget(process, item, requested)
    );
    if (requested?.trim() && !target) {
      throw new Error(`Unknown status ID "${requested.trim()}"`);
    }
    return target?.id;
  }

  const settlementApplications = new Map<string, Promise<void>>();

  /**
   * Applies the durable Rust receipt to Bees. Events only wake this function; startup scans the
   * same receipts, so losing a webview or event cannot lose the application transaction.
   */
  function applySettledExecution(
    executionId: string,
    announce = false,
    render = true,
    retainClaim = false
  ): Promise<void> {
    const existing = settlementApplications.get(executionId);
    if (existing)
      return existing;
    const applying = (async () => {
      let execution = await host.repository.getExecution(executionId);
      if (!execution ||
        !["completed", "failed", "cancelled", "interrupted"].includes(execution.status) ||
        !execution.result ||
        execution.result.projectionState === "done") {
        return;
      }
      await resolveRuntimeWait(
        execution.workItemId,
        `execution:${execution.id}`
      ).catch(() => undefined);
      const outputs = Array.isArray(execution.result.outputs)
        ? execution.result.outputs.filter((output): output is string => typeof output === "string")
        : [];
      // A small model sometimes writes its next tool call out as text instead of calling it. Nothing
      // runs, nothing is written, and the run still reports success, so the item looks finished with
      // no file and no reason given. Call it what it is, so it can be run again.
      const describedATool = execution.status === "completed" && outputs.length === 0 &&
        /<tool_call|<function=/.test(JSON.stringify(execution.conversationSnapshot ?? ""));
      if (describedATool) {
        await host.repository.updateExecution(execution.id, "failed",
          { error: "The model wrote a tool call as text instead of calling the tool, so nothing ran. Run it again." });
      }
      const settledStatus = describedATool ? "failed" : execution.status;
      const continuation = execution.result.continuation === true;
      const manualProjection = execution.result.manualProjection === true;
      const projectMode = execution.result.projectMode === true;
      const statusId = typeof execution.result.statusId === "string" ? execution.result.statusId : undefined;
      if (execution.result.projectionState === "pending") {
        const projectedItem = await host.repository.getWorkItem(execution.workItemId);
        if (execution.status === "completed" && outputs.length && projectedItem) {
          const process = host.workspaceController.processes.find(({ id }) => id === projectedItem.processId);
          const target = process ? processEngine.resolveTarget(process, projectedItem, statusId) : undefined;
          const outputFolder = target ? process?.definition.outputFolders?.[target.id] : undefined;
          if (outputFolder) {
            await host.repository.routeExecutionOutputs(execution.id, outputFolder);
          }
        }
        if (execution.status !== "completed" && projectedItem) {
          await createRuntimeWait(projectedItem.id, {
            kind: "error",
            reason: execution.error || "The agent run did not complete",
            executionId: execution.id,
            correlationKey: `execution-error:${execution.id}`
          });
        }
        if (execution.status === "completed" &&
          outputs.length === 0 &&
          !continuation &&
          !manualProjection) {
          const targetStageId = await checkpointTargetId(execution.workItemId, statusId);
          await syncCheckpoint(execution.workItemId, execution.id, targetStageId);
          await host.repository.checkpointWorkItem(
            execution.workItemId,
            [],
            targetStageId,
            execution.id,
            projectedItem?.stageId
          );
        }
        else {
          await host.repository.markExecutionProjectionLocal(execution.id);
          // A task plan is the worker's own decomposition, not a deliverable a human authored —
          // spawn every proposed task automatically instead of waiting for manual selection.
          const settledExecution = execution;
          const pendingOutputs = settledExecution.status === "completed"
            ? await host.repository.listExecutionOutputs(settledExecution.id, "pending")
            : [];
          // A plan alongside pending file outputs waits for the human: its tasks may depend on
          // files that are still undecided, and approveTaskPlan rejects that ordering.
          const planOutput = pendingOutputs.length === 1
            ? pendingOutputs.find(({ logicalOutput }) => taskPlanController.matchesOutput(logicalOutput, settledExecution))
            : undefined;
          if (planOutput) {
            const mapping = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
            // A plan Bees declines to approve on its own is answerable — a person can edit the
            // tasks and approve the same output by hand. Park it on the item it belongs to,
            // keyed so that approval clears it, rather than letting it reach `reportFailure`,
            // which would attribute it to whichever item happens to be on screen and leave a
            // wait nothing can resolve.
            if (mapping?.localPath) {
              await taskPlanController
                .approveTaskPlan(planOutput, settledExecution, mapping.localPath)
                .catch((error: unknown) =>
                  createRuntimeWait(settledExecution.workItemId, {
                    kind: "error",
                    reason: errorText(error),
                    correlationKey: taskPlanWaitKey(planOutput.id)
                  })
                );
            }
          }
        }
        execution = (await host.repository.getExecution(execution.id)) ?? execution;
      }
      if (execution.result?.projectionState === "local_applied") {
        const scope = await host.repository.getWorkItemScope(execution.workItemId);
        if (!retainClaim && (manualProjection || execution.status !== "completed" || outputs.length === 0)) {
          await releaseClaim(execution.workItemId, scope?.organizationId);
        }
        if (!projectMode &&
          (manualProjection || execution.status !== "completed" || outputs.length === 0) &&
          execution.workspaceRef) {
          await host.workspaces.cleanup(execution.workspaceRef).catch(() => undefined);
        }
        await host.repository.completeExecutionProjection(execution.id);
      }
      if (announce) {
        const item = await host.repository.getWorkItem(execution.workItemId);
        const title = item?.title ?? "Bees run";
        if (continuation && settledStatus === "completed" && outputs.length === 0) {
          host.shell.notifyLocal("Bees replied", title);
        }
        else if (settledStatus === "completed" && outputs.length === 0) {
          host.shell.notifyLocal("Bees run completed", `${title} finished with no file changes.`);
        }
        else if (settledStatus === "completed") {
          host.shell.notifyLocal("Bees needs your review", `${outputs.length} file change(s) from ${title}.`);
        }
        else {
          host.shell.notifyLocal("Bees run failed", execution.error ?? "The agent stopped before finishing");
        }
      }
      if (render)
        await host.workspaceController.refresh();
    })().finally(() => settlementApplications.delete(executionId));
    settlementApplications.set(executionId, applying);
    return applying;
  }

  /** The agent wired to a status, if any. Agents own the link now, not stages. */
  function agentForStage(stageId: string | undefined): Agent | undefined {
    return stageId ? host.workspaceController.agents.find(({ triggerStageId }) => triggerStageId === stageId) : undefined;
  }

  function configuredAgentRole(agent: Agent): string {
    return String(agent.config.role ?? agent.name).trim();
  }

  function taskWorkerRoles(): Array<{
    role: string;
    purpose: string;
    agent: Agent;
  }> {
    const taskWorkStages = new Set(host.workspaceController.processes.filter(hasTaskPlanCapability)
      .flatMap((process) => taskPlanStages(process)?.work.id ?? []));
    const reserved = new Set(["goal-planner", "goal-reviewer", "skill-editor"]);
    const seen = new Set<string>();
    return host.workspaceController.agents.flatMap((agent) => {
      const role = configuredAgentRole(agent);
      const normalized = role.toLowerCase();
      if (!role ||
        !agent.config.prompt.trim() ||
        reserved.has(normalized) ||
        (agent.triggerStageId !== null && !taskWorkStages.has(agent.triggerStageId)) ||
        seen.has(normalized)) {
        return [];
      }
      seen.add(normalized);
      return [{ role, purpose: agent.purpose || agent.description, agent }];
    });
  }

  function agentForItem(item: WorkItem): Agent | undefined {
    const process = host.workspaceController.processes.find(({ id }) => id === item.processId);
    return process
      ? processEngine.agentForItem(process, item, host.workspaceController.agents)
      : agentForStage(item.stageId);
  }

  async function scheduledWorkItemId(schedule: Schedule): Promise<string> {
    const template = await host.repository.getWorkItem(schedule.workItemId);
    const process = template
      ? host.workspaceController.processes.find(({ id }) => id === template.processId)
      : null;
    const stage = process?.stages[0];
    if (!template || !process || !stage)
      throw new Error("The scheduled work item has no active process");
    const key = `schedule:${schedule.id}:${schedule.updatedAt}`;
    const existing = (await host.repository.listWorkItems(process.id)).find((item) => item.goal?.key === key);
    if (existing)
      return existing.id;
    const agent = agentForItem({ ...template, stageId: stage.id, goal: null });
    return host.repository.createWorkItem(process.id, {
      stageId: stage.id,
      title: template.title,
      description: template.description,
      ...(template.owner ? { owner: template.owner } : {}),
      logicalFiles: template.logicalFiles,
      goal: {
        key,
        role: agent ? configuredAgentRole(agent) : "",
        effect: "prepare",
        planOutputId: null,
        authorizedAt: new Date().toISOString(),
        occurrenceOf: template.id
      }
    });
  }

  async function runScheduledOccurrence(schedule: Schedule, auto: boolean): Promise<void> {
    const itemId = await scheduledWorkItemId(schedule);
    if (!(await host.repository.listExecutionsForWorkItem(itemId)).length)
      await runItem(itemId, auto, undefined, undefined, true);
    await host.workflowRuntime.command(schedule.workItemId, {
      type: "ack_schedule",
      scheduleId: schedule.id
    });
  }

  // Async so a bridged connection's process is up before the run is handed an address.
  async function runComposition(agent: Agent): Promise<{
    capabilities: ReturnType<typeof selectedAgentCapabilities>;
    mcpConnections: McpConnection[];
    delegates: Array<{
      agent: Agent;
      skillRefs: string[];
    }>;
  }> {
    const helpers = (agent.config.delegateRefs ?? []).map((id) => {
      const helper = host.workspaceController.agents.find((candidate) => candidate.id === id);
      if (!helper || helper.id === agent.id)
        throw new Error("A selected helper is unavailable");
      if (helper.config.delegateRefs?.length) {
        throw new Error(`${helper.name} cannot be a helper because it selects helpers of its own`);
      }
      if (helper.config.mcpConnectionRefs?.length ||
        selectedAgentCapabilities(host.workspaceController.registries, helper.config).some(({ kind }) => kind === "tool")) {
        throw new Error(`${helper.name} cannot be a helper because helpers support skills and browser only`);
      }
      return { agent: helper, skillRefs: capabilityRefsFor(helper.config, "skill") };
    });
    const selected = [
      ...selectedAgentCapabilities(host.workspaceController.registries, agent.config),
      ...helpers.flatMap(({ agent: helper }) => selectedAgentCapabilities(host.workspaceController.registries, helper.config).filter(({ kind }) => kind === "skill"))
    ];
    const seen = new Set<string>();
    const selectedConnections = (await Promise.all(
      (agent.config.mcpConnectionRefs ?? []).map(async (id) => {
        const connection = host.workspaceController.mcpConnections.find((candidate) => candidate.id === id);
        if (!connection)
          throw new Error("A selected MCP connection is unavailable");
        const checked = await checkedConnection(connection);
        return checked && mcpConnectionForAgent(checked, agent.config);
      })
    )).filter((connection) => connection !== null);
    return {
      capabilities: selected.filter(({ ref }) => !seen.has(ref) && Boolean(seen.add(ref))),
      mcpConnections: [...selectedConnections, ...(host.session.knowledgeConnection ? [host.session.knowledgeConnection] : [])],
      delegates: helpers
    };
  }

  /**
   * A connection's tools as the server has them now, written back so the rest of the app agrees.
   *
   * The stored list is only a record of the last check. Flue refuses a whole submission when the
   * allowlist names a tool the server has since dropped, and the reason is scrubbed to "an
   * internal error" before anyone sees it. Asking first turns a changed server into what the
   * connection already promises: an optional one steps aside, a required one says which and why.
   */
  async function checkedConnection(stored: McpConnection): Promise<McpConnection | null> {
    // Start the bridge first: a bridged connection has no address until it runs.
    const reachable = await withBridgeUrl(stored);
    // A plugin's server publishes its own catalogue at connection time, so it has no allowlist
    // that can go stale.
    if (reachable.allTools)
      return reachable;
    // The bridge port belongs to this run, so storing it would only show a dead one later.
    const save = (connection: McpConnection): Promise<void> =>
      saveMcpConnection(host.repository, { ...connection, url: stored.url });
    try {
      const tools = await discoverMcpTools(reachable, await host.ensureFlueRuntime());
      const checked = withMcpHealth(reachable, tools);
      await save(checked);
      // Pruning every name off a connection that had some is a server that moved on, not a choice.
      // A run would drop it and leave the agent short a connection it was told it had.
      if (stored.allowedTools.length && !checked.allowedTools.length && !stored.optional) {
        throw new Error(
          `${stored.name} no longer offers ${stored.allowedTools.join(", ")}. `
          + `It now offers ${tools.map(({ name }) => name).join(", ") || "nothing"}.`
        );
      }
      return checked;
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await save(withMcpHealth(reachable, stored.tools, reason));
      if (stored.optional)
        return null;
      throw new Error(`${stored.name} is unavailable: ${reason}`);
    }
  }

  function controlInput(action: string, resource: ControlInput["resource"], context: Partial<ControlInput["context"]> = {}): ControlInput {
    return {
      action,
      subject: {
        userId: host.session.currentUser()?.id ?? "local-user",
        roles: [host.session.serverOrgs.get(host.workspaceController.workspace.organizationId)?.role ?? "member"],
        teamIds: host.workspaceController.workspace.teamId ? [host.workspaceController.workspace.teamId] : []
      },
      resource,
      context: {
        workspaceId: host.workspaceController.workspace.organizationId,
        ...(host.workspaceController.workspace.teamId ? { teamId: host.workspaceController.workspace.teamId } : {}),
        deviceId: runnerId,
        ...context
      }
    };
  }

  async function controlDecision(input: ControlInput): Promise<PolicyDecision> {
    const identity = controlIdentity();
    return identity ? decideControl(host.repository, identity, input) : { decision: "allow" };
  }

  async function enforceControl(input: ControlInput, offerException = false): Promise<void> {
    const decision = await controlDecision(input);
    if (decision.decision === "allow")
      return;
    if (decision.decision === "approval_required" && offerException) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60000).toISOString();
      const data = await host.actions.edit("Request policy exception", [
        { name: "reason", label: "Business reason", type: "textarea" },
        {
          name: "expiresAt",
          label: "Expires at (ISO timestamp)",
          value: expiresAt,
          hint: "The administrator can narrow this further before approval."
        }
      ], "Request");
      const identity = controlIdentity();
      if (data && identity) {
        await requestException(host.repository, identity, {
          policyId: decision.policyId,
          action: input.action,
          resourceType: input.resource.type,
          ...(input.resource.id ? { resourceId: input.resource.id } : {}),
          ...(input.context.agentId ? { agentId: input.context.agentId } : {}),
          reason: String(data.get("reason") ?? ""),
          expiresAt: String(data.get("expiresAt") ?? "")
        });
      }
    }
    throw new Error(`[${decision.policyId}] ${decision.reason}`);
  }

  async function projectToolsByPolicy(agent: Agent, composition: Awaited<ReturnType<typeof runComposition>>): Promise<{
    agent: Agent;
    composition: Awaited<ReturnType<typeof runComposition>>;
  }> {
    const toolAllowed = async (tool: Record<string, unknown>): Promise<boolean> => (await controlDecision(controlInput("tool.expose", { type: "tool", id: String(tool.id ?? ""), attributes: {} }, { agentId: agent.id, tool }))).decision === "allow";
    const browserConfigured = agent.config.toolRefs?.includes(BROWSER_TOOL_REF) ?? true;
    const browserAllowed = !browserConfigured ||
      (await toolAllowed({ id: BROWSER_TOOL_REF, kind: "browser", effect: "read" }));
    const browserWriteAllowed = browserAllowed &&
      (!agent.config.grants?.includes(BROWSER_WRITE_GRANT) ||
        (await toolAllowed({ id: BROWSER_WRITE_GRANT, kind: "browser", effect: "write" })));
    const nextAgent = browserAllowed && browserWriteAllowed
      ? agent
      : {
        ...agent,
        config: {
          ...agent.config,
          ...(browserAllowed
            ? {}
            : { toolRefs: (agent.config.toolRefs ?? []).filter((ref) => ref !== BROWSER_TOOL_REF) }),
          ...(browserWriteAllowed
            ? {}
            : { grants: (agent.config.grants ?? []).filter((grant) => grant !== BROWSER_WRITE_GRANT) })
        }
      };
    const capabilities = [];
    for (const capability of composition.capabilities) {
      if (capability.kind !== "tool" ||
        (await toolAllowed({
          id: capability.ref,
          kind: "local",
          effect: agent.config.grants?.includes(`local:${capability.ref}`) ? "write" : "read"
        }))) {
        capabilities.push(capability);
      }
    }
    const mcpConnections = [];
    for (const connection of composition.mcpConnections) {
      if (connection.allTools) {
        if (await toolAllowed({
          id: `${connection.id}:*`,
          kind: "mcp",
          connectionId: connection.id,
          name: "*",
          effect: "write"
        })) mcpConnections.push(connection);
        continue;
      }
      const allowedTools = [];
      for (const name of connection.allowedTools) {
        const tool = connection.tools.find((candidate) => candidate.name === name);
        if (await toolAllowed({
          id: `${connection.id}:${name}`,
          kind: "mcp",
          connectionId: connection.id,
          name,
          effect: tool?.readOnly ? "read" : "write"
        })) {
          allowedTools.push(name);
        }
      }
      if (allowedTools.length)
        mcpConnections.push({ ...connection, allowedTools });
    }
    return {
      agent: nextAgent,
      composition: { ...composition, capabilities, mcpConnections }
    };
  }

  function projectToolsByGoalEffect(effect: GoalTaskEffect | undefined, agent: Agent, composition: Awaited<ReturnType<typeof runComposition>>): {
    agent: Agent;
    composition: Awaited<ReturnType<typeof runComposition>>;
  } {
    if (!effect || effect === "external_write")
      return { agent, composition };
    const writeGrant = (grant: string): boolean => grant === BROWSER_WRITE_GRANT || grant.startsWith("local:") || grant.startsWith("mcp:");
    const nextAgent = {
      ...agent,
      config: {
        ...agent.config,
        grants: (agent.config.grants ?? []).filter((grant) => !writeGrant(grant))
      }
    };
    const capabilities = composition.capabilities.filter(({ kind, ref }) => kind !== "tool" || !agent.config.grants?.includes(`local:${ref}`));
    const mcpConnections = composition.mcpConnections.flatMap((connection) => {
      const allowedTools = connection.allowedTools.filter((name) => connection.tools.find((tool) => tool.name === name)?.readOnly === true);
      return allowedTools.length ? [{ ...connection, allowedTools }] : [];
    });
    const delegates = composition.delegates.map(({ agent: helper, skillRefs }) => ({
      agent: {
        ...helper,
        config: {
          ...helper.config,
          grants: (helper.config.grants ?? []).filter((grant) => !writeGrant(grant))
        }
      },
      skillRefs
    }));
    return {
      agent: nextAgent,
      composition: { ...composition, capabilities, mcpConnections, delegates }
    };
  }

  /**
   * Running is a property of the process, not of a task: switching it on is the only click
   * needed, and every item that lands on a status with an agent runs itself from then on.
   * Stopping also cancels whatever that process has in flight, so it is a real brake.
   */
  async function setProcessRunning(processId: string, running: boolean): Promise<void> {
    const process = host.workspaceController.processes.find(({ id }) => id === processId);
    if (running && process && processEngine.isInteractive(process)) {
      throw new Error("Interactive processes run from the item view");
    }
    if (running) {
      runningProcesses.add(processId);
      // Asking again is a retry: statuses parked by a failed or self-repeating run become eligible.
      for (const key of [...autopilotDone])
        autopilotDone.delete(key);
    }
    else {
      runningProcesses.delete(processId);
    }
    await host.repository.setSetting(RUNNING_PROCESSES_KEY, [...runningProcesses]);
    if (!running) {
      const inFlight = executions.filter(({ workItemId, status }) => ["queued", "running"].includes(status) &&
        host.workspaceController.teamItems.some((item) => item.id === workItemId && item.processId === processId));
      for (const execution of inFlight) {
        await host.runCoordinator.stop(execution.id).catch(() => undefined);
        await releaseClaim(execution.workItemId).catch(() => undefined);
      }
    }
    await host.workspaceController.refresh();
    host.shell.showNotice(running ? "Process running" : "Process stopped", "success");
  }

  /** The next item a running process owes work to. */
  function autopilotNext(): WorkItem | undefined {
    const work = executions.filter((execution) => !isProposal(execution));
    return host.workspaceController.teamItems.find((item) => {
      const agent = agentForItem(item);
      return (runningProcesses.has(item.processId) &&
        Boolean(agent?.config.prompt.trim()) &&
        Boolean(agent && host.workspaceController.eligibilityForAgent(agent).active) &&
        needsAutonomousRun(item, work, autopilotDone));
    });
  }

  /** Rejections at one status before Bees offers to rewrite that status's skill. */
  const PROPOSAL_THRESHOLD = 3;
  const TEAM_SKILLS_OUTPUT_PREFIX = "plugins/team-skills/";

  const SKILL_EDITOR_PROMPT = `You improve the written procedure a team's agents follow.
  
  You are given the rejections people wrote when they turned down work at one step of a process.
  Find what they have in common — a standing rule the agent keeps missing — and ignore anything
  that only applied to one task.
  
  If a current skill is in /workspace/inputs, edit it: keep what still holds, change only what the
  rejections contradict. Write the result as a single SKILL.md at the path you are told, with
  frontmatter (name, description) and a short body of imperative rules. Under 300 words. If the
  rejections share nothing worth a standing rule, write no file at all.`;

  /** The built-in agent that writes skill proposals. A file like any other, so the team can tune it. */
  async function ensureSkillEditorAgent(teamRoot: string): Promise<Agent> {
    const existing = host.workspaceController.agents.find(({ config }) => config.role === "skill-editor");
    if (existing)
      return existing;
    const created = await host.agentFiles.save(teamRoot, newAgent({
      name: "Skill editor",
      purpose: "Turns repeated rejections into a skill every agent can read",
      config: { role: "skill-editor", prompt: SKILL_EDITOR_PROMPT, toolRefs: [], grants: [] }
    }));
    host.workspaceController.agents = [...host.workspaceController.agents, created];
    return created;
  }

  /**
   * Tier two of the feedback loop: one rejection is about one task, but the same complaint three
   * times at the same status is a missing rule. The proposal is written as an ordinary run output,
   * so it lands in the approval queue the user already reviews — nothing self-edits unwatched.
   */
  async function proposeSkillEdit(item: WorkItem): Promise<void> {
    const stage = host.workspaceController.processes.find(({ id }) => id === item.processId)
      ?.stages.find(({ id }) => id === item.stageId);
    if (!stage || !agentForItem(item))
      return;
    const openProposal = executions.some((execution) => execution.config.proposalStageId === stage.id &&
      (["queued", "running"].includes(execution.status) ||
        executionOutputs.some((output) => output.executionId === execution.id && output.status === "pending")));
    if (openProposal)
      return;
    const notes = await host.repository.listStageRejections(stage.id);
    if (notes.length < PROPOSAL_THRESHOLD)
      return;
    const mapping = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
    if (!mapping?.localPath)
      return;
    const editor = await ensureSkillEditorAgent(mapping.localPath);
    const slug = skillSlug(`${stage.name}-${host.workspaceController.activeProcess?.name ?? "process"}`);
    await invoke("ensure_team_skills_plugin", { teamRoot: mapping.localPath });
    await host.workspaceController.ensureTeamSkillsRegistry(mapping.localPath);
    const destination = `plugins/team-skills/skills/${slug}/SKILL.md`;
    const current = host.workspaceController.registries.some((registry) => registry.sourcePath === `${mapping.localPath}/plugins/team-skills` &&
      registry.plugin.skills.some(({ path }) => path === `skills/${slug}/SKILL.md`));
    const proposalAgent = { ...editor, config: { ...editor.config, proposalStageId: stage.id } };
    await host.session.ensureKnowledgeConnection();
    const composition = await runComposition(proposalAgent);
    await host.runCoordinator.start({
      // The item rides along for context only: `proposalStageId` keeps this run out of its lifecycle.
      item: { ...item, logicalFiles: current ? [destination] : [] },
      agent: proposalAgent,
      teamId: host.workspaceController.workspace.teamId,
      teamRoot: mapping.localPath,
      ...composition,
      stages: [],
      feedbackIntro: `People rejected work at the "${stage.name}" step for these reasons. Write the shared rule as outputs/${destination}:`,
      feedback: notes
    });
    host.shell.notifyLocal("Bees proposed a skill", `A rule for "${stage.name}" is waiting for your review.`);
    await host.workspaceController.refresh();
  }

  /** Selects one team-owned skill for an agent without duplicating an existing reference. */
  async function attachTeamSkill(agent: Agent, teamRoot: string, skillPath: string): Promise<void> {
    const registry = (await host.repository.listRegistries(host.workspaceController.workspace.teamId))
      .find(({ sourcePath }) => sourcePath === `${teamRoot}/plugins/team-skills`);
    if (!registry)
      throw new Error("The team skills registry is unavailable");
    const ref = `${registry.id}:${skillPath}`;
    if (!agent.config.skillRefs?.includes(ref)) {
      await host.actions.writeAgent({
        ...agent,
        config: { ...agent.config, skillRefs: [...(agent.config.skillRefs ?? []), ref] }
      });
    }
  }

  /** Turns explicit "future items" feedback into a direct, reversible standing rule. */
  async function rememberRejection(item: WorkItem, reason: string): Promise<() => Promise<void>> {
    const stage = host.workspaceController.processes.find(({ id }) => id === item.processId)?.stages.find(({ id }) => id === item.stageId);
    const agent = agentForItem(item);
    const mapping = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
    if (!stage || !agent || !mapping?.localPath)
      throw new Error("That status has no writable agent skill");
    const slug = skillSlug(`${stage.name}-${host.workspaceController.activeProcess?.name ?? "process"}`);
    await invoke("update_team_skill_rule", { teamRoot: mapping.localPath, slug, reason });
    await host.workspaceController.ensureTeamSkillsRegistry(mapping.localPath);
    await attachTeamSkill(agent, mapping.localPath, `skills/${slug}/SKILL.md`);
    return async () => {
      await invoke("update_team_skill_rule", { teamRoot: mapping.localPath, slug, reason, remove: true });
      await host.workspaceController.ensureTeamSkillsRegistry(mapping.localPath);
      await host.workspaceController.refresh();
    };
  }

  /**
   * Drains the running processes one run at a time. Called after every refresh, so a new item,
   * a moved item, or a just-finished run picks up the next one without anyone pressing Run.
   */
  async function autopilot(): Promise<void> {
    if (autopilotBusy)
      return;
    autopilotBusy = true;
    try {
      for (const schedule of schedules.filter(({ enabled, pending }) => enabled && pending)) {
        await runScheduledOccurrence(schedule, true).catch((error) => {
          const message = errorText(error);
          host.shell.notifyLocal("Scheduled Bees run could not start", message);
          host.shell.showNotice(message, "error");
        });
      }
      for (let next = autopilotNext(); next; next = autopilotNext()) {
        const item = next;
        for (const key of autonomousRunKeys(item))
          autopilotDone.add(key);
        await runItem(item.id, true).catch((error) => host.shell.showNotice(errorText(error), "error"));
      }
    }
    finally {
      autopilotBusy = false;
    }
  }

  /**
   * Everything a process turn needs before the item is claimed: the agent behind the role, the
   * policy-projected tool composition, and the control decisions. Kept separate from the run so a
   * batch of concurrent turns clears policy for all of them before any of them starts.
   */
  async function prepareProcessAgentTurn(role: string, item: WorkItem, projectMode: boolean): Promise<{
    agent: Agent;
    composition: Awaited<ReturnType<typeof runComposition>>;
    teamRoot: string;
  }> {
    const source = host.workspaceController.agents.find(({ config }) => config.role === role);
    if (!source)
      throw new Error(`The ${role} agent is missing. Reinstall or repair this process.`);
    const selectedModel = resolveModelChoice(source.config, host.assistant.assistantModel, host.assistant.assistantCatalog);
    let agent = modelRef(source.config) === modelRef(selectedModel)
      ? source
      : {
        ...source,
        config: {
          ...source.config,
          provider: selectedModel.provider,
          model: selectedModel.model
        }
      };
    const eligibility = host.workspaceController.eligibilityForAgent(agent);
    if (!eligibility.active)
      throw new Error(`${agent.name} is inactive: ${eligibility.reason}`);
    const mapping = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
    if (!mapping?.localPath)
      throw new Error("Set a local team folder before running process agents");
    if (host.localModels.isLocalModel(modelRef(agent.config))) {
      await host.localModels.requireRunning(agent.config.model);
    }
    await host.session.ensureKnowledgeConnection();
    let composition = await runComposition(agent);
    const projected = await projectToolsByPolicy(agent, composition);
    agent = projected.agent;
    composition = projected.composition;
    const classification = typeof agent.config.dataClassification === "string"
      ? agent.config.dataClassification
      : undefined;
    const sharedContext = {
      agentId: agent.id,
      ...(classification ? { dataClassification: classification } : {}),
      run: { automatic: false, scheduled: false, continuation: false }
    };
    await enforceControl(controlInput("run.start", { type: "work_item", id: item.id, attributes: {} }, sharedContext));
    await enforceControl(controlInput("model.invoke", { type: "model", id: modelRef(agent.config), attributes: {} }, {
      ...sharedContext,
      agentId: agent.id,
      model: {
        id: modelRef(agent.config),
        provider: agent.config.provider ?? "",
        location: host.localModels.isLocalModel(modelRef(agent.config))
          ? "local-device"
          : "external"
      }
    }), true);
    await enforceControl(controlInput("file.stage", {
      type: "file_set",
      attributes: {
        count: item.logicalFiles.length + (projectMode ? 1 : 0),
        hasLinkedLocations: item.logicalFiles.some((reference) => Boolean(parseLogicalFileReference(reference).locationId)),
        projectWorkspace: projectMode
      }
    }, sharedContext));
    return { agent, composition, teamRoot: mapping.localPath };
  }

  /**
   * Runs process agent turns and waits for their receipts. Turns handed over together run
   * concurrently: they share the item's read-only project worktree but nothing else, since Flue
   * binds capabilities and conversation state per execution. Only pass turns that cannot observe
   * each other's writes — the architecture debate's two sides, not a coder and its tester.
   *
   * A turn carrying `executionId` reopens that conversation instead of starting a cold one, so a
   * multi-round exchange keeps the repository analysis the model already paid for.
   */
  /** The linked locations an item's approved files point at, so a run can stage them. */
  async function referencedFileLocations(item: WorkItem): Promise<FileLocation[]> {
    const referenced = new Set(item.logicalFiles.flatMap((reference) => {
      const locationId = parseLogicalFileReference(reference).locationId;
      return locationId ? [locationId] : [];
    }));
    if (!referenced.size)
      return [];
    return (await host.repository.listAvailableFileLocations(host.workspaceController.workspace.teamId)).filter(({ id }) => referenced.has(id));
  }

  async function runProcessAgentTurns(item: WorkItem, turns: ProcessAgentTurn[], projectMode = false): Promise<Execution[]> {
    if (!turns.length)
      return [];
    const condition = workItemCondition(item, executions);
    if (condition !== "ready") {
      throw new Error(`This work item cannot run while it is ${condition}`);
    }
    if (activeExecutionForItem(item.id, executions)) {
      throw new Error("Another process agent is already working on this item");
    }
    const prepared = await Promise.all(turns.map((turn) => prepareProcessAgentTurn(turn.role, item, projectMode)));
    const fileLocations = await referencedFileLocations(item);
    await acquireClaim(item, prepared[0]!.agent.id);
    // allSettled, not all: a rejected sibling must not leave the other run orphaned behind a
    // released claim. Every hand-over finishes before the first failure is reported.
    const settled = await Promise.allSettled(prepared.map(async ({ agent, composition, teamRoot }, index) => {
      const turn = turns[index]!;
      await host.repository.recordSkillUse(host.workspaceController.workspace.teamId, composition.capabilities.filter(({ kind }) => kind === "skill").map(({ ref }) => ref));
      const outcome = await host.runCoordinator.start({
        // The item's approved files ride along: a brief that says "the requirements are in
        // roteris.txt" is useless to an agent that was never handed the file.
        item: { ...item, description: turn.prompt },
        agent,
        teamId: host.workspaceController.workspace.teamId,
        teamRoot,
        fileLocations,
        ...composition,
        stages: [],
        manualProjection: true,
        ...(turn.executionId ? { executionId: turn.executionId, message: turn.prompt } : {}),
        ...(projectMode ? { projectWorkItemId: item.id } : {}),
        onCreated: async (executionId) => {
          await createRuntimeWait(item.id, {
            kind: "execution",
            reason: `Waiting for ${agent.name}`,
            executionId,
            correlationKey: `execution:${executionId}`
          });
          await host.workspaceController.refresh();
        },
        // Rust marks the row running straight after hand-over, without an event — re-read it, or
        // the card reads "Queued" for the whole run and only corrects on `run-settled`.
        onStarted: () => host.workspaceController.refresh()
      });
      await applySettledExecution(outcome.executionId, true, true, true);
      const execution = await host.repository.getExecution(outcome.executionId);
      if (!execution)
        throw new Error("The project agent receipt is unavailable");
      if (execution.status !== "completed") {
        throw new Error(execution.error ?? `${agent.name} did not complete`);
      }
      return execution;
    }));
    const failures = settled.flatMap((result) => result.status === "rejected" ? [result.reason as Error] : []);
    if (failures.length) {
      await releaseClaim(item.id).catch(() => undefined);
      throw failures.length === 1 ? failures[0] : new AggregateError(failures, errorText(failures[0]));
    }
    await releaseClaim(item.id);
    return settled.map((result) => (result as PromiseFulfilledResult<Execution>).value);
  }

  /** `executions` only learns of a run at `onCreated`, so two near-simultaneous calls both started. */
  const startingItemIds = new Set<string>();

  /** Claimed before any await. Body split out so the guard does not reindent two hundred lines. */
  async function runItem(itemId: string, auto = false, continuation?: {
    execution: Execution;
    message: string;
  }, restartedFromExecutionId?: string, scheduled = false): Promise<void> {
    if (startingItemIds.has(itemId))
      throw new Error("This work item is already starting");
    startingItemIds.add(itemId);
    try {
      await runItemUnguarded(itemId, auto, continuation, restartedFromExecutionId, scheduled);
    }
    finally {
      startingItemIds.delete(itemId);
    }
  }

  async function runItemUnguarded(itemId: string, auto = false, continuation?: {
    execution: Execution;
    message: string;
  }, restartedFromExecutionId?: string, scheduled = false): Promise<void> {
    let item = host.workspaceController.teamItems.find(({ id }) => id === itemId)
      ?? (await host.repository.getWorkItem(itemId));
    if (!item)
      throw new Error("Work item not found");
    if (restartedFromExecutionId) {
      const errors = activeWorkItemWaits(item).filter(({ kind }) => kind === "error");
      for (const { id: waitId } of errors) {
        await host.workflowRuntime.command(item.id, { type: "resolve_wait", waitId });
      }
      item = workItemForRetry(item);
    }
    const condition = workItemCondition(item, executions);
    if (condition !== "ready") {
      throw new Error(`This work item cannot run while it is ${condition}`);
    }
    const process = host.workspaceController.processes.find(({ id }) => id === item.processId);
    const stage = process?.stages.find(({ id }) => id === item.stageId);
    if (!process || !stage)
      throw new Error("This work item has no active process step");
    const taskPlan = taskPlanContextForRun(process, stage);
    const availableStages = taskPlanAgentStages(process);
    const currentAgent = agentForItem(item);
    const originalAgent = continuation
      ? host.workspaceController.agents.find(({ id }) => id === continuation.execution.agentId)
      : null;
    const agent = continuation
      ? originalAgent
        ? { ...originalAgent, config: continuation.execution.config }
        : null
      : currentAgent;
    if (!agent) {
      throw new Error(continuation
        ? "The agent used by this run no longer exists"
        : "No agent is set to run on this status");
    }
    const selectedModel = resolveModelChoice(agent.config, host.assistant.assistantModel, host.assistant.assistantCatalog);
    // A continuation keeps the model the conversation started on, but "auto" is not a model —
    // it has to be resolved even then, or the run is handed the literal `auto/auto`.
    let runAgent = (!continuation || isAutoChoice(agent.config)) && modelRef(agent.config) !== modelRef(selectedModel)
      ? {
        ...agent,
        config: {
          ...agent.config,
          provider: selectedModel.provider,
          model: selectedModel.model
        }
      }
      : agent;
    const goalEffect = hasTaskPlanCapability(process) ? item.goal?.effect ?? "prepare" : undefined;
    if (goalEffect === "external_write") {
      if (!item.goal?.authorizedAt || !item.goal.planOutputId) {
        throw new Error("This external action has no approval receipt");
      }
      if (continuation || (await host.repository.listExecutionsForWorkItem(item.id)).length) {
        throw new Error("This external action approval has already been used; approve a fresh task to retry");
      }
      runAgent = {
        ...runAgent,
        config: {
          ...runAgent.config,
          validationRules: [...new Set([
            ...(runAgent.config.validationRules ?? []),
            "action-receipt"
          ])]
        }
      };
    }
    const eligibility = host.workspaceController.eligibilityForAgent(runAgent);
    if (!eligibility.active) {
      throw new Error(`${runAgent.name} is inactive: ${eligibility.reason}`);
    }
    if (!agent.config.prompt.trim())
      throw new Error(`${agent.name} has no instructions yet`);
    if (activeExecutionForItem(item.id, executions)) {
      throw new Error("This work item is already running on this device");
    }
    const mapping = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
    if (!mapping)
      throw new Error("Set a local team folder before running work");
    const classification = typeof runAgent.config.dataClassification === "string"
      ? runAgent.config.dataClassification
      : undefined;
    const sharedContext = {
      agentId: runAgent.id,
      ...(classification ? { dataClassification: classification } : {}),
      run: { automatic: auto, scheduled, continuation: Boolean(continuation) }
    };
    if (scheduled) {
      await enforceControl(controlInput("schedule.run", { type: "work_item", id: item.id, attributes: {} }, sharedContext));
    }
    await enforceControl(controlInput("run.start", { type: "work_item", id: item.id, attributes: {} }, sharedContext));
    await enforceControl(controlInput("model.invoke", { type: "model", id: modelRef(runAgent.config), attributes: {} }, {
      ...sharedContext,
      model: {
        id: modelRef(runAgent.config),
        provider: runAgent.config.provider ?? "",
        location: host.localModels.isLocalModel(modelRef(runAgent.config)) ? "local-device" : "external"
      }
    }), !auto);
    await enforceControl(controlInput("file.stage", {
      type: "file_set",
      attributes: {
        count: item.logicalFiles.length,
        hasLinkedLocations: item.logicalFiles.some((reference) => Boolean(parseLogicalFileReference(reference).locationId))
      }
    }, sharedContext));
    if (host.localModels.isLocalModel(modelRef(runAgent.config))) {
      await host.localModels.requireRunning(runAgent.config.model);
    }
    // Default folders are created on demand; a vanished override is a real error the user must fix.
    await (mapping.override
      ? host.workspaces.validateDirectory(mapping.localPath)
      : host.workspaces.ensureDirectory(mapping.localPath)).catch(() => {
        throw new Error(`Team folder is unavailable: ${mapping.localPath}`);
      });
    if (!continuation)
      await host.session.ensureKnowledgeConnection();
    await acquireClaim(item, runAgent.id, continuation?.execution.id);
    try {
      const fileLocations = await referencedFileLocations(item);
      let composition = continuation
        ? { capabilities: [], mcpConnections: [], delegates: [] }
        : await runComposition(runAgent);
      if (!continuation) {
        const projected = await projectToolsByPolicy(runAgent, composition);
        runAgent = projected.agent;
        composition = projected.composition;
        const goalProjection = projectToolsByGoalEffect(goalEffect, runAgent, composition);
        runAgent = goalProjection.agent;
        composition = goalProjection.composition;
      }
      const report = controlIdentity();
      const startedAt = Date.now();
      if (report) {
        await reportMetric(host.repository, report, "run.started", 1, {
          team: host.workspaceController.workspace.teamId,
          agent: runAgent.id
        }).catch(() => undefined);
      }
      // Stamped before the run rather than after it: what matters to the curator is that a skill
      // was put in front of a model, not whether that run went on to succeed.
      await host.repository.recordSkillUse(host.workspaceController.workspace.teamId, composition.capabilities.filter(({ kind }) => kind === "skill").map(({ ref }) => ref))
        .catch(() => undefined);
      const outcome = await host.runCoordinator.start({
        item,
        agent: runAgent,
        teamId: host.workspaceController.workspace.teamId,
        teamRoot: mapping.localPath,
        fileLocations,
        ...composition,
        ...(continuation
          ? { executionId: continuation.execution.id, message: continuation.message }
          : {}),
        ...(restartedFromExecutionId ? { restartedFromExecutionId } : {}),
        stages: availableStages.map(({ id, name }) => ({
          id,
          name,
          ...(process.definition.outputFolders?.[id]
            ? { outputFolder: process.definition.outputFolders[id] }
            : {})
        })),
        ...(taskPlan ? { taskPlan } : {}),
        ...(goalEffect ? { goalEffect } : {}),
        ...(hasTaskPlanCapability(process)
          ? { workerRoles: taskWorkerRoles().map(({ role, purpose }) => ({ role, purpose })) }
          : {}),
        ...(item.parentId
          ? { parent: host.workspaceController.teamItems.find(({ id }) => id === item.parentId)! }
          : {}),
        children: host.workspaceController.teamItems.filter(({ parentId }) => parentId === item.id),
        feedback: await host.repository.listRejectionFeedback(item.id),
        onCreated: async (executionId) => {
          if (!continuation)
            liveEvents.set(executionId, []);
          else {
            for (const output of executionOutputs.filter(({ executionId: ownerId }) => ownerId === executionId)) {
              outputPreviews.delete(output.id);
            }
          }
          await attachExecution(item.id, runAgent.id, executionId);
          // An autonomous run must not yank the user out of whatever they are looking at.
          if (!auto) {
            host.shell.activeExecutionId = executionId;
            host.shell.view = "run";
          }
          await host.workspaceController.refresh();
        },
        // Rust marks the row running straight after hand-over, without an event — re-read it, or
        // the card reads "Queued" for the whole run and only corrects on `run-settled`.
        onStarted: () => host.workspaceController.refresh()
      });
      await applySettledExecution(outcome.executionId, true);
      if (report) {
        await Promise.all([
          reportMetric(host.repository, report, "run.completed", 1, {
            team: host.workspaceController.workspace.teamId,
            agent: runAgent.id,
            outcome: outcome.status
          }),
          reportMetric(host.repository, report, "run.duration", Date.now() - startedAt, {
            team: host.workspaceController.workspace.teamId,
            agent: runAgent.id,
            outcome: outcome.status
          }),
          ...(outcome.outputs.length
            ? [reportMetric(host.repository, report, "review.pending", outcome.outputs.length, { team: host.workspaceController.workspace.teamId })]
            : [])
        ]).catch(() => undefined);
      }
    }
    catch (error) {
      const executionId = typeof error === "object" && error && "executionId" in error
        ? String(error.executionId)
        : "";
      const settled = executionId ? await host.repository.getExecution(executionId) : null;
      if (settled?.status !== "completed" && !settled?.result?.projectionState) {
        await createRuntimeWait(item.id, {
          kind: "error",
          reason: settled?.error || errorText(error),
          ...(executionId ? { executionId, correlationKey: `execution-error:${executionId}` } : {})
        }).catch(() => undefined);
      }
      if (settled?.endedAt && settled.result?.projectionState) {
        await applySettledExecution(executionId, true);
      }
      else {
        await releaseClaim(item.id).catch(() => undefined);
        if (settled?.workspaceRef)
          await host.workspaces.cleanup(settled.workspaceRef).catch(() => undefined);
        host.shell.notifyLocal("Bees run failed", errorText(error));
        await host.workspaceController.refresh();
      }
      throw error;
    }
  }

  /**
   * Retries whatever conversation purges are outstanding. Cheap and silent when the queue is
   * empty, which is the normal case — it only fills when a user deletes a run.
   */
  async function retryConversationPurges(): Promise<ReturnType<typeof drainConversationPurges>> {
    const pending = await host.repository.listPendingConversationPurges();
    if (!pending.length)
      return { purged: 0, pending: 0, lastError: null };
    const { baseUrl, token } = await host.ensureFlueRuntime();
    return drainConversationPurges(host.repository, new FlueRuntime(baseUrl, undefined, token));
  }

  async function deleteRun(executionId: string): Promise<void> {
    const execution = await host.repository.getExecution(executionId);
    if (!execution)
      return;
    if (["queued", "running"].includes(execution.status)) {
      await host.runCoordinator.stop(executionId);
      host.shell.showNotice("The run is stopping. Delete it after Flue reports the final result.", "info");
      await host.workspaceController.refresh();
      return;
    }
    if (execution.workspaceRef && execution.result?.projectMode !== true) {
      await host.workspaces.cleanup(execution.workspaceRef).catch(() => undefined);
    }
    await host.repository.deleteExecution(executionId, runtimeAgentName(execution.agentId));
    const localPurgeFailed = await host.flueProjectPort.purgeExecution(executionId)
      .then(() => false)
      .catch(() => true);
    // Never report the run deleted while its conversation is still in the runtime.
    const report = await retryConversationPurges().catch(() => ({
      purged: 0,
      pending: 1,
      lastError: "The local runtime is unavailable"
    }));
    if (host.shell.activeExecutionId === executionId)
      host.shell.view = "runs";
    await host.workspaceController.refresh();
    host.shell.showNotice(localPurgeFailed
      ? "Run removed, but its local capability snapshot could not be deleted. Restart Bees and try again."
      : purgeNotice(report), localPurgeFailed || report.pending ? "error" : "success");
  }

  let liveObservation: {
    executionId: string;
    controller: AbortController;
  } | null = null;

  /**
   * Follow a still-running conversation for the open run page. Presentation only: Rust settles
   * the run whether or not anyone is watching, so closing this changes nothing but the view.
   */
  async function observeRun(execution: Execution): Promise<void> {
    if (liveObservation?.executionId === execution.id)
      return;
    liveObservation?.controller.abort();
    liveObservation = null;
    if (!["queued", "running"].includes(execution.status))
      return;
    const controller = new AbortController();
    liveObservation = { executionId: execution.id, controller };
    const { baseUrl, token } = await host.ensureFlueRuntime();
    new FlueRuntime(baseUrl, undefined, token).observe(runtimeAgentName(execution.agentId), execution.conversationId, (event) => {
      liveEvents.set(execution.id, [event]);
      if (host.shell.view === "run" && host.shell.activeExecutionId === execution.id)
        void host.views.renderRunDetail();
    }, controller.signal);
  }

  async function openRun(executionId: string): Promise<void> {
    host.shell.activeExecutionId = executionId;
    host.shell.view = "run";
    const execution = executions.find(({ id }) => id === executionId) ?? (await host.repository.getExecution(executionId));
    if (execution) {
      await loadExecutionHistory(execution);
      void observeRun(execution).catch(() => undefined);
    }
    host.shell.render();
  }

  async function loadExecutionHistory(execution: Execution): Promise<void> {
    if (execution.conversationSnapshot)
      return;
    if (!liveEvents.has(execution.id)) {
      // The history fetch could already fail, the runtime start could not — so a dead runtime stopped
      // the card opening at all. The transcript is one tab; the rest reads from the database.
      const history = await host.ensureFlueRuntime()
        .then(({ baseUrl, token }) => new FlueRuntime(baseUrl, undefined, token)
          .history(runtimeAgentName(execution.agentId), execution.conversationId))
        .catch(() => null);
      liveEvents.set(execution.id, history ? [history] : []);
    }
  }

  async function finishOutputReview(execution: Execution): Promise<void> {
    const outputs = await host.repository.listExecutionOutputs(execution.id);
    if (outputs.some(({ status }) => status === "pending"))
      return;
    // A skill proposal never moves the work item it hung off — approving it publishes a file into
    // the team folder, and the registry has to re-read that folder for agents to see it.
    if (isProposal(execution)) {
      const mapping = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
      if (mapping?.localPath && outputs.some(({ status }) => status === "approved")) {
        await host.workspaceController.ensureTeamSkillsRegistry(mapping.localPath);
        const item = await host.repository.getWorkItem(execution.workItemId);
        const stageId = execution.config.proposalStageId;
        const agent = item && typeof stageId === "string"
          ? agentForItem({ ...item, stageId })
          : agentForStage(typeof stageId === "string" ? stageId : undefined);
        if (agent) {
          for (const output of outputs.filter(({ status, logicalDestination }) =>
            status === "approved" && logicalDestination.startsWith(TEAM_SKILLS_OUTPUT_PREFIX))) {
            await attachTeamSkill(
              agent,
              mapping.localPath,
              output.logicalDestination.slice(TEAM_SKILLS_OUTPUT_PREFIX.length)
            );
          }
        }
      }
      return;
    }
    if (!outputs.some(({ status }) => status === "rejected")) {
      // Task-plan approval already checkpointed and moved the parent. A second checkpoint here
      // would skip straight to Review.
      if (!outputs.some(({ logicalOutput }) => taskPlanController.matchesOutput(logicalOutput, execution))) {
        const requested = typeof execution.result?.statusId === "string"
          ? execution.result.statusId
          : undefined;
        const item = await host.repository.getWorkItem(execution.workItemId);
        const targetStageId = await checkpointTargetId(execution.workItemId, requested);
        await syncCheckpoint(execution.workItemId, execution.id, targetStageId);
        await host.repository.checkpointWorkItem(
          execution.workItemId,
          outputs.filter(({ status }) => status === "approved").map(({ logicalDestination }) => logicalDestination),
          targetStageId,
          undefined,
          item?.stageId
        );
      }
    }
    else {
      // Rejecting is asking for the work again: with no per-task Run button left, the item has to
      // become due on its own or it sits at this status forever.
      const item = await host.repository.getWorkItem(execution.workItemId);
      if (item?.goal?.effect === "external_write") {
        await createRuntimeWait(item.id, {
          kind: "human",
          reason: "The rejected external action needs human review before another attempt",
          executionId: execution.id,
          correlationKey: `external-review:${execution.id}`
        });
      }
      else {
        await host.repository.touchWorkItem(execution.workItemId);
      }
    }
    await releaseClaim(execution.workItemId);
  }

  /** Retry transient sidecar startup failures, then make every unrecoverable row explicit. */
  async function resumeInterruptedRuns(resumed: Execution[]): Promise<void> {
    let lastError: unknown;
    for (const delay of [0, 1000, 5000]) {
      if (delay)
        await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        await host.runCoordinator.resume(resumed);
        lastError = undefined;
        break;
      }
      catch (error) {
        lastError = error;
      }
    }
    if (lastError) {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      for (const execution of resumed) {
        const active = await invoke<boolean>("run_is_active", { executionId: execution.id }).catch(() => false);
        if (!active && !(await host.repository.getExecution(execution.id))?.endedAt) {
          await host.repository.updateExecution(execution.id, "interrupted", { error: message });
        }
      }
      host.shell.showNotice(message, "error");
    }
    for (const execution of await host.repository.listPendingExecutionProjections()) {
      await applySettledExecution(execution.id, false).catch((error) => host.shell.showNotice(errorText(error), "error"));
    }
  }

  return {
    taskPlanController,
    get executions() { return executions; },
    set executions(value: typeof executions) { executions = value; },
    get executionOutputs() { return executionOutputs; },
    set executionOutputs(value: typeof executionOutputs) { executionOutputs = value; },
    get projectFolderItemIds() { return projectFolderItemIds; },
    set projectFolderItemIds(value: typeof projectFolderItemIds) { projectFolderItemIds = value; },
    DISMISSED_RUNS_KEY,
    get dismissedRunIds() { return dismissedRunIds; },
    set dismissedRunIds(value: typeof dismissedRunIds) { dismissedRunIds = value; },
    get schedules() { return schedules; },
    set schedules(value: typeof schedules) { schedules = value; },
    get appVersion() { return appVersion; },
    set appVersion(value: typeof appVersion) { appVersion = value; },
    liveEvents,
    outputPreviews,
    get runnerId() { return runnerId; },
    set runnerId(value: typeof runnerId) { runnerId = value; },
    RUNNING_PROCESSES_KEY,
    get runningProcesses() { return runningProcesses; },
    set runningProcesses(value: typeof runningProcesses) { runningProcesses = value; },
    get disabledAgentIds() { return disabledAgentIds; },
    set disabledAgentIds(value: typeof disabledAgentIds) { disabledAgentIds = value; },
    autopilotDone,
    resumeCompletedTaskPlans,
    reportFailure,
    supervise,
    runStageId,
    get lastControlHealthAt() { return lastControlHealthAt; },
    set lastControlHealthAt(value: typeof lastControlHealthAt) { lastControlHealthAt = value; },
    startBackgroundSync,
    releaseClaim,
    applySettledExecution,
    taskWorkerRoles,
    agentForItem,
    runScheduledOccurrence,
    controlInput,
    enforceControl,
    setProcessRunning,
    proposeSkillEdit,
    rememberRejection,
    autopilot,
    runProcessAgentTurns,
    runItem,
    retryConversationPurges,
    deleteRun,
    openRun,
    loadExecutionHistory,
    finishOutputReview,
    resumeInterruptedRuns
  };
}
