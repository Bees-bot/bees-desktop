import { open } from "@tauri-apps/plugin-dialog";
import {
  newAgent
} from "./agent-files.js";
import {
  effectiveAgentEligibility
} from "./assistant.js";
import {
  listMcpConnections
} from "./connections.js";
import {
  reviewSkills
} from "./curator.js";
import { itemTree } from "./domain.js";
import type {
  Agent,
  Board,
  LocalWorkspace,
  McpConnection,
  Organization,
  Process,
  Registry,
  Team,
  WorkItem
} from "./domain.js";
import type { WorkItemRuntimeState } from "./workflow-runtime.js";
import {
  isKnowledgeConnection
} from "./knowledge.js";
import type { MainHost } from "./main.js";
import {
  PROCESS_MODULES,
  processEngine,
  type ProcessRenderer
} from "./processes/registry.js";
import {
  SoftwareProjectController
} from "./processes/software-project/controller.js";
import {
  capabilityRefsFor,
  registryCapabilities
} from "./registries.js";
import { pluginMcpConnections } from "./plugins.js";
import { type View } from "./views.js";

export function createWorkspaceController(host: MainHost) {
  const softwareProjectRenderer = new SoftwareProjectController({
    current: () => {
      const item = teamItems.find(({ id }) => id === host.shell.activeItemId);
      const process = item ? processes.find(({ id }) => id === item.processId) : undefined;
      return item && process ? { item, process } : null;
    },
    getSetting: (key, fallback) => host.repository.getSetting(key, fallback),
    setSetting: (key, value) => host.repository.setSetting(key, value),
    runAgentTurns: (item, turns) => host.runs.runProcessAgentTurns(item, turns, true),
    moveWorkItem: async (itemId, stageId) => {
      await host.workflowRuntime.command(itemId, { type: "move", targetStageId: stageId });
    },
    createWorkItemWait: async (itemId, input) => {
      const before = new Set((await host.workflowRuntime.state(itemId)).waits.map(({ id }) => id));
      const state = await host.workflowRuntime.command(itemId, { type: "wait", ...input });
      return state.waits.find(({ id }) => !before.has(id))?.id ?? "";
    },
    resolveWorkItemWaits: async (itemId, kind) => {
      const state = await host.workflowRuntime.state(itemId);
      const waits = state.waits.filter((wait) => !kind || wait.kind === kind);
      await Promise.all(waits.map(({ id }) =>
        host.workflowRuntime.command(itemId, { type: "resolve_wait", waitId: id })
      ));
      return waits.length;
    },
    getWorkItem: async (itemId) => (await host.repository.getWorkItem(itemId)) ?? null,
    requireTeamRoot,
    chooseProjectFolder: async () => {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose project folder"
      });
      return Array.isArray(selected) ? selected[0] ?? null : selected;
    },
    confirm: async (title, message, button) => Boolean(await host.actions.edit(title, [{ name: "warning", label: "", type: "note", value: message }], button)),
    refresh,
    notify: host.shell.showNotice
  });

  const processRenderers: readonly ProcessRenderer[] = [softwareProjectRenderer];

  let workspace: LocalWorkspace;

  let organizations: Organization[] = [];

  let teams: Team[] = [];

  let boards: Board[] = [];

  let processes: Process[] = [];

  let activeBoard: Board | null = null;

  let activeProcess: Process | null = null;

  let items: WorkItem[] = [];

  let teamItems: WorkItem[] = [];

  const runtimeCache = new Map<string, WorkItemRuntimeState>();

  let agents: Agent[] = [];

  let registries: Registry[] = [];

  let mcpConnections: McpConnection[] = [];

  // Left-nav dashboards per team id — every team, not only the open one. See loadDashboardsByTeam.
  let dashboardsByTeam = new Map<string, {
    board: Board;
    process: Process;
    count: number;
    /** Top-level items of this process — one nav row each, with its own open-work count. */
    roots: { item: WorkItem; open: number }[];
  }[]>();

  /** Work still on someone's plate — finished and archived items are not workload, so never counted. */
  function openWork(list: WorkItem[]): WorkItem[] {
    return list.filter(({ isTerminal, archivedAt }) => !isTerminal && !archivedAt);
  }

  function projectRuntime(item: WorkItem, runtime: WorkItemRuntimeState, processList: Process[] = processes): WorkItem {
    const process = processList.find(({ id }) => id === runtime.processId);
    return {
      ...item,
      processId: runtime.processId,
      stageId: runtime.stageId,
      archivedAt: runtime.archivedAt,
      isTerminal: Boolean(
        process?.stages.find(({ id }) => id === runtime.stageId)?.isTerminal
      ),
      runtime,
      waits: runtime.waits.map((wait) => ({
        ...wait,
        workItemId: item.id,
        resolvedAt: null,
        resolution: null,
        updatedAt: wait.createdAt
      }))
    };
  }

  async function hydrateRuntime(workItems: WorkItem[], processList: Process[] = processes): Promise<WorkItem[]> {
    return Promise.all(workItems.map(async (item) => {
      try {
        const runtime = await host.workflowRuntime.state(item.id);
        runtimeCache.set(item.id, runtime);
        return projectRuntime(item, runtime, processList);
      } catch {
        const cached = runtimeCache.get(item.id);
        return cached ? projectRuntime(item, cached, processList) : { ...item, waits: [], runtime: null };
      }
    }));
  }

  /**
   * Dashboards (one per live process) plus open-work counts for every team in the org, so each
   * team's nav renders the same whether or not it is the open one. Every process owns exactly one
   * dashboard, so missing ones are made here — including a process created just before refresh.
   */
  async function loadDashboardsByTeam(): Promise<void> {
    dashboardsByTeam = new Map();
    for (const team of teams) {
      let [teamBoards, teamProcesses, workItems] = await Promise.all([
        host.repository.listBoards(team.id),
        host.repository.listProcesses(team.id),
        host.repository.listTeamWorkItems(team.id)
      ]);
      const undashboarded = teamProcesses.filter(({ id }) => !teamBoards.some(({ processId }) => processId === id));
      for (const process of undashboarded) {
        await host.repository.createBoard(team.id, {
          name: `${process.name} dashboard`,
          processId: process.id,
          stageIds: process.stages.map(({ id }) => id)
        });
      }
      if (undashboarded.length)
        teamBoards = await host.repository.listBoards(team.id);
      // Runtime owns archive state, so counting raw rows would keep archived tasks in the badge.
      workItems = await hydrateRuntime(workItems, teamProcesses);
      dashboardsByTeam.set(team.id, teamProcesses.flatMap((process) => {
        const board = teamBoards.find(({ processId }) => processId === process.id);
        if (!board)
          return [];
        const own = workItems.filter(({ processId }) => processId === process.id);
        const roots = own
          .filter(({ parentId }) => !parentId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          // The row already represents the root; its badge counts only additional open work.
          .map((item) => ({ item, open: openWork(itemTree(own, item.id).filter(({ id }) => id !== item.id)).length }));
        return [{ board, process, count: openWork(own).length, roots }];
      }));
    }
  }

  /*
   * Seven callers trigger this, and two overlapping ones both wrote the same state — the last to resolve
   * won, not the last asked for. Serialized rather than sequence-numbered: the writes span the function.
   */
  let active: Promise<void> | null = null;
  let queued: Promise<void> | null = null;

  function refresh(): Promise<void> {
    if (active) {
      queued ??= active.catch(() => undefined).then(() => {
        queued = null;
        return refresh();
      });
      return queued;
    }
    active = loadWorkspace().finally(() => {
      active = null;
    });
    return active;
  }

  async function loadWorkspace(): Promise<void> {
    organizations = await host.repository.listOrganizations();
    teams = await host.repository.listTeams(workspace.organizationId);
    if (!teams.some(({ id }) => id === workspace.teamId))
      workspace.teamId = teams[0]?.id ?? "";
    // Load every team's dashboards before the active-team views derive their state.
    await loadDashboardsByTeam();
    host.runs.dismissedRunIds = new Set(await host.repository.getSetting<string[]>(host.runs.DISMISSED_RUNS_KEY, []));
    if (!workspace.teamId) {
      boards = [];
      processes = [];
      activeBoard = null;
      activeProcess = null;
      items = [];
      teamItems = [];
      agents = [];
      host.runs.executions = [];
      host.runs.executionOutputs = [];
      host.runs.projectFolderItemIds = new Set();
      host.runs.schedules = [];
      registries = [];
      mcpConnections = [];
      host.session.knowledgeConnection = null;
      host.runs.disabledAgentIds = new Set();
      host.assistant.skillReviews = [];
      host.assistant.curatorPlan = null;
    }
    else {
      host.runs.runningProcesses = new Set(await host.repository.getSetting<string[]>(host.runs.RUNNING_PROCESSES_KEY, []));
      host.runs.disabledAgentIds = new Set(await host.repository.getSetting<string[]>(`disabled_agents:${workspace.teamId}`, []));
      [boards, processes, agents, teamItems, host.runs.executions, registries, mcpConnections] = await Promise.all([
        host.repository.listBoards(workspace.teamId),
        host.repository.listProcesses(workspace.teamId),
        host.actions.loadAgents(),
        host.repository.listTeamWorkItems(workspace.teamId),
        host.repository.listExecutions(workspace.teamId),
        host.repository.listRegistries(workspace.teamId),
        listMcpConnections(host.repository, workspace.teamId)
      ]);
      teamItems = await hydrateRuntime(teamItems);
      host.runs.schedules = teamItems.flatMap((item) =>
        item.runtime?.schedules.map((schedule) => ({
          ...schedule,
          teamId: workspace.teamId,
          workItemId: item.id
        })) ?? []
      );
      host.session.knowledgeConnection = mcpConnections.find(isKnowledgeConnection) ?? null;
      mcpConnections = mcpConnections.filter((connection) => !isKnowledgeConnection(connection));
      mcpConnections.push(...pluginMcpConnections(registries, workspace.teamId));
      host.assistant.skillReviews = reviewSkills({
        capabilities: registryCapabilities(registries),
        usage: await host.repository.listSkillUsage(workspace.teamId),
        selectedRefs: agents.flatMap((agent) => capabilityRefsFor(agent.config, "skill")),
        now: new Date().toISOString()
      });
      if (await host.runs.resumeCompletedTaskPlans()) {
        teamItems = await hydrateRuntime(await host.repository.listTeamWorkItems(workspace.teamId));
      }
      const executionIds = new Set(host.runs.executions.map(({ id }) => id));
      host.runs.executionOutputs = (await host.repository.listExecutionOutputs()).filter(({ executionId }) => executionIds.has(executionId));
      host.runs.projectFolderItemIds = new Set(await host.repository.listProjectFolderItemIds());
      activeBoard =
        boards.find((board) => board.id === activeBoard?.id && processes.some((process) => process.id === board.processId)) ??
        boards.find((board) => board.processId === workspace.processId &&
          processes.some((process) => process.id === board.processId)) ??
        boards.find((board) => processes.some((process) => process.id === board.processId)) ??
        null;
      activeProcess =
        processes.find(({ id }) => id === activeBoard?.processId) ??
        processes.find(({ id }) => id === activeProcess?.id) ??
        processes[0] ??
        null;
      workspace.processId = activeProcess?.id ?? "";
      const activeProcessId = activeProcess?.id;
      items = activeProcessId
        ? teamItems.filter(({ processId }) => processId === activeProcessId)
        : [];
    }
    host.views.renderNavigation();
    host.shell.render();
    void host.runs.autopilot();
  }

  async function seedDefaultRegistry(): Promise<void> {
    if (!workspace.teamId)
      return;
    const key = `default_registry_version_${workspace.teamId}`;
    if ((await host.repository.getSetting(key, 0)) >= 4)
      return;
    const existing = registries.find(({ sourcePath }) => sourcePath === "bundled://bees-default");
    const id = existing?.id ?? crypto.randomUUID();
    const plugin = await host.registryFiles.copyBundled(id);
    await host.repository.saveRegistry({
      id,
      teamId: workspace.teamId,
      name: plugin.manifest.name,
      sourcePath: "bundled://bees-default",
      plugin
    });
    await host.repository.setSetting(key, 4);
    await refresh();
  }

  /** Hydrates each installed bundled process once; later local edits and deletions are respected. */
  async function seedInstalledWorkflows(): Promise<void> {
    if (!workspace.teamId)
      return;
    const mapping = await host.repository.getResolvedTeamFolder(workspace.teamId);
    if (!mapping?.localPath)
      return;
    await host.workspaces.ensureDirectory(mapping.localPath);
    const skills = registryCapabilities(registries).filter(({ kind }) => kind === "skill");
    let changed = false;
    let runningChanged = false;
    for (const process of processes) {
      const module = PROCESS_MODULES.find(
        ({ definition }) => definition.id === process.definition.moduleId
      );
      if (!module)
        continue;
      const key = `${module.definition.id}_workflow_seeded_${process.id}`;
      if (await host.repository.getSetting(key, false))
        continue;
      let complete = true;
      for (const definition of module.definition.agents) {
        const stage = processEngine.boundState(process, definition.state);
        if (!stage) {
          complete = false;
          continue;
        }
        if (agents.some(
          ({ config, triggerStageId }) =>
            config.role === definition.role && triggerStageId === stage.id
        )) continue;
        const saved = await host.agentFiles.save(mapping.localPath, newAgent({
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
        }));
        agents.push(saved);
        changed = true;
      }
      if (!complete) continue;
      if (module.autoStart && !host.runs.runningProcesses.has(process.id)) {
        host.runs.runningProcesses.add(process.id);
        runningChanged = true;
      }
      await host.repository.setSetting(key, true);
    }
    if (runningChanged) {
      await host.repository.setSetting(host.runs.RUNNING_PROCESSES_KEY, [...host.runs.runningProcesses]);
    }
    if (changed || runningChanged) {
      host.views.renderNavigation();
      host.shell.render();
      void host.runs.autopilot();
    }
  }

  /**
   * The one plugin Bees writes to. Its source is <teamRoot>/plugins/team-skills, so skills the team writes —
   * by hand or from an approved proposal — sync and version with the team folder, and Refresh
   * re-copies from that folder instead of overwriting it from somewhere else.
   */
  async function ensureTeamSkillsRegistry(teamRoot: string): Promise<void> {
    const sourcePath = `${teamRoot}/plugins/team-skills`;
    const existing = registries.find((registry) => registry.sourcePath === sourcePath);
    const id = existing?.id ?? crypto.randomUUID();
    // No skills folder yet: nothing to register until the first skill is written.
    const plugin = await host.registryFiles.copy(id, sourcePath).catch(() => null);
    if (!plugin)
      return;
    await host.repository.saveRegistry({
      id,
      teamId: workspace.teamId,
      name: plugin.manifest.name,
      sourcePath,
      plugin
    });
  }

  async function requireTeamRoot(): Promise<string> {
    const mapping = await host.repository.getResolvedTeamFolder(workspace.teamId);
    if (!mapping?.localPath)
      throw new Error("Set a team folder first — agents are files inside it");
    return mapping.localPath;
  }

  function eligibilityForAgent(agent: Agent) {
    return effectiveAgentEligibility(agent, host.assistant.assistantModel, !host.runs.disabledAgentIds.has(agent.id), host.assistant.machineModelAvailability, host.assistant.assistantCatalog);
  }

  /** Switch to an org by id, picking any connection it has (or none, for a local org). */
  async function switchOrganization(organizationId: string): Promise<void> {
    const userId = host.session.orgIsConnected(organizationId) ? host.session.firstConnUser(organizationId) : "";
    await host.session.switchConnection(organizationId, userId);
  }

  async function switchTeam(teamId: string, nextView: View = "board"): Promise<void> {
    workspace.teamId = teamId;
    activeBoard = null;
    activeProcess = null;
    host.shell.view = nextView;
    host.shell.expandTeam(teamId);
    await refresh();
    await seedDefaultRegistry();
    await seedInstalledWorkflows();
  }

  /** Default the workspace root to <home>/Bees on first launch, then create org/team folders on disk. */
  async function ensureOrgFolders(): Promise<void> {
    let root = await host.repository.getSetting("global_local_path", "");
    if (!root) {
      root = await host.workspaces.defaultRoot();
      await host.repository.setSetting("global_local_path", root);
    }
    await host.workspaces.ensureDirectory(root).catch(() => { });
    for (const org of await host.repository.listOrganizations()) {
      const orgPath = await host.repository.getOrgFolder(org.id);
      if (orgPath)
        await host.workspaces.ensureDirectory(orgPath).catch(() => { });
      for (const team of await host.repository.listTeams(org.id)) {
        const mapping = await host.repository.getResolvedTeamFolder(team.id);
        if (mapping && !mapping.override)
          await host.workspaces.ensureDirectory(mapping.localPath).catch(() => { });
      }
    }
  }

  return {
    processRenderers,
    get workspace() { return workspace; },
    set workspace(value: typeof workspace) { workspace = value; },
    get organizations() { return organizations; },
    set organizations(value: typeof organizations) { organizations = value; },
    get teams() { return teams; },
    set teams(value: typeof teams) { teams = value; },
    get boards() { return boards; },
    set boards(value: typeof boards) { boards = value; },
    get processes() { return processes; },
    set processes(value: typeof processes) { processes = value; },
    get activeBoard() { return activeBoard; },
    set activeBoard(value: typeof activeBoard) { activeBoard = value; },
    get activeProcess() { return activeProcess; },
    set activeProcess(value: typeof activeProcess) { activeProcess = value; },
    get items() { return items; },
    set items(value: typeof items) { items = value; },
    get teamItems() { return teamItems; },
    set teamItems(value: typeof teamItems) { teamItems = value; },
    get agents() { return agents; },
    set agents(value: typeof agents) { agents = value; },
    get registries() { return registries; },
    set registries(value: typeof registries) { registries = value; },
    get mcpConnections() { return mcpConnections; },
    set mcpConnections(value: typeof mcpConnections) { mcpConnections = value; },
    get dashboardsByTeam() { return dashboardsByTeam; },
    set dashboardsByTeam(value: typeof dashboardsByTeam) { dashboardsByTeam = value; },
    openWork,
    refresh,
    seedDefaultRegistry,
    seedInstalledWorkflows,
    ensureTeamSkillsRegistry,
    requireTeamRoot,
    eligibilityForAgent,
    switchOrganization,
    switchTeam,
    ensureOrgFolders
  };
}
