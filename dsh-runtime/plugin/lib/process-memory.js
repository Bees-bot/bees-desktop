import { randomUUID } from "node:crypto";
import { iso, itemContext, required, transaction, workspaceContext } from "./product-database.js";

const columns = `m.seq, m.id, m.kind, m.content, m.active, m.revision,
  m.work_item_id AS workItemId, m.execution_id AS executionId, m.source_id AS sourceId,
  m.created_at AS createdAt, m.updated_at AS updatedAt`;
const sourceKind = (entry) => entry.id.startsWith("human-review:") ? "feedback"
  : entry.author === "Owner" || !entry.executionId && entry.author === "User" ? "response"
    : entry.kind === "lesson" ? "information" : entry.id.startsWith("result:") || entry.kind === "result" ? "result" : null;

/** Exact, owner-managed process knowledge. External memory services keep their own storage. */
export class ProcessMemory {
  constructor(database) {
    this.database = database;
    database.exec(`CREATE TABLE IF NOT EXISTS bees_process_memories (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
      work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
      execution_id TEXT, source_id TEXT UNIQUE,
      source_content TEXT, source_evidence TEXT, source_author TEXT, source_title TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('response', 'feedback', 'information', 'result')),
      content TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
      revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS bees_process_memories_process ON bees_process_memories(process_id, seq);
    INSERT OR IGNORE INTO bees_process_memories
      (id, process_id, work_item_id, execution_id, source_id, source_content, source_evidence, source_author, source_title, kind, content, created_at, updated_at)
      SELECT 'update:' || j.id, w.process_id, w.id, j.execution_id, j.id,
        j.content, j.evidence, j.author, w.title,
        CASE WHEN j.id LIKE 'human-review:%' THEN 'feedback'
          WHEN j.author = 'Owner' OR (j.execution_id IS NULL AND j.author = 'User') THEN 'response'
          WHEN j.kind = 'lesson' THEN 'information' ELSE 'result' END,
        j.content, j.created_at, j.created_at
      FROM bees_work_updates j JOIN work_items w ON w.id = j.work_item_id
      WHERE j.id LIKE 'human-review:%' OR j.author = 'Owner'
        OR (j.execution_id IS NULL AND j.author = 'User') OR j.kind IN ('lesson', 'result') OR j.id LIKE 'result:%';`);
  }

  access(processId, connectionId = "") {
    const process = this.database.prepare(`SELECT id, name, workspace_id AS workspaceId,
      account_user_id AS accountUserId FROM processes WHERE id = ?`).get(required(processId, "Process"));
    if (!process) throw new Error("Process not found");
    const workspace = workspaceContext(this.database, process.workspaceId);
    const connection = workspace.authority === "connected" ? this.database.prepare(`
      SELECT c.account_user_id AS accountUserId, ct.role FROM bees_connections c
      JOIN bees_accounts a ON a.user_id = c.account_user_id AND a.enabled = 1
      JOIN bees_connection_teams ct ON ct.connection_id = c.id AND ct.team_id = ?
      WHERE c.id = ? AND c.organization_id = ?`).get(workspace.teamId, connectionId, workspace.membership.organizationId) : null;
    const canManage = workspace.authority === "local" ? workspace.membership.role === "admin"
      : Boolean(connection && (process.accountUserId ? connection.accountUserId === process.accountUserId : connection.role === "admin"));
    return { process, canManage };
  }

  capture(itemId, entry) {
    const kind = sourceKind(entry);
    if (!kind) return;
    const item = itemContext(this.database, itemId, ["admin", "member"]);
    this.database.prepare(`INSERT OR IGNORE INTO bees_process_memories
      (id, process_id, work_item_id, execution_id, source_id, source_content, source_evidence, source_author, source_title, kind, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`update:${entry.id}`, item.processId, itemId, entry.executionId ?? null, entry.id,
        entry.content, entry.evidence, entry.author, item.title, kind, entry.content, entry.createdAt, entry.createdAt);
  }

  snapshot(processId) {
    this.access(processId);
    return this.database.prepare(`SELECT ${columns} FROM bees_process_memories m
      WHERE process_id = ? AND active = 1 AND deleted_at IS NULL ORDER BY seq`).all(processId);
  }

  view(input) {
    const { process, canManage } = this.access(input.processId, input.connectionId);
    const before = input.before ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(before) || before < 1) throw new Error("Invalid memory cursor");
    const query = input.query ?? "";
    if (typeof query !== "string" || query.length > 200) throw new Error("Memory search must be at most 200 characters");
    const rows = this.database.prepare(`SELECT ${columns}, source_title AS sourceTitle,
      source_content AS sourceContent, source_evidence AS evidence, source_author AS author
      FROM bees_process_memories m
      WHERE m.process_id = ? AND m.deleted_at IS NULL AND m.seq < ? AND instr(lower(m.content), lower(?)) > 0
      ORDER BY m.seq DESC LIMIT 41`).all(process.id, before, query.trim());
    const entries = rows.slice(0, 40).map((row) => ({ ...row, active: Boolean(row.active) }));
    return { processId: process.id, name: process.name, canManage, entries,
      before: entries.at(-1)?.seq ?? before, hasMore: rows.length > 40 };
  }

  command(action, input) {
    if (action === "read_process_memory") return this.view(input);
    const { process, canManage } = this.access(input.processId, input.connectionId);
    if (input.viaAgent || !canManage) throw new Error("Only the process owner can manage its memory");
    const result = transaction(this.database, () => {
      const row = action === "add_process_memory" ? null : this.database.prepare(`
        SELECT * FROM bees_process_memories WHERE id = ? AND process_id = ? AND deleted_at IS NULL`).get(required(input.id, "Memory"), process.id);
      if (action !== "add_process_memory" && !row) throw new Error("Memory not found in this process");
      if (row && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== row.revision))
        throw new Error("This memory changed. Reload it before saving");
      const id = row?.id ?? randomUUID(), at = iso();
      if (action === "forget_process_memory") {
        this.database.prepare("UPDATE bees_process_memories SET active = 0, deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?")
          .run(at, at, id);
      } else {
        if (!["add_process_memory", "edit_process_memory"].includes(action)) throw new Error("Unknown process memory action");
        const content = input.content ?? row?.content;
        if (typeof content !== "string" || !content.trim() || content.length > 12000)
          throw new Error("Memory must contain 1 to 12000 characters");
        const active = input.active ?? Boolean(row?.active);
        if (typeof active !== "boolean") throw new Error("Choose whether this memory is used in future runs");
        // ponytail: bounded exact memory; use retrieval if owners need larger active collections.
        const total = this.database.prepare(`SELECT count(*) AS count, coalesce(sum(length(content)), 0) AS size
          FROM bees_process_memories WHERE process_id = ? AND active = 1 AND deleted_at IS NULL AND id != ?`).get(process.id, id);
        if (active && (total.count >= 50 || total.size + content.length > 24000))
          throw new Error("Active memory is full (50 entries or 24000 characters). Disable older entries first");
        if (row) this.database.prepare("UPDATE bees_process_memories SET content = ?, active = ?, updated_at = ?, revision = revision + 1 WHERE id = ?")
          .run(content.trim(), Number(active), at, id);
        else this.database.prepare(`INSERT INTO bees_process_memories (id, process_id, kind, content, active, created_at, updated_at)
          VALUES (?, ?, 'information', ?, ?, ?, ?)`).run(id, process.id, content.trim(), Number(active), at, at);
      }
      return { id };
    });
    return { ...result, ...this.view(input) };
  }
}
