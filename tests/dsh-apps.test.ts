import { createRequire } from "node:module";
import { randomUUID } from 'node:crypto';
import { applyTeamRecords, teamRecords } from '../dsh-runtime/plugin/lib/team-sync.js';
import { afterEach, expect, it, vi } from "vitest";
import { BeesProduct } from "../dsh-runtime/plugin/lib/product.js";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { NodeDatabase } from "./node-database.js";
// @ts-expect-error Plain JS app boundary.
import { AppPlatform } from "../dsh-runtime/plugin/lib/app-platform.js";
// @ts-expect-error Plain JS app contract.
import { validateApp, appRecordData, appToolDenial } from "../dsh-runtime/plugin/lib/app-contract.js";
// @ts-expect-error Plain JS source boundary.
import { publicIPv4, publicSourceUrl } from "../dsh-runtime/plugin/lib/app-source.js";
// @ts-expect-error Plain JS tool boundary.
import { mountAppTools } from "../dsh-runtime/plugin/lib/app-tools.js";
// @ts-expect-error Plain JS client module.
import { AppsPage } from "../dsh-runtime/plugin/client/apps.js";
// @ts-expect-error Plain JS client runtime.
import { configureRuntime } from "../dsh-runtime/plugin/client/runtime.js";

const manifest = {
  schemaVersion: 1, id: "example-app", version: "0.1.0", name: "Example app", description: "An unrelated research app",
  author: "Test", license: "UNLICENSED", permissions: ["public-sources", "draft-actions"],
  inputs: [{ key: "topic", label: "Topic", required: true }],
  sources: [{ key: "public-feed", label: "Public source", url: "https://example.com/feed", queryParam: "q" }],
  task: "Research a topic, save an app record.", review: "Verify the actual source evidence."
};
const databases: any[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of databases.splice(0)) db.close(); });
function setup(connected?: any, connector?: any) {
  const db = new NodeDatabase().connection;
  databases.push(db);
  const runtime: any = new AgentRuntime({ on: () => () => undefined, tools: { schemas: () => [] },
    agentPresets: { defaultId: "standard", mount: async () => undefined } }, db);
  const processes = { isAutomatic: () => true, startItem: vi.fn(async () => ({ status: "started" })) };
  const product = new BeesProduct(db, runtime, processes, "/tmp/bees-app-tests");
  const fetcher = vi.fn(async () => ({ url: "https://example.com/feed?q=help", observedAt: "2026-09-08T00:00:00Z", content: "Public request for help" }));
  const workspaceId = (db.prepare("SELECT id FROM workspaces LIMIT 1").get() as any).id;
  const userId = (db.prepare("SELECT id FROM users LIMIT 1").get() as any).id;
  const apps = new AppPlatform(product, fetcher, { connected, actionConnector: connector?.({ workspaceId, userId }) ?? null });
  runtime.apps = apps;
  const install = (m = manifest, scope = workspaceId) => apps.install(scope, { manifest: m, config: { topic: "Useful research" } });
  const run = (id: string) => apps.command({ action: "run", installationId: id, workspaceId });
  return { db, apps, runtime, product, processes, fetcher, workspaceId, install, run };
}

it('installs before configuration but cannot run until required setup is saved; updates rewrite the app in place', async () => {
  const s = setup();
  const first = await s.apps.command({ action: 'install', workspaceId: s.workspaceId, manifest });
  expect(s.apps.snapshot(s.workspaceId).apps[0].needsSetup).toBe(true);
  await expect(s.run(first.id)).rejects.toThrow('Topic');
  await s.apps.command({ action: 'configure', workspaceId: s.workspaceId, installationId: first.id, config: { topic: 'Configured' } });
  const work = await s.run(first.id); const app = s.apps.context(work.id);
  s.apps.record(app, work.id, { key: 'kept', kind: 'finding', title: 'Test', body: 'Keep me' });
  const update = () => s.apps.command({ action: 'update', workspaceId: s.workspaceId, installationId: first.id, manifest: { ...manifest, version: '0.2.0' } });
  await expect(update()).rejects.toThrow('active automatic work');
  s.db.prepare("UPDATE work_items SET runtime_phase='completed' WHERE id=?").run(work.id);
  const updated = await update(); expect(updated.id).toBe(first.id); expect(updated.processId).toBe(first.processId);
  expect(s.apps.snapshot(s.workspaceId).records).toHaveLength(1);
  expect(s.apps.installation(first.id).config.topic).toBe('Configured');
  expect(s.apps.installation(first.id).version).toBe('0.2.0');
  expect(s.apps.context(work.id).id).toBe(first.id);
});

const structuredManifest = { ...manifest, schemaVersion: 2,
  recordTypes: [{ key: 'ticket', label: 'Tickets', fields: [
    { key: 'status', label: 'Status', type: 'text', required: true },
    { key: 'count', label: 'Count', type: 'number' }, { key: 'enabled', label: 'Enabled', type: 'boolean' }
  ] }], sources: [...manifest.sources, { key: 'public-page', label: 'Public page', type: 'page', url: 'https://example.com', pathPrefix: '/docs/' }]
};

