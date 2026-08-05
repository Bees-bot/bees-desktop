import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrent as getCurrentDeepLink, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openUrl } from "@tauri-apps/plugin-opener";
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
  logicalFileReference,
  needsAutonomousRun,
  parseBoardFilters,
  parseLogicalFileReference
} from "./domain.js";
import {
  runtimeAgentName,
  FlueProjectService,
  TauriFlueProjectPort
} from "./flue-project.js";
import { AgentFileStore, TauriAgentFilePort, newAgent, skillSlug } from "./agent-files.js";
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
  type LocalModelProgress,
  type LocalModelView,
  type SystemCapacity
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
import {
  inboxView,
  overviewView,
  runView,
  runsView,
  schedulesView,
  searchResultsView,
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
import { CLI_TOOLS, detectCliTools } from "./cli-tools.js";
import {
  GOALS_PROCESS_NAME,
  GOALS_STAGES,
  TASK_PLAN_OUTPUT,
  parseTaskPlan
} from "./goals.js";
import {
  PROCESS_LIBRARY,
  processLibraryEntry,
  type ProcessLibraryEntry
} from "./process-library.js";
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

type View =
  | "overview"
  | "inbox"
  | "board"
  | "processes"
  | "item"
  | "agents"
  | "agent"
  | "runs"
  | "run"
  | "schedules"
  | "settings"
  | "org-settings"
  | "preferences";
type PrefsTab = "theme" | "local-models" | "connections" | "signins" | "orgs" | "folder";
type OrgTab = "general" | "members" | "invites" | "folder" | "knowledge";
type TeamTab = "members" | "folder" | "integrations" | "browser" | "archived" | "danger";
// All daisyUI v5 built-in themes (keep in sync with themes: all in styles.css).
const THEMES = [
  "light", "dark", "cupcake", "bumblebee", "emerald", "corporate", "synthwave",
  "retro", "cyberpunk", "valentine", "halloween", "garden", "forest", "aqua",
  "lofi", "pastel", "fantasy", "wireframe", "black", "luxury", "dracula", "cmyk",
  "autumn", "business", "acid", "lemonade", "night", "coffee", "winter", "dim",
  "nord", "sunset", "caramellatte", "abyss", "silk"
] as const;
type ThemePreset = (typeof THEMES)[number];
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

type KnowledgeRuntimeInfo = { url: string; token: string; sourceCount: number };

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
let activeAgentId = "";
let agentTab: "builder" | "runs" = "builder";
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
// Which teams are expanded in the left nav. Independent per team (not tied to selection).
const expandedTeams = new Set<string>();
// Left-nav dashboards per team id — every team, not only the open one. See loadDashboardsByTeam.
let dashboardsByTeam = new Map<string, { board: Board; process: Process; count: number }[]>();
let view: View = "overview";
let processesPage: "team" | "library" = "team";
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
      await runItem(schedule.workItemId, true, undefined, undefined, true);
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
  const data = await edit("Sign in", [
    { name: "email", label: "Email", placeholder: "you@example.com" },
    { name: "password", label: "Password", type: "password" }
  ]);
  if (!data) return null;
  return api.signInEmail(String(data.get("email") ?? ""), String(data.get("password") ?? ""));
}

async function signUpUser(): Promise<AuthResult | null> {
  const data = await edit("Create your account", [
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
  const auth = await edit(title, [{ name: "method", label: "Continue with", type: "select", options }]);
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

/** A settings page: left sub-menu + right content. `attr` is the data-* used to switch tabs. */
function pageWithMenu(
  attr: string,
  items: { id: string; label: string }[],
  active: string,
  content: string
): string {
  return `<div class="grid gap-5 lg:grid-cols-[190px_1fr]">
    <aside class="h-max rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
      <ul class="menu menu-sm gap-0.5">${items
        .map(
          ({ id, label }) =>
            `<li><button class="${activeClass(id === active)}" data-${attr}="${id}">${escapeHtml(label)}</button></li>`
        )
        .join("")}</ul>
    </aside>
    <section class="min-w-0">${content}</section>
  </div>`;
}

interface Tab<Id extends string> {
  id: Id;
  label: string;
  content: () => string | Promise<string>;
}

/**
 * One list per settings page: the menu entry and the thing it renders stay together, so a tab
 * cannot be listed without a body or gain one it never shows. `stillHere` is re-checked after
 * the await — the user can navigate away while a tab's content is still loading.
 */
async function renderTabs<Id extends string>(
  attr: string,
  tabs: [Tab<Id>, ...Tab<Id>[]],
  active: Id,
  stillHere: () => boolean
): Promise<void> {
  const content = await (tabs.find(({ id }) => id === active) ?? tabs[0]).content();
  if (!stillHere()) return;
  swap(pageWithMenu(attr, tabs, active, content));
}

function gearIcon(cls = "size-5"): string {
  return `<svg viewBox="0 0 24 24" class="${cls}" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M8.94 4.61 10.06 4.24 10.14 1.46h3.72l.08 2.78 1.12.37 1.06.53 2.02-1.9 2.62 2.62-1.9 2.02.53 1.06.37 1.12 2.78.08v3.72l-2.78.08-.37 1.12-.53 1.06 1.9 2.02-2.62 2.62-2.02-1.9-1.06.53-1.12.37-.08 2.78h-3.72l-.08-2.78-1.12-.37-1.06-.53-2.02 1.9-2.62-2.62 1.9-2.02-.53-1.06-.37-1.12-2.78-.08v-3.72l2.78-.08.37-1.12.53-1.06-1.9-2.02 2.62-2.62 2.02 1.9ZM12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z" clip-rule="evenodd"></path></svg>`;
}

/** "Active org: <name> — <who>" line under the org row. Text opens preferences; gear opens org settings. */
function renderActiveOrg(): void {
  const org = currentOrganization();
  if (!org) {
    orgStatus.innerHTML = "";
    return;
  }
  const who = orgIsConnected(org.id) ? (currentUser()?.email ?? "connected") : "local";
  orgStatus.innerHTML = `<div class="flex items-center gap-1 rounded-lg border border-base-300 bg-base-100 px-2 py-1.5 shadow-sm">
      <button class="min-w-0 flex-1 text-left" data-view="preferences">
        <span class="block text-[10px] font-bold uppercase tracking-widest text-base-content/45">Active org</span>
        <span class="block truncate text-xs font-semibold">${escapeHtml(org.name)} — ${escapeHtml(who)}</span>
      </button>
      <button class="btn btn-square btn-ghost btn-xs" data-view="org-settings" aria-label="Organization settings" title="Organization settings">
        ${gearIcon()}
      </button>
    </div>`;
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
  const waitingPosition = GOALS_STAGES.indexOf("Waiting");
  const reviewPosition = GOALS_STAGES.indexOf("Review");
  const ready = teamItems.flatMap((item) => {
    const process = processes.find(({ id }) => id === item.processId);
    const waiting = process?.stages.find(({ id }) => id === item.stageId);
    const review = process?.stages.find(({ position }) => position === reviewPosition);
    if (waiting?.position !== waitingPosition || !review || item.status !== "open") return [];
    const children = teamItems.filter(({ parentId }) => parentId === item.id);
    return children.length > 0 && children.every(({ status }) => status === "done")
      ? [{ parent: item, review }]
      : [];
  });
  for (const { parent, review } of ready) {
    const files = teamItems
      .filter(({ parentId }) => parentId === parent.id)
      .flatMap(({ logicalFiles }) => logicalFiles);
    await repository.checkpointWorkItem(parent.id, files, review.name);
  }
  return ready.length;
}

function renderNavigation(): void {
  // One icon per connection (org × account), so the same org shows twice if two accounts are in
  // it. Local orgs get one icon with no account. Hover shows the org name and account email.
  type Icon = { orgId: string; userId: string; name: string; email: string };
  const icons: Icon[] = [];
  for (const key of connections) {
    const { orgId, userId } = connParts(key);
    const org = organizations.find(({ id }) => id === orgId);
    if (!org) continue;
    icons.push({ orgId, userId, name: org.name, email: accounts.get(userId)?.user.email ?? "" });
  }
  for (const org of organizations) {
    if (!orgIsConnected(org.id)) icons.push({ orgId: org.id, userId: "", name: org.name, email: "local" });
  }
  icons.sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));

  orgRow.innerHTML =
    icons
      .map(({ orgId, userId, name, email }) => {
        const active = orgId === workspace.organizationId && userId === activeUserId;
        const branding = brandingFor(orgId);
        const ring = active ? "ring-2 ring-primary ring-offset-1 ring-offset-base-100" : "";
        const inner = branding.logo
          ? `<img src="${escapeHtml(branding.logo)}" alt="" class="size-full object-cover">`
          : `<span class="grid size-full place-items-center text-[11px] font-black text-white" style="background:${escapeHtml(
              branding.color || defaultOrgColor(name)
            )}">${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`;
        const label = `${name} — ${email}`;
        return `<button class="btn btn-xs btn-square overflow-hidden p-0 ${ring}" data-action="switch-org" data-id="${orgId}" data-account="${escapeHtml(
          userId
        )}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${inner}</button>`;
      })
      .join("") +
    `<button class="btn btn-xs btn-square btn-ghost tooltip tooltip-bottom border border-dashed border-base-300" data-action="new-organization" data-tip="Add organization" aria-label="Add organization">+</button>`;
  renderActiveOrg();

  // No active org (e.g. all deleted): teams need an org to belong to, so show nothing here.
  if (!workspace.organizationId) {
    teamNav.innerHTML = "";
    renderPrefsButton();
    return;
  }

  teamNav.innerHTML = `<ul class="menu menu-sm mb-4 gap-0.5 px-2">
      <li><button class="${activeClass(view === "overview")}" data-view="overview">Overview</button></li>
      <li><button class="${activeClass(view === "inbox")}" data-view="inbox">Inbox${
        executionOutputs.some(({ status }) => status === "pending")
          ? ` <span class="badge badge-warning badge-xs ml-auto">${executionOutputs.filter(({ status }) => status === "pending").length}</span>`
          : ""
      }</button></li>
    </ul>
    <div class="mb-2 flex items-center justify-between px-3">
      <span class="text-[11px] font-bold uppercase tracking-widest text-base-content/45">Teams</span>
      <button class="btn btn-circle btn-ghost btn-xs" data-action="new-team" aria-label="Add team">+</button>
    </div>
    ${
      teams.length
        ? teams
            .map((team) => {
              const selected = team.id === workspace.teamId;
              const expanded = expandedTeams.has(team.id);
              return `<section class="mb-2">
                <div class="flex items-center">
                  <button class="btn btn-ghost btn-sm min-w-0 flex-1 justify-start gap-2 px-3 ${selected ? "font-bold" : ""}"
                    data-action="toggle-team" data-id="${team.id}" aria-expanded="${expanded}">
                    <svg viewBox="0 0 24 24" class="size-3 shrink-0 transition-transform ${
                      expanded ? "rotate-90" : ""
                    }" fill="none" stroke="currentColor" stroke-width="3"><path d="M9 6l6 6-6 6"></path></svg>
                    <span class="grid size-6 place-items-center rounded-md bg-primary/10 text-xs font-bold text-primary">${escapeHtml(
                      team.name.slice(0, 1).toUpperCase()
                    )}</span>
                    <span class="truncate">${escapeHtml(team.name)}</span>
                  </button>
                  <button class="btn btn-square btn-ghost btn-xs mr-1 ${
                    selected && view === "settings" ? "btn-active" : ""
                  }" data-team-view="settings" data-team="${team.id}" aria-label="Team settings" title="Team settings">
                    ${gearIcon()}
                  </button>
                </div>
                ${
                  expanded
                    ? `<ul class="menu menu-sm gap-0.5 px-3 pb-2 pt-0">
                        ${(dashboardsByTeam.get(team.id) ?? [])
                          .map(({ board, process, count }) => {
                            const open = view === "board" && activeBoard?.id === board.id;
                            return `<li><button class="${activeClass(open)}" data-board="${board.id}" data-team="${team.id}">
                              Dashboard - ${escapeHtml(process.name)} <span class="badge badge-ghost badge-xs ml-auto">${count}</span>
                            </button></li>`;
                          })
                          .join("")}
                        <li class="mx-1 my-2 h-px bg-base-content/25 opacity-100"></li>
                        <li><button class="${activeClass(selected && view === "processes")}" data-team-view="processes" data-team="${
                          team.id
                        }">Processes</button></li>
                        <li><button class="${activeClass(selected && (view === "agents" || view === "agent"))}" data-team-view="agents" data-team="${
                          team.id
                        }">Agents</button></li>
                        <li><button class="${activeClass(selected && (view === "runs" || view === "run"))}" data-team-view="runs" data-team="${
                          team.id
                        }">Runs</button></li>
                        <li><button class="${activeClass(selected && view === "schedules")}" data-team-view="schedules" data-team="${
                          team.id
                        }">Schedules</button></li>
                      </ul>`
                    : ""
                }
              </section>`;
            })
            .join("")
        : `<div class="mx-2 rounded-box border border-dashed border-base-300 p-4 text-center text-xs text-base-content/50">
            Add a team to this organization.
          </div>`
    }`;

  renderPrefsButton();
}

/**
 * The Preferences button in the sidebar header, badged with the number of org invitations waiting
 * for any pooled account — otherwise an invite is only visible to someone who happens to open the
 * Orgs tab or click the emailed link.
 */
function renderPrefsButton(): void {
  const prefs = document.querySelector<HTMLButtonElement>("#preferences-button");
  if (!prefs) return;
  prefs.classList.toggle("btn-active", view === "preferences");
  prefs.querySelector(".invite-badge")?.remove();
  if (!pendingInvitations.length) return;
  prefs.title = `Preferences — ${pendingInvitations.length} pending invitation${
    pendingInvitations.length === 1 ? "" : "s"
  }`;
  prefs.insertAdjacentHTML(
    "beforeend",
    `<span class="invite-badge badge badge-warning badge-xs absolute -right-1 -top-1">${pendingInvitations.length}</span>`
  );
}

async function refresh(): Promise<void> {
  organizations = await repository.listOrganizations();
  teams = await repository.listTeams(workspace.organizationId);
  if (!teams.some(({ id }) => id === workspace.teamId)) workspace.teamId = teams[0]?.id ?? "";
  if (workspace.teamId) expandedTeams.add(workspace.teamId); // active team opens by default

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
      loadAgents(),
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
  renderNavigation();
  render();
  void autopilot();
}

async function seedDefaultRegistry(): Promise<void> {
  if (!workspace.teamId) return;
  const key = `default_registry_seeded_${workspace.teamId}`;
  if (await repository.getSetting(key, false)) return;
  const id = crypto.randomUUID();
  const files = await registryFiles.copyBundled(id);
  await repository.saveRegistry({
    id,
    teamId: workspace.teamId,
    name: "Bees defaults",
    sourcePath: "bundled://bees-default",
    files
  });
  await repository.setSetting(key, true);
  await refresh();
}

/**
 * Seeds the three ordinary agents that make Goals useful. The marker means deleting or replacing
 * one later is respected; Bees does not silently recreate user-owned agent files.
 */
async function seedGoalsWorkflow(): Promise<void> {
  if (!workspace.teamId) return;
  const key = `goals_workflow_seeded_${workspace.teamId}`;
  if (await repository.getSetting(key, false)) return;
  const template = processLibraryEntry("goals");
  if (!template) return;
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
  runningProcesses.add(process.id);
  await repository.setSetting(RUNNING_PROCESSES_KEY, [...runningProcesses]);
  await repository.setSetting(key, true);
  await refresh();
}

/**
 * Search runs on submit rather than on every keystroke: the results replace the view, and a
 * box that re-rendered itself under the cursor would lose focus on every letter.
 */
function searchBox(): string {
  return `<form class="mb-4 flex gap-2" data-run-search>
    <input class="input input-bordered flex-1" name="query" type="search" autocomplete="off"
      placeholder="Search work items and settled runs" value="${escapeHtml(searchQuery)}" />
    <button class="btn btn-primary" type="submit">Search</button>
    ${searchQuery.trim() ? `<button class="btn btn-ghost border border-base-300" type="button" data-action="clear-search">Clear</button>` : ""}
  </form>`;
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

function render(): void {
  renderNavigation();
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
    setHeader("Inbox", "Approvals and runs that need attention");
    swap(
      inboxView(
        teamItems,
        executions,
        executionOutputs.filter(({ status }) => status === "pending"),
        dismissedRunIds
      )
    );
  }
  if (view === "board") renderBoard();
  if (view === "processes") renderProcesses();
  if (view === "item") void renderWorkItemDetail();
  if (view === "agents") void renderAgents();
  if (view === "agent") void renderAgentDetail();
  if (view === "runs") {
    setHeader("Runs", currentTeam()?.name);
    swap(`${searchBox()}${searchQuery.trim() ? searchResultsView(searchHits) : runsView(teamItems, executions)}`);
  }
  if (view === "run") void renderRunDetail();
  if (view === "schedules") {
    setHeader("Schedules", currentTeam()?.name);
    swap(schedulesView(teamItems, schedules, executions));
  }
  if (view === "settings") void renderTeamSettings();
  if (view === "org-settings") void renderOrgSettings();
  if (view === "preferences") void renderPreferences();
}

async function renderWorkItemDetail(): Promise<void> {
  const item = teamItems.find(({ id }) => id === activeItemId);
  if (!item) {
    view = "board";
    renderBoard();
    return;
  }
  setHeader(item.title, currentTeam()?.name);
  const runs = executions.filter(({ workItemId }) => workItemId === item.id);
  const locations = await repository.listAvailableFileLocations(workspace.teamId);
  if (view !== "item" || activeItemId !== item.id) return;
  swap(workItemView(
    { ...item, logicalFiles: displayFileReferences(item.logicalFiles, locations) },
    runs,
    runs.map(conversationFor).filter(Boolean) as BeesConversationSnapshotV1[],
    itemTab
  ));
}

/**
 * Live runs are canonical in the runtime; a settled run reads the snapshot stored on its
 * receipt, which is why reopening one never needs the sidecar.
 */
function conversationFor(execution: Execution): BeesConversationSnapshotV1 | null {
  const live = liveEvents.get(execution.id);
  return live?.length ? conversationToSnapshotV1(live) : execution.conversationSnapshot;
}

async function renderRunDetail(): Promise<void> {
  const execution =
    executions.find(({ id }) => id === activeExecutionId) ??
    (activeExecutionId ? await repository.getExecution(activeExecutionId) : null);
  if (!execution) {
    view = "runs";
    render();
    return;
  }
  setHeader("Run", teamItems.find(({ id }) => id === execution.workItemId)?.title);
  swap(
    runView({
      execution,
      item: teamItems.find(({ id }) => id === execution.workItemId) ?? null,
      outputs: executionOutputs.filter(({ executionId }) => executionId === execution.id),
      snapshot: conversationFor(execution),
      previews: outputPreviews,
      remoteConnections: (execution.config.mcpConnectionRefs ?? []).map((id) => {
        const connection = mcpConnections.find((candidate) => candidate.id === id);
        return connection ? `${connection.name}${connection.lastError ? " (offline)" : ""}` : "Unavailable connection";
      })
    })
  );
}

async function renderAgentDetail(): Promise<void> {
  const agent = agents.find(({ id }) => id === activeAgentId);
  if (!agent) {
    view = "agents";
    await renderAgents();
    return;
  }
  const eligibility = eligibilityForAgent(agent);
  const enabledOnMachine = !disabledAgentIds.has(agent.id);
  const runs = executions.filter(({ agentId }) => agentId === agent.id);
  setHeader(agent.name, agent.purpose);
  const tabs = (["builder", "runs"] as const)
    .map(
      (tab) => `<button class="tab ${agentTab === tab ? "tab-active" : ""}" data-agent-tab="${tab}">${
        tab[0]!.toUpperCase() + tab.slice(1)
      }</button>`
    )
    .join("");
  const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
  const skillRefs = capabilityRefsFor(agent.config, "skill");
  const toolRefs = capabilityRefsFor(agent.config, "tool");
  const capabilityBadges = [
    ...registryCapabilities(registries)
      .filter(({ ref, kind }) => (kind === "skill" ? skillRefs : toolRefs).includes(ref))
      .map(({ name, kind }) => `${kind}: ${name}`),
    ...(agent.config.mcpConnectionRefs ?? []).map(
      (id) => `MCP: ${mcpConnections.find((connection) => connection.id === id)?.name ?? "missing"}`
    ),
    ...(agent.config.delegateRefs ?? []).map(
      (id) => `helper: ${agents.find((helper) => helper.id === id)?.name ?? "missing"}`
    )
  ];
  const content =
    agentTab === "builder"
      ? `<div class="grid gap-4 lg:grid-cols-2">
          <section class="card border border-base-300 bg-base-100"><div class="card-body">
            <h3 class="card-title">Configuration</h3>
            <dl class="grid gap-3 text-sm"><div><dt class="text-base-content/45">Model</dt><dd>${escapeHtml(
              modelRef(resolveModelChoice(agent.config, assistantModel))
            )}</dd></div><div><dt class="text-base-content/45">Trigger status</dt><dd>${escapeHtml(
              stageName(agent.triggerStageId) ?? "None"
            )}</dd></div><div><dt class="text-base-content/45">This machine</dt><dd class="flex items-center gap-2">${agentStatusButton(
              agent,
              eligibility,
              enabledOnMachine
            )}<span class="text-base-content/55">${escapeHtml(
              eligibility.reason
            )}</span></dd></div><div><dt class="text-base-content/45">Instructions</dt><dd class="whitespace-pre-wrap">${escapeHtml(
              agent.config.prompt
            )}</dd></div></dl>
            <div class="card-actions justify-end">
              ${actionIconButton("edit-agent", `Edit ${agent.name}`, ACTION_ICONS.edit, agent.id, "btn-primary")}
              ${actionIconButton("duplicate-agent", `Duplicate ${agent.name}`, ACTION_ICONS.duplicate, agent.id)}
            </div>
          </div></section>
          <section class="card border border-base-300 bg-base-100"><div class="card-body">
            <h3 class="card-title">Local scope</h3><p class="break-all text-sm">${escapeHtml(
              mapping?.localPath ?? "No team folder mapped"
            )}</p>
            <div class="flex flex-wrap gap-1">${capabilityBadges
              .map((label) => `<span class="badge badge-ghost">${escapeHtml(label)}</span>`)
              .join("") || '<span class="text-sm text-base-content/45">No optional capabilities selected.</span>'}</div>
            <div class="card-actions justify-end"><button class="btn btn-ghost btn-sm" data-action="open-folder-settings">Team folder settings</button></div>
          </div></section>
        </div>`
      : runsView(teamItems, runs);
  if (view === "agent") swap(`<div class="tabs tabs-border mb-5">${tabs}</div>${content}`);
}

function workItemBadges(item: WorkItem): string {
  const execution = activeExecutionForItem(item.id, executions);
  const agent = execution
    ? agents.find(({ id }) => id === execution.agentId)
    : agentForStage(item.stageId);
  const run =
    execution?.status === "running"
      ? "Running"
      : execution?.status === "queued"
        ? "Queued"
        : "Idle";
  const runTone =
    execution?.status === "running"
      ? "badge-success"
      : execution?.status === "queued"
        ? "badge-warning"
        : "badge-ghost";
  return `<span class="badge badge-ghost badge-sm">Owner: ${escapeHtml(item.owner || "Unassigned")}</span>
    <span class="badge badge-ghost badge-sm">Agent: ${escapeHtml(agent?.name || (execution ? "Unknown agent" : "Unassigned"))}</span>
    <span class="badge ${runTone} badge-sm">Run: ${run}</span>`;
}

