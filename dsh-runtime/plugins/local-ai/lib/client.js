window.__ModuleLoader__.load({
  id: "@bees/dsh-local-ai",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useState } = React;

    const css = `
      .bees-local-server-models{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px}.bees-local-server-models .bees-badge{gap:4px;text-transform:none}.bees-local-server-models .bees-badge .bees-btn{padding:0;border:0;background:transparent;font-size:14px;line-height:1}.bees-local-toggle{display:inline-flex;align-items:center;gap:7px;cursor:pointer}.bees-local-toggle input{appearance:none;width:34px;height:20px;margin:0;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-specific-sidebar-fill);position:relative;transition:.15s}.bees-local-toggle input:after{content:"";position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:.15s}.bees-local-toggle input:checked{border-color:#f2b84b;background:#f2b84b}.bees-local-toggle input:checked:after{left:16px;background:#151515}.bees-local-toggle input:disabled{cursor:not-allowed;opacity:.55}
    `;

    function usePreference(scope) {
      const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
      useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
      return snapshot.value ?? {};
    }

    function ExternalLocalAiSettings({ modelSettings, preferences, ask, Button }) {
      const config = usePreference(modelSettings);
      const ui = usePreference(preferences);
      const active = config.providers?.["external-local-ai"];
      const local = active ?? ui.externalLocalAiProfile ?? {};
      const enabled = Boolean(active);
      const [error, setError] = useState("");
      const [typed, setTyped] = useState("");
      // llama.cpp, LM Studio and Ollama want no auth, but pi-ai refuses a provider with neither.
      const authorized = (profile) => ({ ...profile, headers: { authorization: "Bearer local" } });
      // llama.cpp reports its real window at /props; LM Studio and Ollama do not, so they keep the default
      const modelEntry = async (id, baseURL) => {
        const n = await fetch(`${baseURL.replace(/\/v1\/?$/, "")}/props`, { signal: AbortSignal.timeout(2000) })
          .then((res) => res.json()).then((body) => body?.default_generation_settings?.n_ctx).catch(() => 0);
        const contextWindow = Number.isInteger(n) && n > 0 ? n : 32768;
        return { id, name: id, contextWindow, maxTokens: Math.min(8192, contextWindow) };
      };
      const saveProfile = async (profile) => {
        await preferences.set("externalLocalAiProfile", profile);
        if (enabled) await modelSettings.set("providers", { ...config.providers, "external-local-ai": authorized(profile) });
      };
      const run = (action) => async (...args) => {
        setError("");
        try { setError(""); await action(...args); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      };
      const configure = run(async () => {
        const answer = await ask("Local AI server URL", typed || local.baseURL || "http://127.0.0.1:1234/v1");
        if (!answer) return;
        setTyped(answer);
        if (!/^https?:\/\/[^/\s]/i.test(answer)) throw new Error("Use an http:// or https:// address");
        const baseURL = new URL(answer).toString().replace(/\/+$/, "");
        // another server has other models, so a new address asks for its model again
        let models = baseURL === local.baseURL ? local.models ?? [] : [];
        if (!models.length) {
          const listed = await fetch("/bees-api/general-ai/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseURL }) })
            .then((res) => res.json()).then((body) => body?.id).catch(() => "");
          const id = (await ask("Model ID", listed || ""))?.trim(); if (!id) return;
          models = [await modelEntry(id, baseURL)];
        }
        // test a real call before saving, so a wrong URL or model fails here and not at the first message
        const check = await fetch("/bees-api/general-ai/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseURL, model: models[0].id, key: "local" }), signal: AbortSignal.timeout(130_000) });
        if (!check.ok) throw new Error((await check.json().catch(() => ({}))).error || "Connection test failed");
        const profile = { ...local, displayName: "Local AI server", api: local.api ?? "openai-completions", baseURL, models };
        await preferences.set("externalLocalAiProfile", profile);
        await modelSettings.set("providers", { ...config.providers, "external-local-ai": authorized(profile) });
      });
      const addModel = run(async () => {
        const id = (await ask("Model ID", ""))?.trim(); if (!id) return;
        if (local.models?.some((entry) => entry.id === id)) throw new Error(`${id} is already connected`);
        await saveProfile({ ...local, models: [...(local.models ?? []), await modelEntry(id, local.baseURL ?? "")] });
      });
      const removeModel = run(async (id) => {
        if ((local.models?.length ?? 0) <= 1) return;
        await saveProfile({ ...local, models: local.models.filter((entry) => entry.id !== id) });
      });
      const toggle = run(async (enabled) => {
        const providers = { ...(config.providers ?? {}) };
        if (enabled) {
          if (!local.baseURL) return configure();
          providers["external-local-ai"] = authorized(local);
        } else {
          await preferences.set("externalLocalAiProfile", local);
          delete providers["external-local-ai"];
        }
        await modelSettings.set("providers", providers);
      });
      return h("section", { "data-bees-plugin": "@bees/dsh-local-ai-external" },
        h("div", { className: "bees-ai-head", style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "14px", marginBottom: "16px" } }, h("div", null,
          h("h3", { className: "bees-section-title", style: { marginBottom: "4px" } }, "Local AI server"),
          h("p", { className: "bees-muted", style: { margin: 0 } }, "Connect LM Studio, Ollama, llama.cpp, or another OpenAI-compatible server that you run separately."))),
        h("section", { className: "bees-box bees-subscription" }, h("div", null, h("h3", null, local.baseURL ?? "OpenAI-compatible local server"),
          local.baseURL ? h("p", { className: "bees-muted" }, `${local.models?.length ?? 0} model${local.models?.length === 1 ? "" : "s"}`) : null,
          local.baseURL ? h("div", { className: "bees-local-server-models", style: { display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", marginTop: "8px" } },
            ...(local.models ?? []).map((model) => h("span", { className: "bees-badge", key: model.id, style: { display: "inline-flex", alignItems: "center", gap: "4px" } }, model.id,
              h(Button, { title: `Delete ${model.id}`, "aria-label": `Delete ${model.id}`,
                disabled: local.models.length <= 1,
                onClick: () => removeModel(model.id) }, "×"))),
            h(Button, { onClick: addModel }, "Add model")) : null),
          h("div", { className: "bees-subscription-actions" },
            h("span", { className: `bees-status ${enabled ? "bees-running" : ""}` }, enabled ? "Connected" : local.baseURL ? "Off" : "Not connected"),
            local.baseURL ? h("label", { className: "bees-local-toggle" }, h("input", {
              type: "checkbox", role: "switch", checked: enabled,
              "aria-label": "Enable the local AI server", onChange: (event) => toggle(event.target.checked) }), h("span", null, enabled ? "On" : "Off")) : null,
            h(Button, { className: local.baseURL ? "" : "primary", onClick: configure }, local.baseURL ? "Edit endpoint" : "Connect"))),
        error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
    }

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
