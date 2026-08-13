import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  Agent,
  BeesRunInitialData,
  Capability,
  Execution,
  ExecutionStatus,
  FileLocation,
  GoalTaskEffect,
  McpConnection,
  Stage,
  TaskPlanRunContext,
  WorkItem
} from "./domain.js";
import type { FlueProjectService } from "./flue-project.js";
import { runtimeAgentName } from "./flue-project.js";
import { FOLLOW_UP_LIMIT, errorText } from "./domain.js";
import type { LocalRepository } from "./repository.js";
import type { TemporaryWorkspaceService } from "./workspaces.js";
import {
  PROJECT_INPUT_PREFIX,
  STATUS_OUTPUT,
  linkedLocationInputDirectory,
  stagedInputPath,
  validateCollectedOutputs
} from "./workspaces.js";
import {
  ACTION_RECEIPT_OUTPUT
} from "./processes/goals/index.js";
import { buildBeesRunInitialData } from "./run-config.js";

export interface RunRequest {
  item: WorkItem;
  agent: Agent;
  teamId?: string;
  teamRoot: string;
  fileLocations?: FileLocation[];
  capabilities?: Capability[];
  mcpConnections?: McpConnection[];
  delegates?: Array<{ agent: Agent; skillRefs: string[] }>;
  /** Existing Bees execution to reopen for a human follow-up. */
  executionId?: string;
  /** A human follow-up for the agent's existing item conversation. */
  message?: string;
  /** Database IDs and display labels for the status menu shown to the agent. */
  stages: Array<Pick<Stage, "id" | "name">>;
  taskPlan?: TaskPlanRunContext;
  goalEffect?: GoalTaskEffect;
  workerRoles?: Array<{ role: string; purpose: string }>;
  parent?: WorkItem;
  children?: WorkItem[];
  /** Why the user rejected earlier attempts at this status, oldest first. */
  feedback?: string[];
  /** Line above `feedback`. Overridden when the notes are evidence rather than corrections. */
  feedbackIntro?: string;
  onCreated?: (executionId: string) => void | Promise<void>;
  /** Rust has accepted the run and marked it running. The row the UI holds still says queued. */
  onStarted?: (executionId: string) => void | Promise<void>;
  /** The published config to run instead of the source run's snapshot. Restart with current config. */
  restartedFromExecutionId?: string;
  /** Run directly in this work item's validated external Git worktree. */
  projectWorkItemId?: string;
  /** The Software Project coordinator, not the generic process engine, advances this item. */
  manualProjection?: boolean;
}

export interface RunOutcome {
  executionId: string;
  status: ExecutionStatus;
  workspacePath: string;
  outputs: string[];
  /** Database stage ID written to outputs/.status. Empty when the run wrote nothing. */
  statusId: string;
}

export interface RuntimeLauncher {
  (): Promise<{ baseUrl: string; token?: string }>;
}

/** What the Rust `RunService` needs to own one run end to end. */
export interface RustRunRequest {
  executionId: string;
  deliveryId: string;
  agentName: string;
  prompt: string;
  workspace: string;
  baseUrl: string;
  token: string;
  instanceUid?: string;
  continuation: boolean;
  initialData?: BeesRunInitialData;
  validationRules: string[];
  taskPlan?: TaskPlanRunContext;
  projectMode: boolean;
  manualProjection: boolean;
}

export interface SettledRun {
  executionId: string;
  status: ExecutionStatus;
  outputs: string[];
  statusId: string;
  error?: string | null;
}

/** Seam over the Tauri commands, so the coordinator is testable without a host. */
export interface RunHost {
  startRun(request: RustRunRequest): Promise<void>;
  resumeRun(request: RustRunRequest, submissionId: string): Promise<void>;
  stopRun(request: RustRunRequest, submissionId: string): Promise<void>;
  awaitSettled(executionId: string, signal?: AbortSignal): Promise<SettledRun>;
}

export const tauriRunHost: RunHost = {
  startRun: (request) => invoke("start_run", { request }),
  resumeRun: (request, submissionId) => invoke("resume_run", { request, submissionId }),
  stopRun: (request, submissionId) => invoke("stop_run", { request, submissionId }),
  awaitSettled: (executionId, signal) =>
    new Promise<SettledRun>((resolve) => {
      // Rust has already written the receipt by the time this fires; the event only says
      // "look again". Losing it costs a notification, never the transaction.
      const stop = listen<SettledRun>("run-settled", (event) => {
        if (event.payload.executionId !== executionId) return;
        void stop.then((unlisten) => unlisten());
        resolve(event.payload);
      });
      // The subscription is opened just before hand-over, and hand-over can fail. Without this the
      // listener stayed for the life of the window, comparing every later run against an id that
      // could never arrive — one more each time a start failed, in an app built to stay open.
      // The promise is left unsettled rather than rejected: by this point nothing awaits it, and
      // rejecting an abandoned promise only trades a leak for an unhandled rejection.
      signal?.addEventListener("abort", () => void stop.then((unlisten) => unlisten()), { once: true });
    })
};

