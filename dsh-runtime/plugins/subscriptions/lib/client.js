window.__ModuleLoader__.load({
  id: "@bees/dsh-subscriptions",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useState } = React;

    const CODEX_ACCESS_REF = "BEES_CODEX_ACCESS_TOKEN";
    const CLAUDE_INSTALL_URL = "https://claude.com/product/claude-code";
    const css = `
      .bees-subscriptions{display:grid;gap:10px}.bees-subscription{display:flex;align-items:center;justify-content:space-between;gap:16px}.bees-subscription-main{min-width:0}.bees-subscription-models{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px}.bees-subscription-models .bees-badge{gap:4px;text-transform:none}.bees-subscription-models .bees-badge .bees-btn{padding:0;border:0;background:transparent;font-size:14px;line-height:1}.bees-subscription-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}.bees-sub-toggle{display:inline-flex;align-items:center;gap:7px;cursor:pointer}.bees-sub-toggle input{appearance:none;width:34px;height:20px;margin:0;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-specific-sidebar-fill);position:relative}.bees-sub-toggle input:after{content:"";position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:.15s}.bees-sub-toggle input:checked{border-color:#f2b84b;background:#f2b84b}.bees-sub-toggle input:checked:after{left:16px;background:#151515}
    `;

    function usePreference(scope) {
      const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
      useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
      return snapshot.value ?? {};
    }

    async function command(action, values = {}) {
      const response = await fetch("/bees-api/subscriptions", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...values })
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Subscription setup failed");
      return value;
    }

    function SubscriptionSettings({ modelSettings, preferences, systemDefault, ask, openExternal, Button, onChange, productDefaults }) {
      const config = usePreference(modelSettings);
      const ui = usePreference(preferences);
      const [status, setStatus] = useState({ codex: false, codexModels: [],
        claude: { configured: false, enabled: false, models: [] } });
      const [busy, setBusy] = useState("");
      const [error, setError] = useState("");
      const [notice, setNotice] = useState("");
      const refresh = async () => {
        if (productDefaults) return;
        const response = await fetch("/bees-api/subscriptions", { cache: "no-store" });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || "Could not read subscription status");
        setStatus(value);
      };
      useEffect(() => { void refresh().catch((reason) => setError(reason.message)); }, [Boolean(productDefaults)]);
      const perform = async (name, work, success = "") => {
        setBusy(name); setError(""); setNotice("");
        // claude state lives on the server, so the model pickers above never see it change on their own
        try { await work(); await refresh(); onChange?.(); setNotice(success); }
        catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          setError(success ? `Test failed: ${message}` : message);
        }
        finally { setBusy(""); }
      };
      const claude = productDefaults ? { configured: true, enabled: false, models: productDefaults.claudeModels } : status.claude;
      const codexModels = config.providers?.["openai-codex"]?.models
        ?? (ui.codexModels?.length ? ui.codexModels : status.codexModels) ?? [];
      const codexProfile = (models = codexModels) => {
        const profile = { ...config.providers?.["openai-codex"], displayName: "Codex (ChatGPT subscription)", apiKeyEnv: CODEX_ACCESS_REF };
        if (models.length) profile.models = models;
        else delete profile.models;
        return profile;
      };
      const connectCodex = () => perform("codex", async () => {
        const { authUrl } = await command("codex_start");
        await openExternal(authUrl);
        const { models = [] } = await command("codex_await");
        const available = [...new Map([...codexModels, ...models].map((model) => [model.id, model])).values()];
        await modelSettings.set("providers", { ...(config.providers ?? {}), "openai-codex": codexProfile(available) });
      });
      const testCodex = () => perform("codex-test", () => command("codex_test"), "Codex connection works.");
      const disconnectCodex = () => perform("codex", async () => {
        await command("codex_logout");
        const providers = { ...(config.providers ?? {}) }; delete providers["openai-codex"];
        await modelSettings.set("providers", providers);
      });
      const toggleCodex = (enabled) => perform("codex-toggle", async () => {
        const providers = { ...(config.providers ?? {}) };
        if (enabled) providers["openai-codex"] = codexProfile();
        else {
          if (codexModels.length) await preferences.set("codexModels", codexModels.map(({ id, name, contextWindow, maxTokens }) => ({ id, name, contextWindow, maxTokens })));
          delete providers["openai-codex"];
        }
        await modelSettings.set("providers", providers);
      });
      const saveCodexModels = async (models) => {
        if (!productDefaults) {
          const result = await command("codex_models", { models: models.map(({ id }) => id) });
          models = result.models.map((model) => ({ ...models.find(({ id }) => id === model.id), ...model }));
        }
        // UI preferences store display metadata; the provider keeps the discovered capabilities too.
        await preferences.set("codexModels", models.map(({ id, name, contextWindow, maxTokens }) => ({ id, name, contextWindow, maxTokens })));
        if (!codexEnabled) return;
        await modelSettings.set("providers", { ...(config.providers ?? {}), "openai-codex": codexProfile(models) });
      };
      const addCodexModel = () => perform("codex-model", async () => {
        const id = (await ask("Codex model ID", ""))?.trim(); if (!id) return;
        if (codexModels.some((model) => model.id === id)) throw new Error(`${id} is already connected`);
        await saveCodexModels([...codexModels, { id }]);
      });
      const removeCodexModel = (id) => perform("codex-model", () => saveCodexModels(codexModels.filter((model) => model.id !== id)));
      const configureClaude = () => perform("claude", async () => {
        await command("claude_configure");
      });
      const testClaude = () => perform("claude", () => command("claude_test"), "Claude Code connection works.");
      const toggleClaude = (enabled) => perform("claude", () => command("claude_toggle", { enabled }));
      const saveClaudeModels = (models) => perform("claude-model", () => productDefaults
        ? productDefaults.saveClaudeModels(models) : command("claude_models", { models }));
      const addClaudeModel = () => perform("claude-model", async () => {
        const id = (await ask("Claude Code model ID", ""))?.trim(); if (!id) return;
        if (claude.models.includes(id)) throw new Error(`${id} is already connected`);
        if (productDefaults) await productDefaults.saveClaudeModels([...claude.models, id]);
        else await command("claude_models", { models: [...claude.models, id] });
      });
      const disconnectClaude = () => perform("claude", () => command("claude_disconnect"));
      const codexEnabled = Boolean(config.providers?.["openai-codex"]);
      const protects = (provider, model) => systemDefault?.provider === provider && (!model || systemDefault.model === model);
      const defaultGuard = "Choose another System default above before removing or turning off this connection.";

      return h("section", { "data-bees-plugin": "@bees/dsh-subscriptions" },
        h("h2", { className: "bees-section-title" }, "AI subscriptions"),
        h("p", { className: "bees-muted" }, "Use subscriptions you already pay for. Bees keeps each provider's normal sign-in and account controls."),
        h("p", { className: "bees-muted" }, "Uses your existing subscription. Your messages go to that provider's servers."),
        h("div", { className: "bees-subscriptions" },
          h("section", { className: "bees-box bees-subscription", "data-subscription": "codex" },
            h("div", { className: "bees-subscription-main" }, h("h3", null, "Codex"),
              h("p", { className: "bees-muted" }, busy === "codex" ? "Finish signing in in the browser window."
                : status.codex ? "Available models refresh automatically. Models you remove stay hidden."
                  : "Sign in with ChatGPT; no API key is required."),
              status.codexModelError ? h("p", { className: "bees-muted", role: "status" }, status.codexModelError) : null,
              (status.codex || productDefaults) ? h("div", { className: "bees-subscription-models" },
                ...(codexModels.length ? codexModels.map((model) => h("span", { className: "bees-badge", key: model.id }, model.id,
                  h(Button, { title: protects("openai-codex", model.id) ? defaultGuard : `Remove ${model.id}`,
                    "aria-label": `Remove ${model.id}`, disabled: Boolean(busy) || (!productDefaults && codexModels.length <= 1) || protects("openai-codex", model.id),
                    onClick: () => removeCodexModel(model.id) }, "×")))
                  : [h("span", { className: "bees-muted", key: "all" }, "All available models")]),
                h(Button, { disabled: Boolean(busy), onClick: addCodexModel }, "Add model")) : null),
            h("div", { className: "bees-subscription-actions" },
              h("span", { className: `bees-status ${status.codex && codexEnabled ? "bees-running" : ""}` },
                status.codex && codexEnabled ? "Connected" : status.codex ? "Signed in · off" : "Not connected"),
              status.codex ? h("label", { className: "bees-sub-toggle", title: codexEnabled && protects("openai-codex") ? defaultGuard : "" },
                h("input", { type: "checkbox", role: "switch", checked: codexEnabled,
                  disabled: Boolean(busy) || Boolean(productDefaults) || (codexEnabled && protects("openai-codex")),
                  "aria-label": "Enable Codex", onChange: (event) => toggleCodex(event.target.checked) }),
                h("span", null, codexEnabled ? "On" : "Off")) : null,
              h(Button, { className: status.codex ? "" : "primary", disabled: Boolean(busy) || Boolean(productDefaults), onClick: connectCodex },
                busy === "codex" ? "Waiting for sign-in…" : status.codex ? "Reconnect" : "Sign in"),
              status.codex ? h(Button, { disabled: Boolean(busy) || Boolean(productDefaults), onClick: testCodex },
                busy === "codex-test" ? "Testing…" : "Test") : null,
              status.codex ? h(Button, { className: "danger", title: protects("openai-codex") ? defaultGuard : "",
                disabled: Boolean(busy) || Boolean(productDefaults) || protects("openai-codex"), onClick: disconnectCodex }, "Disconnect") : null)),
          h("section", { className: "bees-box bees-subscription", "data-subscription": "claude-code" },
            h("div", { className: "bees-subscription-main" }, h("h3", null, "Claude Code"),
              h("p", { className: "bees-muted" }, productDefaults ? "Models included in new installations." : claude.configured
                ? claude.version || "Claude Code is ready"
                : "Uses the Claude Code already installed on this computer."),
              claude.configured ? h("div", { className: "bees-subscription-models" },
                ...claude.models.map((id) => h("span", { className: "bees-badge", key: id }, id,
                  h(Button, { title: protects("claude-code", id) ? defaultGuard : `Remove ${id}`, "aria-label": `Remove ${id}`,
                    disabled: Boolean(busy) || claude.models.length <= 1 || protects("claude-code", id),
                    onClick: () => saveClaudeModels(claude.models.filter((model) => model !== id)) }, "×"))),
                h(Button, { disabled: Boolean(busy), onClick: addClaudeModel }, "Add model")) : null),
            h("div", { className: "bees-subscription-actions" },
              h("span", { className: `bees-status ${claude.enabled ? "bees-running" : ""}` },
                claude.enabled ? "Connected" : claude.configured ? "Off" : "Not configured"),
              claude.configured ? h("label", { className: "bees-sub-toggle",
                title: claude.enabled && protects("claude-code") ? defaultGuard : "" },
                h("input", { type: "checkbox", role: "switch", checked: Boolean(claude.enabled),
                  disabled: Boolean(busy) || Boolean(productDefaults) || (claude.enabled && protects("claude-code")),
                  "aria-label": "Enable Claude Code", onChange: (event) => toggleClaude(event.target.checked) }),
                h("span", null, claude.enabled ? "On" : "Off")) : null,
              claude.configured
                ? h(Button, { disabled: Boolean(busy) || Boolean(productDefaults), onClick: testClaude }, busy === "claude" ? "Testing…" : "Test")
                : h(Button, { disabled: Boolean(busy), onClick: () => perform("claude-link", () => openExternal(CLAUDE_INSTALL_URL)) }, "Get Claude Code"),
              !claude.configured ? h(Button, { className: "primary", disabled: Boolean(busy) || Boolean(productDefaults), onClick: configureClaude },
                busy === "claude" ? "Looking…" : "Connect") : null,
              claude.configured ? h(Button, { className: "danger", title: protects("claude-code") ? defaultGuard : "",
                disabled: Boolean(busy) || Boolean(productDefaults) || protects("claude-code"), onClick: disconnectClaude }, "Disconnect") : null))),
        notice ? h("div", { className: "bees-callout", role: "status" }, notice) : null,
        error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
    }

    exports.SubscriptionSettings = SubscriptionSettings;
    exports.inject = [];
    exports.apply = (ctx) => {
      const style = document.createElement("style");
      style.dataset.plugin = "@bees/dsh-subscriptions";
      style.textContent = css;
      document.head.append(style);
      ctx.effect(() => () => style.remove(), "bees subscriptions: styles");
    };
    return module.exports;
  }
});
