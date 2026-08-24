window.__ModuleLoader__.load({
  id: "@bees/dsh-local-ai",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useMemo, useRef, useState } = React;

    const LOCAL_MODELS = [
      {
        id: "nanbeige-4-2-3b-q6-k", name: "Nanbeige 4.2 3B (Q6_K)",
        fileName: "Nanbeige4.2-3B-Q6_K.gguf",
        url: "https://huggingface.co/owao/Nanbeige4.2-3B-GGUF/resolve/main/Nanbeige4.2-3B-Q6_K.gguf?download=true",
        bytes: 3424947040,
        sha256: "d9382dbca171ff0c5a31eaef84deb645c8882d6bae2a3eccf57006b6fe16e0df",
        contextSize: 8192
      },
      {
        id: "gemma-4-e2b-it-qat-q4-0", name: "Gemma 4 E2B (Q4_0)",
        fileName: "gemma-4-E2B_q4_0-it.gguf",
        url: "https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/resolve/main/gemma-4-E2B_q4_0-it.gguf?download=true",
        bytes: 3349516256,
        sha256: "fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634"
      },
      {
        id: "qwen3-0-6b-q8-0", name: "Qwen3 0.6B (Q8_0)",
        fileName: "Qwen3-0.6B-Q8_0.gguf",
        url: "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf?download=true",
        bytes: 639446688,
        sha256: "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031"
      }
    ];
    const DEFAULT_LOCAL_MODEL = LOCAL_MODELS[0];

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

    function invokeLocal(command, args = {}) {
      const invoke = window.__TAURI__?.core?.invoke;
      if (!invoke) throw new Error("Local AI controls are available in the Bees desktop app.");
      return invoke(command, args);
    }

    function bytes(value) {
      return value ? `${(value / 1024 / 1024 / 1024).toFixed(value >= 1024 ** 3 ? 1 : 2)} GB` : "0 GB";
    }

    const allModels = (config) => [...LOCAL_MODELS, ...(Array.isArray(config.localModels) ? config.localModels : [])];

    async function activateLocalModel(model, models, modelSettings) {
      await invokeLocal("ensure_local_model", { spec: model });
      for (const other of models) {
        if (other.id !== model.id) await invokeLocal("stop_local_model", { modelId: other.id });
      }
      await invokeLocal("start_local_model", { spec: model });
      const connection = await invokeLocal("local_model_connection");
      const config = settingValue(modelSettings);
      await modelSettings.set("providers", { ...config.providers, "local-openai": {
        ...(config.providers?.["local-openai"] ?? {}), displayName: "Local AI",
        api: "openai-completions", baseURL: connection.baseUrl,
        models: [{ id: "active", name: model.name, contextWindow: connection.contextWindow,
          maxTokens: Math.min(4096, Math.floor(connection.contextWindow / 2)) }]
      } });
    }

    function LocalAiController({ modelSettings, preferences, onError }) {
      const started = useRef(false);
      useEffect(() => {
        if (started.current || !window.__TAURI__?.core?.invoke) return;
        started.current = true;
        const config = settingValue(preferences);
        const wanted = config.localModelWantedId;
        if (!wanted) return;
        const models = allModels(config);
        const model = models.find(({ id }) => id === wanted);
        if (!model) return;
        void activateLocalModel(model, models, modelSettings).catch((reason) => {
          const message = reason instanceof Error ? reason.message : String(reason);
          if (message !== "Model download cancelled") onError?.(`Local AI could not start: ${message}`);
        });
      }, []);
      return null;
    }

    function LocalModels({ modelSettings, preferences, systemDefault, ask, Button, confirmAction }) {
      const config = usePreference(preferences);
      const models = useMemo(() => allModels(config), [config.localModels]);
      const [statuses, setStatuses] = useState({});
      const [progress, setProgress] = useState({});
      const [busy, setBusy] = useState("");
      const [error, setError] = useState("");
      const refresh = async () => {
        if (!window.__TAURI__?.core?.invoke) return;
        const rows = await Promise.all(models.map(async (model) =>
          [model.id, await invokeLocal("local_model_status", { spec: model })]));
        setStatuses(Object.fromEntries(rows));
      };
      useEffect(() => {
        void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
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
        setBusy(key); setError("");
        try { await work(); await refresh(); }
        catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          if (message !== "Model download cancelled") setError(message);
        } finally { setBusy((current) => current === key ? "" : current); }
      };
      const download = (model) => perform("download", model,
        () => invokeLocal("ensure_local_model", { spec: model }));
      const cancelDownload = (model) => perform("cancel", model, async () => {
        await invokeLocal("cancel_local_model_download", { modelId: model.id });
        if (config.localModelWantedId === model.id) await preferences.set("localModelWantedId", "");
      });
      const run = (model) => perform("run", model, async () => {
        await preferences.set("localModelWantedId", model.id);
        await activateLocalModel(model, models, modelSettings);
      });
      const stop = (model) => perform("stop", model, async () => {
        await invokeLocal("cancel_local_model_download", { modelId: model.id });
        await invokeLocal("stop_local_model", { modelId: model.id });
        if (config.localModelWantedId === model.id) await preferences.set("localModelWantedId", "");
      });
      const remove = async (model) => {
        if (!await confirmAction(`Delete ${model.name} from this device?`)) return;
        await perform("delete", model, async () => {
          await invokeLocal("delete_local_model", { spec: model });
          if (config.localModelWantedId === model.id) await preferences.set("localModelWantedId", "");
          if (Array.isArray(config.localModels) && config.localModels.some(({ id }) => id === model.id)) {
            await preferences.set("localModels", config.localModels.filter(({ id }) => id !== model.id));
          }
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

      return h("div", { className: "bees-stack" },
        h("div", { className: "bees-local-model-head" },
          h("p", { className: "bees-muted" }, "Models stay private on this device."),
          h(Button, { className: "primary", onClick: addModel }, "Add a model")),
        h("div", { className: "bees-local-model-table" }, h("table", null,
          h("thead", null, h("tr", null,
            h("th", null, "Model"), h("th", null, "Status"), h("th", null, "Download"),
            h("th", null, "Run"), h("th", null, "Delete"))),
          h("tbody", null, ...models.map((model) => {
            const status = statuses[model.id];
            const event = progress[model.id];
            const complete = status?.state === "ready" || status?.running;
            const running = Boolean(status?.running);
            const runPending = busy === `run:${model.id}`;
            const downloading = status?.state === "downloading" || event?.state === "downloading"
              || busy === `download:${model.id}` || (runPending && !complete);
            const cancelling = busy === `cancel:${model.id}` || busy === `delete:${model.id}`;
            const total = event?.totalBytes || status?.totalBytes || model.bytes;
            const downloaded = event?.downloadedBytes ?? status?.downloadedBytes ?? 0;
            const percentage = total ? Math.min(100, Math.round(downloaded / total * 100)) : 0;
            const label = running ? "Running" : downloading && !cancelling ? `Downloading ${percentage}%`
              : complete ? "Downloaded" : event?.state === "error" ? "Download failed"
                : downloaded > 0 ? "Paused" : "Not downloaded";
            const downloadChecked = !cancelling && (complete || downloading);
            const runChecked = running || runPending;
            const protectedRunning = runChecked && systemDefault?.provider === "local-openai";
            const defaultGuard = "Choose another System default above before stopping or removing the running local model.";
            const otherBusy = Boolean(busy) && !busy.endsWith(`:${model.id}`);
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
                  disabled: running || otherBusy,
                  onChange: (change) => change.target.checked ? download(model) : downloading ? cancelDownload(model) : remove(model) }),
                h("span", null, downloadChecked ? "On" : "Off"))),
              h("td", null, h("label", { className: "bees-local-toggle", title: protectedRunning ? defaultGuard : "" },
                h("input", { type: "checkbox", role: "switch", "data-model-toggle": "run",
                  "aria-label": `Run ${model.name}`, checked: runChecked,
                  disabled: protectedRunning || otherBusy || (Boolean(busy) && !runPending),
                  onChange: (change) => change.target.checked ? run(model) : stop(model) }),
                h("span", null, runChecked ? "On" : "Off"))),
              h("td", null, h(Button, { className: "danger bees-local-delete", title: protectedRunning ? defaultGuard : `Delete ${model.name}`,
                "aria-label": `Delete ${model.name}`, disabled: protectedRunning || Boolean(busy) || (!downloaded && !complete && !config.localModels?.some(({ id }) => id === model.id)),
                onClick: () => remove(model) }, config.localModels?.some(({ id }) => id === model.id) ? "Remove" : "Delete")));
          })))),
        error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
    }

    function LocalAiSettings({ modelSettings, preferences, systemDefault, ask, confirmAction, Button }) {
      return h("section", { "data-bees-plugin": "@bees/dsh-local-ai" },
        h("h2", { className: "bees-section-title" }, "Local AI"),
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
      const saveProfile = async (profile) => {
        await preferences.set("externalLocalAiProfile", profile);
        if (enabled) await modelSettings.set("providers", { ...config.providers, "external-local-ai": profile });
      };
      const configure = async () => {
        try {
          const baseURL = await ask("Other local AI server URL", local.baseURL ?? "http://127.0.0.1:1234/v1");
          if (!baseURL) return;
          const url = new URL(baseURL);
          if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use an http:// or https:// URL");
          let models = local.models ?? [];
          if (!models.length) {
            const id = (await ask("Model ID", "active")).trim(); if (!id) return;
            models = [{ id, name: id, contextWindow: 32768, maxTokens: 8192 }];
          }
          const profile = {
            ...local, displayName: "Another local AI server", api: local.api ?? "openai-completions", baseURL: url.toString().replace(/\/$/, ""),
            models
          };
          await preferences.set("externalLocalAiProfile", profile);
          await modelSettings.set("providers", { ...config.providers, "external-local-ai": profile });
          setError("");
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      };
      const addModel = async () => {
        try {
          const id = (await ask("Model ID", "")).trim(); if (!id) return;
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
          providers["external-local-ai"] = local;
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
              h(Button, { title: protects(model.id) ? defaultGuard : `Remove ${model.id}`, "aria-label": `Remove ${model.id}`,
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
