import type { BeesConversationSnapshotV1 } from "./conversation-snapshot.js";
import type { WorkItemRuntimeState } from "./workflow-runtime.js";

export type GoalTaskEffect = "read" | "prepare" | "external_write";
export type WorkItemWaitKind =
  | "human"
  | "external_event"
  | "dependency"
  | "execution"
  | "error"
  | "schedule"
  | "manual";
export type WorkItemCondition =
  | "ready"
  | "running"
  | "claimed"
  | "waiting"
  | "error"
  | "terminal"
  | "archived";
export type ExecutionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export type OutputApprovalStatus = "pending" | "approved" | "rejected";
export type ScheduleRecurrence = "hourly" | "daily" | "weekdays";
export type CapabilityKind = "skill" | "tool";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface Organization {
  id: string;
  name: string;
}

export interface Team {
  id: string;
  organizationId: string;
  name: string;
}

/** A synced location name/scope joined to this machine's optional local folder mapping. */
export interface FileLocation {
  id: string;
  organizationId: string;
  /** Null means every team in the organization can reference the location. */
  teamId: string | null;
  name: string;
  localPath: string | null;
  missing: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Board {
  id: string;
  teamId: string;
  processId: string;
  name: string;
  stageIds: string[];
  filters: BoardFilter[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Hide items in a derived condition once untouched for `hours` — 0 hides all of them. Hidden
 * items move to the dashboard's filtered drawer; nothing is deleted.
 */
export interface BoardFilter {
  condition: "terminal" | "archived" | "waiting" | "error";
  hours: number;
}

export const defaultBoardFilters: BoardFilter[] = [
  { condition: "terminal", hours: 24 },
  { condition: "archived", hours: 0 }
];

const filterConditions: BoardFilter["condition"][] = ["terminal", "archived", "waiting", "error"];

/**
 * Conditions are internal words; users only ever see their board vocabulary — a terminal stage is
 * the "Done" column. Every user-facing rendering of a condition goes through here.
 */
export function workItemConditionLabel(condition: WorkItemCondition): string {
  return condition === "terminal" ? "Done" : condition[0]!.toUpperCase() + condition.slice(1);
}

export const boardFilterConditionLabels = filterConditions.map(workItemConditionLabel);

/** Rules are edited as text, one `<condition> <hours>` line each. */
export function formatBoardFilters(filters: BoardFilter[]): string {
  return filters
    .map(({ condition, hours }) => `${workItemConditionLabel(condition)} ${hours}`)
    .join("\n");
}

export function parseBoardFilters(text: string): BoardFilter[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [word = "", hours = "0"] = line.split(/\s+/);
      // "terminal" still parses so filters saved before the rename keep working.
      const condition = word.toLowerCase() === "done" ? "terminal" : word.toLowerCase();
      if (!filterConditions.includes(condition as BoardFilter["condition"])) {
        throw new Error(`"${word}" is not a condition — use one of ${boardFilterConditionLabels.join(", ")}`);
      }
      const age = Number(hours);
      if (!Number.isFinite(age) || age < 0) {
        throw new Error(`"${hours}" is not a number of hours`);
      }
      return { condition: condition as BoardFilter["condition"], hours: age };
    });
}

export function isFiltered(item: WorkItem, filters: BoardFilter[], at = Date.now()): boolean {
  const condition = workItemCondition(item);
  return filters.some(
    ({ condition: filtered, hours }) =>
      condition === filtered && at - Date.parse(item.updatedAt) >= hours * 3_600_000
  );
}

export interface Stage {
  id: string;
  processId: string;
  name: string;
  position: number;
  completionRules: string;
  isTerminal: boolean;
  archivedAt: string | null;
}

export interface TaskPlanProcessCapability {
  type: "task-plan";
  output: string;
  stageIds: {
    plan: string;
    work: string;
    waiting: string;
    review: string;
    done: string;
  };
}

export interface ProjectWorkspaceCapability {
  type: "project-workspace";
}

export type ProcessCapability = TaskPlanProcessCapability | ProjectWorkspaceCapability;

/** Persisted behavior for one installed process. Every state reference is a database stage ID. */
export interface PersistedProcessDefinition {
  moduleId: string | null;
  version: number;
  automation: "automatic" | "interactive";
  renderer: string;
  /** Renderer-specific slots resolved from template aliases during installation. */
  stateIds: Record<string, string>;
  capabilities: ProcessCapability[];
  roleBindings: Array<{ role: string; stageId: string }>;
  /** Team-folder-relative destination for files approved after choosing each status. */
  outputFolders?: Record<string, string>;
}

export interface Process {
  id: string;
  teamId: string;
  name: string;
  description: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  stages: Stage[];
  definition: PersistedProcessDefinition;
  /** Free-form labels; process behavior lives in `definition`. */
  tags: string[];
}

export interface WorkItem {
  id: string;
  processId: string;
  stageId: string;
  /** The goal this task was created to complete. Null for top-level work. */
  parentId: string | null;
  title: string;
  description: string;
  owner: string | null;
  /** Approved task-plan metadata. Null for ordinary process items and unplanned roots. */
  goal: GoalWorkMetadata | null;
  /** Derived from the current stage; never stored separately on the item. */
  isTerminal: boolean;
  waits: WorkItemWait[];
  /** Durable execution state projected from Temporal; never stored in the app database. */
  runtime?: WorkItemRuntimeState | null;
  logicalFiles: string[];
  syncVersion: number;
  checkpointStageId: string | null;
  checkpointAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A root work item plus everything planned under it, at any depth — one run of a workflow.
 * The seen set is not paranoia: a corrupted `parentId` cycle would otherwise hang the render.
 */
export function itemTree<T extends { id: string; parentId: string | null }>(
  all: T[],
  rootId: string
): T[] {
  const seen = new Set<string>();
  const tree: T[] = [];
  // `for…of` over an array sees what the body appends, so this is a breadth-first walk.
  const queue = all.filter(({ id }) => id === rootId);
  for (const item of queue) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    tree.push(item);
    queue.push(...all.filter(({ parentId }) => parentId === item.id));
  }
  return tree;
}

/** The top-level task an item belongs to — the nav row and board scope that hold it. */
export function rootItemId<T extends { id: string; parentId: string | null }>(
  all: T[],
  id: string
): string {
  const seen = new Set<string>();
  let current = all.find((item) => item.id === id);
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = all.find((item) => item.id === current!.parentId);
    if (!parent) break;
    current = parent;
  }
  return current?.id ?? id;
}

