import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrent as getCurrentDeepLink, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkForUpdate } from "./updates.js";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification
} from "@tauri-apps/plugin-notification";
import {
  ApiClient,
  apiBaseUrl,
  ApiError,
  defaultApiBaseUrl,
  setApiBaseUrl,
  type AuthResult,
  type PendingInvitation,
  type ServerOrganization,
  type ServerWorkItemClaim,
  type SessionUser
} from "./api.js";
import { TauriDatabase } from "./database.js";
import type {
  Agent,
  Board,
  Execution,
  ExecutionOutput,
  FileLocation,
  GoalTaskEffect,
  LocalWorkspace,
  McpConnection,
  Organization,
  Process,
  Registry,
  Schedule,
  Team,
  WorkItem
} from "./domain.js";
import {
  activeExecutionForItem,
  autonomousRunKeys,
  formatBoardFilters,
  isFiltered,
  isProposal,
  errorText,
  fileTree,
  logicalFileReference,
  needsAutonomousRun,
  parseBoardFilters,
  parseLogicalFileReference,
  processRuns,
  type FileTreeNode,
  type ProcessRun
} from "./domain.js";
import {
  runtimeAgentName,
  FlueProjectService,
  TauriFlueProjectPort
} from "./flue-project.js";
import {
  AgentFileStore,
  TauriAgentFilePort,
  firstTriggerConflict,
  newAgent,
  skillSlug
} from "./agent-files.js";
import { FlueRuntime, type RuntimeEvent } from "./runtime.js";
import {
  conversationToSnapshotV1,
  type BeesConversationSnapshotV1
} from "./conversation-snapshot.js";
import { LocalRepository, type SearchHit } from "./repository.js";
import {
  LOCAL_PROVIDER,
  MODEL_PROVIDERS,
  LocalModelService,
  TauriLocalModelPort,
  modelRef,
  parseModelRef,
  thinkingOptionsForModel,
  type LocalModelProgress,
  type LocalModelView
} from "./local-models.js";
import { RunCoordinator, type SettledRun } from "./run-coordinator.js";
import { drainConversationPurges, purgeNotice } from "./purges.js";
import {
  RegistryFiles,
  capabilityRefsFor,
  registryCapabilities,
  selectedAgentCapabilities
} from "./registries.js";
import { AppOpenScheduler, nextScheduleRun } from "./scheduler.js";
import { HttpSyncTransport, MetadataSyncService } from "./sync.js";
import { runReceipt } from "./run-receipt.js";
import { escalationGroups, needsAttention, workState } from "./supervision.js";
import type { WorkState } from "./supervision.js";
import {
  duration,
  inboxView,
  overviewView,
  runView,
  runsView,
  schedulesView,
  searchResultsView,
  statusBadge,
  when,
  workItemView
} from "./launch-views.js";
import {
  CURATOR_AGENT,
  UNUSED_AFTER_DAYS,
  applyCuratorPlan,
  curatorPrompt,
  parseCuratorPlan,
  resolveCuratorPlan,
  reviewSkills,
  skillSlugOf,
  type ResolvedCuratorAction,
  type SkillReview
} from "./curator.js";
import {
  AI_PROVIDER_LABEL,
  addAiConnection,
  connectApiKey,
  listAiConnections,
  removeAiConnection,
  type AiProvider
} from "./ai-connections.js";
import {
  listMcpConnections,
  mcpConnectionForAgent,
  newMcpConnection,
  removeMcpConnection,
  saveMcpConnection,
  withMcpHealth
} from "./connections.js";
import { BROWSER_TOOL_REF, BROWSER_WRITE_GRANT } from "./run-config.js";
import {
  decide as decideControl,
  flushControlReports,
  loadCachedControl,
  reportHealth,
  reportMetric,
  requestException,
  syncControl,
  type PolicyDecision,
  type PolicyInput,
  type ReportIdentity
} from "./control.js";
import {
  KNOWLEDGE_POLICY_KEY,
  cacheKnowledgePolicy,
  isKnowledgeConnection,
  knowledgeConnection as managedKnowledgeConnection,
  loadCachedKnowledgePolicy,
  parseKnowledgePolicy,
  type KnowledgePolicy
} from "./knowledge.js";
import {
  CLI_TOOLS,
  detectCliTools,
  installCliTool,
  setCliToolPath,
  type CliToolPath
} from "./cli-tools.js";
import {
  completedGoalsReadyForReview,
  goalPlanStages,
  goalStageForRun,
  isGoalsProcess
} from "./processes/goals/runtime.js";
import { GoalsController } from "./processes/goals/controller.js";
import {
  parseTaskPlan,
  type PlannedTask
} from "./processes/goals/index.js";
import {
  PROCESS_LIBRARY,
  processLibraryEntry,
  libraryRename,
  processModule,
  processModuleById,
  processModuleTag,
  processModuleTagForName,
  starterProcessModule,
  type ProcessLibraryEntry,
  type ProcessStudio
} from "./processes/registry.js";
import {
  ASSISTANT_AGENT,
  ASSISTANT_EXTRA_MODELS_KEY,
  ASSISTANT_MODEL_KEY,
  DEFAULT_MODEL_CHOICE,
  applicable,
  applyActions,
  assistantInstanceId,
  effectiveAgentEligibility,
  instanceModelId,
  modelCatalog,
  modelLabel,
  parseBeesUiCommand,
  parseTurn,
  preferredModelChoice,
  resolveActions,
  resolveModelChoice,
  sameChoice,
  turnPrompt,
  type MachineModelAvailability,
  type ModelChoice,
  type ModelOption,
  type ResolvedAction
} from "./assistant.js";
import { executeBeesUiCommand, snapshotBeesUi } from "./assistant-ui.js";
import {
  TemporaryWorkspaceService,
  TauriWorkspacePort,
  type OutputPreview
} from "./workspaces.js";
import { renderMarkdown } from "./markdown.js";
import { COMMUNITY_URL, GETTING_STARTED, HELP_PAGES } from "./help.js";
import { LAST_VIEW_KEY, RESTORABLE_VIEWS, startupView, type View } from "./views.js";
import {
  SoftwareProjectController,
  type ProcessAgentTurn
} from "./processes/software-project/controller.js";
import { createMainViews, type EditorField, type FileSource } from "./app-views.js";
import { createMainActions } from "./app-actions.js";

export type PrefsTab =
  | "theme"
  | "local-models"
  | "remote-models"
  | "mcp-servers"
  | "signins"
  | "orgs"
  | "folder";
export type OrgTab = "general" | "members" | "invites" | "folder" | "knowledge";
export type TeamTab = "members" | "folder" | "integrations" | "browser" | "archived" | "danger";
// All daisyUI v5 built-in themes (keep in sync with themes: all in styles.css).
const THEMES = [
  "light", "dark", "cupcake", "bumblebee", "emerald", "corporate", "synthwave",
  "retro", "cyberpunk", "valentine", "halloween", "garden", "forest", "aqua",
  "lofi", "pastel", "fantasy", "wireframe", "black", "luxury", "dracula", "cmyk",
  "autumn", "business", "acid", "lemonade", "night", "coffee", "winter", "dim",
  "nord", "sunset", "caramellatte", "abyss", "silk"
] as const;
export type ThemePreset = (typeof THEMES)[number];
// daisyUI themes that ship a dark color-scheme (drive the native colorScheme + toggle icon).
const DARK_THEMES = new Set<string>([
  "dark", "synthwave", "halloween", "forest", "aqua", "black", "luxury",
  "dracula", "business", "night", "coffee", "dim", "sunset", "abyss"
]);
const LIGHT_DEFAULT: ThemePreset = "emerald";
const DARK_DEFAULT: ThemePreset = "forest";
const LIGHT_DEFAULT_KEY = "ui_light_theme_preset";
const DARK_DEFAULT_KEY = "ui_dark_theme_preset";
const themePresets: { id: ThemePreset; name: string }[] = THEMES.map((id) => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1)
}));

const repository = new LocalRepository(new TauriDatabase());
const localModels = new LocalModelService(repository, new TauriLocalModelPort());
const workspaces = new TemporaryWorkspaceService(new TauriWorkspacePort());
const flueProjectPort = new TauriFlueProjectPort();
const flueProject = new FlueProjectService(flueProjectPort);
const registryFiles = new RegistryFiles(flueProjectPort);
const agentFiles = new AgentFileStore(new TauriAgentFilePort());
const api = new ApiClient();
const runCoordinator = new RunCoordinator(repository, workspaces, flueProject, ensureFlueRuntime);
const goalsController = new GoalsController({
  findWorkItem: (itemId) => teamItems.find(({ id }) => id === itemId) ?? null,
  findProcess: (processId) => processes.find(({ id }) => id === processId) ?? null,
  readOutput: (execution, output, teamRoot) => {
    if (!execution.workspaceRef) throw new Error("Output workspace is unavailable");
    return workspaces.readOutput(execution.workspaceRef, output.logicalOutput, teamRoot);
  },
  approveTaskPlan: (
    outputId,
    itemId,
    sourceStageId,
    workStageId,
    waitingStageId,
    reviewStageId,
    tasks
  ) => repository.approveTaskPlan(
    outputId,
    itemId,
    sourceStageId,
    workStageId,
    waitingStageId,
    reviewStageId,
    tasks
  ),
  workerRoles: () => goalWorkerRoles().map(({ role }) => role),
  syncCheckpoint: (itemId) => syncCheckpoint(itemId),
  finishOutputReview: (execution) => finishOutputReview(execution)
});
const softwareProjectStudio = new SoftwareProjectController({
  current: () => {
    const item = teamItems.find(({ id }) => id === activeItemId);
    const process = item ? processes.find(({ id }) => id === item.processId) : undefined;
    const stage = process?.stages.find(({ id }) => id === item?.stageId)?.name;
    return item && process && stage ? { item, process, stage } : null;
  },
  getSetting: (key, fallback) => repository.getSetting(key, fallback),
  setSetting: (key, value) => repository.setSetting(key, value),
  runAgentTurns: (item, turns) => runProcessAgentTurns(item, turns, true),
  moveWorkItem: (itemId, stageId) => repository.moveWorkItem(itemId, stageId),
  setWorkItemStatus: (item, status) =>
    repository.updateWorkItem(item.id, {
      title: item.title,
      description: item.description,
      owner: item.owner ?? "",
      status,
      logicalFiles: item.logicalFiles
    }),
  getWorkItem: async (itemId) => (await repository.getWorkItem(itemId)) ?? null,
  requireTeamRoot,
  chooseProjectFolder: async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose project folder"
    });
    return Array.isArray(selected) ? selected[0] ?? null : selected;
  },
  confirm: async (title, message, button) =>
    Boolean(
      await actions.edit(title, [{ name: "warning", label: "", type: "note", value: message }], button)
    ),
  refresh,
  notify: showNotice
});
const processStudios: readonly ProcessStudio[] = [softwareProjectStudio];

/**
 * Boot the immutable Flue app. Rust resolves model credentials from the OS vault; the
 * webview supplies only business scope and never reads a stored secret.
 */
async function ensureFlueRuntime(): Promise<{ baseUrl: string; token: string }> {
  return invoke<{ baseUrl: string; token: string }>("ensure_flue_runtime", {
    organizationId: aiConnectionScope(),
    teamId: workspace.teamId
  });
}

async function loadKnowledgePolicy(force = false): Promise<KnowledgePolicy | null> {
  const organizationId = workspace.organizationId;
  if (!force && knowledgePolicyOrgId === organizationId) return knowledgePolicy;
  let policy = await loadCachedKnowledgePolicy(repository, organizationId);
  const token = orgToken(organizationId);
  if (orgIsConnected(organizationId) && token) {
    try {
      const remote = (await api.listPolicies(token, organizationId)).policies.find(
        ({ key }) => key === KNOWLEDGE_POLICY_KEY
      );
      policy = parseKnowledgePolicy(remote?.value);
      await cacheKnowledgePolicy(repository, organizationId, policy);
    } catch (error) {
      // Offline keeps the last server policy; an invalid policy is surfaced when it is edited.
      if (!(error instanceof ApiError && error.status === 0)) throw error;
    }
  }
  knowledgePolicyOrgId = organizationId;
  knowledgePolicy = policy;
  return policy;
}

async function saveKnowledgePolicy(policy: KnowledgePolicy | null): Promise<void> {
  const organizationId = workspace.organizationId;
  const token = orgToken(organizationId);
  if (orgIsConnected(organizationId)) {
    if (!token) throw new Error("Sign in to change this organization's knowledge mode");
    await api.putPolicy(token, organizationId, KNOWLEDGE_POLICY_KEY, policy);
  }
  await cacheKnowledgePolicy(repository, organizationId, policy);
  knowledgePolicyOrgId = organizationId;
  knowledgePolicy = policy;
  knowledgeError = "";
}

export type KnowledgeRuntimeInfo = { url: string; token: string; sourceCount: number };

/** Resolve the org policy into the one managed MCP connection every bee in this team receives. */
async function ensureKnowledgeConnection(): Promise<McpConnection | null> {
  const policy = await loadKnowledgePolicy(true);
  if (!policy || !workspace.teamId) {
    knowledgeConnection = null;
    return null;
  }
  const stored = await listMcpConnections(repository, workspace.teamId);
  const existing = stored.find(isKnowledgeConnection);
  let connection: McpConnection;
  if (policy.mode === "local") {
    const runtime = await invoke<KnowledgeRuntimeInfo>("ensure_knowledge_worker", {
      organizationId: workspace.organizationId,
      teamId: workspace.teamId
    });
    connection = managedKnowledgeConnection(workspace.teamId, runtime.url, existing);
    await invoke("store_connection_secret", {
      secretRef: connection.secretRef,
      secret: runtime.token
    });
  } else {
    if (!existing) {
      throw new Error("Add the remote worker token for this team under Organization → Knowledge");
    }
    connection = managedKnowledgeConnection(workspace.teamId, policy.url, existing);
  }
  await saveMcpConnection(repository, connection);
  knowledgeConnection = connection;
  knowledgeError = "";
  return connection;
}

// A "connection" = one account signed into one org. The same org reachable by two accounts is
// two connections, hence two switcher icons — you can be in the same org as both accounts at
// once. There is no single "active" account. Tokens live in `accounts`; a connection is just
// the (org, account) pair. `activeUserId` + `workspace.organizationId` name the shown one.
const CONN_SEP = "|";
const connKey = (orgId: string, userId: string): string => `${orgId}${CONN_SEP}${userId}`;
const connParts = (key: string): { orgId: string; userId: string } => {
  const separator = key.indexOf(CONN_SEP);
  return { orgId: key.slice(0, separator), userId: key.slice(separator + 1) };
};
const connections = new Set<string>();
// Every (org, account) pair this desktop has ever connected. A pair missing from here has never
// been logged in on this machine, so reconciliation logs it in on sight; a pair present but not in
// `connections` was logged out on purpose and stays out.
const seenConnections = new Set<string>();
let activeUserId = "";
// Every authenticated account, keyed by user id — independent of orgs, so a user can stay
// signed into several at once. Each account carries the one bearer token for its session.
const accounts = new Map<string, { user: SessionUser; token: string }>();
// Which orgs are server-backed ("connected"). Persisted so it survives sign-out — otherwise
// a signed-out connected org would look local and hide its sign-in controls.
const connectedOrgs = new Set<string>();
// Per-org branding (color + optional logo data URL), stored locally.
// ponytail: local-only, so an admin's logo/color don't sync to other members — add a server
// column + reconcile when shared branding matters.
type OrgBranding = { color?: string; logo?: string };
let orgBranding: Record<string, OrgBranding> = {};
// Server orgs by id, so the UI knows which local orgs are team-enabled (req 3).
let serverOrgs = new Map<string, ServerOrganization>();
// Org invitations waiting for any pooled account, refreshed by reconcileServerOrgs. Only the count
// is used (the Preferences badge); the Orgs tab re-fetches its own rows when it renders.
let pendingInvitations: PendingInvitation[] = [];
// Marks the one-time drop of connected-org teams that predate server-owned team ids.
const LEGACY_TEAMS_PURGED_KEY = "legacy_connected_teams_purged";
const SEEN_CONNECTIONS_KEY = "seen_org_connections";

const providerLabel: Record<string, string> = { google: "Google", github: "GitHub" };