function renderBoard(): void {
  setHeader(activeBoard?.name ?? "Work", activeProcess ? `${currentTeam()?.name} / ${activeProcess.name}` : undefined);
  if (!activeBoard || !activeProcess) {
    swap(`<div class="hero min-h-80 rounded-box border border-dashed border-base-300 bg-base-100">
      <div class="hero-content text-center"><div class="max-w-md">
        <div class="mb-3 text-4xl">▦</div>
        <h2 class="text-xl font-bold">Create your first process</h2>
        <p class="py-3 text-sm text-base-content/60">Each process gets its own dashboard, with its statuses as columns.</p>
        <button class="btn btn-primary" data-team-view="processes" data-team="${workspace.teamId}">New process</button>
      </div></div>
    </div>`);
    return;
  }
  const stages = activeProcess.stages.filter(({ id }) => activeBoard?.stageIds.includes(id));
  const running = runningProcesses.has(activeProcess.id);
  const filters = activeBoard.filters;
  const visible = items.filter((item) => !isFiltered(item, filters));
  const filtered = items
    .filter((item) => isFiltered(item, filters))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  swap(`<div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-3 text-sm text-base-content/55">
        <span class="eyebrow-pill"><span class="status status-primary"></span> Workflow board</span>
        ${processStateBadge(activeProcess.id)}
        <span class="badge badge-ghost">${stages.length} status${stages.length === 1 ? "" : "es"}</span>
        <span>${openWork(visible).length} item${openWork(visible).length === 1 ? "" : "s"}</span>
      </div>
      <div class="flex flex-wrap gap-2">
        ${processRunButtons(activeProcess.id, "btn-sm")}
        <button class="btn btn-ghost btn-sm border border-base-300" data-action="edit-board" data-id="${
          activeBoard.id
        }">Dashboard settings</button>
      </div>
    </div>
    ${
      running
        ? ""
        : '<div class="alert alert-warning mb-5 py-2 text-sm">This process is stopped — its agents will not pick up work until you press Run.</div>'
    }
    <div class="kanban">${stages
      .map((stage, stageIndex) => {
        const cards = visible.filter(({ stageId }) => stageId === stage.id);
        return `<section class="kanban-column p-3">
          <header class="flex items-center justify-between px-1 pb-3 pt-1">
            <div class="flex items-center gap-2">
              <span class="status ${stageIndex === stages.length - 1 ? "status-success" : "status-primary"}"></span>
              <h2 class="text-sm font-black tracking-[-.01em]">${escapeHtml(stage.name)}</h2>
            </div>
            <span class="badge badge-ghost badge-sm border-0">${cards.length}</span>
          </header>
          <div class="grid gap-3">${cards
            .map(
              (item) => `<article class="kanban-card card border border-base-300">
                <div class="card-body gap-3 p-4">
                  <div>
                    <p class="mb-2 text-[9px] font-black uppercase tracking-[.16em] text-primary">${escapeHtml(
                      stage.name
                    )}</p>
                    <h3 class="card-title text-sm font-black tracking-[-.015em]">${escapeHtml(item.title)}</h3>
                    <p class="mt-1 line-clamp-3 text-xs leading-relaxed text-base-content/60">${escapeHtml(
                      item.description || "No description"
                    )}</p>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    ${workItemBadges(item)}
                    ${item.parentId ? '<span class="badge badge-outline badge-sm">Subtask</span>' : ""}
                    ${
                      teamItems.some(({ parentId }) => parentId === item.id)
                        ? `<span class="badge badge-outline badge-sm">${
                            teamItems.filter(({ parentId }) => parentId === item.id).length
                          } tasks</span>`
                        : ""
                    }
                    ${item.status === "blocked" ? '<span class="badge badge-error badge-sm">Blocked</span>' : ""}
                    ${item.logicalFiles.length ? `<span class="badge badge-outline badge-sm">${item.logicalFiles.length} file${item.logicalFiles.length === 1 ? "" : "s"}</span>` : ""}
                  </div>
                  <div class="card-actions items-center justify-end">
                    <button class="btn btn-ghost btn-xs" data-action="open-item" data-id="${item.id}">Open</button>
                    <button class="btn btn-ghost btn-xs" data-action="edit-item" data-id="${item.id}">Edit</button>
                    ${
                      stageIndex > 0
                        ? `<button class="btn btn-square btn-ghost btn-xs" aria-label="Move left" data-action="move-item" data-id="${item.id}" data-stage="${stages[stageIndex - 1]!.id}">←</button>`
                        : ""
                    }
                    ${
                      stageIndex < stages.length - 1
                        ? `<button class="btn btn-square btn-ghost btn-xs" aria-label="Move right" data-action="move-item" data-id="${item.id}" data-stage="${stages[stageIndex + 1]!.id}">→</button>`
                        : ""
                    }
                  </div>
                </div>
              </article>`
            )
            .join("")}
            <button class="btn btn-ghost btn-sm border border-dashed border-base-300" data-action="new-item-in-stage" data-stage="${
              stage.id
            }">+ Add item</button>
          </div>
        </section>`;
      })
      .join("")}</div>
    ${
      filtered.length
        ? `<details class="collapse-arrow mt-5 rounded-box border border-base-300 bg-base-100">
            <summary class="cursor-pointer px-4 py-3 text-sm font-semibold">Filtered items (${filtered.length})</summary>
            <ul class="divide-y divide-base-300 border-t border-base-300">${filtered
              .map(
                (item) => `<li class="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span class="min-w-0">
                    <span class="font-semibold">${escapeHtml(item.title)}</span>
                    <span class="ml-2 badge badge-ghost badge-sm">${escapeHtml(item.status)}</span>
                    <span class="ml-2 text-xs text-base-content/55">${escapeHtml(
                      new Date(item.updatedAt).toLocaleString()
                    )}</span>
                  </span>
                  <button class="btn btn-ghost btn-xs" data-action="open-item" data-id="${item.id}">Open</button>
                </li>`
              )
              .join("")}</ul>
          </details>`
        : ""
    }`);
}

function renderProcesses(): void {
  setHeader("Processes");
  if (processesPage === "library") {
    renderProcessLibrary();
    return;
  }
  swap(`<section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 p-5">
      <div><h2 class="font-bold">Multi-step processes</h2><p class="mt-1 text-sm text-base-content/55">Define the workflow each team follows.</p></div>
      <div class="flex gap-1">
        ${actionIconButton("browse-process-library", "Browse process library", ACTION_ICONS.library, undefined, "btn-outline", "tooltip-bottom")}
        ${actionIconButton("new-process", "Create process", ACTION_ICONS.add, undefined, "btn-primary", "tooltip-bottom")}
      </div>
    </header>
    ${
      processes.length
        ? `<div class="overflow-x-auto"><table class="table min-w-[48rem]">
            <thead><tr><th>Process</th><th>Statuses</th><th class="text-right">Actions</th></tr></thead>
            <tbody>${[...processes]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
            .map(
              (process) => `<tr>
                <td class="min-w-80">
                  <h3 class="font-bold">${escapeHtml(process.name)}</h3>
                  <p class="mt-1 text-sm text-base-content/55">${escapeHtml(process.description || "No description")}</p>
                </td>
                <td class="min-w-64"><div class="flex flex-wrap items-center gap-1.5">${process.stages
                    .map(
                      ({ name }, index) =>
                        `${index ? '<span class="text-base-content/30">→</span>' : ""}<span class="badge badge-ghost badge-sm">${escapeHtml(name)}</span>`
                    )
                    .join("")}</div></td>
                <td><div class="flex justify-end gap-1">
                  ${processStatusButton(process.id)}
                  ${actionIconButton("edit-process", `Edit ${process.name}`, ACTION_ICONS.edit, process.id)}
                  ${actionIconButton("archive-process", `Archive ${process.name}`, ACTION_ICONS.archive, process.id, "btn-ghost text-error")}
                </div></td>
              </tr>`
            )
            .join("")}</tbody></table></div>`
        : `<div class="p-12 text-center text-sm text-base-content/50">No processes yet.</div>`
    }
  </section>`);
}

function libraryAgentEligibility(definition: ProcessLibraryEntry["agents"][number]) {
  return effectiveAgentEligibility(
    {
      name: definition.name,
      config: {
        prompt: definition.prompt,
        provider: definition.provider,
        model: definition.model
      }
    },
    assistantModel,
    true,
    machineModelAvailability
  );
}

function renderProcessLibrary(): void {
  swap(`<section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 p-5">
      <div>
        <button class="link link-primary mb-2 text-sm" data-action="close-process-library">← Team processes</button>
        <h2 class="font-bold">Process library</h2>
        <p class="mt-1 text-sm text-base-content/55">Curated processes bundled with Bees Desktop and available offline.</p>
      </div>
      <button class="btn btn-primary btn-sm" data-action="new-process">Create process</button>
    </header>
    <div class="grid gap-4 p-5 lg:grid-cols-2">${PROCESS_LIBRARY.map((entry) => {
      const installed = processes.some(({ name }) => name.toLowerCase() === entry.name.toLowerCase());
      const unavailable = entry.agents.filter((agent) => !libraryAgentEligibility(agent).active).length;
      const models = [...new Set(entry.agents.map(({ provider, model }) => `${provider}/${model}`))];
      return `<article class="card border border-base-300 bg-base-100">
        <div class="card-body gap-4 p-5">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div><h3 class="card-title text-base">${escapeHtml(entry.name)}</h3>
              <p class="mt-1 text-sm text-base-content/60">${escapeHtml(entry.description)}</p></div>
            <span class="badge badge-outline badge-sm">Bundled</span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <span class="badge badge-ghost badge-sm">${entry.stages.length} statuses</span>
            <span class="badge badge-ghost badge-sm">${entry.agents.length} agents</span>
            ${models.map((model) => `<span class="badge badge-ghost badge-sm">${escapeHtml(model)}</span>`).join("")}
          </div>
          ${
            unavailable
              ? `<p class="text-xs text-warning">${unavailable} configured agent model${unavailable === 1 ? " is" : "s are"} unavailable on this computer. You can change them after adding.</p>`
              : `<p class="text-xs text-success">All configured agent models are available on this computer.</p>`
          }
          <div class="card-actions justify-end">
            <button class="btn btn-primary btn-sm" data-action="add-library-process" data-template="${escapeHtml(
              entry.id
            )}" ${installed ? "disabled" : ""}>${installed ? "Added to team" : "Add to team"}</button>
          </div>
        </div>
      </article>`;
    }).join("")}</div>
  </section>`);
}

async function installLibraryProcess(template: ProcessLibraryEntry): Promise<Process> {
  const allProcesses = await repository.listProcesses(workspace.teamId, true);
  let process = allProcesses.find(({ name }) => name.toLowerCase() === template.name.toLowerCase());
  if (process && !process.archivedAt) throw new Error(`${template.name} is already in this team`);
  if (process?.archivedAt) {
    await repository.restoreProcess(process.id);
  } else {
    const id = await repository.createProcess(workspace.teamId, {
      name: template.name,
      description: template.description,
      stages: [...template.stages]
    });
    process = (await repository.listProcesses(workspace.teamId)).find((entry) => entry.id === id);
  }
  if (!process) {
    process = (await repository.listProcesses(workspace.teamId)).find(
      ({ name }) => name.toLowerCase() === template.name.toLowerCase()
    );
  }
  if (!process) throw new Error(`Could not add ${template.name}`);

  const teamRoot = await requireTeamRoot();
  await workspaces.ensureDirectory(teamRoot);
  const existingAgents = await agentFiles.list(teamRoot).catch(() => []);
  const skills = registryCapabilities(registries).filter(({ kind }) => kind === "skill");
  for (const definition of template.agents) {
    const stage = process.stages.find(({ name }) => name === definition.stage);
    if (!stage) throw new Error(`${template.name} is missing the ${definition.stage} status`);
    if (existingAgents.some(({ triggerStageId }) => triggerStageId === stage.id)) continue;
    await agentFiles.save(
      teamRoot,
      newAgent({
        name: definition.name,
        purpose: definition.purpose,
        triggerStageId: stage.id,
        config: {
          role: definition.role,
          prompt: definition.prompt,
          provider: definition.provider,
          model: definition.model,
          thinkingLevel: "medium",
          toolRefs: [],
          grants: [],
          skillRefs: skills
            .filter(({ name }) => definition.skills?.includes(name))
            .map(({ ref }) => ref)
        }
      })
    );
  }

  const hasBoard = (await repository.listBoards(workspace.teamId, true)).some(
    ({ processId }) => processId === process.id
  );
  if (!hasBoard) {
    await repository.createBoard(workspace.teamId, {
      name: template.boardName,
      processId: process.id,
      stageIds: process.stages.map(({ id }) => id)
    });
  }
  return process;
}

async function addLibraryProcess(templateId: string): Promise<void> {
  const template = processLibraryEntry(templateId);
  if (!template) throw new Error("That bundled process is unavailable");
  const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
  if (!mapping?.localPath || mapping.missing) {
    const data = await edit(
      `${template.name} system check`,
      [
        {
          name: "folder",
          label: "",
          type: "note",
          value: "✕ This team needs an available folder before its agents can be added."
        }
      ],
      "Close",
      "Open team folder settings"
    );
    if (data?.get("__action") === "footer") {
      teamTab = "folder";
      view = "settings";
      render();
    }
    return;
  }

  await refreshAssistantCatalog();
  const checks = template.agents.map((agent) => ({
    agent,
    eligibility: libraryAgentEligibility(agent)
  }));
  const data = await edit(
    `${template.name} system check`,
    [
      {
        name: "folder",
        label: "",
        type: "note",
        value: `✓ Team folder: ${mapping.localPath}`
      },
      {
        name: "contents",
        label: "",
        type: "note",
        value: `✓ ${template.stages.length} statuses, one dashboard, and ${template.agents.length} agents with instructions will be added.`
      },
      ...checks.map(({ agent, eligibility }, index) => ({
        name: `agent-${index}`,
        label: "",
        type: "note" as const,
        value: eligibility.active
          ? `✓ ${agent.name}: ${agent.provider}/${agent.model} is available.`
          : `✕ ${agent.name}: ${eligibility.reason}. Add the process, then change this model under Agents.`
      }))
    ],
    "Add to team"
  );
  if (!data) return;

  const process = await installLibraryProcess(template);
  if (template.id === "goals") {
    await repository.setSetting(`goals_workflow_seeded_${workspace.teamId}`, true);
  }
  activeProcess = process;
  workspace.processId = process.id;
  processesPage = "team";
  await refresh();
  const unavailable = checks.filter(({ eligibility }) => !eligibility.active).length;
  showNotice(
    unavailable
      ? `${template.name} added. Update ${unavailable} unavailable agent model${unavailable === 1 ? "" : "s"} under Agents.`
      : `${template.name} added to this team`,
    unavailable ? "info" : "success"
  );
}

async function requireTeamRoot(): Promise<string> {
  const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
  if (!mapping?.localPath) throw new Error("Set a team folder first — agents are files inside it");
  return mapping.localPath;
}

/**
 * Agents come off disk, not the database. One unreadable folder must not blank the
 * whole app, so a failed read leaves the library empty rather than throwing at boot.
 */
async function loadAgents(): Promise<Agent[]> {
  const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
  if (!mapping?.localPath) return [];
  return agentFiles.list(mapping.localPath).catch(() => []);
}

/** Agent edits are data only; the stable Flue runtime reads the frozen config at admission. */
async function writeAgent(agent: Agent): Promise<void> {
  await agentFiles.save(await requireTeamRoot(), agent);
}

function eligibilityForAgent(agent: Agent) {
  return effectiveAgentEligibility(
    agent,
    assistantModel,
    !disabledAgentIds.has(agent.id),
    machineModelAvailability
  );
}

const ACTION_ICONS = {
  add: '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>',
  active: '<svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>',
  inactive: '<svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z"></path><path d="M12 9v5M12 17.5v.5"></path></svg>',
  broken: '<svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg>',
  edit: '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m14 5 5 5M4 20l3.5-.7L19 7.8a2.1 2.1 0 0 0-3-3L4.7 16.5 4 20Z"></path></svg>',
  duplicate: '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>',
  delete: '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path></svg>',
  archive: '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16v13H4V7ZM3 4h18v3H3V4ZM9 11h6"></path></svg>',
  library: '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16ZM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z"></path></svg>'
} as const;

function actionIconButton(
  action: string,
  label: string,
  icon: string,
  id?: string,
  classes = "btn-ghost",
  tooltip = "tooltip-left"
): string {
  const escapedLabel = escapeHtml(label);
  return `<button class="btn btn-square btn-sm ${classes} tooltip ${tooltip}" data-action="${action}"${
    id ? ` data-id="${escapeHtml(id)}"` : ""
  } data-tip="${escapedLabel}" title="${escapedLabel}" aria-label="${escapedLabel}">${icon}</button>`;
}

function agentStatusButton(
  agent: Agent,
  eligibility: ReturnType<typeof eligibilityForAgent>,
  enabledOnMachine: boolean
): string {
  if (!enabledOnMachine) {
    return actionIconButton(
      "toggle-agent-machine",
      "Inactive on this machine. Click to make active.",
      ACTION_ICONS.inactive,
      agent.id,
      "btn-ghost text-warning"
    );
  }
  if (!eligibility.active) {
    return actionIconButton(
      "edit-agent",
      `Broken: ${eligibility.reason}. Click to fix.`,
      ACTION_ICONS.broken,
      agent.id,
      "btn-ghost text-error"
    );
  }
  return actionIconButton(
    "toggle-agent-machine",
    "Active on this machine. Click to make inactive.",
    ACTION_ICONS.active,
    agent.id,
    "btn-ghost text-success"
  );
}

async function setAgentEnabledOnMachine(agent: Agent, enabled: boolean): Promise<void> {
  if (enabled) disabledAgentIds.delete(agent.id);
  else disabledAgentIds.add(agent.id);
  await repository.setSetting(`disabled_agents:${workspace.teamId}`, [...disabledAgentIds]);
  await refresh();
  showNotice(`${agent.name} ${enabled ? "enabled" : "disabled"} on this machine`, "success");
}

/** Applies an edit dialog to an agent. Two agents on one status would make runs ambiguous. */
async function saveAgent(agent: Agent, data: FormData): Promise<void> {
  const triggerStageId = String(data.get("trigger") ?? "") || null;
  const provider = String(data.get("provider") ?? LOCAL_PROVIDER);
  const model = String(data.get("model") ?? "").trim();
  const skillRefs = data.getAll("skills").map(String);
  const toolRefs = data.getAll("tools").map(String);
  const mcpConnectionRefs = data.getAll("mcps").map(String);
  const modelChanged = provider !== agent.config.provider || model !== agent.config.model;
  const clash = agents.find(
    (other) => other.id !== agent.id && triggerStageId && other.triggerStageId === triggerStageId
  );
  if (clash) throw new Error(`${clash.name} already runs on ${stageName(triggerStageId)}`);
  await writeAgent({
    ...agent,
    name: String(data.get("name") ?? ""),
    purpose: String(data.get("purpose") ?? ""),
    description: String(data.get("description") ?? ""),
    triggerStageId,
    config: {
      ...agent.config,
      prompt: String(data.get("prompt") ?? ""),
      provider,
      model,
      thinkingLevel: String(data.get("thinkingLevel") ?? "medium") as NonNullable<Agent["config"]["thinkingLevel"]>,
      skillRefs,
      toolRefs,
      mcpConnectionRefs,
      mcpToolRefs: Object.fromEntries(
        mcpConnections
          .filter(({ id }) => mcpConnectionRefs.includes(id))
          .map(({ id, allowedTools }) => {
            const previous = agent.config.mcpToolRefs?.[id];
            return [id, (previous ?? allowedTools).filter((name) => allowedTools.includes(name))];
          })
      ),
      delegateRefs: data.getAll("delegates").map(String),
      grants: [
        ...(toolRefs.includes(BROWSER_TOOL_REF) && data.get("browserAccess") === "write"
          ? [BROWSER_WRITE_GRANT]
          : []),
        ...toolRefs.filter((ref) => ref !== BROWSER_TOOL_REF).map((ref) => `local:${ref}`),
        ...mcpConnectionRefs.map((id) => `mcp:${id}`)
      ]
    }
  });
  if (provider && model && modelChanged) await rememberModelChoice({ provider, model });
}

/** Process and status for an id across the team. Null when it no longer exists. */
function triggerContext(stageId: string | null): { process: Process; stageName: string } | null {
  if (!stageId) return null;
  for (const process of processes) {
    const stage = process.stages.find(({ id }) => id === stageId);
    if (stage) return { process, stageName: stage.name };
  }
  return null;
}

function stageName(stageId: string | null): string | null {
  return triggerContext(stageId)?.stageName ?? null;
}

function agentRelation(agent: Agent): string {
  const trigger = triggerContext(agent.triggerStageId);
  return `${trigger?.process.name ?? "No process"} - ${trigger?.stageName ?? "No trigger"} - ${agent.name}`;
}

async function renderAgents(): Promise<void> {
  setHeader("Agents", currentTeam()?.name);
  const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
  if (view !== "agents") return;
  swap(`<section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 p-5">
      <div><h2 class="font-bold">Agent library</h2><p class="mt-1 text-sm text-base-content/55">One file per agent in ${escapeHtml(
        mapping?.localPath ? `${mapping.localPath}/agents` : "the team folder"
      )}.</p></div>
      ${actionIconButton("new-agent", "New agent", ACTION_ICONS.add, undefined, "btn-primary", "tooltip-bottom")}
    </header>
    ${
      agents.length
        ? `<div class="overflow-x-auto"><table class="table min-w-[48rem]">
            <thead><tr><th>Agent</th><th>Skills</th><th class="text-right">Actions</th></tr></thead>
            <tbody>${[...agents]
            .sort((a, b) => agentRelation(a).localeCompare(agentRelation(b), undefined, { sensitivity: "base" }))
            .map((agent) => {
              const eligibility = eligibilityForAgent(agent);
              const enabledOnMachine = !disabledAgentIds.has(agent.id);
              const skills = selectedAgentCapabilities(registries, agent.config).filter(
                ({ kind }) => kind === "skill"
              );
              return `<tr>
                <td class="min-w-96">
                  <button class="link link-hover text-left font-bold" data-action="open-agent" data-id="${escapeHtml(
                    agent.id
                  )}">${escapeHtml(agentRelation(agent))}</button>
                  <p class="mt-1 text-sm text-base-content/55">${escapeHtml(agent.purpose)} · ${escapeHtml(
                      modelRef(resolveModelChoice(agent.config, assistantModel))
                    )}</p>
                </td>
                <td class="min-w-48"><div class="flex flex-wrap gap-1">${
                  skills.length
                    ? skills
                        .map(({ name }) => `<span class="badge badge-ghost badge-sm">${escapeHtml(name)}</span>`)
                        .join("")
                    : '<span class="text-sm text-base-content/40">—</span>'
                }</div></td>
                <td><div class="flex justify-end gap-1">
                  ${agentStatusButton(agent, eligibility, enabledOnMachine)}
                  ${actionIconButton("edit-agent", `Edit ${agent.name}`, ACTION_ICONS.edit, agent.id)}
                  ${actionIconButton("duplicate-agent", `Duplicate ${agent.name}`, ACTION_ICONS.duplicate, agent.id)}
                  ${actionIconButton("delete-agent", `Delete ${agent.name}`, ACTION_ICONS.delete, agent.id, "btn-ghost text-error")}
                </div></td>
              </tr>`;
            })
            .join("")}</tbody>
          </table></div>`
        : `<div class="p-12 text-center text-sm text-base-content/50">${
            mapping?.localPath
              ? "Create an agent, then give it the process status that should start it."
              : "Set a team folder first — agents are files inside it."
          }</div>`
    }
  </section>`);
}

