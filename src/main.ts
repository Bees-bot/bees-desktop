import { invoke } from "@tauri-apps/api/core";
import {
  AgentFileStore,
  TauriAgentFilePort
} from "./agent-files.js";
import {
  type AiProvider
} from "./ai-connections.js";
import {
  ApiClient,
  type AuthResult,
  type PendingInvitation,
  type ServerWorkspace,
  type SessionUser
} from "./api.js";
import { createMainActions } from "./app-actions.js";
import { createAppBootstrap } from "./app-bootstrap.js";
import { createAppShell } from "./app-shell.js";
import { createMainViews, type FileSource } from "./app-views.js";
import { createAssistantController } from "./assistant-controller.js";
import {
  type EffectiveAgentEligibility,
  type MachineModelAvailability,
  type ModelChoice,
  type ModelOption,
  type ResolvedAction
} from "./assistant.js";
import {
  type PolicyInput
} from "./control.js";
import {
  type ResolvedCuratorAction,
  type SkillReview
} from "./curator.js";
import { TauriDatabase } from "./database.js";
import type {
  Agent,
  Board,
  Execution,
  ExecutionOutput,
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
  FlueProjectService,
  TauriFlueProjectPort
} from "./flue-project.js";
import {
  type KnowledgePolicy
} from "./knowledge.js";
import {
  LocalModelService,
  TauriLocalModelPort,
  type LocalModelProgress
} from "./local-models.js";
import { TaskPlanController } from "./processes/goals/controller.js";
import {
  type ProcessRenderer
} from "./processes/registry.js";
import {
  type ProcessAgentTurn
} from "./processes/software-project/controller.js";
import { drainConversationPurges } from "./purges.js";
import {
  RegistryFiles
} from "./registries.js";
import { LocalRepository, type SearchHit } from "./repository.js";
import { createRunController } from "./run-controller.js";
import { RunCoordinator } from "./run-coordinator.js";
import { type RuntimeEvent } from "./runtime.js";
import { createSessionController } from "./session-controller.js";
import "./styles.css";
import type { WorkState } from "./supervision.js";
import { type BoardItemTab, type View } from "./views.js";
import { createWorkspaceController } from "./workspace-controller.js";
import {
  TauriWorkspacePort,
  TemporaryWorkspaceService,
  type OutputPreview
} from "./workspaces.js";
import { WorkflowRuntimeClient } from "./workflow-runtime.js";

export type SettingsTab =
  | "theme" | "local-ai" | "ai-cli" | "ai-apis" | "mcp-servers" | "signins" | "workspaces" | "root-folder"
  | "org-general" | "org-members" | "org-invites" | "org-folder" | "org-knowledge" | "org-onboarding"
  | "team-members" | "team-folder" | "team-integrations" | "team-browser" | "team-archived" | "team-danger";
export type TeamTab = "members" | "folder" | "integrations" | "browser" | "archived" | "danger";
// The two Bees themes first, then every daisyUI v5 built-in (keep in sync with styles.css).
const THEMES = [
  "bees", "bees-dark",
  "light", "dark", "cupcake", "bumblebee", "emerald", "corporate", "synthwave",
  "retro", "cyberpunk", "valentine", "halloween", "garden", "forest", "aqua",
  "lofi", "pastel", "fantasy", "wireframe", "black", "luxury", "dracula", "cmyk",
  "autumn", "business", "acid", "lemonade", "night", "coffee", "winter", "dim",
  "nord", "sunset", "caramellatte", "abyss", "silk"
] as const;
export type ThemePreset = (typeof THEMES)[number];

const repository = new LocalRepository(new TauriDatabase());
const localModels = new LocalModelService(repository, new TauriLocalModelPort());
const workspaces = new TemporaryWorkspaceService(new TauriWorkspacePort());
const flueProjectPort = new TauriFlueProjectPort();
const flueProject = new FlueProjectService(flueProjectPort);
const registryFiles = new RegistryFiles(flueProjectPort);
const agentFiles = new AgentFileStore(new TauriAgentFilePort());
const api = new ApiClient();
const workflowRuntime = new WorkflowRuntimeClient(api, () => ({
  organizationId: workspaceController.workspace.organizationId,
  connected: session.orgIsConnected(),
  token: session.orgToken()
}));
const runCoordinator = new RunCoordinator(repository, workspaces, flueProject, ensureFlueRuntime);

/**
 * Boot the immutable Flue app. Rust resolves model credentials from local app storage; the
 * webview supplies only business scope and never reads a stored secret.
 */
