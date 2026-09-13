window.__ModuleLoader__.load({
  id: "@bees/dsh-local-ai",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useMemo, useRef, useState } = React;

    // runsProcesses marks the models that finish a goal end to end; only those can be recommended.
    const LOCAL_MODELS = [
      {
        id: "granite-4-0-h-tiny-q4-k-m", name: "Granite 4.0 h tiny (Q4_K_M)",
        runsProcesses: true,
        fileName: "granite-4.0-h-tiny-Q4_K_M.gguf",
        url: "https://huggingface.co/ibm-granite/granite-4.0-h-tiny-GGUF/resolve/main/granite-4.0-h-tiny-Q4_K_M.gguf?download=true",
        bytes: 4230976352,
        sha256: "5a38b08c441ae1adbafb1d2b8a7167e0d48734d83af68b268cefea1eec553dcd"
      },
      {
        id: "lfm2-5-2-6b-q4-k-m", name: "LFM2.5 2.6B (Q4_K_M)",
        runsProcesses: true,
        fileName: "LFM2.5-2.6B-Q4_K_M.gguf",
        url: "https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF/resolve/main/LFM2.5-2.6B-Q4_K_M.gguf?download=true",
        bytes: 1674455040,
        sha256: "02a8b7e17487d326e46d68ce0ba24211e1b80a14c4cd0597fa73c1cd697f52ed"
      },
      {
        id: "granite-4-2-3b-q4-k-m", name: "Granite 4.2 3B (Q4_K_M)",
        runsProcesses: false,
        fileName: "granite-4.2-3b-Q4_K_M.gguf",
        url: "https://huggingface.co/ibm-granite/granite-4.2-3b-GGUF/resolve/main/granite-4.2-3b-Q4_K_M.gguf?download=true",
        bytes: 2244011552,
        sha256: "e0406663965846ae22a403456eb826ccce5f450840491f71952f18a7cb78e7d5"
      },
      {
        id: "qwen3-4b-instruct-2507-q4-k-m", name: "Qwen3 4B Instruct (Q4_K_M)",
        runsProcesses: false,
        fileName: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
        url: "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf?download=true",
        bytes: 2497281120,
        sha256: "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597"
      }
    ];
    const DEFAULT_LOCAL_MODEL = LOCAL_MODELS[0];

    // Conservative first-run choice from the shipped catalog, not an intelligence ranking.
    function recommendedLocalModel(hardware, models, statuses) {
      const running = models.find((model) => statuses[model.id]?.running);
      if (running) return running;
      if (!hardware || hardware.totalMemory < 8 * 1024 ** 3) return null;
      const candidates = models.filter((model) => model.runsProcesses && model.bytes > 0 &&
        model.bytes + 2 * 1024 ** 3 <= Math.min(hardware.totalMemory * 0.6, hardware.availableMemory));
      return candidates.find((model) => statuses[model.id]?.running || statuses[model.id]?.state === "ready")
        ?? candidates.find((model) => model.id === DEFAULT_LOCAL_MODEL.id &&
          hardware.availableDisk != null && hardware.availableDisk >= model.bytes + 1024 ** 3) ?? null;
    }


    const css = `
      .bees-local-model-table{overflow-x:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill)}
      .bees-local-model-table table{width:100%;min-width:680px;border-collapse:collapse}.bees-local-model-table th,.bees-local-model-table td{padding:11px 13px;border-bottom:1px solid var(--dsw-alias-border-l1);text-align:left;vertical-align:middle}.bees-local-model-table th{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}.bees-local-model-table tbody tr:last-child td{border-bottom:0}.bees-local-model-table th:nth-last-child(-n+3),.bees-local-model-table td:nth-last-child(-n+3){width:1%;text-align:center;white-space:nowrap}
      .bees-local-model-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.bees-local-model-name{display:flex;align-items:center;gap:7px;font-weight:700}.bees-local-model-status{min-width:130px}.bees-local-model-progress{display:block;width:125px;height:5px;margin-top:5px;accent-color:#f2b84b}.bees-local-server-models{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px}.bees-local-server-models .bees-badge{gap:4px;text-transform:none}.bees-local-server-models .bees-badge .bees-btn{padding:0;border:0;background:transparent;font-size:14px;line-height:1}.bees-local-toggle{display:inline-flex;align-items:center;gap:7px;cursor:pointer}.bees-local-toggle input{appearance:none;width:34px;height:20px;margin:0;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-specific-sidebar-fill);position:relative;transition:.15s}.bees-local-toggle input:after{content:"";position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:.15s}.bees-local-toggle input:checked{border-color:#f2b84b;background:#f2b84b}.bees-local-toggle input:checked:after{left:16px;background:#151515}.bees-local-toggle input:disabled{cursor:not-allowed;opacity:.55}.bees-local-delete{padding:5px 8px}
    `;

    function usePreference(scope) {
      const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
      useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
      return snapshot.value ?? {};
    }

    const settingValue = (scope) => scope.getSnapshot().value ?? {};
    const wantedModelIds = (config) =>
      Array.isArray(config.localModelWantedIds) ? [...new Set(config.localModelWantedIds)] : [];

    function invokeLocal(command, args = {}) {
      const invoke = window.__TAURI__?.core?.invoke;
      if (!invoke) throw new Error("Bees AI controls are available in the Bees desktop app.");
      return invoke(command, args);
    }

    function bytes(value) {
      return value ? `${(value / 1024 / 1024 / 1024).toFixed(value >= 1024 ** 3 ? 1 : 2)} GB` : "0 GB";
    }

    const allModels = (config) => [
      ...LOCAL_MODELS.filter(({ id }) => !config.removedLocalModelIds?.includes(id)),
      ...(Array.isArray(config.localModels) ? config.localModels : [])
    ];

    const providerId = (model) => `local-openai-${model.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
    const providerProfile = (model, connection, displayName = `Bees AI · ${model.name}`) => ({
      displayName, api: "openai-completions", baseURL: connection.baseUrl,
      // llama-server wants no auth, but pi-ai refuses a provider with neither key nor header.
      headers: { authorization: "Bearer local" },
      models: [{ id: "active", name: model.name, contextWindow: connection.contextWindow,
        maxTokens: Math.min(4096, Math.floor(connection.contextWindow / 2)) }]
    });

    async function syncLocalProviders(models, modelSettings) {
      const rows = await Promise.all(models.map(async (model) =>
        [model, await invokeLocal("local_model_status", { spec: model })]));
      const running = rows.filter(([, status]) => status.running).map(([model]) => model);
      const routes = await Promise.all(running.map(async (model) =>
        [model, await invokeLocal("local_model_connection", { modelId: model.id })]));
      const config = settingValue(modelSettings);
      const providers = Object.fromEntries(Object.entries(config.providers ?? {}).filter(([id]) =>
        id !== "local-openai" && !id.startsWith("local-openai-")));
      for (const [model, connection] of routes) providers[providerId(model)] = providerProfile(model, connection);
      if (routes.length) {
        const active = await invokeLocal("local_model_connection");
        const model = routes.find(([, connection]) => connection.baseUrl === active.baseUrl)?.[0] ?? routes.at(-1)[0];
        providers["local-openai"] = providerProfile(model, active, "Bees AI");
      }
      await modelSettings.set("providers", providers);
    }

    async function updateWantedModels(preferences, update) {
      const current = settingValue(preferences);
      const ids = update(wantedModelIds(current));
      await preferences.set("localModelWantedIds", ids);
    }

    async function activateLocalModel(model, models, modelSettings, preferences) {
      await invokeLocal("ensure_local_model", { spec: model });
      if (!wantedModelIds(settingValue(preferences)).includes(model.id)) return;
      await invokeLocal("start_local_model", { spec: model });
      await syncLocalProviders(models, modelSettings);
    }

    function LocalAiController({ modelSettings, preferences, onError }) {
      const started = useRef(false);
      useEffect(() => {
        if (started.current || !window.__TAURI__?.core?.invoke) return;
        started.current = true;
        const config = settingValue(preferences);
        const models = allModels(config);
        const wanted = wantedModelIds(config);
        void (async () => {
          const providers = settingValue(modelSettings).providers ?? {};
          const renamed = Object.fromEntries(Object.entries(providers).map(([id, profile]) => {
            if (id !== "local-openai" && !id.startsWith("local-openai-")) return [id, profile];
            const displayName = profile.displayName?.replace(/^Local AI(?= ·|$)|^Local OpenAI-compatible$/, "Bees AI");
            return [id, displayName !== profile.displayName ? { ...profile, displayName } : profile];
          }));
          if (Object.keys(providers).some((id) => renamed[id] !== providers[id]))
            await modelSettings.set("providers", renamed);
          for (const id of wanted) {
            const model = models.find(({ id: modelId }) => modelId === id);
            if (!model) continue;
            try { await activateLocalModel(model, models, modelSettings, preferences); }
            catch (reason) {
              const message = reason instanceof Error ? reason.message : String(reason);
              await updateWantedModels(preferences, (ids) => ids.filter((candidate) => candidate !== model.id));
              if (!["Model download cancelled", "Model start cancelled"].includes(message))
                onError?.(`Bees AI could not start ${model.name}: ${message}`);
            }
          }
        })().catch((reason) => onError?.(String(reason?.message ?? reason)));
      }, []);
      return null;
    }

    function LocalModels({ modelSettings, preferences, systemDefault, ask, Button, confirmAction }) {
      const config = usePreference(preferences);
      const models = useMemo(() => allModels(config), [config.localModels, config.removedLocalModelIds]);
      const [statuses, setStatuses] = useState({});
      const [hardware, setHardware] = useState(null);
      const [hardwareError, setHardwareError] = useState("");
      useEffect(() => {
        let active = true;
        if (window.__TAURI__?.core?.invoke) void invokeLocal("local_model_hardware").then(
          (value) => { if (active) setHardware(value); },
          (reason) => { if (active) setHardwareError(String(reason?.message ?? reason)); });
        return () => { active = false; };
      }, []);

      const [progress, setProgress] = useState({});
      const [busy, setBusy] = useState([]);
      const [error, setError] = useState("");
      const refresh = async () => {
        if (!window.__TAURI__?.core?.invoke) return;
        try {
          const rows = await Promise.all(models.map(async (model) =>
            [model.id, await invokeLocal("local_model_status", { spec: model })]));
          setStatuses(Object.fromEntries(rows));
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      };
      useEffect(() => {
        void refresh();
        let unlisten;
        void window.__TAURI__?.event?.listen("local-model-progress", ({ payload }) => {
          setProgress((current) => ({ ...current, [payload.modelId]: payload }));
          if (["ready", "cancelled", "error"].includes(payload.state)) void refresh();
        }).then((dispose) => { unlisten = dispose; });
        const timer = setInterval(() => void refresh(), 3000);
        return () => { clearInterval(timer); unlisten?.(); };
      }, [models.map(({ id }) => id).join("|")]);

      const perform = async (operation, model, work) => {
        const key = `${operation}:${model.id}`;
        setBusy((current) => [...current.filter((candidate) => candidate !== key), key]); setError("");
        try { await work(); await refresh(); }
        catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          if (!["Model download cancelled", "Model start cancelled"].includes(message)) setError(message);
        } finally { setBusy((current) => current.filter((candidate) => candidate !== key)); }
      };
      const download = (model) => perform("download", model,
        () => invokeLocal("ensure_local_model", { spec: model }));
      const cancelDownload = (model) => perform("cancel", model, async () => {
        await invokeLocal("cancel_local_model_download", { modelId: model.id });
        await updateWantedModels(preferences, (ids) => ids.filter((id) => id !== model.id));
      });
      const run = (model) => perform("run", model, async () => {
        await updateWantedModels(preferences, (ids) => [...new Set([...ids, model.id])]);
        try { await activateLocalModel(model, models, modelSettings, preferences); }
        catch (reason) {
          await updateWantedModels(preferences, (ids) => ids.filter((id) => id !== model.id));
          throw reason;
        }
      });
      const stop = (model) => perform("stop", model, async () => {
        await updateWantedModels(preferences, (ids) => ids.filter((id) => id !== model.id));
        await invokeLocal("cancel_local_model_download", { modelId: model.id });
        await invokeLocal("stop_local_model", { modelId: model.id });
        await syncLocalProviders(models, modelSettings);
      });
      const removeFile = async (model) => {
        if (!await confirmAction(`Remove the downloaded copy of ${model.name}?`)) return;
        await perform("remove-file", model, async () => {
          await invokeLocal("delete_local_model", { spec: model });
          await updateWantedModels(preferences, (ids) => ids.filter((id) => id !== model.id));
          await syncLocalProviders(models, modelSettings);
          setProgress((current) => { const next = { ...current }; delete next[model.id]; return next; });
        });
      };
      const remove = async (model) => {
        if (LOCAL_MODELS.some(({ id }) => id === model.id)) return;
        if (!await confirmAction(`Delete ${model.name} from the model list?`)) return;
        await perform("delete", model, async () => {
          await invokeLocal("delete_local_model", { spec: model });
          await updateWantedModels(preferences, (ids) => ids.filter((id) => id !== model.id));
          const current = settingValue(preferences);
          if (current.localModels?.some(({ id }) => id === model.id)) {
            await preferences.set("localModels", current.localModels.filter(({ id }) => id !== model.id));
          } else {
            await preferences.set("removedLocalModelIds", [...new Set([
              ...(current.removedLocalModelIds ?? []), model.id
            ])]);
          }
          await syncLocalProviders(models, modelSettings);
          setProgress((current) => { const next = { ...current }; delete next[model.id]; return next; });
        });
      };
      const addModel = async () => {
        const name = await ask("Model name", "My local model");
        if (!name) return;
        const raw = await ask("Direct HTTPS link to a GGUF model", "https://huggingface.co/");
        if (!raw) return;
        try {
          const url = new URL(raw);
          if (url.protocol !== "https:") throw new Error("Use an https:// model link");
          const fileName = decodeURIComponent(url.pathname.split("/").pop() || "");
          if (!fileName.toLowerCase().endsWith(".gguf") || !/^[a-z0-9._-]+$/i.test(fileName)) {
            throw new Error("The link must point directly to a .gguf file");
          }
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "model";
          const model = { id: `${slug}-${Date.now().toString(36)}`, name, fileName, url: url.toString(), bytes: 0 };
          await preferences.set("localModels", [...(config.localModels ?? []), model]);
          setError("");
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      };

      const recommended = recommendedLocalModel(hardware, models, statuses);
      const recommendedStatus = recommended && statuses[recommended.id];
      return h("div", { className: "bees-stack" },
        h("section", { className: "bees-callout" },
          h("h3", null, recommended ? `Suggested for this computer: ${recommended.name}` : "Bees AI setup"),
          h("p", { className: "bees-muted" }, hardware
            ? `${bytes(hardware.totalMemory)} memory · ${bytes(hardware.availableMemory)} currently available · ${hardware.availableDisk == null ? "Free disk space unavailable" : `${bytes(hardware.availableDisk)} free disk space`}`
            : `Bees could not read this computer's memory${hardwareError ? `: ${hardwareError}` : ""}. Choose an installed model or review the sizes below.`),
          h("p", null, recommended ? "A conservative choice based on available memory and storage. Actual speed depends on your computer. Start it below, then select it as your system default."
            : hardware ? "No shipped model fits the memory and storage free right now. Free some up, use a model you already have, or connect another AI provider."
            : "Pick a model yourself from the list below, or connect another AI provider."),
          recommended ? h(Button, { className: "primary", disabled: Boolean(recommendedStatus?.running) || busy.some((key) => key.endsWith(`:${recommended.id}`)),
            onClick: () => run(recommended) }, recommendedStatus?.running ? "Model running"
              : recommendedStatus?.state === "ready" ? "Use installed model" : `Download and use · ${bytes(recommended.bytes)}`) : null),
        h("div", { className: "bees-local-model-head" },
          h("p", { className: "bees-muted" }, "Models stay private on this device. Run as many as this computer's memory can hold."),
          h(Button, { className: "primary", onClick: addModel }, "Add a model")),
        h("div", { className: "bees-local-model-table" }, h("table", null,
          h("thead", null, h("tr", null,
            h("th", null, "Model"), h("th", null, "Status"), h("th", null, "Download"),
            h("th", null, "Run"), h("th", null, "Delete"))),
          h("tbody", null, ...models.map((model) => {
            const status = statuses[model.id];
            const event = progress[model.id];
            const isBundledModel = LOCAL_MODELS.some(({ id }) => id === model.id);
            const running = Boolean(status?.running);
            const nativeStarting = status?.state === "starting";
            const complete = status?.state === "ready" || running || nativeStarting;
            const starting = nativeStarting || (busy.includes(`run:${model.id}`) && complete);
            const runPending = starting || busy.includes(`run:${model.id}`);
            const downloading = status?.state === "downloading" || event?.state === "downloading"
              || busy.includes(`download:${model.id}`) || (busy.includes(`run:${model.id}`) && !complete && !starting);
            const cancelling = busy.includes(`cancel:${model.id}`) || busy.includes(`delete:${model.id}`);
            const total = event?.totalBytes || status?.totalBytes || model.bytes;
            const downloaded = event?.downloadedBytes ?? status?.downloadedBytes ?? 0;
            const percentage = total ? Math.min(100, Math.round(downloaded / total * 100)) : 0;
            const label = running ? "Running" : starting ? "Starting"
              : downloading && !cancelling ? `Downloading ${percentage}%`
              : complete ? "Downloaded" : event?.state === "error" ? "Download failed"
                : downloaded > 0 ? "Paused" : "Not downloaded";
            const downloadChecked = !cancelling && (complete || downloading);
            const wanted = wantedModelIds(config).includes(model.id);
            const runChecked = wanted || running;
            const modelBusy = busy.some((key) => key.endsWith(`:${model.id}`));
            const deleteReason = isBundledModel
              ? "Keep shipped Bees AI models available for local operations"
              : `Delete ${model.name} from your model list`;
            return h("tr", { key: model.id, "data-model-id": model.id },
              h("td", null,
                h("div", { className: "bees-local-model-name" }, model.name,
                  model.id === DEFAULT_LOCAL_MODEL.id ? h("span", { className: "bees-badge" }, "Default") : null),
                h("div", { className: "bees-muted" }, `${model.bytes ? bytes(model.bytes) : "Size found when downloaded"} · private on this device`)),
              h("td", { className: "bees-local-model-status" },
                h("span", { className: `bees-status ${running ? "bees-running" : ""}` }, label),
                downloading && !cancelling ? h("progress", { className: "bees-local-model-progress", max: total, value: downloaded }) : null),
              h("td", null, h("label", { className: "bees-local-toggle" },
                h("input", { type: "checkbox", role: "switch", "data-model-toggle": "download",
                  "aria-label": `Download ${model.name}`, checked: downloadChecked,
                  disabled: running && !downloading,
                  onChange: (change) => change.target.checked ? download(model) : downloading ? cancelDownload(model) : removeFile(model) }),
                h("span", null, downloadChecked ? "On" : "Off"))),
              h("td", null, h("label", { className: "bees-local-toggle" },
                h("input", { type: "checkbox", role: "switch", "data-model-toggle": "run",
                  "aria-label": `Run ${model.name}`, checked: runChecked,
                  disabled: modelBusy && !runPending,
                  onChange: (change) => change.target.checked ? run(model) : stop(model) }),
                h("span", null, runChecked ? "On" : "Off"))),
              h("td", null, h(Button, { className: "danger bees-local-delete", title: deleteReason,
                "aria-label": deleteReason, disabled: modelBusy || isBundledModel,
                onClick: () => remove(model) }, "Delete")));
          })))),
        error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
    }

    function LocalAiSettings({ modelSettings, preferences, systemDefault, ask, confirmAction, Button }) {
      return h("section", { "data-bees-plugin": "@bees/dsh-local-ai" },
        h("h2", { className: "bees-section-title" }, "Bees AI"),
        h("p", { className: "bees-muted" }, "Bees downloads and starts GGUF models for you. Use the switches to keep a model downloaded or run it."),
        h(LocalModels, { modelSettings, preferences, systemDefault, ask, Button, confirmAction }));
    }

    function ExternalLocalAiSettings({ modelSettings, preferences, systemDefault, ask, Button }) {
      const config = usePreference(modelSettings);
      const ui = usePreference(preferences);
      const active = config.providers?.["external-local-ai"];
      const local = active ?? ui.externalLocalAiProfile ?? {};
      const enabled = Boolean(active);
      const protects = (model) => systemDefault?.provider === "external-local-ai" && (!model || systemDefault.model === model);
      const defaultGuard = "Choose another System default above before removing or turning off this connection.";
      const [error, setError] = useState("");
      // llama.cpp, LM Studio and Ollama want no auth, but pi-ai refuses a provider with neither.
      const authorized = (profile) => ({ ...profile, headers: { authorization: "Bearer local" } });
      const saveProfile = async (profile) => {
        await preferences.set("externalLocalAiProfile", profile);
        if (enabled) await modelSettings.set("providers", { ...config.providers, "external-local-ai": authorized(profile) });
      };
      const configure = async () => {
        try {
          const baseURL = await ask("Other local AI server URL", local.baseURL ?? "http://127.0.0.1:1234/v1");
          if (!baseURL) return;
          const url = new URL(baseURL);
          if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use an http:// or https:// URL");
          let models = local.models ?? [];
          if (!models.length) {
            const id = (await ask("Model ID", "active"))?.trim(); if (!id) return;
            models = [{ id, name: id, contextWindow: 32768, maxTokens: 8192 }];
          }
          const profile = {
            ...local, displayName: "Another local AI server", api: local.api ?? "openai-completions", baseURL: url.toString().replace(/\/$/, ""),
            models
          };
          await preferences.set("externalLocalAiProfile", profile);
          await modelSettings.set("providers", { ...config.providers, "external-local-ai": authorized(profile) });
          setError("");
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      };
      const addModel = async () => {
        try {
          const id = (await ask("Model ID", ""))?.trim(); if (!id) return;
          if (local.models?.some((entry) => entry.id === id)) throw new Error(`${id} is already connected`);
          await saveProfile({ ...local, models: [...(local.models ?? []), { id, name: id, contextWindow: 32768, maxTokens: 8192 }] });
          setError("");
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      };
      const removeModel = async (id) => {
        if ((local.models?.length ?? 0) <= 1) return;
        await saveProfile({ ...local, models: local.models.filter((entry) => entry.id !== id) });
      };
      const toggle = async (enabled) => {
        const providers = { ...(config.providers ?? {}) };
        if (enabled) {
          if (!local.baseURL) return configure();
          providers["external-local-ai"] = authorized(local);
        } else {
          await preferences.set("externalLocalAiProfile", local);
          delete providers["external-local-ai"];
        }
        await modelSettings.set("providers", providers);
      };
      return h("section", { "data-bees-plugin": "@bees/dsh-local-ai-external" },
        h("h2", { className: "bees-section-title" }, "Another local AI server"),
        h("p", { className: "bees-muted" }, "Connect LM Studio, Ollama, llama.cpp, or another OpenAI-compatible server that you run separately."),
        h("section", { className: "bees-box bees-subscription" }, h("div", null, h("h3", null, local.displayName ?? "OpenAI-compatible local server"),
          h("p", { className: "bees-muted" }, local.baseURL ? `${local.baseURL} · ${local.models?.length ?? 0} model${local.models?.length === 1 ? "" : "s"}` : "Not connected"),
          local.baseURL ? h("div", { className: "bees-local-server-models" },
            ...(local.models ?? []).map((model) => h("span", { className: "bees-badge", key: model.id }, model.id,
              h(Button, { title: protects(model.id) ? defaultGuard : `Delete ${model.id}`, "aria-label": `Delete ${model.id}`,
                disabled: local.models.length <= 1 || protects(model.id),
                onClick: () => removeModel(model.id) }, "×"))),
            h(Button, { onClick: addModel }, "Add model")) : null),
          h("div", { className: "bees-subscription-actions" },
            local.baseURL ? h("label", { className: "bees-local-toggle", title: enabled && protects() ? defaultGuard : "" }, h("input", {
              type: "checkbox", role: "switch", checked: enabled, disabled: enabled && protects(),
              "aria-label": "Enable another local AI server", onChange: (event) => toggle(event.target.checked) }), h("span", null, enabled ? "On" : "Off")) : null,
            h(Button, { className: local.baseURL ? "" : "primary", onClick: configure }, local.baseURL ? "Edit endpoint" : "Connect"))),
        error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
    }

    exports.recommendedLocalModel = recommendedLocalModel;
    exports.LOCAL_MODELS = LOCAL_MODELS;
    exports.DEFAULT_LOCAL_MODEL = DEFAULT_LOCAL_MODEL;
    exports.LocalAiController = LocalAiController;
    exports.LocalAiSettings = LocalAiSettings;
    exports.ExternalLocalAiSettings = ExternalLocalAiSettings;
    exports.inject = [];
    exports.apply = (ctx) => {
      const style = document.createElement("style");
      style.dataset.plugin = "@bees/dsh-local-ai";
      style.textContent = css;
      document.head.append(style);
      ctx.effect(() => () => style.remove(), "bees-local-ai: styles");
    };
    return module.exports;
  }
});
