import { randomUUID } from "node:crypto";
import { iso, workspaceContext } from "./product-database.js";

const credential = (id) => `BEES_MEMORY_${Buffer.from(id).toString("hex")}`;

/** A scoped HTTP adapter: Hindsight owns extraction, retrieval, and consolidation. */
export class WorkMemory {
  constructor(database, credentials, fetcher = fetch) {
    this.database = database;
    this.credentials = credentials;
    this.fetch = fetcher;
    this.inflight = new Map();
    database.exec(`
      CREATE TABLE IF NOT EXISTS bees_memory_settings (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        url TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Not connected'
      ) STRICT;
      CREATE TABLE IF NOT EXISTS bees_memories (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        content TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
    `);
  }

  settings(workspaceId) {
    workspaceContext(this.database, workspaceId);
    const row = this.database.prepare("SELECT url, enabled, status FROM bees_memory_settings WHERE workspace_id = ?").get(workspaceId);
    return { url: row?.url ?? "", enabled: Boolean(row?.enabled), status: row?.status ?? "Not configured", bank: `bees-workspace-${workspaceId}` };
  }

  async configure(workspaceId, input) {
    workspaceContext(this.database, workspaceId, ["admin"]);
    const url = new URL(String(input.url));
    if (url.username || url.password || url.search || url.hash ||
      url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
      throw new Error("Use HTTPS, or HTTP for a local Hindsight server; put credentials in the API key field");
    if (typeof input.enabled !== "boolean") throw new Error("Memory enabled must be a boolean");
    if (input.apiKey !== undefined && (typeof input.apiKey !== "string" || input.apiKey.length > 4096)) throw new Error("Invalid memory API key");
    if (input.apiKey?.trim()) {
      if (!this.credentials?.set) throw new Error("Credential storage is unavailable");
      await this.credentials.set(credential(workspaceId), input.apiKey.trim());
    }
    if (input.clearKey) await this.credentials?.unset(credential(workspaceId));
    this.database.prepare(`INSERT INTO bees_memory_settings VALUES (?, ?, ?, 'Not tested')
      ON CONFLICT(workspace_id) DO UPDATE SET url = excluded.url, enabled = excluded.enabled, status = excluded.status`)
      .run(workspaceId, url.href.replace(/\/+$/, ""), Number(input.enabled));
    return this.settings(workspaceId);
  }

  async request(workspaceId, suffix, method = "GET", body) {
    const config = this.settings(workspaceId);
    if (!config.enabled) throw new Error("Workspace memory is disabled");
    const token = (await this.credentials?.resolve(credential(workspaceId)))?.value;
    try {
      const response = await this.fetch(`${config.url}/v1/default/banks/${encodeURIComponent(config.bank)}${suffix}`, {
        method, redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (response.status === 404 && method === "DELETE") return {};
      if (!response.ok) throw new Error(`Hindsight request failed (${response.status})`);
      this.database.prepare("UPDATE bees_memory_settings SET status = 'Connected' WHERE workspace_id = ?").run(workspaceId);
      return response.status === 204 ? {} : await response.json();
    } catch (error) {
      this.database.prepare("UPDATE bees_memory_settings SET status = 'Unavailable' WHERE workspace_id = ?").run(workspaceId);
      throw error;
    }
  }

  async recall(workspaceId, query) {
    if (!this.settings(workspaceId).enabled) return [];
    const result = await this.request(workspaceId, "/memories/recall", "POST", { query, budget: "low", max_tokens: 1200 });
    const stale = new Set(this.database.prepare("SELECT id FROM bees_memories WHERE workspace_id = ? AND status != 'stored'").all(workspaceId).map(({ id }) => id));
    return (result.results ?? []).filter(({ document_id }) => !stale.has(document_id)).slice(0, 8)
      .map(({ id, text, context, document_id }) => ({ id, text, context, documentId: document_id }));
  }

  remember(workspaceId, content, evidence, id = randomUUID()) {
    workspaceContext(this.database, workspaceId, ["admin", "member"]);
    if (typeof content !== "string" || !content.trim() || content.length > 12000 ||
        typeof evidence !== "string" || !evidence.trim() || evidence.length > 6000)
      throw new Error("Memory needs content and supporting evidence within the size limit");
    this.database.prepare(`INSERT OR IGNORE INTO bees_memories
      (id, workspace_id, content, evidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, workspaceId, content.trim(), evidence.trim(), iso(), iso());
    return { id };
  }

  async flush(workspaceId) {
    if (this.inflight.has(workspaceId)) return this.inflight.get(workspaceId);
    const pending = (async () => {
      if (!this.settings(workspaceId).enabled) return;
      const rows = this.database.prepare("SELECT * FROM bees_memories WHERE workspace_id = ? AND status != 'stored' ORDER BY created_at LIMIT 20").all(workspaceId);
      for (const row of rows) {
        try {
          if (row.status === "deleting") {
            await this.request(workspaceId, `/documents/${encodeURIComponent(row.id)}`, "DELETE");
            this.database.prepare("DELETE FROM bees_memories WHERE id = ?").run(row.id);
            continue;
          }
          await this.request(workspaceId, "/memories", "POST", {
            items: [{ content: row.content, context: `Verified Bees outcome. Evidence: ${row.evidence}`, document_id: row.id }]
          });
          this.database.prepare("UPDATE bees_memories SET status = 'stored', error = NULL, updated_at = ? WHERE id = ? AND updated_at = ?")
            .run(iso(), row.id, row.updated_at);
        } catch {
          this.database.prepare("UPDATE bees_memories SET error = 'Hindsight unavailable; retry to synchronize' WHERE id = ?").run(row.id);
          break;
        }
      }
    })();
    this.inflight.set(workspaceId, pending);
    try { await pending; } finally { this.inflight.delete(workspaceId); }
  }

  async command(action, input) {
    const workspaceId = String(input.workspaceId ?? "");
    workspaceContext(this.database, workspaceId, action === "memory_status" ? ["admin", "member", "viewer"] : ["admin"]);
    if (input.viaAgent) throw new Error("Memory administration belongs to the user");
    if (action === "memory_configure") return this.configure(workspaceId, input);
    if (action === "memory_test") await this.request(workspaceId, "/memories/recall", "POST", { query: "Connection test", budget: "low", max_tokens: 64 });
    if (["memory_edit", "memory_delete"].includes(action)) {
      if (this.inflight.has(workspaceId)) await this.inflight.get(workspaceId);
      const row = this.database.prepare("SELECT * FROM bees_memories WHERE id = ? AND workspace_id = ?").get(input.id, workspaceId);
      if (!row) throw new Error("Memory not found in this workspace");
      if (action === "memory_edit") {
        if (typeof input.content !== "string" || !input.content.trim() || input.content.length > 12000) throw new Error("Memory content must be 1 to 12000 characters");
        this.database.prepare("UPDATE bees_memories SET content = ?, status = 'pending', updated_at = ? WHERE id = ?").run(input.content.trim(), iso(), row.id);
      } else this.database.prepare("UPDATE bees_memories SET status = 'deleting', updated_at = ? WHERE id = ?").run(iso(), row.id);
    }
    if (["memory_retry", "memory_edit", "memory_delete"].includes(action)) await this.flush(workspaceId);
    return { ...this.settings(workspaceId), memories: this.database.prepare(`SELECT id, content, evidence, status, error, updated_at AS updatedAt
      FROM bees_memories WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 100`).all(workspaceId) };
  }
}