async function ensureFlueRuntime(): Promise<{ baseUrl: string; token: string; }> {
  const runtime = await invoke<{ baseUrl: string; token: string; }>("ensure_flue_runtime", {
    organizationId: session.aiConnectionScope(),
    teamId: workspaceController.workspace.teamId
  });
  // Four call sites destructure this. A runtime that failed to start resolved with nothing, which
  // surfaced as "Cannot destructure property 'baseUrl'". Fail here instead, in words.
  if (!runtime || typeof runtime.baseUrl !== "string" || !runtime.baseUrl)
    throw new Error("The local process runtime did not start. Reopen Bees, and check Settings → Local AI if it keeps happening.");
  return { baseUrl: runtime.baseUrl, token: typeof runtime.token === "string" ? runtime.token : "" };
}

export type KnowledgeRuntimeInfo = { url: string; token: string; };
// Per-org branding (color + optional logo data URL), stored locally.
// ponytail: local-only, so an admin's logo/color don't sync to other members — add a server
// column + reconcile when shared branding matters.
export type OrgBranding = { color?: string; logo?: string; };
// The assistant conversation. `pending` is the proposal on the newest turn, waiting for Apply —
// only one at a time, so an approved batch can't be applied twice from scrollback.
export type AssistantEntry = {
  role: "you" | "assistant";
  text: string;
  actions?: ResolvedAction[];
  applied?: boolean;
};

/** Work items the Schedules view covers — the open process's, or the team's when none is open. */
function scheduleItems(): WorkItem[] {
  if (!shell.configProcessId) return workspaceController.teamItems;
  return workspaceController.teamItems.filter(({ processId }) => processId === shell.configProcessId);
}

export type ControlInput = Omit<PolicyInput, "now" | "activeExceptionPolicyIds">;

const mainHost: MainHost = {
  get shell() { return shell; },
  get session() { return session; },
  get workspaceController() { return workspaceController; },
  get runs() { return runs; },
  get assistant() { return assistant; },
  get views() { return views; },
  get actions() { return actions; },
  get THEMES() { return THEMES; },
  get agentFiles() { return agentFiles; },
  get api() { return api; },
  get ensureFlueRuntime() { return ensureFlueRuntime; },
  get flueProjectPort() { return flueProjectPort; },
  get localModels() { return localModels; },
  get registryFiles() { return registryFiles; },
  get repository() { return repository; },
  get runCoordinator() { return runCoordinator; },
  get scheduleItems() { return scheduleItems; },
  get workspaces() { return workspaces; },
  get workflowRuntime() { return workflowRuntime; }
};
export interface AppShell {
  DARK_THEMES: Set<string>;
  activeClass: (selected: boolean) => string;
  activeExecutionId: string;
  activeItemId: string;
  app: HTMLElement;
  appDrawer: HTMLInputElement;
  appDrawerOpen: HTMLButtonElement;
  appNavigation: HTMLElement;
  assistantForm: HTMLFormElement;
  assistantInput: HTMLTextAreaElement;
  assistantLog: HTMLElement;
  assistantModelSlot: HTMLElement;
  assistantPanel: HTMLElement;
  assistantSend: HTMLButtonElement;
  assistantToggle: HTMLButtonElement;
  boardFileEditing: boolean;
  boardFileRef: string;
  boardItemEditing: boolean;
  boardItemId: string;
  boardRootItemId: string;
  boardTab: BoardItemTab;
  teamCollapsed: (teamId: string) => boolean;
  toggleTeamCollapsed: (teamId: string) => void;
  expandTeam: (teamId: string) => void;
  configAgentId: string;
  configProcessId: string;
  darkDefaultTheme: ThemePreset;
  dialog: HTMLDialogElement;
  dialogFields: HTMLElement;
  dialogFooter: HTMLElement;
  dialogForm: HTMLFormElement;
  dialogTitle: HTMLElement;
  escapeHtml: (value: unknown) => string;
  formatBytes: (bytes: number) => string;
  isThemePreset: (value: unknown) => value is ThemePreset;
  lightDefaultTheme: ThemePreset;
  loadTheme: () => Promise<void>;
  markdownBody: HTMLElement;
  markdownDialog: HTMLDialogElement;
  markdownTitle: HTMLElement;
  viewBack: HTMLButtonElement;
  previousView: View | null;
  newItemSources: FileSource[];
  newItemProcessId: string;
  newItemStageId: string;
  notifyLocal: (titleText: string, body: string) => void;
  openRunItemId: string;
  openRunStepId: string;
  orgRow: HTMLElement;
  settingsTab: SettingsTab;
  render: () => void;
  saveDefaultTheme: (mode: 'light' | 'dark', preset: ThemePreset) => Promise<void>;
  saveTheme: (preset: ThemePreset) => Promise<void>;
  scopedFormData: (form: HTMLFormElement, agentId: string) => FormData;
  searchHits: SearchHit[];
  searchQuery: string;
  setHeader: (name: string, detail?: string) => void;
  showNotice: (message: string, kind?: 'info' | 'success' | 'error', undo?: () => Promise<void>) => void;
  sidebarHelp: HTMLElement;
  swap: (content: string) => void;
  teamNav: HTMLElement;
  teamTab: TeamTab;

