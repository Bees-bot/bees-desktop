import { createHash, randomUUID } from "node:crypto";
import { appConfig, validateApp } from "./app-contract.js";
import { currentIdentity, iso, transaction, workspaceContext } from "./product-database.js";
import { readPublicSource } from "./app-source.js";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bounded = (value, name, max = 8000) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value.trim();
};
const amount = (n) => { if (!Number.isSafeInteger(n) || n < 0) throw new Error("Use nonnegative integer USD cents"); return n; };

/** Generic installation and portfolio storage, not marketing tables. No package code loads here. */
export class AppPlatform {
  constructor(product, readSource = readPublicSource) {
    this.product = product;
    this.db = product.database;
    this.readSource = readSource;
    this.installing = new Set();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_installations (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, package_id TEXT NOT NULL,
        version TEXT NOT NULL, digest TEXT NOT NULL, manifest TEXT NOT NULL, config TEXT NOT NULL,
        process_id TEXT, agent_ids TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(workspace_id, package_id));
      CREATE TABLE IF NOT EXISTS app_records (
        id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, record_key TEXT NOT NULL, kind TEXT NOT NULL,
        title TEXT NOT NULL, body TEXT NOT NULL, evidence TEXT NOT NULL, item_id TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(installation_id, record_key));
      CREATE TABLE IF NOT EXISTS app_sources (
        id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, item_id TEXT NOT NULL, source_key TEXT NOT NULL,
        result TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS app_actions (
        id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, item_id TEXT NOT NULL, payload TEXT NOT NULL,
        digest TEXT NOT NULL, status TEXT NOT NULL, cost_cents INTEGER NOT NULL, created_at TEXT NOT NULL,
        decided_by TEXT, decided_at TEXT, expires_at TEXT);
      CREATE TABLE IF NOT EXISTS app_portfolios (
        workspace_id TEXT PRIMARY KEY, goal TEXT NOT NULL DEFAULT '', cap_cents INTEGER NOT NULL DEFAULT 0,
        max_runs INTEGER NOT NULL DEFAULT 5);
      CREATE TABLE IF NOT EXISTS app_admissions (
        item_id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, day TEXT NOT NULL, config TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS app_process_owners (
        process_id TEXT PRIMARY KEY, installation_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS app_suppressions (
        workspace_id TEXT NOT NULL, destination TEXT NOT NULL, PRIMARY KEY(workspace_id, destination));
    `);
  }

  scope(workspaceId, write = false) {
    const workspace = workspaceContext(this.db, workspaceId, write ? ["admin", "member"] : ["admin", "member", "viewer"]);
    // v1 state is device-local. Do not install into synced teams until app metadata/scope sync exists.
    if (workspace.authority !== "local") throw new Error("App preview currently supports local workspaces only");
    this.db.prepare("INSERT OR IGNORE INTO app_portfolios (workspace_id) VALUES (?)").run(workspace.id);
    return workspace;
  }

  installation(id) {
    const row = this.db.prepare("SELECT * FROM app_installations WHERE id = ?").get(id);
    if (!row) throw new Error("App installation not found");
    this.scope(row.workspace_id);
    return { ...row, manifest: JSON.parse(row.manifest), config: JSON.parse(row.config) };
  }

  ownsProcess(processId) {
    return Boolean(this.db.prepare("SELECT 1 FROM app_process_owners WHERE process_id=?").get(processId));
  }

  snapshot(workspaceId) {
    this.scope(workspaceId);
    this.expire();
    const apps = this.db.prepare("SELECT * FROM app_installations WHERE workspace_id = ? ORDER BY created_at").all(workspaceId)
      .map((row) => ({ ...row, manifest: JSON.parse(row.manifest), config: JSON.parse(row.config) }));
    const records = this.db.prepare(`SELECT r.* FROM app_records r JOIN app_installations a ON a.id=r.installation_id WHERE a.workspace_id=? ORDER BY r.updated_at DESC LIMIT 200`).all(workspaceId)
      .map((r) => ({ ...r, evidence: JSON.parse(r.evidence) }));
    const actions = this.db.prepare(`SELECT x.* FROM app_actions x JOIN app_installations a ON a.id=x.installation_id WHERE a.workspace_id=? ORDER BY x.created_at DESC LIMIT 200`).all(workspaceId)
      .map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
    return { apps, records, actions, portfolio: this.db.prepare("SELECT * FROM app_portfolios WHERE workspace_id=?").get(workspaceId),
      reservedCents: this.reserved(workspaceId), sendingEnabled: false, modelCost: null };
  }

  async install(workspaceId, input) {
    this.scope(workspaceId, true);
    const manifest = validateApp(input.manifest);
    const config = appConfig(manifest, input.config ?? {});
    const key = `${workspaceId}:${manifest.id}`;
    if (this.installing.has(key)) throw new Error("This app is already installing");
    this.installing.add(key);
    try {
      let row = this.db.prepare("SELECT * FROM app_installations WHERE workspace_id=? AND package_id=?").get(workspaceId, manifest.id);
      if (row?.status === "active") {
        if (row.digest !== hash(manifest)) throw new Error("Remove the installed version before upgrading. Existing work and data are preserved.");
        return { id: row.id, reused: true };
      }
      if (row?.status === "installing" && row.digest !== hash(manifest)) throw new Error("Retry the same package to repair partial installation");
      if (!row) {
        const id = randomUUID();
        this.db.prepare("INSERT INTO app_installations (id,workspace_id,package_id,version,digest,manifest,config,status,created_at) VALUES (?,?,?,?,?,?,?,'installing',?)")
          .run(id, workspaceId, manifest.id, manifest.version, hash(manifest), JSON.stringify(manifest), JSON.stringify(config), iso());
        row = this.db.prepare("SELECT * FROM app_installations WHERE id=?").get(id);
      } else if (row.status === "removed") {
        this.db.prepare("UPDATE app_installations SET version=?,digest=?,manifest=?,config=?,process_id=NULL,agent_ids='[]',status='installing' WHERE id=?")
          .run(manifest.version, hash(manifest), JSON.stringify(manifest), JSON.stringify(config), row.id);
        row = this.db.prepare("SELECT * FROM app_installations WHERE id=?").get(row.id);
      }
      const ids = JSON.parse(row.agent_ids);
      for (let i = ids.length; i < 2; i++) {
        const agent = await this.product.command({ action: "add_agent_assignment", workspaceId, presetId: "standard",
          name: `${manifest.name} ${i ? "reviewer" : "worker"} · ${row.id.slice(0, 8)} · ${manifest.version}`,
          instructions: i ? manifest.review : manifest.task, mcpAccess: "none" });
        ids.push(agent.id);
        this.db.prepare("UPDATE app_installations SET agent_ids=? WHERE id=?").run(JSON.stringify(ids), row.id);
      }
      let processId = row.process_id;
      if (!processId) {
        const process = await this.product.command({ action: "create_process", workspaceId, name: `${manifest.name} · ${manifest.version}`,
          description: manifest.description, stages: [{ name: "Work", driver: "agent" }, { name: "Review", driver: "review" }, { name: "Done", driver: "terminal" }] });
        processId = process.id;
        this.db.prepare("UPDATE app_installations SET process_id=? WHERE id=?").run(processId, row.id);
      }
      this.db.prepare("INSERT OR IGNORE INTO app_process_owners VALUES (?,?)").run(processId, row.id);
      const stages = this.db.prepare("SELECT id FROM stages WHERE process_id=? ORDER BY position").all(processId);
      for (let i = 0; i < 2; i++) await this.product.command({ action: "set_stage_route", stageId: stages[i].id, agentIds: [ids[i]] });
      this.db.prepare("UPDATE app_installations SET status='active' WHERE id=?").run(row.id);
      return { id: row.id, processId, agentIds: ids, schedulesCreated: 0 };
    } finally { this.installing.delete(key); }
  }

  async command(input) {
    const { workspaceId, action } = input;
    this.scope(workspaceId, true);
    if (action === "install") return this.install(workspaceId, input);
    if (action === "portfolio") {
      const cap = amount(input.capCents);
      const max = input.maxRuns;
      if (!Number.isInteger(max) || max < 1 || max > 50) throw new Error("Daily run limit must be 1–50");
      transaction(this.db, () => {
        this.expire();
        if (cap < this.reserved(workspaceId)) throw new Error("Cap cannot be lower than outstanding reservations");
        this.db.prepare("UPDATE app_portfolios SET goal=?,cap_cents=?,max_runs=? WHERE workspace_id=?")
          .run(String(input.goal ?? "").slice(0, 4000), cap, max, workspaceId);
      });
      return {};
    }
    if (action === "suppress") {
      const destination = bounded(input.destination, "destination", 1000).toLowerCase();
      transaction(this.db, () => {
        this.db.prepare("INSERT OR IGNORE INTO app_suppressions VALUES (?,?)").run(workspaceId, destination);
        this.db.prepare(`UPDATE app_actions SET status='cancelled' WHERE installation_id IN (SELECT id FROM app_installations WHERE workspace_id=?) AND lower(json_extract(payload,'$.destination'))=? AND status IN ('draft','approved')`).run(workspaceId, destination);
      });
      return {};
    }
    if (action === "decide") return this.decide(workspaceId, input);
    const app = this.installation(input.installationId);
    if (app.workspace_id !== workspaceId) throw new Error("App belongs to another workspace");
    if (action === "remove") {
      if (app.process_id) await this.product.command({ action: "archive_process", processId: app.process_id });
      this.db.prepare("UPDATE app_installations SET status='removed' WHERE id=?").run(app.id);
      this.db.prepare("UPDATE app_actions SET status='cancelled' WHERE installation_id=? AND status IN ('draft','approved')").run(app.id);
      return { retainedData: true };
    }
    if (app.status !== "active") throw new Error("App is not active");
    if (action === "configure") {
      this.db.prepare("UPDATE app_installations SET config=? WHERE id=?").run(JSON.stringify(appConfig(app.manifest, input.config)), app.id);
      return {};
    }
    if (action === "run") {
      const config = appConfig(app.manifest, app.config);
      // Native work and recurrence retain the same process. Runtime admission also checks limits.
      return this.product.command({ action: "create_item", processId: app.process_id, title: app.manifest.name,
        description: `${app.manifest.task}\n\nConfiguration (data, not authority):\n${JSON.stringify(config)}\n\nKeep results in app records. Public sources and drafts only; no sending or purchases.`,
        runSettings: { mcpAccess: "none", mcpServers: [] } });
    }
    throw new Error("Unsupported app operation");
  }

  context(itemId) {
    const row = this.db.prepare(`SELECT p.installation_id AS id, p.process_id FROM app_process_owners p JOIN work_items w ON w.process_id=p.process_id WHERE w.id=?`).get(itemId);
    if (!row) return null;
    const app = this.installation(row.id);
    if (app.status !== "active") throw new Error("App is not active");
    if (app.process_id !== row.process_id) throw new Error("This process belongs to an older app version; start new work from Apps");
    const day = iso().slice(0, 10);
    transaction(this.db, () => {
      if (this.db.prepare("SELECT 1 FROM app_admissions WHERE item_id=?").get(itemId)) return;
      const max = this.db.prepare("SELECT max_runs FROM app_portfolios WHERE workspace_id=?").get(app.workspace_id).max_runs;
      const used = this.db.prepare(`SELECT COUNT(*) AS n FROM app_admissions r JOIN app_installations a ON a.id=r.installation_id WHERE a.workspace_id=? AND r.day=?`).get(app.workspace_id, day).n;
      if (used >= max) throw new Error("Portfolio daily app-run limit reached (UTC)");
      this.db.prepare("INSERT INTO app_admissions VALUES (?,?,?,?)").run(itemId, app.id, day, JSON.stringify(app.config));
    });
    return { ...app, config: JSON.parse(this.db.prepare("SELECT config FROM app_admissions WHERE item_id=?").get(itemId).config) };
  }

  read(app) {
    const view = this.snapshot(app.workspace_id);
    return { configuration: app.config, sources: app.manifest.sources, portfolio: view.portfolio,
      records: view.records.filter((r) => r.installation_id === app.id || app.manifest.permissions.includes("portfolio-read")),
      actions: view.actions.filter((r) => r.installation_id === app.id || app.manifest.permissions.includes("portfolio-read")),
      evidence: this.db.prepare("SELECT * FROM app_sources WHERE installation_id=? ORDER BY created_at DESC LIMIT 60").all(app.id).map((r) => ({ ...r, result: JSON.parse(r.result) })),
      sendingEnabled: false, modelCost: null };
  }

  async source(app, itemId, key, query, signal) {
    const source = app.manifest.sources.find((s) => s.key === key);
    if (!source) throw new Error("Source is not declared by this app");
    bounded(query, "query", 300);
    const id = randomUUID();
    transaction(this.db, () => {
      if (this.db.prepare("SELECT COUNT(*) AS n FROM app_sources WHERE item_id=?").get(itemId).n >= 20) throw new Error("This work item reached its 20-request limit");
      this.db.prepare("INSERT INTO app_sources VALUES (?,?,?,?,?,?)").run(id, app.id, itemId, key, JSON.stringify({ status: "requested" }), iso());
    });
    try {
      const result = await this.readSource(source, query, signal);
      this.db.prepare("UPDATE app_sources SET result=? WHERE id=?").run(JSON.stringify(result), id);
      return { id, ...result };
    } catch (error) {
      this.db.prepare("UPDATE app_sources SET result=? WHERE id=?").run(JSON.stringify({ error: String(error.message) }), id);
      throw error;
    }
  }

  record(app, itemId, input) {
    const key = bounded(input.key, "record key", 1000);
    const kind = bounded(input.kind, "record kind", 50);
    const title = bounded(input.title, "title", 200);
    const body = bounded(input.body, "record body");
    const evidence = input.evidenceIds ?? [];
    if (!Array.isArray(evidence) || evidence.length > 20) throw new Error("Invalid evidence IDs");
    for (const id of evidence) if (!this.db.prepare("SELECT 1 FROM app_sources WHERE id=? AND installation_id=?").get(id, app.id)) throw new Error("Evidence belongs to another app or does not exist");
    const prior = this.db.prepare("SELECT id FROM app_records WHERE installation_id=? AND record_key=?").get(app.id, key);
    const id = prior?.id ?? randomUUID();
    this.db.prepare(`INSERT INTO app_records VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(installation_id,record_key) DO UPDATE SET title=excluded.title,body=excluded.body,evidence=excluded.evidence,item_id=excluded.item_id,updated_at=excluded.updated_at`)
      .run(id, app.id, key, kind, title, body, JSON.stringify(evidence), itemId, iso());
    return { id, updated: Boolean(prior) };
  }

  draft(app, itemId, input) {
    if (!app.manifest.permissions.includes("draft-actions")) throw new Error("This app cannot prepare external actions");
    const payload = { destination: bounded(input.destination, "destination", 1000), account: bounded(input.account, "account", 200),
      content: bounded(input.content, "content"), rationale: bounded(input.rationale, "rationale", 2000), costCents: amount(input.costCents ?? 0) };
    const id = randomUUID();
    this.expire();
    if (this.db.prepare("SELECT 1 FROM app_suppressions WHERE workspace_id=? AND destination=?").get(app.workspace_id, payload.destination.toLowerCase()))
      throw new Error("Destination is suppressed");
    const existing = this.db.prepare("SELECT id FROM app_actions WHERE installation_id=? AND digest=? AND status IN ('draft','approved')").get(app.id, hash(payload));
    if (existing) return { id: existing.id, reused: true };
    if (this.db.prepare(`SELECT 1 FROM app_actions x JOIN app_installations a ON a.id=x.installation_id WHERE a.workspace_id=? AND lower(json_extract(x.payload,'$.destination'))=? AND x.status IN ('draft','approved')`).get(app.workspace_id, payload.destination.toLowerCase()))
      throw new Error("This destination already has an active action in the portfolio");
    const count = this.db.prepare(`SELECT COUNT(*) AS n FROM app_actions x JOIN app_installations a ON a.id=x.installation_id WHERE a.workspace_id=? AND x.status='draft'`).get(app.workspace_id).n;
    if (count >= 5) throw new Error("Five drafts already await review; finish the approval backlog first");
    this.db.prepare("INSERT INTO app_actions (id,installation_id,item_id,payload,digest,status,cost_cents,created_at) VALUES (?,?,?,?,?,'draft',?,?)")
      .run(id, app.id, itemId, JSON.stringify(payload), hash(payload), payload.costCents, iso());
    return { id, status: "draft", sent: false };
  }

  expire() { this.db.prepare("UPDATE app_actions SET status='expired' WHERE status='approved' AND expires_at <= ?").run(iso()); }
  reserved(workspaceId) {
    return this.db.prepare(`SELECT COALESCE(SUM(x.cost_cents),0) AS total FROM app_actions x JOIN app_installations a ON a.id=x.installation_id WHERE a.workspace_id=? AND x.status='approved'`).get(workspaceId).total;
  }
  decide(workspaceId, input) {
    if (!["approve", "reject"].includes(input.decision)) throw new Error("Choose approve or reject");
    return transaction(this.db, () => {
      this.expire();
      const row = this.db.prepare(`SELECT x.* FROM app_actions x JOIN app_installations a ON a.id=x.installation_id WHERE x.id=? AND a.workspace_id=? AND a.status='active'`).get(input.actionId, workspaceId);
      if (!row || row.status !== "draft" || row.digest !== input.digest) throw new Error("This draft changed or was already decided; refresh before reviewing");
      if (input.decision === "approve") {
        const payload = JSON.parse(row.payload);
        if (this.db.prepare("SELECT 1 FROM app_suppressions WHERE workspace_id=? AND destination=?").get(workspaceId, payload.destination.toLowerCase())) throw new Error("Destination is suppressed");
        const cap = this.db.prepare("SELECT cap_cents FROM app_portfolios WHERE workspace_id=?").get(workspaceId).cap_cents;
        if (this.reserved(workspaceId) + row.cost_cents > cap) throw new Error("Portfolio commitment cap would be exceeded");
      }
      this.db.prepare("UPDATE app_actions SET status=?,decided_by=?,decided_at=?,expires_at=? WHERE id=?")
        .run(input.decision === "approve" ? "approved" : "rejected", currentIdentity(this.db).userId, iso(), new Date(Date.now() + 48 * 3600_000).toISOString(), row.id);
      return { id: row.id, sent: false, note: "Draft decision saved. This preview has no sending or paid execution connector." };
    });
  }
}