let workspace: LocalWorkspace;
let organizations: Organization[] = [];
let teams: Team[] = [];
let boards: Board[] = [];
let processes: Process[] = [];
let activeBoard: Board | null = null;
let activeProcess: Process | null = null;
let items: WorkItem[] = [];
let teamItems: WorkItem[] = [];
let agents: Agent[] = [];
let executions: Execution[] = [];
let executionOutputs: ExecutionOutput[] = [];
/** Studio items that already have a validated project folder. The rest are waiting on a person. */
let projectFolderItemIds = new Set<string>();
/** What last threw on each item, written by the error boundary and read by the supervision sweep. */
let itemErrors = new Map<string, { message: string; at: string }>();
const DISMISSED_RUNS_KEY = "dismissed_runs";
let dismissedRunIds = new Set<string>();
let schedules: Schedule[] = [];
let registries: Registry[] = [];
let mcpConnections: McpConnection[] = [];
let appVersion = "unknown";
let knowledgePolicy: KnowledgePolicy | null = null;
let knowledgePolicyOrgId = "";
let knowledgeConnection: McpConnection | null = null;
let knowledgeError = "";
let activeExecutionId = "";
let activeItemId = "";
let itemTab: "overview" | "conversation" | "runs" = "overview";
// The process whose editor or run history is open, and the agent whose panel shows on the
// editor. Every agent of the process is in the DOM, so switching panels is a visibility
// toggle: unsaved edits survive it. Empty `configProcessId` on the editor means a new process.
let configProcessId = "";
let configAgentId = "";
/** The work item whose pass through the process is open on the run history page. */
let openRunItemId = "";
const liveEvents = new Map<string, RuntimeEvent[]>();
const outputPreviews = new Map<string, OutputPreview>();
const localModelProgress = new Map<string, LocalModelProgress>();
// Models whose llama-server is booting (or whose download Run is waiting on), so the row keeps its
// Run toggle on while it comes up.
const localModelStarting = new Set<string>();
const localModelDownloads = new Map<string, Promise<boolean>>();
let runnerId = "";
const RUNNING_PROCESSES_KEY = "running_processes";
// Processes the user switched on. Their items run themselves; a stopped process runs nothing.
let runningProcesses = new Set<string>();
let disabledAgentIds = new Set<string>();
// `<itemId>:<stageId>` pairs autopilot already started this session — the loop brake.
const autopilotDone = new Set<string>();
let autopilotBusy = false;
// Left-nav dashboards per team id — every team, not only the open one. See loadDashboardsByTeam.
let dashboardsByTeam = new Map<string, { board: Board; process: Process; count: number }[]>();
let view: View = "overview";
/** Last value written to LAST_VIEW_KEY, so the common render() does not re-write the same row. */
let savedView = "";
// The New work item page: the status column it lands in, and the folders its file picker browses.
let newItemStageId = "";
let newItemSources: FileSource[] = [];
/** The team-record search on the Runs view. Empty shows the recent runs it shows anyway. */
let searchQuery = "";
let searchHits: SearchHit[] = [];
/** Skill curation: the pure review is recomputed on refresh, the proposal only when asked for. */
let skillReviews: SkillReview[] = [];
let curatorBusy = false;
let curatorPlan: { summary: string; actions: ResolvedCuratorAction[] } | null = null;
// The assistant conversation. `pending` is the proposal on the newest turn, waiting for Apply —
// only one at a time, so an approved batch can't be applied twice from scrollback.
type AssistantEntry = {
  role: "you" | "assistant";
  text: string;
  actions?: ResolvedAction[];
  applied?: boolean;
};
let assistantOpen = false;
let assistantBusy = false;
let assistantLogEntries: AssistantEntry[] = [];
let assistantModel: ModelChoice = DEFAULT_MODEL_CHOICE;
let hasUserModelChoice = false;
let assistantExtraModels: ModelChoice[] = [];
let assistantCatalog: ModelOption[] = [];
let machineModelAvailability: MachineModelAvailability = {
  localModelIds: [],
  connectedProviders: [],
  cliProviders: []
};
let assistantPickerOpen = false;
let prefsTab: PrefsTab = "theme";
let orgTab: OrgTab = "general";
let teamTab: TeamTab = "members";
let lightDefaultTheme: ThemePreset = LIGHT_DEFAULT;
let darkDefaultTheme: ThemePreset = DARK_DEFAULT;
let themePreset: ThemePreset = (THEMES as readonly string[]).includes(
  localStorage.getItem("bees-theme-preset") ?? ""
)
  ? (localStorage.getItem("bees-theme-preset") as ThemePreset)
  : "emerald";
const scheduler = new AppOpenScheduler(
  repository,
  () => workspace?.teamId ?? "",
  async (schedule) => {
    try {
      await runScheduledOccurrence(schedule, true);
    } catch (error) {
      const message = errorText(error);
      notifyLocal("Scheduled Bees run could not start", message);
      showNotice(message, "error");
    }
  }
);

const app = document.querySelector<HTMLElement>("#app")!;
const title = document.querySelector<HTMLElement>("#view-title")!;
const context = document.querySelector<HTMLElement>("#view-context")!;
const notice = document.querySelector<HTMLElement>("#notice")!;
const newItem = document.querySelector<HTMLButtonElement>("#new-item")!;
const themeToggle = document.querySelector<HTMLButtonElement>("#theme-toggle")!;
const assistantPanel = document.querySelector<HTMLElement>("#assistant")!;
const assistantToggle = document.querySelector<HTMLButtonElement>("#assistant-toggle")!;
const assistantLog = document.querySelector<HTMLElement>("#assistant-log")!;
const assistantForm = document.querySelector<HTMLFormElement>("#assistant-form")!;
const assistantInput = document.querySelector<HTMLTextAreaElement>("#assistant-input")!;
const assistantSend = document.querySelector<HTMLButtonElement>("#assistant-send")!;
const assistantModelSlot = document.querySelector<HTMLElement>("#assistant-model")!;
const orgRow = document.querySelector<HTMLElement>("#org-row")!;
const orgStatus = document.querySelector<HTMLElement>("#org-status")!;
const teamNav = document.querySelector<HTMLElement>("#team-nav")!;
const sidebarHelp = document.querySelector<HTMLElement>("#sidebar-help")!;
const dialog = document.querySelector<HTMLDialogElement>("#editor")!;
const dialogTitle = document.querySelector<HTMLElement>("#editor-title")!;
const dialogFields = document.querySelector<HTMLElement>("#editor-fields")!;
const dialogForm = document.querySelector<HTMLFormElement>("#editor-form")!;
const dialogFooter = document.querySelector<HTMLElement>("#editor-footer")!;
const markdownDialog = document.querySelector<HTMLDialogElement>("#markdown-viewer")!;
const markdownTitle = document.querySelector<HTMLElement>("#markdown-viewer-title")!;
const markdownBody = document.querySelector<HTMLElement>("#markdown-viewer-body")!;
const appDrawer = document.querySelector<HTMLInputElement>("#app-drawer")!;
const appDrawerOpen = document.querySelector<HTMLButtonElement>("#app-drawer-open")!;
const appNavigation = document.querySelector<HTMLElement>("#app-navigation")!;

const mainViewHost = {
  get AI_PROVIDER_MODEL_PREFIX() { return AI_PROVIDER_MODEL_PREFIX; },
  get accounts() { return accounts; },
  get activeBoard() { return activeBoard; },
  set activeBoard(value: typeof activeBoard) { activeBoard = value; },
  get activeClass() { return activeClass; },
  get activeExecutionId() { return activeExecutionId; },
  set activeExecutionId(value: typeof activeExecutionId) { activeExecutionId = value; },
  get activeItemId() { return activeItemId; },
  set activeItemId(value: typeof activeItemId) { activeItemId = value; },
  get activeOrgTeamEnabled() { return activeOrgTeamEnabled; },
  get activeProcess() { return activeProcess; },
  set activeProcess(value: typeof activeProcess) { activeProcess = value; },
  get activeServerOrg() { return activeServerOrg; },
  get activeUserId() { return activeUserId; },
  set activeUserId(value: typeof activeUserId) { activeUserId = value; },
  get agentForItem() { return agentForItem; },
  get agents() { return agents; },
  set agents(value: typeof agents) { agents = value; },
  get aiConnectionScope() { return aiConnectionScope; },
  get api() { return api; },
  get app() { return app; },
  get assistantBusy() { return assistantBusy; },
  set assistantBusy(value: typeof assistantBusy) { assistantBusy = value; },
  get assistantCatalog() { return assistantCatalog; },
  set assistantCatalog(value: typeof assistantCatalog) { assistantCatalog = value; },
  get assistantLog() { return assistantLog; },
  get assistantLogEntries() { return assistantLogEntries; },
  set assistantLogEntries(value: typeof assistantLogEntries) { assistantLogEntries = value; },
  get assistantModel() { return assistantModel; },
  set assistantModel(value: typeof assistantModel) { assistantModel = value; },
  get assistantModelSlot() { return assistantModelSlot; },
  get assistantOpen() { return assistantOpen; },
  set assistantOpen(value: typeof assistantOpen) { assistantOpen = value; },
  get assistantPanel() { return assistantPanel; },
  get assistantPickerOpen() { return assistantPickerOpen; },
  set assistantPickerOpen(value: typeof assistantPickerOpen) { assistantPickerOpen = value; },
  get assistantSend() { return assistantSend; },
  get brandingFor() { return brandingFor; },
  get configAgentId() { return configAgentId; },
  set configAgentId(value: typeof configAgentId) { configAgentId = value; },
  get configProcessId() { return configProcessId; },
  set configProcessId(value: typeof configProcessId) { configProcessId = value; },
  get connKey() { return connKey; },
  get connParts() { return connParts; },
  get connections() { return connections; },
  get curatorBusy() { return curatorBusy; },
  set curatorBusy(value: typeof curatorBusy) { curatorBusy = value; },
  get curatorPlan() { return curatorPlan; },
  set curatorPlan(value: typeof curatorPlan) { curatorPlan = value; },
  get currentOrganization() { return currentOrganization; },
  get currentTeam() { return currentTeam; },
  get currentUser() { return currentUser; },
  get darkDefaultTheme() { return darkDefaultTheme; },
  set darkDefaultTheme(value: typeof darkDefaultTheme) { darkDefaultTheme = value; },
  get dashboardsByTeam() { return dashboardsByTeam; },
  set dashboardsByTeam(value: typeof dashboardsByTeam) { dashboardsByTeam = value; },
  get defaultOrgColor() { return defaultOrgColor; },
  get disabledAgentIds() { return disabledAgentIds; },
  set disabledAgentIds(value: typeof disabledAgentIds) { disabledAgentIds = value; },
  get eligibilityForAgent() { return eligibilityForAgent; },
  get escapeHtml() { return escapeHtml; },
  get executionOutputs() { return executionOutputs; },
  set executionOutputs(value: typeof executionOutputs) { executionOutputs = value; },
  get executions() { return executions; },
  set executions(value: typeof executions) { executions = value; },
  get formatBytes() { return formatBytes; },
  get itemTab() { return itemTab; },
  set itemTab(value: typeof itemTab) { itemTab = value; },
  get items() { return items; },
  set items(value: typeof items) { items = value; },
  get knowledgeError() { return knowledgeError; },
  set knowledgeError(value: typeof knowledgeError) { knowledgeError = value; },
  get lightDefaultTheme() { return lightDefaultTheme; },
  set lightDefaultTheme(value: typeof lightDefaultTheme) { lightDefaultTheme = value; },
  get liveEvents() { return liveEvents; },
  get loadKnowledgePolicy() { return loadKnowledgePolicy; },
  get localModelProgress() { return localModelProgress; },
  get localModelStarting() { return localModelStarting; },
  get localModels() { return localModels; },
  get machineModelAvailability() { return machineModelAvailability; },
  set machineModelAvailability(value: typeof machineModelAvailability) { machineModelAvailability = value; },
  get mcpConnections() { return mcpConnections; },
  set mcpConnections(value: typeof mcpConnections) { mcpConnections = value; },
  get newItemSources() { return newItemSources; },
  set newItemSources(value: typeof newItemSources) { newItemSources = value; },
  get newItemStageId() { return newItemStageId; },
  set newItemStageId(value: typeof newItemStageId) { newItemStageId = value; },
  get openRunItemId() { return openRunItemId; },
  set openRunItemId(value: typeof openRunItemId) { openRunItemId = value; },
  get openWork() { return openWork; },
  get orgIsConnected() { return orgIsConnected; },
  get orgLogoPreview() { return orgLogoPreview; },
  get orgRow() { return orgRow; },
  get orgSignedIn() { return orgSignedIn; },
  get orgStatus() { return orgStatus; },
  get orgTab() { return orgTab; },
  set orgTab(value: typeof orgTab) { orgTab = value; },
  get orgToken() { return orgToken; },
  get organizations() { return organizations; },
  set organizations(value: typeof organizations) { organizations = value; },
  get outputPreviews() { return outputPreviews; },
  get overviewAssistantModels() { return overviewAssistantModels; },
  get pendingInvitations() { return pendingInvitations; },
  set pendingInvitations(value: typeof pendingInvitations) { pendingInvitations = value; },
  get prefsTab() { return prefsTab; },
  set prefsTab(value: typeof prefsTab) { prefsTab = value; },
  get processStudios() { return processStudios; },
  get processes() { return processes; },
  set processes(value: typeof processes) { processes = value; },
  get providerLabel() { return providerLabel; },
  get registries() { return registries; },
  set registries(value: typeof registries) { registries = value; },
  get render() { return render; },
  get repository() { return repository; },
  get runStageId() { return runStageId; },
  get runningProcesses() { return runningProcesses; },
  set runningProcesses(value: typeof runningProcesses) { runningProcesses = value; },
  get searchQuery() { return searchQuery; },
  set searchQuery(value: typeof searchQuery) { searchQuery = value; },
  get setHeader() { return setHeader; },
  get sidebarHelp() { return sidebarHelp; },
  get skillReviews() { return skillReviews; },
  set skillReviews(value: typeof skillReviews) { skillReviews = value; },
  get supervise() { return supervise; },
  get swap() { return swap; },
  get teamItems() { return teamItems; },
  set teamItems(value: typeof teamItems) { teamItems = value; },
  get teamNav() { return teamNav; },
  get teamTab() { return teamTab; },
  set teamTab(value: typeof teamTab) { teamTab = value; },
  get teams() { return teams; },
  set teams(value: typeof teams) { teams = value; },
  get themePreset() { return themePreset; },
  set themePreset(value: typeof themePreset) { themePreset = value; },
  get themePresets() { return themePresets; },
  get view() { return view; },
  set view(value: typeof view) { view = value; },
  get workspace() { return workspace; },
  set workspace(value: typeof workspace) { workspace = value; },
  get workspaces() { return workspaces; },
};
export type MainViewHost = typeof mainViewHost;
const views = createMainViews(mainViewHost);