  themePreset: ThemePreset;
  themePresets: { id: ThemePreset; name: string; }[];
  view: View;
}

export interface SessionController {
  AI_PROVIDER_HINT: Record<AiProvider, string>;
  AI_PROVIDER_MODEL_PREFIX: Record<AiProvider, string>;
  accounts: Map<string, { user: SessionUser; token: string; }>;
  activeConnectionValid: () => boolean;
  activeOrgTeamEnabled: () => boolean;
  activeServerOrg: () => ServerWorkspace | undefined;
  activeUserId: string;
  aiConnectionScope: () => string;
  brandingFor: (orgId: string) => OrgBranding;
  connKey: (orgId: string, userId: string) => string;
  connParts: (key: string) => { orgId: string; userId: string; };
  connect: (orgId: string, user: SessionUser, token: string) => Promise<void>;
  connectedOrgs: Set<string>;
  connections: Set<string>;
  createWorkspace: () => Promise<void>;
  createServerTeam: (name: string) => Promise<string | null>;
  currentOrganization: () => Organization | undefined;
  currentTeam: () => Team | undefined;
  currentUser: () => SessionUser | null;
  defaultOrgColor: (seed: string) => string;
  disconnect: (orgId: string, userId: string) => Promise<void>;
  ensureKnowledgeConnection: () => Promise<McpConnection | null>;
  firstConnUser: (orgId: string) => string;
  knowledgeConnection: McpConnection | null;
  knowledgeError: string;
  knowledgePolicy: KnowledgePolicy | null;
  knowledgePolicyOrgId: string;
  loadKnowledgePolicy: (force?: boolean) => Promise<KnowledgePolicy | null>;
  moveOffHidden: () => Promise<boolean>;
  orgBranding: Record<string, OrgBranding>;
  orgHasConnection: (orgId: string) => boolean;
  orgIsConnected: (orgId?: string) => boolean;
  orgLogoPreview: (orgId: string, name: string) => string;
  orgSignedIn: (orgId?: string) => boolean;
  orgToken: (orgId?: string) => string | null;
  pendingInvitations: PendingInvitation[];
  persistConnections: () => Promise<void>;
  probeKnowledgeConnection: (connection: McpConnection) => Promise<void>;
  providerLabel: Record<string, string>;
  reconcileServerOrgs: () => Promise<void>;
  rememberAccount: (user: SessionUser, token: string) => Promise<void>;
  restoreSession: () => Promise<void>;
  routeDeepLink: (urls: string[]) => void;
  saveBranding: () => Promise<void>;
  saveKnowledgePolicy: (policy: KnowledgePolicy | null) => Promise<void>;
  serverOrgs: Map<string, ServerWorkspace>;
  setBrandingValue: (orgId: string, patch: OrgBranding) => Promise<void>;
  signInUser: () => Promise<AuthResult | null>;
  signOutAccount: (userId: string) => Promise<void>;
  signUpUser: () => Promise<AuthResult | null>;
  socialSignInUser: (provider: string) => Promise<AuthResult | null>;
  switchConnection: (organizationId: string, userId: string) => Promise<void>;
}

export interface WorkspaceController {
  activeBoard: Board | null;
  activeProcess: Process | null;
  agents: Agent[];
  boards: Board[];
  dashboardsByTeam: Map<string, { board: Board; process: Process; count: number; roots: { item: WorkItem; open: number }[]; }[]>;
  eligibilityForAgent: (agent: Agent) => EffectiveAgentEligibility;
  ensureOrgFolders: () => Promise<void>;
  ensureTeamSkillsRegistry: (teamRoot: string) => Promise<void>;
  items: WorkItem[];
  mcpConnections: McpConnection[];
  openWork: (list: WorkItem[]) => WorkItem[];
  organizations: Organization[];
  processRenderers: readonly ProcessRenderer[];
  processes: Process[];
  refresh: () => Promise<void>;
  registries: Registry[];
  requireTeamRoot: () => Promise<string>;
  seedDefaultRegistry: () => Promise<void>;
  seedInstalledWorkflows: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
  switchTeam: (teamId: string, nextView?: View) => Promise<void>;
  teamItems: WorkItem[];
  teams: Team[];
  workspace: LocalWorkspace;
}

