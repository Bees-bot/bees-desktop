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
      .bees-subscriptions{display:grid;gap:10px}.bees-subscription{display:flex;align-items:center;justify-content:space-between;gap:16px}.bees-subscription-main{min-width:0}.bees-subscription-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}.bees-sub-toggle{display:inline-flex;align-items:center;gap:7px;cursor:pointer}.bees-sub-toggle input{appearance:none;width:34px;height:20px;margin:0;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-specific-sidebar-fill);position:relative}.bees-sub-toggle input:after{content:"";position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:.15s}.bees-sub-toggle input:checked{border-color:#f2b84b;background:#f2b84b}.bees-sub-toggle input:checked:after{left:16px;background:#151515}
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

    function SubscriptionSettings({ modelSettings, openExternal, Button }) {
      const config = usePreference(modelSettings);
      const [status, setStatus] = useState({ codex: false, claude: { configured: false, enabled: false } });
      const [busy, setBusy] = useState("");
      const [error, setError] = useState("");
      const refresh = async () => {
        const response = await fetch("/bees-api/subscriptions", { cache: "no-store" });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || "Could not read subscription status");
        setStatus(value);
      };
      useEffect(() => { void refresh().catch((reason) => setError(reason.message)); }, []);
      const perform = async (name, work) => {
        setBusy(name); setError("");
        try { await work(); await refresh(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setBusy(""); }
      };
      const codexProfile = () => ({ displayName: "Codex (ChatGPT subscription)", apiKeyEnv: CODEX_ACCESS_REF });
      const connectCodex = () => perform("codex", async () => {
        const { authUrl } = await command("codex_start");
        await openExternal(authUrl);
        await command("codex_await");
        await modelSettings.set("providers", { ...(config.providers ?? {}), "openai-codex": codexProfile() });
      });
      const disconnectCodex = () => perform("codex", async () => {
        await command("codex_logout");
        const providers = { ...(config.providers ?? {}) }; delete providers["openai-codex"];
        await modelSettings.set("providers", providers);
      });
      const configureClaude = () => perform("claude", async () => {
        await command("claude_configure");
      });
      const testClaude = () => perform("claude", () => command("claude_test"));
      const toggleClaude = (enabled) => perform("claude", () => command("claude_toggle", { enabled }));
      const disconnectClaude = () => perform("claude", () => command("claude_disconnect"));
      const codexEnabled = Boolean(config.providers?.["openai-codex"]);

      return h("section", { "data-bees-plugin": "@bees/dsh-subscriptions" },
        h("h2", { className: "bees-section-title" }, "AI subscriptions"),
        h("p", { className: "bees-muted" }, "Use subscriptions you already pay for. Bees keeps each provider's normal sign-in and account controls."),
        h("div", { className: "bees-subscriptions" },
          h("section", { className: "bees-box bees-subscription", "data-subscription": "codex" },
            h("div", { className: "bees-subscription-main" }, h("h3", null, "Codex"),
              h("p", { className: "bees-muted" }, busy === "codex" ? "Finish signing in in the browser window." : "Sign in with ChatGPT; no API key is required.")),
            h("div", { className: "bees-subscription-actions" },
              h("span", { className: `bees-status ${status.codex && codexEnabled ? "bees-running" : ""}` },
                status.codex && codexEnabled ? "Connected" : status.codex ? "Signed in · off" : "Not connected"),
              h(Button, { className: status.codex ? "" : "primary", disabled: Boolean(busy), onClick: connectCodex },
                busy === "codex" ? "Waiting for sign-in…" : status.codex ? "Reconnect" : "Sign in"),
              status.codex ? h(Button, { className: "danger", disabled: Boolean(busy), onClick: disconnectCodex }, "Disconnect") : null)),
          h("section", { className: "bees-box bees-subscription", "data-subscription": "claude-code" },
            h("div", { className: "bees-subscription-main" }, h("h3", null, "Claude Code"),
              h("p", { className: "bees-muted" }, status.claude.configured
                ? status.claude.version || "Claude Code is ready"
                : "Uses the Claude Code already installed on this computer.")),
            h("div", { className: "bees-subscription-actions" },
              h("span", { className: `bees-status ${status.claude.enabled ? "bees-running" : ""}` },
                status.claude.enabled ? "Connected" : status.claude.configured ? "Off" : "Not configured"),
              status.claude.configured ? h("label", { className: "bees-sub-toggle" },
                h("input", { type: "checkbox", role: "switch", checked: Boolean(status.claude.enabled), disabled: Boolean(busy),
                  "aria-label": "Enable Claude Code", onChange: (event) => toggleClaude(event.target.checked) }),
                h("span", null, status.claude.enabled ? "On" : "Off")) : null,
              status.claude.configured
                ? h(Button, { disabled: Boolean(busy), onClick: testClaude }, busy === "claude" ? "Testing…" : "Test")
                : h(Button, { disabled: Boolean(busy), onClick: () => perform("claude-link", () => openExternal(CLAUDE_INSTALL_URL)) }, "Get Claude Code"),
              !status.claude.configured ? h(Button, { className: "primary", disabled: Boolean(busy), onClick: configureClaude },
                busy === "claude" ? "Looking…" : "Connect") : null,
              status.claude.configured ? h(Button, { className: "danger", disabled: Boolean(busy), onClick: disconnectClaude }, "Disconnect") : null))),
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
