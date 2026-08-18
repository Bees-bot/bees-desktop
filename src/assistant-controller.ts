import {
  availableAiConnectionIds,
  listAiConnections
} from "./ai-connections.js";
import {
  ASSISTANT_EXTRA_MODELS_KEY,
  ASSISTANT_MODEL_KEY,
  DEFAULT_MODEL_CHOICE,
  isAutoChoice,
  modelCatalog,
  modelLabel,
  preferredModelChoice,
  type MachineModelAvailability,
  type ModelChoice,
  type ModelOption
} from "./assistant.js";
import {
  CLI_TOOLS,
  configuredCliTools,
  type CliToolPath
} from "./cli-tools.js";
import {
  type ResolvedCuratorAction,
  type SkillReview
} from "./curator.js";
import {
  DEFAULT_CODEX_MODEL_ID,
  LOCAL_PROVIDER,
  type LocalModelProgress
} from "./local-models.js";
import type { AssistantEntry, MainHost } from "./main.js";

export function createAssistantController(host: MainHost) {
  const localModelProgress = new Map<string, LocalModelProgress>();

  // Models whose llama-server is booting (or whose download Run is waiting on), so the row keeps its
  // Run toggle on while it comes up.
  const localModelStarting = new Set<string>();

  const localModelDownloads = new Map<string, Promise<boolean>>();

  /** Skill curation: the pure review is recomputed on refresh, the proposal only when asked for. */
  let skillReviews: SkillReview[] = [];

  let curatorBusy = false;

  let curatorPlan: {
    summary: string;
    actions: ResolvedCuratorAction[];
  } | null = null;

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

  // ---- Assistant ----
  /** Names and counts only — see `contextPrompt`. Work items never go into the prompt. */
  function assistantContext() {
    const board = host.workspaceController.activeBoard ? ` on the "${host.workspaceController.activeBoard.name}" dashboard` : "";
    return {
      processes: host.workspaceController.processes,
      items: host.workspaceController.teamItems,
      agents: host.workspaceController.agents,
      viewing: host.workspaceController.activeProcess ? `the "${host.workspaceController.activeProcess.name}" process${board}` : undefined
    };
  }

  async function loadAssistantSettings(): Promise<void> {
    const stored = await host.repository.getSetting<ModelChoice | null>(ASSISTANT_MODEL_KEY, null);
    if (stored?.provider && stored.model && !isAutoChoice(stored)) {
      assistantModel = stored.provider === LOCAL_PROVIDER && stored.model === "active" && stored.localModelId
        ? { ...stored, model: stored.localModelId }
        : stored;
      hasUserModelChoice = true;
    }
    assistantExtraModels = await host.repository.getSetting<ModelChoice[]>(ASSISTANT_EXTRA_MODELS_KEY, []);
  }

  async function rememberModelChoice(choice: ModelChoice): Promise<void> {
    const localModelId = choice.provider === LOCAL_PROVIDER
      ? choice.localModelId ?? (choice.model === "active" ? host.localModels.wantedRunId : choice.model)
      : null;
    const remembered = localModelId ? { ...choice, model: localModelId, localModelId } : choice;
    assistantModel = remembered;
    hasUserModelChoice = true;
    await host.repository.setSetting(ASSISTANT_MODEL_KEY, remembered);
  }

  /** Rebuilt on open: a model downloaded or a key added since last time should just be there. */
  async function refreshAssistantCatalog(): Promise<void> {
    const [local, aiConnections, availableConnectionIds, cliInstalled] = await Promise.all([
      host.localModels.list().catch(() => []),
      listAiConnections(host.repository, host.session.aiConnectionScope()).catch(() => []),
      availableAiConnectionIds(host.session.aiConnectionScope()).catch(() => new Set<string>()),
      configuredCliTools().catch(() => ({} as Record<string, CliToolPath>))
    ]);
    const usableConnections = aiConnections.filter(({ id }) => availableConnectionIds.has(id));
    assistantCatalog = modelCatalog({
      local,
      connections: usableConnections,
      cliInstalled,
      extras: assistantExtraModels
    });
    machineModelAvailability = {
      localModelIds: local
        .filter(({ runtime }) => runtime.running)
        .map(({ id }) => id),
      connectedProviders: [...new Set(usableConnections.map(({ provider }) => provider))],
      cliProviders: CLI_TOOLS.filter(({ id }) => cliInstalled[id]?.enabled).map(({ provider }) => provider)
    };
    if (!hasUserModelChoice)
      assistantModel = preferredModelChoice(assistantCatalog);
  }

  function overviewAssistantModels(): ModelOption[] {
    return assistantCatalog.length
      ? assistantCatalog
      : [{ group: "Selected", label: modelLabel(assistantModel, assistantCatalog), choice: assistantModel }];
  }

  return {
    localModelProgress,
    localModelStarting,
    localModelDownloads,
    get skillReviews() { return skillReviews; },
    set skillReviews(value: typeof skillReviews) { skillReviews = value; },
    get curatorBusy() { return curatorBusy; },
    set curatorBusy(value: typeof curatorBusy) { curatorBusy = value; },
    get curatorPlan() { return curatorPlan; },
    set curatorPlan(value: typeof curatorPlan) { curatorPlan = value; },
    get assistantOpen() { return assistantOpen; },
    set assistantOpen(value: typeof assistantOpen) { assistantOpen = value; },
    get assistantBusy() { return assistantBusy; },
    set assistantBusy(value: typeof assistantBusy) { assistantBusy = value; },
    get assistantLogEntries() { return assistantLogEntries; },
    set assistantLogEntries(value: typeof assistantLogEntries) { assistantLogEntries = value; },
    get assistantModel() { return assistantModel; },
    set assistantModel(value: typeof assistantModel) { assistantModel = value; },
    get assistantExtraModels() { return assistantExtraModels; },
    set assistantExtraModels(value: typeof assistantExtraModels) { assistantExtraModels = value; },
    get assistantCatalog() { return assistantCatalog; },
    set assistantCatalog(value: typeof assistantCatalog) { assistantCatalog = value; },
    get machineModelAvailability() { return machineModelAvailability; },
    set machineModelAvailability(value: typeof machineModelAvailability) { machineModelAvailability = value; },
    get assistantPickerOpen() { return assistantPickerOpen; },
    set assistantPickerOpen(value: typeof assistantPickerOpen) { assistantPickerOpen = value; },
    assistantContext,
    loadAssistantSettings,
    rememberModelChoice,
    refreshAssistantCatalog,
    overviewAssistantModels
  };
}