export interface RunController {
  DISMISSED_RUNS_KEY: string;
  RUNNING_PROCESSES_KEY: string;
  agentForItem: (item: WorkItem) => Agent | undefined;
  appVersion: string;
  applySettledExecution: (executionId: string, announce?: boolean, render?: boolean) => Promise<void>;
  autopilot: () => Promise<void>;
  autopilotDone: Set<string>;
  controlInput: (action: string, resource: ControlInput['resource'], context?: Partial<ControlInput['context']>) => ControlInput;
  deleteRun: (executionId: string) => Promise<void>;
  disabledAgentIds: Set<string>;
  dismissedRunIds: Set<string>;
  enforceControl: (input: ControlInput, offerException?: boolean) => Promise<void>;
  executionOutputs: ExecutionOutput[];
  executions: Execution[];
  finishOutputReview: (execution: Execution) => Promise<void>;
  taskWorkerRoles: () => Array<{ role: string; purpose: string; agent: Agent; }>;
  taskPlanController: TaskPlanController;
  lastControlHealthAt: number;
  liveEvents: Map<string, RuntimeEvent[]>;
  loadExecutionHistory: (execution: Execution) => Promise<void>;
  openRun: (executionId: string) => Promise<void>;
  outputPreviews: Map<string, OutputPreview>;
  projectFolderItemIds: Set<string>;
  proposeSkillEdit: (item: WorkItem) => Promise<void>;
  releaseClaim: (itemId: string, organizationId?: string) => Promise<void>;
  rememberRejection: (item: WorkItem, reason: string) => Promise<() => Promise<void>>;
  reportFailure: (error: unknown, itemId?: string) => void;
  resumeCompletedTaskPlans: () => Promise<number>;
  resumeInterruptedRuns: (resumed: Execution[]) => Promise<void>;
  retryConversationPurges: () => Promise<ReturnType<typeof drainConversationPurges>>;
  runItem: (itemId: string, auto?: boolean, continuation?: { execution: Execution; message: string; }, restartedFromExecutionId?: string, scheduled?: boolean) => Promise<void>;
  runProcessAgentTurns: (item: WorkItem, turns: ProcessAgentTurn[], projectMode?: boolean) => Promise<Execution[]>;
  runScheduledOccurrence: (schedule: Schedule, auto: boolean) => Promise<void>;
  startNewRun: (templateId: string) => Promise<void>;
  runStageId: (execution: Execution) => string | null;
  runnerId: string;
  runningProcesses: Set<string>;
  schedules: Schedule[];
  setProcessRunning: (processId: string, running: boolean) => Promise<void>;
  startBackgroundSync: () => void;
  supervise: () => Map<string, WorkState>;
}

export interface AssistantController {
  assistantBusy: boolean;
  assistantCatalog: ModelOption[];
  assistantContext: () => { processes: Process[]; items: WorkItem[]; agents: Agent[]; viewing: string | undefined; };
  assistantExtraModels: ModelChoice[];
  assistantLogEntries: AssistantEntry[];
  assistantModel: ModelChoice;
  assistantOpen: boolean;
  assistantPickerOpen: boolean;
  curatorBusy: boolean;
  curatorPlan: { summary: string; actions: ResolvedCuratorAction[]; } | null;
  loadAssistantSettings: () => Promise<void>;
  localModelDownloads: Map<string, Promise<boolean>>;
  localModelProgress: Map<string, LocalModelProgress>;
  localModelStarting: Set<string>;
  machineModelAvailability: MachineModelAvailability;
  overviewAssistantModels: () => ModelOption[];
  refreshAssistantCatalog: () => Promise<void>;
  rememberModelChoice: (choice: ModelChoice) => Promise<void>;
  skillReviews: SkillReview[];
}

export interface MainHost {
  shell: AppShell;
  session: SessionController;
  workspaceController: WorkspaceController;
  runs: RunController;
  assistant: AssistantController;
  views: ReturnType<typeof createMainViews>;
  actions: ReturnType<typeof createMainActions>;
  THEMES: typeof THEMES;
  agentFiles: AgentFileStore;
  api: ApiClient;
  ensureFlueRuntime: () => Promise<{ baseUrl: string; token: string; }>;
  flueProjectPort: TauriFlueProjectPort;
  localModels: LocalModelService;
  registryFiles: RegistryFiles;
  repository: LocalRepository;
  runCoordinator: RunCoordinator;
  scheduleItems: () => WorkItem[];
  workspaces: TemporaryWorkspaceService;
  workflowRuntime: WorkflowRuntimeClient;
}
const shell: AppShell = createAppShell(mainHost);
const session: SessionController = createSessionController(mainHost);
const workspaceController: WorkspaceController = createWorkspaceController(mainHost);
const runs: RunController = createRunController(mainHost);
const assistant: AssistantController = createAssistantController(mainHost);
const bootstrap = createAppBootstrap(mainHost);
const views = createMainViews(mainHost);
const actions = createMainActions(mainHost);
void bootstrap.start();
