import { LOCAL_MEMORY_URL } from "./local-memory.js";
import { randomUUID } from "node:crypto";
import { iso, workspaceContext } from "./product-database.js";

const credential = (id) => `BEES_MEMORY_${Buffer.from(id).toString("hex")}`;
const source = (row) => ({ content: row.content, context: `Verified Bees outcome. Evidence: ${row.evidence}`, document_id: row.id });

/** Hindsight owns extraction and consolidation; SQLite is the durable delivery queue. */
export class WorkMemory {
  constructor(database, credentials, fetcher = fetch) {
    this.database = database;
    this.credentials = credentials;
    this.fetch = fetcher;
    this.inflight = new Map();
    this.requests = new Set();
    this.stop = new AbortController();
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
      CREATE TABLE IF NOT EXISTS bees_memory_operations (
        memory_id TEXT PRIMARY KEY REFERENCES bees_memories(id) ON DELETE CASCADE,
        id TEXT NOT NULL, payload_json TEXT NOT NULL
      ) STRICT;
    `);
  }

  settings(workspaceId) {
    workspaceContext(this.database, workspaceId);
    this.defaults();
    const row = this.database.prepare("SELECT url, enabled, status FROM bees_memory_settings WHERE workspace_id = ?").get(workspaceId);
    const local = row.url === LOCAL_MEMORY_URL ? this.local?.view() : undefined;
    return { ...local, provider: "Hindsight", url: row?.url ?? "", enabled: Boolean(row?.enabled),
      status: row.enabled ? local && !this.local.ready ? local.localStatus : row.status : "Disabled", bank: `bees-workspace-${workspaceId}` };
  }

  defaults() {
    this.database.prepare(`INSERT OR IGNORE INTO bees_memory_settings (workspace_id, url, enabled, status)
      SELECT id, ?, 1, 'Preparing local memory' FROM workspaces WHERE status = 'active'`).run(LOCAL_MEMORY_URL);
  }

  async configure(workspaceId, input) {
    workspaceContext(this.database, workspaceId, ["admin"]);
    const url = new URL(String(input.url || LOCAL_MEMORY_URL));
    if (url.username || url.password || url.search || url.hash ||
      url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
      throw new Error("Use HTTPS, or HTTP for a local Hindsight server; put credentials in the API key field");
    if (typeof input.enabled !== "boolean") throw new Error("Memory enabled must be a boolean");
    if (input.apiKey !== undefined && (typeof input.apiKey !== "string" || input.apiKey.length > 4096)) throw new Error("Invalid memory API key");
    const endpoint = url.href.replace(/\/+$/, "");
    await this.inflight.get(workspaceId);
    const previous = this.settings(workspaceId);
    if (previous.url && previous.url !== endpoint && this.database.prepare("SELECT 1 FROM bees_memories WHERE workspace_id = ? LIMIT 1").get(workspaceId))
      throw new Error("Forget and synchronize existing memories before changing endpoints so sources are not left on the previous server");
    if (input.model !== undefined && endpoint === LOCAL_MEMORY_URL && this.local) await this.local.select(input.model);
    if (input.apiKey?.trim()) {
      if (!this.credentials?.set) throw new Error("Credential storage is unavailable");
      await this.credentials.set(credential(workspaceId), input.apiKey.trim());
    }
    if (input.clearKey) await this.credentials?.unset(credential(workspaceId));
    this.database.prepare(`INSERT INTO bees_memory_settings VALUES (?, ?, ?, 'Not tested')
      ON CONFLICT(workspace_id) DO UPDATE SET url = excluded.url, enabled = excluded.enabled, status = excluded.status`)
      .run(workspaceId, endpoint, Number(input.enabled));
    return this.settings(workspaceId);
  }

  async request(workspaceId, suffix, method = "GET", body) {
    if (this.stop.signal.aborted) throw new Error("Memory is shutting down");
    const pending = this.send(workspaceId, suffix, method, body);
    this.requests.add(pending);
    try { return await pending; } finally { this.requests.delete(pending); }
  }

  async send(workspaceId, suffix, method, body) {
    const config = this.settings(workspaceId);
    if (!config.enabled) throw new Error("Workspace memory is disabled");
    if (config.url === LOCAL_MEMORY_URL && this.local && !this.local.ready) {
      this.local.ensure();
      throw new Error(this.local.status);
    }
    const token = (await this.credentials?.resolve(credential(workspaceId)))?.value;
    try {
      const response = await this.fetch(`${config.url}/v1/default/banks/${encodeURIComponent(config.bank)}${suffix}`, {
        method, redirect: "error", signal: AbortSignal.any([this.stop.signal, AbortSignal.timeout(15000)]),
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (response.status === 404 && method === "DELETE") return {};
      if (!response.ok) throw Object.assign(new Error(`Hindsight request failed (${response.status})`), { status: response.status });
      const result = response.status === 204 ? {} : await response.json();
      this.database.prepare(`UPDATE bees_memory_settings SET status =
        CASE WHEN status IN ('Connected', 'LLM unavailable') THEN status ELSE 'Reachable' END WHERE workspace_id = ?`).run(workspaceId);
      return result;
    } catch (error) {
      this.database.prepare("UPDATE bees_memory_settings SET status = 'Unavailable' WHERE workspace_id = ?").run(workspaceId);
      throw error;
    }
  }

  async connect(workspaceId) {
    try { await this.request(workspaceId, "/config"); }
    catch (error) {
      if (error.status !== 404) throw error;
      await this.request(workspaceId, "", "PUT", {});
    }
    await this.request(workspaceId, "/memories/recall", "POST", { query: "Connection test", budget: "low", max_tokens: 64 });
    const health = await this.request(workspaceId, "/health/llm", "POST");
    if (!health.operations?.length || health.operations.some(({ ok }) => !ok)) {
      this.database.prepare("UPDATE bees_memory_settings SET status = 'LLM unavailable' WHERE workspace_id = ?").run(workspaceId);
      throw new Error("Hindsight is reachable, but its LLM is not ready. Configure the provider on the Hindsight service and test again.");
    }
    this.database.prepare("UPDATE bees_memory_settings SET status = 'Connected' WHERE workspace_id = ?").run(workspaceId);
  }

  async recall(workspaceId, query) {
    if (!this.settings(workspaceId).enabled) return [];
    // Pending corrections/deletions must not leak through synthesized observations either.
    const stale = this.database.prepare("SELECT 1 FROM bees_memories WHERE workspace_id = ? AND status != 'stored' LIMIT 1").get(workspaceId);
    const body = { query, budget: "low", max_tokens: 1200, ...(stale ? { types: ["world", "experience"] } : {}) };
    let result;
    try { result = await this.request(workspaceId, "/memories/recall", "POST", body); }
    catch (error) {
      if (error.status !== 404) throw error;
      await this.request(workspaceId, "", "PUT", {});
      result = await this.request(workspaceId, "/memories/recall", "POST", body);
    }
    // Re-read after the network call so a concurrent Forget takes effect immediately.
    const hidden = new Set(this.database.prepare("SELECT id FROM bees_memories WHERE workspace_id = ? AND status != 'stored'").all(workspaceId).map(({ id }) => id));
    return (result.results ?? []).filter(({ document_id, type }) => !hidden.has(document_id) && !(hidden.size && type === "observation"))
      .slice(0, 8).map(({ id, text, context, document_id }) => ({ id, text, context, documentId: document_id }));
  }

  remember(workspaceId, content, evidence, id = randomUUID()) {
    workspaceContext(this.database, workspaceId, ["admin", "member"]);
    if (!this.settings(workspaceId).enabled) return { id };
    if (typeof content !== "string" || !content.trim() || content.length > 12000 ||
        typeof evidence !== "string" || !evidence.trim() || evidence.length > 6000)
      throw new Error("Memory needs content and supporting evidence within the size limit");
    this.database.prepare(`INSERT OR IGNORE INTO bees_memories
      (id, workspace_id, content, evidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, workspaceId, content.trim(), evidence.trim(), iso(), iso());
    return { id };
  }