export interface WorkItemWait {
  id: string;
  workItemId: string;
  kind: WorkItemWaitKind;
  reason: string;
  target: string | null;
  dependencyWorkItemId: string | null;
  executionId: string | null;
  correlationKey: string | null;
  wakeAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export function activeWorkItemWaits(item: Pick<WorkItem, "waits">): WorkItemWait[] {
  return item.waits.filter(({ resolvedAt }) => !resolvedAt);
}

/** Restart acknowledges the errors from the failed attempt, but preserves unrelated waits. */
export function workItemForRetry(item: WorkItem): WorkItem {
  const waits = item.waits.filter(({ kind, resolvedAt }) => kind !== "error" || Boolean(resolvedAt));
  return waits.length === item.waits.length ? item : { ...item, waits };
}

export function workItemCondition(
  item: WorkItem,
  executions: Execution[] = [],
  claimed = false
): WorkItemCondition {
  if (item.archivedAt) return "archived";
  if (item.isTerminal) return "terminal";
  const waits = activeWorkItemWaits(item);
  if (waits.some(({ kind }) => kind === "error")) return "error";
  if (waits.length) return "waiting";
  if (activeExecutionForItem(item.id, executions)) return "running";
  if (item.runtime?.phase === "running") return "claimed";
  return claimed ? "claimed" : "ready";
}

export interface GoalWorkMetadata {
  /** Stable campaign-scoped identity used to suppress duplicate work across recurring scans. */
  key: string;
  /** Existing agent role or agent name approved to execute this task. */
  role: string;
  effect: GoalTaskEffect;
  /** Approval that authorized this task. Null for manually created or scheduled work. */
  planOutputId: string | null;
  authorizedAt: string;
  /** Standing goal used as the template for a scheduled occurrence. */
  occurrenceOf: string | null;
}

/**
 * Longest follow-up that may be sent into an existing conversation. A first prompt carries the
 * agent's instructions and the work item, so it is not capped; a follow-up is only the new
 * message, and anything approaching this length belongs in a fresh conversation instead.
 */
export const FOLLOW_UP_LIMIT = 20_000;

/** A file in <teamRoot>/agents/<id>.json. Mutable — duplicate it to keep an old one. */
export interface Agent {
  id: string;
  name: string;
  purpose: string;
  description: string;
  /** Process status that starts this agent. Null when nothing triggers it yet. */
  triggerStageId: string | null;
  config: AgentConfig;
  updatedAt: string;
}

export interface AgentConfig {
  prompt: string;
  instructions?: string;
  /** Provider half of the `provider/model` pair Flue resolves through pi-ai. */
  provider?: string;
  model?: string;
  skillRefs?: string[];
  toolRefs?: string[];
  mcpConnectionRefs?: string[];
  /** Per-agent MCP tool allowlists, intersected with the connection owner's allowlist. */
  mcpToolRefs?: Record<string, string[]>;
  delegateRefs?: string[];
  grants?: string[];
  thinkingLevel?: ThinkingLevel;
  validationRules?: string[];
  [key: string]: unknown;
}

export interface Execution {
  id: string;
  agentId: string;
  /** What the agent looked like when this run started — agents change under you. */
  config: AgentConfig;
  workItemId: string;
  runtime: string;
  status: ExecutionStatus;
  /**
   * The Flue conversation, the workspace pointer, the sandbox, and the CLI correlation are
   * all this same id. One run, one address.
   */
  conversationId: string;
  /** Flue incarnation guard: a follow-up must not land on a restarted runtime's conversation. */
  instanceUid: string | null;
  /** Rendered when the run is settled, so a closed run needs no sidecar. */
  conversationSnapshot: BeesConversationSnapshotV1 | null;
  /** The receipt this run was restarted from, via Restart with current config. */
  restartedFromExecutionId: string | null;
  submissionId: string | null;
  workspaceRef: string | null;
  /** Current message's recovery context and durable Bees-side settlement projection. */
  result: ExecutionResult | null;
  usage: Record<string, unknown> | null;
  model: Record<string, unknown> | null;
  logs: string;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface ExecutionResult extends Record<string, unknown> {
  /** One Flue idempotency key per user message, never per conversation. */
  deliveryId?: string;
  /** Retained only until Flue admits the delivery, so a crash can safely resend it. */
  prompt?: string;
  taskPlan?: TaskPlanRunContext;
  projectMode?: boolean;
  manualProjection?: boolean;
  continuation?: boolean;
  /** Strict, credential-free instance seed; also authorizes capabilities on later submissions. */
  initialData?: BeesRunInitialData;
  outputs?: string[];
  statusId?: string;
  /** pending -> local_applied -> done; makes webview/app restart reconciliation idempotent. */
  projectionState?: "pending" | "local_applied" | "done";
}

export interface TaskPlanRunContext {
  /** Database stage ID for the state executing this run. */
  state: string;
  output: string;
  outputBlockedStates: string[];
}

/** A deleted run whose Flue conversation has not been removed yet. */
export interface ConversationPurge {
  conversationId: string;
  agentName: string;
  requestedAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
}

export interface ExecutionOutput {
  id: string;
  executionId: string;
  logicalOutput: string;
  logicalDestination: string;
  status: OutputApprovalStatus;
  /** Why the user rejected it — fed back to the agent on the next attempt. */
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface Schedule {
  id: string;
  teamId: string;
  workItemId: string;
  name: string;
  recurrence: ScheduleRecurrence;
  mode: "run" | "spawn_goal";
  /** Agent role used by a spawned Goals occurrence. Null for ordinary reruns. */
  role: string | null;
  timezone: string;
  enabled: boolean;
  pending?: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Registry {
  id: string;
  teamId: string;
  name: string;
  sourcePath: string;
  plugin: AgentPluginPackage;
  copiedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentPluginManifest {
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
  name: string;
  version?: string;
  description?: string;
  author?: { name?: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  extensions?: Record<string, Record<string, unknown>>;
}

export interface AgentPluginSkill {
  path: string;
  name: string;
  description: string;
  instructions: string;
}

export interface AgentPluginMcpServer {
  name: string;
  transport: "streamable-http" | "sse";
  url: string;
  headers: Record<string, string>;
}

export interface AgentPluginPackage {
  manifest: AgentPluginManifest;
  skills: AgentPluginSkill[];
  mcpServers: AgentPluginMcpServer[];
  issues: string[];
  fileCount: number;
}

export interface Capability {
  ref: string;
  registryId: string;
  path: string;
  name: string;
  kind: CapabilityKind;
  description?: string;
  instructions?: string;
}

export interface SkillSnapshot {
  ref: string;
  name: string;
  description: string;
  instructions: string;
  files: Record<string, { encoding: "utf8" | "base64"; content: string }>;
}

export interface McpTool {
  name: string;
  description: string;
  readOnly: boolean;
}

/** An API with no MCP server of its own, served as tools from its OpenAPI document. */
export interface McpBridge {
  /** Empty when the document is held in `spec` rather than fetched. */
  specUrl: string;
  /** The document itself, for an API that publishes none and had one written from a request. */
  spec?: string;
  /** Where the API lives, which the document does not always say. */
  baseUrl: string;
  headerName?: string;
  /** `all` is one tool per endpoint; `explicit` narrows to `toolIds`; `dynamic` uses meta-tools. */
  tools?: "all" | "explicit" | "dynamic";
  toolIds?: string[];
}

export interface McpConnection {
  id: string;
  teamId: string;
  name: string;
  url: string;
  bridge?: McpBridge;
  transport: "streamable-http" | "sse";
  authType: "none" | "api-key" | "oauth";
  secretRef: string;
  headers?: Record<string, string>;
  /** Plugin MCP servers expose their tool catalog at connection time. */
  allTools?: boolean;
  pluginId?: string;
  optional: boolean;
  tools: McpTool[];
  allowedTools: string[];
  checkedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BeesRunSkill {
  name: string;
  description: string;
  instructions: string;
  files: Record<string, { encoding: "utf8" | "base64"; content: string }>;
}

export interface BeesRunMcpConnection {
  id: string;
  name: string;
  url: string;
  transport: "streamable-http" | "sse";
  secretRef?: string;
  headers?: Record<string, string>;
  tools?: string[];
  optional: boolean;
}

export interface BeesRunDelegate {
  name: string;
  description: string;
  instructions: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  browser: boolean;
  browserWrite: boolean;
  skills: BeesRunSkill[];
}

/** Credential-free, immutable definition of one Flue conversation. */
export interface BeesRunInitialData {
  version: 1;
  executionId: string;
  agentId: string;
  agentName: string;
  purpose: string;
  model: string;
  thinkingLevel?: ThinkingLevel;
  instructions: string;
  teamId: string;
  browser: boolean;
  browserWrite: boolean;
  localTools: boolean;
  skills: BeesRunSkill[];
  mcpConnections: BeesRunMcpConnection[];
  delegates: BeesRunDelegate[];
  grants: string[];
}

export interface LocalWorkspace {
  organizationId: string;
  teamId: string;
  processId: string;
}

/**
 * A run that proposes a skill edit rather than doing the item's work. It hangs off the same work
 * item for context, so everything that reasons about "has this item run" must skip it.
 */
export function isProposal(execution: Execution): boolean {
  return typeof execution.config.proposalStageId === "string";
}

/** The queued or running task execution, excluding skill proposals that only borrow its context. */
export function activeExecutionForItem(
  workItemId: string,
  executions: Execution[]
): Execution | undefined {
  return executions.find(
    (execution) =>
      execution.workItemId === workItemId &&
      ["queued", "running"].includes(execution.status) &&
      !isProposal(execution)
  );
}

/** One work item's pass through its process: every run on it, oldest step first. */
export interface ProcessRun {
  item: WorkItem;
  steps: Execution[];
  startedAt: string;
}

/**
 * The history of a process, newest run first. A process has no run record of its own — a run is
 * a work item plus the runs its agents did on it, so the item's steps are ordered by when they
 * started, and the earliest of those dates the run.
 *
 * An item with no steps is still a run: it is the one whose first agent never started, which is
 * exactly the case someone opens this page to explain. Building from the executions instead
 * hid it, and hid every studio item — those only run when a person presses something.
 */
export function processRuns(items: WorkItem[], executions: Execution[]): ProcessRun[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const steps = new Map<string, Execution[]>();
  for (const execution of executions) {
    if (!byId.has(execution.workItemId)) continue;
    steps.set(execution.workItemId, [...(steps.get(execution.workItemId) ?? []), execution]);
  }
  const startOf = (execution: Execution): string => execution.startedAt ?? execution.createdAt;
  return items
    .map((item) => {
      const ordered = [...(steps.get(item.id) ?? [])].sort((a, b) =>
        startOf(a).localeCompare(startOf(b))
      );
      return { item, steps: ordered, startedAt: ordered[0] ? startOf(ordered[0]) : item.createdAt };
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** One dated point on a run's path through its statuses. */
export interface RunTimelineEvent {
  at: string;
  kind: "created" | "ran" | "moved";
  /** The status the event happened in. Null when the run's status can no longer be resolved. */
  stageId: string | null;
  /** Where a checkpoint sent the item. Only set on "moved". */
  toStageId?: string | null;
  execution?: Execution;
}

/**
 * A run's history as dated events, oldest first — the rows of the sequence view.
 *
 * Nothing records status transitions: a move is only visible where an agent checkpointed at the
 * end of a run, so a status someone changed by hand on the board leaves no event here. Resolving
 * which status a run executed in, and where it checkpointed to, both need the workspace, so they
 * arrive as callbacks and this stays a pure ordering of what the database already holds.
 */
export function runTimeline(
  run: ProcessRun,
  stageOf: (execution: Execution) => string | null,
  movedTo: (execution: Execution, fromStageId: string | null) => string | null
): RunTimelineEvent[] {
  const events: RunTimelineEvent[] = [
    {
      at: run.item.createdAt,
      kind: "created",
      // The status an item was created in is not stored either; where it first ran is the closest
      // honest stand-in, and its current status is all that is left for a run that never ran.
      stageId: run.steps[0] ? stageOf(run.steps[0]) : run.item.stageId
    }
  ];
  for (const execution of run.steps) {
    const stageId = stageOf(execution);
    events.push({
      at: execution.startedAt ?? execution.createdAt,
      kind: "ran",
      stageId,
      execution
    });
    const toStageId = execution.endedAt ? movedTo(execution, stageId) : null;
    if (toStageId && toStageId !== stageId) {
      events.push({ at: execution.endedAt!, kind: "moved", stageId, toStageId, execution });
    }
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Keys to record when an autonomous run starts: one for the status, one for the exact version
 * of the item. See `needsAutonomousRun` for which of the two blocks a repeat.
 */
export function autonomousRunKeys(item: WorkItem): string[] {
  return [`${item.id}:${item.stageId}`, `${item.id}:${item.stageId}:${item.updatedAt}`];
}

/**
 * Whether a running process still owes this item a run: nothing has run since the item last
 * changed, so a finished run waiting on output review is left alone.
 *
 * A checkpoint is the process moving itself, and an agent that answers with its current status ID
 * would checkpoint in place forever — so a checkpoint buys exactly one run per status. Any other
 * change (an edit, a rejected output) is a person asking for the work again, and always counts.
 */
export function needsAutonomousRun(
  item: WorkItem,
  executions: Execution[],
  startedKeys: ReadonlySet<string>
): boolean {
  if (workItemCondition(item, executions) !== "ready") return false;
  const [stageKey, versionKey] = autonomousRunKeys(item);
  if (startedKeys.has(item.checkpointAt === item.updatedAt ? stageKey! : versionKey!)) return false;
  return !executions.some(
    ({ workItemId, createdAt }) => workItemId === item.id && createdAt >= item.updatedAt
  );
}

export function createId(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

/** Whatever was thrown, as something showable. `catch` gives `unknown`, and this is every use of it. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The sentence inside a machine's error, for the places a person reads.
 *
 * Runtimes, CLIs and HTTP layers each wrap the one useful line in their own envelope, often
 * more than once — `direct(sub_…) failed: 502: {"message":"You've hit your usage limit…"}`,
 * whose message is itself sometimes another JSON document. Everything outside the innermost
 * `message` is addressed to a machine, so unwrap until there is nothing left to unwrap. The
 * raw text stays on the run, which is where someone debugging goes looking for it.
 */
export function readableError(value: string, depth = 4): string {
  const text = value.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (depth <= 0 || start === -1 || end <= start) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return text;
  }
  const message = [parsed]
    .flatMap((value) => (value && typeof value === "object" ? [value as Record<string, unknown>] : []))
    .flatMap((object) => [object.message, (object.error as Record<string, unknown>)?.message])
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "");
  return message ? readableError(message, depth - 1) : text;
}

export function requiredText(value: unknown, field: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be text`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  if (normalized.length > maximum) {
    throw new Error(`${field} must be ${maximum} characters or fewer`);
  }
  return normalized;
}

export function logicalPath(value: unknown): string {
  const path = requiredText(value, "Logical file path", 1_024).replaceAll("\\", "/");
  if (
    path.startsWith("/") ||
    path.startsWith("//") ||
    /^[a-zA-Z]:\//.test(path) ||
    path.split("/").some((segment) => segment === ".." || segment === "." || segment === "")
  ) {
    throw new Error("File references must be relative paths inside a configured folder");
  }
  return path;
}

export function logicalPaths(values: unknown): string[] {
  if (!Array.isArray(values)) {
    throw new Error("Logical file references must be a list");
  }
  return [...new Set(values.map(logicalPath))];
}

/** Coordination stores a stable location id, never a machine-specific absolute folder. */
export const FILE_LOCATION_SEPARATOR = "::";

export function parseLogicalFileReference(value: unknown): {
  locationId: string | null;
  path: string;
} {
  const reference = requiredText(value, "Logical file reference", 1_062);
  const separator = reference.indexOf(FILE_LOCATION_SEPARATOR);
  if (separator < 0) return { locationId: null, path: logicalPath(reference) };
  const locationId = reference.slice(0, separator);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      locationId
    )
  ) {
    throw new Error("Linked file references must start with a location UUID");
  }
  return { locationId, path: logicalPath(reference.slice(separator + FILE_LOCATION_SEPARATOR.length)) };
}

export interface FileTreeNode {
  folders: Map<string, FileTreeNode>;
  files: string[];
}

/** Flat relative paths back into the folder hierarchy the file picker draws. */
export function fileTree(paths: string[]): FileTreeNode {
  const root: FileTreeNode = { folders: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) continue;
    let node = root;
    for (const folder of parts) {
      let child = node.folders.get(folder);
      if (!child) {
        child = { folders: new Map(), files: [] };
        node.folders.set(folder, child);
      }
      node = child;
    }
    node.files.push(name);
  }
  return root;
}

export function logicalFileReference(locationId: string, path: unknown): string {
  const reference = parseLogicalFileReference(
    `${locationId}${FILE_LOCATION_SEPARATOR}${String(path)}`
  );
  return `${reference.locationId}${FILE_LOCATION_SEPARATOR}${reference.path}`;
}

export function logicalFileReferences(values: unknown): string[] {
  if (!Array.isArray(values)) {
    throw new Error("Logical file references must be a list");
  }
  return [
    ...new Set(
      values.map((value) => {
        const reference = parseLogicalFileReference(value);
        return reference.locationId
          ? `${reference.locationId}${FILE_LOCATION_SEPARATOR}${reference.path}`
          : reference.path;
      })
    )
  ];
}

const forbiddenSyncKeys = new Set([
  "absolutePath",
  "content",
  "contents",
  "document",
  "documentBytes",
  "extractedContent",
  "fileBytes",
  "localPath",
  "secret",
  "token"
]);

export function assertMetadataOnly(value: unknown, key = "payload"): void {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => assertMetadataOnly(item, key));
    return;
  }
  if (typeof value !== "object") {
    throw new Error(`${key} contains an unsupported value`);
  }
  for (const [childKey, child] of Object.entries(value)) {
    if (forbiddenSyncKeys.has(childKey)) {
      throw new Error(`${childKey} is not allowed in synchronized metadata`);
    }
    if (childKey === "logicalFiles") {
      logicalFileReferences(child);
    }
    assertMetadataOnly(child, childKey);
  }
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
