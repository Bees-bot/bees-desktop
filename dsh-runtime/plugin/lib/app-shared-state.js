import { randomUUID } from 'node:crypto';
import { transaction } from './product-database.js';
import { applyTeamRecords, teamRecords } from './team-sync.js';
import { validateApp } from './app-contract.js';

const tables = ['app_installations','app_records','app_sources','app_actions','app_portfolios','app_admissions','app_process_owners','app_agent_owners','app_suppressions'];
const shared = new Set(['agent', 'team_process']);
const scoped = new Set(['app_installations', 'app_portfolios', 'app_suppressions']);
const json = (value) => { try { JSON.parse(value); return typeof value === 'string'; } catch { return false; } };

// ponytail: revisioned workspace snapshots keep the two stores compatible. At 16 MB,
// split source receipts/history into paged storage instead of increasing the payload indefinitely.
export class AppSharedState {
  constructor(platform, connected) { this.platform = platform; this.db = platform.db; this.connected = connected; this.queues = new Map(); }

  export(workspace) {
    const result = {};
    for (const table of tables) result[table] = this.db.prepare(`SELECT * FROM ${table} WHERE ${scoped.has(table)
      ? 'workspace_id=?' : 'installation_id IN (SELECT id FROM app_installations WHERE workspace_id=?)'}`).all(workspace.id)
      .map(({ workspace_id, ...row }) => row);
    const ids = new Set(result.app_installations.map((row) => row.id));
    const nativeRecords = teamRecords(this.db, workspace.organizationId, '', true)
      .filter((r) => ids.has(r.payload.appInstallationId) && shared.has(r.recordType));
    return { tables: result, nativeRecords };
  }

  import(workspace, state) {
    // A team the server has never held app state for reads back null, and importing that wipes every local install.
    if (state == null) return;
    const source = state.tables ?? {};
    const installs = source.app_installations;
    if (!Array.isArray(installs)) throw new Error('Invalid shared app state');
    const ids = new Set(installs.map((row) => row.id));
    if (ids.size !== installs.length) throw new Error('Duplicate shared installation');
    for (const row of installs) {
      validateApp(JSON.parse(row.manifest));
      const existing = this.db.prepare('SELECT workspace_id FROM app_installations WHERE id=?').get(row.id);
      if (existing && existing.workspace_id !== workspace.id) throw new Error('Shared app belongs to another workspace');
    }
    if (state.nativeRecords) applyTeamRecords(this.db, workspace.organizationId,
      state.nativeRecords.filter((r) => shared.has(r.recordType) && ids.has(r.payload?.appInstallationId)), true);
    transaction(this.db, () => {
      for (const table of [...tables].reverse()) {
        if (table.endsWith('_owners')) continue; // Retain revocation markers even for failed/removed installs.
        this.db.prepare(`DELETE FROM ${table} WHERE ${scoped.has(table) ? 'workspace_id=?' : 'installation_id IN (SELECT id FROM app_installations WHERE workspace_id=?)'}`).run(workspace.id);
      }
      for (const table of tables) {
        if (!Array.isArray(source[table])) throw new Error('Invalid shared app table');
        const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
        const insert = this.db.prepare(`INSERT ${table.endsWith('_owners') ? 'OR IGNORE ' : ''}INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
        for (const raw of source[table]) {
          if (!raw || Object.entries(raw).some(([key, value]) => !columns.includes(key) || key === 'workspace_id' || (['agent_ids','manifest','config','data','evidence','payload','execution','result'].includes(key) && value != null && !json(value)))) throw new Error('Invalid shared app row');
          if (!scoped.has(table) && !ids.has(raw.installation_id)) throw new Error('Shared app row is outside its installation');
          const row = scoped.has(table) ? { ...raw, workspace_id: workspace.id } : raw;
          // The server is authoritative, including legacy absence. Never retain rejected local mutations on rollback.
          const defaults = { data: '{}', provenance: 'agent', execution: '{}', reviewed_digest: null, approver_user_id: null };
          insert.run(...columns.map((key) => Object.hasOwn(row, key) ? row[key] : defaults[key] ?? null));
        }
      }
    });
  }

  run(workspace, write, operation, identity) {
    if (workspace.authority === 'local') return operation();
    const previous = this.queues.get(workspace.id) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const connection = this.connected.appConnection(workspace.teamId, identity);
      const request = (method, body) => this.connected.request(`/api/teams/${workspace.teamId}/apps/state`, {
        method, body, organizationId: workspace.organizationId, connectionId: connection.id
      });
      let current;
      try { current = await request('GET'); }
      catch (error) { throw new Error(error.status === 404 ? 'This workspace server needs the app-platform update.' : `Shared apps unavailable: ${error.message}`); }
      this.import(workspace, current.state);
      let result;
      try {
        result = await operation(current.userId, connection.id);
        if (write) await request('PUT', { revision: current.revision, operationId: randomUUID(), state: this.export(workspace) });
      } catch (error) {
        if (error.appPartialInstall && write) {
          let saved = false;
          try {
            await request('PUT', { revision: current.revision, operationId: randomUUID(), state: this.export(workspace) });
            saved = true;
          } catch { /* Restore the last authoritative snapshot below. */ }
          if (saved) throw error;
        }
        // Never treat a failed or conflicting server write as a successful local decision.
        this.import(workspace, current.state);
        throw error;
      }
      return result;
    });
    this.queues.set(workspace.id, pending);
    void pending.finally(() => { if (this.queues.get(workspace.id) === pending) this.queues.delete(workspace.id); }).catch(() => {});
    return pending;
  }
}