  async flush(workspaceId) {
    if (this.stop.signal.aborted) return;
    if (this.inflight.has(workspaceId)) return this.inflight.get(workspaceId);
    const pending = this.synchronize(workspaceId);
    this.inflight.set(workspaceId, pending);
    try { await pending; } finally { this.inflight.delete(workspaceId); }
  }

  async synchronize(workspaceId) {
    const config = this.settings(workspaceId);
    if (!config.enabled) return;
    if (config.url === LOCAL_MEMORY_URL && this.local && !this.local.ready) { this.local.ensure(); return; }
    const rows = this.database.prepare("SELECT * FROM bees_memories WHERE workspace_id = ? AND status NOT IN ('stored', 'failed') ORDER BY updated_at LIMIT 20").all(workspaceId);
    for (const row of rows) {
      if (this.stop.signal.aborted) return;
      try {
        let operation = this.database.prepare("SELECT * FROM bees_memory_operations WHERE memory_id = ?").get(row.id);
        if (!operation && row.status !== "deleting") {
          operation = { id: randomUUID(), payload_json: JSON.stringify(source(row)) };
          this.database.prepare("INSERT INTO bees_memory_operations VALUES (?, ?, ?)").run(row.id, operation.id, operation.payload_json);
        }
        if (operation) {
          let state;
          try { state = await this.request(workspaceId, `/operations/${operation.id}`); }
          catch (error) { if (error.status !== 404) throw error; state = { status: "not_found" }; }
          if (state.status === "not_found") {
            const result = await this.request(workspaceId, "/memories", "POST", {
              async: true, operation_id: operation.id, items: [JSON.parse(operation.payload_json)]
            });
            if (!result.success || !result.async || result.operation_id !== operation.id)
              throw new Error("Hindsight did not acknowledge the retained operation");
            state = { status: "processing" };
          }
          if (["pending", "processing"].includes(state.status)) {
            this.database.prepare("UPDATE bees_memories SET status = CASE WHEN status = 'deleting' THEN status ELSE 'processing' END, error = NULL, updated_at = ? WHERE id = ?").run(iso(), row.id);
            continue;
          }
          if (!["completed", "failed", "cancelled"].includes(state.status)) throw new Error("Unknown Hindsight operation status");
          const changed = operation.payload_json !== JSON.stringify(source(row));
          if (state.status !== "completed" && row.status !== "deleting" && !changed) {
            this.database.prepare("UPDATE bees_memories SET status = 'failed', error = 'Extraction failed; check the Hindsight provider and retry', updated_at = ? WHERE id = ?").run(iso(), row.id);
            continue;
          }
          this.database.prepare("DELETE FROM bees_memory_operations WHERE memory_id = ?").run(row.id);
          if (changed && row.status !== "deleting") {
            this.database.prepare("UPDATE bees_memories SET status = 'pending', error = NULL, updated_at = ? WHERE id = ?").run(iso(), row.id);
            continue;
          }
        }
        if (row.status === "deleting") {
          await this.request(workspaceId, `/documents/${encodeURIComponent(row.id)}`, "DELETE");
          this.database.prepare("DELETE FROM bees_memories WHERE id = ?").run(row.id);
        } else this.database.prepare("UPDATE bees_memories SET status = 'stored', error = NULL, updated_at = ? WHERE id = ?").run(iso(), row.id);
      } catch {
        this.database.prepare("UPDATE bees_memories SET error = 'Hindsight unavailable; synchronization will retry automatically', updated_at = ? WHERE id = ?").run(iso(), row.id);
        break;
      }
    }
  }

