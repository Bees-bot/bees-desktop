import type { Database, DatabaseStatement, DatabaseValue } from "./database.js";
import {
  snapshotText,
  storedConversation,
  type BeesConversationSnapshotV1
} from "./conversation-snapshot.js";
import type { SkillUsage } from "./curator.js";
import { runtimeAgentName } from "./flue-project.js";
import {
  assertMetadataOnly,
  createId,
  defaultBoardFilters,
  logicalFileReferences,
  logicalPaths,
  now,
  parseJson,
  requiredText,
  type Agent,
  type AgentConfig,
  type Board,
  type BoardFilter,
  type ConversationPurge,
  type Execution,
  type ExecutionResult,
  type ExecutionOutput,
  type ExecutionStatus,
  type FileLocation,
  type GoalWorkMetadata,
  type LocalWorkspace,
  type Organization,
  type Process,
  type Registry,
  type Schedule,
  type ScheduleRecurrence,
  type Stage,
  type Team,
  type WorkItem,
  type WorkItemStatus
} from "./domain.js";
import type { PlannedTask } from "./processes/goals/index.js";
import { processModuleTag, starterProcessModule } from "./processes/registry.js";

type Row = Record<string, DatabaseValue>;

export interface SearchHit {
  kind: "work_item" | "execution";
  /** The work item's id, or the run's. */
  id: string;
  /** The work item this hit belongs to — the run's item, for a run. */
  workItemId: string;
  title: string;
  /** The matching stretch of text, or "" when only the title matched. */
  snippet: string;
}

/**
 * Whatever the user typed, as an FTS5 expression that cannot raise a syntax error. Each word
 * becomes a quoted phrase and the phrases are ANDed, so `%`, `AND`, `*`, and an unbalanced quote
 * are searched for literally or dropped instead of being parsed as operators. Empty means the
 * query had no searchable word and the caller should return nothing.
 */
function matchExpression(query: string): string {
  return (query.match(/[\p{L}\p{N}_]+/gu) ?? []).map((word) => `"${word}"`).join(" ");
}

/** Filesystem-safe folder name: lowercase, hyphen-separated, no leading/trailing hyphens. */
function kebabCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "org";
}

function stringValue(value: DatabaseValue | undefined): string {
  return String(value ?? "");
}

const ITEM_ERROR_PREFIX = "item_error:";

function itemErrorKey(itemId: string): string {
  return `${ITEM_ERROR_PREFIX}${itemId}`;
}

