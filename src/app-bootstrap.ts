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
    /*
     * Launch used to be one try block over roughly twenty-five sequential awaits, so any one of
     * them — a deleted model file, a moved team folder, a corrupt cache, a backend command not
     * ready yet — replaced the entire window with an error card. Almost none of those steps are
     * worth a window: once the workspace has loaded, the rest is enrichment.
     *
     * So each of them runs through `step`, which names the failure, keeps its own fallback, and
     * lets the launch continue. The fatal path below is reserved for the two things with no
     * useful degraded form: opening the database, and rendering at all.
     */
    const incomplete: string[] = [];
    async function step<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
      try {
        return await run();
      }
      catch (error) {
        console.warn(`Launch step "${label}" failed:`, error);
        incomplete.push(label);
        return fallback;
      }
    }

    try {
      // Before the workspace loads: an update that replaces the app should not land in the
      // middle of a session. Not awaited, so a slow endpoint cannot hold up startup.
      void checkForUpdate().catch((error) => host.shell.showNotice(errorText(error), "error"));
      host.workspaceController.workspace = await host.repository.bootstrap();
      host.shell.view = startupView(
        await step("Restoring the last page", () => host.repository.getSetting(LAST_VIEW_KEY, ""), "")
      );
      await listen<SettledRun>("run-settled", ({ payload }) => {
        void host.runs.applySettledExecution(payload.executionId, true).catch((error) => host.shell.showNotice(errorText(error), "error"));
      });
      await step("Loading local models", () => host.localModels.load(), undefined);
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
      // Startup reaps orphaned servers, so a model left switched on is down until someone asks
      // again. Only start what is already on disk: runLocalModel downloads first, and a launch is
      // no place to begin a several-gigabyte fetch nobody asked for.
      // One model whose file was deleted underneath us used to take the whole launch with it:
      // `list()` polls every seeded model's runtime status through a bare command call.
      const wanted = (await step("Checking local models", () => host.localModels.list(), []))
        .find(({ id, runtime }) => id === host.localModels.wantedRunId && runtime.state === "ready");
      if (wanted)
        host.actions.runLocalModel(wanted.id);
      await step("Preparing organization folders", () => host.workspaceController.ensureOrgFolders(), undefined);
      host.runs.runnerId = await step("Reading this device's id", () => host.repository.getSetting("runner_id", ""), "");
      if (!host.runs.runnerId) {
        host.runs.runnerId = crypto.randomUUID();
        await step("Saving this device's id", () => host.repository.setSetting("runner_id", host.runs.runnerId), undefined);
      }
      host.runs.appVersion = await getVersion().catch(() => "dev");
      await step(
        "Loading cached policy",
        () => loadCachedControl(host.repository, host.workspaceController.workspace.organizationId),
        undefined
      );
      // A recovered run's immutable MCP seed points at the stable loopback URL and vault ref.
      // Bring that worker back before Flue re-adopts the run after an app restart.
      const cachedKnowledge = await step(
        "Loading knowledge settings",
        () => loadCachedKnowledgePolicy(host.repository, host.workspaceController.workspace.organizationId),
        null
      );
      if (cachedKnowledge?.mode === "local" && host.workspaceController.workspace.teamId) {
        host.session.knowledgePolicy = cachedKnowledge;
        host.session.knowledgePolicyOrgId = host.workspaceController.workspace.organizationId;
        await host.session.ensureKnowledgeConnection().catch((error) => {
          host.session.knowledgeError = errorText(error);
        });
      }
      // A persisted delivery key makes either path safe: adopt its known submission, or resend
      // the exact pre-admission message and let Flue converge on the same receipt.
      const resumed = await step("Finding runs to resume", () => host.repository.listNonTerminalExecutions(), []);
      void host.runs.resumeInterruptedRuns(resumed).catch((error) => host.shell.showNotice(errorText(error), "error"));
      // Reported rather than swallowed: a purge that never completes is a conversation the user
      // asked to be deleted and which is still there.
      void host.runs.retryConversationPurges().catch((error) =>
        console.warn("Retrying conversation purges failed:", error)
      );
      await step("Loading the theme", () => host.shell.loadTheme(), undefined);
      await step("Loading assistant settings", () => host.assistant.loadAssistantSettings(), undefined);
      // Before restoreSession: every call it makes has to go to the server this launch chose.
      await step("Applying the server override", () => applyServerOverride(), undefined);
      // Catch deep links: OAuth callback (bees://auth/callback?token=…) and invites (bees://invite/<id>).
      await step("Listening for links", () => onOpenUrl((urls) => host.session.routeDeepLink(urls)), undefined);
      try {
        await host.session.restoreSession();
      }
      catch (error) {
        host.shell.showNotice(errorText(error), "error");
      }
      await step("Loading the assistant catalog", () => host.assistant.refreshAssistantCatalog(), undefined);
      for (const execution of await step("Reading settled runs", () => host.repository.listPendingExecutionProjections(), [])) {
        await host.runs.applySettledExecution(execution.id, false, false).catch((error) => host.shell.showNotice(errorText(error), "error"));
      }
      // The densest cluster of backend calls in the launch, and the likeliest single cause of the
      // error card this whole block replaced.
      await step("Loading the workspace", () => host.workspaceController.refresh(), undefined);
      await step("Preparing the plugin registry", () => host.workspaceController.seedDefaultRegistry(), undefined);
      await step("Installing bundled workflows", () => host.workspaceController.seedInstalledWorkflows(), undefined);
      // Re-copied at launch and after each write, not on every refresh: the snapshot only changes
      // when someone edits the team folder. ponytail: add a watcher if hand-edits need to show sooner.
      // A team folder moved or deleted outside Bees is an ordinary Monday, not a reason to refuse
      // to open.
      const teamFolder = await step(
        "Locating the team folder",
        () => host.repository.getResolvedTeamFolder(host.workspaceController.workspace.teamId),
        null
      );
      if (teamFolder?.localPath)
        await step(
          "Copying team skills",
          () => host.workspaceController.ensureTeamSkillsRegistry(teamFolder.localPath),
          undefined
        );
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
        await step("Reconnecting your account", () => host.session.moveOffHidden(), undefined);
      // Cold start: if a bees:// link launched the app, onOpenUrl won't fire — read the launch
      // URL now that accounts are loaded. (Runtime clicks while open are caught by onOpenUrl.)
      const launchUrls = await getCurrentDeepLink().catch(() => null);
      if (launchUrls?.length)
        host.session.routeDeepLink(launchUrls);
      // One sentence naming what is missing, rather than a stack of toasts or a blank window.
      if (incomplete.length)
        host.shell.showNotice(
          `Bees opened, but ${incomplete.join(", ")} did not finish. Everything else is ready.`,
          "error"
        );
    }
    catch (error) {
      // Only `repository.bootstrap()` still reaches this, and there is no degraded form of "the
      // database did not open" — so the card offers the one thing that can help instead of
      // leaving the user with a sentence and no control.
      host.shell.swap(`<div class="hero min-h-80 rounded-box border border-dashed border-base-300 bg-base-100">
        <div class="hero-content text-center"><div>
          <h2 class="text-xl font-bold">Bees could not open its database</h2>
          <p class="mt-2 text-sm text-error">${host.shell.escapeHtml(error instanceof Error ? error.message : String(error))}</p>
          <button id="launch-retry" class="btn btn-primary btn-sm mt-4" type="button">Try again</button>
        </div></div>
      </div>`);
      document.getElementById("launch-retry")?.addEventListener("click", () => location.reload());
    }
  }

  return {
    applyServerOverride,
    isReachableUnderCsp,
    start
  };
}