it('preserves v1 and validates generic v2 record schemas and bounded primitive values', () => {
  expect(validateApp(structuredManifest)).toEqual(structuredManifest);
  expect(appRecordData(structuredManifest, 'ticket', { status: 'new', count: 0, enabled: false })).toEqual({ status: 'new', count: 0, enabled: false });
  expect(appRecordData(manifest, 'finding')).toEqual({});
  for (const data of [{}, { status: '' }, { status: 'new', unknown: 1 }, { status: 'new', count: Infinity }, { status: 'new', enabled: 'yes' }, { status: 'x'.repeat(4001) }])
    expect(() => appRecordData(structuredManifest, 'ticket', data)).toThrow();
  expect(() => appRecordData(structuredManifest, 'unknown', {})).toThrow('not declared');
  expect(() => validateApp({ ...manifest, recordTypes: structuredManifest.recordTypes })).toThrow('Unknown app field');
  expect(() => validateApp({ ...structuredManifest, recordTypes: [{ ...structuredManifest.recordTypes[0], fields: [{ key: 'status', label: 'Status', type: 'code' }] }] })).toThrow();
});

it('restricts public page reads to declared exact paths or directories, without credentials or encoded escapes', () => {
  const page = structuredManifest.sources[1];
  expect(publicSourceUrl(page, 'https://example.com/docs/start?q=public').href).toBe('https://example.com/docs/start?q=public');
  for (const url of ['https://evil.example/docs/start', 'https://example.com/document', 'https://example.com/docs/../private', 'https://example.com/docs/%2fprivate', 'https://user@example.com/docs/a', 'https://example.com/docs/a?token=x', 'https://example.com/docs/a#secret'])
    expect(() => publicSourceUrl(page, url)).toThrow();
  const exact = { ...page, pathPrefix: '/item' };
  expect(publicSourceUrl(exact, 'https://example.com/item?id=42').pathname).toBe('/item');
  expect(() => publicSourceUrl(exact, 'https://example.com/item/other')).toThrow();
  expect(() => validateApp({ ...structuredManifest, sources: [{ ...page, pathPrefix: '/docs/../' }] })).toThrow();
  expect(publicSourceUrl(manifest.sources[0], 'a b').searchParams.get('q')).toBe('a b');
});

it('queries own records before pagination and retrieves older receipts with explicit portfolio access', async () => {
  const s = setup(); const first = await s.install(); const work = await s.run(first.id); const app = s.apps.context(work.id);
  const receipt = await s.apps.source(app, work.id, 'public-feed', 'help');
  s.apps.record(app, work.id, { key: 'kept', kind: 'finding', title: 'Own old record', body: 'Evidence', evidenceIds: [receipt.id] });
  const other = await s.install({ ...manifest, id: 'other-app' }); const otherWork = await s.run(other.id); const otherApp = s.apps.context(otherWork.id);
  for (let i = 0; i < 210; i++) s.apps.record(otherApp, otherWork.id, { key: `key-${i}`, kind: 'finding', title: `Other ${i}`, body: 'Unrelated' });
  expect(s.apps.read(app).records).toHaveLength(1);
  expect(s.apps.queryRecords(otherApp, { limit: 100 })).toMatchObject({ total: 210, nextOffset: 100 });
  expect(s.apps.queryRecords(otherApp, { offset: 200, limit: 100 })).toMatchObject({ total: 210, nextOffset: null, records: expect.any(Array) });
  expect(s.apps.queryRecords(otherApp, { key: 'key-123' }).records).toHaveLength(1);
  expect(() => s.apps.receipt(otherApp, receipt.id)).toThrow('not available');
  const reviewer = await s.install({ ...manifest, id: 'portfolio-review', permissions: ['portfolio-read'], sources: [] });
  const reviewWork = await s.run(reviewer.id); const reviewApp = s.apps.context(reviewWork.id);
  expect(s.apps.queryRecords(reviewApp).total).toBe(211);
  expect(s.apps.receipt(reviewApp, receipt.id).id).toBe(receipt.id);
  const ownExport = await s.apps.command({ action: 'export_records', workspaceId: s.workspaceId, installationId: reviewer.id });
  expect(ownExport.records).toHaveLength(0);
  for (const input of [{ limit: 101 }, { offset: -1 }, { limit: 1.5 }]) expect(() => s.apps.queryRecords(app, input)).toThrow();
});

it('previews imports without writes, prevents approval imports and detects stale import/edit previews', async () => {
  const s = setup(); const installed = await s.install(structuredManifest as any);
  const call = (action: string, input: any = {}) => s.apps.command({ action, workspaceId: s.workspaceId, installationId: installed.id, ...input });
  const records = [{ key: 'ticket-1', kind: 'ticket', title: 'Imported task', body: 'User notes; not independently verified', data: { status: 'new', count: 0 } }];
  const preview = await call('preview_import', { records });
  expect(preview).toMatchObject({ creates: 1, updates: 0, approvalsImported: 0, sent: false });
  expect((await call('query_records')).total).toBe(0);
  for (const patch of [{ status: 'approved' }, { evidenceIds: ['fake'] }, { decided_by: 'human' }, { execution: { receipt: 'fake' } }])
    await expect(call('preview_import', { records: [{ ...records[0], ...patch }] })).rejects.toThrow('cannot be imported');
  await call('import_records', { records, previewDigest: preview.digest });
  const saved = (await call('query_records')).records[0]; expect(saved.provenance).toBe('user-import'); expect(saved.evidence).toEqual([]);
  await expect(call('import_records', { records, previewDigest: preview.digest })).rejects.toThrow('preview again');
  const repeat = await call('preview_import', { records }); expect(repeat.updates).toBe(1);
  await call('import_records', { records, previewDigest: repeat.digest }); expect((await call('query_records')).total).toBe(1);
  const current = (await call('query_records')).records[0];
  await call('edit_record', { record: { ...records[0], data: { status: 'clarify' } }, digest: current.digest });
  await expect(call('edit_record', { record: records[0], digest: current.digest })).rejects.toThrow('changed');
  expect((await call('query_records')).records[0]).toMatchObject({ provenance: 'user', data: { status: 'clarify' } });
  expect((await call('export_records')).records).toEqual([{ ...records[0], data: { status: 'clarify' } }]);
  expect(s.apps.snapshot(s.workspaceId).actions).toHaveLength(0);
});

