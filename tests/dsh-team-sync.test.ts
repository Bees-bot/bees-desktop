import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../dsh-runtime/plugin/lib/agent-runtime.js";
import { ConnectedAccount } from "../dsh-runtime/plugin/lib/connected-account.js";
import { BeesProduct, initializeProductDatabase } from "../dsh-runtime/plugin/lib/product.js";
import { applyTeamRecords, syncTeamRecords, teamRecords } from "../dsh-runtime/plugin/lib/team-sync.js";
import { NodeDatabase } from "./node-database.js";

/**
 * The keys @bees/api accepts per record type, in apps/api/src/validation.ts. The server rejects a
 * whole push batch over one key it does not know, so a change here has to land there in the same
 * breath.
 */
const acceptedPayloadKeys: Record<string, string[]> = {
  team_location: ["teamId", "logicalId", "name", "kind", "description", "archivedAt", "createdAt", "updatedAt"],
  agent: ["appInstallationId", "teamId", "name", "description", "instructions", "presetId", "model", "reasoningEffort",
    "systemRole", "capabilities", "enabled", "maxConcurrency", "mcpAccess", "mcpServers",
    "inputLocations", "createdAt", "updatedAt", "archivedAt"],
  team_process: ["appInstallationId", "teamId", "name", "description", "kind", "outputLocationId", "inputLocations",
    "stages", "archivedAt", "createdAt", "updatedAt"],
  process_template: ["teamId", "name", "description", "stages", "archivedAt", "createdAt", "updatedAt"],
  recurring_work: ["teamId", "processId", "sourceWorkItemId", "name", "scheduleKind", "schedule",
    "timezone", "status", "createdAt", "updatedAt"],
  team_work_item: ["appInstallationId", "teamId", "processId", "stageId", "parentId", "kind", "title", "description",
    "owner", "agentId", "agentIds", "priority", "runtimePhase", "runtimeAttempt",
    "runtimeReviewCycle", "runtimeError", "outputLocationId", "recurringWorkId", "accountUserId",
    "runSettings", "inputLocations", "archivedAt", "deletedAt", "createdAt", "updatedAt"]
};

function addTeam(database: NodeDatabase, organizationId: string, teamId: string, workspaceId?: string) {
  const at = "2026-08-29T12:00:00.000Z";
  const userId = String(database.connection.prepare("SELECT id FROM users LIMIT 1").get()!.id);
  database.connection.prepare(`INSERT INTO organizations VALUES (?, 'Acme', 0, ?, 'active', ?, ?)`)
    .run(organizationId, userId, at, at);
  database.connection.prepare("INSERT INTO organization_memberships VALUES (?, ?, 'owner', 'active', ?)")
    .run(userId, organizationId, at);
  database.connection.prepare(`INSERT INTO teams VALUES (?, ?, 'Executive', 0, ?, 'active', ?, ?)`)
    .run(teamId, organizationId, userId, at, at);
  database.connection.prepare("INSERT INTO team_memberships VALUES (?, ?, 'admin', 'active', ?)")
    .run(userId, teamId, at);
  if (workspaceId) database.connection.prepare(`
    INSERT INTO workspaces VALUES (?, ?, NULL, 'Default workspace', 'connected', 'device', 'active', ?, ?)
  `).run(workspaceId, teamId, at, at);
}

const stagePlan = (draftId: string, doneId: string) => [
  { id: draftId, name: "Draft", position: 0, driver: "agent", requiresHumanApproval: false,
    isTerminal: false, archivedAt: null, route: null },
  { id: doneId, name: "Done", position: 1, driver: "terminal", requiresHumanApproval: false,
    isTerminal: true, archivedAt: null, route: null }
];

