import { randomUUID } from "node:crypto";

const CLAIM_LEASE_MS = 90_000;

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function phase(state) {
  if (state.archivedAt) return "archived";
  if (state.waits.some(({ kind }) => kind === "error")) return "failed";
  if (state.waits.length) return "waiting";
  if (state.claim) return "running";
  return "ready";
}

function safeTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric"
  }).formatToParts(date);
  const part = (name) => Number(parts.find(({ type }) => type === name)?.value ?? 0);
  return [part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")];
}

function fromZonedParts(naive, timeZone) {
  let guess = naive;
  for (let pass = 0; pass < 2; pass += 1) {
    const [year, month, day, hour, minute, second] = zonedParts(new Date(guess), timeZone);
    guess += naive - Date.UTC(year, month, day, hour, minute, second);
  }
  return new Date(guess);
}

function addCalendarDay(date, timeZone) {
  const [year, month, day, hour, minute, second] = zonedParts(date, timeZone);
  return fromZonedParts(Date.UTC(year, month, day + 1, hour, minute, second), timeZone);
}

function nextOccurrence(schedule, previous) {
  const timeZone = safeTimeZone(schedule.timezone);
  let next = new Date(previous);
  if (schedule.recurrence === "hourly") next = new Date(next.getTime() + 3_600_000);
  else next = addCalendarDay(next, timeZone);
  if (schedule.recurrence === "weekdays") {
    while (["Sat", "Sun"].includes(new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short"
    }).format(next))) next = addCalendarDay(next, timeZone);
  }
  return next.getTime();
}

function currentClaim(state, machineId, token, now = Date.now()) {
  if (!state.claim || state.claim.machineId !== machineId || state.claim.token !== token)
    throw new Error("The work item is no longer claimed by this machine");
  if (Date.parse(state.claim.expiresAt) <= now) throw new Error("The work-item claim expired");
  return state.claim;
}

function ensureStage(state, stageId) {
  if (!state.validStageIds.includes(stageId))
    throw new Error(`Stage ${stageId} does not belong to process ${state.processId}`);
}

function makeWait(command, now = Date.now()) {
  const wakeAt = command.wakeAt ? new Date(command.wakeAt).toISOString() : null;
  if (command.kind === "schedule" && !wakeAt) throw new Error("A scheduled wait requires wakeAt");
  if (command.kind === "external_event" && !command.correlationKey)
    throw new Error("An external-event wait requires a correlation key");
  if (command.kind === "dependency" && !command.dependencyWorkItemId)
    throw new Error("A dependency wait requires a work-item ID");
  if (command.kind === "execution" && !command.executionId)
    throw new Error("An execution wait requires an execution ID");
  return {
    id: randomUUID(),
    kind: command.kind,
    reason: String(command.reason ?? ""),
    target: command.target ?? null,
    correlationKey: command.correlationKey ?? null,
    dependencyWorkItemId: command.dependencyWorkItemId ?? null,
    executionId: command.executionId ?? null,
    wakeAt,
    createdAt: nowIso(now)
  };
}

export class ProcessRuntime {
  constructor(database) {
    this.database = database;
    database.exec(`
      CREATE TABLE IF NOT EXISTS dsh_work_item_states (
        organization_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (organization_id, work_item_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS bees_process_checkpoints (
        id TEXT PRIMARY KEY,
        execution_id TEXT,
        work_item_id TEXT,
        transition TEXT NOT NULL,
        state_json TEXT NOT NULL,
        idempotency_key TEXT UNIQUE,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS bees_process_checkpoints_work_item
        ON bees_process_checkpoints(work_item_id, created_at);
    `);
    // Early DSH builds stored archive state only in JSON; copy it to the rows every view reads.
    database.exec(`
      WITH RECURSIVE archived(id, archived_at) AS (
        SELECT work_item_id, json_extract(state_json, '$.archivedAt')
        FROM dsh_work_item_states
        WHERE json_extract(state_json, '$.archivedAt') IS NOT NULL
        UNION
        SELECT w.id, archived.archived_at
        FROM work_items w JOIN archived ON w.parent_id = archived.id
        WHERE w.deleted_at IS NULL
      )
      UPDATE work_items
      SET archived_at = (SELECT max(archived_at) FROM archived WHERE archived.id = work_items.id)
      WHERE archived_at IS NULL AND id IN (SELECT id FROM archived);
    `);
  }