it('binds reviewer readiness to one app/item and lets revision create a new immutable draft', async () => {
  const s = setup(); const installed = await s.install(); const work = await s.run(installed.id); const app = s.apps.context(work.id);
  const input = { destination: 'https://example.com/contact', account: 'test', content: 'Test only', rationale: 'Synthetic fixture', costCents: 0 };
  const first = s.apps.draft(app, work.id, input); const row = s.apps.snapshot(s.workspaceId).actions[0];
  expect(() => s.apps.reviewDraft(app, work.id, { actionId: first.id, digest: row.digest, decision: 'pass' })).toThrow('designated approver');
  await s.apps.command({ action: 'set_approver', workspaceId: s.workspaceId });
  expect(() => s.apps.reviewDraft(app, 'wrong-work', { actionId: first.id, digest: row.digest, decision: 'pass' })).toThrow('work item');
  expect(() => s.apps.reviewDraft({ ...app, actorUserId: 'other-person' }, work.id, { actionId: first.id, digest: row.digest, decision: 'pass' })).toThrow('designated approver');
  s.apps.reviewDraft(app, work.id, { actionId: first.id, digest: row.digest, decision: 'revise' });
  expect(s.apps.draft(app, work.id, { ...input, content: 'Corrected fixture' }).id).not.toBe(first.id);
  expect(s.apps.snapshot(s.workspaceId).actions.find((action: any) => action.id === first.id).status).toBe('cancelled');
  expect(appToolDenial('bees_app_review_action')).toContain('not permitted');
  expect(appToolDenial('bees_app_review_action', true)).toBeUndefined();
});

it('requires admin opt-in for approver policy and ignores forged actor identities', async () => {
  const s = setup(); const actor = (s.db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get() as any).id;
  await s.apps.command({ action: 'set_approver', workspaceId: s.workspaceId, actorUserId: 'forged', approverUserId: 'forged' });
  expect(s.apps.snapshot(s.workspaceId).portfolio.approver_user_id).toBe(actor);
  s.db.prepare("UPDATE team_memberships SET role='member'").run();
  await expect(s.apps.command({ action: 'clear_approver', workspaceId: s.workspaceId })).rejects.toThrow('team admin');
  await expect(s.apps.command({ action: 'portfolio', workspaceId: s.workspaceId, capCents: 0, maxRuns: 1 })).rejects.toThrow('team admin');
  s.db.prepare("UPDATE team_memberships SET role='admin'").run();
  await s.apps.command({ action: 'clear_approver', workspaceId: s.workspaceId });
  expect(s.apps.snapshot(s.workspaceId).portfolio.approver_user_id).toBeNull();
  expect(() => setup(undefined, () => ({ id: 'unscoped', account: 'unsafe', send: () => {} }))).toThrow('explicit workspace and actor grants');
});

it('rolls back rejected approval metadata when authoritative legacy snapshots omit new columns', async () => {
  let state: any; let actor = '';
  const connected = { appConnection: () => ({ id: 'fixture' }), request: async (_path: string, input: any) => {
    if (input.method === 'GET') return { state: structuredClone(state), revision: 0, userId: actor };
    throw new Error('Rejected fixture write');
  } };
  const s = setup(connected); actor = (s.db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get() as any).id;
  const installed = await s.install(); const work = await s.run(installed.id); const app = s.apps.context(work.id);
  const draft = s.apps.draft(app, work.id, { destination: 'https://example.com/test', account: 'test', content: 'Synthetic draft', rationale: 'Regression fixture', costCents: 0 });
  const digest = s.apps.snapshot(s.workspaceId).actions[0].digest;
  const workspace = { ...s.apps.scope(s.workspaceId), authority: 'connected' };
  state = s.apps.shared.export(workspace); state.nativeRecords = [];
  delete state.tables.app_portfolios[0].approver_user_id;
  for (const action of state.tables.app_actions) { delete action.reviewed_digest; delete action.execution; }
  await expect(s.apps.shared.run(workspace, true, () => s.apps.localCommand({ action: 'set_approver', workspaceId: s.workspaceId, actorUserId: actor }))).rejects.toThrow('Rejected fixture write');
  expect(s.apps.snapshot(s.workspaceId).portfolio.approver_user_id).toBeNull();
  state.tables.app_portfolios[0].approver_user_id = actor;
  await expect(s.apps.shared.run(workspace, true, () => s.apps.reviewDraft(app, work.id, { actionId: draft.id, digest, decision: 'pass' }))).rejects.toThrow('Rejected fixture write');
  expect(s.apps.snapshot(s.workspaceId).actions[0]).toMatchObject({ reviewed_digest: null, execution: {} });
  await s.apps.shared.run(workspace, false, () => {});
  expect(s.apps.snapshot(s.workspaceId).actions[0].reviewed_digest).toBeNull();
});

