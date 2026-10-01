window.__ModuleLoader__.load({
  id: "@bees/dsh-custom-ai",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useMemo, useState } = React;

    const PROVIDERS = [
      { id: "openrouter", name: "OpenRouter", signup: "https://openrouter.ai/keys", note: "Uses API credits and paid models" },
      { id: "google", name: "Google AI Studio", signup: "https://aistudio.google.com/apikey", note: "Gemini API" },
      { id: "groq", name: "Groq", signup: "https://console.groq.com/keys", note: "Fast hosted models" },
      { id: "cerebras", name: "Cerebras", signup: "https://cloud.cerebras.ai", note: "Fast hosted models" },
      { id: "mistral", name: "Mistral", signup: "https://console.mistral.ai/api-keys/", note: "Mistral platform" },
      { id: "nvidia", name: "NVIDIA NIM", signup: "https://build.nvidia.com/settings/api-keys", note: "Hosted model catalog" },
      { id: "deepseek", name: "DeepSeek", signup: "https://platform.deepseek.com/api_keys", note: "DeepSeek API" },
      { id: "huggingface", name: "Hugging Face", signup: "https://huggingface.co/settings/tokens", note: "Inference providers" },
      { id: "together", name: "Together AI", signup: "https://api.together.ai/settings/api-keys", note: "Open model hosting" },
      { id: "fireworks", name: "Fireworks AI", signup: "https://app.fireworks.ai/settings/users/api-keys", note: "Open model hosting" },
      { id: "xai", name: "xAI", signup: "https://console.x.ai/team/default/api-keys", note: "Grok API" },
      { id: "opencode-go", name: "OpenCode Zen", signup: "https://opencode.ai/auth", note: "DeepSeek and other models" }
    ];
    const BY_ID = Object.fromEntries(PROVIDERS.map((provider) => [provider.id, provider]));
    // OpenCode's Go plan routes every request by session, and the installed catalog sends no such
    // header. Naming the endpoint here also lets the plan's newer models through, catalog or not.
    const SESSION = crypto.randomUUID();
    const ROUTES = { "opencode-go": { api: "openai-completions", baseURL: "https://opencode.ai/zen/go/v1",
      headers: { "x-opencode-session": SESSION } } };
    // OpenRouter and Fireworks describe both protocols in their catalogs, so a route that names one
    // of its own would send the other's models to the wrong endpoint. A route with its own baseURL is
    // the one case that must keep it: nothing else describes what its endpoint speaks.
    const routeOf = (route = {}) => {
      if (route.baseURL) return { ...route };
      const { api, ...rest } = route;
      return rest;
    };
    // Preserve credentials saved by the earlier combined AI APIs screen.
    const refFor = (provider) => `BEES_FREE_${provider.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_API_KEY`;
    const CUSTOM_KEY_REF = "BEES_CUSTOM_OPENAI_API_KEY";
    const css = `
      .bees-general-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.bees-general-table{overflow-x:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill)}.bees-general-table table{width:100%;min-width:940px;border-collapse:collapse}.bees-general-table th,.bees-general-table td{padding:11px 13px;border-bottom:1px solid var(--dsw-alias-border-l1);text-align:left;vertical-align:middle}.bees-general-table th{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:700;text-transform:uppercase}.bees-general-table tbody tr:last-child td{border-bottom:0}.bees-general-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.bees-general-models{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.bees-general-models .bees-badge{gap:4px;text-transform:none}.bees-general-models .bees-badge .bees-btn{padding:0;border:0;background:transparent;font-size:14px;line-height:1}.bees-general-add{display:grid;grid-template-columns:minmax(160px,1fr) minmax(190px,1.5fr) minmax(190px,1.5fr);gap:10px;align-items:end}.bees-general-add label{display:grid;gap:5px}.bees-general-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;grid-column:1/-1}.bees-general-card{display:grid;gap:3px;min-height:70px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:inherit;background:var(--dsw-alias-bg-base);text-align:left;cursor:pointer}.bees-general-card:hover,.bees-general-card.active{border-color:#f2b84b;background:#f2b84b18}.bees-general-card span{color:var(--dsw-alias-label-secondary);font-size:11px}.bees-general-toggle{display:inline-flex;align-items:center;gap:7px;cursor:pointer}.bees-general-toggle input{appearance:none;width:34px;height:20px;margin:0;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-specific-sidebar-fill);position:relative}.bees-general-toggle input:after{content:"";position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary)}.bees-general-toggle input:checked{border-color:#f2b84b;background:#f2b84b}.bees-general-toggle input:checked:after{left:16px;background:#151515}@media(max-width:760px){.bees-general-add{grid-template-columns:1fr}}
    `;

    function usePreference(scope) {
      const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
      useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
      return snapshot.value ?? {};
    }

    const unwrap = (result) => {
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    };

    // A few tokens of a real call, because the model-list endpoints answer any key, junk included.
    async function testProvider(provider, model, key) {
      const response = await fetch("/bees-api/general-ai/test", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, model, key }),
        signal: AbortSignal.timeout(45_000)
      }).catch(() => { throw new Error("Bees did not answer the connection test. Restart Bees, then try again."); });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Connection test failed");
      return value;
    }

    function CustomAiSettings({ ctx, modelSettings, preferences, systemDefault, ask, confirmAction, openExternal, Button }) {
      const config = usePreference(modelSettings);
      const ui = usePreference(preferences);
      const productDefaults = preferences.productDefaults === true;
      const credentials = ctx.remote.credentials;
      const custom = config.providers?.["custom-openai"] ?? {};
      const protects = (provider, model) => systemDefault?.provider === provider && (!model || systemDefault.model === model);
      const defaultGuard = "Choose another System default above before removing or turning off this connection.";
      const [credentialState, setCredentialState] = useState({});
      const [tests, setTests] = useState({});
      const [adding, setAdding] = useState(false);
      const [selected, setSelected] = useState("");
      const [key, setKey] = useState("");
      const [model, setModel] = useState("");
      const [busy, setBusy] = useState("");
      const [error, setError] = useState("");
      const ids = useMemo(() => [...new Set([
        ...(Array.isArray(ui.generalAiProviders) ? ui.generalAiProviders : []),
        ...PROVIDERS.filter(({ id }) => config.providers?.[id]).map(({ id }) => id)
      ])].filter((id) => BY_ID[id]), [ui.generalAiProviders, config.providers]);
      const available = PROVIDERS.filter(({ id }) => !ids.includes(id));
      const chosen = available.some(({ id }) => id === selected) ? selected : "";

      const refreshCredentials = async () => {
        if (productDefaults) return;
        const refs = Object.fromEntries(PROVIDERS.map(({ id }) => [id, refFor(id)]));
        const described = unwrap(await credentials.describe(Object.values(refs)));
        setCredentialState(Object.fromEntries(PROVIDERS.map(({ id }) => [id, described[refs[id]]?.configured === true])));
      };
      useEffect(() => { void refreshCredentials().catch((reason) => setError(reason.message)); }, [ctx]);

      const perform = async (name, work) => {
        setBusy(name); setError("");
        try { await work(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setBusy(""); }
      };
      const saveKey = async (id, value) => {
        unwrap(await credentials.set(refFor(id), value));
        await refreshCredentials();
      };
      const modelsFor = (id) => config.providers?.[id]?.models ?? ui.generalAiModels?.[id] ?? [];
      const idsOf = (models) => (models ?? []).map((entry) => entry.id).join(", ");
      // A write the app turns down reloads the stored document instead of throwing, so a route it
      // will not accept has to be noticed here or the switch silently stays off.
      const unknownModel = (id) => new Error(`Bees cannot serve that ${BY_ID[id].name} model ID. Try a model ID ${BY_ID[id].name} itself lists, or connect it below under Custom OpenAI-compatible API.`);
      const unchanged = (id) => new Error(`Bees did not save that change to ${BY_ID[id].name}. Try again.`);
      const stored = (id) => modelSettings.getSnapshot().value?.providers?.[id];
      const saveModels = async (id, models) => {
        const providers = { ...(modelSettings.getSnapshot().value?.providers ?? {}) };
        if (providers[id]) {
          providers[id] = routeOf(providers[id]);
          if (models.length) providers[id].models = models;
          else delete providers[id].models;
          await modelSettings.set("providers", providers);
          if (idsOf(stored(id)?.models) !== idsOf(models)) throw unknownModel(id);
        }
        await preferences.set("generalAiModels", { ...(preferences.getSnapshot().value?.generalAiModels ?? {}), [id]: models });
      };
      const setEnabled = async (id, enabled, requestedModels = modelsFor(id)) => {
        const providers = { ...(modelSettings.getSnapshot().value?.providers ?? {}) };
        if (enabled) {
          providers[id] = { ...routeOf(providers[id]), displayName: BY_ID[id].name, apiKeyEnv: refFor(id), ...ROUTES[id] };
          if (requestedModels.length) providers[id].models = requestedModels;
        } else {
          if (requestedModels.length) await preferences.set("generalAiModels", { ...(ui.generalAiModels ?? {}), [id]: requestedModels });
          delete providers[id];
        }
        await modelSettings.set("providers", providers);
        if (enabled && !stored(id)) throw unknownModel(id);
        // turning one off is a write like any other, and a refused one would leave the key gone
        if (!enabled && stored(id)) throw unchanged(id);
      };
      const saveProviderIds = (next) => preferences.set("generalAiProviders", next);
      const add = () => perform(`add:${chosen}`, async () => {
        if (!chosen) throw new Error("Choose a provider");
        if (!productDefaults && !key.trim()) throw new Error("Enter the API key");
        if (!model.trim()) throw new Error("Enter the model ID");
        const models = [{ id: model.trim() }];
        if (!productDefaults) {
          const result = await testProvider(chosen, model.trim(), key.trim());
          await saveKey(chosen, key.trim());
          setTests((current) => ({ ...current, [chosen]: result.message }));
        }
        await setEnabled(chosen, true, models);
        await saveProviderIds([...new Set([...ids, chosen])]);
        await preferences.set("generalAiModels", { ...(ui.generalAiModels ?? {}), [chosen]: models });
        setKey(""); setModel(""); setSelected(""); setAdding(false);
      });
      const addModel = (id) => perform(`model:${id}`, async () => {
        const value = (await ask(`${BY_ID[id].name} model ID`, ""))?.trim();
        if (!value) return;
        const models = modelsFor(id);
        if (models.some((entry) => entry.id === value)) throw new Error(`${value} is already connected`);
        await saveModels(id, [...models, { id: value }]);
      });
      const removeModel = (id, modelId) => perform(`model:${id}`, () => {
        if (modelsFor(id).length <= 1) throw new Error("A connection needs at least one model");
        return saveModels(id, modelsFor(id).filter((entry) => entry.id !== modelId));
      });
      const replaceKey = (id) => perform(`key:${id}`, async () => {
        const value = await ask(`${BY_ID[id].name} API key`, "", "password");
        if (!value) return;
        const result = await testProvider(id, modelsFor(id)[0]?.id, value);
        await saveKey(id, value);
        setTests((current) => ({ ...current, [id]: result.message }));
      });
      const test = (id) => perform(`test:${id}`, async () => {
        const result = await testProvider(id, modelsFor(id)[0]?.id);
        setTests((current) => ({ ...current, [id]: result.message }));
      });
      const remove = (id) => perform(`remove:${id}`, async () => {
        if (!await confirmAction(productDefaults ? `Remove ${BY_ID[id].name} from product defaults?` : `Remove ${BY_ID[id].name} and its saved API key?`)) return;
        await setEnabled(id, false);
        if (!productDefaults) unwrap(await credentials.unset(refFor(id)));
        await saveProviderIds(ids.filter((value) => value !== id));
        const models = { ...(ui.generalAiModels ?? {}) }; delete models[id];
        await preferences.set("generalAiModels", models);
        await refreshCredentials();
      });
      const configureCustom = () => perform("custom", async () => {
        const baseURL = await ask("Custom OpenAI-compatible API base URL", custom.baseURL ?? "https://api.example.com/v1");
        if (!baseURL) return;
        let models = custom.models ?? [];
        if (!models.length) {
          const id = (await ask("Model ID", "default"))?.trim(); if (!id) return;
          models = [{ id, name: id, contextWindow: 131072, maxTokens: 8192 }];
        }
        if (!productDefaults) {
          const value = await ask("API key (leave blank to keep the stored key)", "", "password");
          if (value) unwrap(await credentials.set(CUSTOM_KEY_REF, value));
          // Registering the provider without a stored key only fails later, at the first call.
          else if (!unwrap(await credentials.describe([CUSTOM_KEY_REF]))[CUSTOM_KEY_REF]?.configured)
            throw new Error("An API key is needed the first time you connect this server");
        }
        await modelSettings.set("providers", { ...(config.providers ?? {}), "custom-openai": {
          ...custom, displayName: "Custom OpenAI-compatible API", api: custom.api ?? "openai-completions", baseURL,
          apiKeyEnv: CUSTOM_KEY_REF,
          models
        } });
        if (!stored("custom-openai")?.baseURL) throw new Error("Bees did not save that endpoint. Try again.");
      });
      const addCustomModel = () => perform("custom-model", async () => {
        const id = (await ask("Model ID", ""))?.trim(); if (!id) return;
        if (custom.models?.some((entry) => entry.id === id)) throw new Error(`${id} is already connected`);
        const models = [...(custom.models ?? []), { id, name: id, contextWindow: 131072, maxTokens: 8192 }];
        await modelSettings.set("providers", { ...(config.providers ?? {}), "custom-openai": { ...custom, models } });
      });
      const removeCustomModel = (id) => perform("custom-model", async () => {
        if ((custom.models?.length ?? 0) <= 1) throw new Error("A connected endpoint needs at least one model");
        await modelSettings.set("providers", { ...(config.providers ?? {}), "custom-openai": {
          ...custom, models: custom.models.filter((entry) => entry.id !== id)
        } });
      });

      return h("section", { "data-bees-plugin": "@bees/dsh-custom-ai" },
        h("div", { className: "bees-general-head", style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "14px", marginBottom: "16px" } }, h("div", null,
          h("h3", { className: "bees-section-title", style: { marginBottom: "4px" } }, "General AI APIs"),
          h("p", { className: "bees-muted", style: { margin: 0 } }, "Your own API key. Your messages go to that provider and may consume credits.")),
          h(Button, { className: "primary", disabled: Boolean(busy) || (!adding && !available.length),
            onClick: () => { setAdding((value) => !value); setSelected(""); setKey(""); setModel(""); } }, adding ? "Cancel" : available.length ? "Add provider" : "All added")),
        adding ? h("section", { className: "bees-box bees-general-add" },
          h("div", { className: "bees-general-grid", role: "list", "aria-label": "General AI API providers" },
            ...available.map((provider) => h("button", { type: "button", key: provider.id, className: `bees-general-card ${chosen === provider.id ? "active" : ""}`,
              "aria-pressed": chosen === provider.id, onClick: () => { setSelected(provider.id); setKey(""); } },
              h("strong", null, provider.name), h("span", null, provider.note)))),
          chosen ? h(React.Fragment, null,
            h("label", null, `${BY_ID[chosen].name} API key`, h("input", { className: "bees-input", type: "password", value: key,
              disabled: productDefaults, autoComplete: "off", placeholder: productDefaults ? "Each user supplies their own key" : "Paste the key here", onChange: (event) => setKey(event.target.value) })),
            h("label", null, "Model ID", h("input", { className: "bees-input", value: model,
              placeholder: chosen === "openrouter" ? "e.g. anthropic/claude-sonnet-5" : "Provider model ID",
              onChange: (event) => setModel(event.target.value) })),
            h(Button, { disabled: Boolean(busy), onClick: () => perform(`link:${chosen}`, () => openExternal(BY_ID[chosen].signup)) }, "Create key / sign up"),
            h(Button, { className: "primary", disabled: Boolean(busy) || (!productDefaults && !key.trim()) || !model.trim(), onClick: add }, busy === `add:${chosen}` ? "Saving…" : productDefaults ? "Add provider" : "Add and test")) :
            h("p", { className: "bees-muted" }, "Choose a provider to configure it.")) : null,
        ids.length ? h("div", { className: "bees-general-table" }, h("table", null,
          h("thead", null, h("tr", null, h("th", null, "Provider"), h("th", null, "Models"), h("th", null, "Test"), h("th", null, "Enabled"), h("th", null, "Remove"))),
          h("tbody", null, ...ids.map((id) => {
            const provider = BY_ID[id];
            const enabled = Boolean(config.providers?.[id]);
            const models = modelsFor(id);
            return h("tr", { key: id, "data-provider-id": id },
              h("td", null, h("strong", null, provider.name), h("div", { className: "bees-muted" }, provider.note),
                h("div", { className: "bees-general-actions" },
                  h("span", { className: `bees-status ${credentialState[id] ? "bees-running" : ""}` }, credentialState[id] ? "API key saved" : "API key needed"),
                  h(Button, { disabled: productDefaults || Boolean(busy), onClick: () => replaceKey(id) }, credentialState[id] ? "Replace" : "Add key"),
                  h(Button, { disabled: Boolean(busy), onClick: () => perform(`link:${id}`, () => openExternal(provider.signup)) }, "Provider website"))),
              h("td", null, h("div", { className: "bees-general-models", style: { display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" } },
                ...(models.length ? models.map((entry) => h("span", { className: "bees-badge", key: entry.id, style: { display: "inline-flex", alignItems: "center", gap: "4px" } }, entry.id,
                  h(Button, { title: protects(id, entry.id) ? defaultGuard : `Remove ${entry.id}`, "aria-label": `Remove ${entry.id}`,
                    disabled: Boolean(busy) || protects(id, entry.id), onClick: () => removeModel(id, entry.id) }, "×")))
                  : [h("span", { className: "bees-muted", key: "all" }, "All catalog models")]),
                h(Button, { disabled: Boolean(busy), onClick: () => addModel(id) }, "Add model"))),
              h("td", null, h("div", { className: "bees-general-actions" },
                h(Button, { disabled: productDefaults || Boolean(busy) || !credentialState[id], onClick: () => test(id) }, busy === `test:${id}` ? "Testing…" : "Test"),
                tests[id] ? h("span", { className: "bees-status bees-running" }, tests[id]) : null)),
              h("td", null, h("label", { className: "bees-general-toggle" },
                h("input", { type: "checkbox", role: "switch", checked: enabled,
                  title: enabled && protects(id) ? defaultGuard : "",
                  disabled: Boolean(busy) || (!productDefaults && !credentialState[id]) || (enabled && protects(id)),
                  "aria-label": `Enable ${provider.name}`, onChange: (event) => perform(`toggle:${id}`, () => setEnabled(id, event.target.checked)) }),
                h("span", null, enabled ? "On" : "Off"))),
              h("td", null, h(Button, { className: "danger", title: protects(id) ? defaultGuard : "",
                disabled: Boolean(busy) || protects(id), onClick: () => remove(id) }, "Remove")));
          })))) : h("div", { className: "bees-empty-state" },
            h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2" },
              h("rect", { x: "2", y: "6", width: "20", height: "12", rx: "2" }),
              h("path", { d: "M12 12h.01M16 12h.01M8 12h.01" })
            ),
            h("p", null, "No general AI provider added yet. Click Add provider.")),
        h("div", { style: { marginTop: "24px", paddingTop: "24px", borderTop: "1px solid var(--dsw-alias-border-l1)" } }, h("h3", null, "Custom OpenAI-compatible API"),
          h("p", { className: "bees-muted" }, custom.baseURL ?? "Connect another hosted /v1 endpoint with an API key."),
          custom.baseURL ? h("div", { className: "bees-general-models", style: { display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", marginTop: "8px" } },
            ...(custom.models ?? []).map((entry) => h("span", { className: "bees-badge", key: entry.id, style: { display: "inline-flex", alignItems: "center", gap: "4px" } }, entry.id,
              h(Button, { title: protects("custom-openai", entry.id) ? defaultGuard : `Remove ${entry.id}`,
                "aria-label": `Remove ${entry.id}`, disabled: Boolean(busy) || custom.models.length <= 1 || protects("custom-openai", entry.id),
                onClick: () => removeCustomModel(entry.id) }, "×"))),
            h(Button, { disabled: Boolean(busy), onClick: addCustomModel }, "Add model")) : null,
          h(Button, { disabled: Boolean(busy), onClick: configureCustom }, custom.baseURL ? "Edit endpoint" : "Connect")),
        error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
    }

    exports.CustomAiSettings = CustomAiSettings;
    exports.inject = ["remote", "remote.credentials"];
    exports.apply = (ctx) => {
      const style = document.createElement("style");
      style.dataset.plugin = "@bees/dsh-custom-ai";
      style.textContent = css;
      document.head.append(style);
      ctx.effect(() => () => style.remove(), "bees general AI: styles");
    };
    return module.exports;
  }
});