/** Why a local org can't do this, plus the way out. `upgrade` adds the button to create a connected org. */
function localOrgNotice(message: string, upgrade = false): string {
  return `<div class="rounded-box border border-dashed border-base-300 bg-base-100 p-8 text-center text-sm text-base-content/55">${escapeHtml(
    message
  )}${upgradeButton(upgrade, "mt-4")}</div>`;
}

/** Button that starts the connected-org purchase flow. Empty unless `show`. */
function upgradeButton(show: boolean, extraClass = ""): string {
  return show
    ? `<div class="${extraClass}"><button class="btn btn-primary btn-sm" data-action="create-connected-org">Create a connected org</button></div>`
    : "";
}

const LOCAL_ORG_UPGRADE_HINT =
  "You're using a local organization. Use a connected organization to invite teammates and synchronize across devices.";
const CONNECTED_ORG_BETA_COPY =
  "Connected organizations are free during beta. We may introduce paid organization plans later, with advance notice. You'll never be charged automatically.";

// ---- Team settings (tabbed: Members / Folder / Integrations) ----

async function teamMembersContent(): Promise<string> {
  const token = orgToken();
  if (!token)
    return localOrgNotice(
      orgIsConnected() ? "Sign in to manage team members." : LOCAL_ORG_UPGRADE_HINT,
      !orgIsConnected()
    );
  if (!activeOrgTeamEnabled()) return localOrgNotice("Team features are off for this organization.");
  const orgId = workspace.organizationId;
  const [{ teams: serverTeams }, { plan }] = await Promise.all([
    api.listTeams(token, orgId),
    api.plan(token)
  ]);
  const trialEndsAt = activeServerOrg()?.trialEndsAt;
  const trialEnds = trialEndsAt ? new Date(trialEndsAt) : null;
  const memberLists = await Promise.all(
    serverTeams.map((team) => api.listTeamMembers(token, orgId, team.id).then(({ members }) => members))
  );
  const isAdmin = (members: { userId: string; role: string }[]): boolean =>
    members.some((member) => member.userId === currentUser()?.id && member.role === "admin");
  const planSummary = plan.freeDuringBeta
    ? `<div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-base-content/55">
        <span class="badge badge-primary badge-sm">Free during beta</span>
        <span>${escapeHtml(CONNECTED_ORG_BETA_COPY)}</span>
      </div>`
    : `<p class="mt-1 text-sm text-base-content/55">${serverTeams.length} of ${plan.freeTeams} free teams used — $${(
        plan.priceCents / 100
      ).toFixed(2)}/${plan.interval} per team after that.${
        trialEnds && trialEnds > new Date()
          ? ` Trial runs to ${trialEnds.toLocaleDateString()}.`
          : ""
      }</p>`;
  return `<section class="space-y-4">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div><h2 class="font-bold">Teams</h2><p class="mt-1 text-sm text-base-content/55">Restricted membership — admins add teammates.</p>
        ${planSummary}
      </div>
      <div class="flex gap-2">
        ${
          plan.freeDuringBeta
            ? ""
            : `<button class="btn btn-ghost btn-sm" data-action="start-team-trial">${
                trialEnds && trialEnds > new Date() ? "Extend trial 30 days" : "Start 30-day trial"
              }</button>`
        }
        <button class="btn btn-primary btn-sm" data-action="new-server-team">New team</button>
      </div>
    </header>
    ${
      serverTeams.length
        ? serverTeams
            .map((team, index) => {
              const members = memberLists[index]!;
              const admin = isAdmin(members);
              return `<article class="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
                <div class="flex items-center justify-between gap-3">
                  <h3 class="font-bold">${escapeHtml(team.name)}</h3>
                  ${
                    admin
                      ? `<button class="btn btn-primary btn-xs" data-action="invite-team-member" data-team="${team.id}">Invite</button>`
                      : `<span class="badge badge-ghost badge-sm">Member</span>`
                  }
                </div>
                <ul class="mt-3 divide-y divide-base-200">
                  ${members
                    .map(
                      (member) => `<li class="flex items-center justify-between gap-2 py-2 text-sm">
                        <span class="truncate">${escapeHtml(
                          member.userId === currentUser()?.id ? `${currentUser()?.email} (you)` : member.userId
                        )}</span>
                        <span class="flex items-center gap-2">
                          <span class="badge badge-sm ${
                            member.role === "admin" ? "badge-primary" : "badge-ghost"
                          }">${member.role}</span>
                          ${
                            admin && member.role === "member"
                              ? `<button class="btn btn-ghost btn-xs" data-action="promote-team-member" data-team="${team.id}" data-user="${escapeHtml(
                                  member.userId
                                )}">Make admin</button>`
                              : ""
                          }
                        </span>
                      </li>`
                    )
                    .join("")}
                </ul>
              </article>`;
            })
            .join("")
        : `<div class="p-12 text-center text-sm text-base-content/50">No teams yet. Create one — you'll be its admin.</div>`
    }
  </section>`;
}

async function checkedFileLocations(locations: FileLocation[]): Promise<FileLocation[]> {
  return Promise.all(
    locations.map(async (location) => {
      if (!location.localPath) return location;
      const missing = await workspaces.validateDirectory(location.localPath).then(
        () => false,
        () => true
      );
      if (missing !== location.missing) {
        await repository.markFileLocationMissing(location.id, missing);
      }
      return { ...location, missing };
    })
  );
}

function fileLocationRows(
  locations: FileLocation[],
  removable: (location: FileLocation) => boolean
): string {
  if (!locations.length) {
    return '<p class="rounded-box bg-base-200 p-4 text-sm text-base-content/50">No linked locations yet.</p>';
  }
  return locations
    .map(
      (location) => `<div class="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-4">
      <div class="min-w-0">
        <div class="flex items-center gap-2"><span class="font-semibold">${escapeHtml(location.name)}</span>
          <span class="badge badge-ghost badge-sm">${location.teamId ? "Team" : "Organization"}</span></div>
        <code class="mt-1 block break-all text-xs text-base-content/60">${escapeHtml(
          location.localPath || "Not mapped on this machine"
        )}</code>
        ${location.missing ? '<p class="mt-1 text-xs font-semibold text-error">Folder is missing or unavailable.</p>' : ""}
      </div>
      <div class="flex gap-2">
        <button class="btn btn-ghost btn-xs" data-action="map-file-location" data-id="${location.id}">${location.localPath ? "Re-map" : "Map folder"}</button>
        ${removable(location) ? `<button class="btn btn-ghost btn-xs text-error" data-action="remove-file-location" data-id="${location.id}" data-name="${escapeHtml(location.name)}">Remove</button>` : ""}
      </div>
    </div>`
    )
    .join("");
}

async function teamFolderContent(): Promise<string> {
  let mapping = await repository.getResolvedTeamFolder(workspace.teamId);
  if (mapping) {
    try {
      await workspaces.validateDirectory(mapping.localPath);
      if (mapping.override && mapping.missing) await repository.markTeamFolderMissing(workspace.teamId, false);
      mapping = { ...mapping, missing: false };
    } catch {
      if (mapping.override && !mapping.missing) await repository.markTeamFolderMissing(workspace.teamId, true);
      mapping = { ...mapping, missing: true };
    }
  }
  const globalPath = await repository.getSetting("global_local_path", "");
  const locations = await checkedFileLocations(
    await repository.listAvailableFileLocations(workspace.teamId)
  );
  return `<section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body">
        <div class="flex items-start justify-between gap-3">
          <div><h2 class="card-title text-base">Primary team workspace</h2>
          <p class="mt-1 text-sm text-base-content/55">The default home for team files and all approved agent outputs.</p></div>
          <span class="badge ${mapping?.override ? "badge-primary" : "badge-ghost"}">${mapping?.override ? "Override" : "Inherited"}</span>
        </div>
        <div class="mt-3 rounded-box bg-base-200 p-4">
          <code class="break-all text-sm">${escapeHtml(mapping?.localPath || (globalPath ? "Team folder not found" : "Set a folder first"))}</code>
          ${mapping?.missing ? '<p class="mt-2 text-xs font-semibold text-error">Folder is missing or unavailable.</p>' : ""}
        </div>
        <div class="card-actions mt-3 justify-end">
          ${mapping?.override ? '<button class="btn btn-ghost btn-sm" data-action="use-default-folder">Use default</button>' : ""}
          <button class="btn btn-primary btn-sm" data-action="pick-folder">Choose override</button>
        </div>
      </div>
    </section>
    <section class="card mt-4 border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h2 class="card-title text-base">Linked file locations</h2>
          <p class="mt-1 text-sm text-base-content/55">Organization locations are inherited. Team locations can point anywhere on this machine, including different Google Drive folders.</p></div>
        <button class="btn btn-primary btn-sm" data-action="add-team-location">Add team location</button>
      </div>
      <div class="grid gap-2">${fileLocationRows(locations, (location) => location.teamId === workspace.teamId)}</div>
      <p class="text-xs text-base-content/50">Only the location name, scope, ID, and relative file reference sync. Absolute folder paths stay on this machine.</p>
    </div></section>`;
}

/**
 * Skill curation. The list is the pure half — no model runs to produce it, only which skills
 * agents select and which ones runs have reached for. "Tidy skills" is the other half, and like
 * every other proposal in Bees it lands as a preview the user applies.
 */
function skillCurationContent(): string {
  const unused = skillReviews.filter(({ state }) => state === "unused");
  const proposal = curatorPlan
    ? `<div class="mt-3 rounded-box border border-warning/40 bg-warning/5 p-3">
        ${curatorPlan.summary ? `<p class="text-sm">${escapeHtml(curatorPlan.summary)}</p>` : ""}
        <div class="mt-2 grid gap-2">${curatorPlan.actions
          .map(
            (entry) => `<div class="rounded bg-base-100 p-2 text-sm">
              <div class="${entry.error ? "text-error" : "font-semibold"}">${escapeHtml(entry.summary)}</div>
              ${entry.error ? `<div class="text-xs text-error">${escapeHtml(entry.error)}</div>` : ""}
            </div>`
          )
          .join("")}</div>
        <div class="mt-3 flex gap-2">
          <button class="btn btn-success btn-sm" data-action="apply-curator-plan" ${
            curatorPlan.actions.some(({ error }) => !error) ? "" : "disabled"
          }>Apply</button>
          <button class="btn btn-ghost btn-sm" data-action="discard-curator-plan">Discard</button>
        </div>
      </div>`
    : "";
  return `<div class="py-4">
    <div class="flex items-center justify-between gap-4">
      <div><h3 class="text-sm font-bold">Skill curation</h3><p class="text-xs text-base-content/55">Bees scores no run, so a skill is judged only by whether anything reaches for it. Retiring one moves its folder to <code>skills/.archive</code>; nothing is deleted and nothing is written until you apply it.</p></div>
      <button class="btn btn-ghost btn-sm border border-base-300" data-action="curate-skills" ${
        curatorBusy ? "disabled" : ""
      }>${curatorBusy ? "Reading…" : "Tidy skills"}</button>
    </div>
    <div class="mt-3 grid gap-2">${
      skillReviews.length
        ? skillReviews
            .map(
              (review) => `<div class="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-3">
              <div><div class="font-semibold">${escapeHtml(review.capability.name)}</div>
                <div class="text-xs text-base-content/50">${
                  review.useCount ? `used ${review.useCount} time(s)` : "never used"
                } · ${review.selected ? "selected by an agent" : "selected by no agent"}</div></div>
              ${
                review.state === "unused"
                  ? `<button class="btn btn-ghost btn-xs text-error" data-action="archive-skill" data-slug="${escapeHtml(
                      skillSlugOf(review.capability)
                    )}" data-name="${escapeHtml(review.capability.name)}">Retire</button>`
                  : `<span class="badge badge-ghost badge-sm">in use</span>`
              }
            </div>`
            )
            .join("")
        : `<p class="text-xs text-base-content/45">No skills yet.</p>`
    }</div>
    ${unused.length ? `<p class="mt-2 text-xs text-base-content/45">${unused.length} skill(s) nothing has reached for in ${UNUSED_AFTER_DAYS} days.</p>` : ""}
    ${proposal}
  </div>`;
}

function teamIntegrationsContent(): string {
  return `<section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body">
        <h2 class="card-title text-base">Local integrations</h2>
        <div class="mt-2 divide-y divide-base-300">
          <div class="py-4">
            <div class="flex items-center justify-between gap-4">
              <div><h3 class="text-sm font-bold">Skills and tools</h3><p class="text-xs text-base-content/55">Trusted folders copied to Bees app-data and inventoried by filename. JavaScript and TypeScript tools run as trusted local code outside the file sandbox. Remote MCP services are added under Preferences → Connections.</p></div>
              <div class="flex gap-2">
                <button class="btn btn-primary btn-sm" data-action="new-skill">New skill</button>
                <button class="btn btn-ghost btn-sm border border-base-300" data-action="add-registry">Add folder</button>
              </div>
            </div>
            <div class="mt-3 grid gap-2">${
              registries.length
                ? registries
                    .map(
                      (registry) => `<div class="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-3">
                        <div><div class="font-semibold">${escapeHtml(registry.name)}</div>
                          <div class="text-xs text-base-content/50">${registry.files.length} copied file(s) · ${registryCapabilities([
                            registry
                          ]).length} capability item(s)</div></div>
                        <div class="flex gap-2"><button class="btn btn-ghost btn-xs" data-action="refresh-registry" data-id="${
                          registry.id
                        }">Refresh</button><button class="btn btn-ghost btn-xs text-error" data-action="remove-registry" data-id="${
                          registry.id
                        }">Remove</button></div>
                      </div>`
                    )
                    .join("")
                : `<p class="text-xs text-base-content/45">No skills or tools folders added.</p>`
            }</div>
          </div>
          ${skillCurationContent()}
        </div>
      </div>
    </section>`;
}

function teamBrowserContent(): string {
  return `<section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body">
        <div class="flex items-start justify-between gap-4">
          <div><h2 class="card-title text-base">Browser</h2>
          <p class="mt-1 text-sm text-base-content/55">Each team has its own isolated browser and browser profile. Open this team's Chrome instance to sign in to websites once. Agents can reuse your logged-in session, while your passwords and cookies remain on your computer. Bees never has access to your passwords or cookies.</p></div>
          <button class="btn btn-primary btn-sm" data-action="connect-site">Open Browser</button>
        </div>
      </div>
    </section>`;
}

async function teamArchivedContent(): Promise<string> {
  const archived = (await repository.listProcesses(workspace.teamId, true)).filter(
    ({ archivedAt }) => archivedAt
  );
  return `<section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body">
      <h2 class="card-title text-base">Archived processes</h2>
      <p class="mt-1 text-sm text-base-content/55">Restoring brings back the process, its statuses, and its dashboards.</p>
      <div class="mt-3 grid gap-2">${
        archived.length
          ? archived
              .map(
                (process) => `<div class="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-3">
                  <div><div class="font-semibold">${escapeHtml(process.name)}</div>
                    <div class="text-xs text-base-content/50">Archived ${escapeHtml(
                      new Date(process.archivedAt!).toLocaleDateString()
                    )} · ${process.stages.length} status(es)</div></div>
                  <button class="btn btn-primary btn-xs" data-action="restore-process" data-id="${process.id}">Restore</button>
                </div>`
              )
              .join("")
          : `<p class="text-xs text-base-content/45">No archived processes.</p>`
      }</div>
    </div></section>`;
}

function teamDangerContent(): string {
  return `<section class="card border border-error/40 bg-base-100 shadow-sm"><div class="card-body gap-3">
      <h2 class="card-title text-base text-error">Danger zone</h2>
      <p class="text-sm text-base-content/60">Deletes this team and all its processes, dashboards, and work items on this machine. Cannot be undone.</p>
      <div class="card-actions justify-end"><button class="btn btn-error btn-sm" data-action="delete-team">Delete team</button></div>
    </div></section>`;
}

async function renderTeamSettings(): Promise<void> {
  setHeader("Team settings", currentTeam()?.name);
  await renderTabs<TeamTab>(
    "team-tab",
    [
      { id: "members", label: "Members", content: teamMembersContent },
      { id: "folder", label: "Folder", content: teamFolderContent },
      { id: "integrations", label: "Integrations", content: teamIntegrationsContent },
      { id: "browser", label: "Browser", content: teamBrowserContent },
      { id: "archived", label: "Archived processes", content: teamArchivedContent },
      { id: "danger", label: "Danger zone", content: teamDangerContent }
    ],
    teamTab,
    () => view === "settings"
  );
}

// ---- Organization settings (tabbed: General / Members / Invites / Folder) ----

function orgGeneralContent(): string {
  const connected = orgIsConnected();
  const user = currentUser();
  const signedIn = orgSignedIn() && !!user;
  const social = Object.entries(providerLabel)
    .map(
      ([provider, label]) =>
        `<button class="btn btn-outline btn-sm" data-action="social-signin" data-provider="${provider}">Continue with ${label}</button>`
    )
    .join("");
  const authBlock = !connected
    ? ""
    : signedIn
      ? `<div class="flex flex-wrap items-center justify-between gap-3">
           <span class="text-sm">Signed in as <strong>${escapeHtml(user!.email)}</strong></span>
           <button class="btn btn-ghost btn-sm text-error" data-action="sign-out">Sign out</button>
         </div>`
      : `<div class="flex flex-wrap items-center gap-2">
           <span class="w-full text-sm text-base-content/60">Signed out of this organization.</span>
           ${social}
           <button class="btn btn-outline btn-sm" data-action="signin-email">Email sign in</button>
           <button class="btn btn-outline btn-sm" data-action="signup-email">Create account</button>
         </div>`;
  return `<div class="space-y-5">
    <section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
      <div class="flex items-center justify-between gap-3">
        <h2 class="card-title text-base">${connected ? "Connected organization" : "Local organization"}</h2>
        <div class="flex flex-wrap gap-2">
          <span class="badge ${connected ? "badge-success" : "badge-ghost"}">${connected ? "Connected" : "Local"}</span>
          ${connected ? '<span class="badge badge-primary">Free during beta</span>' : ""}
        </div>
      </div>
      <p class="text-sm text-base-content/60">${
        connected
          ? `Server-backed. Users and agents on different machines can coordinate on the same work items here. ${escapeHtml(
              CONNECTED_ORG_BETA_COPY
            )}`
          : "Bees Desktop is free. Work stays on this machine unless you use a connected organization."
      }</p>
      ${authBlock}${upgradeButton(!connected)}
    </div></section>
    <section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
      <h2 class="card-title text-base">Organization name</h2>
      <div class="flex items-center gap-2">
        <code class="flex-1 break-all rounded-box bg-base-200 p-3 text-sm">${escapeHtml(
          currentOrganization()?.name ?? ""
        )}</code>
        <button class="btn btn-outline btn-sm" data-action="rename-org">Rename</button>
      </div>
    </div></section>
    <section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
      <div class="flex items-center gap-3">
        ${orgLogoPreview(workspace.organizationId, currentOrganization()?.name ?? "")}
        <div class="flex-1"><h2 class="card-title text-base">Branding</h2>
          <p class="text-sm text-base-content/55">Logo and color shown in the organization switcher.</p></div>
        ${
          brandingFor(workspace.organizationId).logo
            ? `<button class="btn btn-ghost btn-sm" data-action="remove-logo">Remove logo</button>`
            : ""
        }
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="form-control grid gap-1.5"><span class="label-text text-sm font-semibold">Color</span>
          <input class="h-10 w-full cursor-pointer rounded-lg border border-base-300 bg-base-100" type="color"
            data-branding="color" value="${escapeHtml(brandingFor(workspace.organizationId).color || "#4f46e5")}"></label>
        <label class="form-control grid gap-1.5"><span class="label-text text-sm font-semibold">Logo</span>
          <input class="file-input file-input-bordered w-full" type="file" accept="image/*" data-branding="logo"></label>
      </div>
    </div></section>
    <section class="card border border-error/40 bg-base-100 shadow-sm"><div class="card-body gap-3">
      <h2 class="card-title text-base text-error">Danger zone</h2>
      <p class="text-sm text-base-content/60">Deletes this organization and all its teams, boards, and agents. Cannot be undone.${
        connected ? " Admins only." : ""
      }</p>
      <div class="card-actions justify-end"><button class="btn btn-error btn-sm" data-action="delete-org">Delete organization</button></div>
    </div></section>
  </div>`;
}

async function orgMembersContent(): Promise<string> {
  const token = orgToken();
  if (!orgIsConnected()) return localOrgNotice(LOCAL_ORG_UPGRADE_HINT, true);
  if (!token) return localOrgNotice("Sign in to manage organization members.");
  let memberships;
  try {
    ({ memberships } = await api.listMemberships(token, workspace.organizationId));
  } catch {
    return `<div class="p-8 text-center text-sm text-base-content/50">Only organization admins can view members.</div>`;
  }
  return `<section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
      <header class="border-b border-base-300 p-5"><h2 class="font-bold">Members</h2></header>
      <ul class="divide-y divide-base-200 p-2">${memberships
        .map(
          (member) => `<li class="flex items-center gap-2 px-3 py-2 text-sm">
            <span class="flex-1 truncate">${escapeHtml(
              member.userId === currentUser()?.id
                ? `${member.email ?? currentUser()?.email} (you)`
                : member.email ?? member.userId
            )}</span>
            <span class="badge badge-sm ${member.role === "member" ? "badge-ghost" : "badge-primary"}">${escapeHtml(
              member.role
            )}</span>
            <span class="w-20 text-right">${
              member.role !== "owner" && member.userId !== currentUser()?.id
                ? `<button class="btn btn-ghost btn-xs text-error" data-action="remove-org-member" data-user="${escapeHtml(
                    member.userId
                  )}" data-email="${escapeHtml(member.email ?? member.userId)}">Remove</button>`
                : ""
            }</span>
          </li>`
        )
        .join("")}</ul>
    </section>`;
}

async function orgInvitesContent(): Promise<string> {
  const connected = orgIsConnected();
  if (!connected)
    return localOrgNotice(LOCAL_ORG_UPGRADE_HINT, true);
  let pending: { email: string; role: string }[] = [];
  const token = orgToken();
  try {
    if (token) pending = (await api.listOrgInvitations(token, workspace.organizationId)).invitations; // 403 for non-admins
  } catch {
    // not an admin, or none — leave the list empty
  }
  return `<section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
      <header class="flex items-center justify-between gap-3 border-b border-base-300 p-5">
        <div><h2 class="font-bold">Invitations</h2><p class="mt-1 text-sm text-base-content/55">Pending invites to this organization.</p></div>
        <button class="btn btn-primary btn-sm" data-action="invite-org-member">Invite someone</button>
      </header>
      <ul class="divide-y divide-base-200 p-2">${
        pending.length
          ? pending
              .map(
                (invitation) => `<li class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span class="truncate">${escapeHtml(invitation.email)}</span>
              <span class="badge badge-ghost badge-sm">${escapeHtml(invitation.role)}</span>
            </li>`
              )
              .join("")
          : `<li class="px-3 py-6 text-center text-sm text-base-content/50">No pending invitations.</li>`
      }</ul>
    </section>`;
}