it('the actual DSH tool pipeline accepts typed record data and denies worker action-review calls', async () => {
  const s = setup(); const installed = await s.install(structuredManifest as any); const work = await s.run(installed.id); const app = s.apps.context(work.id);
  const require = createRequire(new URL('../dsh-runtime/package.json', import.meta.url));
  const { Context } = require('@deepseek-ai/cordis'); const { ToolRuntime } = require('@deepseek-ai/dsh-tools');
  const { createScope } = require('@deepseek-ai/dsh-scope');
  const ctx: any = new Context(); ctx.systemPrompt = { tools: () => {}, section: () => {} };
  const tools = new ToolRuntime(ctx);
  const agent: any = { session: { header: {} } }; const run = createScope(ctx, agent);
  try {
    mountAppTools(run.ctx, s.apps, app, { stagePurpose: 'worker', workItemId: work.id });
    const result = await tools.execute({ agent, callId: 'typed-record', name: 'bees_app_record', arguments: { key: 'tool-ticket', kind: 'ticket', title: 'Tool-created fixture', body: 'No live data', data: { status: 'new', count: 2, enabled: false }, evidenceIds: [] }, signal: new AbortController().signal });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(s.apps.queryRecords(app).records[0].data).toEqual({ status: 'new', count: 2, enabled: false });
    const denied = await tools.execute({ agent, callId: 'invalid-review', name: 'bees_app_review_action', arguments: {}, signal: new AbortController().signal });
    expect(denied.isError).toBe(true);
  } finally { await run.dispose(); }
});

it('scopes connector credentials to workspace and actor and retains interrupted attempts without duplicate sends', async () => {
  const send = vi.fn(async () => ({ outcome: 'accepted', receipt: { id: 'synthetic-receipt' } }));
  const s = setup(undefined, ({ workspaceId, userId }: any) => ({ id: 'fixture', account: 'fixture-account', workspaceIds: [workspaceId], actorUserIds: [userId], send }));
  const installed = await s.install({ ...manifest, schemaVersion: 2 }); const work = await s.run(installed.id); const app = s.apps.context(work.id);
  await s.apps.command({ action: 'set_approver', workspaceId: s.workspaceId });
  const input = { destination: 'https://example.com/contact', account: 'fixture-account', connectorId: 'fixture', content: 'Synthetic only', rationale: 'Test', costCents: 0 };
  expect(() => s.apps.draft({ ...app, manifest }, work.id, input)).toThrow('Version-1');
  expect(s.apps.snapshot(s.workspaceId, 'unauthorized').connectors).toEqual([]);
  expect(s.apps.connectorFor('other-workspace')).toBeNull();
  expect(() => s.apps.draft({ ...app, actorUserId: 'unauthorized' }, work.id, input)).toThrow('workspace, actor');
  const draft = s.apps.draft(app, work.id, input); const row = s.apps.snapshot(s.workspaceId).actions[0];
  s.apps.reviewDraft(app, work.id, { actionId: draft.id, digest: row.digest, decision: 'pass' });
  const action = { workspaceId: s.workspaceId, actionId: draft.id, digest: row.digest };
  await s.apps.command({ ...action, action: 'decide', decision: 'approve' });
  s.apps.actionConnector.workspaceIds = ['other-workspace'];
  await expect(s.apps.command({ ...action, action: 'execute_action' })).rejects.toThrow('not authorized'); expect(send).not.toHaveBeenCalled();
  s.apps.actionConnector.workspaceIds = [s.workspaceId];
  const save = s.apps.saveAction.bind(s.apps);
  vi.spyOn(s.apps, 'saveAction').mockImplementation((record: any, patch: any) => { if (patch.status === 'succeeded') throw new Error('Simulated persistence failure'); return save(record, patch); });
  await expect(s.apps.command({ ...action, action: 'execute_action' })).rejects.toThrow('persistence failure'); expect(send).toHaveBeenCalledTimes(1);
  s.db.prepare("UPDATE work_items SET runtime_phase='completed'").run();
  await expect(s.apps.command({ action: 'remove', workspaceId: s.workspaceId, installationId: installed.id })).rejects.toThrow('in-flight');
  const executing = s.apps.snapshot(s.workspaceId).actions[0];
  await expect(s.apps.command({ ...action, action: 'mark_unknown', attemptId: executing.execution.attemptId })).rejects.toThrow('one minute');
  executing.execution.claimedAt = new Date(Date.now() - 120_000).toISOString();
  s.db.prepare('UPDATE app_actions SET execution=? WHERE id=?').run(JSON.stringify(executing.execution), draft.id);
  await s.apps.command({ ...action, action: 'mark_unknown', attemptId: executing.execution.attemptId });
  await s.apps.command({ action: 'remove', workspaceId: s.workspaceId, installationId: installed.id });
  await s.apps.command({ ...action, action: 'reconcile_action', attemptId: executing.execution.attemptId, evidence: 'Fixture operator checked provider history.' });
  expect(s.apps.snapshot(s.workspaceId).actions[0]).toMatchObject({ status: 'unknown', execution: { reconciliation: { evidence: 'Fixture operator checked provider history.' } } });
  await expect(s.apps.command({ ...action, action: 'execute_action' })).rejects.toThrow('not available'); expect(send).toHaveBeenCalledTimes(1);
});