describe("team coordination projection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("moves runnable team metadata without local paths or document content", () => {
    const source = new NodeDatabase();
    const target = new NodeDatabase();
    const organizationId = randomUUID();
    const teamId = randomUUID();
    const workspaceId = randomUUID();
    const targetWorkspaceId = randomUUID();
    const locationId = randomUUID();
    const agentId = randomUUID();
    const peerAgentId = randomUUID();
    const processId = randomUUID();
    const workStageId = randomUUID();
    const doneStageId = randomUUID();
    const recurringId = randomUUID();
    const itemId = randomUUID();
    const templateId = randomUUID();
    const at = "2026-08-29T12:00:00.000Z";
    addTeam(source, organizationId, teamId, workspaceId);
    addTeam(target, organizationId, teamId, targetWorkspaceId);

    source.connection.prepare("INSERT INTO team_locations VALUES (?, ?, ?, 'Drive', 'folder', '', NULL, ?, ?)")
      .run(locationId, teamId, randomUUID(), at, at);
    const deviceId = String(source.connection.prepare("SELECT id FROM devices LIMIT 1").get()!.id);
    source.connection.prepare("INSERT INTO device_location_mappings VALUES (?, ?, '/secret/company', ?)")
      .run(locationId, deviceId, at);
    const targetLocationId = randomUUID();
    const targetDeviceId = String(target.connection.prepare("SELECT id FROM devices LIMIT 1").get()!.id);
    target.connection.prepare("INSERT INTO team_locations VALUES (?, ?, ?, 'Drive', 'folder', '', NULL, ?, ?)")
      .run(targetLocationId, teamId, randomUUID(), at, at);
    target.connection.prepare("INSERT INTO device_location_mappings VALUES (?, ?, '/local/company', ?)")
      .run(targetLocationId, targetDeviceId, at);
    source.connection.prepare(`
      INSERT INTO agent_assignments
        (id, workspace_id, preset_id, name, description, instructions, model, reasoning_effort,
         system_role, capabilities_json, enabled, max_concurrency, mcp_access, mcp_servers_json,
         created_at, updated_at)
      VALUES (?, ?, 'standard', 'Bees work agent', '', 'Use approved sources', NULL, NULL, 'worker',
        '["research"]', 1, 1, 'none', '[]', ?, ?)
    `).run(agentId, workspaceId, at, at);
    const targetAgentId = randomUUID();
    const targetProcessId = randomUUID();
    const targetStageId = randomUUID();
    target.connection.prepare(`
      INSERT INTO agent_assignments
        (id, workspace_id, preset_id, name, description, instructions, model, reasoning_effort,
         system_role, capabilities_json, enabled, max_concurrency, mcp_access, mcp_servers_json,
         created_at, updated_at)
      VALUES (?, ?, 'standard', 'Bees work agent', '', 'Local default', NULL, NULL, 'worker',
        '[]', 1, 1, 'none', '[]', ?, ?)
    `).run(targetAgentId, targetWorkspaceId, at, at);
    target.connection.prepare("INSERT INTO processes VALUES (?, ?, 'Local', '', 'standard', NULL, NULL, NULL, ?, ?)")
      .run(targetProcessId, targetWorkspaceId, at, at);
    target.connection.prepare("INSERT INTO stages VALUES (?, ?, 'Work', 0, 'agent', 0, 0, NULL)")
      .run(targetStageId, targetProcessId);
    target.connection.prepare(`
      INSERT INTO stage_routes
        (stage_id, agent_assignment_id, required_capabilities_json,
         created_at, updated_at, agent_ids_json)
      VALUES (?, ?, '[]', ?, ?, json_array(?))
    `).run(targetStageId, targetAgentId, at, at, targetAgentId);
    source.connection.prepare("INSERT INTO agent_locations VALUES (?, ?, '')").run(agentId, locationId);
    source.connection.prepare(`
      INSERT INTO agent_assignments
        (id, workspace_id, preset_id, name, description, instructions, model, reasoning_effort,
         system_role, capabilities_json, enabled, max_concurrency, mcp_access, mcp_servers_json,
         created_at, updated_at)
      VALUES (?, ?, 'standard', 'Research peer', '', 'Challenge the lead', NULL, NULL, NULL,
        '["research"]', 1, 1, 'none', '[]', ?, ?)
    `).run(peerAgentId, workspaceId, at, at);
    source.connection.prepare(`
      INSERT INTO processes VALUES (?, ?, 'Daily brief', '', 'standard', ?, NULL, NULL, ?, ?)
    `).run(processId, workspaceId, locationId, at, at);
    source.connection.prepare("INSERT INTO stages VALUES (?, ?, 'Research', 0, 'agent', 0, 0, NULL)")
      .run(workStageId, processId);
    source.connection.prepare("INSERT INTO stages VALUES (?, ?, 'Done', 1, 'terminal', 0, 1, NULL)")
      .run(doneStageId, processId);
    source.connection.prepare(`
      INSERT INTO stage_routes
        (stage_id, agent_assignment_id, required_capabilities_json,
         created_at, updated_at, agent_ids_json)
      VALUES (?, ?, '[]', ?, ?, ?)
    `).run(workStageId, agentId, at, at, JSON.stringify([agentId, peerAgentId]));
    source.connection.prepare("INSERT INTO process_locations VALUES (?, ?, '')").run(processId, locationId);
    source.connection.prepare("INSERT INTO process_templates VALUES (?, ?, 'Brief template', '', ?, NULL, ?, ?)")
      .run(templateId, workspaceId, JSON.stringify([
        { name: "Research", driver: "agent", requiresHumanApproval: false },
        { name: "Done", driver: "terminal", requiresHumanApproval: false }
      ]), at, at);
    source.connection.prepare(`
      INSERT INTO recurring_work
        (id, workspace_id, process_id, source_work_item_id, name, schedule_kind, schedule_json,
         timezone, temporal_schedule_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'Morning', 'calendar', '{"frequency":"daily","hour":9,"minute":0}',
        'America/Los_Angeles', ?, 'active', ?, ?)
    `).run(recurringId, workspaceId, processId, itemId, `bees/recurring/${recurringId}`, at, at);
    source.connection.prepare(`
      INSERT INTO work_items
        (id, process_id, stage_id, kind, title, description, agent_assignment_id, agent_ids_json,
         output_location_id, recurring_work_id, created_at, updated_at)
      VALUES (?, ?, ?, 'work', 'Write brief', '', ?, ?, ?, ?, ?, ?)
    `).run(itemId, processId, workStageId, agentId, JSON.stringify([agentId, peerAgentId]),
      locationId, recurringId, at, at);
    source.connection.prepare("INSERT INTO work_item_locations VALUES (?, ?, '')").run(itemId, locationId);
    const runSettings = { model: "test/careful", reasoningEffort: "high", mcpAccess: "none", mcpServers: [] };
    source.connection.prepare("UPDATE work_items SET run_settings_json = ? WHERE id = ?").run(JSON.stringify(runSettings), itemId);

    const records = teamRecords(source.connection, organizationId);
    expect(records.map(({ recordType }) => recordType)).toEqual(expect.arrayContaining([
      "team_location", "agent", "team_process", "process_template", "recurring_work", "team_work_item"
    ]));
    for (const { recordType, payload } of records) {
      expect(Object.keys(payload as object).filter((key) => !acceptedPayloadKeys[recordType]?.includes(key)))
        .toEqual([]);
    }
    expect(records.find(({ recordId }) => recordId === processId)!.payload.stages[0].route)
      .toEqual({ agentId, agentIds: [agentId, peerAgentId],
        requiredCapabilities: [], updatedAt: at });
    expect(JSON.stringify(records)).not.toContain("/secret/company");
    applyTeamRecords(target.connection, organizationId, records);

    expect(target.connection.prepare("SELECT name FROM team_locations WHERE id = ?").get(locationId))
      .toEqual({ name: "Drive" });
    expect(target.connection.prepare(`
      SELECT location_id AS locationId, absolute_path AS path FROM device_location_mappings
    `).get()).toEqual({ locationId, path: "/local/company" });
    expect(target.connection.prepare("SELECT instructions FROM agent_assignments WHERE id = ?").get(agentId))
      .toEqual({ instructions: "Use approved sources" });
    expect(target.connection.prepare("SELECT agent_assignment_id AS agentId FROM stage_routes WHERE stage_id = ?")
      .get(targetStageId)).toEqual({ agentId });
    expect(JSON.parse(String(target.connection.prepare(
      "SELECT agent_ids_json AS agentIds FROM stage_routes WHERE stage_id = ?"
    ).get(workStageId)!.agentIds))).toEqual([agentId, peerAgentId]);
    expect(target.connection.prepare("SELECT output_location_id AS outputLocationId FROM processes WHERE id = ?")
      .get(processId)).toEqual({ outputLocationId: locationId });
    expect(target.connection.prepare(`
      SELECT name, stages_json AS stages FROM process_templates WHERE id = ?
    `).get(templateId)).toEqual({
      name: "Brief template",
      stages: JSON.stringify([
        { name: "Research", driver: "agent", requiresHumanApproval: false },
        { name: "Done", driver: "terminal", requiresHumanApproval: false }
      ])
    });
    expect(target.connection.prepare("SELECT schedule_kind AS kind FROM recurring_work WHERE id = ?").get(recurringId))
      .toEqual({ kind: "calendar" });
    expect(target.connection.prepare("SELECT title FROM work_items WHERE id = ?").get(itemId))
      .toEqual({ title: "Write brief" });
    expect(JSON.parse(String(target.connection.prepare(
      "SELECT agent_ids_json AS agentIds FROM work_items WHERE id = ?"
    ).get(itemId)!.agentIds))).toEqual([agentId, peerAgentId]);
    expect(JSON.parse(String(target.connection.prepare("SELECT run_settings_json AS settings FROM work_items WHERE id = ?").get(itemId)!.settings)))
      .toEqual(runSettings);
    for (const archived of [true, false]) {
      const updatedAt = new Date(Date.parse(at) + (archived ? 1000 : 2000)).toISOString();
      source.connection.prepare("UPDATE agent_assignments SET archived_at = ?, enabled = ?, updated_at = ? WHERE id = ?")
        .run(archived ? updatedAt : null, archived ? 0 : 1, updatedAt, agentId);
      const agentRecord = teamRecords(source.connection, organizationId).find((record) => record.recordId === agentId)!;
      applyTeamRecords(target.connection, organizationId, [agentRecord]);
      expect(target.connection.prepare("SELECT archived_at AS archivedAt, enabled FROM agent_assignments WHERE id = ?").get(agentId))
        .toEqual({ archivedAt: archived ? updatedAt : null, enabled: archived ? 0 : 1 });
    }
    const invalid = structuredClone(records.find((record) => record.recordType === "team_work_item")!);
    invalid.version += 1000;
    invalid.payload.updatedAt = new Date(invalid.version).toISOString();
    (invalid.payload as any).runSettings = { mcpAccess: "everything" };
    expect(() => applyTeamRecords(target.connection, organizationId, [invalid])).toThrow("Choose all, none, or listed");
  });
  it("shows one member's process, template, and run to another member of the same team", async () => {
    const author = new NodeDatabase();
    const teammate = new NodeDatabase();
    const organizationId = randomUUID();
    const teamId = randomUUID();
    const authorWorkspaceId = randomUUID();
    const teammateWorkspaceId = randomUUID();
    const processId = randomUUID();
    const draftStageId = randomUUID();
    const doneStageId = randomUUID();
    const templateId = randomUUID();
    const runId = randomUUID();
    const at = "2026-09-01T09:00:00.000Z";
    addTeam(author, organizationId, teamId, authorWorkspaceId);
    addTeam(teammate, organizationId, teamId, teammateWorkspaceId);

    author.connection.prepare(`
      INSERT INTO processes (id, workspace_id, name, kind, created_at, updated_at) VALUES (?, ?, 'Weekly report', 'standard', ?, ?)
    `).run(processId, authorWorkspaceId, at, at);
    author.connection.prepare("INSERT INTO stages VALUES (?, ?, 'Draft', 0, 'agent', 0, 0, NULL)")
      .run(draftStageId, processId);
    author.connection.prepare("INSERT INTO stages VALUES (?, ?, 'Done', 1, 'terminal', 0, 1, NULL)")
      .run(doneStageId, processId);
    author.connection.prepare("INSERT INTO process_templates VALUES (?, ?, 'Report template', '', ?, NULL, ?, ?)")
      .run(templateId, authorWorkspaceId, JSON.stringify([
        { name: "Draft", driver: "agent", requiresHumanApproval: false },
        { name: "Done", driver: "terminal", requiresHumanApproval: false }
      ]), at, at);
    author.connection.prepare(`
      INSERT INTO work_items
        (id, process_id, stage_id, kind, title, description, account_user_id, created_at, updated_at)
      VALUES (?, ?, ?, 'run', 'March report', '', 'author-account', ?, ?)
    `).run(runId, processId, draftStageId, at, at);

    applyTeamRecords(teammate.connection, organizationId, teamRecords(author.connection, organizationId));

    const root = mkdtempSync(join(tmpdir(), "bees-team-visibility-"));
    const agents = new AgentRuntime({ on: () => () => undefined }, teammate.connection);
    const snapshot = await new BeesProduct(teammate.connection, agents, null, root).snapshot();
    expect(snapshot.processes).toContainEqual(expect.objectContaining({
      id: processId, name: "Weekly report", workspaceId: teammateWorkspaceId
    }));
    expect(snapshot.templates).toContainEqual(expect.objectContaining({
      id: templateId, name: "Report template", workspaceId: teammateWorkspaceId
    }));
    expect(snapshot.items).toContainEqual(expect.objectContaining({
      id: runId, title: "March report", kind: "run", accountUserId: "author-account"
    }));
    rmSync(root, { recursive: true });
  });

  it("ignores records for a team or an organization this device is not in", () => {
    const device = new NodeDatabase();
    const organizationId = randomUUID();
    const teamId = randomUUID();
    addTeam(device, organizationId, teamId, randomUUID());
    const at = "2026-09-01T09:00:00.000Z";
    const outside = (targetTeamId: string) => [{
      recordType: "team_process", recordId: randomUUID(), version: Date.parse(at), deleted: false,
      payload: {
        teamId: targetTeamId, name: "Outside", description: "", kind: "standard",
        outputLocationId: null, inputLocations: [],
        stages: stagePlan(randomUUID(), randomUUID()),
        archivedAt: null, createdAt: at, updatedAt: at
      }
    }];
    const outsideNames = () => device.connection
      .prepare("SELECT count(*) AS total FROM processes WHERE name = 'Outside'").get();

    applyTeamRecords(device.connection, organizationId, outside(randomUUID()));
    expect(outsideNames()).toEqual({ total: 0 });
    applyTeamRecords(device.connection, randomUUID(), outside(teamId));
    expect(outsideNames()).toEqual({ total: 0 });
  });

  it("survives the tombstones a deleted team publishes", () => {
    const device = new NodeDatabase();
    const organizationId = randomUUID();
    const teamId = randomUUID();
    const workspaceId = randomUUID();
    addTeam(device, organizationId, teamId, workspaceId);
    const at = "2026-09-01T09:00:00.000Z";
    const keptId = randomUUID();

    expect(() => applyTeamRecords(device.connection, organizationId, [
      { recordType: "team_process", recordId: randomUUID(), version: Date.parse(at),
        deleted: true, payload: { teamId } },
      { recordType: "process_template", recordId: randomUUID(), version: Date.parse(at),
        deleted: true, payload: { teamId } },
      { recordType: "team_process", recordId: keptId, version: Date.parse(at), deleted: false,
        payload: {
          teamId, name: "Weekly report", description: "", kind: "standard",
          outputLocationId: null, inputLocations: [],
          stages: stagePlan(randomUUID(), randomUUID()),
          archivedAt: null, createdAt: at, updatedAt: at
        } }
    ])).not.toThrow();
    expect(device.connection.prepare("SELECT name FROM processes WHERE id = ?").get(keptId))
      .toEqual({ name: "Weekly report" });
  });

  it("re-reads shared history when a connection joins another team", async () => {
    const database = new DatabaseSync(":memory:");
    initializeProductDatabase(database);
    let storedToken = "";
    const credentials = {
      resolve: async () => storedToken ? { value: storedToken, source: "test" } : undefined,
      set: async (_reference: string, value: string) => { storedToken = value; },
      unset: async () => { storedToken = ""; }
    };
    const organizationId = randomUUID();
    const design = { id: randomUUID(), name: "Design" };
    const operations = { id: randomUUID(), name: "Operations" };
    const processId = randomUUID();
    const at = "2026-09-01T09:00:00.000Z";
    // A teammate pushed this before this member joined Operations, so the server sequenced it
    // below the cursor this connection already saved.
    const history = [{
      recordType: "team_process", recordId: processId, version: Date.parse(at), deleted: false,
      payload: {
        teamId: operations.id, name: "Weekly report", description: "", kind: "standard",
        outputLocationId: null, inputLocations: [],
        stages: stagePlan(randomUUID(), randomUUID()),
        archivedAt: null, createdAt: at, updatedAt: at
      }
    }];
    let remoteTeams = [design];
    const pullCursors: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = url.endsWith("/api/auth/sign-in/email")
        ? { user: { id: "member-b", email: "b@example.com", name: "B" } }
        : url.endsWith("/api/organizations")
          ? { organizations: [{ id: organizationId, name: "Acme", role: "member" }] }
          : url.endsWith("/api/teams")
            ? { teams: remoteTeams }
            : url.endsWith("/members")
              ? { members: [{ id: randomUUID(), userId: "member-b", role: "member" }] }
              : url.includes("/api/sync/pull")
                ? (pullCursors.push(new URL(url).searchParams.get("cursor") ?? ""),
                  { records: pullCursors.at(-1) === "0" ? history : [], cursor: "50", more: false })
                : url.endsWith("/api/sync/push")
                  ? { cursor: "50", rejected: [] }
                  : { invitations: [], candidates: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          "content-type": "application/json",
          ...(url.endsWith("/api/auth/sign-in/email") ? { "set-auth-token": "session-token" } : {})
        }
      });
    }));

    const connected = new ConnectedAccount(database, credentials, "https://api.example");
    await connected.signIn("b@example.com", "password123");
    expect(database.prepare("SELECT cursor FROM bees_connection_sync_cursors").get())
      .toEqual({ cursor: "50" });
    expect(database.prepare("SELECT 1 FROM processes WHERE id = ?").get(processId)).toBeUndefined();

    remoteTeams = [design, operations];
    pullCursors.length = 0;
    await connected.sync();
    expect(pullCursors).toContain("0");
    expect(database.prepare("SELECT name FROM processes WHERE id = ?").get(processId))
      .toEqual({ name: "Weekly report" });
  });

});