  input(organizationId, workItemId) {
    const work = this.database.prepare(`
      SELECT w.process_id AS processId, w.stage_id AS stageId,
             w.archived_at AS archivedAt, p.team_id AS teamId
      FROM work_items w
      JOIN processes p ON p.id = w.process_id
      JOIN teams t ON t.id = p.team_id
      WHERE w.id = ? AND w.deleted_at IS NULL AND t.organization_id = ?
    `).get(workItemId, organizationId);
    if (!work) throw new Error("Work item not found");
    const stages = this.database.prepare(`
      SELECT id, is_terminal AS isTerminal FROM stages
      WHERE process_id = ? AND (archived_at IS NULL OR id = ?)
      ORDER BY position
    `).all(work.processId, work.stageId);
    const validStageIds = stages.map(({ id }) => String(id));
    if (!validStageIds.includes(String(work.stageId)))
      throw new Error("The work item does not point at a valid process stage");
    return {
      organizationId,
      teamId: String(work.teamId),
      workItemId,
      processId: String(work.processId),
      stageId: String(work.stageId),
      archivedAt: work.archivedAt ? String(work.archivedAt) : null,
      validStageIds,
      terminalStageIds: stages.filter(({ isTerminal }) => Number(isTerminal) === 1).map(({ id }) => String(id))
    };
  }

  load(input) {
    const stored = this.database.prepare(`
      SELECT state_json AS stateJson FROM dsh_work_item_states
      WHERE organization_id = ? AND work_item_id = ?
    `).get(input.organizationId, input.workItemId);
    const state = stored ? JSON.parse(stored.stateJson) : {
      protocolVersion: 1,
      ...input,
      phase: "ready",
      claim: null,
      waits: [],
      schedules: [],
      receivedEvents: [],
      watcherWorkflowIds: [],
      revision: 0,
      archivedAt: input.archivedAt,
      lastExecutionId: null,
      lastError: null
    };
    state.stageId = input.stageId;
    state.processId = input.processId;
    state.validStageIds = [...new Set(input.validStageIds)];
    state.terminalStageIds = [...new Set(input.terminalStageIds)];
    state.archivedAt = input.archivedAt;
    if (state.archivedAt) {
      state.claim = null;
      state.waits = [];
      for (const schedule of state.schedules) {
        schedule.enabled = false;
        schedule.pending = false;
      }
    }
    return state;
  }

  sweep(state, now = Date.now()) {
    let changed = false;
    if (state.claim && Date.parse(state.claim.expiresAt) <= now) {
      state.claim = null;
      changed = true;
    }
    const waits = state.waits.filter(({ wakeAt }) => !wakeAt || Date.parse(wakeAt) > now);
    if (waits.length !== state.waits.length) {
      state.waits = waits;
      changed = true;
    }
    for (const schedule of state.schedules) {
      if (state.archivedAt || !schedule.enabled || Date.parse(schedule.nextRunAt) > now) continue;
      let next = Date.parse(schedule.nextRunAt);
      let occurrence = next;
      do {
        occurrence = next;
        next = nextOccurrence(schedule, next);
      } while (next <= now);
      if (!schedule.pending && !(schedule.concurrencyRule === "skip_if_running" && state.claim)) {
        schedule.pending = true;
        schedule.pendingOccurrenceId = `${schedule.id}:${nowIso(occurrence)}`;
        schedule.lastRunAt = nowIso(occurrence);
      }
      schedule.nextRunAt = nowIso(next);
      schedule.updatedAt = nowIso(now);
      changed = true;
    }
    return changed;
  }

