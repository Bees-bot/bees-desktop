const nowIso = (now = Date.now()) => new Date(now).toISOString();

function timeZone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

function zonedParts(date, zone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric"
  }).formatToParts(date);
  const part = (name) => Number(parts.find(({ type }) => type === name)?.value ?? 0);
  return [part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")];
}

function nextOccurrence(schedule, previous) {
  if (schedule.recurrence === "hourly") return previous + 3_600_000;
  const zone = timeZone(schedule.timezone);
  const [year, month, day, hour, minute, second] = zonedParts(new Date(previous), zone);
  const naive = Date.UTC(year, month, day + 1, hour, minute, second);
  let next = naive;
  for (let pass = 0; pass < 2; pass += 1) {
    const actual = zonedParts(new Date(next), zone);
    next += naive - Date.UTC(...actual);
  }
  if (schedule.recurrence === "weekdays") {
    while (["Sat", "Sun"].includes(new Intl.DateTimeFormat("en-US", {
      timeZone: zone, weekday: "short"
    }).format(new Date(next)))) next = nextOccurrence({ ...schedule, recurrence: "daily" }, next);
  }
  return next;
}

export class ProcessRuntime {
  constructor(database) {
    this.database = database;
    database.exec(`
      CREATE TABLE IF NOT EXISTS bees_schedules (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        target_kind TEXT NOT NULL CHECK (target_kind IN ('process', 'work_item')),
        target_id TEXT NOT NULL,
        name TEXT NOT NULL,
        recurrence TEXT NOT NULL CHECK (recurrence IN ('hourly', 'daily', 'weekdays')),
        timezone TEXT NOT NULL,
        next_run_at TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        pending_occurrence_id TEXT,
        last_admitted_occurrence_id TEXT,
        last_run_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (id, target_kind, target_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS bees_schedules_due ON bees_schedules(enabled, next_run_at);
      CREATE INDEX IF NOT EXISTS bees_schedules_target
        ON bees_schedules(workspace_id, target_kind, target_id);
      CREATE TABLE IF NOT EXISTS bees_domain_receipts (
        idempotency_key TEXT PRIMARY KEY,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
    `);
  }

  item(workspaceId, workItemId) {
    const item = this.database.prepare(`
      SELECT w.id, w.process_id AS processId, w.stage_id AS stageId, w.archived_at AS archivedAt
      FROM work_items w JOIN processes p ON p.id = w.process_id
      WHERE w.id = ? AND w.deleted_at IS NULL AND p.workspace_id = ?
    `).get(workItemId, workspaceId);
    if (!item) throw new Error("Work item not found");
    return item;
  }