  start() {
    if (this.timer || this.stop.signal.aborted) return;
    const tick = () => {
      this.defaults();
      if (this.database.prepare("SELECT 1 FROM bees_memory_settings WHERE enabled = 1 AND url = ? LIMIT 1").get(LOCAL_MEMORY_URL))
        this.local?.ensure();
      for (const { workspace_id } of this.database.prepare("SELECT workspace_id FROM bees_memory_settings WHERE enabled = 1").all())
        void this.flush(workspace_id).catch(() => {});
    };
    this.timer = setInterval(tick, 15000);
    this.timer.unref();
    tick();
  }

  async close() {
    clearInterval(this.timer);
    this.stop.abort();
    await Promise.allSettled([...this.inflight.values(), ...this.requests]);
    await this.local?.close();
  }

  async command(action, input) {
    const workspaceId = String(input.workspaceId ?? "");
    workspaceContext(this.database, workspaceId, action === "memory_status" ? ["admin", "member", "viewer"] : ["admin"]);
    if (input.viaAgent) throw new Error("Memory administration belongs to the user");
    if (action === "memory_configure") {
      await this.configure(workspaceId, input);
      if (input.enabled) {
        if (this.settings(workspaceId).managed) this.local.ensure();
        else await this.connect(workspaceId);
      }
    }
    if (action === "memory_test") await this.connect(workspaceId);
    if (["memory_edit", "memory_delete", "memory_retry"].includes(action)) {
      await this.inflight.get(workspaceId);
      if (action === "memory_retry") {
        this.database.prepare("DELETE FROM bees_memory_operations WHERE memory_id IN (SELECT id FROM bees_memories WHERE workspace_id = ? AND status = 'failed')").run(workspaceId);
        this.database.prepare("UPDATE bees_memories SET status = 'pending', error = NULL WHERE workspace_id = ? AND status = 'failed'").run(workspaceId);
      } else {
        const row = this.database.prepare("SELECT * FROM bees_memories WHERE id = ? AND workspace_id = ?").get(input.id, workspaceId);
        if (!row) throw new Error("Memory not found in this workspace");
        if (action === "memory_edit") {
          if (row.status === "deleting") throw new Error("This memory is being forgotten");
          if (typeof input.content !== "string" || !input.content.trim() || input.content.length > 12000) throw new Error("Memory content must be 1 to 12000 characters");
          this.database.prepare("UPDATE bees_memories SET content = ?, status = 'pending', error = NULL, updated_at = ? WHERE id = ?").run(input.content.trim(), iso(), row.id);
        } else this.database.prepare("UPDATE bees_memories SET status = 'deleting', error = NULL, updated_at = ? WHERE id = ?").run(iso(), row.id);
      }
    }
    if (["memory_configure", "memory_retry", "memory_edit", "memory_delete"].includes(action)) await this.flush(workspaceId);
    // the model list re-reads every plugin's settings, so only this screen pays for it, not each 15s sync per workspace
    return { ...this.settings(workspaceId), models: this.local?.models().map(({ id, name }) => ({ id, name })) ?? [], memories: this.database.prepare(`SELECT id, content, evidence, status, error, updated_at AS updatedAt
      FROM bees_memories WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 100`).all(workspaceId) };
  }
}