it('shares installations, records and approvals between distinct devices and rejects conflicting writes', async () => {
  let state: any = null; let revision = 0; let offline = false; let rejectWrites = false;
  const transport = (userId: string) => ({ appConnection: () => ({ id: 'test-connection' }), request: async (_path: string, input: any) => {
    if (offline) throw new Error('Disconnected');
    if (input.method === 'GET') return structuredClone({ state, revision, userId });
    if (rejectWrites) throw new Error('Server rejected write');
    if (input.body.revision !== revision) throw new Error('App state changed on another device');
    state = structuredClone(input.body.state); revision++; return { revision, userId };
  } });
  const a = setup(transport('human-a')); const b = setup(transport('human-a'));
  const org = randomUUID(); const team = randomUUID();
  const connect = (s: ReturnType<typeof setup>) => {
    const at = new Date().toISOString(); const ws = randomUUID();
    const user = (s.db.prepare('SELECT id FROM users LIMIT 1').get() as any).id;
    s.db.prepare("INSERT INTO organizations VALUES (?, 'Shared test', 0, ?, 'active', ?, ?)").run(org, user, at, at);
    s.db.prepare("INSERT INTO organization_memberships VALUES (?, ?, 'owner', 'active', ?)").run(user, org, at);
    s.db.prepare("INSERT INTO teams VALUES (?, ?, 'Shared test', 0, ?, 'active', ?, ?)").run(team, org, user, at, at);
    s.db.prepare("INSERT INTO team_memberships VALUES (?, ?, 'admin', 'active', ?)").run(user, team, at);
    s.db.prepare("INSERT INTO workspaces VALUES (?, ?, NULL, 'Shared', 'connected', 'device', 'active', ?, ?)").run(ws, team, at, at);
    s.db.prepare("INSERT INTO bees_accounts VALUES (?, 'test@example.com', 'Test', ?, ?, 1)").run(user, at, at);
    s.db.prepare("INSERT INTO bees_connections VALUES ('test-connection', ?, ?, 'owner', ?, ?)").run(org, user, at, at);
    s.db.prepare("INSERT INTO bees_connection_teams VALUES ('test-connection', ?, 'admin', ?, ?)").run(team, at, at);
    return ws;
  };
  const wa = connect(a); const wb = connect(b);
  const install = await a.apps.command({ action: 'install', workspaceId: wa, manifest, config: { topic: 'Test' } });
  const mirrored = await b.apps.view(wb);
  expect(mirrored.apps[0]).toMatchObject({ id: install.id, workspace_id: wb, process_id: install.processId });
  expect(b.apps.ownsProcess(install.processId)).toBe(true);
  expect(teamRecords(a.db, org).filter((r) => ['agent', 'team_process'].includes(r.recordType))).toHaveLength(0);
  expect(JSON.stringify(state)).not.toContain(wa); expect(JSON.stringify(state)).not.toContain(wb);
  const work = await a.apps.command({ action: 'run', workspaceId: wa, installationId: install.id });
  applyTeamRecords(b.db, org, teamRecords(a.db, org));
  const app = await a.apps.executionContext(work.id);
  await a.apps.useApp(app, work.id, true, (current: any) => a.apps.record(current, work.id, { key: 'one', kind: 'finding', title: 'Test result', body: 'Synthetic test' }));
  expect((await b.apps.view(wb)).records[0].title).toBe('Test result');
  await a.apps.command({ action: 'portfolio', workspaceId: wa, goal: 'Shared', capCents: 100, maxRuns: 1 });
  const drafts: any[] = [];
  for (const suffix of ['a', 'b']) drafts.push(await a.apps.useApp(app, work.id, true, (current: any) => a.apps.draft(current, work.id, {
    destination: `https://example.com/${suffix}`, account: 'test', content: 'Synthetic draft', rationale: 'Test', costCents: 60
  })));
  const actions = (await a.apps.view(wa)).actions;
  await a.apps.command({ action: 'set_approver', workspaceId: wa });
  for (const action of actions) await a.apps.useApp(app, work.id, true, (current: any) => a.apps.reviewDraft(current, work.id, { actionId: action.id, digest: action.digest, decision: 'pass' }));
  const decision = (s: any, ws: string, id: string) => s.apps.command({ action: 'decide', workspaceId: ws, actionId: id,
    digest: actions.find((d: any) => d.id === id).digest, decision: 'approve' });
  const decisions = await Promise.allSettled([decision(a, wa, drafts[0].id), decision(b, wb, drafts[1].id)]);
  expect(decisions.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const shared = await b.apps.view(wb); expect(shared.reservedCents).toBe(60);
  expect(shared.actions.find((d: any) => d.status === 'approved').decided_by).toMatch(/^human-/);
  await expect(b.apps.command({ action: 'run', workspaceId: wb, installationId: install.id })).rejects.toThrow('app-run limit');
  b.db.prepare("UPDATE work_items SET runtime_phase='completed'").run(); rejectWrites = true;
  await expect(b.apps.command({ action: 'remove', workspaceId: wb, installationId: install.id })).rejects.toThrow('Server rejected');
  expect(b.apps.installation(install.id).status).toBe('active');
  expect(b.db.prepare('SELECT archived_at FROM processes WHERE id=?').get(install.processId)).toEqual({ archived_at: null });
  offline = true;
  await expect(b.apps.view(wb)).rejects.toThrow('Shared apps unavailable');
  expect(b.apps.snapshot(b.workspaceId).apps).toHaveLength(0); // Unrelated local workspace still works.
});

it("validates the declarative boundary and rejects executable hooks, secrets and unknown fields", () => {
  expect(validateApp(manifest)).toEqual(manifest);
  for (const patch of [{ schemaVersion: 3 }, { entrypoint: "malware.js" }, { permissions: ["shell"] },
    { inputs: [...manifest.inputs, ...manifest.inputs] }, { id: "../escape" }, { task: "" },
    { sources: [{ ...manifest.sources[0], url: "http://localhost:3000" }] },
    { sources: [{ ...manifest.sources[0], url: "https://example.com/?token=secret" }] }])
    expect(() => validateApp({ ...manifest, ...patch })).toThrow();
});

it("installs real processes/routes without running or scheduling; reinstall is idempotent", async () => {
  const s = setup(); const first = await s.install(); const second = await s.install();
  expect(second.id).toBe(first.id); expect(second.reused).toBe(true);
  expect(s.processes.startItem).not.toHaveBeenCalled();
  expect((s.db.prepare("SELECT COUNT(*) AS n FROM recurring_work").get() as any).n).toBe(0);
  const stages = s.db.prepare("SELECT driver FROM stages WHERE process_id=? ORDER BY position").all(first.processId);
  expect(stages.map((r: any) => r.driver)).toEqual(["agent", "review", "terminal"]);
  expect(first.agentIds).toHaveLength(2); expect(new Set(first.agentIds).size).toBe(2);
  await expect(s.install({ ...manifest, version: "0.2.0" })).rejects.toThrow("Remove");
});

it("repairs a partial install without duplicating agents or processes", async () => {
  const s = setup(); const original = s.product.command.bind(s.product); let failed = false;
  vi.spyOn(s.product, "command").mockImplementation(async (input: any) => {
    if (input.action === "set_stage_route" && !failed) { failed = true; throw new Error("Interrupted"); }
    return original(input);
  });
  await expect(s.install()).rejects.toThrow("Interrupted");
  const before = (s.db.prepare("SELECT COUNT(*) AS n FROM processes").get() as any).n;
  const repaired = await s.install();
  expect((s.db.prepare("SELECT COUNT(*) AS n FROM processes").get() as any).n).toBe(before);
  expect(s.apps.installation(repaired.id).status).toBe("active");
});

it("does not copy app processes into unguarded native workflows", async () => {
  const s = setup(); const installed = await s.install();
  await expect(s.product.command({ action: "copy_process", processId: installed.processId, name: "Copy" }))
    .rejects.toThrow("permission boundary");
});

it("sources real tool results, scopes receipts and deduplicates records", async () => {
  const s = setup(); const installed = await s.install(); const work = await s.run(installed.id);
  const app = s.apps.context(work.id);
  const receipt = await s.apps.source(app, work.id, "public-feed", "help");
  const record = { key: "canonical-url", kind: "opportunity", title: "A request", body: "Source says help; buying intent unknown", evidenceIds: [receipt.id] };
  const first = s.apps.record(app, work.id, record);
  expect(s.apps.record(app, work.id, record).id).toBe(first.id);
  expect(s.apps.read(app).records).toHaveLength(1);
  const other = await s.install({ ...manifest, id: "other-app", name: "Other app" });
  const otherWork = await s.run(other.id); const otherApp = s.apps.context(otherWork.id);
  expect(s.apps.read(otherApp).records).toHaveLength(0);
  expect(() => s.apps.record(otherApp, otherWork.id, record)).toThrow("Evidence belongs");
  await expect(s.apps.source(app, work.id, "unknown", "help")).rejects.toThrow("not declared");
  for (let i = 1; i < 20; i++) await s.apps.source(app, work.id, "public-feed", "help");
  await expect(s.apps.source(app, work.id, "public-feed", "help")).rejects.toThrow("20-request");
});

it("rejects cross-workspace operations and requires explicit portfolio-read permission", async () => {
  const s = setup(); const first = await s.install(); const work = await s.run(first.id); const app = s.apps.context(work.id);
  s.apps.record(app, work.id, { key: "one", kind: "finding", title: "Finding", body: "Uncertain", evidenceIds: [] });
  const reviewer = await s.install({ ...manifest, id: "portfolio-review", name: "Review", permissions: ["public-sources", "portfolio-read"] });
  const reviewWork = await s.run(reviewer.id);
  expect(s.apps.read(s.apps.context(reviewWork.id)).records).toHaveLength(1);
  const org = (s.db.prepare("SELECT organization_id AS id FROM teams LIMIT 1").get() as any).id;
  const team = await s.product.command({ action: "create_team", organizationId: org, name: "Other" });
  const otherWorkspace = (s.db.prepare("SELECT id FROM workspaces WHERE team_id=?").get(team.id) as any).id;
  await expect(s.apps.command({ action: "run", workspaceId: otherWorkspace, installationId: first.id })).rejects.toThrow("another workspace");
  expect(s.apps.snapshot(otherWorkspace).records).toHaveLength(0);
});

it("caps native work admission across apps while allowing retries of the same item", async () => {
  const s = setup(); const installed = await s.install();
  await s.apps.command({ action: "portfolio", workspaceId: s.workspaceId, goal: "Learn", capCents: 0, maxRuns: 1 });
  const first = await s.run(installed.id); s.apps.context(first.id); s.apps.context(first.id);
  await expect(s.run(installed.id)).rejects.toThrow("app-run limit");
  await s.apps.command({ action: "portfolio", workspaceId: s.workspaceId, goal: "Learn", capCents: 0, maxRuns: 2 });
  const second = await s.run(installed.id);
  await s.apps.command({ action: "portfolio", workspaceId: s.workspaceId, goal: "Learn", capCents: 0, maxRuns: 1 });
  expect(() => s.apps.context(second.id)).toThrow("app-run limit");
});

it("binds human decisions to immutable drafts and reserves shared budget atomically", async () => {
  const s = setup(); const installed = await s.install(); const work = await s.run(installed.id); const app = s.apps.context(work.id);
  const propose = (destination: string) => s.apps.draft(app, work.id, { destination, account: "test-user", content: "Exact copy", rationale: "Test only", costCents: 60 });
  const first = propose("https://example.com/a"); const second = propose("https://example.com/b");
  const decide = (id: string, digest: string) => s.apps.command({ action: "decide", workspaceId: s.workspaceId, actionId: id, digest, decision: "approve" });
  const digest = (id: string) => s.apps.snapshot(s.workspaceId).actions.find((a: any) => a.id === id).digest;
  await expect(decide(first.id, "changed")).rejects.toThrow("changed");
  await expect(decide(first.id, digest(first.id))).rejects.toThrow("designated approver");
  await s.apps.command({ action: "set_approver", workspaceId: s.workspaceId });
  await expect(decide(first.id, digest(first.id))).rejects.toThrow("Independent review");
  for (const actionId of [first.id, second.id]) s.apps.reviewDraft(app, work.id, { actionId, digest: digest(actionId), decision: "pass" });
  await expect(decide(first.id, digest(first.id))).rejects.toThrow("cap");
  await s.apps.command({ action: "portfolio", workspaceId: s.workspaceId, goal: "Learn", capCents: 100, maxRuns: 5 });
  expect((await decide(first.id, digest(first.id))).sent).toBe(false);
  await expect(decide(second.id, digest(second.id))).rejects.toThrow("cap");
  expect(s.apps.snapshot(s.workspaceId).reservedCents).toBe(60);
  await expect(decide(first.id, digest(first.id))).rejects.toThrow("already decided");
  s.db.prepare("UPDATE app_actions SET expires_at='2000-01-01' WHERE id=?").run(first.id);
  expect(s.apps.snapshot(s.workspaceId).reservedCents).toBe(0);
  await s.apps.command({ action: "suppress", workspaceId: s.workspaceId, destination: "https://example.com/b" });
  expect(s.apps.snapshot(s.workspaceId).actions.find((a: any) => a.id === second.id).status).toBe("cancelled");
  expect(() => propose("https://example.com/b")).toThrow("suppressed");
  expect(s.apps.snapshot(s.workspaceId).sendingEnabled).toBe(false);
});

it("retains data on removal and denies old process runs after reinstall", async () => {
  const s = setup(); const installed = await s.install(); const work = await s.run(installed.id);
  s.apps.record(s.apps.context(work.id), work.id, { key: "one", kind: "finding", title: "Keep", body: "Keep this", evidenceIds: [] });
  s.db.prepare("UPDATE work_items SET runtime_phase='completed' WHERE id=?").run(work.id);
  await s.apps.command({ action: "remove", installationId: installed.id, workspaceId: s.workspaceId });
  expect(() => s.apps.context(work.id)).toThrow("not active");
  expect(s.apps.snapshot(s.workspaceId).records).toHaveLength(1);
  const fresh = await s.install({ ...manifest, version: "0.2.0" });
  expect(fresh.id).toBe(installed.id);
  expect(() => s.apps.context(work.id)).toThrow("older app version");
  expect(s.apps.snapshot(s.workspaceId).records).toHaveLength(1);
});

it("guards every alternate execution path, including tools registered later", () => {
  const s = setup(); const guards: any[] = []; const definitions: any[] = [];
  const context = { tools: { restrict: vi.fn(), guard: (fn: any) => guards.push(fn), register: (tool: any) => definitions.push(tool) }, systemPrompt: { section: vi.fn() } };
  mountAppTools(context, s.apps, { id: "app", config: {}, manifest }, { stagePurpose: "worker", workItemId: "one" });
  for (const name of ["bash", "run_code", "mcp__browser__click", "mcp__mail__send", "bees_control", "bees_delegate_work", "bees_publish_outputs", "new_tool_registered_later"])
    expect(guards[0]({ name })).toContain("not permitted");
  expect(guards[0]({ name: "bees_app_record" })).toBeUndefined();
  expect(appToolDenial("bees_app_record", true)).toContain("not permitted");
  expect(appToolDenial("bees_app_read", true)).toBeUndefined();
  expect(definitions.some((d) => /send|execute_action|approve_action/.test(d.name))).toBe(false);
  expect(() => mountAppTools({ tools: {} }, s.apps, {}, {})).toThrow("cannot enforce");
});

it("mounts app restrictions in the actual agent setup without browser or unrelated tools", async () => {
  const s = setup(); const installed = await s.install(); const work = await s.run(installed.id);
  const registered: any[] = []; const guards: any[] = []; const sections: any[] = []; const variables: any[] = [];
  const browser = vi.spyOn(s.runtime, "startBrowserIfGranted");
  const folders = vi.spyOn(s.runtime, "boundFolders");
  await s.runtime.setup({
    systemPrompt: { section: (section: any) => sections.push(section), context: vi.fn(),
      variable: (name: string, provider: any) => variables.push([name, provider]) },
    tools: { register: (tool: any) => registered.push(tool), restrict: vi.fn(), guard: (fn: any) => guards.push(fn) }
  }, { mode: "work", stagePurpose: "worker", agentPresetId: "standard", workspaceId: s.workspaceId,
    workItemId: work.id, mcpAccess: "none", mcpServers: [], grants: [] }, "app-test", "/tmp");
  const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
  const { Context } = require("@deepseek-ai/cordis");
  const { SystemPrompt, renderPrompt } = require("@deepseek-ai/dsh-system-prompt");
  const { createScope } = require("@deepseek-ai/dsh-scope");
  const ctx = new Context(); const prompt = new SystemPrompt(ctx, {});
  const owner = {}; const scope = createScope(ctx, owner);
  try {
    for (const section of sections) scope.ctx.systemPrompt.section(section);
    for (const [name, provider] of variables) scope.ctx.systemPrompt.variable(name, provider);
    const assembled = await prompt.assemble({ scope: owner });
    const rendered = renderPrompt(assembled);
    expect(assembled.sections).toHaveLength(1);
    expect(rendered).toContain("App mode overrides generic file/delegation instructions");
    expect(rendered).toContain('"topic":"Useful research"');
    expect(rendered).toContain("End with bees_submit_stage_result");
  } finally { await scope.dispose(); }
  expect(browser).not.toHaveBeenCalled(); expect(folders).not.toHaveBeenCalled();
  expect(registered.map((t) => t.name)).toEqual(expect.arrayContaining(["bees_app_read", "bees_app_record", "bees_submit_stage_result"]));
  for (const tool of registered) expect(appToolDenial(tool.name)).toBeUndefined();
  expect(guards.some((guard) => String(guard({ name: "mcp__mail__send" }) ?? "").includes("not permitted"))).toBe(true);
});

it("blocks private, reserved and IPv6 source addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.1.1", "192.168.1.1", "169.254.169.254", "100.64.1.1", "0.0.0.0", "224.0.0.1", "198.18.1.1", "203.0.113.1", "::1", "::ffff:127.0.0.1"])
    expect(publicIPv4(address)).toBe(false);
  expect(publicIPv4("8.8.8.8")).toBe(true);
});

