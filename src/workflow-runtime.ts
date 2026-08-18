import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { ApiClient } from "./api.js";

export type RuntimeWaitKind =
  | "human"
  | "external_event"
  | "dependency"
  | "execution"
  | "error"
  | "schedule"
  | "manual";

export interface RuntimeWait {
  id: string;
  kind: RuntimeWaitKind;
  reason: string;
  target: string | null;
  correlationKey: string | null;
  dependencyWorkItemId: string | null;
  executionId: string | null;
  wakeAt: string | null;
  createdAt: string;
}

export interface RuntimeClaim {
  token: string;
  machineId: string;
  agentId: string | null;
  executionId: string | null;
  claimedAt: string;
  expiresAt: string;
}

export interface RuntimeSchedule {
  id: string;
  name: string;
  recurrence: "hourly" | "daily" | "weekdays";
  mode: "run" | "spawn_goal";
  role: string | null;
  timezone: string;
  enabled: boolean;
  pending: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkItemRuntimeState {
  protocolVersion: 1;
  organizationId: string;
  teamId: string;
  workItemId: string;
  processId: string;
  stageId: string;
  validStageIds: string[];
  terminalStageIds: string[];
  phase: "ready" | "running" | "waiting" | "failed" | "archived";
  claim: RuntimeClaim | null;
  waits: RuntimeWait[];
  schedules: RuntimeSchedule[];
  receivedEvents: Array<{ correlationKey: string; resolution: string | null; receivedAt: string }>;
  watcherWorkflowIds: string[];
  revision: number;
  archivedAt: string | null;
  lastExecutionId: string | null;
  lastError: string | null;
}

export type WorkItemCommand =
  | { type: "move"; targetStageId: string; claimToken?: string }
  | { type: "claim"; machineId: string; claimToken?: string; agentId?: string; executionId?: string }
  | { type: "heartbeat"; machineId: string; claimToken: string }
  | { type: "release"; machineId: string; claimToken: string }
  | { type: "complete"; machineId: string; claimToken: string; executionId: string; targetStageId?: string; error?: string }
  | { type: "wait"; kind: RuntimeWaitKind; reason: string; target?: string; correlationKey?: string; dependencyWorkItemId?: string; executionId?: string; wakeAt?: string; claimToken?: string; releaseClaim?: boolean }
  | { type: "resolve_wait"; waitId?: string; correlationKey?: string }
  | { type: "external_event"; correlationKey: string; resolution?: string }
  | { type: "upsert_schedule"; schedule: { id: string; name: string; recurrence: "hourly" | "daily" | "weekdays"; mode: "run" | "spawn_goal"; role?: string; timezone: string; enabled: boolean; nextRunAt: string } }
  | { type: "toggle_schedule"; scheduleId: string; enabled: boolean }
  | { type: "trigger_schedule"; scheduleId: string }
  | { type: "ack_schedule"; scheduleId: string }
  | { type: "delete_schedule"; scheduleId: string }
  | { type: "archive" }
  | { type: "restore" };

interface RuntimeScope {
  organizationId: string;
  connected: boolean;
  token: string | null;
}

interface LocalRuntimeInfo {
  baseUrl: string;
  token: string;
}

/** Why something failed, in the one shape every message here wants. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class WorkflowRuntimeClient {
  private local: Promise<LocalRuntimeInfo> | null = null;

  constructor(
    private readonly api: ApiClient,
    private readonly scope: () => RuntimeScope
  ) {}

  private async localRequest<T>(organizationId: string, workItemId: string, body?: unknown): Promise<T> {
    let runtime: LocalRuntimeInfo;
    let response: Response;
    try {
      this.local ??= invoke<LocalRuntimeInfo>("ensure_local_workflow_runtime");
      runtime = await this.local;
    } catch (error) {
      this.local = null;
      throw new Error(`The local process service did not start: ${reason(error)}`);
    }
    try {
      response = await tauriFetch(
        `${runtime.baseUrl}/organizations/${encodeURIComponent(organizationId)}/work-items/${encodeURIComponent(workItemId)}/runtime`,
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            authorization: `Bearer ${runtime.token}`,
            "content-type": "application/json"
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }
      );
    } catch (error) {
      this.local = null;
      throw new Error(`The local process service is unreachable: ${reason(error)}`);
    }
    const value = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(value.error ?? "The process command was rejected");
    return value as T;
  }

  async state(workItemId: string): Promise<WorkItemRuntimeState> {
    const scope = this.scope();
    if (scope.connected) {
      if (!scope.token) throw new Error("Sign in to access this workspace's processes");
      return (await this.api.workItemRuntime(scope.token, scope.organizationId, workItemId)).runtime;
    }
    return (await this.localRequest<{ runtime: WorkItemRuntimeState }>(scope.organizationId, workItemId)).runtime;
  }

  async command(workItemId: string, command: WorkItemCommand): Promise<WorkItemRuntimeState> {
    const scope = this.scope();
    if (scope.connected) {
      if (!scope.token) throw new Error("Sign in to change this workspace's processes");
      return (await this.api.commandWorkItem(scope.token, scope.organizationId, workItemId, command)).runtime;
    }
    return (
      await this.localRequest<{ runtime: WorkItemRuntimeState }>(
        scope.organizationId,
        workItemId,
        command
      )
    ).runtime;
  }
}