function nullableString(value: DatabaseValue | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** The first local workspace stays useful on launch; later teams choose from the library. */
function newStarterProcess(teamId: string, timestamp: string): {
  processId: string;
  statements: DatabaseStatement[];
} {
  const template = starterProcessModule().definition;
  const processId = createId();
  const stages = template.states.map(({ name }, position) => ({ id: createId(), name, position }));
  return {
    processId,
    statements: [
      {
        sql: "INSERT INTO processes (id, team_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        params: [processId, teamId, template.name, template.description, timestamp, timestamp]
      },
      {
        sql: "INSERT INTO tags (entity, entity_id, tag) VALUES ('process', ?, ?)",
        params: [processId, processModuleTag(template.id)]
      },
      ...stages.map(({ id, name, position }) => ({
        sql: "INSERT INTO stages (id, process_id, name, position) VALUES (?, ?, ?, ?)",
        params: [id, processId, name, position]
      })),
      {
        sql: `INSERT INTO kanban_boards
              (id, team_id, process_id, name, stage_ids_json, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [
          createId(),
          teamId,
          processId,
          template.boardName,
          JSON.stringify(stages.map(({ id }) => id)),
          timestamp,
          timestamp
        ]
      }
    ]
  };
}

function boardRow(row: Row): Board {
  return {
    id: stringValue(row.id),
    teamId: stringValue(row.teamId),
    processId: stringValue(row.processId),
    name: stringValue(row.name),
    stageIds: parseJson<string[]>(row.stageIdsJson, []),
    filters: parseJson<BoardFilter[]>(row.filtersJson, defaultBoardFilters),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt)
  };
}

function processRow(row: Row, stages: Stage[], tags: string[]): Process {
  return {
    id: stringValue(row.id),
    teamId: stringValue(row.teamId),
    name: stringValue(row.name),
    description: stringValue(row.description),
    archivedAt: nullableString(row.archivedAt),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
    stages,
    tags
  };
}

function stageRow(row: Row): Stage {
  return {
    id: stringValue(row.id),
    processId: stringValue(row.processId),
    name: stringValue(row.name),
    position: Number(row.position),
    completionRules: stringValue(row.completionRules),
    archivedAt: nullableString(row.archivedAt)
  };
}

function workItemRow(row: Row): WorkItem {
  return {
    id: stringValue(row.id),
    processId: stringValue(row.processId),
    stageId: stringValue(row.stageId),
    parentId: nullableString(row.parentId),
    title: stringValue(row.title),
    description: stringValue(row.description),
    owner: nullableString(row.owner),
    goal: parseJson<GoalWorkMetadata | null>(row.goalJson, null),
    status: stringValue(row.status) as WorkItemStatus,
    logicalFiles: parseJson<string[]>(row.logicalFilesJson, []),
    syncVersion: Number(row.syncVersion),
    checkpointStageId: nullableString(row.checkpointStageId),
    checkpointAt: nullableString(row.checkpointAt),
    deletedAt: nullableString(row.deletedAt),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt)
  };
}

function fileLocationRow(row: Row): FileLocation {
  return {
    id: stringValue(row.id),
    organizationId: stringValue(row.organizationId),
    teamId: nullableString(row.teamId),
    name: stringValue(row.name),
    localPath: nullableString(row.localPath),
    missing: Boolean(row.missing),
    deletedAt: nullableString(row.deletedAt),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt)
  };
}

/**
 * Four queries read executions and all of them must agree, so the column list lives once.
 * `prefix` is the table alias a joined query needs.
 */
function executionColumns(prefix = ""): string {
  return [
    "id",
    "agent_id AS agentId",
    "config_json AS configJson",
    "work_item_id AS workItemId",
    "runtime",
    "status",
    "conversation_id AS conversationId",
    "instance_uid AS instanceUid",
    "conversation_snapshot_json AS conversationSnapshotJson",
    "restarted_from_execution_id AS restartedFromExecutionId",
    "submission_id AS submissionId",
    "workspace_ref AS workspaceRef",
    "result_json AS resultJson",
    "usage_json AS usageJson",
    "model_json AS modelJson",
    "logs",
    "error_text AS error",
    "started_at AS startedAt",
    "ended_at AS endedAt",
    "created_at AS createdAt"
  ]
    .map((column) => (prefix ? `${prefix}.${column}` : column))
    .join(", ");
}

/**
 * A queued conversation purge. The row exists precisely while the Flue side of a deleted run
 * has not been removed, so its presence is the answer to "is this actually deleted yet?".
 */
function purgeStatements(
  purges: { conversationId: string; agentName: string }[]
): DatabaseStatement[] {
  const timestamp = now();
  return purges.map(({ conversationId, agentName }) => ({
    sql: `INSERT INTO conversation_purges (conversation_id, agent_name, requested_at)
          VALUES (?, ?, ?)
          ON CONFLICT(conversation_id) DO NOTHING`,
    params: [conversationId, agentName, timestamp]
  }));
}

function executionRow(row: Row): Execution {
  const snapshot = storedConversation(parseJson<unknown>(row.conversationSnapshotJson, null));
  return {
    id: stringValue(row.id),
    agentId: stringValue(row.agentId),
    config: parseJson<AgentConfig>(row.configJson, { prompt: "" }),
    workItemId: stringValue(row.workItemId),
    runtime: stringValue(row.runtime),
    status: stringValue(row.status) as ExecutionStatus,
    conversationId: nullableString(row.conversationId) ?? stringValue(row.id),
    instanceUid: nullableString(row.instanceUid),
    conversationSnapshot: snapshot,
    restartedFromExecutionId: nullableString(row.restartedFromExecutionId),
    submissionId: nullableString(row.submissionId),
    workspaceRef: nullableString(row.workspaceRef),
    result: parseJson<ExecutionResult | null>(row.resultJson, null),
    usage: parseJson<Record<string, unknown> | null>(row.usageJson, null),
    model: parseJson<Record<string, unknown> | null>(row.modelJson, null),
    logs: stringValue(row.logs),
    error: nullableString(row.error),
    startedAt: nullableString(row.startedAt),
    endedAt: nullableString(row.endedAt),
    createdAt: stringValue(row.createdAt)
  };
}

function outputRow(row: Row): ExecutionOutput {
  return {
    id: stringValue(row.id),
    executionId: stringValue(row.executionId),
    logicalOutput: stringValue(row.logicalOutput),
    logicalDestination: stringValue(row.logicalDestination),
    status: stringValue(row.status) as ExecutionOutput["status"],
    reason: nullableString(row.reason),
    createdAt: stringValue(row.createdAt),
    decidedAt: nullableString(row.decidedAt)
  };
}

function scheduleRow(row: Row): Schedule {
  return {
    id: stringValue(row.id),
    teamId: stringValue(row.teamId),
    workItemId: stringValue(row.workItemId),
    name: stringValue(row.name),
    recurrence: stringValue(row.recurrence) as ScheduleRecurrence,
    mode: stringValue(row.mode) as Schedule["mode"],
    role: nullableString(row.role),
    timezone: stringValue(row.timezone),
    enabled: Boolean(row.enabled),
    nextRunAt: stringValue(row.nextRunAt),
    lastRunAt: nullableString(row.lastRunAt),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt)
  };
}

function registryRow(row: Row): Registry {
  return {
    id: stringValue(row.id),
    teamId: stringValue(row.teamId),
    name: stringValue(row.name),
    sourcePath: stringValue(row.sourcePath),
    files: parseJson<string[]>(row.filesJson, []),
    copiedAt: stringValue(row.copiedAt),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt)
  };
}

export class LocalRepository {
  constructor(private readonly database: Database) {}

  async bootstrap(): Promise<LocalWorkspace> {
    const existing = await this.database.query<Row>(
      `SELECT o.id AS organizationId, t.id AS teamId, p.id AS processId
       FROM organizations o
       LEFT JOIN teams t ON t.organization_id = o.id AND t.archived_at IS NULL
       LEFT JOIN processes p ON p.team_id = t.id AND p.archived_at IS NULL
       ORDER BY t.id IS NULL, p.id IS NULL, o.created_at, t.created_at, p.created_at
       LIMIT 1`
    );
    const row = existing[0];
    if (row) {
      const organizationId = stringValue(row.organizationId);
      const teamId = stringValue(row.teamId);
      const processId = stringValue(row.processId);
      if (teamId && processId) await this.ensureBoard(teamId, processId);
      return {
        organizationId,
        teamId,
        processId
      };
    }

    const organizationId = createId();
    const teamId = createId();
    const timestamp = now();
    const starter = newStarterProcess(teamId, timestamp);
    await this.database.transaction([
      {
        sql: "INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        params: [organizationId, "Local org", timestamp, timestamp]
      },
      {
        sql: "INSERT INTO teams (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        params: [teamId, organizationId, "Marketing", timestamp, timestamp]
      },
      ...starter.statements
    ]);
    return { organizationId, teamId, processId: starter.processId };
  }

  private async ensureBoard(teamId: string, processId: string): Promise<void> {
    const existing = await this.database.query<Row>(
      "SELECT id FROM kanban_boards WHERE team_id = ? AND process_id = ? AND archived_at IS NULL LIMIT 1",
      [teamId, processId]
    );
    if (existing[0]) return;
    const stages = await this.database.query<Row>(
      "SELECT id FROM stages WHERE process_id = ? AND archived_at IS NULL ORDER BY position",
      [processId]
    );
    const timestamp = now();
    await this.database.execute(
      `INSERT INTO kanban_boards
       (id, team_id, process_id, name, stage_ids_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        createId(),
        teamId,
        processId,
        "Work board",
        JSON.stringify(stages.map(({ id }) => stringValue(id))),
        timestamp,
        timestamp
      ]
    );
  }

  async listOrganizations(): Promise<Organization[]> {
    const rows = await this.database.query<Row>(
      "SELECT id, name FROM organizations ORDER BY created_at"
    );
    return rows.map((row) => ({ id: stringValue(row.id), name: stringValue(row.name) }));
  }

  async createOrganization(name: string): Promise<string> {
    const id = createId();
    const timestamp = now();
    await this.database.execute(
      "INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [id, requiredText(name, "Organization name", 120), timestamp, timestamp]
    );
    return id;
  }

  /** Persist one message before Flue sees it, so a crash can resend the same keyed delivery. */
  async beginExecutionDelivery(
    id: string,
    input: {
      deliveryId: string;
      prompt: string;
      taskPlan?: ExecutionResult["taskPlan"];
      continuation: boolean;
      initialData?: ExecutionResult["initialData"];
      manualProjection?: boolean;
      projectMode?: boolean;
      workspaceRef: string;
    }
  ): Promise<void> {
    const changed = await this.database.execute(
      `UPDATE executions
       SET status = 'queued', result_json = ?, workspace_ref = ?, submission_id = NULL,
           error_text = NULL, ended_at = NULL
       WHERE id = ?
         AND (status NOT IN ('queued', 'running')
                AND COALESCE(json_extract(result_json, '$.projectionState'), 'done') = 'done'
              OR (status = 'queued' AND submission_id IS NULL AND result_json IS NULL))`,
      [JSON.stringify({ ...input, projectionState: "pending" }), input.workspaceRef, id]
    );
    if (!changed) throw new Error("This conversation is still settling its previous message");
  }

  async renameOrganization(id: string, name: string): Promise<void> {
    await this.database.execute(
      "UPDATE organizations SET name = ?, updated_at = ? WHERE id = ?",
      [requiredText(name, "Organization name", 120), now(), id]
    );
  }

  /** Conversations owned by the executions a cascading delete is about to remove. */
  private async conversationsUnder(
    workItemQuery: string,
    id: string
  ): Promise<{ conversationId: string; agentName: string }[]> {
    const rows = await this.database.query<Row>(
      `SELECT conversation_id AS conversationId, agent_id AS agentId
       FROM executions WHERE work_item_id IN (${workItemQuery})`,
      [id]
    );
    return rows
      .filter((row) => nullableString(row.conversationId))
      .map((row) => ({
        conversationId: stringValue(row.conversationId),
        agentName: runtimeAgentName(stringValue(row.agentId))
      }));
  }

  /** Delete an organization and every local row beneath it (teams → processes/boards …). */
  async deleteOrganization(id: string): Promise<void> {
    const teams = "SELECT id FROM teams WHERE organization_id = ?";
    const processes = `SELECT id FROM processes WHERE team_id IN (${teams})`;
    const workItems = `SELECT id FROM work_items WHERE process_id IN (${processes})`;
    const purges = await this.conversationsUnder(workItems, id);
    await this.database.transaction([
      ...purgeStatements(purges),
      { sql: `DELETE FROM executions WHERE work_item_id IN (${workItems})`, params: [id] },
      { sql: `DELETE FROM work_items WHERE process_id IN (${processes})`, params: [id] },
      { sql: `DELETE FROM stages WHERE process_id IN (${processes})`, params: [id] },
      { sql: `DELETE FROM kanban_boards WHERE team_id IN (${teams})`, params: [id] },
      { sql: `DELETE FROM processes WHERE team_id IN (${teams})`, params: [id] },
      { sql: `DELETE FROM team_folder_mappings WHERE team_id IN (${teams})`, params: [id] },
      { sql: "DELETE FROM teams WHERE organization_id = ?", params: [id] },
      { sql: "DELETE FROM organizations WHERE id = ?", params: [id] }
    ]);
  }

  /** Delete a team and every local row beneath it (processes → boards/work items …). */
  async deleteTeam(id: string): Promise<void> {
    const processes = "SELECT id FROM processes WHERE team_id = ?";
    const workItems = `SELECT id FROM work_items WHERE process_id IN (${processes})`;
    const purges = await this.conversationsUnder(workItems, id);
    await this.database.transaction([
      ...purgeStatements(purges),
      { sql: `DELETE FROM executions WHERE work_item_id IN (${workItems})`, params: [id] },
      { sql: `DELETE FROM work_items WHERE process_id IN (${processes})`, params: [id] },
      { sql: `DELETE FROM stages WHERE process_id IN (${processes})`, params: [id] },
      { sql: "DELETE FROM kanban_boards WHERE team_id = ?", params: [id] },
      { sql: "DELETE FROM processes WHERE team_id = ?", params: [id] },
      { sql: "DELETE FROM team_folder_mappings WHERE team_id = ?", params: [id] },
      { sql: "DELETE FROM teams WHERE id = ?", params: [id] }
    ]);
  }

  /** Reconcile a server organization into the local store, keyed by its server id. */
  async upsertServerOrganization(id: string, name: string): Promise<void> {
    const timestamp = now();
    await this.database.execute(
      `INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      [id, requiredText(name, "Organization name", 120), timestamp, timestamp]
    );
  }

  /**
   * Reconcile a server team into the local store, keyed by its server id, so every desktop in the
   * org shares one id per team. Un-archives on the way in: the server list is the truth.
   */
  async upsertServerTeam(id: string, organizationId: string, name: string): Promise<void> {
    const timestamp = now();
    await this.database.execute(
      `INSERT INTO teams (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, archived_at = NULL,
         updated_at = excluded.updated_at`,
      [id, organizationId, requiredText(name, "Team name", 120), timestamp, timestamp]
    );
  }

  async listTeams(organizationId: string): Promise<Team[]> {
    const rows = await this.database.query<Row>(
      `SELECT id, organization_id AS organizationId, name
       FROM teams WHERE organization_id = ? AND archived_at IS NULL ORDER BY created_at`,
      [organizationId]
    );
    return rows.map((row) => ({
      id: stringValue(row.id),
      organizationId: stringValue(row.organizationId),
      name: stringValue(row.name)
    }));
  }

  /** `id` is supplied for connected orgs, where the server owns the team id (see upsertServerTeam). */
  async createTeam(organizationId: string, name: string, id?: string): Promise<string> {
    const teamId = id ?? createId();
    const timestamp = now();
    await this.database.execute(
      "INSERT INTO teams (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [teamId, organizationId, requiredText(name, "Team name", 120), timestamp, timestamp]
    );
    return teamId;
  }

  async listBoards(teamId: string, includeArchived = false): Promise<Board[]> {
    const rows = await this.database.query<Row>(
      `SELECT b.id, b.team_id AS teamId, b.process_id AS processId, b.name,
              b.stage_ids_json AS stageIdsJson, b.filters_json AS filtersJson,
              b.created_at AS createdAt, b.updated_at AS updatedAt
       FROM kanban_boards b
       JOIN processes p ON p.id = b.process_id
       WHERE b.team_id = ? AND p.archived_at IS NULL
         ${includeArchived ? "" : "AND b.archived_at IS NULL"}
       ORDER BY b.created_at`,
      [teamId]
    );
    return rows.map(boardRow);
  }

  async createBoard(
    teamId: string,
    input: { name: string; processId: string; stageIds: string[] }
  ): Promise<string> {
    await this.validateBoardStages(teamId, input.processId, input.stageIds);
    const id = createId();
    const timestamp = now();
    await this.database.execute(
      `INSERT INTO kanban_boards
       (id, team_id, process_id, name, stage_ids_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        teamId,
        input.processId,
        requiredText(input.name, "Board name", 120),
        JSON.stringify([...new Set(input.stageIds)]),
        timestamp,
        timestamp
      ]
    );
    return id;
  }

  async updateBoard(
    id: string,
    teamId: string,
    input: { name: string; processId: string; stageIds: string[]; filters: BoardFilter[] }
  ): Promise<void> {
    await this.validateBoardStages(teamId, input.processId, input.stageIds);
    await this.database.execute(
      `UPDATE kanban_boards
       SET name = ?, process_id = ?, stage_ids_json = ?, filters_json = ?, updated_at = ?
       WHERE id = ? AND team_id = ? AND archived_at IS NULL`,
      [
        requiredText(input.name, "Board name", 120),
        input.processId,
        JSON.stringify([...new Set(input.stageIds)]),
        JSON.stringify(input.filters),
        now(),
        id,
        teamId
      ]
    );
  }

  async archiveBoard(id: string, teamId: string): Promise<void> {
    const timestamp = now();
    await this.database.execute(
      "UPDATE kanban_boards SET archived_at = ?, updated_at = ? WHERE id = ? AND team_id = ?",
      [timestamp, timestamp, id, teamId]
    );
  }

  private async validateBoardStages(
    teamId: string,
    processId: string,
    stageIds: string[]
  ): Promise<void> {
    if (!stageIds.length) throw new Error("Choose at least one status column");
    const rows = await this.database.query<Row>(
      `SELECT s.id FROM stages s
       JOIN processes p ON p.id = s.process_id
       WHERE p.id = ? AND p.team_id = ? AND p.archived_at IS NULL
         AND s.archived_at IS NULL`,
      [processId, teamId]
    );
    const valid = new Set(rows.map(({ id }) => stringValue(id)));
    if (stageIds.some((id) => !valid.has(id))) {
      throw new Error("Board statuses must belong to the selected process");
    }
  }

  async listProcesses(teamId: string, includeArchived = false): Promise<Process[]> {
    const rows = await this.database.query<Row>(
      `SELECT id, team_id AS teamId, name, description, archived_at AS archivedAt,
              created_at AS createdAt, updated_at AS updatedAt
       FROM processes
       WHERE team_id = ? ${includeArchived ? "" : "AND archived_at IS NULL"}
       ORDER BY created_at`,
      [teamId]
    );
    const stages = await this.database.query<Row>(
      `SELECT s.id, s.process_id AS processId, s.name, s.position,
              s.completion_rules AS completionRules, s.archived_at AS archivedAt
       FROM stages s
       JOIN processes p ON p.id = s.process_id
       WHERE p.team_id = ?
       ORDER BY s.process_id, s.position`,
      [teamId]
    );
    const tags = await this.database.query<Row>(
      `SELECT t.entity_id AS entityId, t.tag
       FROM tags t
       JOIN processes p ON p.id = t.entity_id
       WHERE t.entity = 'process' AND p.team_id = ?
       ORDER BY t.tag`,
      [teamId]
    );
    return rows.map((row) =>
      processRow(
        row,
        stages
          .map(stageRow)
          .filter((stage) => stage.processId === stringValue(row.id) && !stage.archivedAt),
        tags
          .filter((tag) => stringValue(tag.entityId) === stringValue(row.id))
          .map((tag) => stringValue(tag.tag))
      )
    );
  }

  /** Replaces every tag on one row. Tags are the stable handle; names are free to change. */
  async setTags(entity: string, entityId: string, tags: readonly string[]): Promise<void> {
    const unique = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    await this.database.transaction([
      { sql: "DELETE FROM tags WHERE entity = ? AND entity_id = ?", params: [entity, entityId] },
      ...unique.map((tag) => ({
        sql: "INSERT INTO tags (entity, entity_id, tag) VALUES (?, ?, ?)",
        params: [entity, entityId, tag]
      }))
    ]);
  }

  async createProcess(
    teamId: string,
    input: { name: string; description?: string; stages: string[]; tags?: readonly string[] }
  ): Promise<string> {
    const name = requiredText(input.name, "Process name", 120);
    const stageNames = input.stages.map((stage) => requiredText(stage, "Stage name", 80));
    if (stageNames.length === 0) {
      throw new Error("A process needs at least one stage");
    }
    const id = createId();
    const timestamp = now();
    await this.database.transaction([
      {
        sql: "INSERT INTO processes (id, team_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        params: [id, teamId, name, input.description?.trim() ?? "", timestamp, timestamp]
      },
      ...stageNames.map((stage, position) => ({
        sql: "INSERT INTO stages (id, process_id, name, position) VALUES (?, ?, ?, ?)",
        params: [createId(), id, stage, position]
      })),
      ...(input.tags ?? []).map((tag) => ({
        sql: "INSERT INTO tags (entity, entity_id, tag) VALUES ('process', ?, ?)",
        params: [id, tag]
      }))
    ]);
    return id;
  }

  async updateProcess(id: string, input: { name: string; description?: string }): Promise<void> {
    await this.database.execute(
      "UPDATE processes SET name = ?, description = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL",
      [requiredText(input.name, "Process name", 120), input.description?.trim() ?? "", now(), id]
    );
  }

  async updateProcessDefinition(
    id: string,
    input: { name: string; description?: string; stages: string[] }
  ): Promise<void> {
    const stageNames = input.stages.map((stage) => requiredText(stage, "Stage name", 80));
    if (stageNames.length === 0) throw new Error("A process needs at least one stage");
    const current = (
      await this.database.query<Row>(
        `SELECT id, position FROM stages
         WHERE process_id = ? AND archived_at IS NULL ORDER BY position`,
        [id]
      )
    ).map((row) => ({ id: stringValue(row.id), position: Number(row.position) }));
    const removed = current.slice(stageNames.length);
    if (removed.length) {
      const placeholders = removed.map(() => "?").join(", ");
      const used = await this.database.query<Row>(
        `SELECT COUNT(*) AS count FROM work_items
         WHERE deleted_at IS NULL AND stage_id IN (${placeholders})`,
        removed.map(({ id: stageId }) => stageId)
      );
      if (Number(used[0]?.count) > 0) {
        throw new Error("Move work items out of removed stages before editing the process");
      }
    }
    const timestamp = now();
    await this.database.transaction([
      {
        sql: "UPDATE processes SET name = ?, description = ?, updated_at = ? WHERE id = ?",
        params: [
          requiredText(input.name, "Process name", 120),
          input.description?.trim() ?? "",
          timestamp,
          id
        ]
      },
      {
        sql: "UPDATE stages SET position = position + 10000 WHERE process_id = ?",
        params: [id]
      },
      ...stageNames.map((name, position) => {
        const existing = current[position];
        return existing
          ? {
              sql: "UPDATE stages SET name = ?, position = ? WHERE id = ?",
              params: [name, position, existing.id]
            }
          : {
              sql: "INSERT INTO stages (id, process_id, name, position) VALUES (?, ?, ?, ?)",
              params: [createId(), id, name, position]
            };
      }),
      ...removed.map(({ id: stageId }) => ({
        sql: "UPDATE stages SET archived_at = ? WHERE id = ?",
        params: [timestamp, stageId]
      }))
    ]);
  }

  async archiveProcess(id: string): Promise<void> {
    const timestamp = now();
    await this.database.execute(
      "UPDATE processes SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL",
      [timestamp, timestamp, id]
    );
  }

  async restoreProcess(id: string): Promise<void> {
    await this.database.execute(
      "UPDATE processes SET archived_at = NULL, updated_at = ? WHERE id = ? AND archived_at IS NOT NULL",
      [now(), id]
    );
  }

  async addStage(processId: string, name: string): Promise<string> {
    const rows = await this.database.query<Row>(
      "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM stages WHERE process_id = ?",
      [processId]
    );
    const id = createId();
    await this.database.execute(
      "INSERT INTO stages (id, process_id, name, position) VALUES (?, ?, ?, ?)",
      [id, processId, requiredText(name, "Stage name", 80), Number(rows[0]?.position ?? 0)]
    );
    return id;
  }

  async reorderStages(processId: string, stageIds: string[]): Promise<void> {
    if (stageIds.length === 0 || new Set(stageIds).size !== stageIds.length) {
      throw new Error("Stage order must contain unique stages");
    }
    const statements: DatabaseStatement[] = [
      {
        sql: "UPDATE stages SET position = position + 10000 WHERE process_id = ?",
        params: [processId]
      },
      ...stageIds.map((id, position) => ({
        sql: "UPDATE stages SET position = ? WHERE id = ? AND process_id = ?",
        params: [position, id, processId]
      }))
    ];
    await this.database.transaction(statements);
  }

  async listWorkItems(processId: string): Promise<WorkItem[]> {
    return (
      await this.database.query<Row>(
        `SELECT id, process_id AS processId, stage_id AS stageId, parent_id AS parentId,
                title, description, owner, goal_json AS goalJson,
                status, logical_files_json AS logicalFilesJson, sync_version AS syncVersion,
                checkpoint_stage_id AS checkpointStageId, checkpoint_at AS checkpointAt,
                deleted_at AS deletedAt, created_at AS createdAt, updated_at AS updatedAt
         FROM work_items
         WHERE process_id = ? AND deleted_at IS NULL
         ORDER BY created_at`,
        [processId]
      )
    ).map(workItemRow);
  }

  async listTeamWorkItems(teamId: string): Promise<WorkItem[]> {
    const rows = await this.database.query<Row>(
      `SELECT w.id, w.process_id AS processId, w.stage_id AS stageId,
              w.parent_id AS parentId, w.title, w.description, w.owner,
              w.goal_json AS goalJson, w.status,
              w.logical_files_json AS logicalFilesJson, w.sync_version AS syncVersion,
              w.checkpoint_stage_id AS checkpointStageId, w.checkpoint_at AS checkpointAt,
              w.deleted_at AS deletedAt, w.created_at AS createdAt, w.updated_at AS updatedAt
       FROM work_items w
       JOIN processes p ON p.id = w.process_id
       WHERE p.team_id = ? AND w.deleted_at IS NULL
       ORDER BY w.updated_at DESC`,
      [teamId]
    );
    return rows.map(workItemRow);
  }

  async getWorkItem(id: string): Promise<WorkItem | null> {
    const rows = await this.database.query<Row>(
      `SELECT id, process_id AS processId, stage_id AS stageId,
              parent_id AS parentId, title, description, owner, goal_json AS goalJson, status,
              logical_files_json AS logicalFilesJson, sync_version AS syncVersion,
              checkpoint_stage_id AS checkpointStageId, checkpoint_at AS checkpointAt,
              deleted_at AS deletedAt, created_at AS createdAt, updated_at AS updatedAt
       FROM work_items WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? workItemRow(rows[0]) : null;
  }

  async getWorkItemScope(id: string): Promise<{ organizationId: string; teamId: string } | null> {
    const rows = await this.database.query<Row>(
      `SELECT t.organization_id AS organizationId, p.team_id AS teamId
       FROM work_items w
       JOIN processes p ON p.id = w.process_id
       JOIN teams t ON t.id = p.team_id
       WHERE w.id = ?`,
      [id]
    );
    return rows[0]
      ? {
          organizationId: stringValue(rows[0].organizationId),
          teamId: stringValue(rows[0].teamId)
        }
      : null;
  }

  async createWorkItem(
    processId: string,
    input: {
      stageId: string;
      parentId?: string;
      title: string;
      description?: string;
      owner?: string;
      goal?: GoalWorkMetadata | null;
      logicalFiles?: string[];
    }
  ): Promise<string> {
    const id = createId();
    const timestamp = now();
    await this.database.execute(
      `INSERT INTO work_items
       (id, process_id, stage_id, parent_id, title, description, owner, goal_json,
        logical_files_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        processId,
        input.stageId,
        input.parentId ?? null,
        requiredText(input.title, "Work item title", 180),
        input.description?.trim() ?? "",
        input.owner?.trim() || null,
        JSON.stringify(input.goal ?? null),
        JSON.stringify(logicalFileReferences(input.logicalFiles ?? [])),
        timestamp,
        timestamp
      ]
    );
    return id;
  }

  /** Marks the item as wanting work again without changing it — a rejected output is a redo. */
  async touchWorkItem(id: string): Promise<void> {
    await this.database.execute(
      "UPDATE work_items SET updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      [now(), id]
    );
  }

  async setWorkItemStatus(id: string, status: WorkItemStatus): Promise<void> {
    await this.database.execute(
      `UPDATE work_items SET status = ?, sync_version = sync_version + 1, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [status, now(), id]
    );
  }

  async updateWorkItem(
    id: string,
    input: {
      title: string;
      description?: string;
      owner?: string;
      status: WorkItemStatus;
      logicalFiles?: string[];
    }
  ): Promise<void> {
    await this.database.execute(
      `UPDATE work_items
       SET title = ?, description = ?, owner = ?, status = ?, logical_files_json = ?,
           sync_version = sync_version + 1, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [
        requiredText(input.title, "Work item title", 180),
        input.description?.trim() ?? "",
        input.owner?.trim() || null,
        input.status,
        JSON.stringify(logicalFileReferences(input.logicalFiles ?? [])),
        now(),
        id
      ]
    );
  }

  async moveWorkItem(id: string, stageId: string): Promise<void> {
    const target = await this.database.query<Row>(
      `SELECT s.id
       FROM stages s
       JOIN work_items w ON w.process_id = s.process_id
       WHERE w.id = ? AND s.id = ? AND s.archived_at IS NULL`,
      [id, stageId]
    );
    if (!target[0]) {
      throw new Error("Work items can only move to a stage in the same process");
    }
    await this.database.execute(
      "UPDATE work_items SET stage_id = ?, sync_version = sync_version + 1, updated_at = ? WHERE id = ?",
      [stageId, now(), id]
    );
  }

  async setTeamFolder(teamId: string, localPath: string): Promise<void> {
    const path = requiredText(localPath, "Team folder", 2_048);
    await this.database.execute(
      `INSERT INTO team_folder_mappings (team_id, local_path, validated_at, missing)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(team_id) DO UPDATE SET
         local_path = excluded.local_path,
         validated_at = excluded.validated_at,
         missing = 0`,
      [teamId, path, now()]
    );
  }

  async getTeamFolder(teamId: string): Promise<{ localPath: string; missing: boolean } | null> {
    const rows = await this.database.query<Row>(
      "SELECT local_path AS localPath, missing FROM team_folder_mappings WHERE team_id = ?",
      [teamId]
    );
    const row = rows[0];
    return row ? { localPath: stringValue(row.localPath), missing: Boolean(row.missing) } : null;
  }

  /** Default on-disk folder for an org: <root>/<org-kebab>. Empty when no workspace root is set. */
  async getOrgFolder(organizationId: string): Promise<string> {
    const root = await this.getSetting("global_local_path", "");
    if (!root) return "";
    const rows = await this.database.query<Row>(
      "SELECT name FROM organizations WHERE id = ?",
      [organizationId]
    );
    const org = rows[0];
    if (!org) return "";
    return `${String(root).replace(/[\\/]+$/, "")}/${kebabCase(stringValue(org.name))}`;
  }

  async getResolvedTeamFolder(
    teamId: string
  ): Promise<{ localPath: string; missing: boolean; override: boolean } | null> {
    const override = await this.getTeamFolder(teamId);
    if (override) return { ...override, override: true };
    const root = await this.getSetting("global_local_path", "");
    if (!root) return null;
    const rows = await this.database.query<Row>(
      `SELECT t.name AS teamName, o.name AS orgName
       FROM teams t JOIN organizations o ON o.id = t.organization_id
       WHERE t.id = ? AND t.archived_at IS NULL`,
      [teamId]
    );
    const team = rows[0];
    if (!team) return null;
    const base = String(root).replace(/[\\/]+$/, "");
    return {
      localPath: `${base}/${kebabCase(stringValue(team.orgName))}/${kebabCase(stringValue(team.teamName))}`,
      missing: false,
      override: false
    };
  }

  async clearTeamFolder(teamId: string): Promise<void> {
    await this.database.execute("DELETE FROM team_folder_mappings WHERE team_id = ?", [teamId]);
  }

  async markTeamFolderMissing(teamId: string, missing: boolean): Promise<void> {
    await this.database.execute(
      "UPDATE team_folder_mappings SET missing = ?, validated_at = ? WHERE team_id = ?",
      [missing, now(), teamId]
    );
  }

  async listOrganizationFileLocations(organizationId: string): Promise<FileLocation[]> {
    const rows = await this.database.query<Row>(
      `SELECT l.id, l.organization_id AS organizationId, l.team_id AS teamId, l.name,
              m.local_path AS localPath, COALESCE(m.missing, 0) AS missing,
              l.deleted_at AS deletedAt, l.created_at AS createdAt, l.updated_at AS updatedAt
       FROM file_locations l
       LEFT JOIN file_location_mappings m ON m.location_id = l.id
       WHERE l.organization_id = ? AND l.deleted_at IS NULL
       ORDER BY l.team_id IS NOT NULL, lower(l.name)`,
      [organizationId]
    );
    return rows.map(fileLocationRow);
  }

  async listAvailableFileLocations(teamId: string): Promise<FileLocation[]> {
    const rows = await this.database.query<Row>(
      `SELECT l.id, l.organization_id AS organizationId, l.team_id AS teamId, l.name,
              m.local_path AS localPath, COALESCE(m.missing, 0) AS missing,
              l.deleted_at AS deletedAt, l.created_at AS createdAt, l.updated_at AS updatedAt
       FROM file_locations l
       JOIN teams t ON t.organization_id = l.organization_id AND t.id = ?
       LEFT JOIN file_location_mappings m ON m.location_id = l.id
       WHERE l.deleted_at IS NULL AND (l.team_id IS NULL OR l.team_id = ?)
       ORDER BY l.team_id IS NOT NULL, lower(l.name)`,
      [teamId, teamId]
    );
    return rows.map(fileLocationRow);
  }

  async createFileLocation(input: {
    organizationId: string;
    teamId?: string | null;
    name: string;
    localPath: string;
  }): Promise<string> {
    const id = createId();
    const timestamp = now();
    const name = requiredText(input.name, "Location name", 120);
    if (/[,\/@]/.test(name)) {
      throw new Error("Location names cannot contain commas, slashes, or @");
    }
    const localPath = requiredText(input.localPath, "Location folder", 2_048);
    if (input.teamId) {
      const team = await this.database.query<Row>(
        "SELECT organization_id AS organizationId FROM teams WHERE id = ?",
        [input.teamId]
      );
      if (stringValue(team[0]?.organizationId) !== input.organizationId) {
        throw new Error("The linked location team must belong to the organization");
      }
    }
    const available = input.teamId
      ? await this.listAvailableFileLocations(input.teamId)
      : await this.listOrganizationFileLocations(input.organizationId);
    if (available.some((location) => location.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`A linked location named "${name}" already exists here`);
    }
    await this.database.transaction([
      {
        sql: `INSERT INTO file_locations
              (id, organization_id, team_id, name, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        params: [id, input.organizationId, input.teamId ?? null, name, timestamp, timestamp]
      },
      {
        sql: `INSERT INTO file_location_mappings
              (location_id, local_path, validated_at, missing) VALUES (?, ?, ?, 0)`,
        params: [id, localPath, timestamp]
      }
    ]);
    return id;
  }

  async setFileLocationMapping(id: string, localPath: string): Promise<void> {
    await this.database.execute(
      `INSERT INTO file_location_mappings (location_id, local_path, validated_at, missing)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(location_id) DO UPDATE SET
         local_path = excluded.local_path, validated_at = excluded.validated_at, missing = 0`,
      [id, requiredText(localPath, "Location folder", 2_048), now()]
    );
  }

  async markFileLocationMissing(id: string, missing: boolean): Promise<void> {
    await this.database.execute(
      "UPDATE file_location_mappings SET missing = ?, validated_at = ? WHERE location_id = ?",
      [missing, now(), id]
    );
  }

  async deleteFileLocation(id: string): Promise<void> {
    const current = await this.database.query<Row>(
      "SELECT updated_at AS updatedAt FROM file_locations WHERE id = ?",
      [id]
    );
    const previous = Date.parse(stringValue(current[0]?.updatedAt));
    const timestamp = new Date(
      Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0)
    ).toISOString();
    await this.database.transaction([
      {
        sql: "UPDATE file_locations SET deleted_at = ?, updated_at = ? WHERE id = ?",
        params: [timestamp, timestamp, id]
      },
      { sql: "DELETE FROM file_location_mappings WHERE location_id = ?", params: [id] }
    ]);
  }

  async createExecution(input: {
    agentId: string;
    config: AgentConfig;
    workItemId: string;
    runtime: string;
    workspaceRef?: string;
    restartedFromExecutionId?: string;
  }): Promise<string> {
    const id = createId();
    await this.database.execute(
      `INSERT INTO executions
       (id, agent_id, config_json, work_item_id, runtime, status,
        conversation_id, restarted_from_execution_id, workspace_ref, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
      [
        id,
        input.agentId,
        JSON.stringify(input.config),
        input.workItemId,
        input.runtime,
        // The execution id is the conversation id. Stored explicitly so a future migration
        // to a different address space does not have to guess.
        id,
        input.restartedFromExecutionId ?? null,
        input.workspaceRef ?? null,
        now()
      ]
    );
    return id;
  }

  /**
   * The settled run, stored so it renders and searches without the sidecar. Written after a
   * terminal submission; the searchable text is derived here so the two can never disagree.
   */
  async saveConversationSnapshot(
    id: string,
    snapshot: BeesConversationSnapshotV1
  ): Promise<void> {
    await this.database.execute(
      `UPDATE executions
       SET conversation_snapshot_json = ?, conversation_text = ?
       WHERE id = ?`,
      [JSON.stringify(snapshot), snapshotText(snapshot), id]
    );
  }

  /**
   * Deleting a run is one operation with two halves: the Bees receipt goes now, and the Flue
   * conversation is queued for purge because the runtime has no delete route yet. The
   * tombstone is written in the same transaction as the delete, so a crash cannot lose the
   * obligation and leave orphaned conversation data behind.
   */
  async deleteExecution(id: string, agentName: string): Promise<void> {
    const execution = await this.getExecution(id);
    if (!execution) return;
    await this.database.transaction([
      ...purgeStatements([{ conversationId: execution.conversationId, agentName }]),
      { sql: "DELETE FROM execution_outputs WHERE execution_id = ?", params: [id] },
      { sql: "DELETE FROM executions WHERE id = ?", params: [id] }
    ]);
  }

  /** Runs whose Flue conversation is still out there. A non-empty list means "not deleted yet". */
  async listPendingConversationPurges(limit = 50): Promise<ConversationPurge[]> {
    const rows = await this.database.query<Row>(
      `SELECT conversation_id AS conversationId, agent_name AS agentName,
              requested_at AS requestedAt, attempts,
              last_attempt_at AS lastAttemptAt, last_error AS lastError
       FROM conversation_purges ORDER BY requested_at LIMIT ?`,
      [limit]
    );
    return rows.map((row) => ({
      conversationId: stringValue(row.conversationId),
      agentName: stringValue(row.agentName),
      requestedAt: stringValue(row.requestedAt),
      attempts: Number(row.attempts),
      lastAttemptAt: nullableString(row.lastAttemptAt),
      lastError: nullableString(row.lastError)
    }));
  }

  async completeConversationPurge(conversationId: string): Promise<void> {
    await this.database.execute("DELETE FROM conversation_purges WHERE conversation_id = ?", [
      conversationId
    ]);
  }

  async recordConversationPurgeFailure(conversationId: string, error: string): Promise<void> {
    await this.database.execute(
      `UPDATE conversation_purges
       SET attempts = attempts + 1, last_attempt_at = ?, last_error = ?
       WHERE conversation_id = ?`,
      [now(), error.slice(0, 500), conversationId]
    );
  }

  /** Full-text search over settled runs. Reads only the redacted plain-text projection. */
  async searchExecutions(teamId: string, query: string, limit = 50): Promise<Execution[]> {
    const match = matchExpression(query);
    if (!match) return [];
    const rows = await this.database.query<Row>(
      `SELECT ${executionColumns("e")}
       FROM search_index s
       JOIN executions e ON e.id = s.ref_id
       JOIN work_items w ON w.id = e.work_item_id
       JOIN processes p ON p.id = w.process_id
       WHERE search_index MATCH ? AND s.kind = 'execution' AND p.team_id = ?
       ORDER BY e.created_at DESC
       LIMIT ?`,
      [match, teamId, limit]
    );
    return rows.map(executionRow);
  }

  /**
   * One search across the team's own record: work items and settled runs, ranked together.
   * Team scope comes from joining back to the real rows, so a hit is only ever returned for a
   * row the caller could already list.
   */
  async search(teamId: string, query: string, limit = 30): Promise<SearchHit[]> {
    const match = matchExpression(query);
    if (!match) return [];
    const rows = await this.database.query<Row>(
      `SELECT s.kind AS kind,
              s.ref_id AS refId,
              COALESCE(wi.id, exw.id) AS workItemId,
              COALESCE(wi.title, exw.title) AS title,
              snippet(search_index, 3, '', '', '…', 12) AS snippet
       FROM search_index s
       LEFT JOIN work_items wi ON s.kind = 'work_item' AND wi.id = s.ref_id
       LEFT JOIN executions ex ON s.kind = 'execution' AND ex.id = s.ref_id
       LEFT JOIN work_items exw ON exw.id = ex.work_item_id
       JOIN processes p ON p.id = COALESCE(wi.process_id, exw.process_id)
       WHERE search_index MATCH ?
         AND p.team_id = ?
         AND COALESCE(wi.deleted_at, exw.deleted_at) IS NULL
       ORDER BY bm25(search_index)
       LIMIT ?`,
      [match, teamId, limit]
    );
    return rows.map((row) => ({
      kind: stringValue(row.kind) === "execution" ? "execution" : "work_item",
      id: stringValue(row.refId),
      workItemId: stringValue(row.workItemId),
      title: stringValue(row.title),
      snippet: stringValue(row.snippet)
    }));
  }

  /** Stamps the skills a starting run put in front of the model. The curator's only signal. */
  async recordSkillUse(teamId: string, capabilityRefs: string[]): Promise<void> {
    const refs = [...new Set(capabilityRefs)];
    if (!refs.length) return;
    const timestamp = now();
    await this.database.transaction(
      refs.map((ref) => ({
        sql: `INSERT INTO skill_usage (team_id, capability_ref, use_count, last_used_at)
              VALUES (?, ?, 1, ?)
              ON CONFLICT (team_id, capability_ref)
              DO UPDATE SET use_count = use_count + 1, last_used_at = excluded.last_used_at`,
        params: [teamId, ref, timestamp]
      }))
    );
  }

  async listSkillUsage(teamId: string): Promise<SkillUsage[]> {
    const rows = await this.database.query<Row>(
      `SELECT capability_ref AS capabilityRef, use_count AS useCount, last_used_at AS lastUsedAt
       FROM skill_usage WHERE team_id = ?`,
      [teamId]
    );
    return rows.map((row) => ({
      capabilityRef: stringValue(row.capabilityRef),
      useCount: Number(row.useCount),
      lastUsedAt: stringValue(row.lastUsedAt)
    }));
  }

  async updateExecution(
    id: string,
    status: ExecutionStatus,
    input: {
      logs?: string;
      result?: Record<string, unknown>;
      usage?: Record<string, unknown>;
      model?: Record<string, unknown>;
      error?: string;
      workspaceRef?: string;
      submissionId?: string;
      instanceUid?: string;
    } = {}
  ): Promise<void> {
    const startedAt = status === "running" ? now() : null;
    const endedAt = ["completed", "failed", "cancelled", "interrupted"].includes(status)
      ? now()
      : null;
    await this.database.execute(
      `UPDATE executions
       SET status = ?, logs = COALESCE(?, logs), result_json = COALESCE(?, result_json),
           usage_json = COALESCE(?, usage_json), model_json = COALESCE(?, model_json),
           error_text = COALESCE(?, error_text),
           workspace_ref = COALESCE(?, workspace_ref),
           submission_id = COALESCE(?, submission_id),
           instance_uid = COALESCE(?, instance_uid),
           started_at = COALESCE(started_at, ?), ended_at = COALESCE(?, ended_at)
       WHERE id = ?`,
      [
        status,
        input.logs ?? null,
        input.result ? JSON.stringify(input.result) : null,
        input.usage ? JSON.stringify(input.usage) : null,
        input.model ? JSON.stringify(input.model) : null,
        input.error?.slice(0, 2_000) ?? null,
        input.workspaceRef ?? null,
        input.submissionId ?? null,
        input.instanceUid ?? null,
        startedAt,
        endedAt,
        id
      ]
    );
  }

  async getExecution(id: string): Promise<Execution | null> {
    const rows = await this.database.query<Row>(
      `SELECT ${executionColumns()} FROM executions WHERE id = ?`,
      [id]
    );
    return rows[0] ? executionRow(rows[0]) : null;
  }

  async listExecutions(teamId: string, limit = 200): Promise<Execution[]> {
    const rows = await this.database.query<Row>(
      `SELECT ${executionColumns("e")}
       FROM executions e
       JOIN work_items w ON w.id = e.work_item_id
       JOIN processes p ON p.id = w.process_id
       WHERE p.team_id = ?
       ORDER BY e.created_at DESC
       LIMIT ?`,
      [teamId, limit]
    );
    return rows.map(executionRow);
  }

  async listExecutionsForWorkItem(workItemId: string): Promise<Execution[]> {
    const rows = await this.database.query<Row>(
      `SELECT ${executionColumns()}
       FROM executions WHERE work_item_id = ? ORDER BY created_at DESC`,
      [workItemId]
    );
    return rows.map(executionRow);
  }

  /**
   * Runs that were accepted but never settled. Rust re-adopts them on startup rather than
   * marking them interrupted — the submission is durable, so the outcome still exists.
   */
  async listNonTerminalExecutions(): Promise<Execution[]> {
    const rows = await this.database.query<Row>(
      `SELECT ${executionColumns()}
       FROM executions
       WHERE status IN ('queued', 'running')
       ORDER BY created_at`
    );
    return rows.map(executionRow);
  }

  /** Terminal receipts whose Bees-side effects still need applying or retrying. */
  async listPendingExecutionProjections(): Promise<Execution[]> {
    const rows = await this.database.query<Row>(
      `SELECT ${executionColumns()}
       FROM executions
       WHERE status IN ('completed', 'failed', 'cancelled', 'interrupted')
         AND COALESCE(json_extract(result_json, '$.projectionState'), '')
             IN ('pending', 'local_applied')
       ORDER BY ended_at, created_at`
    );
    return rows.map(executionRow);
  }

  async markExecutionProjectionLocal(id: string): Promise<void> {
    await this.database.execute(
      `UPDATE executions
       SET result_json = json_set(result_json, '$.projectionState', 'local_applied')
       WHERE id = ? AND json_extract(result_json, '$.projectionState') = 'pending'`,
      [id]
    );
  }

  async completeExecutionProjection(id: string): Promise<void> {
    await this.database.execute(
      `UPDATE executions
       SET result_json = json_set(result_json, '$.projectionState', 'done')
       WHERE id = ? AND json_extract(result_json, '$.projectionState') = 'local_applied'`,
      [id]
    );
  }

  async interruptRunningExecutions(): Promise<Execution[]> {
    const rows = await this.database.query<Row>(
      `SELECT ${executionColumns()}
       FROM executions
       WHERE status IN ('queued', 'running')
       ORDER BY created_at`
    );
    if (!rows.length) return [];
    const endedAt = now();
    await this.database.execute(
      `UPDATE executions
       SET status = 'interrupted', ended_at = ?, error_text = 'Bees stopped during this step'
       WHERE status IN ('queued', 'running')`,
      [endedAt]
    );
    return rows.map((row) => ({
      ...executionRow(row),
      status: "interrupted",
      endedAt,
      error: "Bees stopped during this step"
    }));
  }

  async recordExecutionOutputs(executionId: string, outputs: string[]): Promise<void> {
    const timestamp = now();
    await this.database.transaction(
      logicalPaths(outputs).map((output) => ({
        sql: `INSERT INTO execution_outputs
              (id, execution_id, logical_output, logical_destination, created_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(execution_id, logical_output) DO NOTHING`,
        params: [createId(), executionId, output, output, timestamp]
      }))
    );
  }

  /**
   * Work items whose Git project folder is selected and still there. Rust owns the table; the
   * board only needs to know which studio items are still waiting on a person to choose one.
   */
  async listProjectFolderItemIds(): Promise<string[]> {
    const rows = await this.database.query<{ workItemId: string }>(
      `SELECT work_item_id AS workItemId FROM software_project_mappings WHERE missing = 0`
    );
    return rows.map(({ workItemId }) => workItemId);
  }

  async listExecutionOutputs(executionId?: string, status?: ExecutionOutput["status"]): Promise<ExecutionOutput[]> {
    const rows = await this.database.query<Row>(
      `SELECT id, execution_id AS executionId, logical_output AS logicalOutput,
              logical_destination AS logicalDestination, status, reason,
              created_at AS createdAt, decided_at AS decidedAt
       FROM execution_outputs
       WHERE (? IS NULL OR execution_id = ?) AND (? IS NULL OR status = ?)
       ORDER BY created_at`,
      [executionId ?? null, executionId ?? null, status ?? null, status ?? null]
    );
    return rows.map(outputRow);
  }

  async decideExecutionOutput(
    id: string,
    status: "approved" | "rejected",
    destination?: string,
    reason?: string
  ): Promise<void> {
    await this.database.execute(
      `UPDATE execution_outputs
       SET status = ?, logical_destination = COALESCE(?, logical_destination),
           reason = ?, decided_at = ?
       WHERE id = ? AND status = 'pending'`,
      [status, destination ?? null, reason?.trim() || null, now(), id]
    );
  }

  /** Approves a planner output atomically: create its children, park the parent, close approval. */
  async approveTaskPlan(
    outputId: string,
    parentId: string,
    sourceStageId: string,
    workStageId: string,
    waitingStageId: string,
    reviewStageId: string,
    tasks: PlannedTask[]
  ): Promise<string[]> {
    if (!tasks.length) throw new Error("Select at least one task to approve");
    const pending = await this.database.query<Row>(
      `SELECT w.process_id AS processId, w.logical_files_json AS logicalFilesJson
       FROM execution_outputs o
       JOIN executions e ON e.id = o.execution_id
       JOIN work_items w ON w.id = e.work_item_id
       WHERE o.id = ? AND o.status = 'pending' AND e.work_item_id = ? AND w.stage_id = ?`,
      [outputId, parentId, sourceStageId]
    );
    if (!pending[0]) throw new Error("This task plan is no longer waiting for approval");
    const parentFiles = new Set(parseJson<string[]>(pending[0].logicalFilesJson, []));
    for (const [index, task] of tasks.entries()) {
      const unavailable = task.inputs.find((input) => !parentFiles.has(input));
      if (unavailable) {
        throw new Error(`Task ${index + 1} input is not approved on its parent: ${unavailable}`);
      }
    }
    const validStages = await this.database.query<Row>(
      `SELECT s.id FROM stages s
       JOIN work_items w ON w.process_id = s.process_id
       WHERE w.id = ? AND s.id IN (?, ?, ?, ?) AND s.archived_at IS NULL`,
      [parentId, sourceStageId, workStageId, waitingStageId, reviewStageId]
    );
    const expectedStages = new Set([sourceStageId, workStageId, waitingStageId, reviewStageId]);
    if (validStages.length !== expectedStages.size) {
      throw new Error("The task-plan process definition has changed");
    }

    // ponytail: one small process-wide scan beats a dependency graph or dedupe service.
    const existingKeys = new Set(
      (
        await this.database.query<Row>(
          `SELECT json_extract(goal_json, '$.key') AS goalKey FROM work_items
           WHERE process_id = ? AND json_extract(goal_json, '$.key') IS NOT NULL`,
          [stringValue(pending[0].processId)]
        )
      ).map((row) => stringValue(row.goalKey))
    );
    const createdTasks = tasks.filter(({ key }) => !existingKeys.has(key));

    const timestamp = now();
    const ids = createdTasks.map(() => createId());
    await this.database.transaction([
      ...createdTasks.map((task, index) => ({
        sql: `INSERT INTO work_items
              (id, process_id, stage_id, parent_id, title, description, goal_json,
               logical_files_json, created_at, updated_at)
              SELECT ?, process_id, ?, id, ?, ?, ?, ?, ?, ? FROM work_items WHERE id = ?`,
        params: [
          ids[index]!,
          workStageId,
          requiredText(task.title, `Task ${index + 1} title`, 180),
          task.description.trim(),
          JSON.stringify({
            key: task.key,
            role: task.role,
            effect: task.effect,
            planOutputId: outputId,
            authorizedAt: timestamp,
            occurrenceOf: null
          } satisfies GoalWorkMetadata),
          JSON.stringify(task.inputs),
          timestamp,
          timestamp,
          parentId
        ]
      })),
      {
        sql: `UPDATE work_items
              SET checkpoint_stage_id = stage_id, checkpoint_at = ?, stage_id = ?,
                  status = 'open', sync_version = sync_version + 1, updated_at = ?
              WHERE id = ? AND deleted_at IS NULL`,
        params: [timestamp, ids.length ? waitingStageId : reviewStageId, timestamp, parentId]
      },
      {
        sql: `UPDATE execution_outputs SET status = 'approved', decided_at = ?
              WHERE id = ? AND status = 'pending'`,
        params: [timestamp, outputId]
      }
    ]);
    return ids;
  }

  /**
   * Every rejection reason users wrote at one status, newest first. Items that have since moved
   * on are not counted — the complaint belongs to the step the item was sitting in.
   */
  async listStageRejections(stageId: string, limit = 10): Promise<string[]> {
    const rows = await this.database.query<Row>(
      `SELECT o.reason FROM execution_outputs o
       JOIN executions e ON e.id = o.execution_id
       JOIN work_items w ON w.id = e.work_item_id
       WHERE w.stage_id = ? AND o.status = 'rejected' AND o.reason IS NOT NULL AND o.reason <> ''
       ORDER BY o.decided_at DESC
       LIMIT ?`,
      [stageId, limit]
    );
    return rows.map((row) => stringValue(row.reason));
  }

  /**
   * What the user said when rejecting this item's earlier files, oldest first. Scoped to the
   * current status: once the item checkpoints forward, that feedback was about different work.
   */
  async listRejectionFeedback(workItemId: string, limit = 5): Promise<string[]> {
    const rows = await this.database.query<Row>(
      `SELECT o.reason FROM execution_outputs o
       JOIN executions e ON e.id = o.execution_id
       JOIN work_items w ON w.id = e.work_item_id
       WHERE e.work_item_id = ? AND o.status = 'rejected' AND o.reason IS NOT NULL
         AND o.decided_at > COALESCE(w.checkpoint_at, '')
       ORDER BY o.decided_at DESC
       LIMIT ?`,
      [workItemId, limit]
    );
    return rows.map((row) => stringValue(row.reason)).reverse();
  }

  async checkpointWorkItem(
    workItemId: string,
    approvedFiles: string[],
    targetStageId?: string,
    projectionExecutionId?: string
  ): Promise<void> {
    const rows = await this.database.query<Row>(
      `SELECT w.stage_id AS stageId, w.logical_files_json AS logicalFilesJson,
              s.position, p.id AS processId
       FROM work_items w
       JOIN stages s ON s.id = w.stage_id
       JOIN processes p ON p.id = w.process_id
       WHERE w.id = ?`,
      [workItemId]
    );
    const current = rows[0];
    if (!current) throw new Error("Work item not found");
    const stages = await this.database.query<Row>(
      `SELECT id, position FROM stages
       WHERE process_id = ? AND archived_at IS NULL
       ORDER BY position`,
      [stringValue(current.processId)]
    );
    const requested = targetStageId?.trim();
    const next = requested
      ? stages.find((stage) => stringValue(stage.id) === requested)
      : stages.find((stage) => Number(stage.position) > Number(current.position));
    if (requested && !next) throw new Error("Target status not found");
    const last = stages.at(-1);
    const finished = !next || (last !== undefined && stringValue(next.id) === stringValue(last.id));
    const timestamp = now();
    const files = logicalFileReferences([
      ...parseJson<string[]>(current.logicalFilesJson, []),
      ...approvedFiles
    ]);
    const guard = projectionExecutionId
      ? ` AND EXISTS (
            SELECT 1 FROM executions
            WHERE id = ? AND json_extract(result_json, '$.projectionState') = 'pending'
          )`
      : "";
    const update = {
      sql: `UPDATE work_items
       SET checkpoint_stage_id = stage_id, checkpoint_at = ?,
           stage_id = COALESCE(?, stage_id), status = ?,
           logical_files_json = ?, sync_version = sync_version + 1, updated_at = ?
       WHERE id = ?${guard}`,
      params: [
        timestamp,
        next ? stringValue(next.id) : null,
        finished ? "done" : "open",
        JSON.stringify(files),
        timestamp,
        workItemId,
        ...(projectionExecutionId ? [projectionExecutionId] : [])
      ]
    };
    if (!projectionExecutionId) {
      await this.database.execute(update.sql, update.params);
      return;
    }
    await this.database.transaction([
      update,
      {
        sql: `UPDATE executions
              SET result_json = json_set(result_json, '$.projectionState', 'local_applied')
              WHERE id = ? AND json_extract(result_json, '$.projectionState') = 'pending'`,
        params: [projectionExecutionId]
      }
    ]);
  }

  async listSchedules(teamId: string): Promise<Schedule[]> {
    const rows = await this.database.query<Row>(
      `SELECT id, team_id AS teamId, work_item_id AS workItemId, name, recurrence,
              mode, role, timezone, enabled, next_run_at AS nextRunAt, last_run_at AS lastRunAt,
              created_at AS createdAt, updated_at AS updatedAt
       FROM schedules WHERE team_id = ? ORDER BY name`,
      [teamId]
    );
    return rows.map(scheduleRow);
  }

  async createSchedule(input: {
    teamId: string;
    workItemId: string;
    name: string;
    recurrence: ScheduleRecurrence;
    mode: Schedule["mode"];
    role: string | null;
    timezone: string;
    nextRunAt: string;
  }): Promise<string> {
    if (input.mode === "spawn_goal" && !input.role?.trim()) {
      throw new Error("A task-plan occurrence schedule requires an agent role");
    }
    if (input.mode === "run" && input.role) {
      throw new Error("An ordinary schedule cannot assign a goal agent role");
    }
    const id = createId();
    const timestamp = now();
    await this.database.execute(
      `INSERT INTO schedules
       (id, team_id, work_item_id, name, recurrence, mode, role, timezone,
        next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.teamId,
        input.workItemId,
        requiredText(input.name, "Schedule name", 120),
        input.recurrence,
        input.mode,
        input.role ? requiredText(input.role, "Schedule agent role", 120) : null,
        requiredText(input.timezone, "Timezone", 120),
        new Date(input.nextRunAt).toISOString(),
        timestamp,
        timestamp
      ]
    );
    return id;
  }

  async setScheduleEnabled(id: string, enabled: boolean): Promise<void> {
    await this.database.execute(
      "UPDATE schedules SET enabled = ?, updated_at = ? WHERE id = ?",
      [enabled, now(), id]
    );
  }

  async updateScheduleAfterTick(id: string, nextRunAt: string, ran: boolean): Promise<void> {
    await this.database.execute(
      `UPDATE schedules
       SET next_run_at = ?, last_run_at = CASE WHEN ? THEN ? ELSE last_run_at END, updated_at = ?
       WHERE id = ?`,
      [nextRunAt, ran, now(), now(), id]
    );
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.database.execute("DELETE FROM schedules WHERE id = ?", [id]);
  }

  async listRegistries(teamId: string): Promise<Registry[]> {
    const rows = await this.database.query<Row>(
      `SELECT id, team_id AS teamId, name, source_path AS sourcePath,
              files_json AS filesJson, copied_at AS copiedAt,
              created_at AS createdAt, updated_at AS updatedAt
       FROM registries WHERE team_id = ? ORDER BY name`,
      [teamId]
    );
    return rows.map(registryRow);
  }

  async saveRegistry(input: {
    id?: string;
    teamId: string;
    name: string;
    sourcePath: string;
    files: string[];
  }): Promise<string> {
    const id = input.id ?? createId();
    const timestamp = now();
    await this.database.execute(
      `INSERT INTO registries
       (id, team_id, name, source_path, files_json, copied_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, source_path = excluded.source_path,
         files_json = excluded.files_json, copied_at = excluded.copied_at,
         updated_at = excluded.updated_at`,
      [
        id,
        input.teamId,
        requiredText(input.name, "Registry name", 120),
        requiredText(input.sourcePath, "Registry source", 1_024),
        JSON.stringify(input.files),
        timestamp,
        timestamp,
        timestamp
      ]
    );
    return id;
  }

  async removeRegistry(id: string): Promise<void> {
    await this.database.execute("DELETE FROM registries WHERE id = ?", [id]);
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.database.execute(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [requiredText(key, "Setting key", 120), JSON.stringify(value), now()]
    );
  }

  /**
   * The app's error boundary writes here, for any work item in any process. One row per item:
   * the newest failure is the one a person needs, and the record clears itself as soon as the
   * item moves again (see `supervise` in main.ts), so nothing has to remember to delete it.
   */
  async recordItemError(itemId: string, message: string): Promise<void> {
    await this.setSetting(itemErrorKey(itemId), { message, at: now() });
  }

  async clearItemError(itemId: string): Promise<void> {
    await this.database.execute("DELETE FROM settings WHERE key = ?", [itemErrorKey(itemId)]);
  }

  async listItemErrors(): Promise<Map<string, { message: string; at: string }>> {
    const rows = await this.database.query<Row>(
      "SELECT key, value_json AS valueJson FROM settings WHERE key LIKE ?",
      [`${ITEM_ERROR_PREFIX}%`]
    );
    return new Map(
      rows.flatMap((row) => {
        const value = parseJson<{ message?: string; at?: string }>(row.valueJson, {});
        return value.message && value.at
          ? [[stringValue(row.key).slice(ITEM_ERROR_PREFIX.length), { message: value.message, at: value.at }] as const]
          : [];
      })
    );
  }

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const rows = await this.database.query<Row>("SELECT value_json AS valueJson FROM settings WHERE key = ?", [
      key
    ]);
    return parseJson<T>(rows[0]?.valueJson, fallback);
  }

  async enqueueSync(
    recordType: string,
    recordId: string,
    payload: Record<string, unknown>,
    operation: "upsert" | "delete"
  ): Promise<void> {
    assertMetadataOnly(payload);
    const timestamp = now();
    await this.database.execute(
      `INSERT INTO sync_queue
       (id, record_type, record_id, payload_json, operation, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [createId(), recordType, recordId, JSON.stringify(payload), operation, timestamp, timestamp]
    );
    if (recordType === "control_report") {
      // ponytail: a small FIFO is enough for the demo; add retention classes after real volume.
      await this.database.execute(
        `DELETE FROM sync_queue WHERE id IN (
           SELECT id FROM sync_queue WHERE record_type = 'control_report'
           ORDER BY created_at DESC LIMIT -1 OFFSET 500
         )`
      );
    }
  }

  async dueSyncEntries(limit = 100): Promise<
    {
      id: string;
      recordType: string;
      recordId: string;
      payload: Record<string, unknown>;
      operation: "upsert" | "delete";
      attempts: number;
    }[]
  > {
    const rows = await this.database.query<Row>(
      `SELECT id, record_type AS recordType, record_id AS recordId, payload_json AS payloadJson,
              operation, attempts
       FROM sync_queue WHERE next_attempt_at <= ? ORDER BY created_at LIMIT ?`,
      [now(), limit]
    );
    return rows.map((row) => ({
      id: stringValue(row.id),
      recordType: stringValue(row.recordType),
      recordId: stringValue(row.recordId),
      payload: parseJson<Record<string, unknown>>(row.payloadJson, {}),
      operation: stringValue(row.operation) as "upsert" | "delete",
      attempts: Number(row.attempts)
    }));
  }

  async completeSyncEntries(ids: string[], cursor: string): Promise<void> {
    const timestamp = now();
    await this.database.transaction([
      ...ids.map((id) => ({ sql: "DELETE FROM sync_queue WHERE id = ?", params: [id] })),
      {
        sql: `INSERT INTO sync_state (scope, cursor, last_synced_at, last_error)
              VALUES ('coordination', ?, ?, NULL)
              ON CONFLICT(scope) DO UPDATE SET
                cursor = excluded.cursor, last_synced_at = excluded.last_synced_at, last_error = NULL`,
        params: [cursor, timestamp]
      }
    ]);
  }

  async completeQueuedEntries(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.database.transaction(
      ids.map((id) => ({ sql: "DELETE FROM sync_queue WHERE id = ?", params: [id] }))
    );
  }

  async deferSyncEntry(
    id: string,
    attempts: number,
    error: string,
    scope = "coordination"
  ): Promise<void> {
    const delayMs = Math.min(60_000, 1_000 * 2 ** attempts);
    await this.database.transaction([
      {
        sql: "UPDATE sync_queue SET attempts = ?, next_attempt_at = ? WHERE id = ?",
        params: [attempts + 1, new Date(Date.now() + delayMs).toISOString(), id]
      },
      {
        sql: `INSERT INTO sync_state (scope, last_error) VALUES (?, ?)
              ON CONFLICT(scope) DO UPDATE SET last_error = excluded.last_error`,
        params: [scope, error.slice(0, 500)]
      }
    ]);
  }

  async syncCursor(): Promise<string | null> {
    const rows = await this.database.query<Row>(
      "SELECT cursor FROM sync_state WHERE scope = 'coordination'"
    );
    return nullableString(rows[0]?.cursor);
  }

  async coordinationProjection(teamId: string): Promise<
    {
      recordType: "file_location" | "process" | "stage" | "work_item";
      recordId: string;
      version: number;
      deleted: boolean;
      payload: Record<string, unknown>;
    }[]
  > {
    const [processes, stages, workItems, fileLocations] = await Promise.all([
      this.database.query<Row>(
        `SELECT id, name, description, archived_at AS archivedAt, updated_at AS updatedAt
         FROM processes WHERE team_id = ?`,
        [teamId]
      ),
      this.database.query<Row>(
        `SELECT s.id, s.process_id AS processId, s.name, s.position,
                s.completion_rules AS completionRules, s.archived_at AS archivedAt
         FROM stages s JOIN processes p ON p.id = s.process_id WHERE p.team_id = ?`,
        [teamId]
      ),
      this.database.query<Row>(
        `SELECT w.id, w.process_id AS processId, w.stage_id AS stageId, w.title,
                w.parent_id AS parentId, w.description, w.owner, w.goal_json AS goalJson, w.status,
                w.logical_files_json AS logicalFilesJson,
                w.sync_version AS syncVersion, w.checkpoint_stage_id AS checkpointStageId,
                w.checkpoint_at AS checkpointAt, w.deleted_at AS deletedAt,
                w.created_at AS createdAt, w.updated_at AS updatedAt
         FROM work_items w JOIN processes p ON p.id = w.process_id WHERE p.team_id = ?`,
        [teamId]
      ),
      this.database.query<Row>(
        `SELECT l.id, l.organization_id AS organizationId, l.team_id AS teamId, l.name,
                l.deleted_at AS deletedAt, l.created_at AS createdAt, l.updated_at AS updatedAt
         FROM file_locations l JOIN teams t ON t.organization_id = l.organization_id
         WHERE t.id = ? AND (l.team_id IS NULL OR l.team_id = ?)`,
        [teamId, teamId]
      )
    ]);

    return [
      ...fileLocations.map((row) => ({
        recordType: "file_location" as const,
        recordId: stringValue(row.id),
        version: Date.parse(stringValue(row.updatedAt)),
        deleted: Boolean(row.deletedAt),
        payload: {
          organizationId: stringValue(row.organizationId),
          teamId: nullableString(row.teamId),
          name: stringValue(row.name),
          updatedAt: stringValue(row.updatedAt)
        }
      })),
      ...processes.map((row) => ({
        recordType: "process" as const,
        recordId: stringValue(row.id),
        version: Date.parse(stringValue(row.updatedAt)),
        deleted: Boolean(row.archivedAt),
        payload: {
          teamId,
          name: stringValue(row.name),
          description: stringValue(row.description),
          updatedAt: stringValue(row.updatedAt)
        }
      })),
      ...stages.map((row) => ({
        recordType: "stage" as const,
        recordId: stringValue(row.id),
        version: Number(row.position) + 1,
        deleted: Boolean(row.archivedAt),
        payload: {
          processId: stringValue(row.processId),
          name: stringValue(row.name),
          position: Number(row.position),
          completionRules: stringValue(row.completionRules)
        }
      })),
      ...workItems.map((row) => ({
        recordType: "work_item" as const,
        recordId: stringValue(row.id),
        version: Number(row.syncVersion),
        deleted: Boolean(row.deletedAt),
        payload: {
          processId: stringValue(row.processId),
          stageId: stringValue(row.stageId),
          parentId: nullableString(row.parentId),
          title: stringValue(row.title),
          description: stringValue(row.description),
          owner: nullableString(row.owner),
          goal: parseJson<GoalWorkMetadata | null>(row.goalJson, null),
          status: stringValue(row.status),
          logicalFiles: parseJson<string[]>(row.logicalFilesJson, []),
          checkpointStageId: nullableString(row.checkpointStageId),
          checkpointAt: nullableString(row.checkpointAt),
          createdAt: stringValue(row.createdAt),
          updatedAt: stringValue(row.updatedAt)
        }
      }))
    ];
  }

  async applyCoordinationRecord(record: {
    recordType: string;
    recordId: string;
    version: number;
    deleted: boolean;
    payload: Record<string, unknown>;
  }): Promise<void> {
    assertMetadataOnly(record.payload);
    const { recordId, payload } = record;
    if (record.recordType === "file_location") {
      const updatedAt = requiredText(payload.updatedAt, "File location update time");
      const organizationId = requiredText(payload.organizationId, "Organization identifier");
      const teamId = typeof payload.teamId === "string" ? payload.teamId : null;
      if (teamId) {
        const team = await this.database.query<Row>(
          "SELECT organization_id AS organizationId FROM teams WHERE id = ?",
          [teamId]
        );
        if (stringValue(team[0]?.organizationId) !== organizationId) {
          throw new Error("The linked location team does not belong to the organization");
        }
      }
      const current = await this.database.query<Row>(
        "SELECT updated_at AS updatedAt FROM file_locations WHERE id = ?",
        [recordId]
      );
      if (current[0] && stringValue(current[0].updatedAt) >= updatedAt) return;
      await this.database.execute(
        `INSERT INTO file_locations
         (id, organization_id, team_id, name, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           organization_id = excluded.organization_id, team_id = excluded.team_id,
           name = excluded.name, deleted_at = excluded.deleted_at,
           updated_at = excluded.updated_at`,
        [
          recordId,
          organizationId,
          teamId,
          requiredText(payload.name, "File location name", 120),
          record.deleted ? updatedAt : null,
          updatedAt,
          updatedAt
        ]
      );
      if (record.deleted) {
        await this.database.execute("DELETE FROM file_location_mappings WHERE location_id = ?", [
          recordId
        ]);
      }
      return;
    }
    if (record.recordType === "process") {
      const updatedAt = requiredText(payload.updatedAt, "Process update time");
      await this.database.execute(
        `INSERT INTO processes
         (id, team_id, name, description, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, description = excluded.description,
           archived_at = excluded.archived_at, updated_at = excluded.updated_at
         WHERE excluded.updated_at > processes.updated_at`,
        [
          recordId,
          requiredText(payload.teamId, "Team identifier"),
          requiredText(payload.name, "Process name"),
          typeof payload.description === "string" ? payload.description : "",
          record.deleted ? updatedAt : null,
          updatedAt,
          updatedAt
        ]
      );
      return;
    }
    if (record.recordType === "stage") {
      await this.database.execute(
        `INSERT INTO stages
         (id, process_id, name, position, completion_rules, archived_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, position = excluded.position,
           completion_rules = excluded.completion_rules,
           archived_at = excluded.archived_at`,
        [
          recordId,
          requiredText(payload.processId, "Process identifier"),
          requiredText(payload.name, "Stage name"),
          Number(payload.position),
          typeof payload.completionRules === "string" ? payload.completionRules : "",
          record.deleted ? now() : null
        ]
      );
      return;
    }
    if (record.recordType === "work_item") {
      const createdAt = requiredText(payload.createdAt, "Work item creation time");
      const updatedAt = requiredText(payload.updatedAt, "Work item update time");
      await this.database.execute(
        `INSERT INTO work_items
         (id, process_id, stage_id, parent_id, title, description, owner, goal_json, status,
          logical_files_json, sync_version, checkpoint_stage_id, checkpoint_at, deleted_at,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           stage_id = excluded.stage_id, title = excluded.title, description = excluded.description,
           parent_id = excluded.parent_id, owner = excluded.owner, goal_json = excluded.goal_json,
           status = excluded.status,
           logical_files_json = excluded.logical_files_json, sync_version = excluded.sync_version,
           checkpoint_stage_id = excluded.checkpoint_stage_id,
           checkpoint_at = excluded.checkpoint_at,
           deleted_at = excluded.deleted_at, updated_at = excluded.updated_at
         WHERE excluded.sync_version > work_items.sync_version`,
        [
          recordId,
          requiredText(payload.processId, "Process identifier"),
          requiredText(payload.stageId, "Stage identifier"),
          typeof payload.parentId === "string" ? payload.parentId : null,
          requiredText(payload.title, "Work item title"),
          typeof payload.description === "string" ? payload.description : "",
          typeof payload.owner === "string" ? payload.owner : null,
          JSON.stringify(payload.goal ?? null),
          requiredText(payload.status, "Work item status"),
          JSON.stringify(logicalFileReferences(payload.logicalFiles ?? [])),
          record.version,
          typeof payload.checkpointStageId === "string" ? payload.checkpointStageId : null,
          typeof payload.checkpointAt === "string" ? payload.checkpointAt : null,
          record.deleted ? updatedAt : null,
          createdAt,
          updatedAt
        ]
      );
    }
  }
}