it("the actual DSH execution pipeline denies sending even when another policy allows it", async () => {
  const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
  const { Context } = require("@deepseek-ai/cordis");
  const { ToolRuntime, defineTool } = require("@deepseek-ai/dsh-tools");
  const ctx: any = new Context();
  ctx.systemPrompt = { tools: () => {}, section: () => {} };
  const tools = new ToolRuntime(ctx);
  let sent = false;
  tools.register(defineTool({ name: "send_test", description: "Harmless denied-send fixture", parameters: {},
    output: { schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean", required: true } } } },
    execute: async () => { sent = true; return { ok: true }; }
  }));
  const unguard = tools.guard((exec: any) => appToolDenial(exec.name));
  try {
    const result: any = await tools.execute({ callId: "app-denial-test" as any, name: "send_test", arguments: {}, signal: new AbortController().signal });
    expect(result.isError).toBe(true);
    expect(sent).toBe(false);
    expect(JSON.stringify(result)).toContain("not permitted");
  } finally { unguard(); }
});

it("does not change a running item's configuration when future work is configured", async () => {
  const s = setup(); const installed = await s.install(); const first = await s.run(installed.id);
  expect(s.apps.context(first.id).config.topic).toBe("Useful research");
  await s.apps.command({ action: "configure", workspaceId: s.workspaceId, installationId: installed.id, config: { topic: "Next topic" } });
  expect(s.apps.context(first.id).config.topic).toBe("Useful research");
  const second = await s.run(installed.id);
  expect(s.apps.context(second.id).config.topic).toBe("Next topic");
});

it("renders a small empty UI without starting any work", () => {
  const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
  const React = require("react"); const { renderToStaticMarkup } = require("react-dom/server");
  configureRuntime((id: string) => id === "react" ? React : {});
  const markup = renderToStaticMarkup(React.createElement(AppsPage, { workspaceId: "local", openWorkItem: () => {} }));
  expect(markup).toContain("App directory");
  expect(markup).not.toContain('type="file"');
  expect(markup).not.toContain('Local workspaces only');
  expect(markup).toContain("no account connector is configured");
  expect(markup).not.toContain("ACCOUNT-001");
});