const mainActionHost = {
  get AI_PROVIDER_HINT() { return AI_PROVIDER_HINT; },
  get DARK_THEMES() { return DARK_THEMES; },
  get DISMISSED_RUNS_KEY() { return DISMISSED_RUNS_KEY; },
  get accounts() { return accounts; },
  get activeBoard() { return activeBoard; },
  set activeBoard(value: typeof activeBoard) { activeBoard = value; },
  get activeItemId() { return activeItemId; },
  set activeItemId(value: typeof activeItemId) { activeItemId = value; },
  get activeProcess() { return activeProcess; },
  set activeProcess(value: typeof activeProcess) { activeProcess = value; },
  get activeUserId() { return activeUserId; },
  set activeUserId(value: typeof activeUserId) { activeUserId = value; },
  get agentFiles() { return agentFiles; },
  get agents() { return agents; },
  set agents(value: typeof agents) { agents = value; },
  get aiConnectionScope() { return aiConnectionScope; },
  get api() { return api; },
  get app() { return app; },
  get appDrawer() { return appDrawer; },
  get appDrawerOpen() { return appDrawerOpen; },
  get appNavigation() { return appNavigation; },
  get assistantBusy() { return assistantBusy; },
  set assistantBusy(value: typeof assistantBusy) { assistantBusy = value; },
  get assistantCatalog() { return assistantCatalog; },
  set assistantCatalog(value: typeof assistantCatalog) { assistantCatalog = value; },
  get assistantContext() { return assistantContext; },
  get assistantExtraModels() { return assistantExtraModels; },
  set assistantExtraModels(value: typeof assistantExtraModels) { assistantExtraModels = value; },
  get assistantForm() { return assistantForm; },
  get assistantInput() { return assistantInput; },
  get assistantLogEntries() { return assistantLogEntries; },
  set assistantLogEntries(value: typeof assistantLogEntries) { assistantLogEntries = value; },
  get assistantModel() { return assistantModel; },
  set assistantModel(value: typeof assistantModel) { assistantModel = value; },
  get assistantModelSlot() { return assistantModelSlot; },
  get assistantOpen() { return assistantOpen; },
  set assistantOpen(value: typeof assistantOpen) { assistantOpen = value; },
  get assistantPanel() { return assistantPanel; },
  get assistantPickerOpen() { return assistantPickerOpen; },
  set assistantPickerOpen(value: typeof assistantPickerOpen) { assistantPickerOpen = value; },
  get assistantToggle() { return assistantToggle; },
  get autopilot() { return autopilot; },
  get boards() { return boards; },
  set boards(value: typeof boards) { boards = value; },
  get brandingFor() { return brandingFor; },
  get configAgentId() { return configAgentId; },
  set configAgentId(value: typeof configAgentId) { configAgentId = value; },
  get configProcessId() { return configProcessId; },
  set configProcessId(value: typeof configProcessId) { configProcessId = value; },
  get connParts() { return connParts; },
  get connect() { return connect; },
  get connectedOrgs() { return connectedOrgs; },
  get connections() { return connections; },
  get controlInput() { return controlInput; },
  get createConnectedOrg() { return createConnectedOrg; },
  get createLocalOrg() { return createLocalOrg; },
  get createServerTeam() { return createServerTeam; },
  get curatorBusy() { return curatorBusy; },
  set curatorBusy(value: typeof curatorBusy) { curatorBusy = value; },
  get curatorPlan() { return curatorPlan; },
  set curatorPlan(value: typeof curatorPlan) { curatorPlan = value; },
  get currentOrganization() { return currentOrganization; },
  get currentTeam() { return currentTeam; },
  get darkDefaultTheme() { return darkDefaultTheme; },
  set darkDefaultTheme(value: typeof darkDefaultTheme) { darkDefaultTheme = value; },
  get deleteRun() { return deleteRun; },
  get dialog() { return dialog; },
  get dialogFields() { return dialogFields; },
  get dialogFooter() { return dialogFooter; },
  get dialogForm() { return dialogForm; },
  get dialogTitle() { return dialogTitle; },
  get disabledAgentIds() { return disabledAgentIds; },
  set disabledAgentIds(value: typeof disabledAgentIds) { disabledAgentIds = value; },
  get disconnect() { return disconnect; },
  get dismissedRunIds() { return dismissedRunIds; },
  set dismissedRunIds(value: typeof dismissedRunIds) { dismissedRunIds = value; },
  get displayFileReferences() { return views.displayFileReferences; },
  get editorFieldHtml() { return views.editorFieldHtml; },
  get enforceControl() { return enforceControl; },
  get ensureFlueRuntime() { return ensureFlueRuntime; },
  get ensureOrgFolders() { return ensureOrgFolders; },
  get ensureTeamSkillsRegistry() { return ensureTeamSkillsRegistry; },
  get escapeHtml() { return escapeHtml; },
  get executionOutputs() { return executionOutputs; },
  set executionOutputs(value: typeof executionOutputs) { executionOutputs = value; },
  get executions() { return executions; },
  set executions(value: typeof executions) { executions = value; },
  get fileReferenceHint() { return views.fileReferenceHint; },
  get finishOutputReview() { return finishOutputReview; },
  get flueProjectPort() { return flueProjectPort; },
  get goalWorkerRoles() { return goalWorkerRoles; },
  get goalsController() { return goalsController; },
  get isThemePreset() { return isThemePreset; },
  get itemTab() { return itemTab; },
  set itemTab(value: typeof itemTab) { itemTab = value; },
  get items() { return items; },
  set items(value: typeof items) { items = value; },
  get knowledgeConnection() { return knowledgeConnection; },
  set knowledgeConnection(value: typeof knowledgeConnection) { knowledgeConnection = value; },
  get knowledgeError() { return knowledgeError; },
  set knowledgeError(value: typeof knowledgeError) { knowledgeError = value; },
  get libraryAgentEligibility() { return views.libraryAgentEligibility; },
  get lightDefaultTheme() { return lightDefaultTheme; },
  set lightDefaultTheme(value: typeof lightDefaultTheme) { lightDefaultTheme = value; },
  get loadExecutionHistory() { return loadExecutionHistory; },
  get loadKnowledgePolicy() { return loadKnowledgePolicy; },
  get localModelDownloads() { return localModelDownloads; },
  get localModelProgress() { return localModelProgress; },
  get localModelStarting() { return localModelStarting; },
  get localModels() { return localModels; },
  get markdownBody() { return markdownBody; },
  get markdownDialog() { return markdownDialog; },
  get markdownTitle() { return markdownTitle; },
  get mcpConnections() { return mcpConnections; },
  set mcpConnections(value: typeof mcpConnections) { mcpConnections = value; },
  get newItem() { return newItem; },
  get newItemSources() { return newItemSources; },
  set newItemSources(value: typeof newItemSources) { newItemSources = value; },
  get newItemStageId() { return newItemStageId; },
  set newItemStageId(value: typeof newItemStageId) { newItemStageId = value; },
  get openRun() { return openRun; },
  get openRunItemId() { return openRunItemId; },
  set openRunItemId(value: typeof openRunItemId) { openRunItemId = value; },
  get orgBranding() { return orgBranding; },
  set orgBranding(value: typeof orgBranding) { orgBranding = value; },
  get orgHasConnection() { return orgHasConnection; },
  get orgIsConnected() { return orgIsConnected; },
  get orgTab() { return orgTab; },
  set orgTab(value: typeof orgTab) { orgTab = value; },
  get orgToken() { return orgToken; },
  get outputPreviews() { return outputPreviews; },
  get overviewAssistantModels() { return overviewAssistantModels; },
  get persistConnections() { return persistConnections; },
  get prefsTab() { return prefsTab; },
  set prefsTab(value: typeof prefsTab) { prefsTab = value; },
  get probeKnowledgeConnection() { return probeKnowledgeConnection; },
  get processStudios() { return processStudios; },
  get processes() { return processes; },
  set processes(value: typeof processes) { processes = value; },
  get proposeSkillEdit() { return proposeSkillEdit; },
  get reconcileServerOrgs() { return reconcileServerOrgs; },
  get refresh() { return refresh; },
  get refreshAssistantCatalog() { return refreshAssistantCatalog; },
  get registries() { return registries; },
  set registries(value: typeof registries) { registries = value; },
  get registryFiles() { return registryFiles; },
  get releaseClaim() { return releaseClaim; },
  get rememberAccount() { return rememberAccount; },
  get rememberModelChoice() { return rememberModelChoice; },
  get rememberRejection() { return rememberRejection; },
  get render() { return render; },
  get renderAssistant() { return views.renderAssistant; },
  get renderRunDetail() { return views.renderRunDetail; },
  get reportFailure() { return reportFailure; },
  get repository() { return repository; },
  get requireTeamRoot() { return requireTeamRoot; },
  get runCoordinator() { return runCoordinator; },
  get runItem() { return runItem; },
  get runScheduledOccurrence() { return runScheduledOccurrence; },
  get saveBranding() { return saveBranding; },
  get saveDefaultTheme() { return saveDefaultTheme; },
  get saveKnowledgePolicy() { return saveKnowledgePolicy; },
  get saveTheme() { return saveTheme; },
  get scheduleItems() { return scheduleItems; },
  get schedules() { return schedules; },
  set schedules(value: typeof schedules) { schedules = value; },
  get scopedFormData() { return scopedFormData; },
  get searchHits() { return searchHits; },
  set searchHits(value: typeof searchHits) { searchHits = value; },
  get searchQuery() { return searchQuery; },
  set searchQuery(value: typeof searchQuery) { searchQuery = value; },
  get setBrandingValue() { return setBrandingValue; },
  get setProcessRunning() { return setProcessRunning; },
  get showNotice() { return showNotice; },
  get signInUser() { return signInUser; },
  get signOutAccount() { return signOutAccount; },
  get signUpUser() { return signUpUser; },
  get skillReviews() { return skillReviews; },
  set skillReviews(value: typeof skillReviews) { skillReviews = value; },
  get socialSignInUser() { return socialSignInUser; },
  get stageName() { return views.stageName; },
  get switchConnection() { return switchConnection; },
  get switchOrganization() { return switchOrganization; },
  get switchTeam() { return switchTeam; },
  get teamItems() { return teamItems; },
  set teamItems(value: typeof teamItems) { teamItems = value; },
  get teamTab() { return teamTab; },
  set teamTab(value: typeof teamTab) { teamTab = value; },
  get teams() { return teams; },
  set teams(value: typeof teams) { teams = value; },
  get themePreset() { return themePreset; },
  set themePreset(value: typeof themePreset) { themePreset = value; },
  get triggerContext() { return views.triggerContext; },
  get view() { return view; },
  set view(value: typeof view) { view = value; },
  get workspace() { return workspace; },
  set workspace(value: typeof workspace) { workspace = value; },
  get workspaces() { return workspaces; },
};
export type MainActionHost = typeof mainActionHost;
const actions = createMainActions(mainActionHost);

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function isThemePreset(value: unknown): value is ThemePreset {
  return (THEMES as readonly string[]).includes(String(value));
}

function applyTheme(): void {
  const dark = DARK_THEMES.has(themePreset);
  document.documentElement.dataset.theme = themePreset;
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  localStorage.setItem("bees-theme-preset", themePreset);
  themeToggle.innerHTML = dark
    ? '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>'
    : '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.4 15.5A8.5 8.5 0 0 1 8.5 3.6 8.5 8.5 0 1 0 20.4 15.5Z"></path></svg>';
  const label = `Switch to ${dark ? "light" : "dark"} mode`;
  themeToggle.setAttribute("aria-label", label);
  themeToggle.title = label;
}

async function saveTheme(preset: ThemePreset): Promise<void> {
  themePreset = preset;
  applyTheme();
  await repository.setSetting("ui_theme_preset", preset);
}

async function saveDefaultTheme(mode: "light" | "dark", preset: ThemePreset): Promise<void> {
  if (mode === "light") lightDefaultTheme = preset;
  else darkDefaultTheme = preset;
  await repository.setSetting(mode === "light" ? LIGHT_DEFAULT_KEY : DARK_DEFAULT_KEY, preset);
}

async function loadTheme(): Promise<void> {
  const [storedPreset, storedLightDefault, storedDarkDefault] = await Promise.all([
    repository.getSetting("ui_theme_preset", themePreset),
    repository.getSetting(LIGHT_DEFAULT_KEY, LIGHT_DEFAULT),
    repository.getSetting(DARK_DEFAULT_KEY, DARK_DEFAULT)
  ]);
  if (isThemePreset(storedPreset)) themePreset = storedPreset;
  if (isThemePreset(storedLightDefault)) lightDefaultTheme = storedLightDefault;
  if (isThemePreset(storedDarkDefault)) darkDefaultTheme = storedDarkDefault;
  applyTheme();
}

applyTheme();

function swap(content: string): void {
  app.innerHTML = content;
  app.setAttribute("aria-busy", "false");
}

function showNotice(
  message: string,
  kind: "info" | "success" | "error" = "info",
  undo?: () => Promise<void>
): void {
  const color = kind === "error" ? "alert-error" : kind === "success" ? "alert-success" : "alert-info";
  notice.innerHTML = `<div class="alert ${color} shadow-sm"><span>${escapeHtml(message)}</span>${
    undo ? '<button class="btn btn-ghost btn-sm">Undo</button>' : ""
  }</div>`;
  const shown = notice.firstElementChild;
  shown?.querySelector("button")?.addEventListener("click", () => {
    void undo?.().then(() => showNotice("Rule removed", "success")).catch((error) => showNotice(errorText(error), "error"));
  }, { once: true });
  window.setTimeout(() => {
    if (notice.firstElementChild === shown) notice.innerHTML = "";
  }, 5_000);
}

function currentOrganization(): Organization | undefined {
  return organizations.find(({ id }) => id === workspace.organizationId);
}

function currentTeam(): Team | undefined {
  return teams.find(({ id }) => id === workspace.teamId);
}

/** Work items the Schedules view covers — the open process's, or the team's when none is open. */
function scheduleItems(): WorkItem[] {
  if (!configProcessId) return teamItems;
  return teamItems.filter(({ processId }) => processId === configProcessId);
}

function activeServerOrg(): ServerOrganization | undefined {
  return serverOrgs.get(workspace.organizationId);
}

function activeOrgTeamEnabled(): boolean {
  return activeServerOrg()?.teamEnabled ?? false;
}

/** First account connected to an org (used when a plain org id needs any connection). */
function firstConnUser(orgId: string): string {
  for (const key of connections) {
    const part = connParts(key);
    if (part.orgId === orgId) return part.userId;
  }
  return "";
}

/** Whether any account is connected to this org. */
function orgHasConnection(orgId: string): boolean {
  return firstConnUser(orgId) !== "";
}

/** The account pool entry backing the active connection. */
function activeAccount(): { user: SessionUser; token: string } | undefined {
  return accounts.get(activeUserId);
}

/** Token for server calls in the given org = its active connection's account token. */
function orgToken(orgId = workspace.organizationId): string | null {
  const userId = orgId === workspace.organizationId ? activeUserId : firstConnUser(orgId);
  return userId ? (accounts.get(userId)?.token ?? null) : null;
}

/** The account backing the active connection (for "you" / "signed in as" display). */
function currentUser(): SessionUser | null {
  return activeAccount()?.user ?? null;
}

/** Whether the current org has an active connection (the shown account is signed into it). */
function orgSignedIn(orgId = workspace.organizationId): boolean {
  return orgId === workspace.organizationId
    ? connections.has(connKey(orgId, activeUserId))
    : orgHasConnection(orgId);
}

/**
 * Rebuild the server-org map from EVERY signed-in account, not just one. Each account may
 * own a different set of orgs; merging keeps them all visible regardless of which org is open.
 */
async function reconcileServerOrgs(): Promise<void> {
  serverOrgs = new Map();
  const invitations: PendingInvitation[] = [];
  const droppedFrom = new Set<string>(); // orgs an account got removed from server-side
  let accountsChanged = false;
  for (const { user, token } of accounts.values()) {
    let remote: ServerOrganization[];
    try {
      ({ organizations: remote } = await api.listOrganizations(token));
    } catch (error) {
      // A rejected token is signed out, not offline. Keeping it made the UI claim the account
      // was signed in until its next authenticated action failed with "Sign in required".
      if (error instanceof ApiError && error.status === 401) {
        accounts.delete(user.id);
        accountsChanged = true;
        forgetAccountConnections(user.id);
      }
      continue; // an unreachable server must not sign out otherwise-valid accounts
    }
    // Invitations are not memberships, so the org list never mentions them. Pulled here so a
    // pending invite can badge the UI without the user opening Preferences. Its own catch: a
    // failure here must not cost this account its orgs.
    invitations.push(
      ...(await api.myInvitations(token).then((r) => r.invitations).catch(() => []))
    );
    // listOrganizations only returns orgs the account still belongs to. A connection to any org
    // no longer in that set means this account was removed from it — drop the stale connection.
    const ids = new Set(remote.map((org) => org.id));
    for (const key of [...connections]) {
      const part = connParts(key);
      if (part.userId === user.id && !ids.has(part.orgId)) {
        connections.delete(key);
        droppedFrom.add(part.orgId);
      }
    }
    for (const org of remote) {
      await repository.upsertServerOrganization(org.id, org.name);
      // A membership this desktop has never logged in (org created on the web, joined from another
      // machine, or this account added to an org another account already uses) is signed in on
      // sight — otherwise it has an org with no icon and no way in. Per (org, account), so a
      // second account joining a familiar org still gets connected, and a deliberate Logout —
      // which leaves the pair marked seen — stays logged out.
      const key = connKey(org.id, user.id);
      if (!seenConnections.has(key)) {
        connections.add(key);
        seenConnections.add(key);
      }
      serverOrgs.set(org.id, org);
      connectedOrgs.add(org.id);
    }
  }
  // An org nobody is connected to anymore: forget it and its cached boards so its icon vanishes.
  for (const orgId of droppedFrom) {
    if ([...connections].some((key) => connParts(key).orgId === orgId)) continue;
    connectedOrgs.delete(orgId);
    await repository.deleteOrganization(orgId);
  }
  pendingInvitations = invitations;
  if (accountsChanged) await persistAccounts();
  await persistConnections();
  await repository.setSetting("connected_org_ids", JSON.stringify([...connectedOrgs]));
  await reconcileServerTeams();
}

/**
 * Pull each connected org's teams into the local store so every desktop in the org shares the same
 * team ids — without this a second machine sees the org and no teams at all. Upsert only: a failed
 * or partial list (a plain member only sees their own teams) must never delete local work.
 */
async function reconcileServerTeams(): Promise<void> {
  await purgeLegacyConnectedTeams();
  for (const orgId of connectedOrgs) {
    const token = orgToken(orgId);
    if (!token) continue; // logged out of this org: nothing to pull with
    const remote = await api.listTeams(token, orgId).then(({ teams: list }) => list).catch(() => null);
    if (!remote) continue; // offline or rejected — keep what is already local
    for (const team of remote) await repository.upsertServerTeam(team.id, orgId, team.name);
  }
}

/**
 * One-time cleanup. Teams created in a connected org before ids became server-owned carry a local
 * id no other desktop can resolve, so they would sit next to the server's copy forever. They are
 * dropped (with their work items) and the server list above becomes the only truth. Local orgs are
 * untouched.
 */
async function purgeLegacyConnectedTeams(): Promise<void> {
  if (await repository.getSetting(LEGACY_TEAMS_PURGED_KEY, false)) return;
  for (const orgId of connectedOrgs) {
    for (const team of await repository.listTeams(orgId)) await repository.deleteTeam(team.id);
  }
  await repository.setSetting(LEGACY_TEAMS_PURGED_KEY, true);
}

/**
 * Drop every connection an account backed, and forget that it ever had them: signing the account
 * out is a whole-account decision, so signing back in should auto-connect its orgs again rather
 * than leave them looking logged-out with no way to tell why. Caller persists.
 */
function forgetAccountConnections(userId: string): void {
  for (const key of [...connections]) {
    if (connParts(key).userId === userId) connections.delete(key);
  }
  for (const key of [...seenConnections]) {
    if (connParts(key).userId === userId) seenConnections.delete(key);
  }
}

async function persistConnections(): Promise<void> {
  await repository.setSetting("org_connections", JSON.stringify([...connections]));
  await repository.setSetting(SEEN_CONNECTIONS_KEY, JSON.stringify([...seenConnections]));
}

async function persistAccounts(): Promise<void> {
  await repository.setSetting("account_sessions", JSON.stringify([...accounts.values()]));
}

/** Add (or refresh) an account in the pool without disturbing any other signed-in account. */
async function rememberAccount(user: SessionUser, token: string): Promise<void> {
  accounts.set(user.id, { user, token });
  await persistAccounts();
}

/** Record that `user` is connected to `orgId` (its account already validated). */
async function connect(orgId: string, user: SessionUser, token: string): Promise<void> {
  await rememberAccount(user, token);
  connections.add(connKey(orgId, user.id));
  seenConnections.add(connKey(orgId, user.id)); // a later Logout must not be undone by reconciling
  await persistConnections();
}

/** Remove one (org, account) connection; move off it if it was the active one. */
async function disconnect(orgId: string, userId: string): Promise<void> {
  connections.delete(connKey(orgId, userId));
  await persistConnections();
  await reconcileServerOrgs().catch(() => {});
  if (workspace.organizationId === orgId && activeUserId === userId) {
    if (!(await moveOffHidden())) await refresh();
  } else {
    await refresh();
  }
  showNotice("Signed out of this organization", "success");
}

// ---- Sign-in primitives: authenticate (setting api.token) and return the user, no org binding. ----

async function signInUser(): Promise<AuthResult | null> {
  const data = await actions.edit("Sign in", [
    { name: "email", label: "Email", placeholder: "you@example.com" },
    { name: "password", label: "Password", type: "password" }
  ]);
  if (!data) return null;
  return api.signInEmail(String(data.get("email") ?? ""), String(data.get("password") ?? ""));
}

async function signUpUser(): Promise<AuthResult | null> {
  const data = await actions.edit("Create your account", [
    { name: "name", label: "Name" },
    { name: "email", label: "Email", placeholder: "you@example.com" },
    { name: "password", label: "Password", type: "password" }
  ]);
  if (!data) return null;
  return api.signUpEmail(
    String(data.get("name") ?? ""),
    String(data.get("email") ?? ""),
    String(data.get("password") ?? "")
  );
}

/**
 * Browser-based social sign-in via a loopback listener: the app binds a local port,
 * opens the browser, and the finished OAuth flow redirects the session token back to
 * that port over http. No custom URL scheme, so it works under `tauri dev` too.
 */
async function socialSignInUser(provider: string): Promise<AuthResult | null> {
  const port = await invoke<number>("oauth_start");
  await openUrl(api.socialSignInUrl(provider, `http://127.0.0.1:${port}/callback`));
  showNotice(`Continue with ${providerLabel[provider] ?? provider} in your browser`, "success");
  const token = new URLSearchParams(await invoke<string>("oauth_await")).get("token");
  return token ? api.resumeSession(token) : null;
}

