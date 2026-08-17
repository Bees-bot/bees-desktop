import {
  ApplicationFailure,
  allHandlersFinished,
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  defineUpdate,
  getExternalWorkflowHandle,
  proxyActivities,
  setHandler,
  workflowInfo,
  uuid4
} from "@temporalio/workflow";
import type {
  RuntimeClaim,
  RuntimePhase,
  RuntimeSchedule,
  RuntimeWait,
  WorkItemActivities,
  WorkItemCommand,
  WorkItemRuntimeState,
  WorkItemWorkflowInput
} from "./workflow-types.js";
import { workflowId } from "./workflow-types.js";

const CLAIM_LEASE_MS = 90_000;
const CONTINUE_AFTER_COMMANDS = 1_000;

export const runtimeStateQuery = defineQuery<WorkItemRuntimeState>("runtimeState");
export const workItemCommandUpdate = defineUpdate<WorkItemRuntimeState, [WorkItemCommand]>("workItemCommand");
export const archiveStateSignal = defineSignal<[boolean]>("archiveState");
export const childStateSignal = defineSignal<[WorkItemRuntimeState]>("childState");
export const dependencyWatchSignal = defineSignal<[string]>("dependencyWatch");

const { projectStage } = proxyActivities<WorkItemActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 10 }
});

function phase(state: WorkItemRuntimeState): RuntimePhase {
  if (state.archivedAt) return "archived";
  if (state.waits.some(({ kind }) => kind === "error")) return "failed";
  if (state.waits.length) return "waiting";
  if (state.claim) return "running";
  return "ready";
}

function publicState(state: WorkItemRuntimeState): WorkItemRuntimeState {
  return { ...state, phase: phase(state) };
}

function isoNow(): string {
  return new Date(Date.now()).toISOString();
}

function ensureStage(state: WorkItemRuntimeState, stageId: string): void {
  if (!state.validStageIds.includes(stageId)) {
    throw new Error(`Stage ${stageId} does not belong to process ${state.processId}`);
  }
}

function currentClaim(state: WorkItemRuntimeState, machineId: string, token: string): RuntimeClaim {
  const claim = state.claim;
  if (!claim || claim.machineId !== machineId || claim.token !== token) {
    throw new Error("The work item is no longer claimed by this machine");
  }
  if (Date.parse(claim.expiresAt) <= Date.now()) throw new Error("The work-item claim expired");
  return claim;
}

function runtimeWait(command: Extract<WorkItemCommand, { type: "wait" }>): RuntimeWait {
  const wakeAt = command.wakeAt ? new Date(command.wakeAt).toISOString() : null;
  if (command.kind === "schedule" && !wakeAt) throw new Error("A scheduled wait requires wakeAt");
  if (command.kind === "external_event" && !command.correlationKey) throw new Error("An external-event wait requires a correlation key");
  if (command.kind === "dependency" && !command.dependencyWorkItemId) throw new Error("A dependency wait requires a work-item ID");
  if (command.kind === "execution" && !command.executionId) throw new Error("An execution wait requires an execution ID");
  return {
    id: uuid4(),
    kind: command.kind,
    reason: command.reason,
    target: command.target ?? null,
    correlationKey: command.correlationKey ?? null,
    dependencyWorkItemId: command.dependencyWorkItemId ?? null,
    executionId: command.executionId ?? null,
    wakeAt,
    createdAt: isoNow()
  };
}

function nextDeadline(state: WorkItemRuntimeState): number | undefined {
  const candidates = [
    ...(state.claim ? [Date.parse(state.claim.expiresAt)] : []),
    ...state.waits.flatMap(({ wakeAt }) => (wakeAt ? [Date.parse(wakeAt)] : [])),
    ...state.schedules.flatMap(({ enabled, nextRunAt }) => enabled ? [Date.parse(nextRunAt)] : [])
  ].filter(Number.isFinite);
  return candidates.length ? Math.min(...candidates) : undefined;
}

// Duplicated in src/scheduler.ts: this package can't import from src (separate tsconfig,
// separate node_modules, Temporal's workflow bundler only resolves within its own package).
function safeTz(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

function zonedParts(date: Date, tz: string): [number, number, number, number, number, number] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric"
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return [get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")];
}

function isWeekend(date: Date, tz: string): boolean {
  return ["Sat", "Sun"].includes(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date));
}