/** Preferences → Folder: the root all org/team folders default under. */
async function prefsFolderContent(): Promise<string> {
  const globalPath = await repository.getSetting("global_local_path", "");
  return `<section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
      <h2 class="card-title text-base">Root Folder</h2>
      <p class="text-sm text-base-content/60">Every organization gets a folder at <code>&lt;root-folder&gt;/&lt;org-name&gt;</code>, with each team folder inside it. Changing this only affects folders resolved from here on.</p>
      <div class="rounded-box bg-base-200 p-4"><code class="break-all text-sm">${escapeHtml(
        globalPath || "No path selected"
      )}</code></div>
      <div class="card-actions justify-end"><button class="btn btn-primary btn-sm" data-action="pick-global-folder">Change path</button></div>
    </div></section>`;
}

async function orgWorkspaceContent(): Promise<string> {
  const orgPath = await repository.getOrgFolder(workspace.organizationId);
  const locations = (await checkedFileLocations(
    await repository.listOrganizationFileLocations(workspace.organizationId)
  )).filter(({ teamId }) => !teamId);
  return `<section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
      <h2 class="card-title text-base">Primary organization folder</h2>
      <p class="text-sm text-base-content/60">This organization's folder. Team folders resolve to <code>&lt;org folder&gt;/&lt;team-name&gt;</code> unless a team overrides it. Change the root under Preferences → Folder.</p>
      <div class="rounded-box bg-base-200 p-4"><code class="break-all text-sm">${escapeHtml(
        orgPath || "Set a folder first"
      )}</code></div>
      <div class="card-actions justify-end"><button class="btn btn-primary btn-sm" data-action="pick-global-folder">Change default root</button></div>
    </div></section>
    <section class="card mt-4 border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h2 class="card-title text-base">Linked organization locations</h2>
          <p class="mt-1 text-sm text-base-content/55">Add as many organization-wide locations as needed. Every team can reference them.</p></div>
        <button class="btn btn-primary btn-sm" data-action="add-org-location">Add organization location</button>
      </div>
      <div class="grid gap-2">${fileLocationRows(locations, () => true)}</div>
      <p class="text-xs text-base-content/50">Each machine maps the shared location ID to its own local folder. Bees Cloud does not synchronize absolute paths or document files.</p>
    </div></section>`;
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

async function configureLocalKnowledge(): Promise<void> {
  showNotice("Starting the local knowledge worker…", "info");
  const runtime = await invoke<KnowledgeRuntimeInfo>("ensure_knowledge_worker", {
    organizationId: workspace.organizationId,
    teamId: workspace.teamId
  });
  const stored = await listMcpConnections(repository, workspace.teamId);
  const connection = managedKnowledgeConnection(
    workspace.teamId,
    runtime.url,
    stored.find(isKnowledgeConnection)
  );
  await invoke("store_connection_secret", {
    secretRef: connection.secretRef,
    secret: runtime.token
  });
  await saveMcpConnection(repository, connection);
  await probeKnowledgeConnection(connection);
  await saveKnowledgePolicy({ mode: "local" });
  knowledgeConnection = connection;
  showNotice("Local knowledge is indexing available folders", "success");
}

async function configureRemoteKnowledge(): Promise<void> {
  const current = await loadKnowledgePolicy();
  const data = await edit("Organization knowledge worker", [
    {
      name: "url",
      label: "Single HTTPS MCP URL",
      value: current?.mode === "remote" ? current.url : "",
      placeholder: "https://knowledge.example.com/mcp"
    },
    {
      name: "token",
      label: `Bearer token for ${currentTeam()?.name ?? "this team"}`,
      type: "password"
    }
  ], "Connect");
  if (!data) return;
  const policy = parseKnowledgePolicy({ mode: "remote", url: String(data.get("url") ?? "") });
  if (!policy || policy.mode !== "remote") throw new Error("A remote knowledge URL is required");
  const token = String(data.get("token") ?? "").trim();
  if (!token) throw new Error("A team-scoped bearer token is required");
  const stored = await listMcpConnections(repository, workspace.teamId);
  const connection = managedKnowledgeConnection(
    workspace.teamId,
    policy.url,
    stored.find(isKnowledgeConnection)
  );
  await invoke("store_connection_secret", { secretRef: connection.secretRef, secret: token });
  await saveMcpConnection(repository, connection);
  knowledgeConnection = connection;
  await probeKnowledgeConnection(connection);
  if (current?.mode !== "remote" || current.url !== policy.url) {
    await saveKnowledgePolicy(policy);
  }
  knowledgeError = "";
  showNotice("Remote knowledge connected for this team", "success");
}

async function disableKnowledge(): Promise<void> {
  await saveKnowledgePolicy(null);
  for (const team of teams) {
    const connection = (await listMcpConnections(repository, team.id)).find(isKnowledgeConnection);
    if (!connection) continue;
    await removeMcpConnection(repository, team.id, connection.id);
    await invoke("delete_connection_secret", { secretRef: connection.secretRef }).catch(() => undefined);
  }
  knowledgeConnection = null;
  showNotice("Organization knowledge disabled", "success");
}

async function orgKnowledgeContent(): Promise<string> {
  let policy: KnowledgePolicy | null = null;
  try {
    policy = await loadKnowledgePolicy();
  } catch (error) {
    knowledgeError = errorText(error);
  }
  const availableSources = workspace.teamId
    ? await repository.listAvailableFileLocations(workspace.teamId)
    : [];
  const sources = policy?.mode === "remote"
    ? availableSources
    : availableSources.filter(({ localPath, missing }) => Boolean(localPath) && !missing);
  const sourceRows = sources.length
    ? sources
        .map(
          (source) => `<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span>${escapeHtml(source.name)}</span>
            <span class="badge badge-sm ${source.teamId ? "badge-ghost" : "badge-primary"}">${
              source.teamId ? "This team" : "Organization"
            }</span>
          </li>`
        )
        .join("")
    : `<li class="px-3 py-5 text-sm text-base-content/50">No mapped organization or team folders are available on this machine.</li>`;
  const active = policy
    ? `<span class="badge badge-success">${policy.mode === "local" ? "Local" : "Remote"}</span>`
    : `<span class="badge badge-ghost">Off</span>`;
  const detail = !policy
    ? "Choose local indexing on each machine or one organization-controlled remote worker."
    : policy.mode === "local"
      ? `This machine indexes ${sources.length} available source${sources.length === 1 ? "" : "s"}. Each source has its own local index.`
      : `All bees use one organization-controlled endpoint: <code class="break-all">${escapeHtml(policy.url)}</code>`;
  return `<div class="space-y-5">
    <section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
      <div class="flex items-center justify-between gap-3"><h2 class="card-title text-base">Knowledge mode</h2>${active}</div>
      <p class="text-sm text-base-content/60">${detail}</p>
      ${knowledgeError ? `<p class="text-sm text-error">${escapeHtml(knowledgeError)}</p>` : ""}
      <div class="card-actions justify-end gap-2">
        <button class="btn btn-outline btn-sm" data-action="knowledge-local">Use local</button>
        <button class="btn btn-primary btn-sm" data-action="knowledge-remote">${
          policy?.mode === "remote" ? "Set this team's token" : "Use remote"
        }</button>
        ${policy ? '<button class="btn btn-ghost btn-sm text-error" data-action="knowledge-disable">Disable</button>' : ""}
      </div>
      <p class="text-xs text-base-content/50">Indexes rebuild in full once a day. A failed rebuild keeps the previous index. Bees Cloud stores only the mode and remote URL, never files, chunks, embeddings, paths, or credentials.</p>
    </div></section>
    <section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
      <header class="border-b border-base-300 p-5"><h2 class="font-bold">Sources available to ${escapeHtml(
        currentTeam()?.name ?? "this team"
      )}</h2><p class="mt-1 text-sm text-base-content/55">Organization sources plus this team's sources only. The worker enforces this again from the bearer token.</p></header>
      <ul class="divide-y divide-base-200 p-2">${sourceRows}</ul>
    </section>
  </div>`;
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

export function localModelStatusLabel(
  state: string,
  downloadedBytes: number,
  totalBytes: number,
  error?: string
): string {
  if (state === "running") return "Running";
  if (state === "downloading") {
    return totalBytes
      ? `Downloading ${Math.round((downloadedBytes / totalBytes) * 100)}%`
      : "Downloading…";
  }
  if (state === "ready") return "Loaded";
  if (state === "cancelled") return "Paused";
  if (state === "error") return error ?? "Download failed";
  return "Not loaded";
}

/** Download and Run are toggles: flipping one leaves the work running while the user moves on. */
function localModelToggle(
  id: string,
  kind: "download" | "run",
  on: boolean,
  disabled: boolean,
  downloaded = false
): string {
  const label = kind === "download" ? "Download" : "Run";
  return `<label class="flex cursor-pointer items-center gap-1.5 text-xs ${disabled ? "opacity-50" : ""}">
    <input type="checkbox" class="toggle toggle-xs toggle-primary" data-model-toggle="${kind}" data-model="${id}"
      ${downloaded ? `data-model-downloaded="1"` : ""} ${on ? "checked" : ""} ${disabled ? "disabled" : ""}>${label}
  </label>`;
}

function localModelRow(model: LocalModelView): string {
  const event = localModelProgress.get(model.id);
  const state = model.runtime.running ? "running" : (event?.state ?? model.runtime.state);
  const downloadedBytes = event?.downloadedBytes ?? model.runtime.downloadedBytes;
  const totalBytes = event?.totalBytes ?? model.runtime.totalBytes;
  const id = escapeHtml(model.id);
  // The wanted flag is persisted, so a Run toggled on during a long download stays on across a
  // page reload or an app restart.
  const starting =
    (localModelStarting.has(model.id) || localModels.wantedRunId === model.id) &&
    state !== "running";
  const status =
    starting && state !== "downloading"
      ? "Starting…"
      : localModelStatusLabel(state, downloadedBytes, totalBytes, event?.error);
  const downloaded = state === "ready" || state === "running";
  // Run implies Download: turning it on downloads first when the file isn't here yet, so both
  // toggles read as on. Flipping Download back off deletes the file and keeps the row — Delete is
  // for dropping the row too. A model picked off this computer has nothing to download at all.
  const action =
    localModelToggle(
      id,
      "download",
      downloaded || state === "downloading" || starting,
      !!model.localPath,
      downloaded
    ) + localModelToggle(id, "run", state === "running" || starting, false);
  const source = model.localPath
    ? `<span class="truncate">${escapeHtml(model.localPath)}</span>`
    : `<button class="link" data-action="open-external" data-url="${escapeHtml(
        model.sourceUrl ?? model.url ?? ""
      )}">${escapeHtml(model.sourceUrl ? "Hugging Face" : "Download link")}</button>`;
  const license = model.licenseUrl
    ? ` · <button class="link" data-action="open-external" data-url="${escapeHtml(
        model.licenseUrl
      )}">${escapeHtml(model.licenseName ?? "License")}</button>`
    : "";
  return `<tr>
    <td class="max-w-xs">
      <div class="truncate font-semibold">${escapeHtml(model.name)}</div>
      <div class="flex gap-1 truncate text-xs text-base-content/55">${source}${license}</div>
    </td>
    <td class="min-w-40">
      <div data-local-model-status="${id}">${escapeHtml(status)}</div>
      <progress class="progress progress-primary mt-1 w-full" data-local-model-progress="${id}"
        value="${downloadedBytes}" max="${totalBytes || 1}"></progress>
      <div class="text-xs text-base-content/55">${totalBytes ? escapeHtml(formatBytes(totalBytes)) : ""}</div>
    </td>
    <td class="text-right whitespace-nowrap">
      <div class="flex items-center justify-end gap-3">${action}
        <label class="flex items-center gap-1 text-xs text-base-content/55"
          title="Context window in tokens. Leave empty to size it from the model's own header and this computer's memory.">
          Context
          <input type="number" min="4096" step="1024" class="input input-xs w-24" placeholder="auto"
            data-model-context="${id}" value="${model.contextSize ?? ""}">
        </label>
        <button class="btn btn-ghost btn-xs text-error" data-action="delete-local-model" data-model="${id}">Delete</button>
      </div>
    </td>
  </tr>`;
}

async function refreshLocalModelRows(): Promise<void> {
  await refreshAssistantCatalog();
  render();
  void autopilot();
}

// Downloads run for minutes, so they are never awaited by a click handler — the progress events
// drive the row, and only the outcome comes back here. Both toggles share one download: a second
// call for the same model waits on the fetch already in flight (here, and again in Rust for the
// calls this map never saw). Resolves to false when the download failed or was cancelled.
function downloadLocalModel(modelId: string): Promise<boolean> {
  const running = localModelDownloads.get(modelId);
  if (running) return running;
  const download = localModels
    .download(modelId)
    .then(() => true)
    .catch((error) => {
      const message = errorText(error);
      if (message !== "Model download cancelled") showNotice(message, "error");
      return false;
    })
    .finally(() => localModelDownloads.delete(modelId));
  localModelDownloads.set(modelId, download);
  return download;
}

// Boot can take up to a minute, so it is not awaited either — the row shows "Starting…" until the
// runtime answers, and the user is free to leave Preferences meanwhile.
function runLocalModel(modelId: string): void {
  if (localModelStarting.has(modelId)) return;
  localModelStarting.add(modelId);
  void localModels
    .wantRun(modelId)
    .then(() => downloadLocalModel(modelId))
    .then(async (downloaded) => {
      if (!downloaded || !localModelStarting.has(modelId)) return;
      if (await localModels.run(modelId)) await flueProjectPort.restart();
    })
    .catch(async (error) => {
      if (localModels.wantedRunId === modelId) await localModels.wantRun(null);
      showNotice(errorText(error), "error");
    })
    .finally(() => {
      localModelStarting.delete(modelId);
      localModelProgress.delete(modelId);
      void refreshLocalModelRows();
    });
}

/** Download toggled off on a finished model: drop the file, keep the row so it can be fetched again. */
function removeLocalModelFile(modelId: string): void {
  localModelStarting.delete(modelId);
  void localModels
    .removeFile(modelId)
    .then(async (wasRunning) => {
      if (wasRunning) await flueProjectPort.restart();
      localModelProgress.delete(modelId);
      await refreshLocalModelRows();
    })
    .catch((error) => showNotice(errorText(error), "error"));
}

/** Stops a running model, or cancels its download when that is what the toggle turned off. */
function stopLocalModel(modelId: string): void {
  void localModels
    .stop(modelId)
    .then(async (wasRunning) => {
      if (wasRunning) await flueProjectPort.restart();
      localModelProgress.delete(modelId);
      await refreshLocalModelRows();
    })
    .catch((error) => showNotice(errorText(error), "error"));
}

async function prefsLocalModelsContent(): Promise<string> {
  const models = await localModels.list();
  return `<div class="space-y-5">
    <section>
      <h2 class="font-bold">Local models</h2>
      <p class="mt-1 text-sm text-base-content/60">Turn on Download to fetch a model, then Run to serve it. Run as many as this computer's memory can hold. Models and chats stay on this device.</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <input class="input input-bordered input-sm min-w-64 flex-1" data-local-model-source
          placeholder="https://huggingface.co/…/model.gguf" aria-label="Model link or file path">
        <button class="btn btn-outline btn-sm" data-action="browse-local-model">Browse…</button>
        <button class="btn btn-primary btn-sm" data-action="add-local-model">Add</button>
      </div>
      <div class="mt-3 overflow-x-auto rounded-box border border-base-300 bg-base-100">
        <table class="table table-sm">
          <thead><tr><th>Model</th><th>Status</th><th class="text-right">Actions</th></tr></thead>
          <tbody>${
            models.length
              ? models.map(localModelRow).join("")
              : `<tr><td colspan="3" class="py-6 text-center text-sm text-base-content/50">No local models yet.</td></tr>`
          }</tbody>
        </table>
      </div>
    </section>
  </div>`;
}

/**
 * Claude Code and Codex are used through the CLIs already installed on this computer:
 * they hold their own login, so there is nothing to connect here — only whether Bees
 * found them, and the model an agent names to run through one.
 */
async function cliToolsSection(): Promise<string> {
  const installed = await detectCliTools().catch(() => ({}) as Record<string, string>);
  const rows = CLI_TOOLS.map((tool) => {
    const path = installed[tool.id];
    return `<li class="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
      <div class="min-w-0">
        <span class="block truncate font-semibold">${escapeHtml(tool.label)}</span>
        <span class="text-xs text-base-content/50">${
          path
            ? `agent model <code>${escapeHtml(tool.exampleModel)}</code> · <span class="truncate">${escapeHtml(path)}</span>`
            : `Not installed — <button class="link" data-action="open-external" data-url="${escapeHtml(
                tool.installUrl
              )}">install it</button>, then reopen this page`
        }</span>
      </div>
      <span class="badge badge-sm ${path ? "badge-success" : "badge-ghost"}">${path ? "Found" : "Missing"}</span>
    </li>`;
  }).join("");
  return `<section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
    <header class="border-b border-base-300 p-5">
      <h2 class="font-bold">Command-line agents</h2>
      <p class="mt-1 text-sm text-base-content/60">Runs pointed at these use the CLI on this computer, signed in with your own account. The CLI works in the run's workspace folder and bills whatever plan it is logged into.</p>
    </header>
    <ul class="divide-y divide-base-200 p-2">${rows}</ul>
  </section>`;
}

async function prefsConnectionsContent(): Promise<string> {
  const connections = await listAiConnections(repository, aiConnectionScope());
  const providerButtons = (Object.keys(AI_PROVIDER_LABEL) as AiProvider[])
    .map(
      (provider) => `<button class="btn btn-outline btn-sm" data-action="connect-ai" data-provider="${provider}">
        ${escapeHtml(AI_PROVIDER_LABEL[provider])}</button>`
    )
    .join("");
  const list = connections.length
    ? connections
        .map(
          (connection) => `<li class="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
            <div class="min-w-0">
              <span class="block truncate font-semibold">${escapeHtml(connection.label)}</span>
              <span class="text-xs text-base-content/50">Added ${escapeHtml(
                new Date(connection.createdAt).toLocaleDateString()
              )}${
                AI_PROVIDER_MODEL_PREFIX[connection.provider]
                  ? ` · agent model <code>${escapeHtml(
                      AI_PROVIDER_MODEL_PREFIX[connection.provider]
                    )}&lt;model&gt;</code>`
                  : " · not usable by runs yet"
              }</span>
            </div>
            <button class="btn btn-ghost btn-xs text-error" data-action="remove-ai-connection" data-id="${escapeHtml(
              connection.id
            )}">Remove</button>
          </li>`
        )
        .join("")
    : `<li class="px-3 py-6 text-center text-sm text-base-content/50">No AI connections yet.</li>`;
  const remoteConnections = (await listMcpConnections(repository, workspace.teamId)).filter(
    (connection) => !isKnowledgeConnection(connection)
  );
  const mcpList = remoteConnections.length
    ? remoteConnections.map((connection) => `<li class="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
        <div class="min-w-0"><span class="block truncate font-semibold">${escapeHtml(connection.name)}</span>
          <span class="text-xs text-base-content/50">${escapeHtml(connection.url)} · ${connection.allowedTools.length}/${connection.tools.length} tools allowed · ${connection.optional ? "optional offline" : "required"}</span>
          ${connection.lastError ? `<div class="mt-1 text-xs text-error">${escapeHtml(connection.lastError)}</div>` : ""}
        </div>
        <div class="flex gap-1"><button class="btn btn-ghost btn-xs" data-action="test-mcp" data-id="${connection.id}">Test / allowlist</button><button class="btn btn-ghost btn-xs text-error" data-action="remove-mcp" data-id="${connection.id}">Remove</button></div>
      </li>`).join("")
    : `<li class="px-3 py-6 text-center text-sm text-base-content/50">No MCP connections yet.</li>`;
  return `<div class="space-y-5">
    <section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
      <h2 class="card-title text-base">Cloud connections</h2>
      <p class="text-sm text-base-content/60">Give the current organization's agents access to hosted AI. These connections can be active at the same time.</p>
      <div class="flex flex-wrap gap-2">${providerButtons}</div>
    </div></section>
    <section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
      <header class="border-b border-base-300 p-5"><h2 class="font-bold">Active connections</h2></header>
      <ul class="divide-y divide-base-200 p-2">${list}</ul>
    </section>
    <section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
      <h2 class="card-title text-base">MCP connections</h2>
      <p class="text-sm text-base-content/60">Remote MCP servers receive the data an agent sends through their selected tools. Credentials stay in the operating-system vault.</p>
      <div class="flex flex-wrap gap-2"><button class="btn btn-outline btn-sm" data-action="add-mcp-api">Add API-key MCP</button><button class="btn btn-outline btn-sm" data-action="add-mcp-oauth">Add OAuth MCP</button></div>
    </div></section>
    <section class="rounded-box border border-base-300 bg-base-100 shadow-sm"><ul class="divide-y divide-base-200 p-2">${mcpList}</ul></section>
    ${await cliToolsSection()}
  </div>`;
}

async function connectAiProvider(provider: AiProvider): Promise<void> {
  showNotice(AI_PROVIDER_HINT[provider], "info");
  const data = await edit(`Connect ${AI_PROVIDER_LABEL[provider]}`, [
    { name: "apiKey", label: "API key", type: "password", placeholder: "sk-..." }
  ]);
  if (!data) return;
  const { connection, secret } = connectApiKey(provider, String(data.get("apiKey") ?? ""));
  await invoke("store_connection_secret", { secretRef: connection.secretRef, secret });
  try {
    await addAiConnection(repository, aiConnectionScope(), connection);
  } catch (error) {
    await invoke("delete_connection_secret", { secretRef: connection.secretRef }).catch(() => undefined);
    throw error;
  }
  await refreshAssistantCatalog();
  await refresh();
  showNotice(`Connected ${AI_PROVIDER_LABEL[provider]}`, "success");
}

async function discoverMcpConnection(connection: McpConnection): Promise<McpConnection> {
  const { baseUrl, token } = await ensureFlueRuntime();
  const response = await fetch(`${baseUrl}/connections/discover`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(connection)
  });
  const body = (await response.json()) as { tools?: McpConnection["tools"]; error?: string };
  if (!response.ok || !body.tools) {
    const failed = withMcpHealth(connection, connection.tools, body.error ?? `HTTP ${response.status}`);
    await saveMcpConnection(repository, failed);
    throw new Error(failed.lastError ?? "MCP discovery failed");
  }
  const discovered = withMcpHealth(connection, body.tools);
  const data = await edit(`Tools from ${connection.name}`, [
    {
      name: "allowedTools",
      label: "Allowed tools",
      type: "checkboxes",
      options: discovered.tools.map(({ name, description }) => ({
        label: `${name}${description ? ` · ${description}` : ""}`,
        value: name
      })),
      checked: discovered.allowedTools.length
        ? discovered.allowedTools
        : discovered.tools.map(({ name }) => name)
    }
  ], "Save allowlist");
  const saved = {
    ...discovered,
    allowedTools: data ? data.getAll("allowedTools").map(String) : discovered.allowedTools,
    updatedAt: new Date().toISOString()
  };
  await saveMcpConnection(repository, saved);
  return saved;
}

async function addApiKeyMcp(): Promise<void> {
  const data = await edit("Add MCP connection", [
    { name: "name", label: "Name", placeholder: "Linear" },
    { name: "url", label: "HTTPS endpoint", placeholder: "https://example.com/mcp" },
    { name: "token", label: "API key / bearer token", type: "password" },
    { name: "transport", label: "Transport", type: "toggle", value: "streamable-http", options: [{ label: "Streamable HTTP", value: "streamable-http" }, { label: "Legacy SSE", value: "sse" }] },
    { name: "offline", label: "When unavailable", type: "toggle", value: "required", options: [{ label: "Fail the run", value: "required" }, { label: "Continue without it", value: "optional" }] }
  ]);
  if (!data) return;
  const connection = newMcpConnection({
    teamId: workspace.teamId,
    name: String(data.get("name") ?? ""),
    url: String(data.get("url") ?? ""),
    authType: "api-key",
    transport: String(data.get("transport")) as McpConnection["transport"],
    optional: data.get("offline") === "optional"
  });
  const secret = String(data.get("token") ?? "").trim();
  if (!secret) throw new Error("API key is required");
  await invoke("store_connection_secret", { secretRef: connection.secretRef, secret });
  try {
    await saveMcpConnection(repository, connection);
  } catch (error) {
    await invoke("delete_connection_secret", { secretRef: connection.secretRef }).catch(() => undefined);
    throw error;
  }
  await discoverMcpConnection(connection);
  await refresh();
}

async function addOAuthMcp(): Promise<void> {
  const data = await edit("Authorize MCP connection", [
    { name: "name", label: "Name" },
    { name: "url", label: "MCP HTTPS endpoint" },
    { name: "authorizationUrl", label: "Authorization URL" },
    { name: "tokenUrl", label: "Token URL" },
    { name: "revocationUrl", label: "Revocation URL (optional)" },
    { name: "clientId", label: "OAuth client ID" },
    { name: "clientSecret", label: "Client secret (if required)", type: "password" },
    { name: "scopes", label: "Scopes", placeholder: "mcp:tools offline_access" },
    { name: "offline", label: "When unavailable", type: "toggle", value: "required", options: [{ label: "Fail the run", value: "required" }, { label: "Continue without it", value: "optional" }] }
  ], "Authorize");
  if (!data) return;
  const connection = newMcpConnection({
    teamId: workspace.teamId,
    name: String(data.get("name") ?? ""),
    url: String(data.get("url") ?? ""),
    authType: "oauth",
    optional: data.get("offline") === "optional"
  });
  const authorizationUrl = await invoke<string>("connection_oauth_start", {
    request: {
      authorizationUrl: String(data.get("authorizationUrl") ?? ""),
      tokenUrl: String(data.get("tokenUrl") ?? ""),
      revocationUrl: String(data.get("revocationUrl") ?? "") || null,
      clientId: String(data.get("clientId") ?? ""),
      clientSecret: String(data.get("clientSecret") ?? "") || null,
      scopes: String(data.get("scopes") ?? ""),
      secretRef: connection.secretRef
    }
  });
  await openUrl(authorizationUrl);
  await invoke("connection_oauth_await");
  try {
    await saveMcpConnection(repository, connection);
  } catch (error) {
    await invoke("delete_connection_secret", { secretRef: connection.secretRef }).catch(() => undefined);
    throw error;
  }
  await discoverMcpConnection(connection);
  await refresh();
}

async function renderOrgSettings(): Promise<void> {
  setHeader("Organization settings", currentOrganization()?.name);
  await renderTabs<OrgTab>(
    "org-tab",
    [
      { id: "general", label: "General", content: orgGeneralContent },
      { id: "members", label: "Members", content: orgMembersContent },
      { id: "invites", label: "Invites", content: orgInvitesContent },
      { id: "folder", label: "Folder", content: orgWorkspaceContent },
      { id: "knowledge", label: "Knowledge", content: orgKnowledgeContent }
    ],
    orgTab,
    () => view === "org-settings"
  );
}

// ---- Preferences (tabbed: Mode / Theme / Sign-ins / Org invites / Create org) ----

function prefsThemeContent(): string {
  const themeOptions = (selected: ThemePreset) =>
    themePresets
      .map(
        (preset) =>
          `<option value="${preset.id}" ${preset.id === selected ? "selected" : ""}>${preset.name}</option>`
      )
      .join("");
  const themeCards = themePresets
    .map(
      (preset) => `<button class="theme-card ${preset.id === themePreset ? "selected" : ""}"
        data-action="set-theme-preset" data-theme-preset="${preset.id}"
        data-theme="${preset.id}" aria-pressed="${preset.id === themePreset}">
        <div class="theme-swatches">
          <span style="background:var(--color-primary)"></span>
          <span style="background:var(--color-secondary)"></span>
          <span style="background:var(--color-accent)"></span>
          <span style="background:var(--color-base-300)"></span>
        </div>
        <div><strong class="block text-sm">${preset.name}</strong></div>
      </button>`
    )
    .join("");
  return `<section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
      <h2 class="card-title text-base">Theme</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="form-control gap-1">
          <span class="text-sm font-medium">Default Dark Theme</span>
          <select class="select w-full" data-theme-default="dark">${themeOptions(darkDefaultTheme)}</select>
        </label>
        <label class="form-control gap-1">
          <span class="text-sm font-medium">Default Light Theme</span>
          <select class="select w-full" data-theme-default="light">${themeOptions(lightDefaultTheme)}</select>
        </label>
      </div>
      <h3 class="mt-2 font-semibold">All themes</h3>
      <div class="grid gap-3 sm:grid-cols-3">${themeCards}</div>
    </div></section>`;
}

async function prefsSigninsContent(): Promise<string> {
  const description = `<p class="text-sm text-base-content/60">You can sign in with multiple user IDs. Each user ID can belong to multiple organizations, and you can work across all of them at the same time.</p>`;
  const sso = Object.entries(providerLabel)
    .map(
      ([provider, label]) =>
        `<button class="btn btn-outline btn-sm justify-start" data-action="social-signin" data-provider="${provider}">Sign in to another account using ${escapeHtml(
          label
        )} SSO</button>`
    )
    .join("");
  const addBlock = `<section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-2">
      <h2 class="card-title text-base">Add a sign-in</h2>
      <div class="flex flex-col gap-2">
        ${sso}
        <button class="btn btn-outline btn-sm justify-start" data-action="signin-email">Sign in using an email</button>
        <button class="btn btn-outline btn-sm justify-start" data-action="signup-email">Create a new account using your email</button>
      </div>
    </div></section>`;

  if (accounts.size === 0) return `<div class="space-y-5">${description}${addBlock}</div>`;

  const label = (provider: string): string =>
    provider === "credential" ? "Email" : (providerLabel[provider] ?? provider);

  // One row per signed-in account. Every account is always active — no single active one.
  const rows = await Promise.all(
    [...accounts.values()].map(async ({ user, token }) => {
      const providers = await api.listAccounts(token).catch(() => []);
      const how = providers.length ? providers.map((a) => label(a.provider)).join(", ") : "—";
      return `<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
        <span class="flex min-w-0 items-center gap-2">
          <span class="status status-success"></span>
          <span class="truncate font-medium">${escapeHtml(user.email)}</span>
          <span class="text-base-content/55">· ${escapeHtml(how)}</span>
        </span>
        <button class="btn btn-ghost btn-sm text-error" data-action="sign-out-account" data-id="${escapeHtml(user.id)}">Sign out</button>
      </li>`;
    })
  );
  const signedInBlock = `<section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
      <header class="border-b border-base-300 p-5"><h2 class="font-bold">Signed-in accounts</h2></header>
      <ul class="divide-y divide-base-200 p-2">${
        rows.length ? rows.join("") : `<li class="px-3 py-2 text-sm text-base-content/50">No signed-in accounts.</li>`
      }</ul>
    </section>`;
  return `<div class="space-y-5">${description}${addBlock}${signedInBlock}</div>`;
}

/**
 * One row per (organization, account) pair. The same org reachable by two accounts shows
 * twice — once per account. Each row's action already knows its account, so Login binds that
 * exact account with no prompt. Derived per account from its own memberships + invites.
 */
async function prefsOrgsContent(): Promise<string> {
  // Two calls per pooled account, only while this tab is open. Fine for a handful of accounts.
  const perAccount = await Promise.all(
    [...accounts.values()].map(async (account) => {
      // A failure here used to render as an empty list, which reads as "you have no organizations"
      // — the one thing it must not say. Keep the reason and show it on the row instead.
      const failed = (error: unknown): string =>
        error instanceof ApiError && error.status === 401
          ? "Session expired — sign in again"
          : `Could not reach the server (${errorText(error)})`;
      const [orgs, invites] = await Promise.all([
        api
          .listOrganizations(account.token)
          .then((r) => ({ ok: true as const, value: r.organizations }))
          .catch((error: unknown) => ({ ok: false as const, reason: failed(error) })),
        api
          .myInvitations(account.token)
          .then((r) => r.invitations)
          .catch(() => [])
      ]);
      return { account, orgs, invites };
    })
  );

  type Row = { name: string; account: string; button: string };
  const rows: Row[] = [];
  const acct = (id: string) => escapeHtml(id);

  for (const { account, orgs: orgResult, invites } of perAccount) {
    const email = account.user.email;
    if (!orgResult.ok) {
      rows.push({
        name: "Organizations unavailable",
        account: email,
        button: `<span class="badge badge-error badge-sm">${escapeHtml(orgResult.reason)}</span>`
      });
    }
    const orgs = orgResult.ok ? orgResult.value : [];
    for (const org of orgs) {
      const signedIn = connections.has(connKey(org.id, account.user.id)); // this exact pair connected
      rows.push({
        name: org.name,
        account: email,
        button: signedIn
          ? `<button class="btn btn-ghost btn-xs text-error" data-action="logout-org" data-id="${org.id}" data-account="${acct(
              account.user.id
            )}">Logout</button>`
          : `<button class="btn btn-primary btn-xs" data-action="login-org" data-id="${org.id}" data-account="${acct(
              account.user.id
            )}">Login</button>`
      });
    }
    for (const invite of invites) {
      rows.push({
        name: invite.organizationName,
        account: email,
        button: `<button class="btn btn-primary btn-xs" data-action="accept-invite" data-id="${invite.id}" data-account="${acct(
          account.user.id
        )}">Accept</button>`
      });
    }
  }

  // Local orgs have no account, but still belong in "all orgs".
  for (const org of organizations) {
    if (orgIsConnected(org.id)) continue;
    rows.push({ name: org.name, account: "Local", button: `<span class="badge badge-ghost badge-sm">Local</span>` });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name) || a.account.localeCompare(b.account));

  return `<div class="space-y-5">${prefsCreateOrgContent()}<section class="rounded-box border border-base-300 bg-base-100 shadow-sm">
      <header class="border-b border-base-300 p-5"><h2 class="font-bold">Organizations</h2>
        <p class="mt-1 text-sm text-base-content/55">Each organization per account. Log in or out of any without leaving the others.</p></header>
      <ul class="divide-y divide-base-200 p-2">${
        rows.length
          ? rows
              .map(
                (row) => `<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div class="min-w-0"><strong class="block truncate">${escapeHtml(row.name)}</strong>
                <span class="block text-xs text-base-content/55">${escapeHtml(row.account)}</span></div>
              ${row.button}
            </li>`
              )
              .join("")
          : `<li class="px-3 py-6 text-center text-sm text-base-content/50">No organizations yet.</li>`
      }</ul>
    </section></div>`;
}

