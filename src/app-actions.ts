import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  firstTriggerConflict,
  newAgent
} from "./agent-files.js";
import {
  AI_PROVIDER_LABEL,
  addAiConnection,
  connectApiKey,
  connectOAuthCredential,
  listAiConnections,
  removeAiConnection,
  type ApiKeyProvider,
  type AiProvider
} from "./ai-connections.js";
import { withBridgeUrl } from "./api-bridge.js";
import { discoverApi } from "./api-discovery.js";
import { specFromCurl } from "./spec-from-curl.js";
import type { EditorField, FileSource } from "./app-views.js";
import { executeBeesUiCommand, refElement, snapshotBeesUi } from "./assistant-ui.js";
import {
  PLUGIN_CATALOG,
  catalogSourcePath,
  installCatalogPlugin,
  parseCatalogSourcePath,
  pluginCatalog,
  searchMcpRegistry,
  type McpRegistryServer
} from "./catalog.js";
import {
  ASSISTANT_AGENT,
  ASSISTANT_EXTRA_MODELS_KEY,
  AUTO_MODEL_CHOICE,
  AUTO_PROVIDER,
  applyActions,
  assistantInstanceId,
  instanceModelId,
  parseBeesUiCommand,
  parseTurn,
  resolveActions,
  sameChoice,
  turnPrompt,
  type ModelChoice
} from "./assistant.js";
import {
  setCliToolPath,
  setCliToolEnabled
} from "./cli-tools.js";
import {
  listMcpConnections,
  newMcpConnection,
  removeMcpConnection,
  saveMcpConnection,
  toolPickableConnections,
  withMcpHealth
} from "./connections.js";
import {
  CURATOR_AGENT,
  applyCuratorPlan,
  curatorPrompt,
  parseCuratorPlan,
  resolveCuratorPlan
} from "./curator.js";
import type {
  Agent,
  Board,
  Execution,
  ExecutionOutput,
  FileLocation,
  GoalTaskEffect,
  McpConnection,
  Process,
  Schedule,
  WorkItem,
} from "./domain.js";
import {
  activeExecutionsInItemTree,
  boardFilterConditionLabels,
  errorText,
  formatBoardFilters,
  isProposal,
  itemTree,
  logicalFileReference,
  parseBoardFilters,
  rootItemId
} from "./domain.js";
import {
  isKnowledgeConnection,
  knowledgeConnection as managedKnowledgeConnection,
  parseKnowledgePolicy
} from "./knowledge.js";
import {
  LOCAL_PROVIDER,
  MODEL_PROVIDERS,
  modelRef,
  parseModelRef,
  thinkingOptionsForModel
} from "./local-models.js";
import type { KnowledgeRuntimeInfo, MainHost, SettingsTab, TeamTab } from "./main.js";
import { renderMarkdown } from "./markdown.js";
import { PENDING_FILE_PREFIX } from "./workspaces.js";
import {
  parseTaskPlan,
  type PlannedTask
} from "./processes/goals/index.js";
import {
  hasTaskPlanCapability,
  taskPlanStages
} from "./processes/goals/runtime.js";
import {
  PROCESS_LIBRARY_SELECTION_PREFIX,
  processLibraryEntry,
  processEngine,
  type ProcessLibraryEntry
} from "./processes/registry.js";
import {
  registryCapabilities
} from "./registries.js";
import { BROWSER_TOOL_REF, BROWSER_WRITE_GRANT } from "./run-config.js";
import { runReceipt } from "./run-receipt.js";
import { FlueRuntime } from "./runtime.js";
import { nextScheduleStart } from "./scheduler.js";
import {
  DEFAULT_TOUR,
  TOUR_MARKDOWN_KEY,
  createTour,
  parseTour,
  parseTourTarget,
  type TourStep
} from "./tour.js";
import { PARENT_VIEW, type BoardItemTab, type View } from "./views.js";