  target(workspaceId, targetKind, targetId) {
    if (targetKind === "work_item") return this.item(workspaceId, targetId);
    if (targetKind !== "process") throw new Error("The schedule target is invalid");
    const process = this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, archived_at AS archivedAt
      FROM processes WHERE id = ? AND workspace_id = ?
    `).get(targetId, workspaceId);
    if (!process) throw new Error("Process not found");
    return process;
  }

  schedules(workspaceId, targetKind, targetId) {
    this.target(workspaceId, targetKind, targetId);
    return this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, target_kind AS targetKind,
             target_id AS targetId, name, recurrence, timezone,
             next_run_at AS nextRunAt, enabled,
             pending_occurrence_id AS pendingOccurrenceId,
             last_admitted_occurrence_id AS lastAdmittedOccurrenceId, last_run_at AS lastRunAt
      FROM bees_schedules
      WHERE workspace_id = ? AND target_kind = ? AND target_id = ? ORDER BY created_at
    `).all(workspaceId, targetKind, targetId).map((schedule) => ({
      ...schedule,
      enabled: Boolean(schedule.enabled),
      pending: Boolean(schedule.pendingOccurrenceId),
      concurrencyRule: "skip_if_running",
      catchUpBehavior: "latest"
    }));
  }

  allSchedules(workspaceIds) {
    if (!workspaceIds.length) return [];
    return this.database.prepare(`
      SELECT id, workspace_id AS workspaceId, target_kind AS targetKind,
             target_id AS targetId, name, recurrence, timezone,
             next_run_at AS nextRunAt, enabled,
             pending_occurrence_id AS pendingOccurrenceId,
             last_admitted_occurrence_id AS lastAdmittedOccurrenceId, last_run_at AS lastRunAt
      FROM bees_schedules WHERE workspace_id IN (SELECT value FROM json_each(?))
      ORDER BY created_at
    `).all(JSON.stringify(workspaceIds)).map((schedule) => ({
      ...schedule,
      enabled: Boolean(schedule.enabled),
      pending: Boolean(schedule.pendingOccurrenceId),
      concurrencyRule: "skip_if_running",
      catchUpBehavior: "latest",
      ...(schedule.targetKind === "work_item"
        ? { workItemId: schedule.targetId }
        : { processId: schedule.targetId })
    }));
  }

  state(workspaceId, workItemId) {
    const item = this.item(workspaceId, workItemId);
    const schedules = this.schedules(workspaceId, "work_item", workItemId);
    return { ...item, phase: item.archivedAt ? "archived" : "ready", schedules };
  }

  active(targetKind, targetId) {
    if (targetKind === "work_item") return Boolean(this.database.prepare(`
      SELECT 1 FROM execution_links WHERE work_item_id = ?
        AND status IN ('queued', 'running', 'waiting_for_approval', 'interrupted') LIMIT 1
    `).get(targetId));
    return Boolean(this.database.prepare(`
      SELECT 1 FROM execution_links e JOIN work_items w ON w.id = e.work_item_id
      WHERE w.process_id = ?
        AND e.status IN ('queued', 'running', 'waiting_for_approval', 'interrupted') LIMIT 1
    `).get(targetId));
  }

  scheduleCommand(workspaceId, targetKind, targetId, command) {
    if (!command?.type) throw new Error("A schedule command is required");
    if (command.idempotencyKey) {
      const prior = this.database.prepare(`
        SELECT target_kind AS targetKind, target_id AS targetId, result_json AS resultJson
        FROM bees_domain_receipts WHERE idempotency_key = ?
      `).get(command.idempotencyKey);
      if (prior) {
        if (prior.targetKind !== targetKind || prior.targetId !== targetId)
          throw new Error("The idempotency key belongs to another target");
        return JSON.parse(prior.resultJson);
      }
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const target = this.target(workspaceId, targetKind, targetId);
      if (target.archivedAt && !["toggle_schedule", "delete_schedule"].includes(command.type))
        throw new Error(`The ${targetKind === "process" ? "process" : "work item"} is archived`);
      const at = nowIso();
      if (command.type === "upsert_schedule") {
        const schedule = command.schedule;
        const nextRunAt = new Date(schedule.nextRunAt);
        if (Number.isNaN(nextRunAt.getTime())) throw new Error("The schedule start time is invalid");
        const result = this.database.prepare(`
          INSERT INTO bees_schedules
            (id, workspace_id, target_kind, target_id, name, recurrence, timezone,
             next_run_at, enabled, pending_occurrence_id, last_admitted_occurrence_id,
             last_run_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, recurrence = excluded.recurrence,
            timezone = excluded.timezone, next_run_at = excluded.next_run_at,
            enabled = excluded.enabled, updated_at = excluded.updated_at
          WHERE bees_schedules.workspace_id = excluded.workspace_id
            AND bees_schedules.target_kind = excluded.target_kind
            AND bees_schedules.target_id = excluded.target_id
        `).run(schedule.id, workspaceId, targetKind, targetId, schedule.name, schedule.recurrence,
          timeZone(schedule.timezone), nextRunAt.toISOString(), schedule.enabled ? 1 : 0, at, at);
        if (!result.changes) throw new Error("The schedule belongs to another target");
      } else if (command.type === "toggle_schedule") {
        const result = this.database.prepare(`
          UPDATE bees_schedules SET enabled = ?,
            pending_occurrence_id = CASE WHEN ? THEN pending_occurrence_id ELSE NULL END,
            updated_at = ? WHERE id = ? AND workspace_id = ? AND target_kind = ? AND target_id = ?
        `).run(command.enabled ? 1 : 0, command.enabled ? 1 : 0, at, command.scheduleId,
          workspaceId, targetKind, targetId);
        if (!result.changes) throw new Error("The schedule is unavailable");
      } else if (command.type === "trigger_schedule") {
        if (!this.active(targetKind, targetId)) {
          const result = this.database.prepare(`
            UPDATE bees_schedules SET pending_occurrence_id = coalesce(pending_occurrence_id, ?), updated_at = ?
            WHERE id = ? AND workspace_id = ? AND target_kind = ? AND target_id = ?
          `).run(`${command.scheduleId}:manual:${at}`, at, command.scheduleId,
            workspaceId, targetKind, targetId);
          if (!result.changes) throw new Error("The schedule is unavailable");
        } else if (!this.database.prepare(`
          SELECT 1 FROM bees_schedules
          WHERE id = ? AND workspace_id = ? AND target_kind = ? AND target_id = ?
        `).get(command.scheduleId, workspaceId, targetKind, targetId)) {
          throw new Error("The schedule is unavailable");
        }
      } else if (command.type === "ack_schedule") {
        const result = this.database.prepare(`
          UPDATE bees_schedules SET last_admitted_occurrence_id = ?, pending_occurrence_id = NULL,
            last_run_at = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ? AND target_kind = ? AND target_id = ?
            AND pending_occurrence_id = ?
        `).run(command.occurrenceId, at, at, command.scheduleId,
          workspaceId, targetKind, targetId, command.occurrenceId);
        if (!result.changes) throw new Error("The pending schedule occurrence changed");
      } else if (command.type === "delete_schedule") {
        this.database.prepare(`
          DELETE FROM bees_schedules
          WHERE id = ? AND workspace_id = ? AND target_kind = ? AND target_id = ?
        `).run(command.scheduleId, workspaceId, targetKind, targetId);
      } else {
        throw new Error(`Unsupported schedule command: ${command.type}`);
      }
      const result = {
        ...target,
        targetKind,
        targetId,
        schedules: this.schedules(workspaceId, targetKind, targetId)
      };
      if (command.idempotencyKey) this.database.prepare(`
        INSERT INTO bees_domain_receipts VALUES (?, ?, ?, ?, ?)
      `).run(command.idempotencyKey, targetKind, targetId, JSON.stringify(result), at);
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  command(workspaceId, workItemId, command) {
    if (!command?.type) throw new Error("A process command is required");
    if (["upsert_schedule", "toggle_schedule", "trigger_schedule", "ack_schedule", "delete_schedule"].includes(command.type))
      return this.scheduleCommand(workspaceId, "work_item", workItemId, command);
    if (command.idempotencyKey) {
      const prior = this.database.prepare(`
        SELECT target_kind AS targetKind, target_id AS targetId, result_json AS resultJson
        FROM bees_domain_receipts WHERE idempotency_key = ?
      `).get(command.idempotencyKey);
      if (prior) {
        if (prior.targetKind !== "work_item" || prior.targetId !== workItemId)
          throw new Error("The idempotency key belongs to another work item");
        return JSON.parse(prior.resultJson);
      }
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const item = this.item(workspaceId, workItemId);
      if (item.archivedAt && !["archive", "restore", "toggle_schedule", "delete_schedule"].includes(command.type))
        throw new Error("The work item is archived");
      const at = nowIso();
      if (command.type === "move") {
        const result = this.database.prepare(`
          UPDATE work_items SET stage_id = ?, updated_at = ? WHERE id = ? AND process_id = ?
            AND EXISTS (SELECT 1 FROM stages WHERE id = ? AND process_id = ? AND archived_at IS NULL)
        `).run(command.targetStageId, at, workItemId, item.processId, command.targetStageId, item.processId);
        if (!result.changes) throw new Error("The stage does not belong to this process");
      } else if (command.type === "archive") {
        this.database.prepare(`
          WITH RECURSIVE tree(id) AS (
            SELECT ? UNION SELECT w.id FROM work_items w JOIN tree ON w.parent_id = tree.id
            WHERE w.deleted_at IS NULL
          )
          UPDATE work_items SET archived_at = ?, updated_at = ? WHERE id IN (SELECT id FROM tree)
        `).run(workItemId, item.archivedAt ?? at, at);
        this.database.prepare(`
          UPDATE bees_schedules SET enabled = 0, pending_occurrence_id = NULL, updated_at = ?
          WHERE target_kind = 'work_item' AND target_id IN (
            WITH RECURSIVE tree(id) AS (
              SELECT ? UNION SELECT w.id FROM work_items w JOIN tree ON w.parent_id = tree.id
            ) SELECT id FROM tree
          )
        `).run(at, workItemId);
      } else if (command.type === "restore") {
        this.database.prepare("UPDATE work_items SET archived_at = NULL, updated_at = ? WHERE id = ?").run(at, workItemId);
      } else {
        throw new Error(`Unsupported process command: ${command.type}`);
      }
      const result = this.state(workspaceId, workItemId);
      if (command.idempotencyKey) this.database.prepare(`
        INSERT INTO bees_domain_receipts VALUES (?, 'work_item', ?, ?, ?)
      `).run(command.idempotencyKey, workItemId, JSON.stringify(result), at);
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  catchUpAll(now = Date.now()) {
    const admissions = [];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const schedules = this.database.prepare(`
        SELECT s.id, s.workspace_id AS workspaceId, s.target_kind AS targetKind,
               s.target_id AS targetId, s.recurrence, s.timezone,
               s.next_run_at AS nextRunAt, s.pending_occurrence_id AS pendingOccurrenceId,
               CASE WHEN s.target_kind = 'work_item' THEN s.target_id END AS workItemId,
               CASE WHEN s.target_kind = 'process' THEN s.target_id END AS processId
        FROM bees_schedules s
        LEFT JOIN work_items w ON s.target_kind = 'work_item' AND w.id = s.target_id
        LEFT JOIN processes p ON s.target_kind = 'process' AND p.id = s.target_id
        WHERE s.enabled = 1 AND (
          (s.target_kind = 'work_item' AND w.archived_at IS NULL AND w.deleted_at IS NULL)
          OR (s.target_kind = 'process' AND p.archived_at IS NULL)
        )
      `).all();
      for (const schedule of schedules) {
        if (schedule.pendingOccurrenceId) {
          admissions.push({ ...schedule, occurrenceId: schedule.pendingOccurrenceId });
          continue;
        }
        let next = Date.parse(schedule.nextRunAt);
        if (next > now) continue;
        let latest = next;
        do {
          latest = next;
          next = nextOccurrence(schedule, next);
        } while (next <= now);
        const active = this.active(schedule.targetKind, schedule.targetId);
        const occurrenceId = `${schedule.id}:${nowIso(latest)}`;
        this.database.prepare(`
          UPDATE bees_schedules SET next_run_at = ?, pending_occurrence_id = ?, updated_at = ? WHERE id = ?
        `).run(nowIso(next), active ? null : occurrenceId, nowIso(now), schedule.id);
        if (!active) admissions.push({ ...schedule, occurrenceId });
      }
      this.database.exec("COMMIT");
      return admissions;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