/** Pick a sign-in method, run it, and return the authenticated account. */
async function promptSignIn(title: string): Promise<AuthResult | null> {
  const options = [
    ...Object.entries(providerLabel).map(([value, label]) => ({ label: `Continue with ${label}`, value })),
    { label: "Email — sign in", value: "signin" },
    { label: "Email — create account", value: "signup" }
  ];
  const auth = await actions.edit(title, [{ name: "method", label: "Continue with", type: "select", options }]);
  if (!auth) return null;
  const method = String(auth.get("method"));
  const result =
    method in providerLabel
      ? await socialSignInUser(method)
      : method === "signup"
        ? await signUpUser()
        : await signInUser();
  if (!result) showNotice("Sign in failed", "error");
  return result;
}

/** Is the active connection still openable? Local orgs always; connected orgs need the pair. */
function activeConnectionValid(): boolean {
  const orgId = workspace.organizationId;
  if (!orgId) return false;
  if (!orgIsConnected(orgId)) return true;
  return connections.has(connKey(orgId, activeUserId));
}

/**
 * If the active connection just became unopenable (signed out), move to any remaining
 * connection — or a local org, or Preferences → Orgs when none remain. Refreshes either way.
 * Returns true if it handled the refresh (caller then skips its own).
 */
async function moveOffHidden(): Promise<boolean> {
  if (activeConnectionValid()) return false;
  const first = [...connections][0];
  if (first) {
    const { orgId, userId } = connParts(first);
    await switchConnection(orgId, userId);
    return true;
  }
  const local = organizations.find(({ id }) => !orgIsConnected(id));
  if (local) {
    await switchConnection(local.id, "");
    return true;
  }
  workspace.organizationId = "";
  activeUserId = "";
  view = "preferences";
  prefsTab = "orgs";
  await refresh();
  return true;
}

/** Drop one account from the pool and every connection it backed. */
async function signOutAccount(userId: string): Promise<void> {
  const account = accounts.get(userId);
  accounts.delete(userId);
  await persistAccounts();
  forgetAccountConnections(userId);
  await persistConnections();
  await reconcileServerOrgs().catch(() => {});
  if (!(await moveOffHidden())) await refresh();
  showNotice(`Signed out ${account?.user.email ?? "account"}`, "success");
}

/** Handle the OAuth deep link (bees://auth/callback?token=…) delivered by the browser. */
async function handleAuthCallback(urls: string[]): Promise<void> {
  const token = urls
    .map((raw) => {
      try {
        return new URL(raw).searchParams.get("token");
      } catch {
        return null;
      }
    })
    .find(Boolean);
  if (!token) return;
  const result = await api.resumeSession(token);
  if (!result) {
    showNotice("Sign in failed", "error");
    return;
  }
  await rememberAccount(result.user, result.token);
  // Connect this account to the current org only if it's a connected org with no connection yet.
  if (orgIsConnected(workspace.organizationId) && !orgHasConnection(workspace.organizationId)) {
    await connect(workspace.organizationId, result.user, result.token);
    activeUserId = result.user.id;
  }
  try {
    await reconcileServerOrgs();
  } catch (error) {
    showNotice(errorText(error), "error");
  }
  await refresh();
  showNotice(`Signed in as ${result.user.email}`, "success");
}

/**
 * Handle an invite deep link (bees://invite/<id>) from the emailed link. Open the org-invites
 * view and, if an already-signed-in account is the invitee (server matches by email), accept
 * straight away. Otherwise land on the invites tab so they can sign in and accept there.
 */
async function handleInviteLink(id: string): Promise<void> {
  view = "preferences";
  prefsTab = "orgs";
  for (const account of accounts.values()) {
    const invitations = await api.myInvitations(account.token).then((r) => r.invitations).catch(() => []);
    if (!invitations.some((invitation) => invitation.id === id)) continue;
    const { membership } = await api.acceptMyInvitation(account.token, id);
    await connect(membership.organizationId, account.user, account.token);
    await switchConnection(membership.organizationId, account.user.id);
    showNotice("Joined organization", "success");
    return;
  }
  await refresh();
  showNotice("Sign in as the invited email to accept the invitation", "info");
}

