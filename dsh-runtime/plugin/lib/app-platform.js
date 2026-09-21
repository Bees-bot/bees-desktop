import { createHash, randomUUID } from "node:crypto";
import { appConfig, appRecordData, validateApp } from "./app-contract.js";
import { currentIdentity, iso, transaction, workspaceContext } from "./product-database.js";
import { publicSourceUrl, readPublicSource } from "./app-source.js";
import { AppSharedState } from './app-shared-state.js';
import { ACTION_RESERVED_STATUSES, AppActionDispatcher, claimAction, decideAction, reconcileAction, reviewAction, settleAction } from './app-actions.js';

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bounded = (value, name, max = 8000) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value.trim();
};
const amount = (n) => { if (!Number.isSafeInteger(n) || n < 0) throw new Error("Use nonnegative integer USD cents"); return n; };
const recordRow = (row) => ({ ...row, data: JSON.parse(row.data ?? "{}"), evidence: JSON.parse(row.evidence) });
const runLimitReached = 'Daily app-run limit reached. Raise "New app work items per UTC day" under Portfolio goal and limits, or wait for the UTC day to change.';
const APP_STAGES = [{ name: "Work", driver: "agent" }, { name: "Review", driver: "review" }, { name: "Done", driver: "terminal" }];

/** Generic installation and portfolio storage, not marketing tables. No package code loads here. */
export class AppPlatform {
  constructor(product, readSource = readPublicSource, { connected, catalog, actionConnector = null } = {}) {
    if (actionConnector && (typeof actionConnector.send !== "function" || ![actionConnector.workspaceIds, actionConnector.actorUserIds].every((ids) => Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === "string" && id.trim())))) throw new Error("Action connectors require explicit workspace and actor grants");
    if (actionConnector) { bounded(actionConnector.id, "connector ID", 200); bounded(actionConnector.account, "connector account", 200); }
    this.product = product;
    this.db = product.database;
    this.readSource = readSource;
    this.installing = new Set();
    this.catalog = catalog;
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
      CREATE TABLE IF NOT EXISTS app_suppressions (
        workspace_id TEXT NOT NULL, destination TEXT NOT NULL, PRIMARY KEY(workspace_id, destination));
    `);
    const recordColumns = this.db.prepare("PRAGMA table_info(app_records)").all().map((column) => column.name);
    if (!recordColumns.includes("data")) this.db.exec("ALTER TABLE app_records ADD COLUMN data TEXT NOT NULL DEFAULT '{}'");
    if (!recordColumns.includes("provenance")) this.db.exec("ALTER TABLE app_records ADD COLUMN provenance TEXT NOT NULL DEFAULT 'agent'");
    const actionColumns = this.db.prepare("PRAGMA table_info(app_actions)").all().map((column) => column.name);
    if (!actionColumns.includes("reviewed_digest")) this.db.exec("ALTER TABLE app_actions ADD COLUMN reviewed_digest TEXT");
    if (!actionColumns.includes("execution")) this.db.exec("ALTER TABLE app_actions ADD COLUMN execution TEXT NOT NULL DEFAULT '{}'");
    if (!this.db.prepare("PRAGMA table_info(app_portfolios)").all().some((column) => column.name === "approver_user_id")) this.db.exec("ALTER TABLE app_portfolios ADD COLUMN approver_user_id TEXT");
    for (const row of this.db.prepare('SELECT id, agent_ids FROM app_installations').all()) {
      // one corrupt row must not keep the app from booting; imports validate json on the way in
      let ids; try { ids = JSON.parse(row.agent_ids); } catch { console.warn(`bees: app installation ${row.id} has unreadable agent_ids and was skipped`); continue; }
      for (const id of ids) this.db.prepare('INSERT OR IGNORE INTO app_agent_owners VALUES (?,?)').run(id, row.id);
    }
    this.shared = connected ? new AppSharedState(this, connected) : null;
    this.actionConnector = actionConnector;
    this.dispatcher = new AppActionDispatcher({ connector: actionConnector,
      load: (input) => this.withState(input.workspaceId, false, () => this.actionRow(input.workspaceId, input.actionId), { connectionId: input.connectionId }),
      claim: (input) => this.withState(input.workspaceId, true, (actor) => transaction(this.db, () => {
        if (!this.connectorFor(input.workspaceId, actor)) throw new Error("This workspace and actor are not authorized to use the action connector");
        const row = this.actionRow(input.workspaceId, input.actionId);
        if (this.installation(row.installation_id).manifest.schemaVersion !== 2) throw new Error("Version-1 apps are research and draft only");
        return this.saveAction(row, claimAction(row, { ...input, ...this.actionContext(input.workspaceId, row, actor) }));
      }), { connectionId: input.connectionId }),
      settle: (input) => this.withState(input.workspaceId, true, () => transaction(this.db, () => {
        const row = this.actionRow(input.workspaceId, input.actionId, false);
        return this.saveAction(row, settleAction(row, input));
      }), { connectionId: input.connectionId }) });
  }

  scope(workspaceId, write = false) {
    const workspace = workspaceContext(this.db, workspaceId, write ? ["admin", "member"] : ["admin", "member", "viewer"]);
    this.db.prepare("INSERT OR IGNORE INTO app_portfolios (workspace_id) VALUES (?)").run(workspace.id);
    return { ...workspace, organizationId: workspace.membership.organizationId };
  }

  withState(workspaceId, write, operation, identity) {
    const workspace = this.scope(workspaceId, write);
    if (workspace.authority === 'local') return operation();
    if (!this.shared) throw new Error('Shared app storage is unavailable');
    return this.shared.run(workspace, write, operation, identity);
  }

  view(workspaceId, connectionId) { return this.withState(workspaceId, false, (actor) => ({ ...this.snapshot(workspaceId, actor), actorUserId: actor ?? currentIdentity(this.db).userId }), { connectionId }); }
  connectorFor(workspaceId, actor) {
    const connector = this.actionConnector; const userId = actor ?? currentIdentity(this.db).userId;
    return connector?.workspaceIds.includes(workspaceId) && connector.actorUserIds.includes(userId) ? connector : null;
  }

  executionContext(itemId) {
    const row = this.db.prepare(`SELECT p.workspace_id, w.account_user_id FROM work_items w JOIN processes p ON p.id=w.process_id
      JOIN app_process_owners a ON a.process_id=p.id WHERE w.id=?`).get(itemId);
    return row ? this.withState(row.workspace_id, true, () => this.context(itemId), { accountUserId: row.account_user_id ?? '' }) : null;
  }

  useApp(app, itemId, write, operation) {
    return this.withState(app.workspace_id, write, (actor) => {
      const current = this.context(itemId);
      if (!current || current.id !== app.id) throw new Error('App scope is no longer available');
      return operation({ ...current, actorUserId: actor ?? currentIdentity(this.db).userId });
    }, { accountUserId: app.accountUserId ?? '' });
  }

  installation(id) {
    const row = this.db.prepare("SELECT * FROM app_installations WHERE id = ?").get(id);
    if (!row) throw new Error("App installation not found");
    this.scope(row.workspace_id);
    return { ...row, manifest: JSON.parse(row.manifest), config: JSON.parse(row.config) };
  }

  /** Refuse at dispatch. Both states otherwise surface mid-run, once the run row and a failed attempt exist. */
  requireInstalledApp(processId) {
    const owned = this.db.prepare(`SELECT p.name, a.manifest, a.config FROM app_process_owners o JOIN processes p ON p.id=o.process_id
      LEFT JOIN app_installations a ON a.id=o.installation_id WHERE o.process_id=?`).get(processId);
    if (!owned) return;
    if (!owned.manifest) throw new Error(`${owned.name} is not installed on this computer any more, so this work cannot start. Open Apps to install it again.`);
    try { appConfig(JSON.parse(owned.manifest), JSON.parse(owned.config)); }
    catch ({ message }) { throw new Error(`${owned.name} still needs setup, so this work cannot start. Open Apps and finish setting it up: ${message}`); }
  }

  ownsProcess(processId) {
    return Boolean(this.db.prepare("SELECT 1 FROM app_process_owners WHERE process_id=?").get(processId));
  }

  snapshot(workspaceId, actor) {
    this.scope(workspaceId);
    this.expire();
    const apps = this.db.prepare("SELECT * FROM app_installations WHERE workspace_id = ? ORDER BY created_at").all(workspaceId)
      .map((row) => {
        const app = { ...row, manifest: JSON.parse(row.manifest), config: JSON.parse(row.config), needsSetup: false };
        try { appConfig(app.manifest, app.config); } catch { app.needsSetup = true; }
        return app;
      });
    const records = this.db.prepare(`SELECT r.* FROM app_records r JOIN app_installations a ON a.id=r.installation_id WHERE a.workspace_id=? ORDER BY r.updated_at DESC LIMIT 200`).all(workspaceId)
      .map(recordRow);
    const recordCounts = this.db.prepare(`SELECT r.installation_id,r.kind,COUNT(*) AS n FROM app_records r JOIN app_installations a ON a.id=r.installation_id WHERE a.workspace_id=? GROUP BY r.installation_id,r.kind`).all(workspaceId);
    const actions = this.db.prepare(`SELECT x.* FROM app_actions x JOIN app_installations a ON a.id=x.installation_id WHERE a.workspace_id=? AND (x.status IN ('draft','approved','executing','unknown') OR x.id IN (SELECT y.id FROM app_actions y JOIN app_installations b ON b.id=y.installation_id WHERE b.workspace_id=? AND y.status NOT IN ('draft','approved','executing','unknown') ORDER BY y.created_at DESC LIMIT 100)) ORDER BY CASE WHEN x.status IN ('draft','approved','executing','unknown') THEN 0 ELSE 1 END,x.created_at DESC`).all(workspaceId, workspaceId)
      .map((r) => ({ ...r, payload: JSON.parse(r.payload), execution: JSON.parse(r.execution) }));
    const connector = this.connectorFor(workspaceId, actor);
    return { apps, records, recordCounts, actions, portfolio: { ...this.db.prepare("SELECT * FROM app_portfolios WHERE workspace_id=?").get(workspaceId), runsLeft: this.runsLeft(workspaceId) },
      reservedCents: this.reserved(workspaceId), sendingEnabled: Boolean(connector), connectors: connector ? [{ id: connector.id, account: connector.account }] : [], modelCost: null };
  }

  async install(workspaceId, input) {
    this.scope(workspaceId, true);
    const manifest = validateApp(input.manifest);
    const config = appConfig(manifest, input.config ?? {}, true);
    const key = `${workspaceId}:${manifest.id}`;
    if (this.installing.has(key)) throw new Error("This app is already installing");
    let row = this.db.prepare("SELECT * FROM app_installations WHERE workspace_id=? AND package_id=?").get(workspaceId, manifest.id);
    if (row?.status === "active") {
      if (row.digest !== hash(manifest)) throw new Error("Remove the installed version before upgrading. Existing work and data are preserved.");
      return { id: row.id, reused: true };
    }
    if (row?.status === "installing" && row.digest !== hash(manifest)) throw new Error("Retry the same package to repair partial installation");
    this.installing.add(key);
    try {
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
        this.db.prepare('INSERT OR IGNORE INTO app_agent_owners VALUES (?,?)').run(agent.id, row.id);
        this.db.prepare("UPDATE app_installations SET agent_ids=? WHERE id=?").run(JSON.stringify(ids), row.id);
      }
      let processId = row.process_id;
      if (!processId) {
        const process = await this.product.command({ action: "create_process", workspaceId, name: `${manifest.name} · ${manifest.version}`,
          description: manifest.description, stages: APP_STAGES });
        processId = process.id;
        this.db.prepare("UPDATE app_installations SET process_id=? WHERE id=?").run(processId, row.id);
      }
      this.db.prepare("INSERT OR IGNORE INTO app_process_owners VALUES (?,?)").run(processId, row.id);
      const stages = this.db.prepare("SELECT id FROM stages WHERE process_id=? ORDER BY position").all(processId);
      for (let i = 0; i < 2; i++) await this.product.command({ action: "set_stage_route", stageId: stages[i].id, agentIds: [ids[i]] });
      this.db.prepare("UPDATE app_installations SET status='active' WHERE id=?").run(row.id);
      return { id: row.id, processId, agentIds: ids, schedulesCreated: 0 };
    } catch (error) { error.appPartialInstall = true; throw error; }
    finally { this.installing.delete(key); }
  }

  async command(input) {
    let prepared = { ...input };
    if (input.action === "execute_action") return this.dispatcher.dispatch(prepared);
    if (['install', 'update'].includes(input.action) && this.catalog) {
      prepared.manifest = await this.catalog.resolve(input.appId, input.version, input.checksum);
      prepared.config = {};
    }
    if (input.action === 'run') {
      // Do not hold the shared-state queue while native execution begins and requests admission.
      await this.withState(input.workspaceId, false, (_userId, connectionId) => {
        this.installation(input.installationId); prepared.connectionId = connectionId;
      }, { connectionId: input.connectionId });
      return this.localCommand(prepared);
    }
    const write = !["query_records", "receipt", "export_records", "preview_import"].includes(input.action);
    return this.withState(input.workspaceId, write, (actorUserId) => this.localCommand({ ...prepared, actorUserId }), { connectionId: input.connectionId });
  }

  async localCommand(input) {
    const { workspaceId, action } = input;
    this.scope(workspaceId, !["query_records", "receipt", "export_records", "preview_import"].includes(action));
    if (action === "install") return this.install(workspaceId, input);
    if (action === 'repair') {
      const app = this.installation(input.installationId);
      if (app.workspace_id !== workspaceId) throw new Error('App belongs to another workspace');
      return this.install(workspaceId, { manifest: app.manifest, config: app.config });
    }
    if (action === "portfolio") {
      const workspace = this.scope(workspaceId, true);
      if (workspace.membership.role !== "admin") throw new Error("Only a team admin can change app limits");
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
    if (["set_approver", "clear_approver"].includes(action)) {
      const workspace = this.scope(workspaceId, true); const actor = input.actorUserId ?? currentIdentity(this.db).userId;
      const prior = this.db.prepare("SELECT approver_user_id FROM app_portfolios WHERE workspace_id=?").get(workspaceId).approver_user_id;
      if (workspace.membership.role !== "admin" || prior && prior !== actor) throw new Error("Only the current approver with team admin access can change this policy");
      transaction(this.db, () => {
        this.db.prepare("UPDATE app_portfolios SET approver_user_id=? WHERE workspace_id=?").run(action === "set_approver" ? actor : null, workspaceId);
        this.db.prepare("UPDATE app_actions SET status='cancelled' WHERE status='approved' AND installation_id IN (SELECT id FROM app_installations WHERE workspace_id=?)").run(workspaceId);
      });
      return { approverUserId: action === "set_approver" ? actor : null };
    }
    if (action === "reconcile_action") {
      const row = this.actionRow(workspaceId, input.actionId, false);
      return this.saveAction(row, reconcileAction(row, { ...input, ...this.actionContext(workspaceId, row, input.actorUserId), at: iso() }));
    }
    if (action === "mark_unknown") {
      const row = this.actionRow(workspaceId, input.actionId, false); const execution = JSON.parse(row.execution);
      const context = this.actionContext(workspaceId, row, input.actorUserId);
      if (!context.approverUserId || context.actorUserId !== context.approverUserId || context.actorUserId !== execution.claimedBy) throw new Error("Only this attempt's designated approver can mark it unresolved");
      if (Date.now() - Date.parse(execution.claimedAt) < 60_000) throw new Error("Allow the connector one minute to finish before marking it unresolved");
      return this.saveAction(row, settleAction(row, { attemptId: input.attemptId, at: iso(), result: { outcome: "unknown", reason: "Operator marked an interrupted attempt unresolved. Reconcile before any new action; this does not retry." } }));
    }
    const app = this.installation(input.installationId);
    if (app.workspace_id !== workspaceId) throw new Error("App belongs to another workspace");
    if (action === "query_records") return this.queryRecords(app, input, true);
    if (action === "receipt") return this.receipt(app, input.receiptId);
    if (action === "export_records") {
      const page = this.queryRecords(app, input, true);
      return { schemaVersion: 1, packageId: app.package_id, exportedAt: iso(), nextOffset: page.nextOffset,
        records: page.records.map((record) => ({ key: record.record_key, kind: record.kind, title: record.title, body: record.body, data: record.data })) };
    }
    if (["preview_import", "import_records"].includes(action)) {
      if (app.status !== "active") throw new Error("App is not active");
      const preview = this.previewImport(app, input.records);
      if (action === "preview_import") return preview;
      if (input.previewDigest !== preview.digest) throw new Error("Import data or existing records changed; preview again");
      transaction(this.db, () => {
        for (const record of preview.records) this.record(app, "", record, "user-import");
      });
      return { imported: preview.records.length };
    }
    if (action === "edit_record") {
      if (app.status !== "active") throw new Error("App is not active");
      const prior = this.db.prepare("SELECT * FROM app_records WHERE installation_id=? AND record_key=?").get(app.id, input.record?.key);
      if (!prior || hash(prior) !== input.digest) throw new Error("Record changed; refresh before editing");
      return this.record(app, prior.item_id, { ...input.record, evidenceIds: JSON.parse(prior.evidence) }, "user");
    }
    if (action === 'update') {
      const manifest = validateApp(input.manifest);
      if (manifest.id !== app.package_id || app.status !== 'active') throw new Error('Choose an update for this installed app');
      if (hash(manifest) === app.digest) return { id: app.id, reused: true };
      if (this.db.prepare("SELECT 1 FROM app_actions WHERE installation_id=? AND status='executing'").get(app.id)) throw new Error("Resolve in-flight actions before updating this app");
      const agentIds = JSON.parse(app.agent_ids);
      if (!app.process_id || agentIds.length < 2) throw new Error("This installation is incomplete; repair it before updating");
      // Rewrite the process and agents in place: rebuilding them would leave this app's schedules and work items on the archived process.
      const config = appConfig(manifest, Object.fromEntries(manifest.inputs.filter((field) => field.key in app.config).map((field) => [field.key, app.config[field.key]])), true);
      await this.product.command({ action: "edit_process", processId: app.process_id, name: `${manifest.name} · ${manifest.version}`, description: manifest.description, stages: APP_STAGES });
      for (const [index, id] of agentIds.entries()) await this.product.command({ action: "edit_agent_assignment", agentAssignmentId: id,
        name: `${manifest.name} ${index ? "reviewer" : "worker"} · ${app.id.slice(0, 8)} · ${manifest.version}`, instructions: index ? manifest.review : manifest.task });
      // Last, so a failure above leaves the old version installed and a retry simply repeats it.
      transaction(this.db, () => {
        this.db.prepare("UPDATE app_installations SET version=?,digest=?,manifest=?,config=? WHERE id=?")
          .run(manifest.version, hash(manifest), JSON.stringify(manifest), JSON.stringify(config), app.id);
        this.db.prepare("UPDATE app_actions SET status='cancelled' WHERE installation_id=? AND status IN ('draft','approved')").run(app.id);
      });
      return { id: app.id, processId: app.process_id, agentIds };
    }
    if (action === "remove") {
      if (this.db.prepare("SELECT 1 FROM app_actions WHERE installation_id=? AND status='executing'").get(app.id)) throw new Error("Resolve in-flight actions before removing this app; uncertain history will be retained");
      // removing the app is the ask to stop it, so its own schedules pause instead of blocking the removal
      for (const { id } of app.process_id ? this.db.prepare("SELECT id FROM recurring_work WHERE process_id=? AND status='active'").all(app.process_id) : [])
        await this.product.command({ action: "pause_recurring_work", recurringWorkId: id });
      if (app.process_id) await this.product.command({ action: "archive_process", processId: app.process_id });
      this.db.prepare("UPDATE app_installations SET status='removed' WHERE id=?").run(app.id);
      this.db.prepare("UPDATE app_actions SET status='cancelled' WHERE installation_id=? AND status IN ('draft','approved')").run(app.id);
      return { retainedData: true };
    }
    if (app.status !== "active") throw new Error("App is not active");
    if (action === "configure") {
      appConfig(app.manifest, input.config, true); // rejects a non-object, which would merge to a silent no-op
      // appConfig blanks every key the caller leaves out, so a partial save merges over the stored config
      this.db.prepare("UPDATE app_installations SET config=? WHERE id=?").run(JSON.stringify(appConfig(app.manifest, { ...app.config, ...input.config })), app.id);
      return {};
    }
    if (action === "run") {
      appConfig(app.manifest, app.config);
      if (this.runsLeft(workspaceId) <= 0) throw new Error(runLimitReached);
      // Native work and recurrence retain the same process. Runtime admission also checks limits.
      // the agent gets the task as its instructions and the config from bees_app_read, so the description stays readable
      return this.product.command({ action: "create_item", processId: app.process_id, title: app.manifest.name,
        connectionId: input.connectionId, description: app.manifest.description,
        runSettings: { mcpAccess: "none", mcpServers: [] } });
    }
    throw new Error("Unsupported app operation");
  }

  runsLeft(workspaceId) {
    return this.db.prepare("SELECT max_runs FROM app_portfolios WHERE workspace_id=?").get(workspaceId).max_runs
      - this.db.prepare(`SELECT COUNT(*) AS n FROM app_admissions r JOIN app_installations a ON a.id=r.installation_id WHERE a.workspace_id=? AND r.day=?`).get(workspaceId, iso().slice(0, 10)).n;
  }

  context(itemId) {
    const row = this.db.prepare(`SELECT p.installation_id AS id, p.process_id, w.account_user_id FROM app_process_owners p JOIN work_items w ON w.process_id=p.process_id WHERE w.id=?`).get(itemId);
    if (!row) return null;
    const app = this.installation(row.id);
    if (app.status !== "active") throw new Error("App is not active");
    if (app.process_id !== row.process_id) throw new Error("This process belongs to an older app version; start new work from Apps");
    appConfig(app.manifest, app.config);
    const day = iso().slice(0, 10);
    transaction(this.db, () => {
      if (this.db.prepare("SELECT 1 FROM app_admissions WHERE item_id=?").get(itemId)) return;
      if (this.runsLeft(app.workspace_id) <= 0) throw new Error(runLimitReached);
      this.db.prepare("INSERT INTO app_admissions VALUES (?,?,?,?)").run(itemId, app.id, day, JSON.stringify(app.config));
    });
    return { ...app, accountUserId: row.account_user_id, config: JSON.parse(this.db.prepare("SELECT config FROM app_admissions WHERE item_id=?").get(itemId).config) };
  }

  read(app) {
    const view = this.snapshot(app.workspace_id, app.actorUserId);
    const page = this.queryRecords(app);
    return { configuration: app.config, sources: app.manifest.sources, portfolio: view.portfolio,
      recordTypes: app.manifest.recordTypes ?? [], records: page.records, totalRecords: page.total, nextOffset: page.nextOffset,
      actions: view.actions.filter((r) => r.installation_id === app.id || app.manifest.permissions.includes("portfolio-read")),
      evidence: this.db.prepare("SELECT * FROM app_sources WHERE installation_id=? ORDER BY created_at DESC LIMIT 60").all(app.id).map((r) => ({ ...r, result: JSON.parse(r.result) })),
      sendingEnabled: app.manifest.schemaVersion === 2 && view.sendingEnabled, connectors: app.manifest.schemaVersion === 2 ? view.connectors : [], modelCost: null };
  }

  queryRecords(app, input = {}, ownOnly = false) {
    const limit = input.limit ?? 50; const offset = input.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error("Invalid record page");
    const portfolio = !ownOnly && app.manifest.permissions.includes("portfolio-read");
    const clauses = [portfolio ? "a.workspace_id=?" : "r.installation_id=?"];
    const values = [portfolio ? app.workspace_id : app.id];
    for (const [field, column, max] of [["kind", "kind", 50], ["key", "record_key", 1000]]) {
      if (input[field] === undefined || input[field] === "") continue;
      clauses.push(`r.${column}=?`); values.push(bounded(input[field], field, max));
    }
    if (input.query) {
      const query = bounded(input.query, "record search", 1000).replace(/[\\%_]/g, "\\$&");
      clauses.push("(r.title LIKE ? ESCAPE '\\' OR r.body LIKE ? ESCAPE '\\' OR r.data LIKE ? ESCAPE '\\')");
      values.push(...Array(3).fill(`%${query}%`));
    }
    const from = `FROM app_records r JOIN app_installations a ON a.id=r.installation_id WHERE ${clauses.join(" AND ")}`;
    const total = this.db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...values).n;
    const records = this.db.prepare(`SELECT r.* ${from} ORDER BY r.updated_at DESC,r.id LIMIT ? OFFSET ?`).all(...values, limit, offset)
      .map((row) => ({ ...recordRow(row), digest: hash(row) }));
    return { records, total, offset, limit, nextOffset: offset + records.length < total ? offset + records.length : null };
  }

  receipt(app, id) {
    const row = this.db.prepare(`SELECT s.* FROM app_sources s JOIN app_installations a ON a.id=s.installation_id WHERE s.id=? AND ${app.manifest.permissions.includes("portfolio-read") ? "a.workspace_id=?" : "s.installation_id=?"}`)
      .get(bounded(id, "receipt ID", 100), app.manifest.permissions.includes("portfolio-read") ? app.workspace_id : app.id);
    if (!row) throw new Error("Source receipt is not available to this app");
    return { ...row, result: JSON.parse(row.result) };
  }

  previewImport(app, rows) {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 200 || JSON.stringify(rows).length > 1_000_000) throw new Error("Import 1–200 records, maximum 1 MB");
    const records = rows.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some((key) => !["key", "kind", "title", "body", "data"].includes(key)))
        throw new Error("Import only record content; evidence, approvals and delivery state cannot be imported");
      return this.recordInput(app, row);
    });
    if (new Set(records.map((record) => record.key)).size !== records.length) throw new Error("Duplicate import keys");
    const existing = records.map((record) => this.db.prepare("SELECT * FROM app_records WHERE installation_id=? AND record_key=?").get(app.id, record.key) ?? null);
    return { records, creates: existing.filter((row) => !row).length, updates: existing.filter(Boolean).length,
      digest: hash({ installation: app.id, manifest: app.digest, records, existing }), provenance: "user-import", approvalsImported: 0, sent: false };
  }

  recordInput(app, input) {
    const key = bounded(input.key, "record key", 1000); const kind = bounded(input.kind, "record kind", 50);
    return { key, kind, title: bounded(input.title, "title", 200), body: bounded(input.body, "record body"), data: appRecordData(app.manifest, kind, input.data) };
  }

  async source(app, itemId, key, query, signal) {
    const source = app.manifest.sources.find((s) => s.key === key);
    if (!source) throw new Error("Source is not declared by this app");
    publicSourceUrl(source, query); // a malformed or out-of-scope query fails here, before it spends one of the 20 requests
    const id = randomUUID();
    await this.useApp(app, itemId, true, () => transaction(this.db, () => {
      if (this.db.prepare("SELECT COUNT(*) AS n FROM app_sources WHERE item_id=?").get(itemId).n >= 20) throw new Error("This work item reached its 20-request limit");
      this.db.prepare("INSERT INTO app_sources VALUES (?,?,?,?,?,?)").run(id, app.id, itemId, key, JSON.stringify({ status: "requested" }), iso());
    }));
    try {
      const result = await this.readSource(source, query, signal);
      await this.useApp(app, itemId, true, () => this.db.prepare("UPDATE app_sources SET result=? WHERE id=?").run(JSON.stringify(result), id));
      return { id, ...result };
    } catch (error) {
      try { await this.useApp(app, itemId, true, () => this.db.prepare("UPDATE app_sources SET result=? WHERE id=?").run(JSON.stringify({ error: String(error.message) }), id)); } catch { /* The reserved receipt remains durable if a second write conflicts. */ }
      throw error;
    }
  }

  record(app, itemId, input, provenance = "agent") {
    const { key, kind, title, body, data } = this.recordInput(app, input);
    const evidence = input.evidenceIds ?? [];
    if (!Array.isArray(evidence) || evidence.length > 20) throw new Error("Invalid evidence IDs");
    for (const id of evidence) if (!this.db.prepare("SELECT 1 FROM app_sources WHERE id=? AND installation_id=?").get(id, app.id)) throw new Error("Evidence belongs to another app or does not exist");
    const prior = this.db.prepare("SELECT id, kind FROM app_records WHERE installation_id=? AND record_key=?").get(app.id, key);
    // one key per record: an upsert under another kind would silently erase the earlier record
    if (prior && prior.kind !== kind) throw new Error(`Record key "${key}" already holds a ${prior.kind} record; use a different key`);
    const id = prior?.id ?? randomUUID();
    this.db.prepare(`INSERT INTO app_records (id,installation_id,record_key,kind,title,body,evidence,item_id,updated_at,data,provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(installation_id,record_key) DO UPDATE SET kind=excluded.kind,title=excluded.title,body=excluded.body,evidence=excluded.evidence,item_id=excluded.item_id,updated_at=excluded.updated_at,data=excluded.data,provenance=excluded.provenance`)
      .run(id, app.id, key, kind, title, body, JSON.stringify(evidence), itemId, iso(), JSON.stringify(data), provenance);
    return { id, updated: Boolean(prior) };
  }

  draft(app, itemId, input) {
    if (!app.manifest.permissions.includes("draft-actions")) throw new Error("This app cannot prepare external actions");
    const payload = { destination: bounded(input.destination, "destination", 1000), account: bounded(input.account, "account", 200),
      content: bounded(input.content, "content"), rationale: bounded(input.rationale, "rationale", 2000), costCents: amount(input.costCents ?? 0) };
    if (input.connectorId !== undefined) {
      if (app.manifest.schemaVersion !== 2) throw new Error("Version-1 apps are research and draft only");
      const connector = this.connectorFor(app.workspace_id, app.actorUserId);
      if (!connector || input.connectorId !== connector.id || payload.account !== connector.account) throw new Error("No connector is configured for this workspace, actor and account");
      payload.connectorId = input.connectorId;
    }
    const id = randomUUID();
    this.expire();
    if (this.db.prepare("SELECT 1 FROM app_suppressions WHERE workspace_id=? AND destination=?").get(app.workspace_id, payload.destination.toLowerCase()))
      throw new Error("Destination is suppressed");
    const existing = this.db.prepare("SELECT id FROM app_actions WHERE installation_id=? AND digest=? AND status IN ('draft','approved')").get(app.id, hash(payload));
    if (existing) return { id: existing.id, reused: true };
    if (this.db.prepare(`SELECT 1 FROM app_actions x JOIN app_installations a ON a.id=x.installation_id WHERE a.workspace_id=? AND lower(json_extract(x.payload,'$.destination'))=? AND x.status IN ('draft','approved','executing','unknown')`).get(app.workspace_id, payload.destination.toLowerCase()))
      throw new Error("This destination already has an active action in the portfolio");
    const count = this.db.prepare(`SELECT COUNT(*) AS n FROM app_actions x JOIN app_installations a ON a.id=x.installation_id WHERE a.workspace_id=? AND x.status='draft'`).get(app.workspace_id).n;
    if (count >= 5) throw new Error("Five drafts already await review; finish the approval backlog first");
    this.db.prepare("INSERT INTO app_actions (id,installation_id,item_id,payload,digest,status,cost_cents,created_at) VALUES (?,?,?,?,?,'draft',?,?)")
      .run(id, app.id, itemId, JSON.stringify(payload), hash(payload), payload.costCents, iso());
    return { id, status: "draft", sent: false };
  }

  expire() { this.db.prepare("UPDATE app_actions SET status='expired' WHERE status='approved' AND expires_at <= ?").run(iso()); }
  reserved(workspaceId) {
    return this.db.prepare(`SELECT COALESCE(SUM(x.cost_cents),0) AS total FROM app_actions x JOIN app_installations a ON a.id=x.installation_id WHERE a.workspace_id=? AND x.status IN (${ACTION_RESERVED_STATUSES.map(() => "?").join(",")})`).get(workspaceId, ...ACTION_RESERVED_STATUSES).total;
  }
  actionRow(workspaceId, id, requireActive = true) {
    const row = this.db.prepare(`SELECT x.* FROM app_actions x JOIN app_installations a ON a.id=x.installation_id WHERE x.id=? AND a.workspace_id=? ${requireActive ? "AND a.status='active'" : ""}`).get(id, workspaceId);
    if (!row) throw new Error("Action is not available in this workspace");
    return row;
  }
  actionContext(workspaceId, row, actor) {
    const portfolio = this.db.prepare("SELECT * FROM app_portfolios WHERE workspace_id=?").get(workspaceId);
    return { actorUserId: actor ?? currentIdentity(this.db).userId, approverUserId: portfolio.approver_user_id,
      suppressed: Boolean(this.db.prepare("SELECT 1 FROM app_suppressions WHERE workspace_id=? AND destination=?").get(workspaceId, JSON.parse(row.payload).destination.toLowerCase())),
      capCents: portfolio.cap_cents, reservedCents: this.reserved(workspaceId) };
  }
  saveAction(row, patch) {
    const entries = Object.entries(patch);
    const allowed = ["status", "reviewed_digest", "execution", "decided_by", "decided_at", "expires_at"];
    if (entries.some(([key]) => !allowed.includes(key))) throw new Error("Invalid action change");
    this.db.prepare(`UPDATE app_actions SET ${entries.map(([key]) => `${key}=?`).join(",")} WHERE id=?`)
      .run(...entries.map(([key, value]) => key === "execution" ? JSON.stringify(value) : value), row.id);
    return { ...row, ...patch };
  }
  reviewDraft(app, itemId, input) {
    const row = this.actionRow(app.workspace_id, input.actionId);
    if (row.installation_id !== app.id || row.item_id !== itemId) throw new Error("Reviewer can only review this app work item's actions");
    const context = this.actionContext(app.workspace_id, row, app.actorUserId);
    if (!context.approverUserId || context.actorUserId !== context.approverUserId) throw new Error("Configure the designated approver and run review under that account first");
    const patch = reviewAction(row, input);
    if (input.decision === "revise") patch.status = "cancelled";
    return this.saveAction(row, patch);
  }
  decide(workspaceId, input) {
    return transaction(this.db, () => {
      this.expire();
      const row = this.actionRow(workspaceId, input.actionId);
      this.saveAction(row, decideAction(row, { ...input, ...this.actionContext(workspaceId, row, input.actorUserId), at: iso() }));
      return { id: row.id, sent: false, note: this.actionConnector ? "Decision saved; execution is a separate action." : "Decision saved. No sending or paid execution connector is configured." };
    });
  }
}
