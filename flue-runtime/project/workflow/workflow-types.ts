export const WORK_ITEM_TASK_QUEUE = "bees-work-items-v1";
export const WORK_ITEM_WORKFLOW = "workItemWorkflow";

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

export type RuntimeScheduleRecurrence = "hourly" | "daily" | "weekdays";

export interface RuntimeSchedule {
  id: string;
  name: string;
  recurrence: RuntimeScheduleRecurrence;
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

export interface RuntimeExternalEvent {
  correlationKey: string;
  resolution: string | null;
  receivedAt: string;
}

export type RuntimePhase = "ready" | "running" | "waiting" | "failed" | "archived";

export interface WorkItemRuntimeState {
  protocolVersion: 1;
  organizationId: string;
  teamId: string;
  workItemId: string;
  processId: string;
  stageId: string;
  validStageIds: string[];
  terminalStageIds: string[];
  phase: RuntimePhase;
  claim: RuntimeClaim | null;
  waits: RuntimeWait[];
  schedules: RuntimeSchedule[];
  receivedEvents: RuntimeExternalEvent[];
  watcherWorkflowIds: string[];
  revision: number;
  archivedAt: string | null;
  lastExecutionId: string | null;
  lastError: string | null;
}

export interface WorkItemWorkflowInput {
  organizationId: string;
  teamId: string;
  workItemId: string;
  processId: string;
  stageId: string;
  validStageIds: string[];
  terminalStageIds: string[];
  parentWorkflowId?: string;
  snapshot?: WorkItemRuntimeState;
}

export type WorkItemCommand =
  | { type: "configure"; processId: string; validStageIds: string[]; terminalStageIds: string[] }
  | { type: "move"; targetStageId: string; claimToken?: string }
  | { type: "claim"; machineId: string; claimToken?: string; agentId?: string; executionId?: string }
  | { type: "heartbeat"; machineId: string; claimToken: string }
  | { type: "release"; machineId: string; claimToken: string }
  | { type: "complete"; machineId: string; claimToken: string; executionId: string; targetStageId?: string; error?: string }
  | { type: "wait"; kind: RuntimeWaitKind; reason: string; target?: string; correlationKey?: string; dependencyWorkItemId?: string; executionId?: string; wakeAt?: string; claimToken?: string; releaseClaim?: boolean }
  | { type: "resolve_wait"; waitId?: string; correlationKey?: string }
  | { type: "external_event"; correlationKey: string; resolution?: string }
  | { type: "upsert_schedule"; schedule: { id: string; name: string; recurrence: RuntimeScheduleRecurrence; mode: "run" | "spawn_goal"; role?: string; timezone: string; enabled: boolean; nextRunAt: string } }
  | { type: "toggle_schedule"; scheduleId: string; enabled: boolean }
  | { type: "trigger_schedule"; scheduleId: string }
  | { type: "ack_schedule"; scheduleId: string }
  | { type: "delete_schedule"; scheduleId: string }
  | { type: "archive" }
  | { type: "restore" };

export interface ProjectStageInput {
  organizationId: string;
  workItemId: string;
  processId: string;
  stageId: string;
}

export interface WorkItemActivities {
  projectStage(input: ProjectStageInput): Promise<void>;
}

export function workflowId(organizationId: string, workItemId: string): string {
  return `org/${organizationId}/work-item/${workItemId}`;
}