/** Route a bees:// deep link to the right handler (invite vs OAuth callback). */
function routeDeepLink(urls: string[]): void {
  const fail = (error: unknown): void =>
    showNotice(errorText(error), "error");
  for (const raw of urls) {
    let host: string;
    let path: string;
    try {
      const url = new URL(raw);
      host = url.hostname;
      path = url.pathname;
    } catch {
      continue;
    }
    if (host === "invite") {
      void handleInviteLink(path.replace(/^\//, "")).catch(fail);
    } else if (host === "billing") {
      // Returned from Stripe checkout; the org appears once the webhook lands, so just refresh.
      if (path.replace(/^\//, "") === "success") showNotice("Payment received — setting up your organization…", "success");
      void reconcileServerOrgs().catch(fail);
    } else {
      void handleAuthCallback([raw]).catch(fail);
    }
  }
}

function setHeader(name: string, detail?: string): void {
  title.textContent = name;
  context.textContent = detail ?? [currentOrganization()?.name, currentTeam()?.name].filter(Boolean).join(" / ");
  newItem.hidden = view !== "board" || !activeProcess;
}

function activeClass(selected: boolean): string {
  return selected ? "active font-semibold" : "";
}

/** An org is "connected" when it is backed by a server organization; otherwise local-only. */
function orgIsConnected(orgId = workspace.organizationId): boolean {
  return connectedOrgs.has(orgId);
}

/**
 * Can we actually open this org right now? Local orgs always; connected orgs only while an
 * account is signed into them. Logged-out connected orgs are hidden from the switcher — you
 * log back in from Preferences → Orgs.
 */
function canConnectOrg(orgId: string): boolean {
  return !orgIsConnected(orgId) || orgHasConnection(orgId);
}

function brandingFor(orgId: string): OrgBranding {
  return orgBranding[orgId] ?? {};
}

/** A 2.5rem org avatar: the logo if set, otherwise the first letter on the org color. */
function orgLogoPreview(orgId: string, name: string): string {
  const branding = brandingFor(orgId);
  return branding.logo
    ? `<img src="${escapeHtml(branding.logo)}" alt="" class="size-10 overflow-hidden rounded-lg object-cover">`
    : `<span class="grid size-10 place-items-center rounded-lg text-sm font-black text-white" style="background:${escapeHtml(
        branding.color || defaultOrgColor(name)
      )}">${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`;
}

/** Stable fallback color from the org name, so same-initial orgs (Acme vs Ace) still differ. */
function defaultOrgColor(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 45%)`;
}

async function saveBranding(): Promise<void> {
  await repository.setSetting("org_branding", JSON.stringify(orgBranding));
}

/** Merge a color/logo patch into an org's branding and persist. Empty fields are ignored. */
async function setBrandingValue(orgId: string, patch: OrgBranding): Promise<void> {
  const next: OrgBranding = { ...brandingFor(orgId) };
  if (patch.color) next.color = patch.color;
  if (patch.logo) next.logo = patch.logo;
  orgBranding[orgId] = next;
  await saveBranding();
}

/** Work still on someone's plate — finished and archived items are not workload, so never counted. */
function openWork(list: WorkItem[]): WorkItem[] {
  return list.filter(({ status }) => status !== "done" && status !== "archived");
}

/**
 * Dashboards (one per live process) plus open-work counts for every team in the org, so each
 * team's nav renders the same whether or not it is the open one. Every process owns exactly one
 * dashboard, so missing ones are made here — covers a just-created process and any that predate
 * dashboards.
 */
async function loadDashboardsByTeam(): Promise<void> {
  dashboardsByTeam = new Map();
  for (const team of teams) {
    let [teamBoards, teamProcesses, workItems] = await Promise.all([
      repository.listBoards(team.id),
      repository.listProcesses(team.id),
      repository.listTeamWorkItems(team.id)
    ]);
    // Before anything reads them: the left menu renders straight out of this map, so the repairs
    // have to land here rather than on the active team's copy loaded further down.
    teamProcesses = await backfillProcessTags(teamProcesses);
    teamBoards = await backfillBoardNames(teamBoards, teamProcesses, team.id);
    const undashboarded = teamProcesses.filter(
      ({ id }) => !teamBoards.some(({ processId }) => processId === id)
    );
    for (const process of undashboarded) {
      await repository.createBoard(team.id, {
        name: `${process.name} dashboard`,
        processId: process.id,
        stageIds: process.stages.map(({ id }) => id)
      });
    }
    if (undashboarded.length) teamBoards = await repository.listBoards(team.id);
    dashboardsByTeam.set(
      team.id,
      teamProcesses.flatMap((process) => {
        const board = teamBoards.find(({ processId }) => processId === process.id);
        if (!board) return [];
        const count = openWork(workItems.filter(({ processId }) => processId === process.id)).length;
        return [{ board, process, count }];
      })
    );
  }
}

/** A decomposed goal resumes only after every approved child task has reached Done. */
async function resumeCompletedGoals(): Promise<number> {
  const ready = completedGoalsReadyForReview(teamItems, processes);
  for (const { parent, review, logicalFiles } of ready) {
    await repository.checkpointWorkItem(parent.id, logicalFiles, review.name);
  }
  return ready.length;
}

/**
 * Two one-time repairs on load. Processes created before tags existed carry no module tag, so
 * their behaviour would be lost: match those by the only handle they have — the name they were
 * installed under — and write the tag. Then bring any row still named after an older release of
 * its module up to the current library name. A process a team renamed itself keeps that name, and
 * one renamed before tags shipped stays untagged; re-adding it from the library is the way back.
 */
async function backfillProcessTags(loaded: Process[]): Promise<Process[]> {
  const patched = new Map<string, Process>();
  for (const process of loaded) {
    const tag = process.tags[0] ?? processModuleTagForName(process.name);
    const module = tag ? processModule([tag]) : undefined;
    if (!tag || !module) continue;
    if (!process.tags.length) await repository.setTags("process", process.id, [tag]);
    const renamed = libraryRename(
      process.name,
      module.legacyNames ?? [],
      module.definition.name
    );
    if (renamed) {
      await repository.updateProcess(process.id, { name: renamed, description: process.description });
    }
    if (!process.tags.length || renamed) {
      patched.set(process.id, { ...process, tags: [tag], name: renamed ?? process.name });
    }
  }
  return patched.size ? loaded.map((process) => patched.get(process.id) ?? process) : loaded;
}

/** The board half of the same repair: a dashboard still named after an older release follows it. */
async function backfillBoardNames(
  loaded: Board[],
  known: Process[],
  teamId: string
): Promise<Board[]> {
  const renamed = new Map<string, string>();
  for (const board of loaded) {
    const process = known.find(({ id }) => id === board.processId);
    const module = process && processModule(process.tags);
    if (!module) continue;
    const current = libraryRename(
      board.name,
      module.legacyBoardNames ?? [],
      module.definition.boardName
    );
    if (!current) continue;
    await repository.updateBoard(board.id, teamId, {
      name: current,
      processId: board.processId,
      stageIds: board.stageIds,
      filters: board.filters
    });
    renamed.set(board.id, current);
  }
  return renamed.size
    ? loaded.map((board) =>
        renamed.has(board.id) ? { ...board, name: renamed.get(board.id)! } : board
      )
    : loaded;
}

async function refresh(): Promise<void> {
  organizations = await repository.listOrganizations();
  teams = await repository.listTeams(workspace.organizationId);
  if (!teams.some(({ id }) => id === workspace.teamId)) workspace.teamId = teams[0]?.id ?? "";

  // Runs first: it backfills missing dashboards, so the loads below see them.
  await loadDashboardsByTeam();
  dismissedRunIds = new Set(
    await repository.getSetting<string[]>(DISMISSED_RUNS_KEY, [])
  );

  if (!workspace.teamId) {
    boards = [];
    processes = [];
    activeBoard = null;
    activeProcess = null;
    items = [];
    teamItems = [];
    agents = [];
    executions = [];
    executionOutputs = [];
    projectFolderItemIds = new Set();
    itemErrors = new Map();
    schedules = [];
    registries = [];
    mcpConnections = [];
    knowledgeConnection = null;
    disabledAgentIds = new Set();
    skillReviews = [];
    curatorPlan = null;
  } else {
    runningProcesses = new Set(await repository.getSetting<string[]>(RUNNING_PROCESSES_KEY, []));
    disabledAgentIds = new Set(
      await repository.getSetting<string[]>(`disabled_agents:${workspace.teamId}`, [])
    );
    [boards, processes, agents, teamItems, executions, schedules, registries, mcpConnections] = await Promise.all([
      repository.listBoards(workspace.teamId),
      repository.listProcesses(workspace.teamId),
      actions.loadAgents(),
      repository.listTeamWorkItems(workspace.teamId),
      repository.listExecutions(workspace.teamId),
      repository.listSchedules(workspace.teamId),
      repository.listRegistries(workspace.teamId),
      listMcpConnections(repository, workspace.teamId)
    ]);
    knowledgeConnection = mcpConnections.find(isKnowledgeConnection) ?? null;
    mcpConnections = mcpConnections.filter((connection) => !isKnowledgeConnection(connection));
    skillReviews = reviewSkills({
      capabilities: registryCapabilities(registries),
      usage: await repository.listSkillUsage(workspace.teamId),
      selectedRefs: agents.flatMap((agent) => capabilityRefsFor(agent.config, "skill")),
      now: new Date().toISOString()
    });
    if (await resumeCompletedGoals()) {
      teamItems = await repository.listTeamWorkItems(workspace.teamId);
    }
    const executionIds = new Set(executions.map(({ id }) => id));
    executionOutputs = (await repository.listExecutionOutputs()).filter(({ executionId }) =>
      executionIds.has(executionId)
    );
    projectFolderItemIds = new Set(await repository.listProjectFolderItemIds());
    itemErrors = await repository.listItemErrors();
    activeBoard =
      boards.find(
        (board) => board.id === activeBoard?.id && processes.some((process) => process.id === board.processId)
      ) ??
      boards.find(
        (board) =>
          board.processId === workspace.processId &&
          processes.some((process) => process.id === board.processId)
      ) ??
      boards.find((board) => processes.some((process) => process.id === board.processId)) ??
      null;
    activeProcess =
      processes.find(({ id }) => id === activeBoard?.processId) ??
      processes.find(({ id }) => id === activeProcess?.id) ??
      processes[0] ??
      null;
    workspace.processId = activeProcess?.id ?? "";
    items = activeProcess ? await repository.listWorkItems(activeProcess.id) : [];
  }
  views.renderNavigation();
  render();
  void autopilot();
}

async function seedDefaultRegistry(): Promise<void> {
  if (!workspace.teamId) return;
  const key = `default_registry_version_${workspace.teamId}`;
  if ((await repository.getSetting(key, 0)) >= 2) return;
  const existing = registries.find(({ sourcePath }) => sourcePath === "bundled://bees-default");
  const id = existing?.id ?? crypto.randomUUID();
  const files = await registryFiles.copyBundled(id);
  await repository.saveRegistry({
    id,
    teamId: workspace.teamId,
    name: existing?.name ?? "Bees defaults",
    sourcePath: "bundled://bees-default",
    files
  });
  await repository.setSetting(key, 2);
  await refresh();
}

/** Seeds the starter module once; later user-owned agent edits and deletions are respected. */
async function seedStarterWorkflow(): Promise<void> {
  if (!workspace.teamId) return;
  const module = starterProcessModule();
  const key = `${module.definition.id}_workflow_seeded_${workspace.teamId}`;
  if (await repository.getSetting(key, false)) return;
  const template = module.definition;
  const process = processes.find(
    ({ name }) => name.toLowerCase() === template.name.toLowerCase()
  );
  const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
  if (!process || !mapping?.localPath) return;
  await workspaces.ensureDirectory(mapping.localPath);
  const skills = registryCapabilities(registries).filter(({ kind }) => kind === "skill");
  for (const definition of template.agents) {
    const stage = process.stages.find(({ name }) => name === definition.stage);
    if (!stage || agents.some(({ triggerStageId }) => triggerStageId === stage.id)) continue;
    const saved = await agentFiles.save(
      mapping.localPath,
      newAgent({
        name: definition.name,
        purpose: definition.purpose,
        triggerStageId: stage.id,
        config: {
          role: definition.role,
          prompt: definition.prompt,
          provider: definition.provider,
          model: definition.model,
          toolRefs: [],
          grants: [],
          skillRefs: skills
            .filter(({ name }) => definition.skills?.includes(name))
            .map(({ ref }) => ref)
        }
      })
    );
    agents.push(saved);
  }
  if (module.autoStart) {
    runningProcesses.add(process.id);
    await repository.setSetting(RUNNING_PROCESSES_KEY, [...runningProcesses]);
  }
  await repository.setSetting(key, true);
  await refresh();
}

/**
 * The one registry Bees writes to. Its source is <teamRoot>/skills, so skills the team writes —
 * by hand or from an approved proposal — sync and version with the team folder, and Refresh
 * re-copies from that folder instead of overwriting it from somewhere else.
 */
async function ensureTeamSkillsRegistry(teamRoot: string): Promise<void> {
  const sourcePath = `${teamRoot}/skills`;
  const existing = registries.find((registry) => registry.sourcePath === sourcePath);
  const id = existing?.id ?? crypto.randomUUID();
  // No skills folder yet: nothing to register until the first skill is written.
  const files = await registryFiles.copy(id, sourcePath).catch(() => null);
  if (!files) return;
  await repository.saveRegistry({
    id,
    teamId: workspace.teamId,
    name: existing?.name ?? "Team skills",
    sourcePath,
    files
  });
}

/**
 * Remember where the user is so the next launch opens there. Recorded on render rather than at
 * every `view =` assignment, because render is the one thing all of them go through. Views that
 * cannot be restored are skipped, so opening a work item does not lose the board behind it.
 */
function rememberView(): void {
  if (view === savedView || !RESTORABLE_VIEWS.has(view)) return;
  savedView = view;
  void repository.setSetting(LAST_VIEW_KEY, view).catch(() => undefined);
}

function render(): void {
  rememberView();
  views.renderNavigation();
  if (view === "overview") {
    setHeader("Overview", currentOrganization()?.name);
    const models = overviewAssistantModels();
    swap(
      overviewView(
        teamItems,
        executions,
        executionOutputs.filter(({ status }) => status === "pending"),
        dismissedRunIds,
        {
          projects: organizations,
          teams,
          models: models.map(({ group, label }) => ({ group, label })),
          projectId: workspace.organizationId,
          teamId: workspace.teamId,
          modelIndex: Math.max(
            0,
            models.findIndex(({ choice }) => sameChoice(choice, assistantModel))
          )
        }
      )
    );
  }
  if (view === "inbox") {
    setHeader("Inbox", "Work, approvals, and runs that need you");
    swap(
      inboxView(escalationGroups(supervise(), teamItems), executions)
    );
  }
  if (view === "board") views.renderBoard();
  if (view === "process") views.renderProcessEditor();
  if (view === "process-runs") views.renderProcessRuns();
  if (view === "process-library") views.renderProcessLibrary();
  if (view === "item") void views.renderWorkItemDetail();
  if (view === "item-new") views.renderNewItem();
  if (view === "runs") {
    setHeader("Runs", currentTeam()?.name);
    swap(`${views.searchBox()}${searchQuery.trim() ? searchResultsView(searchHits) : runsView(teamItems, executions)}`);
  }
  if (view === "run") void views.renderRunDetail();
  if (view === "schedules") {
    const process = processes.find(({ id }) => id === configProcessId);
    setHeader("Schedules", process?.name ?? currentTeam()?.name);
    const items = scheduleItems();
    const ids = new Set(items.map(({ id }) => id));
    swap(schedulesView(items, schedules.filter(({ workItemId }) => ids.has(workItemId)), executions));
  }
  if (view === "settings") void views.renderTeamSettings();
  if (view === "org-settings") void views.renderOrgSettings();
  if (view === "preferences") void views.renderPreferences();
  if (view === "getting-started") {
    setHeader("Getting Started", "Set up Bees on this computer");
    swap(
      `<article class="markdown-viewer mx-auto max-w-3xl rounded-box border border-base-300 bg-base-100 px-6 py-5">${renderMarkdown(
        GETTING_STARTED
      )}</article>`
    );
  }
}

/** The `<id>:<field>` entries of one agent, renamed back to what `applyAgentEdit` reads. */
function scopedFormData(form: HTMLFormElement, agentId: string): FormData {
  const scoped = new FormData();
  const prefix = `${agentId}:`;
  for (const [key, value] of new FormData(form)) {
    if (key.startsWith(prefix)) scoped.append(key.slice(prefix.length), value);
  }
  return scoped;
}

/** An open item may sit untouched with nothing running for this long before it counts as stalled. */
const STALL_AFTER_MS = 15 * 60_000;

/**
 * Where every failure a person can trigger ends up. The notice is transient and the record is
 * not, so a workflow that throws — anywhere, including in code that never thought about this —
 * escalates on its own instead of relying on whoever wrote it to report the problem.
 *
 * Attribution is best-effort: the item the failure names, else the one on screen. A wrong guess
 * costs a line in someone's inbox, which is cheaper than the silence it replaces.
 */
function reportFailure(error: unknown, itemId?: string): void {
  const message = errorText(error);
  showNotice(message, "error");
  const subject = [itemId, view === "item" ? activeItemId : ""].find((candidate) =>
    teamItems.some(({ id }) => id === candidate)
  );
  if (!subject) return;
  void repository
    .recordItemError(subject, message)
    .then(() => refresh())
    .catch(() => undefined);
}

/**
 * The supervision sweep: what state every item in this team is in, keyed by item id.
 *
 * Assembles facts and hands them to `workState` — the decision itself lives in supervision.ts
 * so it is one ordered list of rules rather than conditionals spread across the views. Every
 * reader (board badge, inbox, item banner, nav count) reads this map, so they cannot disagree.
 */
function supervise(): Map<string, WorkState> {
  const now = new Date().toISOString();
  const states = new Map<string, WorkState>();
  for (const item of teamItems) {
    const process = processes.find(({ id }) => id === item.processId);
    if (!process) continue;
    const studio = processModule(process.tags)?.mode === "studio";
    const agent = agentForItem(item);
    const eligibility = agent ? eligibilityForAgent(agent) : null;
    const runs = executions.filter(
      ({ workItemId, id, status }) =>
        workItemId === item.id &&
        // A dismissed failure is one a person has already answered for.
        !(dismissedRunIds.has(id) && (status === "failed" || status === "interrupted"))
    );
    // An error the item has already moved past is history, not an escalation — so the record
    // expires on its own and no code has to remember to clear it.
    const recorded = itemErrors.get(item.id);
    const lastError =
      recorded &&
      item.updatedAt <= recorded.at &&
      !executions.some(({ workItemId, createdAt }) => workItemId === item.id && createdAt > recorded.at)
        ? recorded
        : undefined;
    const state = workState({
      item,
      stageName: process.stages.find(({ id }) => id === item.stageId)?.name ?? "this status",
      runs,
      pendingApprovals: executionOutputs.filter(
        ({ executionId, status }) =>
          status === "pending" && runs.some(({ id }) => id === executionId)
      ).length,
      ...(studio
        ? {
            humanStep: projectFolderItemIds.has(item.id)
              ? process.stages.find(({ id }) => id === item.stageId)?.name ?? "Open the project"
              : "Choose a folder"
          }
        : {}),
      ...(agent && eligibility && !eligibility.active ? { agentBlocked: eligibility.reason } : {}),
      // A studio drives itself from its own screen, so neither an agent for the status nor a
      // started process is what it is missing.
      hasAgent: studio || Boolean(agent?.config.prompt.trim()),
      processRunning: studio || runningProcesses.has(process.id),
      ...(schedules.find(({ workItemId, enabled }) => workItemId === item.id && enabled)?.nextRunAt
        ? {
            scheduledFor: when(
              schedules.find(({ workItemId, enabled }) => workItemId === item.id && enabled)!.nextRunAt
            )
          }
        : {}),
      ...(lastError ? { lastError } : {}),
      now,
      stallAfterMs: STALL_AFTER_MS
    });
    if (state) states.set(item.id, state);
  }
  return states;
}

function runStageId(execution: Execution): string | null {
  return agents.find(({ id }) => id === execution.agentId)?.triggerStageId ?? null;
}

async function requireTeamRoot(): Promise<string> {
  const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
  if (!mapping?.localPath) throw new Error("Set a team folder first — agents are files inside it");
  return mapping.localPath;
}

function eligibilityForAgent(agent: Agent) {
  return effectiveAgentEligibility(
    agent,
    assistantModel,
    !disabledAgentIds.has(agent.id),
    machineModelAvailability
  );
}

async function probeKnowledgeConnection(connection: McpConnection): Promise<void> {
  const { baseUrl, token } = await ensureFlueRuntime();
  const response = await fetch(`${baseUrl}/connections/discover`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(connection)
  });
  const body = (await response.json()) as { tools?: McpConnection["tools"]; error?: string };
  if (!response.ok || !body.tools?.some(({ name }) => name === "knowledge_search")) {
    throw new Error(body.error ?? "The worker does not expose knowledge_search");
  }
}

const AI_PROVIDER_HINT: Record<AiProvider, string> = {
  "opencode-go": "Paste the API key from opencode.ai/auth.",
  openrouter: "Paste an OpenRouter API key (openrouter.ai/keys).",
  openai: "Paste an OpenAI API key (platform.openai.com/api-keys), then use openai/<model>.",
  anthropic: "Paste an Anthropic API key (console.anthropic.com), then use anthropic/<model>."
};

/** Model prefix an agent must use for each connection, shown beside the connection. */
const AI_PROVIDER_MODEL_PREFIX: Record<AiProvider, string> = {
  "opencode-go": "opencode-go/",
  openrouter: "openrouter/",
  openai: "openai/",
  anthropic: "anthropic/"
};

function aiConnectionScope(): string {
  return workspace.organizationId || "global";
}

function syncService(): MetadataSyncService {
  return new MetadataSyncService(
    repository,
    new HttpSyncTransport(apiBaseUrl(), "x-organization-id", orgToken)
  );
}

const BACKGROUND_SYNC_MS = 30_000;
const CONTROL_HEALTH_MS = 15 * 60_000;
let lastControlHealthAt = 0;

function controlIdentity(): ReportIdentity | null {
  const user = currentUser();
  if (!user || !runnerId || !orgIsConnected()) return null;
  return {
    organizationId: workspace.organizationId,
    deviceId: runnerId,
    userId: user.id,
    appVersion,
    ...(workspace.teamId ? { teamId: workspace.teamId } : {})
  };
}

async function controlTick(): Promise<void> {
  const identity = controlIdentity();
  const token = orgToken();
  if (!identity || !token) return;
  await syncControl(repository, api, token, identity);
  if (Date.now() - lastControlHealthAt >= CONTROL_HEALTH_MS) {
    await reportHealth(repository, identity);
    lastControlHealthAt = Date.now();
  }
  await flushControlReports(repository, api, token, identity.organizationId);
}

/**
 * Nothing pushes from the server, so membership and shared work only converge when we ask. Two
 * cheap poll points: window focus (covers "created it in the browser, then tabbed back") and a
 * timer while the app is open. Failures are ignored — the next tick retries — and the UI is
 * re-rendered only when something actually changed, so typing is never interrupted.
 */
function startBackgroundSync(): void {
  let running = false;
  const signature = async (): Promise<string> =>
    JSON.stringify([
      [...connections].sort(),
      [...connectedOrgs].sort(),
      pendingInvitations.length,
      (await repository.listTeams(workspace.organizationId)).map(({ id, name }) => `${id}:${name}`)
    ]);
  const tick = async (): Promise<void> => {
    if (running || !accounts.size) return;
    running = true;
    try {
      const before = await signature();
      await reconcileServerOrgs();
      let applied = 0;
      if (orgIsConnected() && orgToken()) {
        if (workspace.teamId) {
          applied = await syncService()
            .synchronize(workspace.organizationId, workspace.teamId)
            .catch(() => 0);
        }
        await controlTick();
      }
      if (applied > 0 || (await signature()) !== before) await refresh();
    } catch {
      // Offline, or a request the server refused: keep the last-known state and try again later.
    } finally {
      running = false;
    }
  };
  window.addEventListener("focus", () => void tick());
  setInterval(() => void tick(), BACKGROUND_SYNC_MS);
  void tick();
}

function claimSetting(itemId: string): string {
  return `work_claim_${itemId}`;
}

async function acquireClaim(item: WorkItem): Promise<ServerWorkItemClaim | null> {
  if (!orgIsConnected()) return null;
  const token = orgToken();
  if (!token) throw new Error("Sign in before running shared work");
  await syncService().synchronize(workspace.organizationId, workspace.teamId);
  const current = await repository.getWorkItem(item.id);
  if (!current) throw new Error("Work item is no longer available");
  const { claim } = await api.claimWorkItem(
    token,
    workspace.organizationId,
    item.id,
    runnerId,
    current.syncVersion
  );
  await repository.setSetting(claimSetting(item.id), claim);
  return claim;
}

async function releaseClaim(
  itemId: string,
  organizationId = workspace.organizationId
): Promise<void> {
  const claim = await repository.getSetting<ServerWorkItemClaim | null>(claimSetting(itemId), null);
  if (!claim) return;
  const token = orgToken(organizationId);
  if (!token) throw new Error("Sign in to release this shared-work claim");
  await api.releaseWorkItemClaim(
    token,
    organizationId,
    itemId,
    runnerId,
    claim.claimId,
    claim.workItemVersion
  );
  await repository.setSetting(claimSetting(itemId), null);
}

async function syncCheckpoint(
  itemId: string,
  organizationId = workspace.organizationId,
  teamId = workspace.teamId
): Promise<void> {
  if (orgHasConnection(organizationId)) {
    const claim = await repository.getSetting<ServerWorkItemClaim | null>(
      claimSetting(itemId),
      null
    );
    const token = orgToken(organizationId);
    if (!claim || !token) throw new Error("The shared-work claim is unavailable");
    const record = (await repository.coordinationProjection(teamId)).find(
      ({ recordType, recordId }) => recordType === "work_item" && recordId === itemId
    );
    if (!record) throw new Error("The completed work-item checkpoint is unavailable");
    await api.completeWorkItemClaim(
      token,
      organizationId,
      itemId,
      runnerId,
      claim.claimId,
      claim.workItemVersion,
      record
    );
    await repository.setSetting(claimSetting(itemId), null);
    await syncService().synchronize(organizationId, teamId);
  }
}

const settlementApplications = new Map<string, Promise<void>>();

/**
 * Applies the durable Rust receipt to Bees. Events only wake this function; startup scans the
 * same receipts, so losing a webview or event cannot lose the application transaction.
 */
function applySettledExecution(
  executionId: string,
  announce = false,
  render = true
): Promise<void> {
  const existing = settlementApplications.get(executionId);
  if (existing) return existing;
  const applying = (async () => {
    let execution = await repository.getExecution(executionId);
    if (
      !execution ||
      !["completed", "failed", "cancelled", "interrupted"].includes(execution.status) ||
      !execution.result ||
      execution.result.projectionState === "done"
    ) {
      return;
    }
    const outputs = Array.isArray(execution.result.outputs)
      ? execution.result.outputs.filter((output): output is string => typeof output === "string")
      : [];
    const continuation = execution.result.continuation === true;
    const manualProjection = execution.result.manualProjection === true;
    const projectMode = execution.result.projectMode === true;
    const statusName =
      typeof execution.result.statusName === "string" ? execution.result.statusName : undefined;

    if (execution.result.projectionState === "pending") {
      const projectedItem = await repository.getWorkItem(execution.workItemId);
      if (
        execution.status !== "completed" &&
        projectedItem?.goal?.effect === "external_write"
      ) {
        await repository.setWorkItemStatus(projectedItem.id, "blocked");
      }
      if (
        execution.status === "completed" &&
        outputs.length === 0 &&
        !continuation &&
        !manualProjection
      ) {
        // Checkpoint and projection marker share one SQLite transaction: a crash cannot advance
        // the work item twice or mark an unapplied checkpoint as applied.
        await repository.checkpointWorkItem(execution.workItemId, [], statusName, execution.id);
      } else {
        await repository.markExecutionProjectionLocal(execution.id);
      }
      execution = (await repository.getExecution(execution.id)) ?? execution;
    }

    if (execution.result?.projectionState === "local_applied") {
      const scope = await repository.getWorkItemScope(execution.workItemId);
      if (
        execution.status === "completed" &&
        outputs.length === 0 &&
        !continuation &&
        !manualProjection
      ) {
        if (scope) await syncCheckpoint(execution.workItemId, scope.organizationId, scope.teamId);
        await releaseClaim(execution.workItemId, scope?.organizationId);
      } else if (manualProjection || execution.status !== "completed" || outputs.length === 0) {
        await releaseClaim(execution.workItemId, scope?.organizationId);
      }
      if (
        !projectMode &&
        (manualProjection || execution.status !== "completed" || outputs.length === 0) &&
        execution.workspaceRef
      ) {
        await workspaces.cleanup(execution.workspaceRef).catch(() => undefined);
      }
      await repository.completeExecutionProjection(execution.id);
    }

    if (announce) {
      const item = await repository.getWorkItem(execution.workItemId);
      const title = item?.title ?? "Bees run";
      if (continuation && execution.status === "completed" && outputs.length === 0) {
        notifyLocal("Bees replied", title);
      } else if (execution.status === "completed" && outputs.length === 0) {
        notifyLocal("Bees run completed", `${title} finished with no file changes.`);
      } else if (execution.status === "completed") {
        notifyLocal("Bees needs your review", `${outputs.length} file change(s) from ${title}.`);
      } else {
        notifyLocal("Bees run failed", execution.error ?? "The agent stopped before finishing");
      }
    }
    if (render) await refresh();
  })().finally(() => settlementApplications.delete(executionId));
  settlementApplications.set(executionId, applying);
  return applying;
}

function notifyLocal(titleText: string, body: string): void {
  void (async () => {
    const granted =
      (await isPermissionGranted()) || (await requestPermission()) === "granted";
    if (granted) sendNotification({ title: titleText, body });
  })().catch(() => undefined);
}

/** The agent wired to a status, if any. Agents own the link now, not stages. */
function agentForStage(stageId: string | undefined): Agent | undefined {
  return stageId ? agents.find(({ triggerStageId }) => triggerStageId === stageId) : undefined;
}

function configuredAgentRole(agent: Agent): string {
  return String(agent.config.role ?? agent.name).trim();
}

function goalWorkerRoles(): Array<{ role: string; purpose: string; agent: Agent }> {
  const goalWorkStages = new Set(
    processes
      .filter(isGoalsProcess)
      .flatMap((process) => goalPlanStages(process)?.work.id ?? [])
  );
  const reserved = new Set(["goal-planner", "goal-reviewer", "skill-editor"]);
  const seen = new Set<string>();
  return agents.flatMap((agent) => {
    const role = configuredAgentRole(agent);
    const normalized = role.toLowerCase();
    if (
      !role ||
      !agent.config.prompt.trim() ||
      reserved.has(normalized) ||
      (agent.triggerStageId !== null && !goalWorkStages.has(agent.triggerStageId)) ||
      seen.has(normalized)
    ) {
      return [];
    }
    seen.add(normalized);
    return [{ role, purpose: agent.purpose || agent.description, agent }];
  });
}

function agentForItem(item: WorkItem): Agent | undefined {
  const process = processes.find(({ id }) => id === item.processId);
  const stages = process ? goalPlanStages(process) : null;
  if (stages?.work.id === item.stageId && item.goal?.role) {
    return goalWorkerRoles().find(
      ({ role }) => role.toLowerCase() === item.goal!.role.toLowerCase()
    )?.agent;
  }
  return agentForStage(item.stageId);
}

async function scheduledWorkItemId(schedule: Schedule): Promise<string> {
  if (schedule.mode === "run") return schedule.workItemId;
  const template = await repository.getWorkItem(schedule.workItemId);
  const process = template ? processes.find(({ id }) => id === template.processId) : null;
  const stages = process ? goalPlanStages(process) : null;
  if (!template || !process || !stages) {
    throw new Error("A goal occurrence schedule must target a Goals work item");
  }
  const worker = goalWorkerRoles().find(
    ({ role }) => role.toLowerCase() === schedule.role?.toLowerCase()
  );
  if (!worker) throw new Error(`Scheduled goal role is unavailable: ${schedule.role ?? ""}`);
  const key = `schedule:${schedule.id}:${schedule.nextRunAt}`;
  const existing = (await repository.listWorkItems(process.id)).find(
    (item) => item.goal?.key === key
  );
  if (existing) return existing.id;
  const due = new Date(schedule.nextRunAt).toISOString();
  return repository.createWorkItem(process.id, {
    stageId: stages.work.id,
    parentId: template.id,
    title: `${template.title} — ${due}`.slice(0, 180),
    description: [
      template.description,
      `Scheduled occurrence: ${due}. Cover the current window, use stable task keys to deduplicate findings, and propose every external action as its own external_write task.`
    ].filter(Boolean).join("\n\n"),
    ...(template.owner ? { owner: template.owner } : {}),
    logicalFiles: template.logicalFiles,
    goal: {
      key,
      role: worker.role,
      effect: "prepare",
      planOutputId: null,
      authorizedAt: new Date().toISOString(),
      occurrenceOf: template.id
    }
  });
}

async function runScheduledOccurrence(schedule: Schedule, auto: boolean): Promise<void> {
  const itemId = await scheduledWorkItemId(schedule);
  if (
    schedule.mode === "spawn_goal" &&
    (await repository.listExecutionsForWorkItem(itemId)).length
  ) {
    return;
  }
  try {
    await runItem(itemId, auto, undefined, undefined, true);
  } catch (error) {
    if (schedule.mode === "spawn_goal") await refresh();
    throw error;
  }
}

function runComposition(agent: Agent): {
  capabilities: ReturnType<typeof selectedAgentCapabilities>;
  mcpConnections: McpConnection[];
  delegates: Array<{ agent: Agent; skillRefs: string[] }>;
} {
  const helpers = (agent.config.delegateRefs ?? []).map((id) => {
    const helper = agents.find((candidate) => candidate.id === id);
    if (!helper || helper.id === agent.id) throw new Error("A selected helper is unavailable");
    if (helper.config.delegateRefs?.length) {
      throw new Error(`${helper.name} cannot be a helper because it selects helpers of its own`);
    }
    if (
      helper.config.mcpConnectionRefs?.length ||
      selectedAgentCapabilities(registries, helper.config).some(({ kind }) => kind === "tool")
    ) {
      throw new Error(`${helper.name} cannot be a helper because helpers support skills and browser only`);
    }
    return { agent: helper, skillRefs: capabilityRefsFor(helper.config, "skill") };
  });
  const selected = [
    ...selectedAgentCapabilities(registries, agent.config),
    ...helpers.flatMap(({ agent: helper }) =>
      selectedAgentCapabilities(registries, helper.config).filter(({ kind }) => kind === "skill")
    )
  ];
  const seen = new Set<string>();
  const selectedConnections = (agent.config.mcpConnectionRefs ?? []).map((id) => {
    const connection = mcpConnections.find((candidate) => candidate.id === id);
    if (!connection) throw new Error("A selected MCP connection is unavailable");
    return mcpConnectionForAgent(connection, agent.config);
  });
  return {
    capabilities: selected.filter(({ ref }) => !seen.has(ref) && Boolean(seen.add(ref))),
    mcpConnections: [...selectedConnections, ...(knowledgeConnection ? [knowledgeConnection] : [])],
    delegates: helpers
  };
}

type ControlInput = Omit<PolicyInput, "now" | "activeExceptionPolicyIds">;

function controlInput(
  action: string,
  resource: ControlInput["resource"],
  context: Partial<ControlInput["context"]> = {}
): ControlInput {
  return {
    action,
    subject: {
      userId: currentUser()?.id ?? "local-user",
      roles: [serverOrgs.get(workspace.organizationId)?.role ?? "member"],
      teamIds: workspace.teamId ? [workspace.teamId] : []
    },
    resource,
    context: {
      organizationId: workspace.organizationId,
      ...(workspace.teamId ? { teamId: workspace.teamId } : {}),
      deviceId: runnerId,
      ...context
    }
  };
}

async function controlDecision(input: ControlInput): Promise<PolicyDecision> {
  const identity = controlIdentity();
  return identity ? decideControl(repository, identity, input) : { decision: "allow" };
}

async function enforceControl(input: ControlInput, offerException = false): Promise<void> {
  const decision = await controlDecision(input);
  if (decision.decision === "allow") return;
  if (decision.decision === "approval_required" && offerException) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const data = await actions.edit(
      "Request policy exception",
      [
        { name: "reason", label: "Business reason", type: "textarea" },
        {
          name: "expiresAt",
          label: "Expires at (ISO timestamp)",
          value: expiresAt,
          hint: "The administrator can narrow this further before approval."
        }
      ],
      "Request"
    );
    const identity = controlIdentity();
    if (data && identity) {
      await requestException(repository, identity, {
        policyId: decision.policyId,
        action: input.action,
        resourceType: input.resource.type,
        ...(input.resource.id ? { resourceId: input.resource.id } : {}),
        ...(input.context.agentId ? { agentId: input.context.agentId } : {}),
        reason: String(data.get("reason") ?? ""),
        expiresAt: String(data.get("expiresAt") ?? "")
      });
    }
  }
  throw new Error(`[${decision.policyId}] ${decision.reason}`);
}

async function projectToolsByPolicy(
  agent: Agent,
  composition: ReturnType<typeof runComposition>
): Promise<{ agent: Agent; composition: ReturnType<typeof runComposition> }> {
  const toolAllowed = async (tool: Record<string, unknown>): Promise<boolean> =>
    (await controlDecision(
      controlInput(
        "tool.expose",
        { type: "tool", id: String(tool.id ?? ""), attributes: {} },
        { agentId: agent.id, tool }
      )
    )).decision === "allow";

  const browserConfigured = agent.config.toolRefs?.includes(BROWSER_TOOL_REF) ?? true;
  const browserAllowed =
    !browserConfigured ||
    (await toolAllowed({ id: BROWSER_TOOL_REF, kind: "browser", effect: "read" }));
  const browserWriteAllowed =
    browserAllowed &&
    (!agent.config.grants?.includes(BROWSER_WRITE_GRANT) ||
      (await toolAllowed({ id: BROWSER_WRITE_GRANT, kind: "browser", effect: "write" })));
  const nextAgent =
    browserAllowed && browserWriteAllowed
      ? agent
      : {
          ...agent,
          config: {
            ...agent.config,
            ...(browserAllowed
              ? {}
              : { toolRefs: (agent.config.toolRefs ?? []).filter((ref) => ref !== BROWSER_TOOL_REF) }),
            ...(browserWriteAllowed
              ? {}
              : { grants: (agent.config.grants ?? []).filter((grant) => grant !== BROWSER_WRITE_GRANT) })
          }
        };

  const capabilities = [];
  for (const capability of composition.capabilities) {
    if (
      capability.kind !== "tool" ||
      (await toolAllowed({
        id: capability.ref,
        kind: "local",
        effect: agent.config.grants?.includes(`local:${capability.ref}`) ? "write" : "read"
      }))
    ) {
      capabilities.push(capability);
    }
  }
  const mcpConnections = [];
  for (const connection of composition.mcpConnections) {
    const allowedTools = [];
    for (const name of connection.allowedTools) {
      const tool = connection.tools.find((candidate) => candidate.name === name);
      if (
        await toolAllowed({
          id: `${connection.id}:${name}`,
          kind: "mcp",
          connectionId: connection.id,
          name,
          effect: tool?.readOnly ? "read" : "write"
        })
      ) {
        allowedTools.push(name);
      }
    }
    if (allowedTools.length) mcpConnections.push({ ...connection, allowedTools });
  }
  return {
    agent: nextAgent,
    composition: { ...composition, capabilities, mcpConnections }
  };
}

function projectToolsByGoalEffect(
  effect: GoalTaskEffect | undefined,
  agent: Agent,
  composition: ReturnType<typeof runComposition>
): { agent: Agent; composition: ReturnType<typeof runComposition> } {
  if (!effect || effect === "external_write") return { agent, composition };
  const writeGrant = (grant: string): boolean =>
    grant === BROWSER_WRITE_GRANT || grant.startsWith("local:") || grant.startsWith("mcp:");
  const nextAgent = {
    ...agent,
    config: {
      ...agent.config,
      grants: (agent.config.grants ?? []).filter((grant) => !writeGrant(grant))
    }
  };
  const capabilities = composition.capabilities.filter(
    ({ kind, ref }) => kind !== "tool" || !agent.config.grants?.includes(`local:${ref}`)
  );
  const mcpConnections = composition.mcpConnections.flatMap((connection) => {
    const allowedTools = connection.allowedTools.filter(
      (name) => connection.tools.find((tool) => tool.name === name)?.readOnly === true
    );
    return allowedTools.length ? [{ ...connection, allowedTools }] : [];
  });
  const delegates = composition.delegates.map(({ agent: helper, skillRefs }) => ({
    agent: {
      ...helper,
      config: {
        ...helper.config,
        grants: (helper.config.grants ?? []).filter((grant) => !writeGrant(grant))
      }
    },
    skillRefs
  }));
  return {
    agent: nextAgent,
    composition: { ...composition, capabilities, mcpConnections, delegates }
  };
}

/**
 * Running is a property of the process, not of a task: switching it on is the only click
 * needed, and every item that lands on a status with an agent runs itself from then on.
 * Stopping also cancels whatever that process has in flight, so it is a real brake.
 */
async function setProcessRunning(processId: string, running: boolean): Promise<void> {
  const process = processes.find(({ id }) => id === processId);
  if (running && process && processModule(process.tags)?.mode === "studio") {
    throw new Error("Code projects run from the item's Studio");
  }
  if (running) {
    runningProcesses.add(processId);
    // Asking again is a retry: statuses parked by a failed or self-repeating run become eligible.
    for (const key of [...autopilotDone]) autopilotDone.delete(key);
  } else {
    runningProcesses.delete(processId);
  }
  await repository.setSetting(RUNNING_PROCESSES_KEY, [...runningProcesses]);
  if (!running) {
    const inFlight = executions.filter(
      ({ workItemId, status }) =>
        ["queued", "running"].includes(status) &&
        teamItems.some((item) => item.id === workItemId && item.processId === processId)
    );
    for (const execution of inFlight) {
      await runCoordinator.stop(execution.id).catch(() => undefined);
      await releaseClaim(execution.workItemId).catch(() => undefined);
    }
  }
  await refresh();
  showNotice(running ? "Process running" : "Process stopped", "success");
}

/** The next item a running process owes work to. */
function autopilotNext(): WorkItem | undefined {
  const work = executions.filter((execution) => !isProposal(execution));
  return teamItems.find((item) => {
    const agent = agentForItem(item);
    return (
      runningProcesses.has(item.processId) &&
      Boolean(agent?.config.prompt.trim()) &&
      Boolean(agent && eligibilityForAgent(agent).active) &&
      needsAutonomousRun(item, work, autopilotDone)
    );
  });
}

/** Rejections at one status before Bees offers to rewrite that status's skill. */
const PROPOSAL_THRESHOLD = 3;

const SKILL_EDITOR_PROMPT = `You improve the written procedure a team's agents follow.

You are given the rejections people wrote when they turned down work at one step of a process.
Find what they have in common — a standing rule the agent keeps missing — and ignore anything
that only applied to one task.

If a current skill is in /workspace/inputs, edit it: keep what still holds, change only what the
rejections contradict. Write the result as a single SKILL.md at the path you are told, with
frontmatter (name, description) and a short body of imperative rules. Under 300 words. If the
rejections share nothing worth a standing rule, write no file at all.`;

/** The built-in agent that writes skill proposals. A file like any other, so the team can tune it. */
async function ensureSkillEditorAgent(teamRoot: string): Promise<Agent> {
  const existing = agents.find(({ config }) => config.role === "skill-editor");
  if (existing) return existing;
  const created = await agentFiles.save(
    teamRoot,
    newAgent({
      name: "Skill editor",
      purpose: "Turns repeated rejections into a skill every agent can read",
      config: { role: "skill-editor", prompt: SKILL_EDITOR_PROMPT, toolRefs: [], grants: [] }
    })
  );
  agents = [...agents, created];
  return created;
}

/**
 * Tier two of the feedback loop: one rejection is about one task, but the same complaint three
 * times at the same status is a missing rule. The proposal is written as an ordinary run output,
 * so it lands in the approval queue the user already reviews — nothing self-edits unwatched.
 */
async function proposeSkillEdit(item: WorkItem): Promise<void> {
  const stage = processes
    .find(({ id }) => id === item.processId)
    ?.stages.find(({ id }) => id === item.stageId);
  if (!stage || !agentForItem(item)) return;
  const openProposal = executions.some(
    (execution) =>
      execution.config.proposalStageId === stage.id &&
      (["queued", "running"].includes(execution.status) ||
        executionOutputs.some(
          (output) => output.executionId === execution.id && output.status === "pending"
        ))
  );
  if (openProposal) return;
  const notes = await repository.listStageRejections(stage.id);
  if (notes.length < PROPOSAL_THRESHOLD) return;

  const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
  if (!mapping?.localPath) return;
  const editor = await ensureSkillEditorAgent(mapping.localPath);
  const slug = skillSlug(`${stage.name}-${activeProcess?.name ?? "process"}`);
  const destination = `skills/${slug}/SKILL.md`;
  const current = registries.some(
    (registry) =>
      registry.sourcePath === `${mapping.localPath}/skills` &&
      registry.files.includes(`${slug}/SKILL.md`)
  );
  const proposalAgent = { ...editor, config: { ...editor.config, proposalStageId: stage.id } };
  await ensureKnowledgeConnection();
  const composition = runComposition(proposalAgent);
  await runCoordinator.start({
    // The item rides along for context only: `proposalStageId` keeps this run out of its lifecycle.
    item: { ...item, logicalFiles: current ? [destination] : [] },
    agent: proposalAgent,
    teamId: workspace.teamId,
    teamRoot: mapping.localPath,
    ...composition,
    stages: [],
    feedbackIntro: `People rejected work at the "${stage.name}" step for these reasons. Write the shared rule as outputs/${destination}:`,
    feedback: notes
  });
  notifyLocal("Bees proposed a skill", `A rule for "${stage.name}" is waiting for your review.`);
  await refresh();
}

/** Turns explicit "future items" feedback into a direct, reversible standing rule. */
async function rememberRejection(item: WorkItem, reason: string): Promise<() => Promise<void>> {
  const stage = processes.find(({ id }) => id === item.processId)?.stages.find(({ id }) => id === item.stageId);
  const agent = agentForItem(item);
  const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
  if (!stage || !agent || !mapping?.localPath) throw new Error("That status has no writable agent skill");
  const slug = skillSlug(`${stage.name}-${activeProcess?.name ?? "process"}`);
  await invoke("update_team_skill_rule", { teamRoot: mapping.localPath, slug, reason });
  await ensureTeamSkillsRegistry(mapping.localPath);
  const registry = (await repository.listRegistries(workspace.teamId)).find(
    ({ sourcePath }) => sourcePath === `${mapping.localPath}/skills`
  )!;
  const ref = `${registry.id}:${slug}/SKILL.md`;
  if (!agent.config.skillRefs?.includes(ref)) {
    await actions.writeAgent({ ...agent, config: { ...agent.config, skillRefs: [...(agent.config.skillRefs ?? []), ref] } });
  }
  return async () => {
    await invoke("update_team_skill_rule", { teamRoot: mapping.localPath, slug, reason, remove: true });
    await ensureTeamSkillsRegistry(mapping.localPath);
    await refresh();
  };
}

/**
 * Drains the running processes one run at a time. Called after every refresh, so a new item,
 * a moved item, or a just-finished run picks up the next one without anyone pressing Run.
 */
async function autopilot(): Promise<void> {
  if (autopilotBusy) return;
  autopilotBusy = true;
  try {
    for (let next = autopilotNext(); next; next = autopilotNext()) {
      const item = next;
      for (const key of autonomousRunKeys(item)) autopilotDone.add(key);
      await runItem(item.id, true).catch((error) =>
        showNotice(errorText(error), "error")
      );
    }
  } finally {
    autopilotBusy = false;
  }
}

/**
 * Everything a process turn needs before the item is claimed: the agent behind the role, the
 * policy-projected tool composition, and the control decisions. Kept separate from the run so a
 * batch of concurrent turns clears policy for all of them before any of them starts.
 */
async function prepareProcessAgentTurn(
  role: string,
  item: WorkItem,
  projectMode: boolean
): Promise<{ agent: Agent; composition: ReturnType<typeof runComposition>; teamRoot: string }> {
  const source = agents.find(({ config }) => config.role === role);
  if (!source) throw new Error(`The ${role} agent is missing. Reinstall or repair this process.`);
  const selectedModel = resolveModelChoice(source.config, assistantModel);
  let agent =
    modelRef(source.config) === modelRef(selectedModel)
      ? source
      : {
          ...source,
          config: {
            ...source.config,
            provider: selectedModel.provider,
            model: selectedModel.model
          }
        };
  const eligibility = eligibilityForAgent(agent);
  if (!eligibility.active) throw new Error(`${agent.name} is inactive: ${eligibility.reason}`);
  const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
  if (!mapping?.localPath) throw new Error("Set a local team folder before running process agents");
  if (localModels.isLocalModel(modelRef(agent.config))) {
    await localModels.requireRunning(agent.config.model);
  }
  await ensureKnowledgeConnection();
  let composition = runComposition(agent);
  const projected = await projectToolsByPolicy(agent, composition);
  agent = projected.agent;
  composition = projected.composition;
  const classification =
    typeof agent.config.dataClassification === "string"
      ? agent.config.dataClassification
      : undefined;
  const sharedContext = {
    agentId: agent.id,
    ...(classification ? { dataClassification: classification } : {}),
    run: { automatic: false, scheduled: false, continuation: false }
  };
  await enforceControl(
    controlInput("run.start", { type: "work_item", id: item.id, attributes: {} }, sharedContext)
  );
  await enforceControl(
    controlInput(
      "model.invoke",
      { type: "model", id: modelRef(agent.config), attributes: {} },
      {
        ...sharedContext,
        agentId: agent.id,
        model: {
          id: modelRef(agent.config),
          provider: agent.config.provider ?? "",
          location: localModels.isLocalModel(modelRef(agent.config))
            ? "local-device"
            : "external"
        }
      }
    ),
    true
  );
  await enforceControl(
    controlInput(
      "file.stage",
      {
        type: "file_set",
        attributes: {
          count: item.logicalFiles.length + (projectMode ? 1 : 0),
          hasLinkedLocations: item.logicalFiles.some(
            (reference) => Boolean(parseLogicalFileReference(reference).locationId)
          ),
          projectWorkspace: projectMode
        }
      },
      sharedContext
    )
  );
  return { agent, composition, teamRoot: mapping.localPath };
}

/**
 * Runs process agent turns and waits for their receipts. Turns handed over together run
 * concurrently: they share the item's read-only project worktree but nothing else, since Flue
 * binds capabilities and conversation state per execution. Only pass turns that cannot observe
 * each other's writes — the architecture debate's two sides, not a coder and its tester.
 *
 * A turn carrying `executionId` reopens that conversation instead of starting a cold one, so a
 * multi-round exchange keeps the repository analysis the model already paid for.
 */
/** The linked locations an item's approved files point at, so a run can stage them. */
async function referencedFileLocations(item: WorkItem): Promise<FileLocation[]> {
  const referenced = new Set(
    item.logicalFiles.flatMap((reference) => {
      const locationId = parseLogicalFileReference(reference).locationId;
      return locationId ? [locationId] : [];
    })
  );
  if (!referenced.size) return [];
  return (await repository.listAvailableFileLocations(workspace.teamId)).filter(({ id }) =>
    referenced.has(id)
  );
}

async function runProcessAgentTurns(
  item: WorkItem,
  turns: ProcessAgentTurn[],
  projectMode = false
): Promise<Execution[]> {
  if (!turns.length) return [];
  if (activeExecutionForItem(item.id, executions)) {
    throw new Error("Another process agent is already working on this item");
  }
  const prepared = await Promise.all(
    turns.map((turn) => prepareProcessAgentTurn(turn.role, item, projectMode))
  );
  const fileLocations = await referencedFileLocations(item);
  await acquireClaim(item);
  // allSettled, not all: a rejected sibling must not leave the other run orphaned behind a
  // released claim. Every hand-over finishes before the first failure is reported.
  const settled = await Promise.allSettled(
    prepared.map(async ({ agent, composition, teamRoot }, index) => {
      const turn = turns[index]!;
      await repository.recordSkillUse(
        workspace.teamId,
        composition.capabilities.filter(({ kind }) => kind === "skill").map(({ ref }) => ref)
      );
      const outcome = await runCoordinator.start({
        // The item's approved files ride along: a brief that says "the requirements are in
        // roteris.txt" is useless to an agent that was never handed the file.
        item: { ...item, description: turn.prompt },
        agent,
        teamId: workspace.teamId,
        teamRoot,
        fileLocations,
        ...composition,
        stages: [],
        manualProjection: true,
        ...(turn.executionId ? { executionId: turn.executionId, message: turn.prompt } : {}),
        ...(projectMode ? { projectWorkItemId: item.id } : {}),
        onCreated: async () => refresh()
      });
      await applySettledExecution(outcome.executionId, true);
      const execution = await repository.getExecution(outcome.executionId);
      if (!execution) throw new Error("The project agent receipt is unavailable");
      if (execution.status !== "completed") {
        throw new Error(execution.error ?? `${agent.name} did not complete`);
      }
      return execution;
    })
  );
  const failures = settled.flatMap((result) =>
    result.status === "rejected" ? [result.reason as Error] : []
  );
  if (failures.length) {
    await releaseClaim(item.id).catch(() => undefined);
    throw failures.length === 1 ? failures[0] : new AggregateError(failures, errorText(failures[0]));
  }
  return settled.map((result) => (result as PromiseFulfilledResult<Execution>).value);
}

async function runItem(
  itemId: string,
  auto = false,
  continuation?: { execution: Execution; message: string },
  restartedFromExecutionId?: string,
  scheduled = false
): Promise<void> {
  const item = (await repository.getWorkItem(itemId)) ?? teamItems.find(({ id }) => id === itemId);
  if (!item) throw new Error("Work item not found");
  const process = processes.find(({ id }) => id === item.processId);
  const stage = process?.stages.find(({ id }) => id === item.stageId);
  if (!process || !stage) throw new Error("This work item has no active process step");
  const currentAgent = agentForItem(item);
  const originalAgent = continuation
    ? agents.find(({ id }) => id === continuation.execution.agentId)
    : null;
  const agent = continuation
    ? originalAgent
      ? { ...originalAgent, config: continuation.execution.config }
      : null
    : currentAgent;
  if (!agent) {
    throw new Error(
      continuation
        ? "The agent used by this run no longer exists"
        : "No agent is set to run on this status"
    );
  }
  const selectedModel = resolveModelChoice(agent.config, assistantModel);
  let runAgent =
    !continuation && modelRef(agent.config) !== modelRef(selectedModel)
      ? {
          ...agent,
          config: {
            ...agent.config,
            provider: selectedModel.provider,
            model: selectedModel.model
          }
        }
      : agent;
  const goalEffect = isGoalsProcess(process) ? item.goal?.effect ?? "prepare" : undefined;
  if (goalEffect === "external_write") {
    if (!item.goal?.authorizedAt || !item.goal.planOutputId) {
      throw new Error("This external action has no approval receipt");
    }
    if (continuation || (await repository.listExecutionsForWorkItem(item.id)).length) {
      throw new Error("This external action approval has already been used; approve a fresh task to retry");
    }
    runAgent = {
      ...runAgent,
      config: {
        ...runAgent.config,
        validationRules: [...new Set([
          ...(runAgent.config.validationRules ?? []),
          "action-receipt"
        ])]
      }
    };
  }
  const eligibility = eligibilityForAgent(runAgent);
  if (!eligibility.active) {
    throw new Error(`${runAgent.name} is inactive: ${eligibility.reason}`);
  }
  if (!agent.config.prompt.trim()) throw new Error(`${agent.name} has no instructions yet`);
  if (activeExecutionForItem(item.id, executions)) {
    throw new Error("This work item is already running on this device");
  }
  const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
  if (!mapping) throw new Error("Set a local team folder before running work");
  const classification =
    typeof runAgent.config.dataClassification === "string"
      ? runAgent.config.dataClassification
      : undefined;
  const sharedContext = {
    agentId: runAgent.id,
    ...(classification ? { dataClassification: classification } : {}),
    run: { automatic: auto, scheduled, continuation: Boolean(continuation) }
  };
  if (scheduled) {
    await enforceControl(
      controlInput("schedule.run", { type: "work_item", id: item.id, attributes: {} }, sharedContext)
    );
  }
  await enforceControl(
    controlInput("run.start", { type: "work_item", id: item.id, attributes: {} }, sharedContext)
  );
  await enforceControl(
    controlInput(
      "model.invoke",
      { type: "model", id: modelRef(runAgent.config), attributes: {} },
      {
        ...sharedContext,
        model: {
          id: modelRef(runAgent.config),
          provider: runAgent.config.provider ?? "",
          location: localModels.isLocalModel(modelRef(runAgent.config)) ? "local-device" : "external"
        }
      }
    ),
    !auto
  );
  await enforceControl(
    controlInput(
      "file.stage",
      {
        type: "file_set",
        attributes: {
          count: item.logicalFiles.length,
          hasLinkedLocations: item.logicalFiles.some(
            (reference) => Boolean(parseLogicalFileReference(reference).locationId)
          )
        }
      },
      sharedContext
    )
  );
  if (localModels.isLocalModel(modelRef(runAgent.config))) {
    await localModels.requireRunning(runAgent.config.model);
  }
  // Default folders are created on demand; a vanished override is a real error the user must fix.
  await (mapping.override
    ? workspaces.validateDirectory(mapping.localPath)
    : workspaces.ensureDirectory(mapping.localPath)
  ).catch(() => {
    throw new Error(`Team folder is unavailable: ${mapping.localPath}`);
  });
  if (!continuation) await ensureKnowledgeConnection();
  await acquireClaim(item);
  try {
    const fileLocations = await referencedFileLocations(item);
    let composition = continuation
      ? { capabilities: [], mcpConnections: [], delegates: [] }
      : runComposition(runAgent);
    if (!continuation) {
      const projected = await projectToolsByPolicy(runAgent, composition);
      runAgent = projected.agent;
      composition = projected.composition;
      const goalProjection = projectToolsByGoalEffect(goalEffect, runAgent, composition);
      runAgent = goalProjection.agent;
      composition = goalProjection.composition;
    }
    const report = controlIdentity();
    const startedAt = Date.now();
    if (report) {
      await reportMetric(repository, report, "run.started", 1, {
        team: workspace.teamId,
        agent: runAgent.id
      }).catch(() => undefined);
    }
    // Stamped before the run rather than after it: what matters to the curator is that a skill
    // was put in front of a model, not whether that run went on to succeed.
    await repository
      .recordSkillUse(
        workspace.teamId,
        composition.capabilities.filter(({ kind }) => kind === "skill").map(({ ref }) => ref)
      )
      .catch(() => undefined);
    const outcome = await runCoordinator.start({
      item,
      agent: runAgent,
      teamId: workspace.teamId,
      teamRoot: mapping.localPath,
      fileLocations,
      ...composition,
      ...(continuation
        ? { executionId: continuation.execution.id, message: continuation.message }
        : {}),
      ...(restartedFromExecutionId ? { restartedFromExecutionId } : {}),
      stages: process.stages.map(({ name }) => name),
      ...(goalStageForRun(process, stage) ? { goalStage: stage.name } : {}),
      ...(goalEffect ? { goalEffect } : {}),
      ...(isGoalsProcess(process)
        ? { workerRoles: goalWorkerRoles().map(({ role, purpose }) => ({ role, purpose })) }
        : {}),
      ...(item.parentId
        ? { parent: teamItems.find(({ id }) => id === item.parentId)! }
        : {}),
      children: teamItems.filter(({ parentId }) => parentId === item.id),
      feedback: await repository.listRejectionFeedback(item.id),
      onCreated: async (executionId) => {
        if (!continuation) liveEvents.set(executionId, []);
        else {
          for (const output of executionOutputs.filter(
            ({ executionId: ownerId }) => ownerId === executionId
          )) {
            outputPreviews.delete(output.id);
          }
        }
        // An autonomous run must not yank the user out of whatever they are looking at.
        if (!auto) {
          activeExecutionId = executionId;
          view = "run";
        }
        await refresh();
      },
    });
    await applySettledExecution(outcome.executionId, true);
    if (report) {
      await Promise.all([
        reportMetric(repository, report, "run.completed", 1, {
          team: workspace.teamId,
          agent: runAgent.id,
          outcome: outcome.status
        }),
        reportMetric(repository, report, "run.duration", Date.now() - startedAt, {
          team: workspace.teamId,
          agent: runAgent.id,
          outcome: outcome.status
        }),
        ...(outcome.outputs.length
          ? [reportMetric(repository, report, "review.pending", outcome.outputs.length, { team: workspace.teamId })]
          : [])
      ]).catch(() => undefined);
    }
  } catch (error) {
    const executionId =
      typeof error === "object" && error && "executionId" in error
        ? String(error.executionId)
        : "";
    const settled = executionId ? await repository.getExecution(executionId) : null;
    if (
      goalEffect === "external_write" &&
      settled?.status !== "completed" &&
      !settled?.result?.projectionState
    ) {
      await repository.setWorkItemStatus(item.id, "blocked").catch(() => undefined);
    }
    if (settled?.endedAt && settled.result?.projectionState) {
      await applySettledExecution(executionId, true);
    } else {
      await releaseClaim(item.id).catch(() => undefined);
      if (settled?.workspaceRef) await workspaces.cleanup(settled.workspaceRef).catch(() => undefined);
      notifyLocal("Bees run failed", errorText(error));
      await refresh();
    }
    throw error;
  }
}

/**
 * Retries whatever conversation purges are outstanding. Cheap and silent when the queue is
 * empty, which is the normal case — it only fills when a user deletes a run.
 */
async function retryConversationPurges(): Promise<ReturnType<typeof drainConversationPurges>> {
  const pending = await repository.listPendingConversationPurges();
  if (!pending.length) return { purged: 0, pending: 0, lastError: null };
  const { baseUrl, token } = await ensureFlueRuntime();
  return drainConversationPurges(repository, new FlueRuntime(baseUrl, undefined, token));
}

async function deleteRun(executionId: string): Promise<void> {
  const execution = await repository.getExecution(executionId);
  if (!execution) return;
  if (["queued", "running"].includes(execution.status)) {
    await runCoordinator.stop(executionId);
    showNotice("The run is stopping. Delete it after Flue reports the final result.", "info");
    await refresh();
    return;
  }
  if (execution.workspaceRef && execution.result?.projectMode !== true) {
    await workspaces.cleanup(execution.workspaceRef).catch(() => undefined);
  }
  await repository.deleteExecution(executionId, runtimeAgentName(execution.agentId));
  const localPurgeFailed = await flueProjectPort
    .purgeExecution(executionId)
    .then(() => false)
    .catch(() => true);
  // Never report the run deleted while its conversation is still in the runtime.
  const report = await retryConversationPurges().catch(() => ({
    purged: 0,
    pending: 1,
    lastError: "The local runtime is unavailable"
  }));
  if (activeExecutionId === executionId) view = "runs";
  await refresh();
  showNotice(
    localPurgeFailed
      ? "Run removed, but its local capability snapshot could not be deleted. Restart Bees and try again."
      : purgeNotice(report),
    localPurgeFailed || report.pending ? "error" : "success"
  );
}

let liveObservation: { executionId: string; controller: AbortController } | null = null;

/**
 * Follow a still-running conversation for the open run page. Presentation only: Rust settles
 * the run whether or not anyone is watching, so closing this changes nothing but the view.
 */
async function observeRun(execution: Execution): Promise<void> {
  if (liveObservation?.executionId === execution.id) return;
  liveObservation?.controller.abort();
  liveObservation = null;
  if (!["queued", "running"].includes(execution.status)) return;
  const controller = new AbortController();
  liveObservation = { executionId: execution.id, controller };
  const { baseUrl, token } = await ensureFlueRuntime();
  new FlueRuntime(baseUrl, undefined, token).observe(
    runtimeAgentName(execution.agentId),
    execution.conversationId,
    (event) => {
      liveEvents.set(execution.id, [event]);
      if (view === "run" && activeExecutionId === execution.id) void views.renderRunDetail();
    },
    controller.signal
  );
}

async function openRun(executionId: string): Promise<void> {
  activeExecutionId = executionId;
  view = "run";
  const execution =
    executions.find(({ id }) => id === executionId) ?? (await repository.getExecution(executionId));
  if (execution) {
    await loadExecutionHistory(execution);
    void observeRun(execution).catch(() => undefined);
  }
  render();
}

async function loadExecutionHistory(execution: Execution): Promise<void> {
  if (execution.conversationSnapshot) return;
  if (!liveEvents.has(execution.id)) {
    const { baseUrl, token } = await ensureFlueRuntime();
    const history = await new FlueRuntime(baseUrl, undefined, token)
      .history(runtimeAgentName(execution.agentId), execution.conversationId)
      .catch(() => null);
    liveEvents.set(execution.id, history ? [history] : []);
  }
}

async function finishOutputReview(execution: Execution): Promise<void> {
  const outputs = await repository.listExecutionOutputs(execution.id);
  if (outputs.some(({ status }) => status === "pending")) return;
  // A skill proposal never moves the work item it hung off — approving it publishes a file into
  // the team folder, and the registry has to re-read that folder for agents to see it.
  if (isProposal(execution)) {
    const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
    if (mapping?.localPath && outputs.some(({ status }) => status === "approved")) {
      await ensureTeamSkillsRegistry(mapping.localPath);
    }
    return;
  }
  if (!outputs.some(({ status }) => status === "rejected")) {
    // approveTaskPlan already checkpointed the parent into Waiting in the same transaction that
    // created its children. A second checkpoint here would skip straight to Review.
    if (!outputs.some(({ logicalOutput }) => goalsController.matchesOutput(logicalOutput))) {
      await repository.checkpointWorkItem(
        execution.workItemId,
        outputs
          .filter(({ status }) => status === "approved")
          .map(({ logicalDestination }) => logicalDestination),
        typeof execution.result?.statusName === "string" ? execution.result.statusName : undefined
      );
      await syncCheckpoint(execution.workItemId);
    }
  } else {
    // Rejecting is asking for the work again: with no per-task Run button left, the item has to
    // become due on its own or it sits at this status forever.
    const item = await repository.getWorkItem(execution.workItemId);
    if (item?.goal?.effect === "external_write") {
      await repository.setWorkItemStatus(item.id, "blocked");
    } else {
      await repository.touchWorkItem(execution.workItemId);
    }
  }
  await releaseClaim(execution.workItemId);
}

/** Show a specific (org, account) connection. `userId` is "" for a local org. */
async function switchConnection(organizationId: string, userId: string): Promise<void> {
  workspace.organizationId = organizationId;
  await loadCachedControl(repository, organizationId);
  lastControlHealthAt = 0;
  knowledgePolicyOrgId = "";
  knowledgePolicy = null;
  knowledgeConnection = null;
  knowledgeError = "";
  activeUserId = userId;
  const organizationTeams = await repository.listTeams(organizationId);
  workspace.teamId = organizationTeams[0]?.id ?? "";
  activeBoard = null;
  activeProcess = null;
  view = organizationTeams.length ? "overview" : "preferences";
  await refreshAssistantCatalog();
  await refresh();
}

/** Switch to an org by id, picking any connection it has (or none, for a local org). */
async function switchOrganization(organizationId: string): Promise<void> {
  const userId = orgIsConnected(organizationId) ? firstConnUser(organizationId) : "";
  await switchConnection(organizationId, userId);
}

async function switchTeam(teamId: string, nextView: View = "board"): Promise<void> {
  workspace.teamId = teamId;
  activeBoard = null;
  activeProcess = null;
  view = nextView;
  await refresh();
  await seedDefaultRegistry();
  await seedStarterWorkflow();
}

async function createLocalOrg(): Promise<void> {
  const data = await actions.edit("New local organization", [
    { name: "name", label: "Organization name", placeholder: "My workspace" }
  ]);
  const name = String(data?.get("name") ?? "").trim();
  if (!name) return;
  const id = await repository.createOrganization(name);
  await ensureOrgFolders();
  await switchOrganization(id);
  showNotice(`Created ${name} (local)`, "success");
}

async function createConnectedOrg(): Promise<void> {
  // Refresh first so an expired saved session triggers sign-in instead of a doomed create call.
  await reconcileServerOrgs();
  // The chosen account owns the org (becomes admin). Need at least one account to pick from.
  let pool = [...accounts.values()];
  if (pool.length === 0) {
    const result = await promptSignIn("Sign in to create a connected organization");
    if (!result) return;
    await rememberAccount(result.user, result.token);
    pool = [...accounts.values()];
  }
  const data = await actions.edit(
    "New connected organization",
    [
      { name: "beta", label: "", type: "note", value: views.CONNECTED_ORG_BETA_COPY },
      { name: "name", label: "Organization name", placeholder: "Acme Inc" },
      {
        name: "admin",
        label: "Org admin account",
        type: "select",
        value: pool[0]!.user.id,
        options: pool.map(({ user }) => ({ label: user.email, value: user.id }))
      }
    ],
    "Create"
  );
  const name = String(data?.get("name") ?? "").trim();
  if (!data || !name) return;
  const account = accounts.get(String(data.get("admin")));
  if (!account) return;

  const { organization } = await api.createOrganization(account.token, name);
  await connect(organization.id, account.user, account.token);
  await reconcileServerOrgs().catch(() => {});
  await switchConnection(organization.id, account.user.id);
  showNotice(`Created ${name}`, "success");
}

/**
 * The org is out of free teams. Continue goes to payment; the footer link takes the 30-day trial.
 * Returns true when the caller should retry the action that hit the paywall.
 */
async function resolveTeamPaywall(message: string): Promise<boolean> {
  const token = orgToken();
  if (!token) throw new Error("Sign in to this organization first");
  const choice = await actions.edit(
    "More teams",
    [{ name: "explain", label: "", type: "note", value: message }],
    "Continue",
    "Or request or extend your trial by 30-days (unlimited teams)"
  );
  if (!choice) return false;
  if (choice.get("__action") === "footer") {
    await api.startTeamTrial(token, workspace.organizationId);
    await reconcileServerOrgs();
    showNotice("Trial running for 30 days", "success");
    return true;
  }
  const { url } = await api.checkout(token, workspace.organizationId);
  if (await api.completeStubCheckout(url)) {
    await reconcileServerOrgs();
    showNotice("Payment complete", "success");
    return true;
  }
  await openUrl(url);
  showNotice("Finish adding your card in the browser, then try again.", "success");
  return false;
}

/**
 * Register a team on the server, clearing the out-of-free-teams paywall if it fires. Returns the
 * server's team id — the local row must adopt it, or the same team gets a different id on every
 * desktop and never syncs. Null means the user backed out of paying: create nothing.
 */
async function createServerTeam(name: string): Promise<string | null> {
  const token = orgToken();
  if (!token) throw new Error("Sign in to this organization first");
  try {
    return (await api.createTeam(token, workspace.organizationId, name)).team.id;
  } catch (error) {
    // Out of free teams: let them pay or start a trial, then create the team.
    if (!(error instanceof ApiError) || error.status !== 402) throw error;
    if (!(await resolveTeamPaywall(error.message))) return null;
    return (await api.createTeam(token, workspace.organizationId, name)).team.id;
  }
}

// ---- Assistant ----

/** Names and counts only — see `contextPrompt`. Work items never go into the prompt. */
function assistantContext() {
  const board = activeBoard ? ` on the "${activeBoard.name}" dashboard` : "";
  return {
    processes,
    items: teamItems,
    agents,
    viewing: activeProcess ? `the "${activeProcess.name}" process${board}` : undefined
  };
}

async function loadAssistantSettings(): Promise<void> {
  const stored = await repository.getSetting<ModelChoice | null>(ASSISTANT_MODEL_KEY, null);
  if (stored?.provider && stored.model) {
    assistantModel =
      stored.provider === LOCAL_PROVIDER && stored.model === "active" && stored.localModelId
        ? { ...stored, model: stored.localModelId }
        : stored;
    hasUserModelChoice = true;
  }
  assistantExtraModels = await repository.getSetting<ModelChoice[]>(ASSISTANT_EXTRA_MODELS_KEY, []);
}

async function rememberModelChoice(choice: ModelChoice): Promise<void> {
  const localModelId =
    choice.provider === LOCAL_PROVIDER
      ? choice.localModelId ?? (choice.model === "active" ? localModels.wantedRunId : choice.model)
      : null;
  const remembered = localModelId ? { ...choice, model: localModelId, localModelId } : choice;
  assistantModel = remembered;
  hasUserModelChoice = true;
  await repository.setSetting(ASSISTANT_MODEL_KEY, remembered);
}

/** Rebuilt on open: a model downloaded or a key added since last time should just be there. */
async function refreshAssistantCatalog(): Promise<void> {
  const [local, aiConnections, cliInstalled] = await Promise.all([
    localModels.list().catch(() => []),
    listAiConnections(repository, aiConnectionScope()).catch(() => []),
    detectCliTools().catch(() => ({} as Record<string, CliToolPath>))
  ]);
  assistantCatalog = modelCatalog({
    local,
    connections: aiConnections,
    cliInstalled,
    extras: assistantExtraModels
  });
  machineModelAvailability = {
    localModelIds: local
      .filter(({ runtime }) => runtime.running)
      .map(({ id }) => id),
    connectedProviders: [...new Set(aiConnections.map(({ provider }) => provider))],
    cliProviders: CLI_TOOLS.filter(({ id }) => cliInstalled[id]).map(({ provider }) => provider)
  };
  if (!hasUserModelChoice) assistantModel = preferredModelChoice(assistantCatalog);
}

function overviewAssistantModels(): ModelOption[] {
  return assistantCatalog.length
    ? assistantCatalog
    : [{ group: "Selected", label: modelLabel(assistantModel, assistantCatalog), choice: assistantModel }];
}

/**
 * Point this launch at a different coordination server, from `--server <value>` or
 * `BEES_API_URL`. A launch flag, not a setting: it is a thing you do while working on the
 * server, and it must not linger as state a later run silently inherits.
 *
 * The CSP in tauri.conf.json is what actually decides which hosts the webview may reach, so
 * an address outside it is rejected here with a message rather than left to fail later as an
 * opaque "Can't reach server".
 */
async function applyServerOverride(): Promise<void> {
  const override = await invoke<string>("api_server_override").catch(() => "");
  if (!override || override === defaultApiBaseUrl) return;
  if (!isReachableUnderCsp(override)) {
    showNotice(
      `Ignoring --server ${override}: the app's CSP only allows ${defaultApiBaseUrl}, http://localhost:3000, https://app.bees.bot and http://127.0.0.1:<port>.`,
      "error"
    );
    return;
  }
  setApiBaseUrl(override);
  showNotice(`Using coordination server ${override}`, "info");
}

/** Mirrors `connect-src` in tauri.conf.json. Note localhost is allowed on port 3000 only. */
function isReachableUnderCsp(url: string): boolean {
  try {
    const { protocol, hostname, port } = new URL(url);
    if (url === defaultApiBaseUrl || url === "https://app.bees.bot") return true;
    if (protocol !== "http:") return false;
    return hostname === "127.0.0.1" || (hostname === "localhost" && port === "3000");
  } catch {
    return false;
  }
}

async function restoreSession(): Promise<void> {
  const brandingRaw = await repository.getSetting("org_branding", "");
  if (brandingRaw) {
    try {
      orgBranding = JSON.parse(brandingRaw) as Record<string, OrgBranding>;
    } catch {
      // ignore malformed branding
    }
  }
  const connectedRaw = await repository.getSetting("connected_org_ids", "");
  if (connectedRaw) {
    try {
      for (const id of JSON.parse(connectedRaw) as string[]) connectedOrgs.add(String(id));
    } catch {
      // ignore malformed marker
    }
  }
  const accountsRaw = await repository.getSetting("account_sessions", "");
  if (accountsRaw) {
    try {
      for (const entry of JSON.parse(accountsRaw) as { user: SessionUser; token: string }[]) {
        if (entry?.user?.id && entry.token) accounts.set(entry.user.id, entry);
      }
    } catch {
      // ignore malformed account pool
    }
  }
  const connectionsRaw = await repository.getSetting("org_connections", "");
  if (connectionsRaw) {
    try {
      for (const key of JSON.parse(connectionsRaw) as string[]) connections.add(String(key));
    } catch {
      // ignore malformed connection store
    }
  }
  const seenRaw = await repository.getSetting(SEEN_CONNECTIONS_KEY, "");
  if (seenRaw) {
    try {
      for (const key of JSON.parse(seenRaw) as string[]) seenConnections.add(String(key));
    } catch {
      // ignore malformed marker
    }
  } else {
    // Upgrading: treat every org already on this machine as seen by every pooled account, so the
    // first reconcile after the update auto-connects genuinely new memberships only — a logged-out
    // org from before the upgrade is not silently signed back in.
    for (const key of connections) seenConnections.add(key);
    for (const orgId of connectedOrgs) {
      for (const userId of accounts.keys()) seenConnections.add(connKey(orgId, userId));
    }
  }

  // Migrate legacy per-org tokens (and an older single auth_token) into connections by matching
  // each stored token back to a pooled account.
  const userOf = (token: string): string | undefined =>
    [...accounts.values()].find((account) => account.token === token)?.user.id;
  const legacyTokens: Record<string, string> = {};
  const legacyRaw = await repository.getSetting("org_tokens", "");
  if (legacyRaw) {
    try {
      Object.assign(legacyTokens, JSON.parse(legacyRaw) as Record<string, string>);
    } catch {
      // ignore malformed legacy token store
    }
  }
  const legacySingle = await repository.getSetting("auth_token", "");
  if (legacySingle && workspace.organizationId) legacyTokens[workspace.organizationId] ??= legacySingle;
  for (const [orgId, token] of Object.entries(legacyTokens)) {
    const userId = userOf(String(token));
    if (userId) connections.add(connKey(orgId, userId));
  }
  if (legacyRaw) await repository.setSetting("org_tokens", "");
  if (legacySingle) await repository.setSetting("auth_token", "");

  // Drop connections whose account is no longer pooled. Reconciliation below removes sessions
  // only when the server explicitly rejects them, so launching offline keeps valid sign-ins.
  for (const key of [...connections]) {
    if (!accounts.has(connParts(key).userId)) forgetAccountConnections(connParts(key).userId);
  }
  await persistConnections();

  activeUserId = orgIsConnected(workspace.organizationId) ? firstConnUser(workspace.organizationId) : "";
  if (accounts.size) await reconcileServerOrgs();
}

/** Default the workspace root to <home>/Bees on first launch, then create org/team folders on disk. */
async function ensureOrgFolders(): Promise<void> {
  let root = await repository.getSetting("global_local_path", "");
  if (!root) {
    root = await workspaces.defaultRoot();
    await repository.setSetting("global_local_path", root);
  }
  await workspaces.ensureDirectory(root).catch(() => {});
  for (const org of await repository.listOrganizations()) {
    const orgPath = await repository.getOrgFolder(org.id);
    if (orgPath) await workspaces.ensureDirectory(orgPath).catch(() => {});
    for (const team of await repository.listTeams(org.id)) {
      const mapping = await repository.getResolvedTeamFolder(team.id);
      if (mapping && !mapping.override) await workspaces.ensureDirectory(mapping.localPath).catch(() => {});
    }
  }
}

/** Retry transient sidecar startup failures, then make every unrecoverable row explicit. */
async function resumeInterruptedRuns(resumed: Execution[]): Promise<void> {
  let lastError: unknown;
  for (const delay of [0, 1_000, 5_000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await runCoordinator.resume(resumed);
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    for (const execution of resumed) {
      const active = await invoke<boolean>("run_is_active", { executionId: execution.id }).catch(
        () => false
      );
      if (!active && !(await repository.getExecution(execution.id))?.endedAt) {
        await repository.updateExecution(execution.id, "interrupted", { error: message });
      }
    }
    showNotice(message, "error");
  }
  for (const execution of await repository.listPendingExecutionProjections()) {
    await applySettledExecution(execution.id, false).catch((error) =>
      showNotice(errorText(error), "error")
    );
  }
}

async function start(): Promise<void> {
  try {
    // Before the workspace loads: an update that replaces the app should not land in the
    // middle of a session. Not awaited, so a slow endpoint cannot hold up startup.
    void checkForUpdate().catch((error) => showNotice(errorText(error), "error"));
    workspace = await repository.bootstrap();
    view = startupView(await repository.getSetting(LAST_VIEW_KEY, ""));
    await listen<SettledRun>("run-settled", ({ payload }) => {
      void applySettledExecution(payload.executionId, true).catch((error) =>
        showNotice(errorText(error), "error")
      );
    });
    await localModels.load();
    await listen<LocalModelProgress>("local-model-progress", ({ payload }) => {
      localModelProgress.set(payload.modelId, payload);
      const bar = [...document.querySelectorAll<HTMLProgressElement>("[data-local-model-progress]")].find(
        (element) => element.dataset.localModelProgress === payload.modelId
      );
      if (bar) {
        bar.max = payload.totalBytes || 1;
        bar.value = payload.downloadedBytes;
      }
      const status = [...document.querySelectorAll<HTMLElement>("[data-local-model-status]")].find(
        (element) => element.dataset.localModelStatus === payload.modelId
      );
      if (status) {
        status.textContent = views.localModelStatusLabel(
          payload.state,
          payload.downloadedBytes,
          payload.totalBytes,
          payload.error
        );
      }
      // A download that finished after a reload has no in-page promise left waiting on it, so the
      // event is what starts the model the user asked for. runLocalModel ignores a repeat call
      // while its own start is already in flight.
      if (payload.state === "ready" && localModels.wantedRunId === payload.modelId) {
        actions.runLocalModel(payload.modelId);
      }
      if (payload.state !== "downloading" && view === "preferences" && prefsTab === "local-models") {
        void views.renderPreferences();
      }
    });
    await ensureOrgFolders();
    runnerId = await repository.getSetting("runner_id", "");
    if (!runnerId) {
      runnerId = crypto.randomUUID();
      await repository.setSetting("runner_id", runnerId);
    }
    appVersion = await getVersion().catch(() => "dev");
    await loadCachedControl(repository, workspace.organizationId);
    // A recovered run's immutable MCP seed points at the stable loopback URL and vault ref.
    // Bring that worker back before Flue re-adopts the run after an app restart.
    const cachedKnowledge = await loadCachedKnowledgePolicy(repository, workspace.organizationId);
    if (cachedKnowledge?.mode === "local" && workspace.teamId) {
      knowledgePolicy = cachedKnowledge;
      knowledgePolicyOrgId = workspace.organizationId;
      await ensureKnowledgeConnection().catch((error) => {
        knowledgeError = errorText(error);
      });
    }
    // A persisted delivery key makes either path safe: adopt its known submission, or resend
    // the exact pre-admission message and let Flue converge on the same receipt.
    const resumed = await repository.listNonTerminalExecutions();
    void resumeInterruptedRuns(resumed).catch((error) =>
      showNotice(errorText(error), "error")
    );
    void retryConversationPurges().catch(() => undefined);
    await loadTheme();
    await loadAssistantSettings();
    // Before restoreSession: every call it makes has to go to the server this launch chose.
    await applyServerOverride();
    // Catch deep links: OAuth callback (bees://auth/callback?token=…) and invites (bees://invite/<id>).
    await onOpenUrl((urls) => routeDeepLink(urls));
    try {
      await restoreSession();
    } catch (error) {
      showNotice(errorText(error), "error");
    }
    await refreshAssistantCatalog();
    for (const execution of await repository.listPendingExecutionProjections()) {
      await applySettledExecution(execution.id, false, false).catch((error) =>
        showNotice(errorText(error), "error")
      );
    }
    await refresh();
    await seedDefaultRegistry();
    await seedStarterWorkflow();
    // Re-copied at launch and after each write, not on every refresh: the snapshot only changes
    // when someone edits the team folder. ponytail: add a watcher if hand-edits need to show sooner.
    const teamFolder = await repository.getResolvedTeamFolder(workspace.teamId);
    if (teamFolder?.localPath) await ensureTeamSkillsRegistry(teamFolder.localPath);
    await scheduler.start();
    startBackgroundSync();
    // Nothing in the app is required to hand its errors to the boundary — these catch the ones
    // that were never handed anywhere, which is exactly the class that used to vanish.
    window.addEventListener("error", (event) => reportFailure(event.error ?? event.message));
    window.addEventListener("unhandledrejection", (event) => reportFailure(event.reason));
    if (resumed.length) {
      // These continue where they were, so the language must not promise a fresh start.
      notifyLocal(
        "Bees is picking up where it left off",
        `${resumed.length} run${resumed.length === 1 ? "" : "s"} accepted before Bees closed ${
          resumed.length === 1 ? "is" : "are"
        } being settled. Local work does not run while Bees is closed.`
      );
      // Autopilot must not start a second attempt at an item Rust is already settling.
      for (const { workItemId } of resumed) {
        const item = teamItems.find(({ id }) => id === workItemId);
        if (item) for (const key of autonomousRunKeys(item)) autopilotDone.add(key);
      }
    }
    // Reconcile above may have dropped the connection this session was resumed on (removed from org).
    if (!activeConnectionValid()) await moveOffHidden();
    // Cold start: if a bees:// link launched the app, onOpenUrl won't fire — read the launch
    // URL now that accounts are loaded. (Runtime clicks while open are caught by onOpenUrl.)
    const launchUrls = await getCurrentDeepLink().catch(() => null);
    if (launchUrls?.length) routeDeepLink(launchUrls);
  } catch (error) {
    swap(`<div class="hero min-h-80 rounded-box border border-dashed border-base-300 bg-base-100">
      <div class="hero-content text-center"><div>
        <h2 class="text-xl font-bold">Open Bees in its desktop shell</h2>
        <p class="mt-2 text-sm text-error">${escapeHtml(error instanceof Error ? error.message : error)}</p>
      </div></div>
    </div>`);
  }
}

void start();