export function createMainActions(host: MainHost) {
  /**
   * Saves every agent on the process screen. The status clash is checked across the whole screen
   * before anything is written: agent by agent, swapping two agents' statuses would be rejected
   * because the first write leaves the second one's old status still taken.
   */
  async function saveProcessAgents(form: HTMLFormElement, notify = true, excludedAgentId = "", draft = false): Promise<void> {
    const edits = [...form.querySelectorAll<HTMLElement>("[data-agent-pane]")]
      .map((pane) => host.workspaceController.agents.find(({ id }) => id === pane.dataset.agentPane))
      .filter((agent): agent is Agent => agent !== undefined && agent.id !== excludedAgentId)
      .map((agent) => ({ agent, data: host.shell.scopedFormData(form, agent.id) }));
    if (!edits.length)
      return;
    const edited = new Set(edits.map(({ agent }) => agent.id));
    const processStageIds = new Set(host.workspaceController.processes
      .find(({ id }) => id === host.shell.configProcessId)?.stages.map(({ id }) => id) ?? []);
    const assignment = (name: string, triggerStageId: string | null) => {
      const context = host.views.triggerContext(triggerStageId);
      return {
        name,
        triggerStageId,
        exempt: Boolean(
          !context || processEngine.allowsMultipleAgents(context.process, triggerStageId ?? "")
        )
      };
    };
    const conflict = firstTriggerConflict([
      ...host.workspaceController.agents.filter(({ id, triggerStageId }) =>
        id !== excludedAgentId && !edited.has(id) && processStageIds.has(triggerStageId ?? ""))
        .map(({ name, triggerStageId }) => assignment(name, triggerStageId)),
      ...edits.map(({ agent, data }) => assignment(String(data.get("name") ?? "") || agent.name, String(data.get("trigger") ?? "") || null))
    ]);
    if (conflict) {
      throw new Error(`${conflict.first} and ${conflict.second} would both run on ${host.views.stageName(conflict.triggerStageId) ?? "one status"}`);
    }
    for (const { agent, data } of edits) {
      await applyAgentEdit(agent, data, draft);
      if (data.get("enabled"))
        host.runs.disabledAgentIds.delete(agent.id);
      else
        host.runs.disabledAgentIds.add(agent.id);
    }
    await host.repository.setSetting(`disabled_agents:${host.workspaceController.workspace.teamId}`, [...host.runs.disabledAgentIds]);
    await host.workspaceController.refresh();
    if (notify)
      host.shell.showNotice(`Saved ${edits.length} agent${edits.length === 1 ? "" : "s"}`, "success");
  }

  /** Writes the open edits before an action that re-renders the screen, so no typing is lost. */
  async function commitProcessAgentEdits(excludedAgentId = "", draft = false): Promise<void> {
    const form = host.shell.app.querySelector<HTMLFormElement>("form[data-process-agents]");
    if (form)
      await saveProcessAgents(form, false, excludedAgentId, draft);
  }

  /**
   * Creates or updates the process from the top of its page. A new one stays on the page — now in
   * edit mode — because the next thing to do is give its statuses agents. The board comes with it:
   * `loadDashboardsByTeam` gives every process without one a board on the next refresh.
   */
  async function saveProcessDefinition(data: FormData): Promise<void> {
    // Position carries the terminal semantics: the first status starts the work, the last one
    // ends it. Nothing to mark up in the field.
    const names = String(data.get("stages") ?? "").split(",").map((value) => value.trim());
    const stages = names.map((name, index) => ({ name, isTerminal: index === names.length - 1 }));
    const process = host.workspaceController.processes.find(({ id }) => id === host.shell.configProcessId);
    const input = {
      name: String(data.get("name") ?? ""),
      description: String(data.get("description") ?? ""),
      stages,
      outputFolders: Object.fromEntries((process?.stages ?? []).map(({ id }) => [
        id,
        String(data.get(`outputFolder:${id}`) ?? "")
      ]))
    };
    if (host.shell.configProcessId) {
      await host.repository.updateProcessDefinition(host.shell.configProcessId, input);
      await host.workspaceController.refresh();
      host.shell.showNotice(`Saved ${input.name}`, "success");
      return;
    }
    host.shell.configProcessId = await host.repository.createProcess(host.workspaceController.workspace.teamId, input);
    host.shell.configAgentId = "";
    await host.workspaceController.refresh();
    host.workspaceController.activeProcess = host.workspaceController.processes.find(({ id }) => id === host.shell.configProcessId) ?? host.workspaceController.activeProcess;
    host.workspaceController.workspace.processId = host.workspaceController.activeProcess?.id ?? "";
    host.shell.showNotice(`Created ${input.name}`, "success");
  }

  /**
   * Materializes a Process Library workflow for the team. With `copyName` it builds an independent copy instead:
   * the team's one install of the module is left alone (or absent), so the copy can be edited
   * freely and the library entry remains available.
   */
  async function installLibraryProcess(template: ProcessLibraryEntry, copyName?: string): Promise<Process> {
    const allProcesses = await host.repository.listProcesses(host.workspaceController.workspace.teamId, true);
    let process = copyName
      ? undefined
      : allProcesses.find((entry) => entry.definition.moduleId === template.id);
    if (process && !process.archivedAt) {
      throw new Error(`${process.name} is already in this team`);
    }
    let processId: string;
    if (copyName) {
      processId = await host.repository.createProcess(host.workspaceController.workspace.teamId, {
        name: copyName,
        description: template.description,
        template,
        copy: true
      });
    }
    else if (process?.archivedAt) {
      await host.repository.restoreProcess(process.id);
      // Adding from the library is a fresh install, so the restored row takes the library's current
      // name. Without this it keeps whatever it was called when it was archived.
      await host.repository.updateProcess(process.id, {
        name: template.name,
        description: template.description
      });
      processId = process.id;
    }
    else {
      processId = await host.repository.createProcess(host.workspaceController.workspace.teamId, {
        name: template.name,
        description: template.description,
        template
      });
    }
    process = (await host.repository.listProcesses(host.workspaceController.workspace.teamId)).find((entry) => entry.id === processId);
    if (!process)
      throw new Error(`Could not add ${template.name}`);
    const teamRoot = await host.workspaceController.requireTeamRoot();
    await host.workspaces.ensureDirectory(teamRoot);
    const existingAgents = await host.agentFiles.list(teamRoot).catch(() => []);
    const skills = registryCapabilities(host.workspaceController.registries).filter(({ kind }) => kind === "skill");
    for (const definition of template.agents) {
      const stage = processEngine.boundState(process, definition.state);
      if (!stage)
        throw new Error(`${template.name} is missing the ${definition.state} status`);
      // Role alone is not enough: an agent left over from an earlier install of this module still
      // carries that install's stage id, so keeping it would leave every lane of the new process
      // empty. Only an agent already on one of this process's statuses counts as present.
      if (existingAgents.some(({ config, triggerStageId }) => config.role === definition.role && triggerStageId === stage.id))
        continue;
      await host.agentFiles.save(teamRoot, newAgent({
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
    }
    const hasBoard = (await host.repository.listBoards(host.workspaceController.workspace.teamId, true)).some(({ processId }) => processId === process.id);
    if (!hasBoard) {
      await host.repository.createBoard(host.workspaceController.workspace.teamId, {
        name: copyName ?? template.boardName,
        processId: process.id,
        stageIds: process.stages.map(({ id }) => id)
      });
    }
    return process;
  }

  /**
   * Copies a Process Library workflow into the team under its own name. The library entry is a read-only
   * template, so this is how you get one you can change — including a second and third copy of
   * the same one, each with its own statuses and agents.
   */
  async function copyLibraryProcess(templateId: string): Promise<void> {
    const template = processLibraryEntry(templateId);
    if (!template)
      throw new Error("That Process Library entry is unavailable");
    if (host.shell.view === "process")
      await commitProcessAgentEdits();
    const taken = new Set(host.workspaceController.processes.map(({ name }) => name.toLowerCase()));
    let suggestion = `${template.name} copy`;
    for (let suffix = 2; taken.has(suggestion.toLowerCase()); suffix += 1)
      suggestion = `${template.name} copy ${suffix}`;
    const data = await edit(`Copy ${template.name}`, [
      { name: "name", label: "Name", value: suggestion }
    ], "Create copy");
    if (!data)
      return;
    const name = String(data.get("name") ?? "").trim();
    const process = await installLibraryProcess(template, name);
    // Land on the copy's own page: changing its statuses and agents is the point of copying it.
    host.shell.configProcessId = process.id;
    host.shell.configAgentId = "";
    host.shell.view = "process";
    await host.workspaceController.refresh();
    host.shell.showNotice(`Created ${process.name}`, "success");
  }

  /**
   * Agents come off disk, not the database. One unreadable folder must not blank the
   * whole app, so a failed read leaves the library empty rather than throwing at boot.
   */
  async function loadAgents(): Promise<Agent[]> {
    const mapping = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
    if (!mapping?.localPath)
      return [];
    return host.agentFiles.list(mapping.localPath).catch(() => []);
  }

  /** Agent edits are data only; the stable Flue runtime reads the frozen config at admission. */
  async function writeAgent(agent: Agent, draft = false): Promise<void> {
    await host.agentFiles.save(await host.workspaceController.requireTeamRoot(), agent, draft);
  }

  /**
   * Writes one agent from editor fields. The trigger is taken as given: callers that edit several
   * agents at once check the statuses across the whole set first — see `saveProcessAgents`.
   */
  async function applyAgentEdit(agent: Agent, data: FormData, draft = false): Promise<void> {
    const triggerStageId = String(data.get("trigger") ?? "") || null;
    const selectedModelRef = String(data.get("model") ?? modelRef(host.assistant.assistantModel)).trim();
    const selectedModel = parseModelRef(selectedModelRef);
    if (!selectedModel)
      throw new Error("Choose a model");
    const { provider, model } = selectedModel;
    const thinkingLevel = String(data.get("thinkingLevel") ?? "") as Agent["config"]["thinkingLevel"] | "";
    if (thinkingLevel &&
      !thinkingOptionsForModel(selectedModel).some(({ value }) => value === thinkingLevel)) {
      throw new Error("Choose a thinking level supported by this model");
    }
    const previousConfig = { ...agent.config };
    delete previousConfig.thinkingLevel;
    const skillRefs = data.getAll("skills").map(String);
    const toolRefs = data.getAll("tools").map(String);
    const mcpConnectionRefs = data.getAll("mcps").map(String);
    const modelChanged = provider !== agent.config.provider || model !== agent.config.model;
    await writeAgent({
      ...agent,
      name: String(data.get("name") ?? ""),
      purpose: String(data.get("purpose") ?? ""),
      description: String(data.get("description") ?? ""),
      triggerStageId,
      config: {
        ...previousConfig,
        prompt: String(data.get("prompt") ?? ""),
        provider,
        model,
        ...(thinkingLevel ? { thinkingLevel } : {}),
        skillRefs,
        toolRefs,
        mcpConnectionRefs,
        mcpToolRefs: Object.fromEntries((() => {
          // The same predicate the form used, so an unticked picker reads as "none of these"
          // while a connection that had no picker keeps whatever it already carried.
          const asked = new Set(toolPickableConnections(host.workspaceController.mcpConnections, agent.config)
            .map(({ id }) => id));
          return host.workspaceController.mcpConnections.filter(({ id }) => mcpConnectionRefs.includes(id))
            .map(({ id, allowedTools }) => {
              const chosen = asked.has(id)
                ? data.getAll(`mcpTools:${id}`).map(String)
                : agent.config.mcpToolRefs?.[id] ?? allowedTools;
              return [id, chosen.filter((name) => allowedTools.includes(name))];
            });
        })()),
        delegateRefs: data.getAll("delegates").map(String),
        grants: [
          ...(toolRefs.includes(BROWSER_TOOL_REF) && data.get("browserAccess") === "write"
            ? [BROWSER_WRITE_GRANT]
            : []),
          ...toolRefs.filter((ref) => ref !== BROWSER_TOOL_REF).map((ref) => `local:${ref}`),
          ...mcpConnectionRefs.map((id) => `mcp:${id}`)
        ]
      }
    }, draft);
    // "Auto" is a resolution rule, not a model — remembering it as the global choice would
    // leave the dashboard assistant pointed at a provider that does not exist.
    if (provider && model && modelChanged && provider !== AUTO_PROVIDER)
      await host.assistant.rememberModelChoice({ provider, model });
  }

  async function configureLocalKnowledge(): Promise<void> {
    host.shell.showNotice("Starting the local knowledge worker…", "info");
    const runtime = await invoke<KnowledgeRuntimeInfo>("ensure_knowledge_worker", {
      organizationId: host.workspaceController.workspace.organizationId,
      teamId: host.workspaceController.workspace.teamId
    });
    const stored = await listMcpConnections(host.repository, host.workspaceController.workspace.teamId);
    const connection = managedKnowledgeConnection(host.workspaceController.workspace.teamId, runtime.url, stored.find(isKnowledgeConnection));
    await invoke("store_connection_secret", {
      secretRef: connection.secretRef,
      secret: runtime.token
    });
    await saveMcpConnection(host.repository, connection);
    await host.session.probeKnowledgeConnection(connection);
    await host.session.saveKnowledgePolicy({ mode: "local" });
    host.session.knowledgeConnection = connection;
    host.shell.showNotice("Local knowledge is indexing available folders", "success");
  }

  async function configureRemoteKnowledge(): Promise<void> {
    const current = await host.session.loadKnowledgePolicy();
    const data = await edit("Workspace knowledge worker", [
      {
        name: "url",
        label: "Single HTTPS MCP URL",
        value: current?.mode === "remote" ? current.url : "",
        placeholder: "https://knowledge.example.com/mcp"
      },
      {
        name: "token",
        label: `Bearer token for ${host.session.currentTeam()?.name ?? "this team"}`,
        type: "password"
      }
    ], "Connect");
    if (!data)
      return;
    const policy = parseKnowledgePolicy({ mode: "remote", url: String(data.get("url") ?? "") });
    if (!policy || policy.mode !== "remote")
      throw new Error("A remote knowledge URL is required");
    const token = String(data.get("token") ?? "").trim();
    if (!token)
      throw new Error("A team-scoped bearer token is required");
    const stored = await listMcpConnections(host.repository, host.workspaceController.workspace.teamId);
    const connection = managedKnowledgeConnection(host.workspaceController.workspace.teamId, policy.url, stored.find(isKnowledgeConnection));
    await invoke("store_connection_secret", { secretRef: connection.secretRef, secret: token });
    await saveMcpConnection(host.repository, connection);
    host.session.knowledgeConnection = connection;
    await host.session.probeKnowledgeConnection(connection);
    if (current?.mode !== "remote" || current.url !== policy.url) {
      await host.session.saveKnowledgePolicy(policy);
    }
    host.session.knowledgeError = "";
    host.shell.showNotice("Remote knowledge connected for this team", "success");
  }

  async function disableKnowledge(): Promise<void> {
    await host.session.saveKnowledgePolicy(null);
    for (const team of host.workspaceController.teams) {
      const connection = (await listMcpConnections(host.repository, team.id)).find(isKnowledgeConnection);
      if (!connection)
        continue;
      await removeMcpConnection(host.repository, team.id, connection.id);
      await invoke("delete_connection_secret", { secretRef: connection.secretRef }).catch(() => undefined);
    }
    host.session.knowledgeConnection = null;
    host.shell.showNotice("Workspace knowledge disabled", "success");
  }

  async function refreshLocalModelRows(): Promise<void> {
    await host.assistant.refreshAssistantCatalog();
    host.shell.render();
    void host.runs.autopilot();
  }

  // Downloads run for minutes, so they are never awaited by a click handler — the progress events
  // drive the row, and only the outcome comes back here. Both toggles share one download: a second
  // call for the same model waits on the fetch already in flight (here, and again in Rust for the
  // calls this map never saw). Resolves to false when the download failed or was cancelled.
  function downloadLocalModel(modelId: string): Promise<boolean> {
    const running = host.assistant.localModelDownloads.get(modelId);
    if (running)
      return running;
    const download = host.localModels.download(modelId)
      .then(() => true)
      .catch((error) => {
        const message = errorText(error);
        if (message !== "Model download cancelled")
          host.shell.showNotice(message, "error");
        return false;
      })
      .finally(() => host.assistant.localModelDownloads.delete(modelId));
    host.assistant.localModelDownloads.set(modelId, download);
    return download;
  }

  /** Which start attempt per model is the live one, so an overtaken one stays out of the way. */
  const localModelStartAttempt = new Map<string, number>();

  // Boot can take up to a minute, so it is not awaited either — the row shows "Starting…" until the
  // runtime answers, and the user is free to leave Settings meanwhile.
  function runLocalModel(modelId: string): void {
    if (host.assistant.localModelStarting.has(modelId))
      return;
    host.assistant.localModelStarting.add(modelId);
    // Turning Run off and on again while the download is still going starts a second attempt, and
    // both share the one download. Without a mark of whose attempt this is, the first to finish
    // tidies up after the second and clears the intent the second just saved.
    const attempt = (localModelStartAttempt.get(modelId) ?? 0) + 1;
    localModelStartAttempt.set(modelId, attempt);
    const mine = (): boolean => localModelStartAttempt.get(modelId) === attempt;
    void host.localModels.wantRun(modelId)
      .then(() => downloadLocalModel(modelId))
      .then(async (downloaded) => {
        if (!mine())
          return;
        if (!downloaded) {
          // wantRun ran before the download, so a cancelled one has to take the intent with it.
          if (host.localModels.wantedRunId === modelId)
            await host.localModels.wantRun(null);
          return;
        }
        if (await host.localModels.run(modelId))
          await host.flueProjectPort.restart();
      })
      .catch(async (error) => {
        if (!mine())
          return;
        if (host.localModels.wantedRunId === modelId)
          await host.localModels.wantRun(null);
        host.shell.showNotice(errorText(error), "error");
      })
      .finally(() => {
        if (!mine())
          return;
        host.assistant.localModelStarting.delete(modelId);
        host.assistant.localModelProgress.delete(modelId);
        void refreshLocalModelRows();
      });
  }

  /** Ends the in-flight start so its result cannot undo whatever the user asked for next. */
  function cancelLocalModelStart(modelId: string): void {
    localModelStartAttempt.set(modelId, (localModelStartAttempt.get(modelId) ?? 0) + 1);
    host.assistant.localModelStarting.delete(modelId);
  }

  /** Stops a running model, or cancels its download when that is what the toggle turned off. */
  function stopLocalModel(modelId: string): void {
    const download = host.assistant.localModelDownloads.get(modelId);
    void host.localModels.stop(modelId)
      .then(async (wasRunning) => {
        // Cancellation is cooperative. Wait until the worker has left the native download map,
        // otherwise the refresh below immediately reports "downloading" again.
        await download;
        if (wasRunning)
          await host.flueProjectPort.restart();
        if (host.assistant.localModelProgress.get(modelId)?.state !== "cancelled")
          host.assistant.localModelProgress.delete(modelId);
        await refreshLocalModelRows();
      })
      .catch((error) => host.shell.showNotice(errorText(error), "error"));
  }

  async function connectAiProvider(provider: ApiKeyProvider): Promise<void> {
    host.shell.showNotice(host.session.AI_PROVIDER_HINT[provider], "info");
    const data = await edit(`Connect ${AI_PROVIDER_LABEL[provider]}`, [
      ...(provider === "openai-compatible"
        ? [{ name: "baseUrl", label: "Base URL", type: "text" as const, placeholder: "https://api.example.com/v1" }]
        : []),
      { name: "apiKey", label: "API key", type: "password", placeholder: "sk-..." }
    ]);
    if (!data)
      return;
    const { connection, secret } = connectApiKey(
      provider,
      String(data.get("apiKey") ?? ""),
      String(data.get("baseUrl") ?? "")
    );
    await invoke("store_connection_secret", { secretRef: connection.secretRef, secret });
    try {
      await addAiConnection(host.repository, host.session.aiConnectionScope(), connection);
    }
    catch (error) {
      await invoke("delete_connection_secret", { secretRef: connection.secretRef }).catch(() => undefined);
      throw error;
    }
    await host.assistant.refreshAssistantCatalog();
    await host.workspaceController.refresh();
    host.shell.showNotice(`Connected ${AI_PROVIDER_LABEL[provider]}`, "success");
  }

  async function discoverMcpConnection(connection: McpConnection): Promise<McpConnection> {
    const { baseUrl, token } = await host.ensureFlueRuntime();
    const reachable = await withBridgeUrl(connection);
    const response = await tauriFetch(`${baseUrl}/connections/discover`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      // A public API has no stored credential, so it is asked for nothing.
      body: JSON.stringify(
        reachable.authType === "none" ? { ...reachable, secretRef: undefined } : reachable
      )
    });
    const body = (await response.json()) as {
      tools?: McpConnection["tools"];
      error?: string;
    };
    if (!response.ok || !body.tools) {
      const failed = withMcpHealth(reachable, connection.tools, body.error ?? `HTTP ${response.status}`);
      await saveMcpConnection(host.repository, failed);
      throw new Error(failed.lastError ?? "MCP discovery failed");
    }
    const discovered = withMcpHealth(reachable, body.tools);
    // flue drops the server's readOnlyHint, so carry our own marks across a re-check
    const wasReadOnly = new Set(connection.tools.filter(({ readOnly }) => readOnly).map(({ name }) => name));
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
      },
      {
        name: "readOnlyTools",
        label: "Read-only tools",
        type: "checkboxes",
        hint: "Tools that only read. A goal task planned as read or prepare keeps these and loses every other tool on this connection.",
        options: discovered.tools.map(({ name }) => ({ label: name, value: name })),
        checked: discovered.tools.filter(({ name }) => wasReadOnly.has(name)).map(({ name }) => name)
      }
    ], "Save allowlist");
    const readOnly = new Set(data ? data.getAll("readOnlyTools").map(String) : [...wasReadOnly]);
    const saved = {
      ...discovered,
      // The port belongs to this run of the bridge, so storing it only shows a dead one later.
      url: connection.url,
      tools: discovered.tools.map((tool) => ({ ...tool, readOnly: readOnly.has(tool.name) })),
      allowedTools: data ? data.getAll("allowedTools").map(String) : discovered.allowedTools,
      updatedAt: new Date().toISOString()
    };
    await saveMcpConnection(host.repository, saved);
    return saved;
  }

  /** `found` prefills the form from a registry search; typing the endpoint by hand still works. */
  /**
   * Connect an API that ships no MCP server, from a request that already works.
   *
   * The curl is the specification: it names the address, the parameters and the credential, and it
   * has been proved by whoever pasted it. Bees writes the document, keeps the key in local storage and
   * runs the bridge, so nothing has to be written by hand.
   */
  async function addApiFromCurl(): Promise<void> {
    const data = await edit("Connect an API", [
      { name: "name", label: "Name", placeholder: "Freelancer projects" },
      {
        name: "curl",
        label: "An address, or a request that works",
        type: "textarea",
        placeholder: "https://api.example.com\n\nor\n\ncurl 'https://api.example.com/v1/things?limit=5' -H 'Authorization: Bearer abc'",
        hint: "An address on its own gets every endpoint the API will admit to. A curl gets that one endpoint, and carries its key."
      },
      { name: "offline", label: "When unavailable", type: "toggle", value: "required", options: [{ label: "Fail the run", value: "required" }, { label: "Continue without it", value: "optional" }] }
    ]);
    if (!data)
      return;
    const { baseUrl, token } = await host.ensureFlueRuntime().catch(() => ({ baseUrl: "", token: "" }));
    void baseUrl; void token;
    const modelUrl = await invoke<string>("local_model_base_url").catch(() => "");
    if (!modelUrl)
      throw new Error("Turn on a local AI model under Settings → Local AI first. Bees uses it once to name the endpoint.");
    // The endpoint is called in Rust: the plugin's scope names the hosts Bees knows, and the whole
    // point here is one it does not. The model runs on loopback, which the scope already allows.
    const input = String(data.get("curl") ?? "").trim();
    const name = String(data.get("name") ?? "");
    const teamId = host.workspaceController.workspace.teamId;
    const optional = data.get("offline") === "optional";
    let connection: McpConnection;
    let secret: string | undefined;
    let note: string;

    if (/^https?:\/\/\S+$/.test(input)) {
      // An address alone: ask the API what it offers rather than describing one request.
      const found = await discoverApi(input, (address) =>
        invoke<{ status: number; body: string }>("probe_api_endpoint", {
          request: { url: address, method: "GET", headers: {} }
        }));
      if (found.kind === "none") {
        throw new Error(
          `${found.how}. Paste a working curl for one of its endpoints instead.`
        );
      }
      connection = newMcpConnection({
        teamId, name, url: "", authType: "none", optional,
        bridge: {
          specUrl: found.specUrl ?? "",
          ...(found.spec ? { spec: found.spec } : {}),
          baseUrl: new URL(input).origin,
          tools: "all"
        }
      });
      note = `Connected ${name}: ${found.how}.`;
    }
    else {
      const generated = await specFromCurl(
        input,
        modelUrl,
        async (request, url) => (await invoke<{ status: number }>("probe_api_endpoint", {
          request: { url: url.toString(), method: request.method, headers: request.headers }
        })).status,
        tauriFetch
      );
      secret = generated.secret;
      connection = newMcpConnection({
        teamId, name, url: "", authType: generated.secret ? "api-key" : "none", optional,
        bridge: {
          specUrl: "",
          spec: generated.spec,
          baseUrl: generated.baseUrl,
          ...(generated.headerName ? { headerName: generated.headerName } : {}),
          tools: "all"
        }
      });
      note = generated.verified
        ? `Connected ${name}`
        : `Connected ${name}. The request was not repeated, because sending it again would do it.`;
    }
    if (secret) {
      await invoke("store_connection_secret", { secretRef: connection.secretRef, secret });
    }
    await saveMcpConnection(host.repository, connection);
    await discoverMcpConnection(connection);
    await host.workspaceController.refresh();
    host.shell.showNotice(note, "success");
  }

  async function addApiKeyMcp(found?: McpRegistryServer): Promise<void> {
    const data = await edit(found ? `Connect ${found.title}` : "Add MCP connection", [
      { name: "name", label: "Name", placeholder: "Linear", value: found?.title ?? "" },
      { name: "url", label: "HTTPS endpoint", placeholder: "https://example.com/mcp", value: found?.url ?? "" },
      { name: "token", label: "API key / bearer token", type: "password", hint: found ? "Get this from the server's own publisher. Bees keeps it in local app storage." : "" },
      { name: "transport", label: "Transport", type: "toggle", value: found?.transport ?? "streamable-http", options: [{ label: "Streamable HTTP", value: "streamable-http" }, { label: "Legacy SSE", value: "sse" }] },
      { name: "offline", label: "When unavailable", type: "toggle", value: "required", options: [{ label: "Fail the run", value: "required" }, { label: "Continue without it", value: "optional" }] }
    ]);
    if (!data)
      return;
    const connection = newMcpConnection({
      teamId: host.workspaceController.workspace.teamId,
      name: String(data.get("name") ?? ""),
      url: String(data.get("url") ?? ""),
      authType: "api-key",
      transport: String(data.get("transport")) as McpConnection["transport"],
      optional: data.get("offline") === "optional"
    });
    const secret = String(data.get("token") ?? "").trim();
    if (!secret)
      throw new Error("API key is required");
    await invoke("store_connection_secret", { secretRef: connection.secretRef, secret });
    try {
      await saveMcpConnection(host.repository, connection);
    }
    catch (error) {
      await invoke("delete_connection_secret", { secretRef: connection.secretRef }).catch(() => undefined);
      throw error;
    }
    await discoverMcpConnection(connection);
    await host.workspaceController.refresh();
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
    if (!data)
      return;
    const connection = newMcpConnection({
      teamId: host.workspaceController.workspace.teamId,
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
      await saveMcpConnection(host.repository, connection);
    }
    catch (error) {
      await invoke("delete_connection_secret", { secretRef: connection.secretRef }).catch(() => undefined);
      throw error;
    }
    await discoverMcpConnection(connection);
    await host.workspaceController.refresh();
  }

  /**
   * A collection is a moving target, so refreshing re-reads the marketplace rather than
   * trusting the paths recorded at install. An entry the publisher dropped says so plainly.
   */
  async function refreshCatalogRegistry(
    registryId: string,
    { repo, entry }: { repo: string; entry: string }
  ) {
    const found = (await pluginCatalog(repo)).find(({ name }) => name === entry);
    if (!found)
      throw new Error(`${repo} no longer publishes ${entry}`);
    return installCatalogPlugin(registryId, repo, found);
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  /** A newly selected model starts on Automatic; Pi supplies its supported explicit levels. */
  function linkModelThinking(): void {
    const model = host.shell.dialogForm.querySelector<HTMLSelectElement>('select[name="model"]');
    const thinking = host.shell.dialogForm.querySelector<HTMLSelectElement>('select[name="thinkingLevel"]');
    if (!model || !thinking)
      return;
    model.addEventListener("change", () => {
      const choice = parseModelRef(model.value);
      const options = thinkingOptionsForModel(choice ?? {});
      thinking.innerHTML = options
        .map(({ label, value }) => `<option value="${host.shell.escapeHtml(value)}">${host.shell.escapeHtml(label)}</option>`)
        .join("");
      thinking.value = "";
    });
  }

  /**
   * `footerLabel` adds a secondary link under the buttons; picking it submits with
   * `__action=footer` so the caller can tell it apart from the primary button.
   */
  function edit(titleText: string, fields: EditorField[], submitLabel = "Save", footerLabel = ""): Promise<FormData | null> {
    host.shell.dialogTitle.textContent = titleText;
    const saveButton = host.shell.dialog.querySelector<HTMLButtonElement>("#editor-save");
    if (saveButton) {
      saveButton.textContent = submitLabel;
      saveButton.disabled = false;
      saveButton.hidden = !submitLabel;
    }
    host.shell.dialogFooter.innerHTML = footerLabel
      ? `<button class="link link-primary text-sm" type="submit" name="__action" value="footer">${host.shell.escapeHtml(footerLabel)}</button>`
      : "";
    const stepLabels = {
      basics: "1 · Basics",
      instructions: "2 · Instructions",
      capabilities: "3 · Capabilities"
    } as const;
    const steps = [...new Set(fields.flatMap(({ step }) => step ? [step] : []))];
    host.shell.dialogFields.innerHTML = steps.length > 1
      ? `<nav class="join grid grid-cols-3" aria-label="Agent setup sections">${steps
        .map((step, index) => `<button class="btn join-item ${index ? "btn-ghost" : "btn-primary"}" type="button" data-editor-step-button="${step}">${stepLabels[step]}</button>`)
        .join("")}</nav>${steps
          .map((step, index) => `<section class="grid gap-4" data-editor-step="${step}" ${index ? "hidden" : ""}>${fields.filter((field) => field.step === step).map(host.views.editorFieldHtml).join("")}</section>`)
          .join("")}`
      : fields.map(host.views.editorFieldHtml).join("");
    const showStep = (step: string): void => {
      for (const section of host.shell.dialogFields.querySelectorAll<HTMLElement>("[data-editor-step]")) {
        section.hidden = section.dataset.editorStep !== step;
      }
      for (const button of host.shell.dialogFields.querySelectorAll<HTMLButtonElement>("[data-editor-step-button]")) {
        const active = button.dataset.editorStepButton === step;
        button.classList.toggle("btn-primary", active);
        button.classList.toggle("btn-ghost", !active);
      }
    };
    for (const button of host.shell.dialogFields.querySelectorAll<HTMLButtonElement>("[data-editor-step-button]")) {
      button.addEventListener("click", () => showStep(button.dataset.editorStepButton ?? ""));
    }
    // Filtering only hides choices. A checked box that scrolls out of view still submits, so
    // narrowing a long list never silently drops what the agent already had.
    for (const filter of host.shell.dialogFields.querySelectorAll<HTMLInputElement>("[data-editor-filter]")) {
      const list = host.shell.dialogFields
        .querySelector<HTMLElement>(`[data-editor-field="${filter.dataset.editorFilter}"]`);
      filter.addEventListener("input", () => {
        const needle = filter.value.trim().toLowerCase();
        for (const choice of list?.querySelectorAll<HTMLElement>(":scope > label") ?? []) {
          choice.hidden = needle.length > 0 && !(choice.textContent ?? "").toLowerCase().includes(needle);
        }
      });
    }
    const checkRequired = (): void => {
      if (saveButton) {
        saveButton.disabled = !host.shell.dialogForm.checkValidity();
      }
    };
    host.shell.dialogForm.addEventListener("input", checkRequired);
    checkRequired();

    linkModelThinking();
    host.shell.dialog.showModal();
    const focusFirstField = (): void => {
      const field = (host.shell.dialogFields.querySelector<HTMLElement>("[data-editor-step]:not([hidden])") ?? host.shell.dialogForm)
        .querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)');
      field?.focus();
      if (field instanceof HTMLInputElement && field.type === "text")
        field.select();
    };
    // WKWebView can drop a focus() issued while the dialog is still opening, leaving the
    // cursor outside the first field — focus again on the next frame so it sticks.
    focusFirstField();
    requestAnimationFrame(focusFirstField);
    return new Promise((resolve) => {
      let settled = false;
      const cancelButton = host.shell.dialog.querySelector<HTMLButtonElement>("[data-dialog-cancel]");
      const finish = (value: FormData | null) => {
        if (settled)
          return;
        settled = true;
        resolve(value);
      };
      const submit = async (event: SubmitEvent): Promise<void> => {
        event.preventDefault();
        const formData = new FormData(host.shell.dialogForm, event.submitter);
        // File inputs come back as File objects; convert to data URLs so callers get a string.
        for (const field of fields) {
          if (field.type !== "file")
            continue;
          const input = host.shell.dialogForm.querySelector<HTMLInputElement>(`input[name="${field.name}"]`);
          const file = input?.files?.[0];
          formData.set(field.name, file ? await readFileAsDataUrl(file) : "");
        }
        finish(formData);
        host.shell.dialog.close();
      };
      const close = () => {
        host.shell.dialogForm.removeEventListener("submit", submit);
        cancelButton?.removeEventListener("click", cancel);
        finish(null);
      };
      const cancel = () => host.shell.dialog.close();
      host.shell.dialogForm.addEventListener("submit", submit, { once: true });
      host.shell.dialog.addEventListener("close", close, { once: true });
      cancelButton?.addEventListener("click", cancel, { once: true });
    });
  }

  /**
   * A new task is a page, not a dialog: the file picker below needs the room. Called with a
   * stage from a board column or a scoped run, which fixes the workflow; called without one from
   * the team's +, which leaves the workflow to the form's picker.
   */
  // Empty for the team-level New task action; set to the displayed run when adding from its board.
  let newItemParentId = "";
  // The view to return to when closing the process editor (e.g. "item-new" when reached via
  // "Configure its agents" from the new-task form, or "board" in all other cases).
  let processEditorReturnView: View = "board";

  async function createItem(stageId?: string, parentId = ""): Promise<void> {
    if (stageId && !host.workspaceController.activeProcess)
      throw new Error("Open a board first");
    const process = host.workspaceController.activeProcess;
    newItemParentId = parentId;
    host.shell.newItemStageId = stageId ?? "";
    host.shell.newItemProcessId = host.shell.newItemStageId
      ? process!.id
      : process?.id ?? "";
    host.shell.newItemSources = await workItemFileSources();
    host.shell.view = "item-new";
    host.shell.render();
  }

  /**
   * The folders a work item can reference — the team folder, then every linked location mapped on
   * this machine — each with its files listed relative to that folder, which is the form a logical
   * reference takes. A folder that will not list (permissions, unplugged drive) comes back empty
   * rather than failing the whole page.
   */
  async function workItemFileSources(): Promise<FileSource[]> {
    const mapping = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
    const locations = await host.repository.listAvailableFileLocations(host.workspaceController.workspace.teamId);
    const roots = [
      ...(mapping?.localPath ? [{ id: "", name: "Team folder", path: mapping.localPath }] : []),
      ...locations.flatMap(({ id, name, localPath, missing }) => localPath && !missing ? [{ id, name, path: localPath }] : [])
    ];
    return Promise.all(roots.map(async ({ id, name, path }) => ({
      id,
      name,
      files: await invoke<string[]>("list_location_files", { path }).catch(() => [])
    })));
  }

  async function submitNewItem(data: FormData): Promise<void> {
    const workflowId = String(data.get("workflow") ?? "");
    let process = host.workspaceController.processes.find(({ id }) => id === workflowId);
    if (!process && workflowId.startsWith(PROCESS_LIBRARY_SELECTION_PREFIX)) {
      const template = processLibraryEntry(workflowId.slice(PROCESS_LIBRARY_SELECTION_PREFIX.length));
      if (template)
        process = await installLibraryProcess(template);
    }
    if (!process)
      throw new Error("Choose a process");
    const parent = newItemParentId
      ? host.workspaceController.teamItems.find(({ id, processId }) =>
        id === newItemParentId && processId === process.id)
      : undefined;
    if (newItemParentId && !parent)
      throw new Error("The run this task belongs to is no longer available");
    // A column add names its status exactly; the process's first status is only the fallback for
    // the top-level add action or when the selected workflow changes in the form.
    const stageId = process.stages.some(({ id }) => id === host.shell.newItemStageId)
      ? host.shell.newItemStageId
      : process.stages[0]?.id;
    if (!stageId)
      throw new Error(`${process.name} has no statuses`);
    const taskPlan = parent ? taskPlanStages(process) : null;
    const needsWorker = taskPlan?.work.id === stageId;
    const workerRole = String(data.get("workerRole") ?? "");
    const worker = needsWorker
      ? host.runs.taskWorkerRoles().find(({ role }) => role.toLowerCase() === workerRole.toLowerCase())
      : undefined;
    if (needsWorker && !worker)
      throw new Error("Choose an available worker");
    const interactive = processEngine.isInteractive(process);
    const itemId = await host.repository.createWorkItem(process.id, {
      stageId,
      ...(parent ? { parentId: parent.id } : {}),
      title: String(data.get("title") ?? ""),
      description: String(data.get("description") ?? ""),
      ...(worker ? {
        goal: {
          key: `manual:${crypto.randomUUID()}`,
          role: worker.role,
          effect: "prepare",
          planOutputId: null,
          authorizedAt: new Date().toISOString(),
          occurrenceOf: null
        }
      } : {}),
      logicalFiles: data.getAll("files").map(String)
    });
    // A child stays on the run it extended; a team-level task opens the new run it created.
    host.workspaceController.activeProcess = process;
    host.workspaceController.activeBoard =
      host.workspaceController.boards.find(({ processId }) => processId === process.id) ?? null;
    host.workspaceController.workspace.processId = process.id;
    host.shell.boardRootItemId = parent?.id ?? itemId;
    newItemParentId = "";
    host.shell.view = "board";
    await host.workspaceController.refresh();
    // Interactive workflows begin in their renderer, where the next human action is available.
    if (interactive) {
      host.shell.activeItemId = itemId;
      host.shell.view = "item";
      host.shell.render();
    }
  }

  /** Turns the selected, possibly edited tasks of a proposed plan into queued work items. */
  async function approvePlanSelection(
    output: ExecutionOutput,
    execution: Execution,
    teamRoot: string,
    proposed: PlannedTask[],
    data: FormData,
    indices: number[],
    finalize = true
  ): Promise<void> {
    const selected = new Set(indices.map(String));
    if (!selected.size)
      throw new Error("Select at least one task to approve");
    const edited = parseTaskPlan(JSON.stringify({
      tasks: proposed.flatMap((task, index): PlannedTask[] => selected.has(String(index))
        ? [{
          ...task,
          title: String(data.get(`task-${index}-title`) ?? task.title),
          description: String(data.get(`task-${index}-description`) ?? task.description),
          role: String(data.get(`task-${index}-role`) ?? task.role),
          effect: String(data.get(`task-${index}-effect`) ?? task.effect) as GoalTaskEffect,
          inputs: data.has(`task-${index}-inputs`) ? data.getAll(`task-${index}-inputs`).map(String) : task.inputs
        }]
        : [])
    }));
    for (const control of host.shell.app.querySelectorAll<HTMLButtonElement>('[data-action="approve-output"], [data-action="reject-output"]')) {
      if (control.dataset.id === output.id)
        control.disabled = true;
    }
    try {
      const count = await host.runs.taskPlanController.approveTaskPlan(output, execution, teamRoot, edited, finalize);
      host.shell.showNotice(count
        ? `${count} task${count === 1 ? "" : "s"} approved and queued`
        : "Plan approved; duplicate task keys were skipped", "success");
    }
    finally {
      // Reconcile controls with the database even if shared coordination fails afterward.
      await host.workspaceController.refresh();
    }
  }

  /** Expands one card's panel under the board and loads its fresh run history. */
  async function expandBoardItem(id: string, executionId = ""): Promise<void> {
    host.shell.boardItemId = id;
    host.shell.boardFileRef = "";
    host.shell.boardFileEditing = false;
    host.shell.boardItemEditing = false;
    const latest = host.runs.executions.find(({ workItemId }) => workItemId === id);
    if (latest)
      await host.runs.loadExecutionHistory(latest);
    const itemRunIds = new Set(host.runs.executions.filter(({ workItemId }) => workItemId === id).map(({ id: runId }) => runId));
    if (executionId && itemRunIds.has(executionId)) {
      host.shell.activeExecutionId = executionId;
      host.shell.boardTab = "conversation";
    }
    else {
      host.shell.activeExecutionId = "";
      host.shell.boardTab = "details";
    }
  }

  /** Saves an edit made in the kanban card's inline Files tab, then drops back to the preview. */
  async function saveBoardFile(data: FormData): Promise<void> {
    const reference = String(data.get("reference") ?? "");
    if (!reference)
      return;
    const contents = String(data.get("contents") ?? "");
    if (reference.startsWith(PENDING_FILE_PREFIX)) {
      const output = host.runs.executionOutputs.find(({ id }) => id === reference.slice(PENDING_FILE_PREFIX.length));
      const execution = output ? await host.repository.getExecution(output.executionId) : null;
      if (!output || !execution?.workspaceRef)
        throw new Error("The run workspace holding this output is no longer available");
      await host.workspaces.writeOutput(execution.workspaceRef, output.logicalOutput, contents);
    }
    else {
      const teamRoot = await host.workspaceController.requireTeamRoot();
      const locations = await host.repository.listAvailableFileLocations(host.workspaceController.workspace.teamId);
      await host.workspaces.writeLogicalFile(reference, teamRoot, locations, contents);
    }
    host.shell.boardFileEditing = false;
    host.shell.render();
  }

  function parseFileReferencesInput(value: string, locations: FileLocation[]): string[] {
    return value
      .split(",")
      .map((reference) => reference.trim())
      .filter(Boolean)
      .map((reference) => {
        if (!reference.startsWith("@"))
          return reference;
        const slash = reference.indexOf("/");
        if (slash < 2)
          throw new Error("Linked references use @Location name/path/to/file");
        const name = reference.slice(1, slash);
        const matches = locations.filter((location) => location.name.toLowerCase() === name.toLowerCase());
        if (matches.length !== 1)
          throw new Error(`Linked location "${name}" is not available`);
        return logicalFileReference(matches[0]!.id, reference.slice(slash + 1));
      });
  }

  /** A dashboard is bound to its process for life, so only the name and columns are editable. */
  async function editDashboard(board: Board): Promise<void> {
    const process = host.workspaceController.processes.find(({ id }) => id === board.processId);
    if (!process)
      throw new Error("This dashboard's process is archived");
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
        placeholder: "Done 24",
        hint: `One rule per line: condition then hours untouched (0 = always). Conditions: ${boardFilterConditionLabels.join(", ")}.`
      }
    ]);
    if (!data)
      return;
    await host.repository.updateBoard(board.id, host.workspaceController.workspace.teamId, {
      name: String(data.get("name") ?? ""),
      processId: process.id,
      stageIds: data.getAll("stages").map(String),
      filters: parseBoardFilters(String(data.get("filters") ?? ""))
    });
    host.shell.view = "board";
    await host.workspaceController.refresh();
  }

  // Tab the user was on before opening the item edit form, so Cancel puts them back there.
  let boardTabBeforeEdit: BoardItemTab = "details";

  document.addEventListener("click", async (event) => {
    // Table rows with data-action behave like buttons (e.g. the Inbox row opening its item), so a
    // click anywhere on the row works without every cell needing its own button.
    const button = (event.target as Element).closest<HTMLElement>("button, tr[data-action], article[data-action], input[data-action]");
    // The assistant panel and the wizard's coach mark run their own delegation — both live
    // outside #app and their buttons share no data-action vocabulary with the views.
    if (!button || button.closest("dialog") || button.closest("#assistant") || button.closest("#tour"))
      return;
    try {
      if (button.dataset.view) {
        host.shell.view = button.dataset.view as View;
        if (button.dataset.settingsTab)
          host.shell.settingsTab = button.dataset.settingsTab as SettingsTab;
        host.shell.render();
        return;
      }
      if (button.dataset.settingsTab) {
        host.shell.settingsTab = button.dataset.settingsTab as SettingsTab;
        host.shell.render();
        return;
      }
      if (button.dataset.teamTab) {
        host.shell.teamTab = button.dataset.teamTab as TeamTab;
        host.shell.render();
        return;
      }
      if (button.dataset.boardTab) {
        host.shell.boardTab = button.dataset.boardTab as BoardItemTab;
        host.shell.boardItemEditing = false;
        host.shell.render();
        return;
      }
      if (button.dataset.teamView) {
        const teamId = button.dataset.team!;
        const nextView = button.dataset.teamView as View;
        if (nextView === "schedules")
          host.shell.configProcessId = "";
        // Otherwise navigating into a collapsed team lands on a page whose sidebar section is shut.
        host.shell.expandTeam(teamId);
        if (teamId !== host.workspaceController.workspace.teamId)
          await host.workspaceController.switchTeam(teamId, nextView);
        else {
          host.shell.view = nextView;
          host.shell.render();
        }
        return;
      }
      if (button.dataset.board) {
        // A dashboard in another team: switch to that team first so `boards`/`processes` hold it.
        const boardTeam = button.dataset.team;
        if (boardTeam && boardTeam !== host.workspaceController.workspace.teamId)
          await host.workspaceController.switchTeam(boardTeam);
        host.workspaceController.activeBoard = host.workspaceController.boards.find(({ id }) => id === button.dataset.board) ?? null;
        host.workspaceController.activeProcess = host.workspaceController.processes.find(({ id }) => id === host.workspaceController.activeBoard?.processId) ?? null;
        host.workspaceController.workspace.processId = host.workspaceController.activeProcess?.id ?? "";
        host.workspaceController.items = host.workspaceController.activeProcess
          ? host.workspaceController.teamItems.filter(
            ({ processId }) => processId === host.workspaceController.activeProcess?.id
          )
          : [];
        // A nav row carries the task it opened; the dashboard link itself carries none, which
        // is how the board goes back to showing every run of the workflow.
        host.shell.boardRootItemId = button.dataset.root ?? "";
        host.shell.boardItemId = "";
        host.shell.view = "board";
        host.shell.render();
        return;
      }
      const action = button.dataset.action;
      for (const renderer of host.workspaceController.processRenderers) {
        if (await renderer.handleAction(action ?? "", button))
          return;
      }
      if (action === "start-tour") {
        startTour();
        return;
      }
      if (action === "reset-tour") {
        await host.repository.setSetting(TOUR_MARKDOWN_KEY, DEFAULT_TOUR);
        host.shell.showNotice("Reset to the wizard Bees ships with", "success");
        host.shell.render();
        return;
      }
      if (action === "knowledge-local") {
        try {
          await configureLocalKnowledge();
        }
        catch (error) {
          host.session.knowledgeError = errorText(error);
          host.shell.showNotice(host.session.knowledgeError, "error");
        }
        await host.workspaceController.refresh();
        return;
      }
      if (action === "knowledge-remote") {
        try {
          await configureRemoteKnowledge();
        }
        catch (error) {
          host.session.knowledgeError = errorText(error);
          host.shell.showNotice(host.session.knowledgeError, "error");
        }
        await host.workspaceController.refresh();
        return;
      }
      if (action === "knowledge-disable") {
        await disableKnowledge();
        await host.workspaceController.refresh();
        return;
      }
      if (action === "open-item") {
        const id = button.dataset.id!;
        const executionId = button.dataset.execution ?? "";
        const item = host.workspaceController.teamItems.find((candidate) => candidate.id === id);
        const process = item ? host.workspaceController.processes.find(({ id: processId }) => processId === item.processId) : null;
        const renderer = process
          ? host.workspaceController.processRenderers.find((candidate) => candidate.id === processEngine.renderer(process))
          : null;
        // Interactive processes keep their studio page; everything else opens on its board
        // with the card expanded in place.
        if (item && process && !renderer) {
          host.workspaceController.activeBoard = host.workspaceController.boards.find(({ processId }) => processId === process.id) ?? null;
          host.workspaceController.activeProcess = process;
          host.workspaceController.workspace.processId = process.id;
          host.workspaceController.items = host.workspaceController.teamItems.filter(({ processId }) => processId === process.id);
          // Scope the board to the run this item belongs to, or a subtask opened from the
          // Inbox would land on a board that filters its own card out.
          host.shell.boardRootItemId = rootItemId(host.workspaceController.items, id);
          await expandBoardItem(id, executionId);
          host.shell.view = "board";
          host.shell.render();
          return;
        }
        host.shell.activeItemId = id;
        host.shell.activeExecutionId = executionId;
        const latest = host.runs.executions.find(({ workItemId }) => workItemId === id);
        if (latest)
          await host.runs.loadExecutionHistory(latest);
        host.shell.view = "item";
        host.shell.render();
        return;
      }
      // A card opens in place, under the board, rather than navigating away — clicking the
      // already-open card keeps it open, so the detail panel only changes when another card
      // is picked.
      if (action === "toggle-board-item") {
        const id = button.dataset.id!;
        if (host.shell.boardItemId === id)
          return;
        await expandBoardItem(id);
        host.shell.render();
        return;
      }
      if (action === "toggle-board-item-edit") {
        if (host.shell.boardItemEditing) {
          host.shell.boardItemEditing = false;
          host.shell.boardTab = boardTabBeforeEdit;
        }
        else {
          boardTabBeforeEdit = host.shell.boardTab;
          host.shell.boardTab = "details";
          host.shell.boardItemEditing = true;
        }
        host.shell.render();
        return;
      }
      if (action === "view-board-file") {
        host.shell.boardTab = "files";
        host.shell.boardFileRef = button.dataset.ref ?? "";
        host.shell.boardFileEditing = false;
        host.shell.render();
        return;
      }
      if (action === "select-board-file") {
        host.shell.boardFileRef = button.dataset.ref ?? "";
        host.shell.boardFileEditing = false;
        host.shell.render();
        return;
      }
      if (action === "toggle-board-file-edit") {
        host.shell.boardFileEditing = !host.shell.boardFileEditing;
        host.shell.render();
        return;
      }
      if (action === "expand-msg" || action === "collapse-msg") {
        const id = button.dataset.msg;
        if (!id) return;
        const shortEl = document.querySelector(`[data-msg-short="${id}"]`);
        const fullEl = document.querySelector(`[data-msg-full="${id}"]`);
        if (!shortEl || !fullEl) return;
        if (action === "expand-msg") {
          (shortEl as HTMLElement).hidden = true;
          (fullEl as HTMLElement).hidden = false;
        } else {
          (shortEl as HTMLElement).hidden = false;
          (fullEl as HTMLElement).hidden = true;
        }
        return;
      }
      // Panel switch is a visibility toggle, never a re-render: the other agents' edits are in the
      // same form and would be thrown away by one.
      if (action === "select-process-agent") {
        host.shell.configAgentId = button.dataset.id!;
        for (const pane of host.shell.app.querySelectorAll<HTMLElement>("[data-agent-pane]")) {
          pane.hidden = pane.dataset.agentPane !== host.shell.configAgentId;
        }
        for (const row of host.shell.app.querySelectorAll<HTMLElement>("[data-agent-row]")) {
          const chosen = row.dataset.agentRow === host.shell.configAgentId;
          row.classList.toggle("border-primary", chosen);
          row.classList.toggle("bg-primary/5", chosen);
          row.classList.toggle("border-base-300", !chosen);
          row.classList.toggle("bg-base-100", !chosen);
        }
        return;
      }
      if (action === "reload-process-agents") {
        host.shell.render();
        return;
      }
      if (action === "add-process-agent") {
        const triggerStageId = button.dataset.stage!;
        const context = host.views.triggerContext(triggerStageId);
        if (context && !processEngine.allowsMultipleAgents(context.process, triggerStageId) &&
          host.workspaceController.agents.some((agent) => agent.triggerStageId === triggerStageId))
          throw new Error(`${context.stageName} already has an agent`);
        await commitProcessAgentEdits();
        const created = newAgent({ name: "New agent", purpose: "Handles work in this status", triggerStageId });
        await writeAgent(created, true);
        host.shell.configAgentId = created.id;
        await host.workspaceController.refresh();
        return;
      }
      if (action === "open-folder-settings") {
        host.shell.settingsTab = "team-folder";
        host.shell.view = "settings";
        host.shell.render();
        return;
      }
      if (action === "open-run") {
        await host.runs.openRun(button.dataset.id!);
        return;
      }
      if (action === "clear-search") {
        host.shell.searchQuery = "";
        host.shell.searchHits = [];
        host.shell.render();
        return;
      }
      if (action === "archive-skill") {
        const name = button.dataset.name ?? "this skill";
        // A move, not a delete — so one confirmation is enough and the undo is a drag in Finder.
        if (!(await edit(`Retire "${name}"? Its folder moves to the team plugin's skills/.archive.`, [], "Retire"))) {
          return;
        }
        const teamRoot = await host.workspaceController.requireTeamRoot();
        await host.agentFiles.archiveSkill(teamRoot, button.dataset.slug!);
        await host.workspaceController.ensureTeamSkillsRegistry(teamRoot);
        await host.workspaceController.refresh();
        host.shell.showNotice(`Retired "${name}" to the team plugin's skills/.archive`, "success");
        return;
      }
      if (action === "curate-skills") {
        await curateSkills();
        return;
      }
      if (action === "discard-curator-plan") {
        host.assistant.curatorPlan = null;
        host.shell.render();
        return;
      }
      if (action === "apply-curator-plan") {
        await applyCuratorProposal();
        return;
      }
      if (action === "dismiss-run") {
        host.runs.dismissedRunIds.add(button.dataset.id!);
        await host.repository.setSetting(host.runs.DISMISSED_RUNS_KEY, [...host.runs.dismissedRunIds]);
        host.shell.render();
        host.shell.showNotice("Run dismissed", "success");
        return;
      }
      if (action === "stop-run") {
        const execution = await host.repository.getExecution(button.dataset.id!);
        if (!execution)
          return;
        await host.runCoordinator.stop(execution.id);
        await host.runs.releaseClaim(execution.workItemId);
        await host.workspaceController.refresh();
        host.shell.showNotice("Run stopped", "success");
        return;
      }
      if (action === "stop-workflow-run") {
        const activeExecutions = activeExecutionsInItemTree(
          host.workspaceController.teamItems,
          host.runs.executions,
          button.dataset.id!
        );
        for (const execution of activeExecutions)
          await host.runCoordinator.stop(execution.id);
        for (const workItemId of new Set(activeExecutions.map(({ workItemId }) => workItemId)))
          await host.runs.releaseClaim(workItemId).catch(() => undefined);
        await host.workspaceController.refresh();
        host.shell.showNotice("Run stopped; other runs are still running", "success");
        return;
      }
      if (action === "delete-run") {
        await host.runs.deleteRun(button.dataset.id!);
        return;
      }
      if (action === "restart-run") {
        const execution = await host.repository.getExecution(button.dataset.id!);
        // A clean execution and conversation: the old snapshot's instructions and capabilities
        // may no longer be safe to reuse, so it is linked, never mutated or resumed.
        if (execution)
          await host.runs.runItem(execution.workItemId, false, undefined, execution.id);
        return;
      }
      if (action === "preview-inbox-output") {
        const output = host.runs.executionOutputs.find(({ id }) => id === button.dataset.id);
        const execution = output ? await host.repository.getExecution(output.executionId) : null;
        const mapping = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
        const panel = host.shell.app.querySelector<HTMLElement>("[data-inbox-output-preview]");
        const title = panel?.querySelector<HTMLElement>("[data-inbox-output-preview-title]");
        const body = panel?.querySelector<HTMLElement>("[data-inbox-output-preview-body]");
        const approve = panel?.querySelector<HTMLButtonElement>("[data-inbox-output-preview-approve]");
        if (!output || !execution?.workspaceRef || !mapping || !panel || !title || !body || !approve)
          throw new Error("File preview is unavailable");
        const preview = await host.workspaces.preview(execution.workspaceRef, output.logicalOutput, mapping.localPath, output.logicalDestination);
        title.textContent = output.logicalDestination;
        body.replaceChildren();
        if (preview.after === null) {
          body.textContent = "Preview unavailable for this binary file.";
        }
        else if (/\.mdx?$/i.test(output.logicalOutput)) {
          body.innerHTML = renderMarkdown(preview.after);
        }
        else {
          const pre = document.createElement("pre");
          pre.className = "whitespace-pre-wrap break-words text-xs";
          pre.textContent = preview.after;
          body.append(pre);
        }
        if (preview.truncated) {
          const note = document.createElement("p");
          note.className = "mt-3 text-xs text-warning";
          note.textContent = "Preview truncated to 256 KB.";
          body.append(note);
        }
        approve.dataset.id = output.id;
        approve.setAttribute("aria-label", `Approve ${output.logicalDestination}`);
        approve.disabled = execution.status === "queued" || execution.status === "running";
        panel.hidden = false;
        for (const control of host.shell.app.querySelectorAll<HTMLElement>('[data-action="preview-inbox-output"]'))
          control.setAttribute("aria-expanded", String(control === button));
        panel.scrollIntoView({ block: "nearest" });
        return;
      }
      if (action === "close-inbox-output-preview") {
        const panel = host.shell.app.querySelector<HTMLElement>("[data-inbox-output-preview]");
        if (panel)
          panel.hidden = true;
        for (const control of host.shell.app.querySelectorAll<HTMLElement>('[data-action="preview-inbox-output"]'))
          control.setAttribute("aria-expanded", "false");
        return;
      }
      if (action === "preview-output") {
        const output = host.runs.executionOutputs.find(({ id }) => id === button.dataset.id);
        const execution = output ? await host.repository.getExecution(output.executionId) : null;
        const mapping = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
        if (!output || !execution?.workspaceRef || !mapping)
          throw new Error("Output preview is unavailable");
        host.runs.outputPreviews.set(output.id, await host.workspaces.preview(execution.workspaceRef, output.logicalOutput, mapping.localPath, output.logicalDestination));
        await host.views.renderRunDetail();
        return;
      }
      if (action === "view-markdown-output") {
        const output = host.runs.executionOutputs.find(({ id }) => id === button.dataset.id);
        const execution = output ? await host.repository.getExecution(output.executionId) : null;
        const mapping = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
        if (!output || !execution?.workspaceRef || !mapping || !/\.md$/i.test(output.logicalOutput)) {
          throw new Error("Markdown preview is unavailable");
        }
        host.shell.markdownTitle.textContent = output.logicalOutput;
        host.shell.markdownBody.innerHTML = renderMarkdown(await host.workspaces.readOutput(execution.workspaceRef, output.logicalOutput, mapping.localPath));
        host.shell.markdownDialog.showModal();
        return;
      }
      if (action === "approve-output") {
        const output = host.runs.executionOutputs.find(({ id }) => id === button.dataset.id);
        const execution = output ? await host.repository.getExecution(output.executionId) : null;
        const mapping = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
        if (!output || !execution?.workspaceRef || !mapping)
          throw new Error("Output is unavailable");
        if (host.runs.taskPlanController.matchesOutput(output.logicalOutput, execution)) {
          const proposed = await host.runs.taskPlanController.readTaskPlan(output, execution, mapping.localPath);
          const item = await host.repository.getWorkItem(execution.workItemId);
          if (!item)
            throw new Error("The goal is unavailable");
          const roles = host.runs.taskWorkerRoles();
          const fields: EditorField[] = [
            {
              name: "selectedTasks",
              label: "Tasks to approve",
              type: "checkboxes",
              options: proposed.map((task, index) => ({
                label: task.title,
                value: String(index),
                description: `${task.effect} · ${task.role} · ${task.description}`
              })),
              checked: [],
              hint: "Select each task you authorize. Unselected tasks are discarded with this plan."
            },
            ...proposed.flatMap((task, index): EditorField[] => [
              {
                name: `task-${index}-title`,
                label: `${index + 1}. Title`,
                value: task.title
              },
              {
                name: `task-${index}-description`,
                label: `${index + 1}. Instructions and acceptance criteria`,
                type: "textarea",
                value: task.description
              },
              {
                name: `task-${index}-role`,
                label: `${index + 1}. Worker role`,
                type: "select",
                value: task.role,
                options: roles.map(({ role, purpose }) => ({ label: role, value: role, description: purpose }))
              },
              {
                name: `task-${index}-effect`,
                label: `${index + 1}. Effect`,
                type: "select",
                value: task.effect,
                options: [
                  { label: "Read only", value: "read" },
                  { label: "Prepare outputs", value: "prepare" },
                  { label: "External action", value: "external_write" }
                ]
              },
              {
                name: `task-${index}-inputs`,
                label: `${index + 1}. Approved inputs`,
                type: "checkboxes",
                options: item.logicalFiles.map((path) => ({ label: path, value: path })),
                checked: task.inputs
              }
            ])
          ];
          const data = await edit("Approve goal tasks", fields, "Approve selected");
          if (!data)
            return;
          await approvePlanSelection(output, execution, mapping.localPath, proposed, data,
            data.getAll("selectedTasks").map(Number));
          return;
        }
        // ponytail: approve publishes to the output's own destination; no rename prompt.
        const destination = output.logicalDestination;
        await host.runs.enforceControl(host.runs.controlInput("output.publish", { type: "execution_output", id: output.id, attributes: { destination: "team-folder" } }, { agentId: execution.agentId }), true);
        await host.workspaces.publishApproved(execution.workspaceRef, output.logicalOutput, mapping.localPath, destination);
        await host.repository.decideExecutionOutput(output.id, "approved", destination);
        await host.runs.finishOutputReview(execution);
        await host.workspaceController.refresh();
        host.shell.showNotice("File approved and copied to the team folder", "success");
        return;
      }
      if (action === "reject-output") {
        const output = host.runs.executionOutputs.find(({ id }) => id === button.dataset.id);
        const execution = output ? await host.repository.getExecution(output.executionId) : null;
        if (!output || !execution)
          return;
        // The reason is the only instruction the retry gets, so ask for it here rather than
        // leaving the agent to guess what was wrong with the same task it just did.
        const data = await edit(host.runs.taskPlanController.matchesOutput(output.logicalOutput, execution)
          ? "Reject task plan"
          : "Reject file change", [
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
        ], "Reject");
        if (!data)
          return;
        const reason = String(data.get("reason") ?? "");
        const item = host.workspaceController.teamItems.find(({ id }) => id === execution.workItemId);
        if (data.get("scope") === "future" && !reason.trim()) {
          throw new Error("Add a reason before saving feedback for future items");
        }
        await host.repository.decideExecutionOutput(output.id, "rejected", undefined, reason);
        const undo = data.get("scope") === "future" && item && !isProposal(execution)
          ? await host.runs.rememberRejection(item, reason)
          : undefined;
        await host.runs.finishOutputReview(execution);
        await host.workspaceController.refresh();
        host.shell.showNotice(undo
          ? "Rejected — feedback saved for future items"
          : host.runs.taskPlanController.matchesOutput(output.logicalOutput, execution)
            ? "Task plan rejected — the planner will try again"
            : "File change rejected — the agent will try again", "success", undo);
        if (!undo && item && !isProposal(execution)) {
          void host.runs.proposeSkillEdit(item).catch((error) => host.shell.showNotice(errorText(error), "error"));
        }
        return;
      }
      if (action === "download-receipt") {
        const execution = await host.repository.getExecution(button.dataset.id!);
        const item = execution ? await host.repository.getWorkItem(execution.workItemId) : null;
        if (!execution || !item)
          throw new Error("Run receipt is unavailable");
        const contents = runReceipt(execution, item, host.workspaceController.agents.find(({ id }) => id === execution.agentId) ?? null, await host.repository.listExecutionOutputs(execution.id));
        const url = URL.createObjectURL(new Blob([contents], { type: "text/markdown" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `bees-run-${execution.id}.md`;
        link.click();
        URL.revokeObjectURL(url);
        return;
      }
      if (action === "new-schedule") {
        const schedulable = host.scheduleItems();
        if (!schedulable.length)
          throw new Error("Create a work item before adding a schedule");
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const roles = host.runs.taskWorkerRoles();
        const data = await edit("New schedule", [
          { name: "name", label: "Name", value: "Scheduled work" },
          {
            name: "workItemId",
            label: "Work item",
            type: "select",
            options: schedulable.map(({ id, title }) => ({ label: title, value: id }))
          },
          {
            name: "mode",
            label: "On each occurrence",
            type: "select",
            value: "run",
            options: [
              { label: "Run this item again", value: "run" },
              { label: "Create a new task-plan occurrence", value: "spawn_goal" }
            ],
            hint: "Task-plan occurrences preserve history and can propose separately approved actions."
          },
          {
            name: "role",
            label: "Occurrence worker role",
            type: "select",
            value: roles[0]?.role ?? "",
            options: roles.map(({ role }) => ({ label: role, value: role })),
            hint: "Used only when creating a task-plan occurrence."
          },
          {
            name: "recurrence",
            label: "Recurrence",
            type: "select",
            value: "daily",
            options: ["hourly", "daily", "weekdays"].map((value) => ({ label: value, value }))
          },
          {
            name: "time",
            label: "Time of day",
            value: "07:00",
            placeholder: "07:00",
            hint: "Ignored by an hourly schedule, which runs an hour from now."
          },
          { name: "timezone", label: "Timezone", value: timezone }
        ]);
        if (!data)
          return;
        const recurrence = String(data.get("recurrence")) as Schedule["recurrence"];
        const mode = String(data.get("mode")) as Schedule["mode"];
        const workItemId = String(data.get("workItemId"));
        const scheduledItem = host.workspaceController.teamItems.find(({ id }) => id === workItemId);
        const scheduledProcess = scheduledItem
          ? host.workspaceController.processes.find(({ id }) => id === scheduledItem.processId)
          : null;
        if (mode === "spawn_goal" && (!scheduledItem || !hasTaskPlanCapability(scheduledProcess))) {
          throw new Error("New task-plan occurrences require a task-plan work item");
        }
        const role = mode === "spawn_goal" ? String(data.get("role")) : null;
        if (mode === "spawn_goal" && !roles.some((worker) => worker.role === role)) {
          throw new Error("Choose an available goal worker role");
        }
        const nextRunAt = nextScheduleStart(recurrence, String(data.get("time")), new Date(), String(data.get("timezone"))).toISOString();
        await host.workflowRuntime.command(workItemId, {
          type: "upsert_schedule",
          schedule: {
            id: crypto.randomUUID(),
            name: String(data.get("name")),
            recurrence,
            mode,
            ...(role ? { role } : {}),
            timezone: String(data.get("timezone")),
            enabled: true,
            nextRunAt
          }
        });
        await host.workspaceController.refresh();
        return;
      }
      if (action === "run-schedule") {
        const schedule = host.runs.schedules.find(({ id }) => id === button.dataset.id);
        if (schedule) {
          await host.workflowRuntime.command(schedule.workItemId, {
            type: "trigger_schedule",
            scheduleId: schedule.id
          });
          await host.runs.runScheduledOccurrence(schedule, false);
        }
        return;
      }
      if (action === "toggle-schedule") {
        const schedule = host.runs.schedules.find(({ id }) => id === button.dataset.id);
        if (schedule) {
          await host.workflowRuntime.command(schedule.workItemId, {
            type: "toggle_schedule",
            scheduleId: schedule.id,
            enabled: !schedule.enabled
          });
          await host.workspaceController.refresh();
        }
        return;
      }
      if (action === "delete-schedule") {
        const schedule = host.runs.schedules.find(({ id }) => id === button.dataset.id);
        if (schedule) {
          await host.workflowRuntime.command(schedule.workItemId, {
            type: "delete_schedule",
            scheduleId: schedule.id
          });
        }
        await host.workspaceController.refresh();
        return;
      }
      if (action === "switch-org") {
        await host.session.switchConnection(button.dataset.id!, button.dataset.account ?? "");
        return;
      }
      if (action === "toggle-color-mode") {
        await host.shell.saveTheme(host.shell.DARK_THEMES.has(host.shell.themePreset) ? host.shell.lightDefaultTheme : host.shell.darkDefaultTheme);
        host.shell.render();
        return;
      }
      if (action === "exit-app") {
        await getCurrentWindow().close();
        return;
      }
      if (action === "sign-in" || action === "signin-email" || action === "signup-email" || action === "social-signin") {
        const result = action === "signup-email"
          ? await host.session.signUpUser()
          : action === "social-signin"
            ? await host.session.socialSignInUser(button.dataset.provider ?? "google")
            : await host.session.signInUser();
        if (result) {
          // Pool every account. Connect it to the current org only if that connected org has none.
          await host.session.rememberAccount(result.user, result.token);
          if (host.session.orgIsConnected(host.workspaceController.workspace.organizationId) && !host.session.orgHasConnection(host.workspaceController.workspace.organizationId)) {
            await host.session.connect(host.workspaceController.workspace.organizationId, result.user, result.token);
            host.session.activeUserId = result.user.id;
          }
          try {
            await host.session.reconcileServerOrgs();
          }
          catch (error) {
            host.shell.showNotice(errorText(error), "error");
          }
          await host.workspaceController.refresh();
          host.shell.showNotice(`Signed in as ${result.user.email}`, "success");
        }
        return;
      }
      if (action === "accept-invite") {
        // Accept as the account the invite was sent to (any pooled account, not just the current org's).
        const account = host.session.accounts.get(button.dataset.account!);
        if (!account)
          return;
        const { membership } = await host.api.acceptMyInvitation(account.token, button.dataset.id!);
        await host.session.connect(membership.workspaceId, account.user, account.token);
        await host.session.switchConnection(membership.workspaceId, account.user.id);
        host.shell.showNotice("Joined workspace", "success");
        return;
      }
      if (action === "login-org") {
        // The row already names the account — connect it straight away, no "which account?" prompt.
        const account = host.session.accounts.get(button.dataset.account!);
        if (!account)
          return;
        await host.session.connect(button.dataset.id!, account.user, account.token);
        await host.session.switchConnection(button.dataset.id!, account.user.id);
        host.shell.showNotice(`Signed in as ${account.user.email}`, "success");
        return;
      }
      if (action === "logout-org") {
        await host.session.disconnect(button.dataset.id!, button.dataset.account!);
        return;
      }
      if (action === "invite-org-member") {
        const data = await edit("Invite to workspace", [
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
          const token = host.session.orgToken();
          if (!token)
            throw new Error("Sign in to this workspace first");
          await host.api.createWorkspaceInvitation(token, host.workspaceController.workspace.organizationId, String(data.get("email") ?? ""), String(data.get("role") ?? "member") as "admin" | "member");
          host.shell.showNotice("Invitation sent", "success");
        }
        return;
      }
      if (action === "create-workspace") {
        await host.session.createWorkspace();
        return;
      }
      if (action === "rename-org") {
        const org = host.session.currentOrganization();
        if (!org)
          return;
        const data = await edit("Rename workspace", [
          { name: "name", label: "Workspace name", value: org.name }
        ]);
        const name = String(data?.get("name") ?? "").trim();
        if (!name)
          return;
        const renameToken = host.session.orgToken();
        if (host.session.orgIsConnected() && renameToken)
          await host.api.renameWorkspace(renameToken, org.id, name);
        await host.repository.renameOrganization(org.id, name);
        await host.session.reconcileServerOrgs().catch(() => { });
        await host.workspaceController.refresh();
        host.shell.showNotice("Workspace renamed", "success");
        return;
      }
      if (action === "connect-ai") {
        await connectAiProvider(button.dataset.provider as ApiKeyProvider);
        return;
      }
      if (action === "remove-ai-connection") {
        const connection = (await listAiConnections(host.repository, host.session.aiConnectionScope())).find(({ id }) => id === button.dataset.id);
        const warning = connection
          ? await invoke<string | null>("delete_connection_secret", { secretRef: connection.secretRef })
          : null;
        await removeAiConnection(host.repository, host.session.aiConnectionScope(), button.dataset.id!);
        await host.assistant.refreshAssistantCatalog();
        await host.workspaceController.refresh();
        host.shell.showNotice(warning ?? "Connection removed", warning ? "error" : "success");
        return;
      }
      if (action === "find-mcp") {
        const asked = await edit("Find an MCP server", [{
          name: "query",
          label: "What should the server do?",
          placeholder: "salesforce",
          hint: "Searches the public MCP registry. Only servers with a hosted HTTPS endpoint are listed, because Bees runs no local MCP servers."
        }], "Search");
        if (!asked)
          return;
        const found = await searchMcpRegistry(String(asked.get("query") ?? ""));
        if (!found.length) {
          host.shell.showNotice("No hosted MCP server matched that search.", "info");
          return;
        }
        const picked = await edit("Hosted MCP servers", [{
          name: "server",
          label: "Server",
          type: "select",
          options: found.map((server) => ({
            value: server.name,
            label: `${server.title} · ${server.url}${server.description ? ` — ${server.description}` : ""}`
          })),
          hint: "Anyone may publish to the registry, and an agent's tool calls go to whoever runs the server. Check the publisher before connecting."
        }], "Continue");
        if (!picked)
          return;
        const server = found.find(({ name }) => name === String(picked.get("server")));
        if (server)
          await addApiKeyMcp(server);
        return;
      }
      if (action === "add-mcp-api") {
        await addApiKeyMcp();
        return;
      }
      if (action === "add-mcp-from-curl") {
        await addApiFromCurl();
        return;
      }
      if (action === "add-mcp-oauth") {
        await addOAuthMcp();
        return;
      }
      if (action === "test-mcp") {
        const connection = host.workspaceController.mcpConnections.find(({ id }) => id === button.dataset.id);
        if (!connection)
          return;
        await discoverMcpConnection(connection);
        await host.workspaceController.refresh();
        host.shell.showNotice("MCP connection is healthy", "success");
        return;
      }
      if (action === "remove-mcp") {
        const connection = host.workspaceController.mcpConnections.find(({ id }) => id === button.dataset.id);
        if (!connection)
          return;
        const warning = await invoke<string | null>("delete_connection_secret", {
          secretRef: connection.secretRef
        });
        await removeMcpConnection(host.repository, host.workspaceController.workspace.teamId, connection.id);
        await host.workspaceController.refresh();
        host.shell.showNotice(warning ?? "MCP connection removed", warning ? "error" : "success");
        return;
      }
      if (action === "codex-login") {
        const { baseUrl, token } = await host.ensureFlueRuntime();
        host.shell.showNotice("Starting Codex sign-in…", "info");
        const started = await tauriFetch(`${baseUrl}/oauth/openai-codex/start`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` }
        });
        const device = await started.json() as {
          verificationUri?: string;
          userCode?: string;
          error?: string;
        };
        if (!started.ok || !device.verificationUri || !device.userCode)
          throw new Error(device.error ?? "Codex sign-in failed");
        await openUrl(device.verificationUri);
        host.shell.showNotice(`Enter Codex code ${device.userCode} in your browser`, "info");
        const completed = await tauriFetch(`${baseUrl}/oauth/openai-codex/await`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` }
        });
        const result = await completed.json() as { credential?: string; error?: string };
        if (!completed.ok || !result.credential)
          throw new Error(result.error ?? "Codex sign-in failed");
        const scope = host.session.aiConnectionScope();
        const existing = (await listAiConnections(host.repository, scope))
          .find(({ provider }) => provider === "openai-codex");
        const connected = connectOAuthCredential("openai-codex", result.credential);
        const connection = existing ?? connected.connection;
        const secret = connected.secret;
        await invoke("store_connection_secret", { secretRef: connection.secretRef, secret });
        if (!existing) {
          try {
            await addAiConnection(host.repository, scope, connection);
          } catch (error) {
            await invoke("delete_connection_secret", { secretRef: connection.secretRef }).catch(() => undefined);
            throw error;
          }
        }
        await host.assistant.refreshAssistantCatalog();
        await host.workspaceController.refresh();
        host.shell.showNotice(existing ? "Codex connection renewed" : "Codex is signed in", "success");
        return;
      }
      if (action === "toggle-cli-tool") {
        const enabled = (button as HTMLInputElement).checked;
        await setCliToolEnabled(button.dataset.tool ?? "", enabled);
        // The runtime learns about a CLI from an environment variable set at launch, so it has
        // to come back up before the change reaches runs.
        await host.flueProjectPort.restart();
        await host.workspaceController.refresh();
        host.shell.showNotice(enabled ? "AI subscription switched on" : "AI subscription switched off", "success");
        return;
      }
      if (action === "pick-cli-tool" || action === "clear-cli-tool") {
        // No extension filter: these CLIs ship as bare executables on macOS and Linux.
        const picked = action === "clear-cli-tool" ? "" : await open({ multiple: false });
        if (typeof picked !== "string")
          return;
        await setCliToolPath(button.dataset.tool ?? "", picked);
        // The path reaches the CLI providers as an environment variable set at launch.
        await host.flueProjectPort.restart();
        await host.workspaceController.refresh();
        host.shell.showNotice(picked ? "Claude Code path saved" : "Claude Code disconnected", "success");
        return;
      }
      if (action === "browse-local-model") {
        const selected = await open({
          multiple: false,
          filters: [{ name: "Model", extensions: ["gguf"] }]
        });
        const field = document.querySelector<HTMLInputElement>("[data-local-model-source]");
        if (typeof selected === "string" && field)
          field.value = selected;
        return;
      }
      if (action === "add-local-model") {
        const field = document.querySelector<HTMLInputElement>("[data-local-model-source]");
        await host.localModels.add(field?.value ?? "");
        await host.workspaceController.refresh();
        return;
      }
      if (action === "delete-local-model") {
        const model = (await host.localModels.list()).find(({ id }) => id === button.dataset.model);
        if (!model)
          return;
        const kept = model.localPath ? " Your own copy of the file stays where it is." : "";
        if (!(await edit(`Delete "${model.name}"?`, [], "Delete")))
          return;
        const wasRunning = await host.localModels.remove(model.id);
        if (wasRunning)
          await host.flueProjectPort.restart();
        host.assistant.localModelProgress.delete(model.id);
        await host.assistant.refreshAssistantCatalog();
        await host.workspaceController.refresh();
        host.shell.showNotice(`Deleted ${model.name}.${kept}`, "success");
        return;
      }
      if (action === "open-external") {
        // daisyUI dropdowns stay open while focus is inside them, so a help link would leave the
        // popup hanging over the sidebar after the browser takes over.
        button.blur();
        await openUrl(button.dataset.url!);
        return;
      }
      if (action === "remove-logo") {
        const org = host.session.currentOrganization();
        if (!org)
          return;
        const next = host.session.brandingFor(org.id);
        delete host.session.orgBranding[org.id];
        if (next.color)
          host.session.orgBranding[org.id] = { color: next.color };
        await host.session.saveBranding();
        await host.workspaceController.refresh();
        return;
      }
      if (action === "delete-org") {
        const org = host.session.currentOrganization();
        if (!org)
          return;
        const data = await edit(`Delete "${org.name}"?`, [{ name: "confirm", label: "Type the workspace name to confirm", placeholder: org.name }], "Delete");
        if (!data)
          return;
        if (String(data.get("confirm") ?? "").trim() !== org.name) {
          host.shell.showNotice("Name did not match — not deleted", "error");
          return;
        }
        const deleteToken = host.session.orgToken();
        if (host.session.orgIsConnected() && deleteToken)
          await host.api.deleteWorkspace(deleteToken, org.id);
        for (const key of [...host.session.connections]) {
          if (host.session.connParts(key).orgId === org.id)
            host.session.connections.delete(key);
        }
        host.session.connectedOrgs.delete(org.id);
        await host.session.persistConnections();
        await host.repository.setSetting("connected_org_ids", JSON.stringify([...host.session.connectedOrgs]));
        await host.repository.deleteOrganization(org.id);
        const remaining = (await host.repository.listOrganizations()).filter(({ id }) => id !== org.id);
        if (remaining[0]) {
          await host.workspaceController.switchOrganization(remaining[0].id);
        }
        else {
          host.workspaceController.workspace.organizationId = "";
          host.session.activeUserId = "";
          host.shell.view = "settings";
          host.shell.settingsTab = "workspaces";
          await host.workspaceController.refresh();
        }
        host.shell.showNotice("Workspace deleted", "success");
        return;
      }
      if (action === "delete-team") {
        const team = host.session.currentTeam();
        if (!team)
          return;
        const data = await edit(`Delete "${team.name}"?`, [{ name: "confirm", label: "Type the team name to confirm", placeholder: team.name }], "Delete");
        if (!data)
          return;
        if (String(data.get("confirm") ?? "").trim() !== team.name) {
          host.shell.showNotice("Name did not match — not deleted", "error");
          return;
        }
        await host.repository.deleteTeam(team.id);
        const remaining = (await host.repository.listTeams(host.workspaceController.workspace.organizationId)).filter(({ id }) => id !== team.id);
        if (remaining[0]) {
          await host.workspaceController.switchTeam(remaining[0].id, "overview");
        }
        else {
          host.workspaceController.workspace.teamId = "";
          host.shell.view = "settings";
          await host.workspaceController.refresh();
        }
        host.shell.showNotice("Team deleted", "success");
        return;
      }
      if (action === "sign-out") {
        await host.session.disconnect(host.workspaceController.workspace.organizationId, host.session.activeUserId);
        return;
      }
      if (action === "sign-out-account") {
        await host.session.signOutAccount(button.dataset.id!);
        return;
      }
      if (action === "start-team-trial") {
        const token = host.session.orgToken();
        if (!token)
          throw new Error("Sign in to this workspace first");
        await host.api.startTeamTrial(token, host.workspaceController.workspace.organizationId);
        await host.session.reconcileServerOrgs();
        host.shell.view = "settings";
        host.shell.settingsTab = "team-members";
        await host.workspaceController.refresh();
        host.shell.showNotice("Trial running for 30 days", "success");
        return;
      }
      if (action === "new-server-team") {
        const data = await edit("New team", [{ name: "name", label: "Team name" }]);
        if (data) {
          const name = String(data.get("name") ?? "");
          const serverTeamId = await host.session.createServerTeam(name);
          if (!serverTeamId)
            return;
          // Mirror it locally under the server id; this used to create the team on the server only,
          // leaving it invisible in the nav until some other code path happened to pull it.
          await host.repository.createTeam(host.workspaceController.workspace.organizationId, name, serverTeamId);
          await host.workspaceController.ensureOrgFolders();
          await host.workspaceController.refresh();
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
          const token = host.session.orgToken();
          if (!token)
            throw new Error("Sign in to this workspace first");
          const { invitation } = await host.api.createTeamInvitation(token, host.workspaceController.workspace.organizationId, button.dataset.team!, String(data.get("email") ?? ""), String(data.get("role") ?? "member") as "admin" | "member");
          host.shell.showNotice(`Invite created. Share this token: ${invitation.token}`, "success");
        }
        return;
      }
      if (action === "remove-org-member") {
        const token = host.session.orgToken();
        if (!token)
          throw new Error("Sign in to this workspace first");
        const confirmed = await edit(`Remove ${button.dataset.email} from the workspace?`, [], "Remove");
        if (!confirmed)
          return;
        await host.api.removeMember(token, host.workspaceController.workspace.organizationId, button.dataset.user!);
        host.shell.showNotice("Member removed", "success");
        host.shell.render();
        return;
      }
      if (action === "promote-team-member") {
        const token = host.session.orgToken();
        if (!token)
          throw new Error("Sign in to this workspace first");
        await host.api.setTeamMemberRole(token, host.workspaceController.workspace.organizationId, button.dataset.team!, button.dataset.user!, "admin");
        host.shell.render();
        return;
      }
      if (action === "set-theme-preset" && host.shell.isThemePreset(button.dataset.themePreset)) {
        await host.shell.saveTheme(button.dataset.themePreset);
        host.shell.render();
        return;
      }
      if (action === "new-workspace") {
        await host.session.createWorkspace();
        return;
      }
      if (action === "new-team") {
        if (!host.workspaceController.workspace.organizationId)
          return; // no org to attach the team to
        const data = await edit("New team", [{ name: "name", label: "Team name" }]);
        if (data) {
          const name = String(data.get("name") ?? "");
          // Shared workspaces are billed per team, so the server owns the count — register there first,
          // then reuse the id it assigned so other desktops resolve the same team.
          let serverTeamId: string | undefined;
          if (host.session.orgIsConnected()) {
            serverTeamId = (await host.session.createServerTeam(name)) ?? undefined;
            if (!serverTeamId)
              return;
          }
          const teamId = await host.repository.createTeam(host.workspaceController.workspace.organizationId, name, serverTeamId);
          await host.workspaceController.ensureOrgFolders();
          await host.workspaceController.switchTeam(teamId);
        }
      }
      if (action === "edit-board") {
        const board = host.workspaceController.boards.find(({ id }) => id === button.dataset.id);
        if (board)
          await editDashboard(board);
      }
      if (action === "new-item-in-stage")
        await createItem(button.dataset.stage, host.shell.boardRootItemId);
      if (action === "new-task") {
        if (button.dataset.team && button.dataset.team !== host.workspaceController.workspace.teamId)
          await host.workspaceController.switchTeam(button.dataset.team);
        await createItem();
        return;
      }
      if (action === "cancel-new-item") {
        host.shell.view = "board";
        host.shell.render();
      }
      if (action === "archive-item") {
        if (button.dataset.team && button.dataset.team !== host.workspaceController.workspace.teamId)
          await host.workspaceController.switchTeam(button.dataset.team);
        const item = host.workspaceController.teamItems.find(({ id }) => id === button.dataset.id);
        const tree = item ? itemTree(host.workspaceController.teamItems, item.id) : [];
        const activeExecutions = item
          ? activeExecutionsInItemTree(host.workspaceController.teamItems, host.runs.executions, item.id)
          : [];
        const impact = [
          activeExecutions.length
            ? `${activeExecutions.length} active run${activeExecutions.length === 1 ? "" : "s"} will be stopped.`
            : "",
          tree.length > 1
            ? `${tree.length - 1} subtask${tree.length === 2 ? "" : "s"} will also be archived.`
            : "",
          "The task will appear in Completed Runs with an Archived outcome."
        ].filter(Boolean).join(" ");
        if (item && await edit(`Archive "${item.title}"?`, [
          { name: "impact", label: "", type: "note", value: impact }
        ], activeExecutions.length ? "Stop and archive" : "Archive")) {
          for (const execution of activeExecutions)
            await host.runCoordinator.stop(execution.id);
          for (const workItemId of new Set(activeExecutions.map(({ workItemId }) => workItemId)))
            await host.runs.releaseClaim(workItemId).catch(() => undefined);
          await host.workflowRuntime.command(item.id, { type: "archive" });
          if (host.shell.boardItemId === item.id)
            host.shell.boardItemId = "";
          if (host.shell.boardRootItemId === item.id)
            host.shell.boardRootItemId = "";
          await host.workspaceController.refresh();
        }
        return;
      }
      if (action === "edit-item") {
        if (button.dataset.team && button.dataset.team !== host.workspaceController.workspace.teamId)
          await host.workspaceController.switchTeam(button.dataset.team);
        const item = host.workspaceController.teamItems.find(({ id }) => id === button.dataset.id)!;
        const process = host.workspaceController.processes.find(({ id }) => id === item.processId)!;
        const locations = await host.repository.listAvailableFileLocations(host.workspaceController.workspace.teamId);
        const data = await edit("Edit work item", [
          { name: "title", label: "Title", value: item.title },
          { name: "description", label: "Description", type: "textarea", value: item.description },
          {
            name: "stageId",
            label: "Status",
            type: "select",
            value: item.stageId,
            options: process.stages.map(({ id, name }) => ({ value: id, label: name }))
          },
          {
            name: "archived",
            label: "Archived",
            type: "switch",
            value: item.archivedAt ? "true" : "false"
          },
          {
            name: "files",
            label: "File references",
            value: host.views.displayFileReferences(item.logicalFiles, locations).join(", "),
            hint: host.views.fileReferenceHint(locations)
          }
        ]);
        if (data) {
          const archived = data.get("archived") === "true";
          const stageId = String(data.get("stageId") ?? "");
          if (!process.stages.some(({ id }) => id === stageId))
            throw new Error("Choose a valid status");
          await host.repository.updateWorkItem(item.id, {
            title: String(data.get("title") ?? ""),
            description: String(data.get("description") ?? ""),
            owner: item.owner ?? "",
            logicalFiles: parseFileReferencesInput(String(data.get("files") ?? ""), locations)
          });
          if (archived !== Boolean(item.archivedAt)) {
            await host.workflowRuntime.command(item.id, {
              type: archived ? "archive" : "restore"
            });
          }
          if (stageId !== item.stageId)
            await host.workflowRuntime.command(item.id, { type: "move", targetStageId: stageId });
          await host.workspaceController.refresh();
        }
      }
      if (action === "start-process" || action === "stop-process") {
        // Running is toggled from the left menu and from the process page, and both refresh the
        // view — the open agent edits are written first so the click cannot drop them.
        if (host.shell.view === "process")
          await commitProcessAgentEdits();
        await host.runs.setProcessRunning(button.dataset.id!, action === "start-process");
        return;
      }
      if (action === "browse-process-library") {
        if (button.dataset.team && button.dataset.team !== host.workspaceController.workspace.teamId) {
          await host.workspaceController.switchTeam(button.dataset.team);
        }
        await host.assistant.refreshAssistantCatalog();
        host.shell.view = "process-library";
        host.shell.render();
        return;
      }
      if (action === "close-process-editor") {
        host.shell.view = processEditorReturnView;
        processEditorReturnView = "board";
        host.shell.render();
        return;
      }
      if (action === "copy-library-process") {
        await copyLibraryProcess(button.dataset.template ?? "");
        return;
      }
      // New and Edit are the same page: one blank, one loaded. Both keep the agent lanes below.
      if (action === "new-process" || action === "edit-process") {
        if (button.dataset.team && button.dataset.team !== host.workspaceController.workspace.teamId) {
          await host.workspaceController.switchTeam(button.dataset.team, "board");
        }
        // Remember where we came from so Cancel can return there (e.g. "item-new").
        processEditorReturnView = host.shell.view;
        host.shell.configProcessId = action === "edit-process" ? button.dataset.id! : "";
        host.shell.configAgentId = "";
        host.shell.view = "process";
        host.shell.render();
        return;
      }
      if (action === "open-process-runs") {
        if (button.dataset.team && button.dataset.team !== host.workspaceController.workspace.teamId) {
          await host.workspaceController.switchTeam(button.dataset.team, "board");
        }
        host.shell.configProcessId = button.dataset.id!;
        host.shell.openRunItemId = "";
        host.shell.openRunStepId = "";
        host.shell.view = "process-runs";
        host.shell.render();
        return;
      }
      if (action === "open-process-schedules") {
        if (button.dataset.team && button.dataset.team !== host.workspaceController.workspace.teamId) {
          await host.workspaceController.switchTeam(button.dataset.team, "board");
        }
        host.shell.configProcessId = button.dataset.id!;
        host.shell.view = "schedules";
        host.shell.render();
        return;
      }
      if (action === "open-process-run") {
        host.shell.openRunItemId = button.dataset.id!;
        host.shell.openRunStepId = "";
        host.shell.render();
        return;
      }
      if (action === "open-process-run-step") {
        // Clicking the open step again closes it, so the sequence can be read on its own.
        host.shell.openRunStepId = host.shell.openRunStepId === button.dataset.id! ? "" : button.dataset.id!;
        host.shell.render();
        return;
      }
      if (action === "toggle-team") {
        host.shell.toggleTeamCollapsed(button.dataset.team!);
        host.views.renderNavigation();
        return;
      }
      if (action === "archive-process") {
        const process = host.workspaceController.processes.find(({ id }) => id === button.dataset.id);
        // Asked for only where the button reads "Delete". Archiving is reversible from
        // Team settings → Archived, but its work items go off the board either way.
        if (button.dataset.confirm && process &&
          !(await edit(`Delete ${process.name}? Its board and tasks are archived with it, and can be restored from Team settings → Archived.`, [], "Delete")))
          return;
        await host.repository.archiveProcess(button.dataset.id!);
        if (host.shell.configProcessId === button.dataset.id) {
          host.shell.configProcessId = "";
          host.shell.view = "board";
        }
        await host.workspaceController.refresh();
      }
      if (action === "restore-process") {
        await host.repository.restoreProcess(button.dataset.id!);
        await host.workspaceController.refresh();
      }
      if (action === "duplicate-agent") {
        const agent = host.workspaceController.agents.find(({ id }) => id === button.dataset.id)!;
        if (host.shell.view === "process")
          await commitProcessAgentEdits();
        // No trigger status on the copy: two agents on one status is the one thing that
        // would make a run ambiguous, and the point of a copy is to edit it first.
        const copy = newAgent({ ...agent, name: `${agent.name} copy`, triggerStageId: null });
        await writeAgent(copy);
        await host.workspaceController.refresh();
        host.shell.showNotice(`Created ${copy.name}`, "success");
        return;
      }
      if (action === "delete-agent") {
        const agent = host.workspaceController.agents.find(({ id }) => id === button.dataset.id)!;
        if (!(await edit(`Delete ${agent.name}? This removes its file from the team folder.`, [], "Delete")))
          return;
        await host.agentFiles.remove(await host.workspaceController.requireTeamRoot(), agent.id);
        if (host.runs.disabledAgentIds.delete(agent.id)) {
          await host.repository.setSetting(`disabled_agents:${host.workspaceController.workspace.teamId}`, [...host.runs.disabledAgentIds]);
        }
        try {
          if (host.shell.view === "process")
            await commitProcessAgentEdits(agent.id, true);
        }
        catch (error) {
          await host.workspaceController.refresh();
          host.shell.showNotice(`Deleted ${agent.name}. Other agent changes were not saved: ${errorText(error)}`, "info");
          return;
        }
        await host.workspaceController.refresh();
        host.shell.showNotice(`Deleted ${agent.name}`, "success");
        return;
      }
      if (action === "add-org-location" || action === "add-team-location") {
        const selected = await open({ directory: true, multiple: false, recursive: true });
        if (typeof selected !== "string")
          return;
        const validated = await host.workspaces.validateDirectory(selected);
        const data = await edit("Add linked file location", [
          {
            name: "name",
            label: "Location name",
            value: selected.split(/[\\/]/).filter(Boolean).at(-1) ?? "Shared files",
            hint: action === "add-org-location"
              ? "Available to every team in this workspace."
              : "Available only to this team."
          }
        ], "Add");
        if (!data)
          return;
        await host.repository.createFileLocation({
          organizationId: host.workspaceController.workspace.organizationId,
          teamId: action === "add-team-location" ? host.workspaceController.workspace.teamId : null,
          name: String(data.get("name") ?? ""),
          localPath: validated
        });
        await host.workspaceController.refresh();
        host.shell.showNotice("Linked location added. File contents remain in the selected folder.", "success");
        return;
      }
      if (action === "map-file-location") {
        const selected = await open({ directory: true, multiple: false, recursive: true });
        if (typeof selected === "string") {
          await host.repository.setFileLocationMapping(button.dataset.id!, await host.workspaces.validateDirectory(selected));
          await host.workspaceController.refresh();
        }
        return;
      }
      if (action === "remove-file-location") {
        if (!(await edit(`Remove the linked location "${button.dataset.name}"? Files in the folder will not be deleted.`, [], "Remove")))
          return;
        await host.repository.deleteFileLocation(button.dataset.id!);
        await host.workspaceController.refresh();
        host.shell.showNotice("Linked location removed. Files on disk were not changed.", "success");
        return;
      }
      if (action === "pick-global-folder" || action === "pick-folder") {
        const selected = await open({ directory: true, multiple: false, recursive: true });
        if (typeof selected === "string") {
          const validated = await host.workspaces.validateDirectory(selected);
          if (action === "pick-global-folder") {
            await host.repository.setSetting("global_local_path", validated);
            await host.workspaceController.ensureOrgFolders();
          }
          else {
            await host.repository.setTeamFolder(host.workspaceController.workspace.teamId, validated);
          }
          host.shell.render();
        }
      }
      if (action === "new-skill") {
        const teamRoot = await host.workspaceController.requireTeamRoot();
        const data = await edit("New skill", [
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
        ], "Create");
        if (!data)
          return;
        const path = await host.agentFiles.saveSkill(teamRoot, String(data.get("name") ?? ""), String(data.get("description") ?? ""), String(data.get("body") ?? ""));
        await host.workspaceController.ensureTeamSkillsRegistry(teamRoot);
        await host.workspaceController.refresh();
        host.shell.showNotice(`Skill written to ${path}`, "success");
        return;
      }
      if (action === "browse-catalog") {
        const source = await edit("Browse plugin collections", [{
          name: "repo",
          label: "Collection",
          type: "select",
          options: PLUGIN_CATALOG.map(({ repo, label, note }) => ({ value: repo, label: `${label} — ${note}` })),
          hint: "Collections are read live from GitHub. Refreshing an installed plugin later takes whatever it says then."
        }], "Browse");
        if (!source)
          return;
        const repo = String(source.get("repo") ?? "");
        // A plugin with no skills carries only agents, commands, or hooks, which are each
        // client's own business under Agent Plugins 1.0.0. Installing one would load nothing.
        const entries = (await pluginCatalog(repo)).filter(({ skills }) => skills.length);
        if (!entries.length) {
          host.shell.showNotice(`${repo} publishes no skills Bees can load.`, "info");
          return;
        }
        const picked = await edit(`Install from ${repo}`, [{
          name: "entry",
          label: "Plugin",
          type: "select",
          options: entries.map(({ name, description, skills }) => ({
            value: name,
            label: `${name} · ${skills.length} skill(s)${description ? ` — ${description}` : ""}`
          })),
          hint: "Bees loads skills and remote MCP servers. Agents, commands, and hooks are client-specific and are left behind."
        }], "Install");
        if (!picked)
          return;
        const entry = entries.find(({ name }) => name === String(picked.get("entry")));
        if (!entry)
          return;
        const id = crypto.randomUUID();
        const plugin = await installCatalogPlugin(id, repo, entry);
        await host.repository.saveRegistry({
          id,
          teamId: host.workspaceController.workspace.teamId,
          name: plugin.manifest.name,
          sourcePath: catalogSourcePath(repo, entry.name),
          plugin
        });
        await host.workspaceController.refresh();
        host.shell.showNotice(
          `Installed ${plugin.manifest.name}: ${plugin.skills.length} skill(s), ${plugin.mcpServers.length} MCP server(s)${plugin.issues.length ? `, ${plugin.issues.length} warning(s)` : ""}`,
          plugin.issues.length ? "info" : "success"
        );
        return;
      }
      if (action === "add-registry") {
        const selected = await open({ directory: true, multiple: false, recursive: true });
        if (typeof selected !== "string")
          return;
        const id = crypto.randomUUID();
        const plugin = await host.registryFiles.copy(id, selected);
        await host.repository.saveRegistry({
          id,
          teamId: host.workspaceController.workspace.teamId,
          name: plugin.manifest.name,
          sourcePath: selected,
          plugin
        });
        await host.workspaceController.refresh();
        host.shell.showNotice(
          `Installed ${plugin.manifest.name}: ${plugin.skills.length} skill(s), ${plugin.mcpServers.length} MCP server(s)${plugin.issues.length ? `, ${plugin.issues.length} warning(s)` : ""}`,
          plugin.issues.length ? "info" : "success"
        );
        return;
      }
      if (action === "connect-site") {
        const mapping = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
        if (!mapping?.localPath) {
          host.shell.showNotice("Set a team folder first — it keys this team's browser profile.", "error");
          return;
        }
        const { baseUrl, token } = await host.ensureFlueRuntime();
        const response = await tauriFetch(`${baseUrl}/browser/open`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ profileKey: mapping.localPath, url: "about:blank" })
        });
        if (!response.ok) {
          host.shell.showNotice(`Could not open browser: ${await response.text()}`, "error");
          return;
        }
        host.shell.showNotice("Chrome opened. Log in, then close the window — the session is saved.", "success");
        return;
      }
      if (action === "refresh-registry") {
        const registry = host.workspaceController.registries.find(({ id }) => id === button.dataset.id);
        if (!registry)
          return;
        const catalog = parseCatalogSourcePath(registry.sourcePath);
        const plugin = catalog
          ? await refreshCatalogRegistry(registry.id, catalog)
          : registry.sourcePath.startsWith("bundled://")
            ? await host.registryFiles.copyBundled(registry.id)
            : await host.registryFiles.copy(registry.id, registry.sourcePath);
        await host.repository.saveRegistry({ ...registry, name: plugin.manifest.name, plugin });
        await host.workspaceController.refresh();
        host.shell.showNotice(
          `Refreshed ${plugin.manifest.name}${plugin.issues.length ? ` with ${plugin.issues.length} warning(s)` : ""}`,
          plugin.issues.length ? "info" : "success"
        );
        return;
      }
      if (action === "remove-registry") {
        const registry = host.workspaceController.registries.find(({ id }) => id === button.dataset.id);
        if (!registry)
          return;
        await host.registryFiles.remove(registry.id);
        await host.repository.removeRegistry(registry.id);
        await host.workspaceController.refresh();
        return;
      }
      if (action === "use-default-folder") {
        await host.repository.clearTeamFolder(host.workspaceController.workspace.teamId);
        host.shell.render();
      }
    }
    catch (error) {
      // The user is looking at the button they just clicked, so a toast is enough — this is not
      // the silent, unattended failure `reportFailure`'s persistent record exists to catch, and
      // most throws here are precondition guards ("select a task first"), not real failures.
      host.shell.showNotice(errorText(error), "error");
    }
  });

  // A folder's checkbox sits inside its <summary>, where a plain click would also open the folder.
  // Taking over both actions keeps ticking a folder from collapsing the tree under it.
  host.shell.app.addEventListener("click", (event) => {
    const folder = (event.target as Element).closest<HTMLInputElement>("input[data-folder-check]");
    const row = folder?.closest("li");
    if (!folder || !row)
      return;
    event.preventDefault();
    folder.checked = !folder.checked;
    for (const box of row.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      if (box !== folder)
        box.checked = folder.checked;
    }
  });

  // Live preview for the Files-tab editor: the right pane re-renders as the left one is typed in.
  host.shell.app.addEventListener("input", (event) => {
    const area = (event.target as Element).closest<HTMLTextAreaElement>('form[data-board-file-form] textarea[name="contents"]');
    const preview = area?.form?.querySelector("[data-board-file-preview]");
    if (!area || !preview)
      return;
    preview.innerHTML = area.form!.dataset.markdown !== undefined
      ? renderMarkdown(area.value)
      : `<pre class="whitespace-pre-wrap break-words text-xs">${host.shell.escapeHtml(area.value)}</pre>`;
  });

  /** Forms with a write already in flight. Outside the listener so it survives between events. */
  const submitting = new WeakSet<HTMLFormElement>();

  host.shell.app.addEventListener("submit", (event) => {
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    /** Every branch hands work to a floating promise, so a double-click on Create made two work items. */
    const once = (form: HTMLFormElement, run: () => Promise<unknown>): void => {
      if (submitting.has(form)) return;
      submitting.add(form);
      if (submitter) submitter.disabled = true;
      void run()
        .catch((error) => host.shell.showNotice(errorText(error), "error"))
        .finally(() => {
          submitting.delete(form);
          if (submitter) submitter.disabled = false;
        });
    };

    const newItemForm = (event.target as Element).closest<HTMLFormElement>("form[data-new-item]");
    if (newItemForm) {
      event.preventDefault();
      once(newItemForm, () => submitNewItem(new FormData(newItemForm)));
      return;
    }
    const tourForm = (event.target as Element).closest<HTMLFormElement>("form[data-tour-form]");
    if (tourForm) {
      event.preventDefault();
      once(tourForm, () => saveTourMarkdown(String(new FormData(tourForm).get("markdown") ?? "")));
      return;
    }
    const definitionForm = (event.target as Element).closest<HTMLFormElement>("form[data-process-form]");
    if (definitionForm) {
      event.preventDefault();
      once(definitionForm, () => saveProcessDefinition(new FormData(definitionForm)));
      return;
    }
    const boardFileForm = (event.target as Element).closest<HTMLFormElement>("form[data-board-file-form]");
    if (boardFileForm) {
      event.preventDefault();
      once(boardFileForm, () => saveBoardFile(new FormData(boardFileForm)));
      return;
    }
    const agentsForm = (event.target as Element).closest<HTMLFormElement>("form[data-process-agents]");
    if (agentsForm) {
      event.preventDefault();
      once(agentsForm, () => saveProcessAgents(agentsForm));
      return;
    }
    const processForm = (event.target as Element).closest<HTMLFormElement>("form");
    const renderer = processForm
      ? host.workspaceController.processRenderers.find((candidate) => candidate.handlesSubmit(processForm))
      : undefined;
    if (processForm && renderer) {
      event.preventDefault();
      once(processForm, () => renderer.handleSubmit(processForm));
      return;
    }
    const assistant = (event.target as Element).closest<HTMLFormElement>("form[data-overview-assistant]");
    if (assistant) {
      event.preventDefault();
      const data = new FormData(assistant);
      const message = String(data.get("message") ?? "").trim();
      const submit = assistant.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (!message || submit?.disabled)
        return;
      if (submit) {
        submit.disabled = true;
        submit.textContent = "Going…";
      }
      void (async () => {
        await host.assistant.rememberModelChoice(AUTO_MODEL_CHOICE);
        await toggleAssistant(true);
        await sendAssistantMessage(message);
      })().catch((error) => {
        if (submit?.isConnected) {
          submit.disabled = false;
          submit.textContent = "Go";
        }
        host.shell.showNotice(errorText(error), "error");
      });
      return;
    }
    const search = (event.target as Element).closest<HTMLFormElement>("form[data-run-search]");
    if (search) {
      event.preventDefault();
      host.shell.searchQuery = String(new FormData(search).get("query") ?? "");
      void (async () => {
        host.shell.searchHits = host.shell.searchQuery.trim()
          ? await host.repository.search(host.workspaceController.workspace.teamId, host.shell.searchQuery)
          : [];
        host.shell.render();
      })().catch((error) => host.shell.showNotice(errorText(error), "error"));
      return;
    }
    const form = (event.target as Element).closest<HTMLFormElement>("form[data-run-followup]");
    if (!form)
      return;
    event.preventDefault();
    const message = String(new FormData(form).get("message") ?? "").trim();
    const executionId = form.dataset.runFollowup;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!message || !executionId || submit?.disabled)
      return;
    if (submit)
      submit.disabled = true;
    void (async () => {
      const execution = host.runs.executions.find(({ id }) => id === executionId) ??
        (await host.repository.getExecution(executionId));
      if (!execution)
        throw new Error("Run not found");
      await host.runs.runItem(execution.workItemId, false, { execution, message });
    })().catch((error) => {
      if (submit)
        submit.disabled = false;
      host.shell.showNotice(errorText(error), "error");
    });
  });

  host.shell.app.addEventListener("keydown", (event) => {
    const input = (event.target as Element).closest<HTMLTextAreaElement>("form[data-run-followup] textarea, form[data-overview-assistant] textarea");
    if (!input || event.key !== "Enter" || event.shiftKey)
      return;
    event.preventDefault();
    input.form?.requestSubmit();
  });

  // Inline org branding controls save on change (no popup).
  document.addEventListener("change", (event) => {
    const themeDefault = (event.target as Element).closest<HTMLSelectElement>("[data-theme-default]");
    if (themeDefault && host.shell.isThemePreset(themeDefault.value)) {
      const mode = themeDefault.dataset.themeDefault;
      if (mode === "light" || mode === "dark") {
        void host.shell.saveDefaultTheme(mode, themeDefault.value).catch((error) => host.shell.showNotice(errorText(error), "error"));
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
        host.shell.showNotice("Context window must be a whole number of at least 4096 tokens", "error");
        void refreshLocalModelRows();
        return;
      }
      void (async () => {
        try {
          await host.localModels.setContextSize(modelId, entered ? tokens : null);
          // The window is allocated when llama-server boots, so a running model keeps the one
          // it started with until it is restarted.
          host.shell.showNotice((await host.localModels.list()).some(({ id, runtime }) => id === modelId && runtime.running)
            ? "Saved. Restart this model to apply the new context window."
            : "Saved.", "success");
          await refreshLocalModelRows();
        }
        catch (error) {
          host.shell.showNotice(errorText(error), "error");
        }
      })();
      return;
    }
    const toggle = (event.target as Element).closest<HTMLInputElement>("[data-model-toggle]");
    if (toggle) {
      const modelId = toggle.dataset.model!;
      host.assistant.localModelProgress.delete(modelId);
      if (toggle.dataset.modelToggle === "download") {
        // Off mid-download only cancels it, so the partial file stays and a later Download resumes.
        // Completed downloads are disabled in the row; Delete remains the destructive action.
        if (toggle.checked)
          void downloadLocalModel(modelId).then(refreshLocalModelRows);
        else
          stopLocalModel(modelId);
        return;
      }
      else if (toggle.checked) {
        void host.assistant.rememberModelChoice({
          provider: LOCAL_PROVIDER,
          model: modelId,
          localModelId: modelId
        }).catch((error) => host.shell.showNotice(errorText(error), "error"));
        runLocalModel(modelId);
      }
      else {
        // Drops a start still waiting on its download without cancelling that download — the
        // Download toggle owns it. Otherwise this stops the model that is serving.
        cancelLocalModelStart(modelId);
        if (host.localModels.wantedRunId === modelId) {
          void host.localModels.wantRun(null).then(refreshLocalModelRows);
        }
        if (!host.assistant.localModelDownloads.has(modelId))
          stopLocalModel(modelId);
      }
      void refreshLocalModelRows();
      return;
    }
    const input = (event.target as Element).closest<HTMLInputElement>("[data-branding]");
    if (!input)
      return;
    const org = host.session.currentOrganization();
    if (!org)
      return;
    void (async () => {
      try {
        if (input.dataset.branding === "color") {
          await host.session.setBrandingValue(org.id, { color: input.value });
        }
        else if (input.dataset.branding === "logo") {
          const file = input.files?.[0];
          if (!file)
            return;
          await host.session.setBrandingValue(org.id, { logo: await readFileAsDataUrl(file) });
        }
        await host.workspaceController.refresh();
      }
      catch (error) {
        host.shell.showNotice(errorText(error), "error");
      }
    })();
  });

  host.shell.newItem.addEventListener("click", () => {
    const rootId = host.shell.boardRootItemId;
    const process = host.workspaceController.activeProcess;
    void createItem(rootId ? process?.stages[0]?.id : undefined, rootId)
      .catch((error) => host.shell.showNotice(errorText(error), "error"));
  });

  host.shell.viewBack.addEventListener("click", () => {
    let parent = PARENT_VIEW[host.shell.view];
    if (host.shell.view === "item" && host.shell.previousView === "inbox") {
      parent = "inbox";
    } else if (host.shell.view === "run" && host.shell.previousView === "runs") {
      parent = "runs";
    } else if (host.shell.view === "team-settings" && host.shell.previousView === "board") {
      parent = "board";
    }
    if (!parent) return;
    host.shell.activeItemId = "";
    host.shell.activeExecutionId = "";
    host.shell.view = parent;
    host.shell.render();
  });

  async function sendAssistantMessage(message: string): Promise<void> {
    host.assistant.assistantLogEntries.push({ role: "you", text: message });
    host.assistant.assistantBusy = true;
    host.views.renderAssistant();
    try {
      if (host.assistant.assistantModel.provider === LOCAL_PROVIDER) {
        await host.localModels.requireRunning(host.assistant.assistantModel.model);
      }
      const { baseUrl, token } = await host.ensureFlueRuntime();
      const result = await new FlueRuntime(baseUrl, undefined, token).execute({
        executionId: crypto.randomUUID(),
        conversationId: assistantInstanceId(host.workspaceController.workspace.teamId, host.assistant.assistantModel),
        agentName: ASSISTANT_AGENT,
        prompt: turnPrompt(message, host.assistant.assistantContext())
      });
      const answer = String((result.output as {
        text?: unknown;
      } | null)?.text ?? "");
      const turn = parseTurn(answer);
      const resolved = resolveActions(turn.actions, host.workspaceController.processes, host.workspaceController.teamItems);
      host.assistant.assistantLogEntries.push({
        role: "assistant",
        text: turn.reply || (resolved.length ? "Here is what I would change." : "(no answer)"),
        ...(resolved.length ? { actions: resolved } : {})
      });
    }
    catch (error) {
      host.assistant.assistantLogEntries.push({
        role: "assistant",
        text: errorText(error)
      });
    }
    finally {
      host.assistant.assistantBusy = false;
      host.views.renderAssistant();
    }
  }

  /**
   * Asks the curator what it would fold together. Runs on the same model the dashboard assistant
   * uses, in its own conversation, and produces a preview — never a write.
   */
  async function curateSkills(): Promise<void> {
    if (host.assistant.curatorBusy)
      return;
    host.assistant.curatorBusy = true;
    host.assistant.curatorPlan = null;
    host.shell.render();
    try {
      if (host.assistant.assistantModel.provider === LOCAL_PROVIDER) {
        await host.localModels.requireRunning(host.assistant.assistantModel.model);
      }
      const { baseUrl, token } = await host.ensureFlueRuntime();
      const result = await new FlueRuntime(baseUrl, undefined, token).execute({
        executionId: crypto.randomUUID(),
        conversationId: instanceModelId(CURATOR_AGENT, host.workspaceController.workspace.teamId, host.assistant.assistantModel),
        agentName: CURATOR_AGENT,
        prompt: curatorPrompt(host.assistant.skillReviews)
      });
      const plan = parseCuratorPlan(String((result.output as {
        text?: unknown;
      } | null)?.text ?? ""));
      const actions = resolveCuratorPlan(plan.actions, registryCapabilities(host.workspaceController.registries));
      host.assistant.curatorPlan = actions.length
        ? { summary: plan.summary, actions }
        : { summary: plan.summary || "Nothing worth changing.", actions: [] };
    }
    catch (error) {
      host.shell.showNotice(errorText(error), "error");
    }
    finally {
      host.assistant.curatorBusy = false;
      host.shell.render();
    }
  }

  async function applyCuratorProposal(): Promise<void> {
    if (!host.assistant.curatorPlan)
      return;
    const teamRoot = await host.workspaceController.requireTeamRoot();
    const { applied, errors } = await applyCuratorPlan(host.assistant.curatorPlan.actions, {
      saveSkill: async (name, description, body) => {
        await host.agentFiles.saveSkill(teamRoot, name, description, body);
      },
      archiveSkill: async (slug) => {
        await host.agentFiles.archiveSkill(teamRoot, slug);
      }
    });
    host.assistant.curatorPlan = null;
    await host.workspaceController.ensureTeamSkillsRegistry(teamRoot);
    await host.workspaceController.refresh();
    if (errors.length)
      host.shell.showNotice(errors.join("; "), "error");
    else
      host.shell.showNotice(`Applied ${applied} change(s)`, "success");
  }

  async function runApprovedBeesOperation(goal: string): Promise<{
    message: string;
    steps: string[];
  }> {
    if (host.assistant.assistantModel.provider === LOCAL_PROVIDER) {
      await host.localModels.requireRunning(host.assistant.assistantModel.model);
    }
    const { baseUrl, token } = await host.ensureFlueRuntime();
    const runtime = new FlueRuntime(baseUrl, undefined, token);
    const instanceId = assistantInstanceId(host.workspaceController.workspace.teamId, host.assistant.assistantModel);
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
      const answer = String((result.output as {
        text?: unknown;
      } | null)?.text ?? "");
      const command = parseBeesUiCommand(answer);
      if (!command)
        throw new Error("The assistant returned no valid Bees UI command");
      if (command.op === "finish") {
        return { message: command.message, steps };
      }
      try {
        lastResult = await executeBeesUiCommand(command);
      }
      catch (error) {
        lastResult = `Command failed: ${errorText(error)}`;
      }
      steps.push(lastResult);
    }
    throw new Error("The Bees operation exceeded 24 UI steps");
  }

  // ---- The onboarding wizard ----

  /** The administrator's Markdown, or the bundled default until one is written. */
  async function tourSteps(): Promise<TourStep[]> {
    return parseTour(await host.repository.getSetting(TOUR_MARKDOWN_KEY, DEFAULT_TOUR));
  }

  /**
   * Asks the assistant which visible control a wizard step is about. Read-only: the answer is a
   * ref out of the snapshot it was just shown, so the worst a confused model can do is point the
   * arrow at the wrong button — it never clicks one.
   */
  async function locateTourStep(step: TourStep, index: number, total: number): Promise<string> {
    if (host.assistant.assistantModel.provider === LOCAL_PROVIDER)
      await host.localModels.requireRunning(host.assistant.assistantModel.model);
    const { baseUrl, token } = await host.ensureFlueRuntime();
    const result = await new FlueRuntime(baseUrl, undefined, token).execute({
      executionId: crypto.randomUUID(),
      // A fresh conversation per step. Snapshots are large and the previous step's is worthless
      // once the screen has moved on, so replaying them would only burn the context window. The
      // model still rides in the instance id — see `modelForInstance`.
      conversationId: instanceModelId(ASSISTANT_AGENT, `tour-${crypto.randomUUID()}`, host.assistant.assistantModel),
      agentName: ASSISTANT_AGENT,
      prompt: [
        `Bees guided tour, step ${index + 1} of ${total}. Point the arrow at one control.`,
        `Step title: ${step.title}`,
        step.body ? `Step text:\n${step.body}` : "",
        step.target ? `The author says the arrow belongs on: ${step.target}` : "",
        snapshotBeesUi(),
        'Reply with {"target":{"ref":"u1"}} naming the control this step is about, or {"target":null} when none of them is.'
      ]
        .filter(Boolean)
        .join("\n\n")
    });
    return parseTourTarget(String((result.output as {
      text?: unknown;
    } | null)?.text ?? ""));
  }

  const tour = createTour({
    loadSteps: tourSteps,
    locateStep: locateTourStep,
    refElement,
    onError: (message) => host.shell.showNotice(message, "error")
  });

  function startTour(): void {
    void tour.start().catch((error) => host.shell.showNotice(errorText(error), "error"));
  }

  /** Save from the Onboarding tab. Empty resets to the bundled wizard rather than deleting it. */
  async function saveTourMarkdown(markdown: string): Promise<void> {
    await host.repository.setSetting(TOUR_MARKDOWN_KEY, markdown.trim() || DEFAULT_TOUR);
    const count = parseTour(markdown.trim() || DEFAULT_TOUR).length;
    host.shell.showNotice(`Saved — ${count} step${count === 1 ? "" : "s"}`, "success");
    host.shell.render();
  }

  async function applyAssistantActions(index: number): Promise<void> {
    const entry = host.assistant.assistantLogEntries[index];
    if (!entry?.actions || entry.applied)
      return;
    host.assistant.assistantBusy = true;
    host.views.renderAssistant();
    const operationNotes: string[] = [];
    try {
      const { applied, errors } = await applyActions(entry.actions, {
        repository: {
          createProcess: (teamId, input) => host.repository.createProcess(teamId, input),
          createWorkItem: (processId, input) => host.repository.createWorkItem(processId, input)
        },
        moveWorkItem: async (itemId, stageId) => {
          await host.workflowRuntime.command(itemId, { type: "move", targetStageId: stageId });
        },
        teamId: host.workspaceController.workspace.teamId,
        operateBees: async (goal) => {
          const result = await runApprovedBeesOperation(goal);
          operationNotes.push(`${result.message}${result.steps.length ? `\n${result.steps.join("\n")}` : ""}`);
        },
        saveAgent: async ({ name, purpose, prompt, triggerStageId }) => {
          await writeAgent(newAgent({ name, purpose, triggerStageId, config: { prompt, toolRefs: [], grants: [] } }));
        }
      });
      entry.applied = true;
      host.assistant.assistantLogEntries.push({
        role: "assistant",
        text: [
          ...operationNotes,
          errors.length
            ? `Applied ${applied}. These did not go through:\n${errors.join("\n")}`
            : `Applied ${applied} change${applied === 1 ? "" : "s"}.`
        ].join("\n")
      });
      await host.workspaceController.refresh();
    }
    finally {
      host.assistant.assistantBusy = false;
      host.views.renderAssistant();
      host.shell.assistantInput.focus();
    }
  }

  async function pickAssistantModel(choice: ModelChoice): Promise<void> {
    host.assistant.assistantPickerOpen = false;
    await host.assistant.rememberModelChoice(choice);
    host.views.renderAssistant();
    host.shell.assistantModelSlot.querySelector<HTMLButtonElement>("button")?.focus();
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
    if (!data)
      return;
    const choice: ModelChoice = {
      provider: String(data.get("provider") ?? ""),
      model: String(data.get("model") ?? "").trim()
    };
    if (!choice.provider || !choice.model)
      throw new Error("Pick a provider and enter a model id");
    host.assistant.assistantExtraModels = [
      ...host.assistant.assistantExtraModels.filter((entry) => !sameChoice(entry, choice)),
      choice
    ];
    await host.repository.setSetting(ASSISTANT_EXTRA_MODELS_KEY, host.assistant.assistantExtraModels);
    await host.assistant.refreshAssistantCatalog();
    await pickAssistantModel(choice);
  }

  async function toggleAssistant(open: boolean): Promise<void> {
    host.assistant.assistantOpen = open;
    host.assistant.assistantPickerOpen = false;
    host.views.renderAssistant();
    if (open) {
      await host.assistant.refreshAssistantCatalog();
      host.views.renderAssistant();
      host.shell.assistantInput.focus();
    }
    else {
      host.shell.assistantToggle.focus();
    }
  }

  host.shell.assistantToggle.addEventListener("click", () => {
    void toggleAssistant(!host.assistant.assistantOpen).catch((error) => host.shell.showNotice(errorText(error), "error"));
  });

  host.shell.assistantPanel.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-assistant]");
    if (!button)
      return;
    const index = Number(button.dataset.index ?? "-1");
    const run = async (): Promise<void> => {
      if (button.dataset.assistant === "picker") {
        host.assistant.assistantPickerOpen = !host.assistant.assistantPickerOpen;
        host.views.renderAssistant();
        host.shell.assistantModelSlot.querySelector<HTMLButtonElement>("button")?.focus();
      }
      if (button.dataset.assistant === "pick") {
        const option = host.assistant.assistantCatalog[index];
        if (option)
          await pickAssistantModel(option.choice);
      }
      if (button.dataset.assistant === "add-model") {
        host.assistant.assistantPickerOpen = false;
        host.views.renderAssistant();
        await addAssistantModel();
        host.shell.assistantModelSlot.querySelector<HTMLButtonElement>("button")?.focus();
      }
      if (button.dataset.assistant === "apply")
        await applyAssistantActions(index);
    };
    void run().catch((error) => host.shell.showNotice(errorText(error), "error"));
  });

  document.querySelector<HTMLButtonElement>("#assistant-close")!.addEventListener("click", () => {
    void toggleAssistant(false);
  });

  document.querySelector<HTMLButtonElement>("#assistant-clear")!.addEventListener("click", () => {
    host.assistant.assistantLogEntries = [];
    host.views.renderAssistant();
  });

  // Desktop starts with the sidebar docked open, mobile starts closed; the icon
  // direction is driven by aria-expanded, so seed it to match.
  host.shell.appDrawerOpen.setAttribute(
    "aria-expanded",
    String(window.matchMedia("(min-width: 1024px)").matches),
  );

  host.shell.appDrawerOpen.addEventListener("click", () => {
    // Desktop: the sidebar is docked via lg:drawer-open, so toggle that class to
    // collapse/expand it. Mobile keeps the checkbox-driven overlay behavior.
    if (window.matchMedia("(min-width: 1024px)").matches) {
      const drawer = host.shell.appDrawer.closest(".drawer")!;
      const open = drawer.classList.toggle("lg:drawer-open");
      host.shell.appDrawerOpen.setAttribute("aria-expanded", String(open));
      return;
    }
    host.shell.appDrawer.checked = true;
    host.shell.appDrawerOpen.setAttribute("aria-expanded", "true");
    host.shell.appNavigation.querySelector<HTMLButtonElement>("button")?.focus();
  });

  host.shell.appDrawer.addEventListener("change", () => {
    host.shell.appDrawerOpen.setAttribute("aria-expanded", String(host.shell.appDrawer.checked));
  });

  host.shell.assistantForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = host.shell.assistantInput.value.trim();
    if (!message || host.assistant.assistantBusy)
      return;
    host.shell.assistantInput.value = "";
    void sendAssistantMessage(message);
  });

  // Enter sends, Shift+Enter breaks the line — a chat box, not a form field.
  host.shell.assistantInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      host.shell.assistantForm.requestSubmit();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || host.shell.dialog.open)
      return;
    // Before the assistant: the wizard is the thing on top, and it is the one whose Escape a
    // user pressing it is thinking about.
    if (tour.running) {
      event.preventDefault();
      tour.stop();
    }
    else if (host.assistant.assistantOpen) {
      event.preventDefault();
      void toggleAssistant(false);
    }
    else if (host.shell.appDrawer.checked) {
      event.preventDefault();
      host.shell.appDrawer.checked = false;
      host.shell.appDrawerOpen.setAttribute("aria-expanded", "false");
      host.shell.appDrawerOpen.focus();
    }
  });

  return {
    saveProcessAgents,
    commitProcessAgentEdits,
    saveProcessDefinition,
    installLibraryProcess,
    copyLibraryProcess,
    loadAgents,
    writeAgent,
    applyAgentEdit,
    configureLocalKnowledge,
    configureRemoteKnowledge,
    disableKnowledge,
    refreshLocalModelRows,
    downloadLocalModel,
    runLocalModel,
    stopLocalModel,
    connectAiProvider,
    discoverMcpConnection,
    addApiKeyMcp,
    addOAuthMcp,
    readFileAsDataUrl,
    linkModelThinking,
    edit,
    createItem,
    workItemFileSources,
    submitNewItem,
    parseFileReferencesInput,
    editDashboard,
    sendAssistantMessage,
    curateSkills,
    applyCuratorProposal,
    runApprovedBeesOperation,
    startTour,
    stopTour: tour.stop,
    applyAssistantActions,
    pickAssistantModel,
    addAssistantModel,
    toggleAssistant
  };
}
