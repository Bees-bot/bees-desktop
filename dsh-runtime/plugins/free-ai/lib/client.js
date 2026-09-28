window.__ModuleLoader__.load({
  id: "@bees/dsh-free-ai",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useState } = React;

    const API_KEY_REF = "BEES_FREELLMAPI_API_KEY";
    const PROVIDERS = [
      { id: "google", name: "Google AI Studio", signup: "https://aistudio.google.com/apikey", note: "Gemini free tier" },
      { id: "groq", name: "Groq", signup: "https://console.groq.com/keys", note: "Fast free inference" },
      { id: "cerebras", name: "Cerebras", signup: "https://cloud.cerebras.ai", note: "Fast free inference" },
      { id: "bai", name: "B.ai", signup: "https://b.ai", note: "Free hosted models" },
      { id: "nvidia", name: "NVIDIA NIM", signup: "https://build.nvidia.com/settings/api-keys", note: "Free developer access" },
      { id: "mistral", name: "Mistral", signup: "https://console.mistral.ai/api-keys/", note: "Mistral free tier" },
      { id: "openrouter", name: "OpenRouter Free", signup: "https://openrouter.ai/keys", note: "Free models only; no API credits" },
      { id: "github", name: "GitHub Models", signup: "https://github.com/settings/tokens", note: "Free developer quota" },
      { id: "cohere", name: "Cohere", signup: "https://dashboard.cohere.com/api-keys", note: "Trial API access" },
      { id: "cloudflare", name: "Cloudflare Workers AI", signup: "https://dash.cloudflare.com", note: "Daily free allocation", accountId: true },
      { id: "zhipu", name: "Zhipu AI (Z.ai)", signup: "https://z.ai/manage-apikey/apikey-list", note: "Free hosted models" },
      { id: "ollama", name: "Ollama Cloud", signup: "https://ollama.com/settings/keys", note: "Cloud free tier" },
      { id: "kilo", name: "Kilo Gateway", signup: "https://app.kilo.ai", note: "No key needed", keyless: true },
      { id: "pollinations", name: "Pollinations", signup: "https://enter.pollinations.ai", note: "Shared free capacity" },
      { id: "ovh", name: "OVH AI Endpoints", signup: "https://endpoints.ai.cloud.ovh.net", note: "No key needed", keyless: true },
      { id: "llm7", name: "LLM7", signup: "https://llm7.io", note: "Free hosted models" },
      { id: "huggingface", name: "Hugging Face", signup: "https://huggingface.co/settings/tokens", note: "Inference free tier" },
      { id: "opencode", name: "OpenCode", signup: "https://opencode.ai/auth", note: "Free hosted models" },
      { id: "agnes", name: "Agnes AI", signup: "https://platform.agnes-ai.com", note: "Free hosted models" },
      { id: "reka", name: "Reka", signup: "https://platform.reka.ai", note: "Free hosted models" },
      { id: "siliconflow", name: "SiliconFlow", signup: "https://siliconflow.com", note: "Free hosted models" },
      { id: "routeway", name: "Routeway", signup: "https://routeway.ai", note: "Free hosted models" },
      { id: "bazaarlink", name: "BazaarLink", signup: "https://bazaarlink.ai", note: "Free hosted models" },
      { id: "ainative", name: "AI Native", signup: "https://ainative.studio", note: "Free hosted models" },
      { id: "aion", name: "Aion Labs", signup: "https://www.aionlabs.ai", note: "Free hosted models" },
      { id: "anyapi", name: "AnyAPI", signup: "https://anyapi.ai", note: "Free hosted models" },
      { id: "requesty", name: "Requesty", signup: "https://www.requesty.ai", note: "Free hosted models" },
      { id: "navy", name: "Navy", signup: "https://api.navy", note: "Free hosted models" },
      { id: "nara", name: "Nara Router", signup: "https://router.bynara.id", note: "Free hosted models" },
      { id: "sealion", name: "SEA-LION", signup: "https://sea-lion.ai", note: "Free hosted models" },
      { id: "orcarouter", name: "OrcaRouter", signup: "https://www.orcarouter.ai", note: "Free hosted models" },
      { id: "modelscope", name: "ModelScope", signup: "https://modelscope.cn/my/myaccesstoken", note: "Free hosted models" },
      { id: "aihorde", name: "AI Horde", signup: "https://aihorde.net/register", note: "Community inference" },
      { id: "qianfan", name: "Baidu Qianfan", signup: "https://console.bce.baidu.com/qianfan/overview", note: "Free hosted models" },
      { id: "volcengine", name: "Volcengine Ark", signup: "https://console.volcengine.com/ark", note: "Free hosted models" },
      { id: "longcat", name: "LongCat", signup: "https://longcat.chat/platform", note: "Free hosted models" },
      { id: "xfyun", name: "iFlytek Spark", signup: "https://console.xfyun.cn", note: "Free hosted models" }
    ];
    const BY_ID = Object.fromEntries(PROVIDERS.map((provider) => [provider.id, provider]));
    const css = `
      .bees-free-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.bees-free-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.bees-free-callout{padding:10px 12px;border-left:3px solid #f2b84b;border-radius:6px;background:#f2b84b12}.bees-free-table{overflow-x:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill)}
      .bees-free-table table{width:100%;min-width:900px;border-collapse:collapse}.bees-free-table th,.bees-free-table td{padding:11px 13px;border-bottom:1px solid var(--dsw-alias-border-l1);text-align:left;vertical-align:middle}.bees-free-table th{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}.bees-free-table tbody tr:last-child td{border-bottom:0}.bees-free-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.bees-free-add{display:grid;grid-template-columns:minmax(160px,1fr) minmax(220px,2fr);gap:10px;align-items:end}.bees-free-add label{display:grid;gap:5px}.bees-free-toggle{display:inline-flex;align-items:center;gap:7px;cursor:pointer}.bees-free-toggle input{appearance:none;width:34px;height:20px;margin:0;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-specific-sidebar-fill);position:relative;transition:.15s}.bees-free-toggle input:after{content:"";position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:.15s}.bees-free-toggle input:checked{border-color:#f2b84b;background:#f2b84b}.bees-free-toggle input:checked:after{left:16px;background:#151515}.bees-free-toggle input:disabled{cursor:not-allowed;opacity:.55}.bees-provider-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;grid-column:1/-1}.bees-provider-card{display:grid;gap:3px;min-height:70px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:inherit;background:var(--dsw-alias-bg-base);text-align:left;cursor:pointer}.bees-provider-card:hover,.bees-provider-card.active{border-color:#f2b84b;background:#f2b84b18}.bees-provider-card span{color:var(--dsw-alias-label-secondary);font-size:11px}@media(max-width:760px){.bees-free-add{grid-template-columns:1fr}}
    `;

    function usePreference(scope) {
      const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
      useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
      return snapshot.value ?? {};
    }

    async function responseValue(response, fallback) {
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error || fallback);
      return value;
    }

    async function loadState() {
      return responseValue(await fetch("/bees-api/free-ai/state", { cache: "no-store" }), "FreeLLMAPI could not start");
    }

    async function command(action, values = {}) {
      return responseValue(await fetch("/bees-api/free-ai/command", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...values })
      }), "Free LLM setup failed");
    }

    async function syncFreeRoute(modelSettings, state) {
      // Read the live map: other plugins write providers too, and this ran after a fetch.
      const providers = { ...(modelSettings.getSnapshot().value?.providers ?? {}) };
      const enabled = state.keys.some((row) => row.enabled);
      const desired = {
        displayName: "FreeLLMAPI (free tiers)",
        api: "openai-completions",
        baseURL: state.baseUrl,
        apiKeyEnv: API_KEY_REF,
        models: [{ id: "auto", name: "Automatic free model", contextWindow: 131072, maxTokens: 8192 }]
      };
      if (enabled && JSON.stringify(providers.freellmapi) !== JSON.stringify(desired)) {
        providers.freellmapi = desired;
        await modelSettings.set("providers", providers);
      } else if (!enabled && providers.freellmapi) {
        delete providers.freellmapi;
        await modelSettings.set("providers", providers);
      }
    }

    function providerInfo(platform, runtimeProvider) {
      return { id: platform, name: runtimeProvider?.name ?? platform, signup: "https://freellmapi.co/", note: "Free tier", ...BY_ID[platform], keyless: runtimeProvider?.keyless ?? BY_ID[platform]?.keyless ?? false };
    }

    function statusText(row) {
      if (row.status === "healthy") return "Working";
      if (row.status === "rate_limited") return "Rate limited";
      if (row.status === "invalid") return "Key rejected";
      if (row.status === "error") return "Could not connect";
      return "Not tested";
    }

    function FreeAiController({ modelSettings, onError }) {
      useEffect(() => {
        void loadState().then((state) => syncFreeRoute(modelSettings, state)).catch((reason) => onError?.(reason.message));
      }, []);
      return null;
    }

    function FreeAiSettings({ modelSettings, systemDefault, confirmAction, openExternal, Button }) {
      const [state, setState] = useState(null);
      const [adding, setAdding] = useState(false);
      const [selected, setSelected] = useState("");
      const [key, setKey] = useState("");
      const [accountId, setAccountId] = useState("");
      const [busy, setBusy] = useState("");
      const [error, setError] = useState("");
      const [notice, setNotice] = useState("");

      const acceptState = async (next) => { setState(next); await syncFreeRoute(modelSettings, next); };
      const refresh = async () => acceptState(await loadState());
      useEffect(() => { if (!modelSettings.productDefaults) void refresh().catch((reason) => setError(reason.message)); }, [modelSettings.productDefaults]);

      const perform = async (name, work) => {
        setBusy(name); setError(""); setNotice("");
        try {
          const next = await work();
          if (next?.keys) {
            await acceptState(next);
            if (next.notice) setNotice(next.notice);
          }
          return next;
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason));
        } finally { setBusy(""); }
      };

      const available = (state?.providers ?? []).filter((provider) => !provider.configured);
      const selectedRuntime = available.find((provider) => provider.platform === selected);
      const chosen = selectedRuntime ? providerInfo(selected, selectedRuntime) : null;
      const add = () => perform(`add:${selected}`, async () => {
        if (!chosen) throw new Error("Choose a provider");
        if (!chosen.keyless && !key.trim()) throw new Error("Paste the API key");
        if (chosen.accountId && !accountId.trim()) throw new Error("Enter the Cloudflare account ID");
        const next = await command("add", {
          platform: chosen.id,
          key: chosen.accountId ? `${accountId.trim()}:${key.trim()}` : key.trim()
        });
        setKey(""); setAccountId(""); setSelected(""); setAdding(false);
        return next;
      });
      const test = (row) => perform(`test:${row.id}`, () => command("test", { id: row.id }));
      const toggle = (row, enabled) => perform(`toggle:${row.id}`, () => command("toggle", { id: row.id, enabled }));
      const remove = (row) => perform(`remove:${row.id}`, async () => {
        const provider = providerInfo(row.platform);
        if (!await confirmAction(`Remove ${provider.name} and its saved credential?`)) return null;
        return command("remove", { id: row.id });
      });
      const visit = (provider) => perform(`link:${provider.id}`, async () => { await openExternal(provider.signup); return null; });

      return h("section", { "data-bees-plugin": "@bees/dsh-free-ai" },
        h("div", { className: "bees-free-head" }, h("div", null,
          h("div", { className: "bees-free-title" }, h("h2", { className: "bees-section-title" }, "Free LLM"), h("span", { className: "bees-status bees-running" }, "Embedded")),
          h("p", { className: "bees-muted" }, "FreeLLMAPI is included in Bees. Add provider credentials here; there is nothing else to download, install, or configure."),
          h("p", { className: "bees-muted" }, "Free to use. Your messages go to the provider you connect.")),
          h(Button, { className: "primary", disabled: Boolean(busy) || !state || (!adding && !available.length),
            onClick: () => { setAdding((value) => !value); setSelected(""); setKey(""); setAccountId(""); } },
            adding ? "Cancel" : available.length ? "Add provider" : "All added")),
        h("p", { className: "bees-free-callout" }, "This is separate from general AI APIs. OpenRouter here uses FreeLLMAPI's free-model routing; it does not spend OpenRouter API credits."),
        adding ? h("section", { className: "bees-box bees-free-add" },
          h("div", { className: "bees-provider-grid", role: "list", "aria-label": "Free LLM providers" },
            ...available.map((runtimeProvider) => {
              const provider = providerInfo(runtimeProvider.platform, runtimeProvider);
              return h("button", { type: "button", key: provider.id, className: `bees-provider-card ${selected === provider.id ? "active" : ""}`,
                "aria-pressed": selected === provider.id, onClick: () => { setSelected(provider.id); setKey(""); setAccountId(""); } },
                h("strong", null, provider.name), h("span", null, provider.note));
            })),
          chosen ? h(React.Fragment, null,
            chosen.accountId ? h("label", null, "Cloudflare account ID", h("input", { className: "bees-input", value: accountId,
              autoComplete: "off", placeholder: "Paste the account ID", onChange: (event) => setAccountId(event.target.value) })) : null,
            chosen.keyless ? h("p", { className: "bees-muted" }, `${chosen.name} does not need an API key.`) :
              h("label", null, `${chosen.name} API key`, h("input", { className: "bees-input", type: "password", value: key,
                autoComplete: "off", placeholder: "Paste the key here", onChange: (event) => setKey(event.target.value) })),
            h(Button, { disabled: Boolean(busy), onClick: () => visit(chosen) }, "Create key / sign up"),
            h(Button, { className: "primary", disabled: Boolean(busy) || (!chosen.keyless && !key.trim()) || (chosen.accountId && !accountId.trim()), onClick: add },
              busy === `add:${chosen.id}` ? "Testing…" : chosen.keyless ? "Enable free access" : "Add and test")) :
            h("p", { className: "bees-muted" }, "Choose a provider. Bees will show exactly what to enter.")) : null,
        state?.keys?.length ? h("div", { className: "bees-free-table" }, h("table", null,
          h("thead", null, h("tr", null, h("th", null, "Provider"), h("th", null, "Sign up"), h("th", null, "Credential"),
            h("th", null, "Test"), h("th", null, "Enabled"), h("th", null, "Remove"))),
          h("tbody", null, ...state.keys.map((row) => {
            const runtimeProvider = state.providers.find((provider) => provider.platform === row.platform);
            const provider = providerInfo(row.platform, runtimeProvider);
            const healthy = row.status === "healthy";
            const lastDefaultKey = systemDefault?.provider === "freellmapi" && row.enabled
              && state.keys.filter((entry) => entry.enabled).length <= 1;
            const defaultGuard = "Choose another System default above before disabling the last Free LLM provider.";
            return h("tr", { key: row.id, "data-provider-id": row.platform },
              h("td", null, h("strong", null, provider.name), h("div", { className: "bees-muted" }, provider.note)),
              h("td", null, h(Button, { disabled: Boolean(busy), onClick: () => visit(provider) }, "Provider website")),
              h("td", null, h("strong", null, row.keyless ? "No key needed" : row.maskedKey), row.label ? h("div", { className: "bees-muted" }, row.label) : null),
              h("td", null, h("div", { className: "bees-free-actions" },
                h(Button, { disabled: Boolean(busy), onClick: () => test(row) }, busy === `test:${row.id}` ? "Testing…" : "Test"),
                h("span", { className: `bees-status ${healthy ? "bees-running" : ""}`, title: row.lastHealthError ?? "" }, statusText(row)))),
              h("td", null, h("label", { className: "bees-free-toggle", title: lastDefaultKey ? defaultGuard : "" },
                h("input", { type: "checkbox", role: "switch", checked: Boolean(row.enabled), disabled: Boolean(busy) || lastDefaultKey,
                  "aria-label": `Enable ${provider.name}`, onChange: (event) => toggle(row, event.target.checked) }),
                h("span", null, row.enabled ? "On" : "Off"))),
              h("td", null, h(Button, { className: "danger", title: lastDefaultKey ? defaultGuard : "",
                disabled: Boolean(busy) || lastDefaultKey, onClick: () => remove(row) }, "Remove")));
          })))) : state ? h("section", { className: "bees-box" }, h("p", { className: "bees-muted" }, "No Free LLM provider has been added yet. Select Add provider to get started.")) :
          h("section", { className: "bees-box" }, h("p", { className: "bees-muted" }, modelSettings.productDefaults
            ? "Free LLM credentials and connections are configured on each device."
            : "Starting the embedded FreeLLMAPI router…")),
        notice ? h("div", { className: "bees-free-callout", role: "status" }, notice) : null,
        error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
    }

    exports.FreeAiController = FreeAiController;
    exports.FreeAiSettings = FreeAiSettings;
    exports.inject = [];
    exports.apply = (ctx) => {
      const style = document.createElement("style");
      style.dataset.plugin = "@bees/dsh-free-ai";
      style.textContent = css;
      document.head.append(style);
      ctx.effect(() => () => style.remove(), "bees free AI: styles");
    };
    return module.exports;
  }
});