  save(state, transition, idempotencyKey = null) {
    state.revision += 1;
    state.phase = phase(state);
    const at = nowIso();
    const json = JSON.stringify(state);
    this.database.prepare(`
      INSERT INTO dsh_work_item_states (organization_id, work_item_id, state_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (organization_id, work_item_id) DO UPDATE
      SET state_json = excluded.state_json, updated_at = excluded.updated_at
    `).run(state.organizationId, state.workItemId, json, at);
    this.database.prepare(`
      INSERT OR IGNORE INTO bees_process_checkpoints
        (id, execution_id, work_item_id, transition, state_json, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), state.lastExecutionId, state.workItemId, transition, json, idempotencyKey, at);
    return state;
  }

  state(organizationId, workItemId) {
    const input = this.input(organizationId, workItemId);
    const state = this.load(input);
    if (this.sweep(state)) return this.save(state, "startup-catch-up");
    return { ...state, phase: phase(state) };
  }

  assertNoDependencyCycle(organizationId, workItemId, dependencyId) {
    const pending = [dependencyId];
    const visited = new Set();
    while (pending.length) {
      const id = pending.pop();
      if (id === workItemId) throw new Error("This dependency would create a cycle");
      if (visited.has(id)) continue;
      if (visited.size >= 1_000) throw new Error("The dependency graph is too large");
      visited.add(id);
      const dependency = this.state(organizationId, id);
      pending.push(...dependency.waits.flatMap(({ dependencyWorkItemId }) =>
        dependencyWorkItemId ? [dependencyWorkItemId] : []));
    }
  }

  command(organizationId, workItemId, command) {
    if (!command || typeof command.type !== "string") throw new Error("A process command is required");
    if (command.idempotencyKey) {
      const checkpoint = this.database.prepare(`
        SELECT work_item_id AS workItemId, state_json AS stateJson
        FROM bees_process_checkpoints WHERE idempotency_key = ?
      `).get(command.idempotencyKey);
      if (checkpoint) {
        if (String(checkpoint.workItemId) !== workItemId)
          throw new Error("The idempotency key belongs to another work item");
        return JSON.parse(checkpoint.stateJson);
      }
    }
    if (command.type === "wait" && command.dependencyWorkItemId)
      this.assertNoDependencyCycle(organizationId, workItemId, command.dependencyWorkItemId);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const input = this.input(organizationId, workItemId);
      const state = this.load(input);
      this.sweep(state);
      if (state.archivedAt && !["archive", "restore", "toggle_schedule", "delete_schedule"].includes(command.type))
        throw new Error("The work item is archived");
      this.applyCommand(state, command);
      const result = this.save(state, command.type, command.idempotencyKey ?? null);
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  applyCommand(state, command) {
    const now = Date.now();
    const move = (targetStageId) => {
      ensureStage(state, targetStageId);
      const result = this.database.prepare(`
        UPDATE work_items SET stage_id = ?, updated_at = ?
        WHERE id = ? AND process_id = ?
      `).run(targetStageId, nowIso(now), state.workItemId, state.processId);
      if (Number(result.changes) !== 1) throw new Error("The requested stage does not belong to this work item's process");
      state.stageId = targetStageId;
      if (state.terminalStageIds.includes(targetStageId)) {
        state.claim = null;
        state.waits = [];
      }
    };
    switch (command.type) {
      case "move":
        if (state.claim && command.claimToken !== state.claim.token)
          throw new Error("Cancel the active run before moving this work item");
        state.claim = null;
        move(command.targetStageId);
        break;
      case "claim": {
        if (state.terminalStageIds.includes(state.stageId)) throw new Error("A terminal work item cannot run");
        if (state.waits.length) throw new Error("The work item is waiting");
        if (state.claim) {
          if (state.claim.machineId === command.machineId && command.claimToken === state.claim.token) {
            if (!state.claim.executionId && command.executionId) {
              state.claim.executionId = command.executionId;
              state.claim.agentId = command.agentId ?? state.claim.agentId;
              break;
            }
            if (state.claim.executionId === (command.executionId ?? null)) return;
          }
          throw new Error("Another machine is already working on this item");
        }
        state.claim = {
          token: randomUUID(),
          machineId: command.machineId,
          agentId: command.agentId ?? null,
          executionId: command.executionId ?? null,
          claimedAt: nowIso(now),
          expiresAt: nowIso(now + CLAIM_LEASE_MS)
        };
        break;
      }
      case "heartbeat":
        currentClaim(state, command.machineId, command.claimToken, now).expiresAt = nowIso(now + CLAIM_LEASE_MS);
        break;
      case "release":
        currentClaim(state, command.machineId, command.claimToken, now);
        state.claim = null;
        break;
      case "complete":
        if (!state.claim && state.lastExecutionId === command.executionId) return;
        currentClaim(state, command.machineId, command.claimToken, now);
        state.claim = null;
        state.lastExecutionId = command.executionId;
        if (command.error) {
          state.lastError = command.error;
          state.waits = [...state.waits.filter(({ kind }) => kind !== "error"), makeWait({
            type: "wait", kind: "error", reason: command.error
          }, now)];
        } else {
          state.lastError = null;
          if (command.targetStageId) move(command.targetStageId);
        }
        break;
      case "wait": {
        if (state.claim) {
          if (command.claimToken !== state.claim.token) throw new Error("Only the claiming machine can pause this run");
          if (command.releaseClaim ?? command.kind !== "execution") state.claim = null;
        }
        const wait = makeWait(command, now);
        if (wait.kind === "external_event" && wait.correlationKey &&
            state.receivedEvents.some(({ correlationKey }) => correlationKey === wait.correlationKey)) {
          state.receivedEvents = state.receivedEvents.filter(({ correlationKey }) => correlationKey !== wait.correlationKey);
          break;
        }
        if (!wait.correlationKey || !state.waits.some(({ correlationKey }) => correlationKey === wait.correlationKey))
          state.waits.push(wait);
        break;
      }
      case "resolve_wait":
        if (!command.waitId && !command.correlationKey) throw new Error("A wait ID or correlation key is required");
        state.waits = state.waits.filter((wait) =>
          (command.waitId ? wait.id !== command.waitId : true) &&
          (command.correlationKey ? wait.correlationKey !== command.correlationKey : true));
        if (!state.waits.some(({ kind }) => kind === "error")) state.lastError = null;
        break;
      case "external_event": {
        const matched = state.waits.some(({ correlationKey }) => correlationKey === command.correlationKey);
        state.waits = state.waits.filter(({ correlationKey }) => correlationKey !== command.correlationKey);
        if (!matched) state.receivedEvents = [
          ...state.receivedEvents.filter(({ correlationKey }) => correlationKey !== command.correlationKey),
          { correlationKey: command.correlationKey, resolution: command.resolution ?? null, receivedAt: nowIso(now) }
        ].slice(-100);
        break;
      }
      case "upsert_schedule": {
        const existing = state.schedules.find(({ id }) => id === command.schedule.id);
        const timestamp = nowIso(now);
        const schedule = {
          id: command.schedule.id,
          name: command.schedule.name,
          recurrence: command.schedule.recurrence,
          mode: command.schedule.mode,
          role: command.schedule.role ?? null,
          timezone: safeTimeZone(command.schedule.timezone),
          concurrencyRule: "skip_if_running",
          catchUpBehavior: "latest",
          target: {
            workItemId: state.workItemId,
            mode: command.schedule.mode,
            role: command.schedule.role ?? null
          },
          enabled: Boolean(command.schedule.enabled),
          pending: existing?.pending ?? false,
          pendingOccurrenceId: existing?.pendingOccurrenceId ?? null,
          lastAdmittedOccurrenceId: existing?.lastAdmittedOccurrenceId ?? null,
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
        schedule.enabled = Boolean(command.enabled);
        if (!schedule.enabled) schedule.pending = false;
        schedule.updatedAt = nowIso(now);
        break;
      }
      case "trigger_schedule":
      case "ack_schedule": {
        const schedule = state.schedules.find(({ id }) => id === command.scheduleId);
        if (!schedule) throw new Error("The schedule is unavailable");
        if (command.type === "trigger_schedule") {
          schedule.pending = true;
          schedule.pendingOccurrenceId ??= `${schedule.id}:manual:${nowIso(now)}`;
        } else {
          schedule.lastAdmittedOccurrenceId = schedule.pendingOccurrenceId;
          schedule.pending = false;
          schedule.pendingOccurrenceId = null;
        }
        schedule.updatedAt = nowIso(now);
        break;
      }
      case "delete_schedule":
        state.schedules = state.schedules.filter(({ id }) => id !== command.scheduleId);
        break;
      case "archive":
      case "restore": {
        state.archivedAt = command.type === "archive" ? state.archivedAt ?? nowIso(now) : null;
        if (command.type === "archive") {
          this.database.prepare(`
            WITH RECURSIVE tree(id) AS (
              SELECT ?
              UNION
              SELECT w.id FROM work_items w JOIN tree t ON w.parent_id = t.id
              WHERE w.deleted_at IS NULL
            )
            UPDATE work_items SET archived_at = ?, updated_at = ?
            WHERE id IN (SELECT id FROM tree)
          `).run(state.workItemId, state.archivedAt, nowIso(now));
        } else {
          this.database.prepare(`
            UPDATE work_items SET archived_at = NULL, updated_at = ? WHERE id = ?
          `).run(nowIso(now), state.workItemId);
        }
        if (state.archivedAt) {
          state.claim = null;
          state.waits = [];
          for (const schedule of state.schedules) {
            schedule.enabled = false;
            schedule.pending = false;
          }
        }
        break;
      }
      default:
        throw new Error(`Unsupported process command: ${command.type}`);
    }
  }

  catchUpAll() {
    const rows = this.database.prepare("SELECT organization_id, work_item_id FROM dsh_work_item_states").all();
    for (const row of rows) this.state(String(row.organization_id), String(row.work_item_id));
  }
}
