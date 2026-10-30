window.__ModuleLoader__.load({
  id: "@bees/dsh-subscriptions",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;

    const CODEX_ACCESS_REF = "BEES_CODEX_ACCESS_TOKEN";
    const CLAUDE_INSTALL_URL = "https://claude.com/product/claude-code";
    const css = `
      .bees-subscriptions{display:grid;gap:16px}
      .bees-subscription{display:flex;flex-direction:column;gap:14px;padding:16px 18px;border:1px solid var(--line,#e9ebe5);border-radius:14px;background:var(--surface,#fff);box-sizing:border-box}
      .bees-subscription-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
      .bees-subscription-header-info{flex:1 1 180px;min-width:0}
      .bees-subscription-header-info h3{margin:0 0 4px;font-size:16px;font-weight:650;color:var(--ink,#242820)}
      .bees-subscription-header-info p{margin:0;font-size:13px;line-height:1.45;color:var(--muted,#787d72)}
      .bees-subscription-header-actions{display:flex;align-items:center;gap:10px;flex-shrink:0}
      .bees-subscription-models-section{display:flex;flex-direction:column;gap:8px}
      .bees-subscription-models-header{display:flex;align-items:center;justify-content:space-between;font-size:12px}
      .bees-subscription-models-header strong{font-weight:600;color:var(--ink,#242820)}
      .bees-subscription-models{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .bees-subscription-models .bees-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:8px;background:var(--surface-alt,#f4f5f1);border:1px solid var(--line,#e9ebe5);color:var(--ink,#242820);font-size:12px;font-weight:550;text-transform:none}
      .bees-subscription-models .bees-badge .bees-btn{padding:0 2px;border:0;background:transparent;color:var(--muted,#787d72);font-size:14px;line-height:1;min-height:auto;cursor:pointer}
      .bees-subscription-models .bees-badge .bees-btn:hover{color:var(--ink,#242820)}
      .bees-subscription-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding-top:14px;border-top:1px solid var(--line,#e9ebe5);margin-top:2px}
      .bees-subscription-footer-left{display:flex;align-items:center;gap:8px;flex-wrap:nowrap}
      .bees-cli-path{flex-basis:100%;min-width:0;margin-top:2px}
      .bees-cli-path label{display:block;font-size:12px;font-weight:600;color:var(--ink,#242820);margin-bottom:6px}
      .bees-cli-path-controls{display:flex;gap:8px;align-items:center}
      .bees-cli-path-controls input{flex:1 1 140px;min-width:100px}
      .bees-cli-path-controls button{flex-shrink:0;white-space:nowrap}
      .bees-cli-path p{margin:6px 0 0;font-size:12px;color:var(--muted,#787d72)}

      /* Modern Toggle Switch */
      .bees-sub-toggle{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
      .bees-sub-toggle .bees-sub-toggle-label{font-size:12px;font-weight:600;color:var(--ink,#242820)}
      .bees-sub-toggle input{appearance:none;-webkit-appearance:none;width:38px;height:22px;margin:0;border:1px solid var(--line,#d4d7ce);border-radius:999px;background:color-mix(in srgb,var(--ink,#242820) 14%,var(--surface,#fff));position:relative;cursor:pointer;transition:background-color .2s cubic-bezier(.4,0,.2,1),border-color .2s cubic-bezier(.4,0,.2,1);flex-shrink:0}
      .bees-sub-toggle input:hover:not(:disabled){border-color:color-mix(in srgb,var(--ink,#242820) 30%,var(--line,#d4d7ce))}
      .bees-sub-toggle input:focus-visible{outline:2px solid var(--accent,#717d4b);outline-offset:2px}
      .bees-sub-toggle input:after{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2),0 1px 1px rgba(0,0,0,.1);transition:transform .2s cubic-bezier(.4,0,.2,1)}
      .bees-sub-toggle input:checked{background:var(--accent,#717d4b);border-color:var(--accent,#717d4b)}
      .bees-sub-toggle input:checked:after{transform:translateX(16px);background:#fff}
      .bees-sub-toggle input:disabled{opacity:.45;cursor:not-allowed}

      /* Status badge */
      .bees-status{font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.04em;padding:3px 8px;border-radius:6px;background:var(--surface-alt,#f4f5f1);color:var(--muted,#787d72);border:1px solid var(--line,#e9ebe5);display:inline-flex;align-items:center}
      .bees-status.bees-running{background:var(--soft,#f0f7e6);color:var(--accent,#717d4b);border-color:color-mix(in srgb,var(--accent,#717d4b) 30%,transparent)}
    `;

    function usePreference(scope) {
      const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
      useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
      return snapshot.value ?? {};
    }

    async function command(action, values = {}, signal) {
      const response = await fetch("/bees-api/subscriptions", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...values }), signal
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Subscription setup failed");
      return value;
    }

    function SubscriptionSettings({ modelSettings, preferences, ask, openExternal, pickFile, Button, onChange }) {
      const config = usePreference(modelSettings);
      const ui = usePreference(preferences);
      const [status, setStatus] = useState({ codex: false, codexModels: [],
        claude: { configured: false, enabled: false, models: [] } });
      const [busy, setBusy] = useState("");
      const [error, setError] = useState("");
      const [notice, setNotice] = useState("");
      const [pathDraft, setPathDraft] = useState(null);
      const login = useRef(null);
      useEffect(() => () => login.current?.abort(new Error("Codex sign-in cancelled")), []);
      const refresh = async () => {
        const response = await fetch("/bees-api/subscriptions", { cache: "no-store" });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || "Could not read subscription status");
        setStatus(value);
      };
      useEffect(() => { void refresh().catch((reason) => setError(reason.message)); }, []);
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
      const claude = status.claude;
      const claudePath = pathDraft ?? claude.path ?? "";
      const codexModels = config.providers?.["openai-codex"]?.models
        ?? (ui.codexModels?.length ? ui.codexModels : status.codexModels) ?? [];
      const codexProfile = (models = codexModels) => {
        const profile = { ...config.providers?.["openai-codex"], displayName: "Codex (ChatGPT subscription)", apiKeyEnv: CODEX_ACCESS_REF };
        if (models.length) profile.models = models;
        else delete profile.models;
        return profile;
      };
      const connectCodex = () => perform("codex-login", async () => {
        const controller = new AbortController();
        login.current = controller;
        let id;
        try {
          const started = await command("codex_start");
          id = started.id;
          controller.signal.throwIfAborted();
          await openExternal(started.authUrl);
          const { models = [] } = await command("codex_await", { id }, controller.signal);
          controller.signal.throwIfAborted();
          const available = [...new Map([...codexModels, ...models].map((model) => [model.id, model])).values()];
          await modelSettings.set("providers", { ...(config.providers ?? {}), "openai-codex": codexProfile(available) });
        } finally {
          if (id) await command("codex_cancel", { id }, AbortSignal.timeout(5000)).catch(() => {});
          if (login.current === controller) login.current = null;
        }
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
        const result = await command("codex_models", { models: models.map(({ id }) => id) });
        models = result.models.map((model) => ({ ...models.find(({ id }) => id === model.id), ...model }));
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
      const configureClaude = () => perform("claude-path", async () => {
        const result = await command("claude_configure", { path: claudePath,
          enabled: claude.configured ? claude.enabled : true });
        setPathDraft(result.path);
      });
      const browseClaude = () => perform("claude-browse", async () => {
        const path = await pickFile({ title: "Find Claude Code CLI", directory: false, multiple: false,
          defaultPath: claudePath.trim() || undefined });
        if (typeof path === "string") setPathDraft(path);
      });
      const testClaude = () => perform("claude", () => command("claude_test"), "Claude Code connection works.");
      const toggleClaude = (enabled) => perform("claude", () => command("claude_toggle", { enabled }));
      const saveClaudeModels = (models) => perform("claude-model", () => command("claude_models", { models }));
      const addClaudeModel = () => perform("claude-model", async () => {
        const id = (await ask("Claude Code model ID", ""))?.trim(); if (!id) return;
        if (claude.models.includes(id)) throw new Error(`${id} is already connected`);
        await command("claude_models", { models: [...claude.models, id] });
      });
      const disconnectClaude = () => perform("claude", async () => {
        await command("claude_disconnect");
        setPathDraft(null);
      });
      const codexEnabled = Boolean(config.providers?.["openai-codex"]);

      return h("section", { "data-bees-plugin": "@bees/dsh-subscriptions" },
        h("div", { className: "bees-ai-head", style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "14px", marginBottom: "16px" } },
          h("div", null,
            h("h3", { className: "bees-section-title" }, "AI subscriptions"),
            h("p", { className: "bees-muted", style: { margin: 0 } }, "Use subscriptions you already pay for. Bees keeps each provider's normal sign-in and account controls.")
          )
        ),
        h("div", { className: "bees-subscriptions" },
          h("section", { className: "bees-box bees-subscription", "data-subscription": "codex" },
            h("div", { className: "bees-subscription-header" },
              h("div", { className: "bees-subscription-header-info bees-subscription-main" },
                h("h3", null, "Codex"),
                h("p", { className: "bees-muted" }, busy === "codex-login" ? "Finish signing in in the browser window."
                  : status.codex ? "Available models refresh automatically. Models you remove stay hidden."
                    : "Sign in with ChatGPT; no CLI installation or API key is required."),
                status.codexModelError ? h("p", { className: "bees-muted", role: "status" }, status.codexModelError) : null
              ),
              h("div", { className: "bees-subscription-header-actions" },
                h("span", { className: `bees-status ${status.codex && codexEnabled ? "bees-running" : ""}` },
                  status.codex && codexEnabled ? "Connected" : status.codex ? "Off" : "Not connected"),
                status.codex ? h("label", { className: "bees-sub-toggle", title: codexEnabled ? "Codex is enabled" : "Codex is disabled" },
                  h("input", { type: "checkbox", role: "switch", checked: codexEnabled,
                    disabled: Boolean(busy),
                    "aria-label": "Enable Codex", onChange: (event) => toggleCodex(event.target.checked) }),
                  h("span", { className: "bees-sub-toggle-label" }, codexEnabled ? "On" : "Off")) : null,
                !status.codex ? h(Button, { className: "primary", disabled: Boolean(busy), onClick: connectCodex },
                  busy === "codex-login" ? "Waiting for sign-in…" : "Sign in") : null,
                busy === "codex-login" ? h(Button, { onClick: () => login.current?.abort(new Error("Codex sign-in cancelled")) }, "Cancel sign in") : null
              )
            ),
            status.codex ? h("div", { className: "bees-subscription-models-section" },
              h("div", { className: "bees-subscription-models-header" },
                h("strong", null, "Available models"),
                h("span", { className: "bees-muted" }, `${codexModels.length} models`)
              ),
              h("div", { className: "bees-subscription-models" },
                ...(codexModels.length ? codexModels.map((model) => h("span", { className: "bees-badge", key: model.id }, model.id,
                  h(Button, { title: `Remove ${model.id}`,
                    "aria-label": `Remove ${model.id}`, disabled: Boolean(busy) || codexModels.length <= 1,
                    onClick: () => removeCodexModel(model.id) }, "×")))
                  : [h("span", { className: "bees-muted", key: "all" }, "All available models")]),
                h(Button, { disabled: Boolean(busy), onClick: addCodexModel }, "+ Add model")
              )
            ) : null,
            status.codex ? h("div", { className: "bees-subscription-footer bees-subscription-actions" },
              h("div", { className: "bees-subscription-footer-left" },
                h(Button, { disabled: Boolean(busy), onClick: connectCodex },
                  busy === "codex-login" ? "Waiting for sign-in…" : "Reconnect"),
                h(Button, { disabled: Boolean(busy), onClick: testCodex },
                  busy === "codex-test" ? "Testing…" : "Test connection")
              ),
              h(Button, { className: "danger", disabled: Boolean(busy), onClick: disconnectCodex }, "Disconnect")
            ) : null
          ),
          h("section", { className: "bees-box bees-subscription", "data-subscription": "claude-code" },
            h("div", { className: "bees-subscription-header" },
              h("div", { className: "bees-subscription-header-info bees-subscription-main" },
                h("h3", null, "Claude Code"),
                h("p", { className: "bees-muted" }, !claude.configured ? "Uses the Claude Code already installed on this computer."
                  : claude.signedIn === false ? "Not signed in. Open Terminal, run claude and sign in."
                    : claude.version || "Claude Code is ready")
              ),
              h("div", { className: "bees-subscription-header-actions" },
                h("span", { className: `bees-status ${claude.enabled && claude.signedIn !== false ? "bees-running" : ""}` },
                  !claude.configured ? "Not configured" : !claude.enabled ? "Off" : claude.signedIn === false ? "Signed out" : "Connected"),
                claude.configured ? h("label", { className: "bees-sub-toggle", title: claude.enabled ? "Claude Code is enabled" : "Claude Code is disabled" },
                  h("input", { type: "checkbox", role: "switch", checked: Boolean(claude.enabled),
                    disabled: Boolean(busy),
                    "aria-label": "Enable Claude Code", onChange: (event) => toggleClaude(event.target.checked) }),
                  h("span", { className: "bees-sub-toggle-label" }, claude.enabled ? "On" : "Off")) : null,
                !claude.configured
                  ? h(Button, { disabled: Boolean(busy), onClick: () => perform("claude-link", () => openExternal(CLAUDE_INSTALL_URL)) }, "Get Claude Code")
                  : null
              )
            ),
            claude.configured && claude.models?.length ? h("div", { className: "bees-subscription-models-section" },
              h("div", { className: "bees-subscription-models-header" },
                h("strong", null, "Available models"),
                h("span", { className: "bees-muted" }, `${claude.models.length} models`)
              ),
              h("div", { className: "bees-subscription-models" },
                ...claude.models.map((id) => h("span", { className: "bees-badge", key: id }, id,
                  h(Button, { title: `Remove ${id}`, "aria-label": `Remove ${id}`,
                    disabled: Boolean(busy) || claude.models.length <= 1,
                    onClick: () => saveClaudeModels(claude.models.filter((model) => model !== id)) }, "×"))),
                h(Button, { disabled: Boolean(busy), onClick: addClaudeModel }, "+ Add model")
              )
            ) : null,
            h("form", { className: "bees-cli-path", onSubmit: (event) => { event.preventDefault(); if (!busy) void configureClaude(); } },
              h("label", { htmlFor: "bees-claude-path" }, "Claude Code CLI path"),
              h("div", { className: "bees-cli-path-controls" },
                h("input", { id: "bees-claude-path", className: "bees-input", type: "text", value: claudePath,
                  placeholder: "Auto-detect or enter the full path to claude", spellCheck: false, autoComplete: "off",
                  "aria-describedby": "bees-claude-path-help", disabled: Boolean(busy),
                  onChange: (event) => setPathDraft(event.target.value) }),
                pickFile ? h(Button, { disabled: Boolean(busy), onClick: browseClaude, "aria-label": "Browse for Claude Code CLI" },
                  busy === "claude-browse" ? "Browsing…" : "Browse…") : null,
                h(Button, { type: "submit", className: "primary", disabled: Boolean(busy) },
                  busy === "claude-path" ? "Checking…" : claude.configured ? "Save path" : "Connect")),
              h("p", { id: "bees-claude-path-help", className: "bees-muted" },
                "Choose the claude executable file. Leave the path blank to find it automatically.")
            ),
            claude.configured ? h("div", { className: "bees-subscription-footer bees-subscription-actions" },
              h("div", { className: "bees-subscription-footer-left" },
                h(Button, { disabled: Boolean(busy), onClick: testClaude }, busy === "claude" ? "Testing…" : "Test connection")
              ),
              h(Button, { className: "danger", disabled: Boolean(busy), onClick: disconnectClaude }, "Disconnect")
            ) : null
          )
        ),
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