/**
 * The status menu is built per run, not baked into the materialized agent: statuses
 * get renamed, and a run should always see the process as it is right now.
 */
export function runPrompt({
  agent,
  item,
  message,
  stages,
  parent,
  children = [],
  feedback = [],
  feedbackIntro = "Earlier attempts at this step were rejected. Address every point before you finish:",
  fileLocations = [],
  taskPlan,
  goalEffect,
  workerRoles = [],
  projectWorkItemId
}: RunRequest): string {
  if (message !== undefined) {
    const followUp = message.trim();
    if (!followUp) throw new Error("Enter a message to continue the conversation");
    if (followUp.length > FOLLOW_UP_LIMIT) {
      throw new Error(`Message must be ${FOLLOW_UP_LIMIT.toLocaleString()} characters or fewer`);
    }
    return followUp;
  }
  const menu = stages.filter(({ id, name }) => id.trim() && name.trim());
  const rejections = feedback.map((note) => note.trim()).filter(Boolean);
  // A project run works in the repository itself, so its inputs are staged beside it rather
  // than in the plain workspace layout. Either way the agent is told the folder, because a
  // bare file name reads as "somewhere in this repository" and sends it looking for a file
  // the repository never had.
  const inputRoot = projectWorkItemId ? `/workspace/${PROJECT_INPUT_PREFIX}` : "/workspace/inputs";
  return [
    agent.config.prompt,
    `Work item: ${item.title}\n${item.description}`,
    parent ? `Parent goal: ${parent.title}\n${parent.description}` : "",
    item.logicalFiles.length
      ? `Approved input files, staged in ${inputRoot}: ${item.logicalFiles
          .map((reference) => stagedInputPath(reference, fileLocations))
          .join(", ")}`
      : "",
    workerRoles.length
      ? `Available worker roles:\n${workerRoles
          .map(({ role, purpose }) => `- ${role}: ${purpose}`)
          .join("\n")}`
      : "",
    taskPlan
      ? `Task plans must be written only to outputs/${taskPlan.output} as {"tasks":[{"key":"stable campaign-scoped deduplication key","title":"specific outcome","description":"context and acceptance criteria","role":"one available worker role","effect":"read|prepare|external_write","inputs":["file.md"]}]}. Every field is required. Use only approved input paths, written exactly as listed above. An external action must be its own external_write task.`
      : "",
    goalEffect === "external_write"
      ? `This approved task authorizes one external action. Perform exactly the described action using only approved inputs. Do not revise its substance. On confirmed success, write outputs/${ACTION_RECEIPT_OUTPUT} as {"status":"succeeded","destination":"service or recipient","externalId":"confirmation id or empty string","url":"result URL or empty string","timestamp":"ISO-8601 UTC"}. If success is uncertain, write no receipt and stop; Bees will block the task instead of retrying.`
      : goalEffect
        ? `Task effect: ${goalEffect}. External write tools are unavailable.`
        : "",
    children.length
      ? `Tasks:\n${children
          .map(
            (child) =>
              `- [${child.isTerminal ? "done" : child.waits.some(({ resolvedAt }) => !resolvedAt) ? "waiting" : "active"}] ${child.title}${
                child.logicalFiles.length ? ` — files: ${child.logicalFiles.join(", ")}` : ""
              }`
          )
          .join("\n")}`
      : "",
    rejections.length ? `${feedbackIntro}\n${rejections.map((note) => `- ${note}`).join("\n")}` : "",
    fileLocations.length
      ? `Linked inputs:\n${fileLocations
          .map(
            (location) =>
              `- ${location.name}: ${inputRoot}/${linkedLocationInputDirectory(location)}`
          )
          .join("\n")}`
      : "",
    menu.length
      ? `Statuses:\n${menu.map(({ id, name }) => `- ${name}: ${id}`).join("\n")}\nWhen you are done, write the chosen status ID to outputs/${STATUS_OUTPUT} — the ID on its own, nothing else.`
      : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Settlement lives in the Rust `RunService`; this is the webview's client for it.
 *
 * Bees' half of a run — receipt, workspace outputs, validation, terminal status — is owned by
 * the Tauri process, so reloading or closing the run page cannot abandon it. What stays here
 * is the part that is genuinely about this window: preparing the workspace before handing
 * over, and waiting for the outcome so the caller can react.
 *
 * The wait is a convenience, not the transaction. If it is interrupted, Rust still finishes
 * and `resume()` re-attaches on the next launch.
 */
export class RunCoordinator {
  constructor(
    private readonly repository: LocalRepository,
    private readonly workspaces: TemporaryWorkspaceService,
    private readonly flueProject: FlueProjectService,
    private readonly launchRuntime: RuntimeLauncher,
    private readonly host: RunHost = tauriRunHost
  ) {}

  async start(request: RunRequest): Promise<RunOutcome> {
    const prompt = runPrompt(request);
    const previous = request.executionId
      ? await this.repository.getExecution(request.executionId)
      : null;
    if (request.executionId && !previous) throw new Error("Execution not found");
    if (previous && !previous.instanceUid) {
      throw new Error("This conversation has no Flue instance identity; restart it instead");
    }
    const executionId =
      previous?.id ??
      (await this.repository.createExecution({
        agentId: request.agent.id,
        config: request.agent.config,
        workItemId: request.item.id,
        runtime: "flue",
        ...(request.restartedFromExecutionId
          ? { restartedFromExecutionId: request.restartedFromExecutionId }
          : {})
      }));
    const deliveryId = crypto.randomUUID();
    let workspacePath = "";
    let handedOff = false;
    /** Cancels the settle subscription if the run never reaches Rust. Null until it is opened. */
    let handOver: AbortController | null = null;
    try {
      workspacePath = request.projectWorkItemId
        ? await this.workspaces.projectWorkspace(request.projectWorkItemId)
        : request.fileLocations
          ? await this.workspaces.prepare(
              executionId,
              request.teamRoot,
              request.item.logicalFiles,
              request.fileLocations
            )
          : await this.workspaces.prepare(executionId, request.teamRoot, request.item.logicalFiles);
      if (request.projectWorkItemId && request.item.logicalFiles.length) {
        await this.workspaces.prepareProject(
          workspacePath,
          request.teamRoot,
          request.item.logicalFiles,
          request.fileLocations ?? [],
          request.projectWorkItemId
        );
      }
      const capabilities = request.capabilities ?? [];
      const grantedCapabilityRefs = capabilities
        .filter(({ kind, ref }) =>
          kind === "skill" ? false : request.agent.config.grants?.includes(`local:${ref}`) ?? false
        )
        .map(({ ref }) => ref);
      const skillSnapshots = request.projectWorkItemId
        ? await this.flueProject.bindWorkspace(
            executionId,
            workspacePath,
            request.teamRoot,
            previous ? undefined : capabilities,
            previous ? undefined : grantedCapabilityRefs,
            request.projectWorkItemId
          )
        : await this.flueProject.bindWorkspace(
            executionId,
            workspacePath,
            request.teamRoot,
            previous ? undefined : capabilities,
            previous ? undefined : grantedCapabilityRefs
          );
      const initialData = previous
        ? undefined
        : buildBeesRunInitialData({
            executionId,
            teamId: request.teamId ?? "local",
            agent: request.agent,
            capabilities,
            skillSnapshots,
            mcpConnections: request.mcpConnections ?? [],
            delegates: request.delegates ?? [],
            projectWorkspace: Boolean(request.projectWorkItemId),
            manualProjection: Boolean(request.manualProjection)
          });
      const capabilitySeed = initialData ?? previous?.result?.initialData;
      await this.repository.beginExecutionDelivery(executionId, {
        deliveryId,
        prompt,
        ...(request.taskPlan ? { taskPlan: request.taskPlan } : {}),
        projectMode: Boolean(request.projectWorkItemId),
        manualProjection: Boolean(request.manualProjection),
        continuation: previous !== null,
        ...(capabilitySeed ? { initialData: capabilitySeed } : {}),
        workspaceRef: workspacePath
      });
      await request.onCreated?.(executionId);

      const { baseUrl, token = "" } = await this.launchRuntime();
      // Hand over. From here the run belongs to Rust, whatever happens to this window.
      // The subscription has to exist before startRun so the event cannot arrive between them,
      // which means a startRun that throws leaves one behind unless it is cancelled.
      handOver = new AbortController();
      const settled = this.host.awaitSettled(executionId, handOver.signal);
      await this.host.startRun({
        executionId,
        deliveryId,
        agentName: runtimeAgentName(request.agent.id),
        prompt,
        workspace: workspacePath,
        baseUrl,
        token,
        ...(previous?.instanceUid ? { instanceUid: previous.instanceUid } : {}),
        continuation: previous !== null,
        ...(initialData ? { initialData } : {}),
        validationRules: request.agent.config.validationRules ?? [],
        ...(request.taskPlan ? { taskPlan: request.taskPlan } : {}),
        projectMode: Boolean(request.projectWorkItemId),
        manualProjection: Boolean(request.manualProjection)
      });
      handedOff = true;
      await request.onStarted?.(executionId);
      const outcome = await settled;
      if (outcome.status === "failed") {
        throw Object.assign(new Error(outcome.error ?? "The run failed"), { executionId });
      }
      return {
        executionId,
        status: outcome.status,
        workspacePath,
        outputs: outcome.outputs,
        statusId: outcome.statusId
      };
    } catch (error) {
      const message = errorText(error);
      // Rust owns the status of a run it accepted; only a failure before hand-over is ours.
      if (!handedOff && !(await this.repository.getExecution(executionId))?.endedAt) {
        await this.repository.updateExecution(executionId, "failed", {
          error: message,
          ...(workspacePath ? { workspaceRef: workspacePath } : {})
        });
      }
      throw Object.assign(new Error(message), { executionId });
    }
  }

  /**
   * Re-adopt every run that was in flight when Bees last closed. A known submission is read;
   * a crash before receipt persistence resends the same delivery key and Flue deduplicates it.
   */
  async resume(executions: Execution[]): Promise<void> {
    if (!executions.length) return;
    const { baseUrl, token = "" } = await this.launchRuntime();
    const errors: Error[] = [];
    for (const execution of executions) {
      const result = execution.result;
      if (
        !result ||
        typeof result.deliveryId !== "string" ||
        (!execution.submissionId && typeof result.prompt !== "string") ||
        (!execution.submissionId && !result.continuation && !result.initialData) ||
        typeof result.continuation !== "boolean"
      ) {
        await this.repository.updateExecution(execution.id, "interrupted", {
          error: "This run has no complete recovery context. Restart it with the current agent configuration."
        });
        continue;
      }
      const taskPlan = result.taskPlan;
      try {
        await this.host.resumeRun(
          {
            executionId: execution.id,
            deliveryId: result.deliveryId,
            agentName: runtimeAgentName(execution.agentId),
            prompt: typeof result.prompt === "string" ? result.prompt : "",
            workspace: execution.workspaceRef ?? "",
            baseUrl,
            token,
            ...(execution.instanceUid ? { instanceUid: execution.instanceUid } : {}),
            continuation: result.continuation,
            ...(!result.continuation && result.initialData
              ? { initialData: result.initialData }
              : {}),
            validationRules: execution.config.validationRules ?? [],
            ...(taskPlan ? { taskPlan } : {}),
            projectMode: result.projectMode === true,
            manualProjection: result.manualProjection === true
          },
          execution.submissionId ?? ""
        );
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (errors.length) throw new AggregateError(errors, "Some interrupted runs could not resume");
  }

  async stop(executionId: string): Promise<void> {
    const execution = await this.repository.getExecution(executionId);
    if (!execution) return;
    const result = execution.result;
    if (
      !result ||
      typeof result.deliveryId !== "string" ||
      (!execution.submissionId && typeof result.prompt !== "string") ||
      (!execution.submissionId && !result.continuation && !result.initialData) ||
      typeof result.continuation !== "boolean"
    ) {
      throw new Error("This run has no complete recovery context");
    }
    const { baseUrl, token = "" } = await this.launchRuntime();
    const taskPlan = result.taskPlan;
    await this.host.stopRun(
      {
        executionId,
        deliveryId: result.deliveryId,
        agentName: runtimeAgentName(execution.agentId),
        prompt: typeof result.prompt === "string" ? result.prompt : "",
        workspace: execution.workspaceRef ?? "",
        baseUrl,
        token,
        ...(execution.instanceUid ? { instanceUid: execution.instanceUid } : {}),
        continuation: result.continuation,
        ...(!result.continuation && result.initialData ? { initialData: result.initialData } : {}),
        validationRules: execution.config.validationRules ?? [],
        ...(taskPlan ? { taskPlan } : {}),
        projectMode: result.projectMode === true,
        manualProjection: result.manualProjection === true
      },
      execution.submissionId ?? ""
    );
  }
}