function prefsCreateOrgContent(): string {
  return `<section class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body gap-3">
      <h2 class="card-title text-base">Create an organization</h2>
      <p class="text-sm text-base-content/60"><strong>Local</strong>: Bees Desktop is free, and work stays on this machine.</p>
      <p class="text-sm text-base-content/60"><strong>Connected</strong>: free during beta; users and agents on different machines can coordinate on the same work items (needs a sign-in).</p>
      <div class="card-actions justify-end gap-2">
        <button class="btn btn-outline btn-sm" data-action="create-local-org">New local org</button>
        <button class="btn btn-primary btn-sm" data-action="create-connected-org">New connected org</button>
      </div>
    </div></section>`;
}

async function renderPreferences(): Promise<void> {
  setHeader("Preferences", currentUser()?.email ?? "Local");
  await renderTabs<PrefsTab>(
    "prefs-tab",
    [
      { id: "local-models", label: "Local models", content: prefsLocalModelsContent },
      { id: "connections", label: "Connections", content: prefsConnectionsContent },
      { id: "signins", label: "Sign-ins", content: prefsSigninsContent },
      { id: "orgs", label: "Orgs", content: prefsOrgsContent },
      { id: "folder", label: "Root Folder", content: prefsFolderContent },
      { id: "theme", label: "Theme", content: prefsThemeContent }
    ],
    prefsTab,
    () => view === "preferences"
  );
}

interface EditorOption {
  label: string;
  value: string;
  description?: string;
}

interface EditorField {
  name: string;
  label: string;
  value?: string;
  type?:
    | "text"
    | "password"
    | "textarea"
    | "select"
    | "toggle"
    | "checkboxes"
    | "color"
    | "file"
    | "note";
  placeholder?: string;
  options?: EditorOption[];
  checked?: string[];
  /** Optional directly selectable section. Most dialogs remain a single short form. */
  step?: "basics" | "instructions" | "capabilities";
  /** Small line under the control. Rewritten live for the model field. */
  hint?: string;
  /** Native datalist entries — suggestions, not a closed set. */
  suggestions?: string[];
}

function agentEditorFields(agent?: Agent): EditorField[] {
  const config = agent?.config;
  const selected =
    config?.provider?.trim() && config.model?.trim()
      ? { provider: config.provider, model: config.model }
      : assistantModel;
  const provider = selected.provider;
  // An agent file can name a provider we do not list; keep it rather than silently
  // rewriting the agent to something else on the next save.
  const providers = MODEL_PROVIDERS.some(({ id }) => id === provider)
    ? MODEL_PROVIDERS
    : [...MODEL_PROVIDERS, { id: provider, label: provider, models: [] }];
  const known = knownModelsForProvider(provider);
  const capabilities = registryCapabilities(registries);
  const customTools = capabilities.filter(({ kind }) => kind === "tool");
  const selectedTools = config?.toolRefs ?? [BROWSER_TOOL_REF];
  const selectedGrants = config?.grants ?? [];
  return [
    { name: "name", label: "Name", value: agent?.name ?? "", step: "basics" },
    { name: "purpose", label: "Purpose", value: agent?.purpose ?? "", step: "basics" },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      value: agent?.description ?? "",
      step: "basics"
    },
    {
      name: "trigger",
      label: "Trigger status",
      type: "select",
      value: agent?.triggerStageId ?? "",
      options: [
        { label: "None", value: "" },
        ...processes.flatMap((process) =>
          process.stages.map((stage) => ({
            label: `${process.name} / ${stage.name}`,
            value: stage.id
          }))
        )
      ],
      step: "basics"
    },
    {
      name: "provider",
      label: "Provider",
      type: "select",
      value: provider,
      options: providers.map(({ id, label }) => ({ label, value: id })),
      step: "instructions"
    },
    {
      name: "model",
      label: "Model",
      value: selected.model,
      suggestions: known,
      hint: known.length ? `Known models: ${known.join(", ")}` : "Any model id this provider accepts.",
      step: "instructions"
    },
    {
      name: "prompt",
      label: "Instructions",
      type: "textarea",
      value: config?.prompt ?? "",
      step: "instructions"
    },
    {
      name: "thinkingLevel",
      label: "Reasoning",
      type: "select",
      value: config?.thinkingLevel ?? "medium",
      // "off" reaches a local model as `enable_thinking: false`. The CLIs cannot switch
      // reasoning off at all, so it lands on their lowest effort instead.
      options: ["off", "minimal", "low", "medium", "high", "xhigh"].map((value) => ({ label: value, value })),
      step: "instructions"
    },
    {
      name: "skills",
      label: "Skills",
      type: "checkboxes",
      options: capabilities.filter(({ kind }) => kind === "skill").map(({ ref, name, path, registryId }) => ({
        label: name,
        value: ref,
        description: `${registries.find(({ id }) => id === registryId)?.name ?? "Skill folder"} · ${path}`
      })),
      checked: config?.skillRefs ?? [],
      hint: "Reusable instructions copied into the run. Add more under Team settings → Integrations.",
      step: "capabilities"
    },
    {
      name: "tools",
      label: "Local tools",
      type: "checkboxes",
      options: [
        {
          label: "Browser",
          value: BROWSER_TOOL_REF,
          description: "Opens websites in the team browser profile. Choose read or write access below."
        },
        ...customTools.map(({ ref, name, path, registryId }) => ({
          label: name,
          value: ref,
          description: `Trusted local code · ${registries.find(({ id }) => id === registryId)?.name ?? "Tool folder"} · ${path}`
        }))
      ],
      checked: selectedTools,
      hint: "Selecting a local tool authorizes its trusted code to run on this machine.",
      step: "capabilities"
    },
    {
      name: "browserAccess",
      label: "Browser access",
      type: "toggle",
      value: selectedGrants.includes(BROWSER_WRITE_GRANT) ? "write" : "read",
      options: [
        { label: "Read only", value: "read" },
        { label: "Click and type", value: "write" }
      ],
      hint: "Used only when Browser is selected.",
      step: "capabilities"
    },
    {
      name: "mcps",
      label: "MCP connections",
      type: "checkboxes",
      options: mcpConnections.map((connection) => {
        const tools = connection.tools
          .filter(({ name }) => connection.allowedTools.includes(name))
          .slice(0, 4)
          .map(({ name, description }) => description ? `${name} — ${description}` : name);
        const more = Math.max(0, connection.allowedTools.length - tools.length);
        return {
          label: `${connection.name}${connection.lastError ? " · Offline" : ""}`,
          value: connection.id,
          description: `${connection.url} · ${connection.optional ? "Optional when offline" : "Required; submission fails when unavailable"}${tools.length ? ` · Tools: ${tools.join("; ")}${more ? `; +${more} more` : ""}` : " · No tools allowed"}`
        };
      }),
      checked: config?.mcpConnectionRefs ?? [],
      hint: "Remote services receive relevant prompts and tool arguments. Manage connections and their tool allowlists in Preferences.",
      step: "capabilities"
    },
    {
      name: "delegates",
      label: "Helpers",
      type: "checkboxes",
      options: agents
        .filter(
          (candidate) =>
            candidate.id !== agent?.id &&
            !(candidate.config.delegateRefs?.length) &&
            !(candidate.config.mcpConnectionRefs?.length) &&
            !selectedAgentCapabilities(registries, candidate.config).some(({ kind }) => kind === "tool")
        )
        .map(({ id, name, purpose }) => ({ label: name, value: id, description: purpose })),
      checked: config?.delegateRefs ?? [],
      hint: "Helpers can use skills only; they cannot run tools or contact remote services.",
      step: "capabilities"
    },
    {
      name: "environment",
      label: "Execution environment",
      type: "note",
      value: "Runs in the local Bees workspace. File access is sandboxed and the host shell is disabled.",
      step: "capabilities"
    }
  ];
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function checkboxOptions(name: string, options: EditorOption[], checked: string[]): string {
  if (!options.length) return `<p class="p-2 text-sm text-base-content/45">None available yet.</p>`;
  return options
    .map(
      (option) => `<label class="cursor-pointer">
        <input class="peer sr-only" type="checkbox" name="${escapeHtml(
          name
        )}" value="${escapeHtml(option.value)}" ${checked.includes(option.value) ? "checked" : ""}>
        <span class="block rounded-box border border-base-300 p-3 transition hover:bg-base-200 peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:[&_.selection-check]:opacity-100">
          <span class="flex items-center justify-between gap-3"><span class="text-sm font-semibold">${escapeHtml(option.label)}</span><span class="selection-check text-primary opacity-0" aria-hidden="true">✓</span></span>
          ${option.description ? `<span class="mt-1 block break-words text-xs leading-relaxed text-base-content/55">${escapeHtml(option.description)}</span>` : ""}
        </span>
      </label>`
    )
    .join("");
}

/**
 * Model ids belong to a provider, so the suggestions and the hint follow the dropdown.
 * No-op in dialogs without both fields.
 */
function linkProviderModel(): void {
  const provider = dialogForm.querySelector<HTMLSelectElement>('select[name="provider"]');
  const model = dialogForm.querySelector<HTMLInputElement>('input[name="model"]');
  if (!provider || !model) return;
  const hint = dialogForm.querySelector<HTMLElement>('[data-hint="model"]');
  const list = dialogForm.querySelector<HTMLDataListElement>("#editor-suggest-model");
  provider.addEventListener("change", () => {
    const known = knownModelsForProvider(provider.value);
    if (list) {
      list.innerHTML = known.map((id) => `<option value="${escapeHtml(id)}"></option>`).join("");
    }
    if (hint) {
      hint.textContent = known.length
        ? `Known models: ${known.join(", ")}`
        : "Any model id this provider accepts.";
    }
  });
}

function knownModelsForProvider(provider: string): string[] {
  const known = MODEL_PROVIDERS.find(({ id }) => id === provider)?.models ?? [];
  return provider === LOCAL_PROVIDER
    ? [
        ...new Set([
          ...known,
          ...assistantCatalog
            .filter(({ choice }) => choice.provider === LOCAL_PROVIDER)
            .map(({ choice }) => choice.model)
        ])
      ]
    : known;
}

function editorFieldHtml({
  name,
  label,
  value = "",
  type = "text",
  placeholder = "",
  options = [],
  checked = [],
  hint,
  suggestions
}: EditorField): string {
  if (type === "note") return `<p class="text-sm text-base-content/75">${escapeHtml(value)}</p>`;
  const listId = suggestions ? `editor-suggest-${name}` : "";
  let control = `<input class="input input-bordered w-full" type="${
    type === "password" ? "password" : "text"
  }" name="${escapeHtml(name)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(
    placeholder
  )}" ${listId ? `list="${listId}"` : ""}>${
    suggestions
      ? `<datalist id="${listId}">${suggestions
          .map((option) => `<option value="${escapeHtml(option)}"></option>`)
          .join("")}</datalist>`
      : ""
  }`;
  if (type === "textarea") {
    control = `<textarea class="textarea textarea-bordered min-h-24 w-full" name="${escapeHtml(
      name
    )}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>`;
  }
  if (type === "select") {
    control = `<select class="select select-bordered w-full" name="${escapeHtml(name)}">${options
      .map(
        (option) =>
          `<option value="${escapeHtml(option.value)}" ${option.value === value ? "selected" : ""}>${escapeHtml(
            option.label
          )}</option>`
      )
      .join("")}</select>`;
  }
  if (type === "toggle") {
    control = `<div class="join grid w-full" style="grid-template-columns: repeat(${Math.max(
      1,
      options.length
    )}, minmax(0, 1fr))" role="radiogroup" aria-label="${escapeHtml(label)}">${options
      .map(
        (option) =>
          `<input class="btn join-item min-w-0" type="radio" name="${escapeHtml(
            name
          )}" value="${escapeHtml(option.value)}" aria-label="${escapeHtml(option.label)}" ${
            option.value === value ? "checked" : ""
          }>`
      )
      .join("")}</div>`;
  }
  if (type === "checkboxes") {
    control = `<div data-editor-field="${escapeHtml(name)}" class="grid gap-2">${checkboxOptions(
      name,
      options,
      checked
    )}</div>`;
  }
  if (type === "color") {
    control = `<input class="h-10 w-full cursor-pointer rounded-lg border border-base-300 bg-base-100" type="color" name="${escapeHtml(
      name
    )}" value="${escapeHtml(value || "#4f46e5")}">`;
  }
  if (type === "file") {
    control = `<input class="file-input file-input-bordered w-full" type="file" accept="image/*" name="${escapeHtml(
      name
    )}">`;
  }
  return `<label class="form-control grid gap-1.5"><span class="label-text text-sm font-semibold">${escapeHtml(
    label
  )}</span>${control}${
    hint === undefined
      ? ""
      : `<span data-hint="${escapeHtml(name)}" class="text-xs text-base-content/55">${escapeHtml(hint)}</span>`
  }</label>`;
}