/** Instant whose wall clock in `tz` reads these parts. Second pass settles a DST shift. */
function fromZonedParts(naive: number, tz: string): Date {
  let guess = naive;
  for (let i = 0; i < 2; i++) {
    const [y, m, d, h, min, s] = zonedParts(new Date(guess), tz);
    guess += naive - Date.UTC(y, m, d, h, min, s);
  }
  return new Date(guess);
}

function addCalendarDay(date: Date, tz: string): Date {
  const [y, m, d, h, min, s] = zonedParts(date, tz);
  return fromZonedParts(Date.UTC(y, m, d + 1, h, min, s), tz);
}

function nextScheduleRun(schedule: RuntimeSchedule, previous: number): number {
  const tz = safeTz(schedule.timezone);
  let next = new Date(previous);
  if (schedule.recurrence === "hourly") next.setTime(next.getTime() + 3_600_000);
  else next = addCalendarDay(next, tz);
  if (schedule.recurrence === "weekdays") {
    while (isWeekend(next, tz)) next = addCalendarDay(next, tz);
  }
  return next.getTime();
}

export async function workItemWorkflow(input: WorkItemWorkflowInput): Promise<WorkItemRuntimeState> {
  let state: WorkItemRuntimeState = input.snapshot ?? {
    protocolVersion: 1,
    organizationId: input.organizationId,
    teamId: input.teamId,
    workItemId: input.workItemId,
    processId: input.processId,
    stageId: input.stageId,
    validStageIds: [...new Set(input.validStageIds)],
    terminalStageIds: [...new Set(input.terminalStageIds)],
    phase: "ready",
    claim: null,
    waits: [],
    schedules: [],
    receivedEvents: [],
    watcherWorkflowIds: [],
    revision: 0,
    archivedAt: null,
    lastExecutionId: null,
    lastError: null
  };
  let generation = 0;
  let commands = 0;
  ensureStage(state, state.stageId);

  const changed = (): WorkItemRuntimeState => {
    state.revision += 1;
    generation += 1;
    commands += 1;
    state.phase = phase(state);
    return publicState(state);
  };
  const setArchived = (archived: boolean): WorkItemRuntimeState => {
    state.archivedAt = archived ? state.archivedAt ?? isoNow() : null;
    if (archived) {
      state.claim = null;
      state.waits = [];
      for (const schedule of state.schedules) {
        schedule.enabled = false;
        schedule.pending = false;
      }
    }
    return changed();
  };
  const notifyWatchersIfTerminal = async (): Promise<void> => {
    if (!state.terminalStageIds.includes(state.stageId)) return;
    const watchers = [...new Set([...(input.parentWorkflowId ? [input.parentWorkflowId] : []), ...state.watcherWorkflowIds])];
    for (const watcher of watchers) {
      await getExternalWorkflowHandle(watcher).signal(childStateSignal, publicState(state));
    }
  };
  const move = async (targetStageId: string): Promise<void> => {
    ensureStage(state, targetStageId);
    await projectStage({ organizationId: state.organizationId, workItemId: state.workItemId, processId: state.processId, stageId: targetStageId });
    state.stageId = targetStageId;
    if (state.terminalStageIds.includes(targetStageId)) {
      state.claim = null;
      state.waits = [];
    }
    await notifyWatchersIfTerminal();
  };

  setHandler(runtimeStateQuery, () => publicState(state));
  setHandler(archiveStateSignal, (archived) => {
    setArchived(archived);
    // Signals remain available after Temporal's per-run Update limit. Rotate immediately so an
    // old task whose history is already full recovers along with the archive/restore operation.
    commands = CONTINUE_AFTER_COMMANDS;
  });
  setHandler(childStateSignal, (child) => {
    if (!child.terminalStageIds.includes(child.stageId)) return;
    const before = state.waits.length;
    state.waits = state.waits.filter(({ dependencyWorkItemId }) => dependencyWorkItemId !== child.workItemId);
    if (state.waits.length !== before) changed();
  });
  setHandler(dependencyWatchSignal, async (watcherWorkflowId) => {
    if (!state.watcherWorkflowIds.includes(watcherWorkflowId)) {
      state.watcherWorkflowIds.push(watcherWorkflowId);
      changed();
    }
    if (state.terminalStageIds.includes(state.stageId)) {
      await getExternalWorkflowHandle(watcherWorkflowId).signal(childStateSignal, publicState(state));
    }
  });
  setHandler(workItemCommandUpdate, async (command) => {
    try {
      if (state.archivedAt && !["archive", "restore", "configure", "toggle_schedule", "delete_schedule"].includes(command.type)) throw new Error("The work item is archived");
      switch (command.type) {
      case "configure":
        if (!command.validStageIds.includes(state.stageId)) throw new Error("The current stage must remain in the process definition");
        if (state.processId === command.processId && JSON.stringify(state.validStageIds) === JSON.stringify([...new Set(command.validStageIds)]) && JSON.stringify(state.terminalStageIds) === JSON.stringify([...new Set(command.terminalStageIds)])) return publicState(state);
        state.processId = command.processId;
        state.validStageIds = [...new Set(command.validStageIds)];
        state.terminalStageIds = [...new Set(command.terminalStageIds)];
        break;
      case "move":
        if (state.claim) {
          if (!command.claimToken || command.claimToken !== state.claim.token) throw new Error("Cancel the active run before moving this work item");
          state.claim = null;
        }
        await move(command.targetStageId);
        break;
      case "claim": {
        if (state.terminalStageIds.includes(state.stageId)) throw new Error("A terminal work item cannot run");
        if (state.waits.length) throw new Error("The work item is waiting");
        if (state.claim && Date.parse(state.claim.expiresAt) <= Date.now()) state.claim = null;
        if (state.claim) {
          if (state.claim.machineId === command.machineId && command.claimToken === state.claim.token) {
            if (!state.claim.executionId && command.executionId) {
              state.claim.executionId = command.executionId;
              state.claim.agentId = command.agentId ?? state.claim.agentId;
              break;
            }
            if (state.claim.executionId === (command.executionId ?? null)) return publicState(state);
          }
          throw new Error("Another machine is already working on this item");
        }
        const now = Date.now();
        state.claim = { token: uuid4(), machineId: command.machineId, agentId: command.agentId ?? null, executionId: command.executionId ?? null, claimedAt: new Date(now).toISOString(), expiresAt: new Date(now + CLAIM_LEASE_MS).toISOString() };
        break;
      }
      case "heartbeat":
        currentClaim(state, command.machineId, command.claimToken).expiresAt = new Date(Date.now() + CLAIM_LEASE_MS).toISOString();
        break;
      case "release":
        currentClaim(state, command.machineId, command.claimToken);
        state.claim = null;
        break;
      case "complete":
        if (!state.claim && state.lastExecutionId === command.executionId) return publicState(state);
        currentClaim(state, command.machineId, command.claimToken);
        state.claim = null;
        state.lastExecutionId = command.executionId;
        if (command.error) {
          state.lastError = command.error;
          state.waits = [...state.waits.filter(({ kind }) => kind !== "error"), runtimeWait({ type: "wait", kind: "error", reason: command.error })];
        } else {
          state.lastError = null;
          if (command.targetStageId) await move(command.targetStageId);
        }
        break;
      case "wait": {
        if (state.claim) {
          if (!command.claimToken || command.claimToken !== state.claim.token) throw new Error("Only the claiming machine can pause this run");
          if (command.releaseClaim ?? command.kind !== "execution") state.claim = null;
        }
        const wait = runtimeWait(command);
        if (wait.kind === "external_event" && wait.correlationKey && state.receivedEvents.some(({ correlationKey }) => correlationKey === wait.correlationKey)) {
          state.receivedEvents = state.receivedEvents.filter(({ correlationKey }) => correlationKey !== wait.correlationKey);
          break;
        }
        const duplicate = wait.correlationKey ? state.waits.some(({ correlationKey }) => correlationKey === wait.correlationKey) : false;
        if (!duplicate && wait.dependencyWorkItemId) {
          if (wait.dependencyWorkItemId === state.workItemId) throw new Error("A work item cannot wait on itself");
          await getExternalWorkflowHandle(workflowId(state.organizationId, wait.dependencyWorkItemId)).signal(dependencyWatchSignal, workflowInfo().workflowId);
        }
        if (!duplicate) state.waits.push(wait);
        break;
      }
      case "resolve_wait":
        if (!command.waitId && !command.correlationKey) throw new Error("A wait ID or correlation key is required");
        state.waits = state.waits.filter((wait) => (command.waitId ? wait.id !== command.waitId : true) && (command.correlationKey ? wait.correlationKey !== command.correlationKey : true));
        if (!state.waits.some(({ kind }) => kind === "error")) state.lastError = null;
        break;
      case "external_event": {
        const matched = state.waits.some(({ correlationKey }) => correlationKey === command.correlationKey);
        state.waits = state.waits.filter(({ correlationKey }) => correlationKey !== command.correlationKey);
        if (!matched) {
          state.receivedEvents = [...state.receivedEvents.filter(({ correlationKey }) => correlationKey !== command.correlationKey), {
            correlationKey: command.correlationKey,
            resolution: command.resolution ?? null,
            receivedAt: isoNow()
          }].slice(-100);
        }
        break;
      }
      case "upsert_schedule": {
        const timestamp = isoNow();
        const existing = state.schedules.find(({ id }) => id === command.schedule.id);
        const schedule: RuntimeSchedule = {
          id: command.schedule.id,
          name: command.schedule.name,
          recurrence: command.schedule.recurrence,
          mode: command.schedule.mode,
          role: command.schedule.role ?? null,
          timezone: command.schedule.timezone,
          enabled: command.schedule.enabled,
          pending: existing?.pending ?? false,
          nextRunAt: new Date(command.schedule.nextRunAt).toISOString(),
          lastRunAt: existing?.lastRunAt ?? null,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp
        };
        state.schedules = [...state.schedules.filter(({ id }) => id !== schedule.id), schedule];
        break;
      }
      case "toggle_schedule": {
        const schedule = state.schedules.find(({ id }) => id === command.scheduleId);
        if (!schedule) throw new Error("The schedule is unavailable");
        schedule.enabled = command.enabled;
        schedule.pending = command.enabled ? schedule.pending : false;
        schedule.updatedAt = isoNow();
        break;
      }
      case "trigger_schedule": {
        const schedule = state.schedules.find(({ id }) => id === command.scheduleId);
        if (!schedule) throw new Error("The schedule is unavailable");
        schedule.pending = true;
        schedule.updatedAt = isoNow();
        break;
      }
      case "ack_schedule": {
        const schedule = state.schedules.find(({ id }) => id === command.scheduleId);
        if (!schedule) throw new Error("The schedule is unavailable");
        schedule.pending = false;
        schedule.updatedAt = isoNow();
        break;
      }
      case "delete_schedule":
        state.schedules = state.schedules.filter(({ id }) => id !== command.scheduleId);
        break;
      case "archive":
        return setArchived(true);
      case "restore":
        return setArchived(false);
      }
      return changed();
    } catch (error) {
      if (error instanceof ApplicationFailure) throw error;
      throw ApplicationFailure.nonRetryable(
        error instanceof Error ? error.message : String(error),
        "WORK_ITEM_COMMAND_REJECTED"
      );
    }
  });

  while (true) {
    const now = Date.now();
    let expired = false;
    if (state.claim && Date.parse(state.claim.expiresAt) <= now) {
      state.claim = null;
      expired = true;
    }
    const activeWaits = state.waits.filter(({ wakeAt }) => !wakeAt || Date.parse(wakeAt) > now);
    if (activeWaits.length !== state.waits.length) {
      state.waits = activeWaits;
      expired = true;
    }
    for (const schedule of state.schedules.filter(({ enabled, nextRunAt }) => !state.archivedAt && enabled && Date.parse(nextRunAt) <= now)) {
      schedule.pending = true;
      schedule.lastRunAt = schedule.nextRunAt;
      let next = Date.parse(schedule.nextRunAt);
      do next = nextScheduleRun(schedule, next);
      while (next <= now);
      schedule.nextRunAt = new Date(next).toISOString();
      schedule.updatedAt = isoNow();
      expired = true;
    }
    if (expired) changed();
    if (commands >= CONTINUE_AFTER_COMMANDS) {
      await condition(allHandlersFinished);
      await continueAsNew<typeof workItemWorkflow>({ ...input, snapshot: publicState(state) });
    }
    const observed = generation;
    const deadline = nextDeadline(state);
    if (deadline === undefined) await condition(() => generation !== observed);
    else await condition(() => generation !== observed, Math.max(1, deadline - Date.now()));
  }
}
