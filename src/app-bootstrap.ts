import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrent as getCurrentDeepLink, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import {
  defaultApiBaseUrl,
  setApiBaseUrl
} from "./api.js";
import {
  loadCachedControl
} from "./control.js";
import {
  autonomousRunKeys,
  errorText
} from "./domain.js";
import {
  loadCachedKnowledgePolicy
} from "./knowledge.js";
import {
  type LocalModelProgress
} from "./local-models.js";
import type { MainHost } from "./main.js";
import { type SettledRun } from "./run-coordinator.js";
import { checkForUpdate } from "./updates.js";
import { LAST_VIEW_KEY, startupView } from "./views.js";

export function createAppBootstrap(host: MainHost) {
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
    if (!override || override === defaultApiBaseUrl)
      return;
    if (!isReachableUnderCsp(override)) {
      host.shell.showNotice(`Ignoring --server ${override}: the app's CSP only allows ${defaultApiBaseUrl}, http://localhost:3000, https://app.bees.bot and http://127.0.0.1:<port>.`, "error");
      return;
    }
    setApiBaseUrl(override);
    host.shell.showNotice(`Using coordination server ${override}`, "info");
  }

  /** Mirrors `connect-src` in tauri.conf.json. Note localhost is allowed on port 3000 only. */
  function isReachableUnderCsp(url: string): boolean {
    try {
      const { protocol, hostname, port } = new URL(url);
      if (url === defaultApiBaseUrl || url === "https://app.bees.bot")
        return true;
      if (protocol !== "http:")
        return false;
      return hostname === "127.0.0.1" || (hostname === "localhost" && port === "3000");
    }
    catch {
      return false;
    }
  }

  async function start(): Promise<void> {
    try {
      // Before the workspace loads: an update that replaces the app should not land in the
      // middle of a session. Not awaited, so a slow endpoint cannot hold up startup.
      void checkForUpdate().catch((error) => host.shell.showNotice(errorText(error), "error"));
      host.workspaceController.workspace = await host.repository.bootstrap();
      host.shell.view = startupView(await host.repository.getSetting(LAST_VIEW_KEY, ""));
      await listen<SettledRun>("run-settled", ({ payload }) => {
        void host.runs.applySettledExecution(payload.executionId, true).catch((error) => host.shell.showNotice(errorText(error), "error"));
      });
      await host.localModels.load();
      await listen<LocalModelProgress>("local-model-progress", ({ payload }) => {
        host.assistant.localModelProgress.set(payload.modelId, payload);
        const bar = [...document.querySelectorAll<HTMLProgressElement>("[data-local-model-progress]")].find((element) => element.dataset.localModelProgress === payload.modelId);
        if (bar) {
          bar.max = payload.totalBytes || 1;
          bar.value = payload.downloadedBytes;
        }
        const status = [...document.querySelectorAll<HTMLElement>("[data-local-model-status]")].find((element) => element.dataset.localModelStatus === payload.modelId);
        if (status) {
          status.textContent = host.views.localModelStatusLabel(payload.state, payload.downloadedBytes, payload.totalBytes, payload.error);
        }
        // A download that finished after a reload has no in-page promise left waiting on it, so the
        // event is what starts the model the user asked for. runLocalModel ignores a repeat call
        // while its own start is already in flight.
        if (payload.state === "ready" && host.localModels.wantedRunId === payload.modelId) {
          host.actions.runLocalModel(payload.modelId);
        }
        if (payload.state !== "downloading" && host.shell.view === "preferences" && host.shell.prefsTab === "local-models") {
          void host.views.renderPreferences();
        }
      });
      await host.workspaceController.ensureOrgFolders();
      host.runs.runnerId = await host.repository.getSetting("runner_id", "");
      if (!host.runs.runnerId) {
        host.runs.runnerId = crypto.randomUUID();
        await host.repository.setSetting("runner_id", host.runs.runnerId);
      }
      host.runs.appVersion = await getVersion().catch(() => "dev");
      await loadCachedControl(host.repository, host.workspaceController.workspace.organizationId);
      // A recovered run's immutable MCP seed points at the stable loopback URL and vault ref.
      // Bring that worker back before Flue re-adopts the run after an app restart.
      const cachedKnowledge = await loadCachedKnowledgePolicy(host.repository, host.workspaceController.workspace.organizationId);
      if (cachedKnowledge?.mode === "local" && host.workspaceController.workspace.teamId) {
        host.session.knowledgePolicy = cachedKnowledge;
        host.session.knowledgePolicyOrgId = host.workspaceController.workspace.organizationId;
        await host.session.ensureKnowledgeConnection().catch((error) => {
          host.session.knowledgeError = errorText(error);
        });
      }
      // A persisted delivery key makes either path safe: adopt its known submission, or resend
      // the exact pre-admission message and let Flue converge on the same receipt.
      const resumed = await host.repository.listNonTerminalExecutions();
      void host.runs.resumeInterruptedRuns(resumed).catch((error) => host.shell.showNotice(errorText(error), "error"));
      void host.runs.retryConversationPurges().catch(() => undefined);
      await host.shell.loadTheme();
      await host.assistant.loadAssistantSettings();
      // Before restoreSession: every call it makes has to go to the server this launch chose.
      await applyServerOverride();
      // Catch deep links: OAuth callback (bees://auth/callback?token=…) and invites (bees://invite/<id>).
      await onOpenUrl((urls) => host.session.routeDeepLink(urls));
      try {
        await host.session.restoreSession();
      }
      catch (error) {
        host.shell.showNotice(errorText(error), "error");
      }
      await host.assistant.refreshAssistantCatalog();
      for (const execution of await host.repository.listPendingExecutionProjections()) {
        await host.runs.applySettledExecution(execution.id, false, false).catch((error) => host.shell.showNotice(errorText(error), "error"));
      }
      await host.workspaceController.refresh();
      await host.workspaceController.seedDefaultRegistry();
      await host.workspaceController.seedStarterWorkflow();
      // Re-copied at launch and after each write, not on every refresh: the snapshot only changes
      // when someone edits the team folder. ponytail: add a watcher if hand-edits need to show sooner.
      const teamFolder = await host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId);
      if (teamFolder?.localPath)
        await host.workspaceController.ensureTeamSkillsRegistry(teamFolder.localPath);
      await host.runs.scheduler.start();
      host.runs.startBackgroundSync();
      // Nothing in the app is required to hand its errors to the boundary — these catch the ones
      // that were never handed anywhere, which is exactly the class that used to vanish.
      window.addEventListener("error", (event) => host.runs.reportFailure(event.error ?? event.message));
      window.addEventListener("unhandledrejection", (event) => host.runs.reportFailure(event.reason));
      if (resumed.length) {
        // These continue where they were, so the language must not promise a fresh start.
        host.shell.notifyLocal("Bees is picking up where it left off", `${resumed.length} run${resumed.length === 1 ? "" : "s"} accepted before Bees closed ${resumed.length === 1 ? "is" : "are"} being settled. Local work does not run while Bees is closed.`);
        // Autopilot must not start a second attempt at an item Rust is already settling.
        for (const { workItemId } of resumed) {
          const item = host.workspaceController.teamItems.find(({ id }) => id === workItemId);
          if (item)
            for (const key of autonomousRunKeys(item))
              host.runs.autopilotDone.add(key);
        }
      }
      // Reconcile above may have dropped the connection this session was resumed on (removed from org).
      if (!host.session.activeConnectionValid())
        await host.session.moveOffHidden();
      // Cold start: if a bees:// link launched the app, onOpenUrl won't fire — read the launch
      // URL now that accounts are loaded. (Runtime clicks while open are caught by onOpenUrl.)
      const launchUrls = await getCurrentDeepLink().catch(() => null);
      if (launchUrls?.length)
        host.session.routeDeepLink(launchUrls);
    }
    catch (error) {
      host.shell.swap(`<div class="hero min-h-80 rounded-box border border-dashed border-base-300 bg-base-100">
        <div class="hero-content text-center"><div>
          <h2 class="text-xl font-bold">Open Bees in its desktop shell</h2>
          <p class="mt-2 text-sm text-error">${host.shell.escapeHtml(error instanceof Error ? error.message : error)}</p>
        </div></div>
      </div>`);
    }
  }

  return {
    applyServerOverride,
    isReachableUnderCsp,
    start
  };
}