/**
 * `footerLabel` adds a secondary link under the buttons; picking it submits with
 * `__action=footer` so the caller can tell it apart from the primary button.
 */
function edit(
  titleText: string,
  fields: EditorField[],
  submitLabel = "Save",
  footerLabel = ""
): Promise<FormData | null> {
  dialogTitle.textContent = titleText;
  const saveButton = dialog.querySelector<HTMLButtonElement>("#editor-save");
  if (saveButton) saveButton.textContent = submitLabel;
  dialogFooter.innerHTML = footerLabel
    ? `<button class="link link-primary text-sm" type="submit" name="__action" value="footer">${escapeHtml(
        footerLabel
      )}</button>`
    : "";
  const stepLabels = {
    basics: "1 · Basics",
    instructions: "2 · Instructions",
    capabilities: "3 · Capabilities"
  } as const;
  const steps = [...new Set(fields.flatMap(({ step }) => step ? [step] : []))];
  dialogFields.innerHTML = steps.length > 1
    ? `<nav class="join grid grid-cols-3" aria-label="Agent setup sections">${steps
        .map((step, index) => `<button class="btn join-item ${index ? "btn-ghost" : "btn-primary"}" type="button" data-editor-step-button="${step}">${stepLabels[step]}</button>`)
        .join("")}</nav>${steps
        .map((step, index) => `<section class="grid gap-4" data-editor-step="${step}" ${index ? "hidden" : ""}>${fields.filter((field) => field.step === step).map(editorFieldHtml).join("")}</section>`)
        .join("")}`
    : fields.map(editorFieldHtml).join("");
  const showStep = (step: string): void => {
    for (const section of dialogFields.querySelectorAll<HTMLElement>("[data-editor-step]")) {
      section.hidden = section.dataset.editorStep !== step;
    }
    for (const button of dialogFields.querySelectorAll<HTMLButtonElement>("[data-editor-step-button]")) {
      const active = button.dataset.editorStepButton === step;
      button.classList.toggle("btn-primary", active);
      button.classList.toggle("btn-ghost", !active);
    }
  };
  for (const button of dialogFields.querySelectorAll<HTMLButtonElement>("[data-editor-step-button]")) {
    button.addEventListener("click", () => showStep(button.dataset.editorStepButton ?? ""));
  }
  linkProviderModel();
  dialog.showModal();
  (dialogFields.querySelector<HTMLElement>("[data-editor-step]:not([hidden])") ?? dialogForm)
    .querySelector<HTMLElement>(
      'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)'
    )
    ?.focus();

  return new Promise((resolve) => {
    let settled = false;
    const cancelButton = dialog.querySelector<HTMLButtonElement>("[data-dialog-cancel]");
    const finish = (value: FormData | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const submit = async (event: SubmitEvent): Promise<void> => {
      event.preventDefault();
      const formData = new FormData(dialogForm, event.submitter);
      // File inputs come back as File objects; convert to data URLs so callers get a string.
      for (const field of fields) {
        if (field.type !== "file") continue;
        const input = dialogForm.querySelector<HTMLInputElement>(`input[name="${field.name}"]`);
        const file = input?.files?.[0];
        formData.set(field.name, file ? await readFileAsDataUrl(file) : "");
      }
      finish(formData);
      dialog.close();
    };
    const close = () => {
      dialogForm.removeEventListener("submit", submit);
      cancelButton?.removeEventListener("click", cancel);
      finish(null);
    };
    const cancel = () => dialog.close();
    dialogForm.addEventListener("submit", submit, { once: true });
    dialog.addEventListener("close", close, { once: true });
    cancelButton?.addEventListener("click", cancel, { once: true });
  });
}

async function createItem(stageId?: string): Promise<void> {
  if (!activeProcess || !activeBoard) throw new Error("Open a board first");
  const targetStage = stageId ?? activeBoard.stageIds[0];
  if (!targetStage) throw new Error("This board needs a status column");
  const locations = await repository.listAvailableFileLocations(workspace.teamId);
  const data = await edit("New work item", [
    { name: "title", label: "Title" },
    { name: "description", label: "Description", type: "textarea" },
    { name: "owner", label: "Owner" },
    {
      name: "files",
      label: "File references",
      placeholder: "Drafts/brief.md, @Shared drive/Reports/q2.pdf",
      hint: fileReferenceHint(locations)
    }
  ]);
  if (!data) return;
  await repository.createWorkItem(activeProcess.id, {
    stageId: targetStage,
    title: String(data.get("title") ?? ""),
    description: String(data.get("description") ?? ""),
    owner: String(data.get("owner") ?? ""),
    logicalFiles: parseFileReferencesInput(String(data.get("files") ?? ""), locations)
  });
  await refresh();
}

function fileReferenceHint(locations: FileLocation[]): string {
  const names = locations.map(({ name }) => `@${name}/path/to/file`).join(", ");
  return names
    ? `Primary workspace: path/to/file. Linked locations: ${names}.`
    : "Paths are relative to the primary team workspace. Add linked locations in Team settings → Folder.";
}

function parseFileReferencesInput(value: string, locations: FileLocation[]): string[] {
  return value
    .split(",")
    .map((reference) => reference.trim())
    .filter(Boolean)
    .map((reference) => {
      if (!reference.startsWith("@")) return reference;
      const slash = reference.indexOf("/");
      if (slash < 2) throw new Error("Linked references use @Location name/path/to/file");
      const name = reference.slice(1, slash);
      const matches = locations.filter(
        (location) => location.name.toLowerCase() === name.toLowerCase()
      );
      if (matches.length !== 1) throw new Error(`Linked location "${name}" is not available`);
      return logicalFileReference(matches[0]!.id, reference.slice(slash + 1));
    });
}

function displayFileReferences(references: string[], locations: FileLocation[]): string[] {
  return references.map((value) => {
    const reference = parseLogicalFileReference(value);
    if (!reference.locationId) return reference.path;
    const location = locations.find(({ id }) => id === reference.locationId);
    return location
      ? `@${location.name}/${reference.path}`
      : `@unavailable-${reference.locationId.slice(0, 8)}/${reference.path}`;
  });
}

/** A dashboard is bound to its process for life, so only the name and columns are editable. */
async function editDashboard(board: Board): Promise<void> {
  const process = processes.find(({ id }) => id === board.processId);
  if (!process) throw new Error("This dashboard's process is archived");

  const data = await edit("Dashboard settings", [
    { name: "name", label: "Dashboard name", value: board.name },
    {
      name: "stages",
      label: "Status columns",
      type: "checkboxes",
      options: process.stages.map(({ id, name }) => ({ label: name, value: id })),
      checked: board.stageIds
    },
    {
      name: "filters",
      label: "Hide items from the board",
      type: "textarea",
      value: formatBoardFilters(board.filters),
      placeholder: "done 24",
      hint: "One rule per line: status then hours untouched (0 = always). Statuses: open, blocked, done, archived. Hidden items move to the Filtered items drawer."
    }
  ]);
  if (!data) return;
  await repository.updateBoard(board.id, workspace.teamId, {
    name: String(data.get("name") ?? ""),
    processId: process.id,
    stageIds: data.getAll("stages").map(String),
    filters: parseBoardFilters(String(data.get("filters") ?? ""))
  });
  view = "board";
  await refresh();
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
    const statusName =
      typeof execution.result.statusName === "string" ? execution.result.statusName : undefined;

    if (execution.result.projectionState === "pending") {
      if (execution.status === "completed" && outputs.length === 0 && !continuation) {
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
      if (execution.status === "completed" && outputs.length === 0 && !continuation) {
        if (scope) await syncCheckpoint(execution.workItemId, scope.organizationId, scope.teamId);
        await releaseClaim(execution.workItemId, scope?.organizationId);
      } else if (execution.status !== "completed" || outputs.length === 0) {
        await releaseClaim(execution.workItemId, scope?.organizationId);
      }
      if ((execution.status !== "completed" || outputs.length === 0) && execution.workspaceRef) {
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
    const data = await edit(
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

function processStateBadge(processId: string): string {
  return runningProcesses.has(processId)
    ? '<span class="badge badge-success badge-sm">Running</span>'
    : '<span class="badge badge-ghost badge-sm">Stopped</span>';
}

function processStatusButton(processId: string): string {
  const running = runningProcesses.has(processId);
  return actionIconButton(
    running ? "stop-process" : "start-process",
    running ? "Running. Click to stop." : "Stopped. Click to run.",
    running ? ACTION_ICONS.active : ACTION_ICONS.inactive,
    processId,
    running ? "btn-ghost text-success" : "btn-ghost text-warning"
  );
}

function processRunButtons(processId: string, size: string): string {
  const running = runningProcesses.has(processId);
  return `<button class="btn btn-primary ${size}" data-action="start-process" data-id="${processId}"${
    running ? " disabled" : ""
  }>Run</button><button class="btn btn-ghost ${size} text-error" data-action="stop-process" data-id="${processId}"${
    running ? "" : " disabled"
  }>Stop</button>`;
}

/**
 * Running is a property of the process, not of a task: switching it on is the only click
 * needed, and every item that lands on a status with an agent runs itself from then on.
 * Stopping also cancels whatever that process has in flight, so it is a real brake.
 */
async function setProcessRunning(processId: string, running: boolean): Promise<void> {
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
    const agent = agentForStage(item.stageId);
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
  if (!stage || !agentForStage(stage.id)) return;
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
  const agent = agentForStage(stage?.id);
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
    await writeAgent({ ...agent, config: { ...agent.config, skillRefs: [...(agent.config.skillRefs ?? []), ref] } });
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
  const currentAgent = agentForStage(stage.id);
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
    // Local bring-up (llama-server boot takes up to a minute) blocks before the run view
    // appears — without this the Run button looks dead the whole time.
    showNotice("Starting the local AI model…", "info");
    const runtimeChanged = await localModels.requireActive(runAgent.config.model);
    if (runtimeChanged) await flueProjectPort.restart();
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
    const referencedLocationIds = new Set(
      item.logicalFiles.flatMap((reference) => {
        const locationId = parseLogicalFileReference(reference).locationId;
        return locationId ? [locationId] : [];
      })
    );
    const fileLocations = (await repository.listAvailableFileLocations(workspace.teamId)).filter(
      ({ id }) => referencedLocationIds.has(id)
    );
    let composition = continuation
      ? { capabilities: [], mcpConnections: [], delegates: [] }
      : runComposition(runAgent);
    if (!continuation) {
      const projected = await projectToolsByPolicy(runAgent, composition);
      runAgent = projected.agent;
      composition = projected.composition;
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
      ...(process.name.toLowerCase() === GOALS_PROCESS_NAME.toLowerCase()
        ? { goalStage: stage.name }
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
  if (execution.workspaceRef) await workspaces.cleanup(execution.workspaceRef).catch(() => undefined);
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
      if (view === "run" && activeExecutionId === execution.id) void renderRunDetail();
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
    if (!outputs.some(({ logicalOutput }) => logicalOutput === TASK_PLAN_OUTPUT)) {
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
    await repository.touchWorkItem(execution.workItemId);
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
  expandedTeams.add(teamId);
  activeBoard = null;
  activeProcess = null;
  processesPage = "team";
  view = nextView;
  await refresh();
  await seedDefaultRegistry();
  await seedGoalsWorkflow();
}

async function createLocalOrg(): Promise<void> {
  const data = await edit("New local organization", [
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
  const data = await edit(
    "New connected organization",
    [
      { name: "beta", label: "", type: "note", value: CONNECTED_ORG_BETA_COPY },
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
  const choice = await edit(
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

document.addEventListener("click", async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button");
  // The assistant panel runs its own delegation — it lives outside #app and its buttons share
  // no data-action vocabulary with the views.
  if (!button || button.closest("dialog") || button.closest("#assistant")) return;
  try {
    if (button.dataset.view) {
      view = button.dataset.view as View;
      if (view === "processes") processesPage = "team";
      if (button.dataset.prefs) prefsTab = button.dataset.prefs as PrefsTab;
      render();
      return;
    }
    if (button.dataset.prefsTab) {
      prefsTab = button.dataset.prefsTab as PrefsTab;
      render();
      return;
    }
    if (button.dataset.orgTab) {
      orgTab = button.dataset.orgTab as OrgTab;
      render();
      return;
    }
    if (button.dataset.teamTab) {
      teamTab = button.dataset.teamTab as TeamTab;
      render();
      return;
    }
    if (button.dataset.teamView) {
      const teamId = button.dataset.team!;
      const nextView = button.dataset.teamView as View;
      if (nextView === "processes") processesPage = "team";
      if (teamId !== workspace.teamId) await switchTeam(teamId, nextView);
      else {
        view = nextView;
        render();
      }
      return;
    }
    if (button.dataset.itemTab) {
      itemTab = button.dataset.itemTab as typeof itemTab;
      render();
      return;
    }
    if (button.dataset.agentTab) {
      agentTab = button.dataset.agentTab as typeof agentTab;
      render();
      return;
    }
    if (button.dataset.board) {
      // A dashboard in another team: switch to that team first so `boards`/`processes` hold it.
      const boardTeam = button.dataset.team;
      if (boardTeam && boardTeam !== workspace.teamId) await switchTeam(boardTeam);
      activeBoard = boards.find(({ id }) => id === button.dataset.board) ?? null;
      activeProcess = processes.find(({ id }) => id === activeBoard?.processId) ?? null;
      workspace.processId = activeProcess?.id ?? "";
      items = activeProcess ? await repository.listWorkItems(activeProcess.id) : [];
      view = "board";
      render();
      return;
    }

    const action = button.dataset.action;
    if (action === "knowledge-local") {
      try {
        await configureLocalKnowledge();
      } catch (error) {
        knowledgeError = errorText(error);
        showNotice(knowledgeError, "error");
      }
      await refresh();
      return;
    }
    if (action === "knowledge-remote") {
      try {
        await configureRemoteKnowledge();
      } catch (error) {
        knowledgeError = errorText(error);
        showNotice(knowledgeError, "error");
      }
      await refresh();
      return;
    }
    if (action === "knowledge-disable") {
      await disableKnowledge();
      await refresh();
      return;
    }
    if (action === "open-item") {
      activeItemId = button.dataset.id!;
      itemTab = "overview";
      const latest = executions.find(({ workItemId }) => workItemId === activeItemId);
      if (latest) await loadExecutionHistory(latest);
      view = "item";
      render();
      return;
    }
    if (action === "open-agent") {
      activeAgentId = button.dataset.id!;
      agentTab = "builder";
      view = "agent";
      render();
      return;
    }
    if (action === "open-folder-settings") {
      teamTab = "folder";
      view = "settings";
      render();
      return;
    }
    if (action === "open-run") {
      await openRun(button.dataset.id!);
      return;
    }
    if (action === "clear-search") {
      searchQuery = "";
      searchHits = [];
      render();
      return;
    }
    if (action === "archive-skill") {
      const name = button.dataset.name ?? "this skill";
      // A move, not a delete — so one confirmation is enough and the undo is a drag in Finder.
      if (!(await edit(`Retire "${name}"? Its folder moves to skills/.archive.`, [], "Retire"))) {
        return;
      }
      const teamRoot = await requireTeamRoot();
      await agentFiles.archiveSkill(teamRoot, button.dataset.slug!);
      await ensureTeamSkillsRegistry(teamRoot);
      await refresh();
      showNotice(`Retired "${name}" to skills/.archive`, "success");
      return;
    }
    if (action === "curate-skills") {
      await curateSkills();
      return;
    }
    if (action === "discard-curator-plan") {
      curatorPlan = null;
      render();
      return;
    }
    if (action === "apply-curator-plan") {
      await applyCuratorProposal();
      return;
    }
    if (action === "dismiss-run") {
      dismissedRunIds.add(button.dataset.id!);
      await repository.setSetting(DISMISSED_RUNS_KEY, [...dismissedRunIds]);
      render();
      showNotice("Run dismissed from Inbox", "success");
      return;
    }
    if (action === "stop-run") {
      const execution = await repository.getExecution(button.dataset.id!);
      if (!execution) return;
      await runCoordinator.stop(execution.id);
      await releaseClaim(execution.workItemId);
      await refresh();
      showNotice("Run stopped", "success");
      return;
    }
    if (action === "delete-run") {
      await deleteRun(button.dataset.id!);
      return;
    }
    if (action === "restart-run") {
      const execution = await repository.getExecution(button.dataset.id!);
      // A clean execution and conversation: the old snapshot's instructions and capabilities
      // may no longer be safe to reuse, so it is linked, never mutated or resumed.
      if (execution) await runItem(execution.workItemId, false, undefined, execution.id);
      return;
    }
    if (action === "preview-output") {
      const output = executionOutputs.find(({ id }) => id === button.dataset.id);
      const execution = output ? await repository.getExecution(output.executionId) : null;
      const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
      if (!output || !execution?.workspaceRef || !mapping) throw new Error("Output preview is unavailable");
      outputPreviews.set(
        output.id,
        await workspaces.preview(
          execution.workspaceRef,
          output.logicalOutput,
          mapping.localPath,
          output.logicalDestination
        )
      );
      await renderRunDetail();
      return;
    }
    if (action === "view-markdown-output") {
      const output = executionOutputs.find(({ id }) => id === button.dataset.id);
      const execution = output ? await repository.getExecution(output.executionId) : null;
      const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
      if (!output || !execution?.workspaceRef || !mapping || !/\.md$/i.test(output.logicalOutput)) {
        throw new Error("Markdown preview is unavailable");
      }
      markdownTitle.textContent = output.logicalOutput;
      markdownBody.innerHTML = renderMarkdown(
        await workspaces.readOutput(execution.workspaceRef, output.logicalOutput, mapping.localPath)
      );
      markdownDialog.showModal();
      return;
    }
    if (action === "approve-output") {
      const output = executionOutputs.find(({ id }) => id === button.dataset.id);
      const execution = output ? await repository.getExecution(output.executionId) : null;
      const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
      if (!output || !execution?.workspaceRef || !mapping) throw new Error("Output is unavailable");
      if (output.logicalOutput === TASK_PLAN_OUTPUT) {
        for (const control of app.querySelectorAll<HTMLButtonElement>(
          '[data-action="approve-output"], [data-action="reject-output"]'
        )) {
          if (control.dataset.id === output.id) control.disabled = true;
        }
        try {
          const item = teamItems.find(({ id }) => id === execution.workItemId);
          const process = item ? processes.find(({ id }) => id === item.processId) : null;
          const plan = process?.stages.find(({ name }) => name === GOALS_STAGES[0]);
          const waiting = process?.stages.find(({ name }) => name === GOALS_STAGES[2]);
          if (!item || !plan || !waiting) throw new Error("The Goals process definition has changed");
          const tasks = parseTaskPlan(
            await workspaces.readOutput(
              execution.workspaceRef,
              output.logicalOutput,
              mapping.localPath
            )
          );
          await repository.approveTaskPlan(output.id, item.id, plan.id, waiting.id, tasks);
          await syncCheckpoint(item.id);
          await finishOutputReview(execution);
          showNotice(`${tasks.length} task${tasks.length === 1 ? "" : "s"} approved and queued`, "success");
          return;
        } finally {
          // Reconcile controls with the database even if shared coordination fails afterward.
          await refresh();
        }
      }
      const data = await edit("Approve file change", [
        { name: "destination", label: "Team-folder destination", value: output.logicalDestination }
      ], "Approve");
      if (!data) return;
      const destination = String(data.get("destination") ?? "");
      await enforceControl(
        controlInput(
          "output.publish",
          { type: "execution_output", id: output.id, attributes: { destination: "team-folder" } },
          { agentId: execution.agentId }
        ),
        true
      );
      await workspaces.publishApproved(
        execution.workspaceRef,
        output.logicalOutput,
        mapping.localPath,
        destination
      );
      await repository.decideExecutionOutput(output.id, "approved", destination);
      await finishOutputReview(execution);
      await refresh();
      showNotice("File approved and copied to the team folder", "success");
      return;
    }
    if (action === "reject-output") {
      const output = executionOutputs.find(({ id }) => id === button.dataset.id);
      const execution = output ? await repository.getExecution(output.executionId) : null;
      if (!output || !execution) return;
      // The reason is the only instruction the retry gets, so ask for it here rather than
      // leaving the agent to guess what was wrong with the same task it just did.
      const data = await edit(
        output.logicalOutput === TASK_PLAN_OUTPUT ? "Reject task plan" : "Reject file change",
        [
          {
            name: "reason",
            label: "What should be different next time?",
            type: "textarea",
            placeholder: "Too long, wrong tone, missing the pricing section…"
          },
          {
            name: "scope",
            label: "Apply to",
            type: "toggle",
            value: "item",
            options: [
              { label: "This item", value: "item" },
              { label: "Future items too", value: "future" }
            ]
          }
        ],
        "Reject"
      );
      if (!data) return;
      const reason = String(data.get("reason") ?? "");
      const item = teamItems.find(({ id }) => id === execution.workItemId);
      if (data.get("scope") === "future" && !reason.trim()) {
        throw new Error("Add a reason before saving feedback for future items");
      }
      await repository.decideExecutionOutput(
        output.id,
        "rejected",
        undefined,
        reason
      );
      const undo = data.get("scope") === "future" && item && !isProposal(execution)
        ? await rememberRejection(item, reason)
        : undefined;
      await finishOutputReview(execution);
      await refresh();
      showNotice(
        undo
          ? "Rejected — feedback saved for future items"
          : output.logicalOutput === TASK_PLAN_OUTPUT
            ? "Task plan rejected — the planner will try again"
            : "File change rejected — the agent will try again",
        "success",
        undo
      );
      if (!undo && item && !isProposal(execution)) {
        void proposeSkillEdit(item).catch((error) =>
          showNotice(errorText(error), "error")
        );
      }
      return;
    }
    if (action === "download-receipt") {
      const execution = await repository.getExecution(button.dataset.id!);
      const item = execution ? await repository.getWorkItem(execution.workItemId) : null;
      if (!execution || !item) throw new Error("Run receipt is unavailable");
      const contents = runReceipt(
        execution,
        item,
        agents.find(({ id }) => id === execution.agentId) ?? null,
        await repository.listExecutionOutputs(execution.id)
      );
      const url = URL.createObjectURL(new Blob([contents], { type: "text/markdown" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `bees-run-${execution.id}.md`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }
    if (action === "new-schedule") {
      if (!teamItems.length) throw new Error("Create a work item before adding a schedule");
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const data = await edit("New schedule", [
        { name: "name", label: "Name", value: "Scheduled work" },
        {
          name: "workItemId",
          label: "Work item",
          type: "select",
          options: teamItems.map(({ id, title }) => ({ label: title, value: id }))
        },
        {
          name: "recurrence",
          label: "Recurrence",
          type: "select",
          value: "daily",
          options: ["hourly", "daily", "weekdays"].map((value) => ({ label: value, value }))
        },
        { name: "timezone", label: "Timezone", value: timezone }
      ]);
      if (!data) return;
      const recurrence = String(data.get("recurrence")) as Schedule["recurrence"];
      await repository.createSchedule({
        teamId: workspace.teamId,
        workItemId: String(data.get("workItemId")),
        name: String(data.get("name")),
        recurrence,
        timezone: String(data.get("timezone")),
        nextRunAt: nextScheduleRun(recurrence, new Date()).toISOString()
      });
      await refresh();
      return;
    }
    if (action === "run-schedule") {
      const schedule = schedules.find(({ id }) => id === button.dataset.id);
      if (schedule) await runItem(schedule.workItemId, false, undefined, undefined, true);
      return;
    }
    if (action === "toggle-schedule") {
      const schedule = schedules.find(({ id }) => id === button.dataset.id);
      if (schedule) {
        await repository.setScheduleEnabled(schedule.id, !schedule.enabled);
        await refresh();
      }
      return;
    }
    if (action === "delete-schedule") {
      await repository.deleteSchedule(button.dataset.id!);
      await refresh();
      return;
    }
    if (action === "switch-org") {
      await switchConnection(button.dataset.id!, button.dataset.account ?? "");
      return;
    }
    if (action === "toggle-color-mode") {
      await saveTheme(DARK_THEMES.has(themePreset) ? lightDefaultTheme : darkDefaultTheme);
      render();
      return;
    }
    if (action === "exit-app") {
      await getCurrentWindow().close();
      return;
    }
    if (action === "sign-in" || action === "signin-email" || action === "signup-email" || action === "social-signin") {
      const result =
        action === "signup-email"
          ? await signUpUser()
          : action === "social-signin"
            ? await socialSignInUser(button.dataset.provider ?? "google")
            : await signInUser();
      if (result) {
        // Pool every account. Connect it to the current org only if that connected org has none.
        await rememberAccount(result.user, result.token);
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
      return;
    }
    if (action === "accept-invite") {
      // Accept as the account the invite was sent to (any pooled account, not just the current org's).
      const account = accounts.get(button.dataset.account!);
      if (!account) return;
      const { membership } = await api.acceptMyInvitation(account.token, button.dataset.id!);
      await connect(membership.organizationId, account.user, account.token);
      await switchConnection(membership.organizationId, account.user.id);
      showNotice("Joined organization", "success");
      return;
    }
    if (action === "login-org") {
      // The row already names the account — connect it straight away, no "which account?" prompt.
      const account = accounts.get(button.dataset.account!);
      if (!account) return;
      await connect(button.dataset.id!, account.user, account.token);
      await switchConnection(button.dataset.id!, account.user.id);
      showNotice(`Signed in as ${account.user.email}`, "success");
      return;
    }
    if (action === "logout-org") {
      await disconnect(button.dataset.id!, button.dataset.account!);
      return;
    }
    if (action === "invite-org-member") {
      const data = await edit("Invite to organization", [
        { name: "email", label: "Email", placeholder: "teammate@example.com" },
        {
          name: "role",
          label: "Role",
          type: "select",
          value: "member",
          options: [
            { label: "Member", value: "member" },
            { label: "Admin", value: "admin" }
          ]
        }
      ]);
      if (data) {
        const token = orgToken();
        if (!token) throw new Error("Sign in to this organization first");
        await api.createOrgInvitation(
          token,
          workspace.organizationId,
          String(data.get("email") ?? ""),
          String(data.get("role") ?? "member") as "admin" | "member"
        );
        showNotice("Invitation sent", "success");
      }
      return;
    }
    if (action === "create-local-org") {
      await createLocalOrg();
      return;
    }
    if (action === "create-connected-org") {
      await createConnectedOrg();
      return;
    }
    if (action === "rename-org") {
      const org = currentOrganization();
      if (!org) return;
      const data = await edit("Rename organization", [
        { name: "name", label: "Organization name", value: org.name }
      ]);
      const name = String(data?.get("name") ?? "").trim();
      if (!name) return;
      const renameToken = orgToken();
      if (orgIsConnected() && renameToken) await api.renameOrganization(renameToken, org.id, name);
      await repository.renameOrganization(org.id, name);
      await reconcileServerOrgs().catch(() => {});
      await refresh();
      showNotice("Organization renamed", "success");
      return;
    }
    if (action === "connect-ai") {
      await connectAiProvider(button.dataset.provider as AiProvider);
      return;
    }
    if (action === "remove-ai-connection") {
      const connection = (await listAiConnections(repository, aiConnectionScope())).find(
        ({ id }) => id === button.dataset.id
      );
      const warning = connection
        ? await invoke<string | null>("delete_connection_secret", { secretRef: connection.secretRef })
        : null;
      await removeAiConnection(repository, aiConnectionScope(), button.dataset.id!);
      await refreshAssistantCatalog();
      await refresh();
      showNotice(warning ?? "Connection removed", warning ? "error" : "success");
      return;
    }
    if (action === "add-mcp-api") {
      await addApiKeyMcp();
      return;
    }
    if (action === "add-mcp-oauth") {
      await addOAuthMcp();
      return;
    }
    if (action === "test-mcp") {
      const connection = mcpConnections.find(({ id }) => id === button.dataset.id);
      if (!connection) return;
      await discoverMcpConnection(connection);
      await refresh();
      showNotice("MCP connection is healthy", "success");
      return;
    }
    if (action === "remove-mcp") {
      const connection = mcpConnections.find(({ id }) => id === button.dataset.id);
      if (!connection) return;
      const warning = await invoke<string | null>("delete_connection_secret", {
        secretRef: connection.secretRef
      });
      await removeMcpConnection(repository, workspace.teamId, connection.id);
      await refresh();
      showNotice(warning ?? "MCP connection removed", warning ? "error" : "success");
      return;
    }
    if (action === "browse-local-model") {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Model", extensions: ["gguf"] }]
      });
      const field = document.querySelector<HTMLInputElement>("[data-local-model-source]");
      if (typeof selected === "string" && field) field.value = selected;
      return;
    }
    if (action === "add-local-model") {
      const field = document.querySelector<HTMLInputElement>("[data-local-model-source]");
      await localModels.add(field?.value ?? "");
      await refresh();
      return;
    }
    if (action === "delete-local-model") {
      const model = (await localModels.list()).find(({ id }) => id === button.dataset.model);
      if (!model) return;
      const kept = model.localPath ? " Your own copy of the file stays where it is." : "";
      if (!(await edit(`Delete "${model.name}"?`, [], "Delete"))) return;
      const wasRunning = await localModels.remove(model.id);
      if (wasRunning) await flueProjectPort.restart();
      localModelProgress.delete(model.id);
      await refreshAssistantCatalog();
      await refresh();
      showNotice(`Deleted ${model.name}.${kept}`, "success");
      return;
    }
    if (action === "open-external") {
      await openUrl(button.dataset.url!);
      return;
    }
    if (action === "remove-logo") {
      const org = currentOrganization();
      if (!org) return;
      const next = brandingFor(org.id);
      delete orgBranding[org.id];
      if (next.color) orgBranding[org.id] = { color: next.color };
      await saveBranding();
      await refresh();
      return;
    }
    if (action === "delete-org") {
      const org = currentOrganization();
      if (!org) return;
      const data = await edit(
        `Delete "${org.name}"?`,
        [{ name: "confirm", label: "Type the organization name to confirm", placeholder: org.name }],
        "Delete"
      );
      if (!data) return;
      if (String(data.get("confirm") ?? "").trim() !== org.name) {
        showNotice("Name did not match — not deleted", "error");
        return;
      }
      const deleteToken = orgToken();
      if (orgIsConnected() && deleteToken) await api.deleteOrganization(deleteToken, org.id);
      for (const key of [...connections]) {
        if (connParts(key).orgId === org.id) connections.delete(key);
      }
      connectedOrgs.delete(org.id);
      await persistConnections();
      await repository.setSetting("connected_org_ids", JSON.stringify([...connectedOrgs]));
      await repository.deleteOrganization(org.id);
      const remaining = (await repository.listOrganizations()).filter(({ id }) => id !== org.id);
      if (remaining[0]) {
        await switchOrganization(remaining[0].id);
      } else {
        workspace.organizationId = "";
        activeUserId = "";
        view = "preferences";
        prefsTab = "orgs";
        await refresh();
      }
      showNotice("Organization deleted", "success");
      return;
    }
    if (action === "delete-team") {
      const team = currentTeam();
      if (!team) return;
      const data = await edit(
        `Delete "${team.name}"?`,
        [{ name: "confirm", label: "Type the team name to confirm", placeholder: team.name }],
        "Delete"
      );
      if (!data) return;
      if (String(data.get("confirm") ?? "").trim() !== team.name) {
        showNotice("Name did not match — not deleted", "error");
        return;
      }
      await repository.deleteTeam(team.id);
      const remaining = (await repository.listTeams(workspace.organizationId)).filter(
        ({ id }) => id !== team.id
      );
      if (remaining[0]) {
        await switchTeam(remaining[0].id, "overview");
      } else {
        workspace.teamId = "";
        view = "preferences";
        await refresh();
      }
      showNotice("Team deleted", "success");
      return;
    }
    if (action === "sign-out") {
      await disconnect(workspace.organizationId, activeUserId);
      return;
    }
    if (action === "sign-out-account") {
      await signOutAccount(button.dataset.id!);
      return;
    }
    if (action === "start-team-trial") {
      const token = orgToken();
      if (!token) throw new Error("Sign in to this organization first");
      await api.startTeamTrial(token, workspace.organizationId);
      await reconcileServerOrgs();
      view = "settings";
      teamTab = "members";
      await refresh();
      showNotice("Trial running for 30 days", "success");
      return;
    }
    if (action === "new-server-team") {
      const data = await edit("New team", [{ name: "name", label: "Team name" }]);
      if (data) {
        const name = String(data.get("name") ?? "");
        const serverTeamId = await createServerTeam(name);
        if (!serverTeamId) return;
        // Mirror it locally under the server id; this used to create the team on the server only,
        // leaving it invisible in the nav until some other code path happened to pull it.
        await repository.createTeam(workspace.organizationId, name, serverTeamId);
        await ensureOrgFolders();
        await refresh();
      }
      return;
    }
    if (action === "invite-team-member") {
      const data = await edit("Invite to team", [
        { name: "email", label: "Email", placeholder: "teammate@example.com" },
        {
          name: "role",
          label: "Role",
          type: "select",
          value: "member",
          options: [
            { label: "Member", value: "member" },
            { label: "Admin", value: "admin" }
          ]
        }
      ]);
      if (data) {
        const token = orgToken();
        if (!token) throw new Error("Sign in to this organization first");
        const { invitation } = await api.createTeamInvitation(
          token,
          workspace.organizationId,
          button.dataset.team!,
          String(data.get("email") ?? ""),
          String(data.get("role") ?? "member") as "admin" | "member"
        );
        showNotice(`Invite created. Share this token: ${invitation.token}`, "success");
      }
      return;
    }
    if (action === "remove-org-member") {
      const token = orgToken();
      if (!token) throw new Error("Sign in to this organization first");
      const confirmed = await edit(`Remove ${button.dataset.email} from the organization?`, [], "Remove");
      if (!confirmed) return;
      await api.removeMember(token, workspace.organizationId, button.dataset.user!);
      showNotice("Member removed", "success");
      render();
      return;
    }
    if (action === "promote-team-member") {
      const token = orgToken();
      if (!token) throw new Error("Sign in to this organization first");
      await api.setTeamMemberRole(
        token,
        workspace.organizationId,
        button.dataset.team!,
        button.dataset.user!,
        "admin"
      );
      render();
      return;
    }
    if (action === "set-theme-preset" && isThemePreset(button.dataset.themePreset)) {
      await saveTheme(button.dataset.themePreset);
      render();
      return;
    }
    if (action === "toggle-team") {
      const id = button.dataset.id!;
      if (!expandedTeams.delete(id)) expandedTeams.add(id);
      renderNavigation();
      return;
    }
    if (action === "new-organization") {
      view = "preferences";
      prefsTab = "orgs";
      render();
      return;
    }
    if (action === "new-team") {
      if (!workspace.organizationId) return; // no org to attach the team to
      const data = await edit("New team", [{ name: "name", label: "Team name" }]);
      if (data) {
        const name = String(data.get("name") ?? "");
        // Connected orgs are billed per team, so the server owns the count — register there first,
        // then reuse the id it assigned so other desktops resolve the same team.
        let serverTeamId: string | undefined;
        if (orgIsConnected()) {
          serverTeamId = (await createServerTeam(name)) ?? undefined;
          if (!serverTeamId) return;
        }
        const teamId = await repository.createTeam(workspace.organizationId, name, serverTeamId);
        await ensureOrgFolders();
        await switchTeam(teamId);
      }
    }
    if (action === "edit-board") {
      const board = boards.find(({ id }) => id === button.dataset.id);
      if (board) await editDashboard(board);
    }
    if (action === "move-item") {
      await repository.moveWorkItem(button.dataset.id!, button.dataset.stage!);
      await refresh();
    }
    if (action === "new-item-in-stage") await createItem(button.dataset.stage);
    if (action === "edit-item") {
      const item = items.find(({ id }) => id === button.dataset.id)!;
      const locations = await repository.listAvailableFileLocations(workspace.teamId);
      const data = await edit("Edit work item", [
        { name: "title", label: "Title", value: item.title },
        { name: "description", label: "Description", type: "textarea", value: item.description },
        { name: "owner", label: "Owner", value: item.owner ?? "" },
        {
          name: "status",
          label: "Item state",
          type: "toggle",
          value: item.status,
          options: ["open", "blocked", "done", "archived"].map((value) => ({
            label: value[0]!.toUpperCase() + value.slice(1),
            value
          }))
        },
        {
          name: "files",
          label: "File references",
          value: displayFileReferences(item.logicalFiles, locations).join(", "),
          hint: fileReferenceHint(locations)
        }
      ]);
      if (data) {
        await repository.updateWorkItem(item.id, {
          title: String(data.get("title") ?? ""),
          description: String(data.get("description") ?? ""),
          owner: String(data.get("owner") ?? ""),
          status: String(data.get("status") ?? "") as WorkItem["status"],
          logicalFiles: parseFileReferencesInput(String(data.get("files") ?? ""), locations)
        });
        await refresh();
      }
    }
    if (action === "start-process") await setProcessRunning(button.dataset.id!, true);
    if (action === "stop-process") await setProcessRunning(button.dataset.id!, false);
    if (action === "browse-process-library") {
      await refreshAssistantCatalog();
      processesPage = "library";
      render();
      return;
    }
    if (action === "close-process-library") {
      processesPage = "team";
      render();
      return;
    }
    if (action === "add-library-process") {
      await addLibraryProcess(button.dataset.template ?? "");
      return;
    }
    if (action === "new-process") {
      const data = await edit("New process", [
        { name: "name", label: "Name" },
        { name: "description", label: "Description", type: "textarea" },
        { name: "stages", label: "Ordered statuses", value: "To do, In progress, Done" }
      ]);
      if (data) {
        const processId = await repository.createProcess(workspace.teamId, {
          name: String(data.get("name") ?? ""),
          description: String(data.get("description") ?? ""),
          stages: String(data.get("stages") ?? "").split(",")
        });
        activeProcess = (await repository.listProcesses(workspace.teamId)).find(({ id }) => id === processId) ?? null;
        processesPage = "team";
        await refresh();
      }
    }
    if (action === "edit-process") {
      const process = processes.find(({ id }) => id === button.dataset.id)!;
      const data = await edit("Edit process", [
        { name: "name", label: "Name", value: process.name },
        { name: "description", label: "Description", type: "textarea", value: process.description },
        { name: "stages", label: "Ordered statuses", value: process.stages.map(({ name }) => name).join(", ") }
      ]);
      if (data) {
        await repository.updateProcessDefinition(process.id, {
          name: String(data.get("name") ?? ""),
          description: String(data.get("description") ?? ""),
          stages: String(data.get("stages") ?? "").split(",")
        });
        await refresh();
      }
    }
    if (action === "archive-process") {
      await repository.archiveProcess(button.dataset.id!);
      await refresh();
    }
    if (action === "restore-process") {
      await repository.restoreProcess(button.dataset.id!);
      await refresh();
    }
    if (action === "new-agent") {
      const data = await edit("New agent", agentEditorFields());
      if (data) {
        await saveAgent(newAgent(), data);
        await refresh();
      }
    }
    if (action === "edit-agent") {
      const agent = agents.find(({ id }) => id === button.dataset.id)!;
      const data = await edit("Edit agent", agentEditorFields(agent));
      if (data) {
        await saveAgent(agent, data);
        await refresh();
      }
    }
    if (action === "toggle-agent-machine") {
      const agent = agents.find(({ id }) => id === button.dataset.id);
      if (agent) await setAgentEnabledOnMachine(agent, disabledAgentIds.has(agent.id));
      return;
    }
    if (action === "duplicate-agent") {
      const agent = agents.find(({ id }) => id === button.dataset.id)!;
      // No trigger status on the copy: two agents on one status is the one thing that
      // would make a run ambiguous, and the point of a copy is to edit it first.
      const copy = newAgent({ ...agent, name: `${agent.name} copy`, triggerStageId: null });
      await writeAgent(copy);
      await refresh();
      showNotice(`Created ${copy.name}`, "success");
      return;
    }
    if (action === "delete-agent") {
      const agent = agents.find(({ id }) => id === button.dataset.id)!;
      if (!confirm(`Delete ${agent.name}? This removes its file from the team folder.`)) return;
      await agentFiles.remove(await requireTeamRoot(), agent.id);
      if (disabledAgentIds.delete(agent.id)) {
        await repository.setSetting(`disabled_agents:${workspace.teamId}`, [...disabledAgentIds]);
      }
      if (activeAgentId === agent.id) view = "agents";
      await refresh();
      showNotice(`Deleted ${agent.name}`, "success");
      return;
    }
    if (action === "add-org-location" || action === "add-team-location") {
      const selected = await open({ directory: true, multiple: false, recursive: true });
      if (typeof selected !== "string") return;
      const validated = await workspaces.validateDirectory(selected);
      const data = await edit("Add linked file location", [
        {
          name: "name",
          label: "Location name",
          value: selected.split(/[\\/]/).filter(Boolean).at(-1) ?? "Shared files",
          hint: action === "add-org-location"
            ? "Available to every team in this organization."
            : "Available only to this team."
        }
      ], "Add");
      if (!data) return;
      await repository.createFileLocation({
        organizationId: workspace.organizationId,
        teamId: action === "add-team-location" ? workspace.teamId : null,
        name: String(data.get("name") ?? ""),
        localPath: validated
      });
      await refresh();
      showNotice("Linked location added. File contents remain in the selected folder.", "success");
      return;
    }
    if (action === "map-file-location") {
      const selected = await open({ directory: true, multiple: false, recursive: true });
      if (typeof selected === "string") {
        await repository.setFileLocationMapping(
          button.dataset.id!,
          await workspaces.validateDirectory(selected)
        );
        await refresh();
      }
      return;
    }
    if (action === "remove-file-location") {
      if (
        !confirm(
          `Remove the linked location "${button.dataset.name}"? Files in the folder will not be deleted.`
        )
      ) return;
      await repository.deleteFileLocation(button.dataset.id!);
      await refresh();
      showNotice("Linked location removed. Files on disk were not changed.", "success");
      return;
    }
    if (action === "pick-global-folder" || action === "pick-folder") {
      const selected = await open({ directory: true, multiple: false, recursive: true });
      if (typeof selected === "string") {
        const validated = await workspaces.validateDirectory(selected);
        if (action === "pick-global-folder") {
          await repository.setSetting("global_local_path", validated);
          await ensureOrgFolders();
        } else {
          await repository.setTeamFolder(workspace.teamId, validated);
        }
        render();
      }
    }
    if (action === "new-skill") {
      const teamRoot = await requireTeamRoot();
      const data = await edit(
        "New skill",
        [
          { name: "name", label: "Name", placeholder: "Brand voice" },
          {
            name: "description",
            label: "When should an agent use it?",
            placeholder: "How this team writes public copy."
          },
          {
            name: "body",
            label: "The procedure",
            type: "textarea",
            placeholder: "Keep posts under 20 words. Never open with a question."
          }
        ],
        "Create"
      );
      if (!data) return;
      const path = await agentFiles.saveSkill(
        teamRoot,
        String(data.get("name") ?? ""),
        String(data.get("description") ?? ""),
        String(data.get("body") ?? "")
      );
      await ensureTeamSkillsRegistry(teamRoot);
      await refresh();
      showNotice(`Skill written to ${path}`, "success");
      return;
    }
    if (action === "add-registry") {
      const selected = await open({ directory: true, multiple: false, recursive: true });
      if (typeof selected !== "string") return;
      const data = await edit("Add skills and tools folder", [
        {
          name: "name",
          label: "Folder name",
          value: selected.split(/[\\/]/).filter(Boolean).at(-1) ?? "Skills and tools"
        }
      ], "Copy");
      if (!data) return;
      const id = crypto.randomUUID();
      const files = await registryFiles.copy(id, selected);
      await repository.saveRegistry({
        id,
        teamId: workspace.teamId,
        name: String(data.get("name") ?? ""),
        sourcePath: selected,
        files
      });
      await refresh();
      showNotice(`Copied ${files.length} file(s)`, "success");
      return;
    }
    if (action === "connect-site") {
      const mapping = await repository.getResolvedTeamFolder(workspace.teamId);
      if (!mapping?.localPath) {
        showNotice("Set a team folder first — it keys this team's browser profile.", "error");
        return;
      }
      const { baseUrl, token } = await ensureFlueRuntime();
      const response = await fetch(`${baseUrl}/browser/open`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ profileKey: mapping.localPath, url: "about:blank" })
      });
      if (!response.ok) {
        showNotice(`Could not open browser: ${await response.text()}`, "error");
        return;
      }
      showNotice("Chrome opened. Log in, then close the window — the session is saved.", "success");
      return;
    }
    if (action === "refresh-registry") {
      const registry = registries.find(({ id }) => id === button.dataset.id);
      if (!registry) return;
      const files = registry.sourcePath.startsWith("bundled://")
        ? await registryFiles.copyBundled(registry.id)
        : await registryFiles.copy(registry.id, registry.sourcePath);
      await repository.saveRegistry({ ...registry, files });
      await refresh();
      showNotice("Skills and tools refreshed from disk", "success");
      return;
    }
    if (action === "remove-registry") {
      const registry = registries.find(({ id }) => id === button.dataset.id);
      if (!registry) return;
      await registryFiles.remove(registry.id);
      await repository.removeRegistry(registry.id);
      await refresh();
      return;
    }
    if (action === "use-default-folder") {
      await repository.clearTeamFolder(workspace.teamId);
      render();
    }
  } catch (error) {
    showNotice(errorText(error), "error");
  }
});

app.addEventListener("submit", (event) => {
  const assistant = (event.target as Element).closest<HTMLFormElement>(
    "form[data-overview-assistant]"
  );
  if (assistant) {
    event.preventDefault();
    const data = new FormData(assistant);
    const message = String(data.get("message") ?? "").trim();
    const submit = assistant.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!message || submit?.disabled) return;
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Going…";
    }
    const projectId = String(data.get("project") ?? "") || workspace.organizationId;
    const requestedTeamId = String(data.get("team") ?? "");
    const modelIndex = Number(data.get("model") ?? 0);
    const choice = overviewAssistantModels()[modelIndex]?.choice ?? assistantModel;
    void (async () => {
      const projectTeams = await repository.listTeams(projectId);
      const targetTeam =
        projectTeams.find(({ id }) => id === requestedTeamId) ??
        (projectId === workspace.organizationId
          ? projectTeams.find(({ id }) => id === workspace.teamId)
          : undefined) ??
        projectTeams[0];
      if (!targetTeam) throw new Error("The selected project has no team for the assistant");
      if (projectId !== workspace.organizationId) await switchOrganization(projectId);
      if (targetTeam.id !== workspace.teamId) await switchTeam(targetTeam.id, "overview");
      await pickAssistantModel(choice);
      await toggleAssistant(true);
      await sendAssistantMessage(message);
    })().catch((error) => {
      if (submit?.isConnected) {
        submit.disabled = false;
        submit.textContent = "Go";
      }
      showNotice(errorText(error), "error");
    });
    return;
  }
  const search = (event.target as Element).closest<HTMLFormElement>("form[data-run-search]");
  if (search) {
    event.preventDefault();
    searchQuery = String(new FormData(search).get("query") ?? "");
    void (async () => {
      searchHits = searchQuery.trim()
        ? await repository.search(workspace.teamId, searchQuery)
        : [];
      render();
    })().catch((error) => showNotice(errorText(error), "error"));
    return;
  }
  const form = (event.target as Element).closest<HTMLFormElement>("form[data-run-followup]");
  if (!form) return;
  event.preventDefault();
  const message = String(new FormData(form).get("message") ?? "").trim();
  const executionId = form.dataset.runFollowup;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!message || !executionId || submit?.disabled) return;
  if (submit) submit.disabled = true;
  void (async () => {
    const execution =
      executions.find(({ id }) => id === executionId) ??
      (await repository.getExecution(executionId));
    if (!execution) throw new Error("Run not found");
    await runItem(execution.workItemId, false, { execution, message });
  })().catch((error) => {
    if (submit) submit.disabled = false;
    showNotice(errorText(error), "error");
  });
});

app.addEventListener("keydown", (event) => {
  const input = (event.target as Element).closest<HTMLTextAreaElement>(
    "form[data-run-followup] textarea, form[data-overview-assistant] textarea"
  );
  if (!input || event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  input.form?.requestSubmit();
});

// Inline org branding controls save on change (no popup).
document.addEventListener("change", (event) => {
  const themeDefault = (event.target as Element).closest<HTMLSelectElement>("[data-theme-default]");
  if (themeDefault && isThemePreset(themeDefault.value)) {
    const mode = themeDefault.dataset.themeDefault;
    if (mode === "light" || mode === "dark") {
      void saveDefaultTheme(mode, themeDefault.value).catch((error) =>
        showNotice(errorText(error), "error")
      );
    }
    return;
  }
  const project = (event.target as Element).closest<HTMLSelectElement>(
    "[data-overview-project]"
  );
  if (project) {
    const projectId = project.value || workspace.organizationId;
    const team = project.form?.querySelector<HTMLSelectElement>("[data-overview-team]");
    if (!team) return;
    team.disabled = true;
    void repository
      .listTeams(projectId)
      .then((projectTeams) => {
        if (!team.isConnected || (project.value || workspace.organizationId) !== projectId) return;
        const currentTeamId = projectId === workspace.organizationId ? workspace.teamId : "";
        const current = projectTeams.find(({ id }) => id === currentTeamId);
        const fallback = projectTeams[0];
        team.innerHTML = [
          `<option value="">${escapeHtml(
            current
              ? `Current team: ${current.name}`
              : fallback
                ? `Team (optional; defaults to ${fallback.name})`
                : "No teams available"
          )}</option>`,
          ...projectTeams
            .filter(({ id }) => id !== currentTeamId)
            .map(({ id, name }) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`)
        ].join("");
        team.disabled = projectTeams.length === 0;
      })
      .catch((error) => showNotice(errorText(error), "error"));
    return;
  }
  const assistantModelSelect = (event.target as Element).closest<HTMLSelectElement>(
    "[data-overview-model]"
  );
  if (assistantModelSelect) {
    const choice = overviewAssistantModels()[Number(assistantModelSelect.value)]?.choice;
    if (choice) {
      void pickAssistantModel(choice).catch((error) =>
        showNotice(errorText(error), "error")
      );
    }
    return;
  }
  const contextInput = (event.target as Element).closest<HTMLInputElement>("[data-model-context]");
  if (contextInput) {
    const modelId = contextInput.dataset.modelContext!;
    const entered = contextInput.value.trim();
    const tokens = Number(entered);
    // Empty clears the pin and hands sizing back to Bees. Anything else has to be a window a
    // turn can actually happen in — a typo here becomes a server that will not boot.
    if (entered && (!Number.isSafeInteger(tokens) || tokens < 4096)) {
      showNotice("Context window must be a whole number of at least 4096 tokens", "error");
      void refreshLocalModelRows();
      return;
    }
    void (async () => {
      try {
        await localModels.setContextSize(modelId, entered ? tokens : null);
        // The window is allocated when llama-server boots, so a running model keeps the one
        // it started with until it is restarted.
        showNotice(
          (await localModels.list()).some(({ id, runtime }) => id === modelId && runtime.running)
            ? "Saved. Restart this model to apply the new context window."
            : "Saved.",
          "success"
        );
        await refreshLocalModelRows();
      } catch (error) {
        showNotice(errorText(error), "error");
      }
    })();
    return;
  }
  const toggle = (event.target as Element).closest<HTMLInputElement>("[data-model-toggle]");
  if (toggle) {
    const modelId = toggle.dataset.model!;
    localModelProgress.delete(modelId);
    if (toggle.dataset.modelToggle === "download") {
      // Off on a downloaded model deletes the file; off mid-download only cancels it, so the
      // partial file stays and a later Download resumes from where it stopped.
      if (toggle.checked) void downloadLocalModel(modelId).then(refreshLocalModelRows);
      else if (toggle.dataset.modelDownloaded) removeLocalModelFile(modelId);
      else stopLocalModel(modelId);
    } else if (toggle.checked) {
      void rememberModelChoice({
        provider: LOCAL_PROVIDER,
        model: modelId,
        localModelId: modelId
      }).catch((error) => showNotice(errorText(error), "error"));
      runLocalModel(modelId);
    } else {
      // Drops a start still waiting on its download without cancelling that download — the
      // Download toggle owns it. Otherwise this stops the model that is serving.
      localModelStarting.delete(modelId);
      if (localModels.wantedRunId === modelId) {
        void localModels.wantRun(null).then(refreshLocalModelRows);
      }
      if (!localModelDownloads.has(modelId)) stopLocalModel(modelId);
    }
    void refreshLocalModelRows();
    return;
  }
  const input = (event.target as Element).closest<HTMLInputElement>("[data-branding]");
  if (!input) return;
  const org = currentOrganization();
  if (!org) return;
  void (async () => {
    try {
      if (input.dataset.branding === "color") {
        await setBrandingValue(org.id, { color: input.value });
      } else if (input.dataset.branding === "logo") {
        const file = input.files?.[0];
        if (!file) return;
        await setBrandingValue(org.id, { logo: await readFileAsDataUrl(file) });
      }
      await refresh();
    } catch (error) {
      showNotice(errorText(error), "error");
    }
  })();
});

newItem.addEventListener("click", () =>
  void createItem().catch((error) => showNotice(errorText(error), "error"))
);

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
    detectCliTools().catch(() => ({} as Record<string, string>))
  ]);
  assistantCatalog = modelCatalog({
    local,
    connections: aiConnections,
    cliInstalled,
    extras: assistantExtraModels
  });
  machineModelAvailability = {
    localModelIds: local
      .filter(({ runtime }) => ["ready", "running"].includes(runtime.state))
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

function assistantActionsHtml(actions: ResolvedAction[], index: number, applied: boolean): string {
  const cards = actions
    .map((entry) => {
      const titles = entry.items.slice(0, 5).map(({ title }) => escapeHtml(title));
      const more = entry.items.length > titles.length ? `, +${entry.items.length - titles.length} more` : "";
      return `<li class="border-t border-base-300 px-3 py-2 first:border-t-0">
        <p class="text-sm ${entry.error ? "text-base-content/50 line-through" : ""}">${escapeHtml(entry.summary)}</p>
        ${entry.error ? `<p class="mt-1 text-xs text-error">${escapeHtml(entry.error)}</p>` : ""}
        ${titles.length ? `<p class="mt-1 text-xs text-base-content/55">${titles.join(", ")}${more}</p>` : ""}
      </li>`;
    })
    .join("");
  const ready = applicable(actions).length;
  return `<div class="mt-2 overflow-hidden rounded-box border border-base-300">
    <ul>${cards}</ul>
    <div class="border-t border-base-300 bg-base-200/60 px-3 py-2">${
      applied
        ? '<span class="text-xs font-semibold text-success">Applied</span>'
        : ready
          ? `<button class="btn btn-primary btn-xs" data-assistant="apply" data-index="${index}">Apply ${ready} change${ready === 1 ? "" : "s"}</button>`
          : '<span class="text-xs text-base-content/50">Nothing here can be applied.</span>'
    }</div>
  </div>`;
}

function assistantModelHtml(): string {
  const current = escapeHtml(modelLabel(assistantModel, assistantCatalog));
  if (!assistantPickerOpen) {
    return `<button type="button" class="btn btn-ghost btn-xs max-w-full justify-start font-normal" data-assistant="picker">
      <span class="truncate text-base-content/60">Model: ${current}</span>
    </button>`;
  }
  const groups = [...new Set(assistantCatalog.map(({ group }) => group))];
  const rows = groups
    .map((group) => {
      const entries = assistantCatalog
        .map((option, index) => ({ option, index }))
        .filter(({ option }) => option.group === group)
        .map(
          ({ option, index }) => `<li>
            <button type="button" class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-base-200" data-assistant="pick" data-index="${index}">
              <span class="w-3">${sameChoice(option.choice, assistantModel) ? "●" : ""}</span>
              <span class="flex-1 truncate">${escapeHtml(option.label)}</span>
              ${option.note ? `<span class="text-[10px] text-base-content/45">${escapeHtml(option.note)}</span>` : ""}
            </button>
          </li>`
        )
        .join("");
      return `<li class="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-base-content/40">${escapeHtml(group)}</li>${entries}`;
    })
    .join("");
  return `<div class="rounded-box border border-base-300 bg-base-100 shadow-lg">
    <ul class="max-h-64 overflow-y-auto">${rows || '<li class="px-3 py-2 text-sm text-base-content/50">No models available.</li>'}</ul>
    <div class="border-t border-base-300 p-2">
      <button type="button" class="btn btn-ghost btn-xs w-full justify-start font-normal" data-assistant="add-model">+ Add a model id…</button>
    </div>
  </div>`;
}

function renderAssistant(): void {
  assistantPanel.classList.toggle("translate-x-full", !assistantOpen);
  assistantPanel.setAttribute("aria-hidden", assistantOpen ? "false" : "true");
  assistantPanel.inert = !assistantOpen;
  assistantSend.disabled = assistantBusy;
  assistantSend.textContent = assistantBusy ? "Working…" : "Send";
  assistantModelSlot.innerHTML = assistantModelHtml();
  assistantLog.innerHTML = assistantLogEntries.length
    ? assistantLogEntries
        .map((entry, index) => {
          const mine = entry.role === "you";
          return `<div class="${mine ? "text-right" : ""}">
            <div class="inline-block max-w-full rounded-box px-3 py-2 text-left text-sm ${
              mine ? "bg-primary/10" : "bg-base-200"
            }"><span class="whitespace-pre-wrap">${escapeHtml(entry.text)}</span></div>
            ${entry.actions?.length ? assistantActionsHtml(entry.actions, index, entry.applied === true) : ""}
          </div>`;
        })
        .join("")
    : `<p class="px-1 text-sm text-base-content/50">Ask for a process, an agent, or a bulk change. Nothing is written until you approve it.</p>`;
  assistantLog.scrollTop = assistantLog.scrollHeight;
}

async function sendAssistantMessage(message: string): Promise<void> {
  assistantLogEntries.push({ role: "you", text: message });
  assistantBusy = true;
  renderAssistant();
  try {
    if (assistantModel.provider === LOCAL_PROVIDER) {
      if (await localModels.requireActive(assistantModel.model)) await flueProjectPort.restart();
    }
    const { baseUrl, token } = await ensureFlueRuntime();
    const result = await new FlueRuntime(baseUrl, undefined, token).execute({
      executionId: crypto.randomUUID(),
      conversationId: assistantInstanceId(workspace.teamId, assistantModel),
      agentName: ASSISTANT_AGENT,
      prompt: turnPrompt(message, assistantContext())
    });
    const answer = String((result.output as { text?: unknown } | null)?.text ?? "");
    const turn = parseTurn(answer);
    const resolved = resolveActions(turn.actions, processes, teamItems);
    assistantLogEntries.push({
      role: "assistant",
      text: turn.reply || (resolved.length ? "Here is what I would change." : "(no answer)"),
      ...(resolved.length ? { actions: resolved } : {})
    });
  } catch (error) {
    assistantLogEntries.push({
      role: "assistant",
      text: errorText(error)
    });
  } finally {
    assistantBusy = false;
    renderAssistant();
  }
}

/**
 * Asks the curator what it would fold together. Runs on the same model the dashboard assistant
 * uses, in its own conversation, and produces a preview — never a write.
 */
async function curateSkills(): Promise<void> {
  if (curatorBusy) return;
  curatorBusy = true;
  curatorPlan = null;
  render();
  try {
    if (assistantModel.provider === LOCAL_PROVIDER) {
      if (await localModels.requireActive(assistantModel.model)) await flueProjectPort.restart();
    }
    const { baseUrl, token } = await ensureFlueRuntime();
    const result = await new FlueRuntime(baseUrl, undefined, token).execute({
      executionId: crypto.randomUUID(),
      conversationId: instanceModelId(CURATOR_AGENT, workspace.teamId, assistantModel),
      agentName: CURATOR_AGENT,
      prompt: curatorPrompt(skillReviews)
    });
    const plan = parseCuratorPlan(String((result.output as { text?: unknown } | null)?.text ?? ""));
    const actions = resolveCuratorPlan(plan.actions, registryCapabilities(registries));
    curatorPlan = actions.length
      ? { summary: plan.summary, actions }
      : { summary: plan.summary || "Nothing worth changing.", actions: [] };
  } catch (error) {
    showNotice(errorText(error), "error");
  } finally {
    curatorBusy = false;
    render();
  }
}

async function applyCuratorProposal(): Promise<void> {
  if (!curatorPlan) return;
  const teamRoot = await requireTeamRoot();
  const { applied, errors } = await applyCuratorPlan(curatorPlan.actions, {
    saveSkill: async (name, description, body) => {
      await agentFiles.saveSkill(teamRoot, name, description, body);
    },
    archiveSkill: async (slug) => {
      await agentFiles.archiveSkill(teamRoot, slug);
    }
  });
  curatorPlan = null;
  await ensureTeamSkillsRegistry(teamRoot);
  await refresh();
  if (errors.length) showNotice(errors.join("; "), "error");
  else showNotice(`Applied ${applied} change(s)`, "success");
}

async function runApprovedBeesOperation(
  goal: string
): Promise<{ message: string; steps: string[] }> {
  if (assistantModel.provider === LOCAL_PROVIDER) {
    if (await localModels.requireActive(assistantModel.model)) await flueProjectPort.restart();
  }
  const { baseUrl, token } = await ensureFlueRuntime();
  const runtime = new FlueRuntime(baseUrl, undefined, token);
  const instanceId = assistantInstanceId(workspace.teamId, assistantModel);
  const steps: string[] = [];
  let lastResult = "The user approved this operation.";

  for (let index = 0; index < 24; index += 1) {
    const result = await runtime.execute({
      executionId: crypto.randomUUID(),
      conversationId: instanceId,
      agentName: ASSISTANT_AGENT,
      prompt: [
        "Approved Bees operation. Control only the Bees application using the current semantic UI snapshot.",
        `Goal: ${goal}`,
        `Last result: ${lastResult}`,
        steps.length ? `Recent activity:\n${steps.slice(-8).join("\n")}` : "",
        snapshotBeesUi(),
        "Return exactly one command."
      ]
        .filter(Boolean)
        .join("\n\n")
    });
    const answer = String((result.output as { text?: unknown } | null)?.text ?? "");
    const command = parseBeesUiCommand(answer);
    if (!command) throw new Error("The assistant returned no valid Bees UI command");
    if (command.op === "finish") {
      return { message: command.message, steps };
    }
    try {
      lastResult = await executeBeesUiCommand(command);
    } catch (error) {
      lastResult = `Command failed: ${errorText(error)}`;
    }
    steps.push(lastResult);
  }
  throw new Error("The Bees operation exceeded 24 UI steps");
}

async function applyAssistantActions(index: number): Promise<void> {
  const entry = assistantLogEntries[index];
  if (!entry?.actions || entry.applied) return;
  assistantBusy = true;
  renderAssistant();
  const operationNotes: string[] = [];
  try {
    const { applied, errors } = await applyActions(entry.actions, {
      repository,
      teamId: workspace.teamId,
      operateBees: async (goal) => {
        const result = await runApprovedBeesOperation(goal);
        operationNotes.push(
          `${result.message}${result.steps.length ? `\n${result.steps.join("\n")}` : ""}`
        );
      },
      saveAgent: async ({ name, purpose, prompt, triggerStageId }) => {
        await writeAgent(
          newAgent({ name, purpose, triggerStageId, config: { prompt, toolRefs: [], grants: [] } })
        );
      }
    });
    entry.applied = true;
    assistantLogEntries.push({
      role: "assistant",
      text: [
        ...operationNotes,
        errors.length
          ? `Applied ${applied}. These did not go through:\n${errors.join("\n")}`
          : `Applied ${applied} change${applied === 1 ? "" : "s"}.`
      ].join("\n")
    });
    await refresh();
  } finally {
    assistantBusy = false;
    renderAssistant();
    assistantInput.focus();
  }
}

async function pickAssistantModel(choice: ModelChoice): Promise<void> {
  assistantPickerOpen = false;
  await rememberModelChoice(choice);
  renderAssistant();
  // Awaited rather than fired off: the next Send must not race this model's startup.
  if (choice.localModelId && choice.localModelId !== localModels.wantedRunId) {
    showNotice("Starting that local model…", "info");
    if (await localModels.run(choice.localModelId)) await flueProjectPort.restart();
    showNotice("Local model ready", "success");
    await refreshAssistantCatalog();
    renderAssistant();
  }
  assistantModelSlot.querySelector<HTMLButtonElement>("button")?.focus();
}

async function addAssistantModel(): Promise<void> {
  const data = await edit("Add a model", [
    {
      name: "provider",
      label: "Provider",
      type: "select",
      options: MODEL_PROVIDERS.filter(({ id }) => id !== LOCAL_PROVIDER).map(({ id, label }) => ({
        label,
        value: id
      }))
    },
    { name: "model", label: "Model id", placeholder: "gpt-5.2, anthropic/claude-opus-5, …" }
  ]);
  if (!data) return;
  const choice: ModelChoice = {
    provider: String(data.get("provider") ?? ""),
    model: String(data.get("model") ?? "").trim()
  };
  if (!choice.provider || !choice.model) throw new Error("Pick a provider and enter a model id");
  assistantExtraModels = [
    ...assistantExtraModels.filter((entry) => !sameChoice(entry, choice)),
    choice
  ];
  await repository.setSetting(ASSISTANT_EXTRA_MODELS_KEY, assistantExtraModels);
  await refreshAssistantCatalog();
  await pickAssistantModel(choice);
}

async function toggleAssistant(open: boolean): Promise<void> {
  assistantOpen = open;
  assistantPickerOpen = false;
  renderAssistant();
  if (open) {
    await refreshAssistantCatalog();
    renderAssistant();
    assistantInput.focus();
  } else {
    assistantToggle.focus();
  }
}

assistantToggle.addEventListener("click", () => {
  void toggleAssistant(!assistantOpen).catch((error) =>
    showNotice(errorText(error), "error")
  );
});

assistantPanel.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-assistant]");
  if (!button) return;
  const index = Number(button.dataset.index ?? "-1");
  const run = async (): Promise<void> => {
    if (button.dataset.assistant === "picker") {
      assistantPickerOpen = !assistantPickerOpen;
      renderAssistant();
      assistantModelSlot.querySelector<HTMLButtonElement>("button")?.focus();
    }
    if (button.dataset.assistant === "pick") {
      const option = assistantCatalog[index];
      if (option) await pickAssistantModel(option.choice);
    }
    if (button.dataset.assistant === "add-model") {
      assistantPickerOpen = false;
      renderAssistant();
      await addAssistantModel();
      assistantModelSlot.querySelector<HTMLButtonElement>("button")?.focus();
    }
    if (button.dataset.assistant === "apply") await applyAssistantActions(index);
  };
  void run().catch((error) =>
    showNotice(errorText(error), "error")
  );
});

document.querySelector<HTMLButtonElement>("#assistant-close")!.addEventListener("click", () => {
  void toggleAssistant(false);
});

document.querySelector<HTMLButtonElement>("#assistant-clear")!.addEventListener("click", () => {
  assistantLogEntries = [];
  renderAssistant();
});

appDrawerOpen.addEventListener("click", () => {
  appDrawer.checked = true;
  appDrawerOpen.setAttribute("aria-expanded", "true");
  appNavigation.querySelector<HTMLButtonElement>("button")?.focus();
});

appDrawer.addEventListener("change", () => {
  appDrawerOpen.setAttribute("aria-expanded", String(appDrawer.checked));
});

assistantForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = assistantInput.value.trim();
  if (!message || assistantBusy) return;
  assistantInput.value = "";
  void sendAssistantMessage(message);
});

// Enter sends, Shift+Enter breaks the line — a chat box, not a form field.
assistantInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    assistantForm.requestSubmit();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || dialog.open) return;
  if (assistantOpen) {
    event.preventDefault();
    void toggleAssistant(false);
  } else if (appDrawer.checked) {
    event.preventDefault();
    appDrawer.checked = false;
    appDrawerOpen.setAttribute("aria-expanded", "false");
    appDrawerOpen.focus();
  }
});

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

/**
 * First launch with no agent CLI or model: pick the best local model for this machine and turn
 * Download and Run on. Same path as the toggles, so the user can see and stop the work.
 */
async function startFirstLocalModel(): Promise<void> {
  const installed = await detectCliTools().catch(() => ({} as Record<string, string>));
  if (
    (hasUserModelChoice && assistantModel.provider !== LOCAL_PROVIDER) ||
    (!hasUserModelChoice && CLI_TOOLS.some(({ id }) => installed[id]))
  )
    return;
  const capacity = await invoke<SystemCapacity>("system_capacity").catch(() => null);
  if (!capacity) return;
  const modelId = await localModels.startupTarget(capacity).catch(() => null);
  if (!modelId) return;
  runLocalModel(modelId);
  await refreshLocalModelRows();
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
    workspace = await repository.bootstrap();
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
        status.textContent = localModelStatusLabel(
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
        runLocalModel(payload.modelId);
      }
      if (payload.state !== "downloading" && view === "preferences" && prefsTab === "local-models") {
        void renderPreferences();
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
    // Bring the last model the user ran back up, so the first agent run doesn't wait on a cold
    // start. Nothing is downloaded here, and a fresh install with no model stays quiet.
    void localModels
      .requireActive()
      .then(async (runtimeChanged) => {
        if (runtimeChanged) await flueProjectPort.restart();
        localModelProgress.clear();
        await refreshLocalModelRows();
      })
      .catch(() => {});
    void startFirstLocalModel();
    await seedDefaultRegistry();
    await seedGoalsWorkflow();
    // Re-copied at launch and after each write, not on every refresh: the snapshot only changes
    // when someone edits the team folder. ponytail: add a watcher if hand-edits need to show sooner.
    const teamFolder = await repository.getResolvedTeamFolder(workspace.teamId);
    if (teamFolder?.localPath) await ensureTeamSkillsRegistry(teamFolder.localPath);
    await scheduler.start();
    startBackgroundSync();
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
