import {
  CustomAiSettings, ExternalLocalAiSettings, FreeAiSettings, h, LocalAiSettings,
  React, SubscriptionSettings, useEffect, useState
} from "./runtime.js";
import {
  ask, Button, collaboration, confirmAction, defaultOrgColor, Empty, GLOBAL_SETTINGS, openExternal,
  ORGANIZATION_SETTINGS, request, TEAM_SETTINGS, THEME_PRESETS, usePreference, useSubmit
} from "./shared.js";
import { MemorySettings } from "./collaboration.js";
import { SystemDefaultSettings } from "./agents.js";
import { FilesIcon } from "./icons.js";
import { open } from "@tauri-apps/plugin-dialog";

const AI_PAGE_CSS = `
  /* Consistent outer layout for every sub-section */
  .bees-ai-page > section[data-bees-plugin],
  .bees-ai-page > fieldset > section[data-bees-plugin] {
    margin-top: 24px;
    border: 1px solid var(--dsw-alias-border-l1);
    border-radius: 12px;
    background: var(--dsw-alias-bg-base);
    padding: 20px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.02);
  }

  /* System default special style */
  .bees-ai-page .bees-system-default {
    border: 2px solid var(--bees-accent, #f2b84b) !important;
    background: var(--dsw-alias-bg-base) !important;
    border-radius: 12px !important;
    padding: 20px 24px !important;
    margin-bottom: 24px !important;
    box-shadow: 0 4px 12px rgba(242, 184, 75, 0.1) !important;
  }

  /* Reset inner boxes so we don't have nested borders */
  .bees-ai-page .bees-box:not(.bees-system-default) {
    border: none !important;
    background: transparent !important;
    box-shadow: none !important;
    padding: 0 !important;
    margin: 0 !important;
  }

  /* Subscriptions layout */
  .bees-ai-page .bees-subscriptions > section.bees-box {
    border-bottom: 1px solid var(--dsw-alias-border-l1) !important;
    margin-bottom: 16px !important;
    padding-bottom: 16px !important;
  }
  .bees-ai-page .bees-subscriptions > section.bees-box:last-child {
    border-bottom: none !important;
    margin-bottom: 0 !important;
    padding-bottom: 0 !important;
  }

  /* Make the Add provider grids 5 cards per row */
  .bees-ai-page .bees-provider-grid,
  .bees-ai-page .bees-general-grid {
    grid-template-columns: repeat(5, 1fr) !important;
    gap: 12px !important;
    margin-top: 16px;
    margin-bottom: 16px;
  }

  /* Modern info showing cards */
  .bees-ai-page .bees-provider-card,
  .bees-ai-page .bees-general-card {
    min-height: 75px !important;
    padding: 12px 14px !important;
    border: 1px solid var(--dsw-alias-border-l2) !important;
    border-radius: 10px !important;
    transition: all 0.2s ease;
    background: var(--dsw-specific-sidebar-fill) !important;
  }
  .bees-ai-page .bees-provider-card:hover,
  .bees-ai-page .bees-general-card:hover {
    border-color: var(--bees-accent, #f2b84b) !important;
    background: color-mix(in srgb, var(--bees-accent, #f2b84b) 8%, var(--dsw-specific-sidebar-fill)) !important;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.03);
  }
  .bees-ai-page .bees-provider-card.active,
  .bees-ai-page .bees-general-card.active {
    border-color: var(--bees-accent, #f2b84b) !important;
    background: color-mix(in srgb, var(--bees-accent, #f2b84b) 12%, var(--dsw-specific-sidebar-fill)) !important;
    box-shadow: inset 0 0 0 1px var(--bees-accent, #f2b84b);
  }

  /* Callout box (Suggested models, info cards) */
  .bees-ai-page .bees-callout {
    border: 1px solid color-mix(in srgb, var(--bees-accent, #f2b84b) 40%, transparent) !important;
    border-left: 4px solid var(--bees-accent, #f2b84b) !important;
    border-radius: 8px !important;
    background: color-mix(in srgb, var(--bees-accent, #f2b84b) 5%, var(--dsw-alias-bg-base)) !important;
    padding: 16px 20px !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.02) !important;
  }

  /* Badges (Model names in subscriptions/custom ai) */
  .bees-ai-page .bees-badge {
    display: inline-flex !important;
    align-items: center !important;
    gap: 6px !important;
    padding: 4px 10px !important;
    border-radius: 99px !important;
    background: color-mix(in srgb, var(--bees-accent, #f2b84b) 12%, var(--dsw-alias-bg-base)) !important;
    border: 1px solid color-mix(in srgb, var(--bees-accent, #f2b84b) 30%, transparent) !important;
    font-size: 12px !important;
    font-weight: 500 !important;
    line-height: 1 !important;
    white-space: nowrap !important;
    color: var(--dsw-alias-label-primary) !important;
  }

  .bees-ai-page .bees-badge button {
    background: transparent !important;
    border: none !important;
    padding: 0 !important;
    margin: 0 -2px 0 2px !important;
    min-width: 16px !important;
    min-height: 16px !important;
    width: 16px !important;
    height: 16px !important;
    border-radius: 50% !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    color: var(--dsw-alias-label-secondary) !important;
    font-size: 16px !important;
    line-height: 1 !important;
    cursor: pointer !important;
  }
  .bees-ai-page .bees-badge button:hover {
    background: rgba(0,0,0,0.1) !important;
    color: var(--dsw-alias-label-primary) !important;
  }

  /* Section headers */
  .bees-ai-page .bees-section-title {
    font-size: 14px !important;
    font-weight: 700 !important;
    text-transform: none !important;
    letter-spacing: normal !important;
    color: var(--dsw-alias-label-primary) !important;
    margin: 0 0 6px 0 !important;
  }

  /* Main title */
  .bees-ai-page > .bees-main-heading {
    font-size: 18px !important;
    font-weight: 700 !important;
    color: var(--dsw-alias-label-primary) !important;
    margin: 16px 0 8px 0 !important;
  }

  /* Tables */
  .bees-ai-page table {
    min-width: 0 !important;
    width: 100% !important;
    margin-top: 16px;
  }
  .bees-ai-page .bees-free-table,
  .bees-ai-page .bees-general-table,
  .bees-ai-page .bees-local-model-table {
    border: 1px solid var(--dsw-alias-border-l1) !important;
    background: var(--dsw-specific-sidebar-fill) !important;
    border-radius: 8px !important;
    overflow: hidden !important;
  }

  /* Empty state styling */
  .bees-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    text-align: center;
    color: var(--dsw-alias-label-secondary);
    background: var(--dsw-specific-sidebar-fill);
    border: 1px dashed var(--dsw-alias-border-l2);
    border-radius: 8px;
    margin-top: 16px;
  }
  .bees-empty-state svg {
    width: 32px;
    height: 32px;
    margin-bottom: 12px;
    opacity: 0.5;
  }

  /* Bottom padding for the page */
  .bees-ai-page {
    padding-bottom: 64px;
  }
`;

function ensureAiPageCss() {
  if (document.getElementById("bees-ai-page-styles")) return;
  const el = document.createElement("style");
  el.id = "bees-ai-page-styles";
  el.textContent = AI_PAGE_CSS;
  document.head.appendChild(el);
}

function AiSettings({ ctx, modelSettings, preferences, systemDefault, reload, productSettings, catalog }) {
  const preference = usePreference(preferences);
  const generation = productSettings.generation;
  const isOnboarding = preference.onboarding?.active;
  const [modelsChanged, setModelsChanged] = useState(0);

  useEffect(() => { ensureAiPageCss(); }, []);

  return h("div", { className: "bees-stack bees-ai-page" },
    isOnboarding ? h("section", { className: "bees-callout" },
      h("h2", null, "Choose how Bees thinks"),
      h("p", null, "Connect or start a model below, save it as your system default, then return to setup to test it. You can continue setup during a download.")
    ) : null,

    h(SystemDefaultSettings, { ctx, modelSettings, systemDefault, reload, modelsChanged,
      saveDefault: preferences.productDefaults ? (selection) => productSettings.save("agent-default-model", "selection", selection, generation) : undefined,
      catalogModels: preferences.productDefaults ? preference.localModelCatalog : undefined,
      defaultModelLists: preferences.productDefaults ? { codex: preference.codexModels,
        claude: productSettings.state.values["bees-subscriptions"].models } : undefined }),

    h("h2", { className: "bees-main-heading" }, "Connection AI sources"),

    h(SubscriptionSettings, { modelSettings, preferences, systemDefault, ask, openExternal, pickFile: open, Button,
      productDefaults: preferences.productDefaults ? {
        claudeModels: productSettings.state.values["bees-subscriptions"].models,
        saveClaudeModels: (models) => productSettings.save("bees-subscriptions", "models", models, generation)
      } : null,
      onChange: () => setModelsChanged((count) => count + 1) }),
    h("fieldset", { disabled: preferences.productDefaults, style: { border: 0, padding: 0, minWidth: 0, marginTop: "16px", borderTop: "1px solid var(--dsw-alias-border-l1)", paddingTop: "16px" } },
      h(FreeAiSettings, { ctx, modelSettings, preferences, systemDefault, ask, confirmAction, openExternal, Button })),
    h(CustomAiSettings, { ctx, modelSettings, preferences, systemDefault, ask, confirmAction, openExternal, Button }),
    h(LocalAiSettings, { modelSettings, preferences, systemDefault, ask, confirmAction, Button, catalog }),
    h("fieldset", { disabled: preferences.productDefaults, style: { border: 0, padding: 0, minWidth: 0, marginTop: "16px", borderTop: "1px solid var(--dsw-alias-border-l1)", paddingTop: "16px" } },
      h(ExternalLocalAiSettings, { modelSettings, preferences, systemDefault, ask, Button }))
  );
}

function AppearanceSettings({ ctx, preferences }) {
  const preference = usePreference(preferences);
  const theme = ctx.get?.("theme") ?? ctx.theme;
  const preset = THEME_PRESETS.some(({ id }) => id === preference.themePreset)
    ? preference.themePreset : "halloween";
  const darkDefault = THEME_PRESETS.some(({ id, dark }) => id === preference.darkThemePreset && dark)
    ? preference.darkThemePreset : "halloween";
  const lightDefault = THEME_PRESETS.some(({ id, dark }) => id === preference.lightThemePreset && !dark)
    ? preference.lightThemePreset : "corporate";
  useEffect(() => {
    if (preference.darkThemePreset && !THEME_PRESETS.find(({ id }) => id === preference.darkThemePreset)?.dark) {
      void preferences.set("darkThemePreset", "halloween");
    }
    if (preference.lightThemePreset && THEME_PRESETS.find(({ id }) => id === preference.lightThemePreset)?.dark) {
      void preferences.set("lightThemePreset", "corporate");
    }
  }, [preference.darkThemePreset, preference.lightThemePreset, preferences]);
  const chooseTheme = async (option) => {
    const nextMode = option.dark ? "dark" : "light";
    await preferences.set("themePreset", option.id);
    await preferences.set("colorMode", nextMode);
    if (!preferences.productDefaults) theme.setTheme(nextMode);
  };
  return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box bees-appearance-card" }, 
      h("h3", { className: "bees-section-title" }, "Theme defaults"),
      h("p", { className: "bees-muted" }, "Choose which palettes the header button uses when switching between dark and light."),
      h("div", { className: "bees-form-row", style: { marginTop: "14px" } },
        h("label", null, "Default Dark Theme", h("select", { className: "bees-select", value: darkDefault,
          "data-theme-default": "dark", onChange: (event) => void preferences.set("darkThemePreset", event.target.value) },
        ...THEME_PRESETS.map((option) => h("option", { key: option.id, value: option.id }, option.id === "halloween" ? `${option.label} (Recommended)` : option.label)))),
        h("label", null, "Default Light Theme", h("select", { className: "bees-select", value: lightDefault,
          "data-theme-default": "light", onChange: (event) => void preferences.set("lightThemePreset", event.target.value) },
        ...THEME_PRESETS.map((option) => h("option", { key: option.id, value: option.id }, option.label)))))),
    h("section", { className: "bees-box bees-appearance-card" }, 
      h("h3", { className: "bees-section-title" }, "Theme"),
      h("p", { className: "bees-muted" }, preferences.productDefaults
        ? "The selected palette becomes the default for new installations."
        : "All 35 themes from old Bees. The selected palette applies across organizations and teams on this device."),
      h("div", { className: "bees-theme-grid" }, ...THEME_PRESETS.map((option) =>
        h("button", { type: "button", key: option.id,
          className: `bees-theme-card ${preset === option.id ? "active" : ""}`,
          "aria-pressed": preset === option.id, onClick: () => void chooseTheme(option) },
        h("span", { className: "bees-theme-swatches", "aria-hidden": "true" },
          ...option.colors.map((color, index) => h("span", { key: index, style: { background: color } }))),
        h("strong", null, option.label))))));
}

function SystemInstructionsSettings({ preferences, instructions }) {
  const [value, setValue] = useState(instructions);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => setValue(instructions), [instructions]);
  const save = async (event) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await preferences.set("systemInstructions", value);
      setMessage("Saved. These instructions apply to new agent runs.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return h("form", { className: "bees-stack", onSubmit: save },
    h("section", { className: "bees-box" }, h("h3", null, "System-wide instructions"),
      h("p", { className: "bees-muted" },
        "Added to every planning, work, and review agent's system prompt. Built-in Bees safety and interaction protocols remain protected."),
      h("textarea", { className: "bees-textarea", rows: 12, value,
        placeholder: "Instructions every agent should follow", onChange: (event) => setValue(event.target.value) }),
      h("div", null, h("strong", null, "Example scenarios"),
        h("p", { className: "bees-muted" }, "Use this for rules that should apply to every process and agent, such as:"),
        h("ul", { className: "bees-muted" },
          h("li", null, "After each delegated task finishes, ask me to approve its result before starting the next task."),
          h("li", null, "Before publishing or sending work externally, summarize what will happen and wait for approval."),
          h("li", null, "If required information is missing, ask me instead of guessing."),
          h("li", null, "Cite the source and date for every factual or numerical claim."))),
      h("div", { className: "bees-detail-actions" },
        h(Button, { type: "submit", className: "primary", disabled: busy }, busy ? "Saving…" : "Save instructions")),
      message ? h("p", { className: "bees-muted", role: "status" }, message) : null));
}

export function AccountSignInButtons({ disabled = false, onStart }) {
  return h("div", { className: "bees-account-auth", style: { display: "flex", flexDirection: "column", gap: "12px" } },
    h(Button, { disabled, style: { justifyContent: "center", padding: "10px", background: "var(--dsw-alias-bg-base)", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px" },
      onClick: () => onStart("social_start", { provider: "google" }) }, "Continue with Google"),
    h(Button, { disabled, style: { justifyContent: "center", padding: "10px", background: "var(--dsw-alias-bg-base)", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px" },
      onClick: () => onStart("social_start", { provider: "github" }) }, "Continue with GitHub"),
    h(Button, { disabled, style: { justifyContent: "center", padding: "10px", background: "var(--dsw-alias-bg-base)", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px" }, onClick: async () => {
      const email = await ask("Work email for company SSO", "");
      if (email) await onStart("sso_start", { email });
    } }, "Continue with Company SSO"));
}

export function AccountsPage({ reload }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try { setData(await collaboration()); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const mounted = React.useRef(true);
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, []);
  const browserAuth = async (action, values) => {
    setBusy(true);
    try {
      const before = new Map((data?.accounts ?? []).map(({ userId, updatedAt }) => [userId, updatedAt]));
      const { url } = await collaboration(action, values);
      await openExternal(url);
      for (let attempt = 0; attempt < 120 && mounted.current; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        if (!mounted.current) return;
        const next = await collaboration();
        if (mounted.current && (next.accounts ?? []).some(({ userId, updatedAt }) =>
          before.get(userId) !== updatedAt)) {
          setData(next); setError(""); await reload(); return;
        }
      }
      throw new Error("Sign in was not completed");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  if (!data) return h(Empty, null, error || "Loading account…");
  const run = async (action, values = {}) => {
    setBusy(true);
    try { setData(await collaboration(action, values)); setError(""); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return h("div", { className: "bees-stack", style: { maxWidth: "800px", margin: "0 auto", padding: "32px 24px" } },
    h("section", { style: { marginBottom: "32px" } },
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" } },
        h("h3", { style: { margin: 0 } }, "Signed in accounts"),
        h("span", { className: "bees-badge", style: { padding: "4px 8px" } }, `${(data.accounts ?? []).length} account${data.accounts?.length === 1 ? "" : "s"}`)
      ),
      h("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } },
        ...((data.accounts ?? []).length ? data.accounts.map((account) => h("div", {
          className: "bees-row", key: account.userId, style: { background: "var(--dsw-alias-bg-base)", padding: "12px 16px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)", display: "flex", alignItems: "center" }
        },
        h("div", { 
          style: { width: "36px", height: "36px", borderRadius: "50%", background: "var(--dsw-alias-border-l2)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "600", fontSize: "14px", marginRight: "12px", color: "var(--dsw-alias-label-primary)" }
        }, account.email.charAt(0).toUpperCase()),
        h("div", { className: "bees-row-main" }, 
          h("div", { className: "bees-row-title", style: { fontWeight: "500" } }, account.email),
          h("div", { className: "bees-muted", style: { fontSize: "13px" } }, account.enabled === false ? "Inactive" : "Active")),
        h("label", { className: "bees-toggle", style: { marginRight: "12px", display: "flex", alignItems: "center" } },
          h("input", { type: "checkbox", role: "switch", checked: account.enabled !== false,
            disabled: busy, "aria-label": `Turn ${account.email} ${account.enabled === false ? "on" : "off"}`,
            onChange: (event) => run("set_account_enabled", {
              accountUserId: account.userId, enabled: event.target.checked
            }) }),
          h("span", { "aria-hidden": "true" })),
        h(Button, { className: "danger", style: { padding: "6px 12px", fontSize: "13px" }, disabled: busy, onClick: async () => {
          if (await confirmAction(`Remove ${account.email} from this device?`)) {
            await run("sign_out", { accountUserId: account.userId });
          }
        } }, "Remove"))) : [h(Empty, { key: "empty" }, "No accounts signed in")])
      )),
    h("section", null,
      h("h3", { style: { marginBottom: "8px" } }, "Add an account"),
      h("p", { className: "bees-muted", style: { marginBottom: "20px" } }, data.accounts?.length ? "Sign in with another account to switch between them or connect additional organizations." : "Sign in to an account to connect it to Bees."),
      h(AccountSignInButtons, { disabled: busy, onStart: browserAuth }),
      error ? h("div", { className: "bees-error", role: "alert", style: { marginTop: "16px" } }, error) : null)
  );
}

function OrganizationsSettings() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { collaboration().then(setData).catch((reason) =>
    setError(reason instanceof Error ? reason.message : String(reason))); }, []);
  if (!data) return h(Empty, null, error || "Loading organizations…");
  return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box" }, h("h3", null, "Organizations"),
      ...(data.organizations.length ? data.organizations.map((organization) => h("div", {
        className: "bees-row", key: organization.connectionId
      }, h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, organization.name),
        h("div", { className: "bees-muted" }, `${organization.accountEmail} · ${organization.role}`))))
        : [h(Empty, { key: "empty" }, "No Regular organizations yet")])),
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
}

function OrganizationSettings({
  ctx, data, act, organization, connectionId, reload, route, preferences, organizationColors = {}
}) {
  const [people, setPeople] = useState(null);
  const [sso, setSso] = useState(null);
  const [protocol, setProtocol] = useState("oidc");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let active = true;
    setPeople(null);
    setSso(null);
    setError("");
    if (organization?.connected && ["owner", "admin"].includes(organization.role)) {
      if (route === "organization-members") {
        collaboration("organization_people", { organizationId: organization.id, connectionId })
          .then((nextPeople) => { if (active) setPeople(nextPeople); })
          .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)));
      }
      if (route === "organization-authentication") {
        collaboration("organization_sso", { organizationId: organization.id, connectionId })
          .then((nextSso) => { if (active) setSso(nextSso); })
          .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)));
      }
    }
    return () => { active = false; };
  }, [organization?.id, organization?.connected, organization?.role, connectionId, route]);
  const [inviting, invite] = useSubmit(async (event) => {
    const formElement = event.currentTarget; const form = new FormData(formElement);
    try { setPeople(await collaboration("invite_organization_member", {
      organizationId: organization.id, connectionId,
      email: String(form.get("email") ?? ""), role: String(form.get("role") ?? "member") })); setError(""); formElement.reset(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  });
  const [updatingMemberId, setUpdatingMemberId] = useState("");
  const [updatingInvitationId, setUpdatingInvitationId] = useState("");
  const changeMemberRole = async (userId, role) => {
    setUpdatingMemberId(userId);
    try {
      setPeople(await collaboration("set_organization_member_role", {
        organizationId: organization.id, connectionId, userId, role
      }));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUpdatingMemberId("");
    }
  };
  const removeMember = async (member) => {
    const label = member.email || member.userId;
    if (!await confirmAction(`Remove ${label} from ${organization.name}?`)) return;
    setUpdatingMemberId(member.userId);
    try {
      setPeople(await collaboration("remove_organization_member", {
        organizationId: organization.id, connectionId, userId: member.userId
      }));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUpdatingMemberId("");
    }
  };
  const changeInvitationRole = async (invitationId, role) => {
    setUpdatingInvitationId(invitationId);
    try {
      setPeople(await collaboration("set_organization_invitation_role", {
        organizationId: organization.id, connectionId, invitationId, role
      }));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUpdatingInvitationId("");
    }
  };
  const [registeringSso, registerSso] = useSubmit(async (event) => {
    const form = new FormData(event.currentTarget);
    try {
      setSso(await collaboration("register_organization_sso", {
        organizationId: organization.id,
        connectionId,
        protocol,
        providerId: String(form.get("providerId") ?? ""),
        domain: String(form.get("domain") ?? ""),
        issuer: String(form.get("issuer") ?? ""),
        clientId: String(form.get("clientId") ?? ""),
        clientSecret: String(form.get("clientSecret") ?? ""),
        discoveryEndpoint: String(form.get("discoveryEndpoint") ?? ""),
        entryPoint: String(form.get("entryPoint") ?? ""),
        cert: String(form.get("cert") ?? "")
      }));
      setError(""); event.currentTarget.reset();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  });
  const removeSso = async (providerId) => {
    if (!await confirmAction(`Remove enterprise sign-in provider “${providerId}”?`)) return;
    try {
      setSso(await collaboration("remove_organization_sso", {
        organizationId: organization.id, providerId, connectionId
      }));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const verification = async (providerId, action) => {
    try {
      setSso(await collaboration(
        action === "verify" ? "verify_organization_sso" : "request_organization_sso_verification",
        { organizationId: organization.id, providerId, connectionId }
      ));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const deleteOrganization = async () => {
    const name = await ask(
      `Delete ${organization.name} permanently?\nThis deletes every team and its Bees data. Files in folders outside Bees stay on disk. Type the organization name to confirm.`,
      ""
    );
    if (name === null) return;
    if (name !== organization.name) { setError("The organization name did not match"); return; }
    setDeleting(true);
    try {
      if (organization.connected) await collaboration("delete_organization", {
        organizationId: organization.id, connectionId
      });
      else await request("/bees-api/command", {
        method: "POST", body: JSON.stringify({
          action: "delete_organization", organizationId: organization.id
        })
      });
      setError("");
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDeleting(false); }
  };
  const dangerZone = organization?.role === "owner" ? h("section", {
    className: "bees-box bees-danger-zone"
  },
  h("h3", null, "Delete organization"),
  h("p", { className: "bees-muted" },
    "Permanently deletes this organization and every team from Bees. Files in folders outside Bees stay on disk."),
  h(Button, { className: "danger", disabled: deleting, onClick: deleteOrganization },
    deleting ? "Deleting…" : "Delete organization")) : null;
  if (!organization) return h(Empty, null, "Choose an organization");
  const customColor = organizationColors[organization.id] ?? "";
  const organizationColor = customColor || defaultOrgColor(organization.name);
  const setOrganizationColor = (color) => preferences?.set("organizationColors", {
    ...organizationColors, [organization.id]: color
  });
  const resetOrganizationColor = () => {
    const nextColors = { ...organizationColors };
    delete nextColors[organization.id];
    return preferences?.set("organizationColors", nextColors);
  };
  const message = (text) => h("section", { className: "bees-box" },
    h("h3", null, organization.name), h("p", { className: "bees-muted" }, text));
  const failure = error ? h("div", { className: "bees-error", role: "alert" }, error) : null;

  if (route === "organization-root-folder") return ["owner", "admin"].includes(organization.role)
    ? h(FoldersSettings, { ctx, data, organization, act })
    : message("Only organization administrators can set this folder.");

  if (route === "organization-settings") return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box bees-appearance-card", style: { padding: "20px" } }, 
      h("h3", null, "Organization Profile"),
      h("p", { className: "bees-muted", style: { marginBottom: "20px" } }, "General settings and details about this organization."),
      h("div", { className: "bees-row", style: { background: "var(--dsw-alias-bg-base)", padding: "16px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)" } }, 
        h("div", { 
          style: { width: "40px", height: "40px", borderRadius: "8px", background: organizationColor, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: "bold" }
        }, organization.name.trim().charAt(0).toLocaleUpperCase() || "•"),
        h("div", { className: "bees-row-main", style: { marginLeft: "12px" } },
          h("div", { className: "bees-row-title", style: { fontSize: "16px" } }, organization.name),
          h("div", { className: "bees-muted" }, organization.connected
            ? `Regular organization · Role: ${organization.role}` : "Private organization · Saved on this device")))),
    
    h("section", { className: "bees-box bees-appearance-card", style: { padding: "20px" } }, 
      h("h3", null, "Branding & Appearance"),
      h("p", { className: "bees-muted", style: { marginBottom: "16px" } },
        "Personalize the color used for this organization in the sidebar switcher. This preference is saved locally on this device."),
      h("div", { className: "bees-form-row", style: { display: "flex", alignItems: "center", gap: "16px", background: "var(--dsw-alias-bg-base)", padding: "16px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)" } },
        h("label", { style: { display: "flex", alignItems: "center", gap: "12px", margin: 0, flex: 1 } }, 
          h("span", { style: { fontWeight: "500" } }, "Organization color"), 
          h("input", { type: "color", className: "bees-color-input", style: { width: "32px", height: "32px", padding: "0", border: "none", borderRadius: "4px", cursor: "pointer" },
            value: organizationColor, onChange: (event) => setOrganizationColor(event.target.value) })),
        customColor ? h(Button, { onClick: resetOrganizationColor }, "Reset to default") : null)),
    dangerZone,
    failure);

  if (!organization.connected) return message(
    route === "organization-members" ? "Private organizations do not have shared members."
      : "Enterprise authentication is only available to Regular organizations."
  );
  if (!["owner", "admin"].includes(organization.role)) return message(
    `Your role is ${organization.role}. Only organization administrators can manage this section.`
  );

  if (route === "organization-members") {
    if (!people) return h(Empty, null, error || "Loading organization members…");
    return h("div", { className: "bees-stack" },
      h("section", { className: "bees-box bees-appearance-card", style: { padding: "20px" } }, 
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" } },
          h("h3", { style: { margin: 0 } }, `${organization.name} Members`),
          h("span", { className: "bees-badge", style: { padding: "4px 8px" } }, `${people.memberships.length} member${people.memberships.length === 1 ? "" : "s"}`)
        ),
        h("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } },
        ...(people.memberships.length ? people.memberships.map((member) => h("div", { className: "bees-row", key: member.id, style: { padding: "12px 4px", border: 0 } },
          h("div", { 
            style: { width: "32px", height: "32px", borderRadius: "50%", background: "var(--dsw-alias-border-l2)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "600", fontSize: "14px", marginRight: "12px", color: "var(--dsw-alias-label-primary)" }
          }, (member.email || member.userId).charAt(0).toUpperCase()),
          h("div", { className: "bees-row-main" }, 
            h("div", { className: "bees-row-title", style: { fontWeight: "500" } }, member.email || member.userId),
            h("div", { className: "bees-muted", style: { fontSize: "13px" } }, member.status)),
          member.role === "owner"
            ? h("span", { className: "bees-badge", style: { background: "var(--dsw-alias-brand)", color: "#fff" } }, "Owner")
            : h("div", {
                className: "bees-detail-actions",
                style: { alignItems: "center", flexWrap: "nowrap", gap: "8px", marginTop: 0 },
                role: "group", "aria-label": `Member controls for ${member.email || member.userId}`
              }, h("select", {
                className: "bees-select",
                style: {
                  minWidth: "120px", padding: "7px 32px 7px 12px", fontWeight: 600,
                  backgroundColor: "var(--dsw-specific-sidebar-fill)"
                },
                value: member.role,
                disabled: updatingMemberId === member.userId,
                "aria-label": `Role for ${member.email || member.userId}`,
                onChange: (event) => void changeMemberRole(member.userId, event.target.value)
              },
              h("option", { value: "member" }, "Member"),
              h("option", { value: "admin" }, "Admin")),
              h(Button, {
                className: "danger",
                disabled: updatingMemberId === member.userId,
                "aria-label": `Remove ${member.email || member.userId}`,
                onClick: () => void removeMember(member)
              }, updatingMemberId === member.userId ? "Removing…" : "Remove"))))
          : [h(Empty, { key: "empty" }, "No organization members")]))),
          
      h("section", { className: "bees-box bees-appearance-card", style: { padding: "20px" } }, 
        h("h3", null, "Invite new member"),
        h("p", { className: "bees-muted", style: { marginBottom: "16px" } }, "Send an email invitation to join this organization."),
        h("form", { className: "bees-form-row", style: { display: "flex", gap: "12px", alignItems: "flex-end" }, onSubmit: invite },
          h("label", { style: { flex: "1 1 0", margin: 0 } }, h("div", { style: { marginBottom: "6px", fontSize: "13px", fontWeight: "500" } }, "Email address"), h("input", { className: "bees-input", name: "email", type: "email", placeholder: "colleague@example.com", required: true, style: { width: "100%" } })),
          h("label", { style: { width: "120px", margin: 0 } }, h("div", { style: { marginBottom: "6px", fontSize: "13px", fontWeight: "500" } }, "Role"), h("select", { className: "bees-select", name: "role", style: { width: "100%" } }, h("option", { value: "member" }, "Member"), h("option", { value: "admin" }, "Admin"))),
          h("button", { className: "bees-btn primary", disabled: inviting, style: { height: "32px" } }, inviting ? "Sending…" : "Send invitation")),
          
        people.invitations.length > 0 ? h("div", { style: { marginTop: "24px" } },
          h("h4", { style: { marginBottom: "12px", fontSize: "14px", fontWeight: "600", color: "var(--dsw-alias-label-secondary)" } }, "Pending Invitations"),
          h("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } },
            ...people.invitations.map((invitation) => h("div", { className: "bees-row", key: invitation.id, style: { padding: "12px 4px", border: 0 } },
              h("div", { 
                style: { width: "32px", height: "32px", borderRadius: "50%", background: "var(--dsw-alias-border-l2)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "600", fontSize: "14px", marginRight: "12px", color: "var(--dsw-alias-label-secondary)" }
              }, "@"),
              h("div", { className: "bees-row-main" }, 
                h("div", { className: "bees-row-title", style: { fontWeight: "500" } }, invitation.email),
                h("div", { className: "bees-muted", style: { fontSize: "13px" } }, invitation.expiresAt ? `Expires ${new Date(invitation.expiresAt).toLocaleDateString()}` : "Pending")),
              h("select", {
                className: "bees-select",
                style: { padding: "4px 8px", height: "auto" },
                value: invitation.role,
                disabled: updatingInvitationId === invitation.id,
                "aria-label": `Role for invitation ${invitation.email}`,
                onChange: (event) => void changeInvitationRole(invitation.id, event.target.value)
              },
              h("option", { value: "member" }, "Member"),
              h("option", { value: "admin" }, "Admin")))))) : null),
      failure);
  }

  if (organization.role !== "owner") return message("Only the organization owner can configure company SSO.");
  if (!sso) return h(Empty, null, error || "Loading enterprise authentication…");
  return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box" }, h("h3", null, "Enterprise authentication"),
      h("p", { className: "bees-muted" },
        "Configure one OIDC or SAML identity provider for each company email domain. Successful login creates or restores an ordinary Bees organization membership."),
      sso?.verification ? h("div", { className: "bees-box" },
        h("strong", null, "Verify company domain"),
        h("p", { className: "bees-muted" }, `Add this DNS TXT record, then verify: ${sso.verification.dnsName}`),
        h("code", null, sso.verification.domainVerificationToken),
        h("div", { className: "bees-form-row" },
          h(Button, { onClick: () => verification(sso.verification.providerId, "verify") }, "Verify DNS"))) : null,
      ...(sso?.providers?.length ? sso.providers.map((provider) => h("div", {
        className: "bees-row", key: provider.providerId
      }, h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, provider.providerId),
        h("div", { className: "bees-muted" }, `${provider.protocol.toUpperCase()} · ${provider.domain} · ${provider.domainVerified ? "verified" : "DNS verification required"}`),
        h("div", { className: "bees-muted" }, provider.protocol === "saml"
          ? `ACS: ${provider.samlAcsUrl} · Metadata: ${provider.samlMetadataUrl}`
          : `Redirect URI: ${provider.oidcRedirectUrl}`)),
      !provider.domainVerified ? h(Button, { onClick: () => verification(provider.providerId, "request") }, "DNS record") : null,
      h(Button, { className: "danger", onClick: () => removeSso(provider.providerId) }, "Remove"))) : []),
      h("div", { className: "bees-segmented" },
        h(Button, { className: protocol === "oidc" ? "active" : "", onClick: () => setProtocol("oidc") }, "OIDC"),
        h(Button, { className: protocol === "saml" ? "active" : "", onClick: () => setProtocol("saml") }, "SAML")),
      h("form", { className: "bees-form", onSubmit: registerSso },
        h("label", null, "Provider id", h("input", { className: "bees-input", name: "providerId", placeholder: "acme-okta", pattern: "[a-z0-9][a-z0-9-]*", required: true })),
        h("label", null, "Company email domain", h("input", { className: "bees-input", name: "domain", placeholder: "acme.com", required: true })),
        h("label", null, "Issuer", h("input", { className: "bees-input", name: "issuer", type: "url", required: true })),
        protocol === "oidc" ? h(React.Fragment, null,
          h("label", null, "Client id", h("input", { className: "bees-input", name: "clientId", required: true })),
          h("label", null, "Client secret", h("input", { className: "bees-input", name: "clientSecret", type: "password", required: true })),
          h("label", null, "Discovery URL (optional)", h("input", { className: "bees-input", name: "discoveryEndpoint", type: "url" })))
          : h(React.Fragment, null,
            h("label", null, "IdP sign-in URL", h("input", { className: "bees-input", name: "entryPoint", type: "url", required: true })),
            h("label", null, "IdP signing certificate", h("textarea", { className: "bees-input", name: "cert", rows: 6, required: true }))),
        h(Button, { type: "submit", className: "primary", disabled: registeringSso }, registeringSso ? "Adding…" : "Add identity provider"))),
    failure);
}

function TeamSettings({ team, organization, connectionId, openOrganization, navigate, route }) {
  const [people, setPeople] = useState(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const canManage = team?.role === "admin";
  const canManageOrganization = ["owner", "admin"].includes(organization?.role);
  const canDelete = canManage && canManageOrganization;
  useEffect(() => {
    let active = true;
    setPeople(null);
    setError("");
    if (team && organization?.connected && ["team-members", "team-invitations"].includes(route)) {
      collaboration("team_people", { teamId: team.id, connectionId })
        .then((value) => active && setPeople(value))
        .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)));
    }
    return () => { active = false; };
  }, [team?.id, team?.role, organization?.connected, connectionId, route]);
  const [adding, add] = useSubmit(async (event) => {
    if (!people?.canManage || !people.candidates.length) return;
    const form = new FormData(event.currentTarget);
    try { setPeople(await collaboration("add_team_member", { teamId: team?.id, connectionId,
      userId: String(form.get("userId") ?? ""), role: String(form.get("role") ?? "member") })); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  });
  if (!team) return h(Empty, null, "Choose a team");
  const deleteTeam = async () => {
    if (!canDelete) return;
    const name = await ask(
      `Delete ${team.name} permanently?\nThis deletes its workspaces and all of its Bees data. Files in folders outside Bees stay on disk. Type the team name to confirm.`,
      ""
    );
    if (name === null) return;
    if (name !== team.name) { setError("The team name did not match"); return; }
    setDeleting(true);
    try {
      if (organization.connected) await collaboration("delete_team", { teamId: team.id, connectionId });
      else await request("/bees-api/command", {
        method: "POST", body: JSON.stringify({ action: "delete_team", teamId: team.id })
      });
      setError("");
      await openOrganization({ ...organization, connectionId });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDeleting(false); }
  };
  const dangerZone = h("section", {
    className: "bees-box bees-danger-zone"
  },
  h("h3", null, "Delete team"),
  h("p", { className: "bees-muted" },
    "Permanently deletes this team, its workspaces, and its Bees data. Files in folders outside Bees stay on disk."),
  h(Button, { className: "danger", disabled: !canDelete || deleting, onClick: deleteTeam },
    deleting ? "Deleting…" : "Delete team"));
  const failure = error ? h("div", { className: "bees-error", role: "alert" }, error) : null;
  if (route === "team-settings") return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box" }, h("h3", null, team.name),
      h("p", { className: "bees-muted" }, organization?.connected
        ? `This team belongs to ${organization.name}.`
        : "This team belongs to a Private organization on this device.")),
    dangerZone, failure);
  if (!organization?.connected) return h(Empty, null, "Connect this organization to manage team members.");
  if (!people) return h(Empty, null, error || "Loading team members…");
  if (route === "team-members") return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box" }, h("h3", null, `${team.name} members`),
      ...people.members.map((member) => h("div", { className: "bees-row", key: member.id },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, member.email || member.userId),
          h("div", { className: "bees-muted" }, "Active organization member")), h("span", { className: "bees-badge" }, member.role)))),
    failure);
  return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box" }, h("h3", null, "Add organization member"),
      h("p", { className: "bees-muted" }, "Team membership starts immediately; there is no invitation to accept."),
      h("form", { className: "bees-form-row", onSubmit: add },
        h("label", null, "Organization member", h("select", { className: "bees-select", name: "userId", disabled: !people.canManage || !people.candidates.length },
          !people.canManage || !people.candidates.length ? h("option", { value: "" }, people.canManage
            ? "Every organization member is already on this team" : "Only team administrators can add members") : null,
          ...people.candidates.map((candidate) => h("option", { value: candidate.userId, key: candidate.userId }, candidate.email || candidate.userId)))),
        h("label", null, "Role", h("select", { className: "bees-select", name: "role", disabled: !people.canManage || !people.candidates.length }, h("option", { value: "member" }, "Member"), h("option", { value: "admin" }, "Admin"))),
        h("button", { className: "bees-btn primary", disabled: !people.canManage || !people.candidates.length || adding }, adding ? "Adding…" : "Add member")),
      h("p", { className: "bees-muted" }, canManageOrganization
        ? `For someone new, invite them to ${organization.name} first. After they accept, add them to ${team.name} here.`
        : "Only organization administrators can invite new people. After they join the organization, a team administrator can add them here."),
      h(Button, { disabled: !canManage || !canManageOrganization,
        onClick: () => navigate("organization-members") }, "Invite new member")),
    failure);
}

function DataFolderSettings({ ctx, data, act }) {
  const { path, shared } = data.dataFolder;
  const [notice, setNotice] = useState("");
  const [busy, choose] = useSubmit(async (_event, reset) => {
    const picked = reset ? "" : await ctx.uiWorkspace.pickDirectory();
    if (!reset && !picked) return;
    setNotice("");
    try {
      const moved = await act({ action: "set_data_folder", directory: picked });
      // the folder is only read at launch
      if (moved?.restart) await window.__TAURI__.core.invoke("restart_app")
        .catch(() => setNotice("Quit Bees and open it again to use that folder."));
    } catch (error) { setNotice(error.message || String(error)); }
  });
  return h("section", { className: "bees-box bees-stack" },
    h("h2", null, "Data folder"),
    h("p", null, path),
    h("p", { className: "bees-muted" }, "Pick a folder in Google Drive, Dropbox or iCloud to share your work between computers. ",
      "An empty folder gets a copy, a filled one is joined as it is. Open it on one computer at a time. Saved keys stay on each computer."),
    notice ? h("p", { className: "bees-callout", role: "status" }, notice) : null,
    h("div", { className: "bees-detail-actions" },
      h(Button, { onClick: choose, disabled: busy }, busy ? "Switching…" : "Choose a shared folder"),
      shared ? h(Button, { onClick: (event) => choose(event, true), disabled: busy }, "Use this computer again") : null));
}

export function RootFolderSettings({ ctx, data, act }) {
  const [notice, setNotice] = useState("");
  const [busy, choose] = useSubmit(async () => {
    try {
      const directory = await ctx.uiWorkspace.pickDirectory();
      if (!directory) return;
      setNotice("");
      await act({ action: "set_folder_root", level: "root", directory }, undefined, setNotice);
    } catch (error) { setNotice(error.message || String(error)); }
  });
  return h("section", { className: "bees-box bees-stack" },
    h("h2", null, data.rootFolder?.folder ? "Root folder" : "Choose your Bees root folder"),
    h("div", { style: { padding: "16px", background: "var(--dsw-alias-interactive-bg-hover)", borderRadius: "8px", margin: "12px 0" } },
      h("div", { style: { display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 } }, h("span", { style: { width: "16px", height: "16px", display: "inline-flex" } }, h(FilesIcon)), "Bees root"),
      h("div", { style: { marginLeft: "7px", paddingLeft: "16px", borderLeft: "2px solid var(--dsw-alias-border-l1)", marginTop: "8px", display: "flex", flexDirection: "column", gap: "8px" } },
        h("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } },
          h("div", { style: { display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 } }, h("span", { style: { width: "16px", height: "16px", display: "inline-flex" } }, h(FilesIcon)), "org"),
          h("div", { className: "bees-muted", style: { fontSize: "13px", lineHeight: "1.4" } }, "Bees creates a default org sub folder for every org. You can override and select a different folder.")
        ),
        h("div", { style: { marginLeft: "7px", paddingLeft: "16px", borderLeft: "2px solid var(--dsw-alias-border-l1)", marginTop: "4px", display: "flex", flexDirection: "column", gap: "8px" } },
          h("div", { style: { display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 } }, h("span", { style: { width: "16px", height: "16px", display: "inline-flex" } }, h(FilesIcon)), "team")
        )
      )
    ),
    h("p", { className: "bees-muted" }, "You can override these locations in organization and team settings, including folders synced by Google Drive, SharePoint or Dropbox. Folder choices are saved on this computer."),
    data.rootFolder?.folder ? h("p", null, data.rootFolder.folder) : null,
    data.rootFolder?.missing ? h("p", { className: "bees-error", role: "alert" }, "Your root folder is unavailable. Reconnect it or choose another folder.") : null,
    notice ? h("p", { className: "bees-error", role: "alert" }, notice) : null,
    h(Button, { onClick: choose, disabled: busy }, busy ? "Saving…" : data.rootFolder?.folder ? "Change root folder" : "Choose root folder"));
}

// Where each level keeps its folders on this computer. The database is shared, so it holds no path:
// it holds the part below the workspace's folder, and each computer points a level at its own folder.
const FOLDER_LEVELS = { organization: "Organization", team: "Team" };

function FoldersSettings({ ctx, data, team, organization, act }) {
  const workspaceIds = data.workspaces.filter(({ teamId }) => teamId === team?.id).map(({ id }) => id);
  const rows = (organization ? data.organizationFolders ?? [] : data.folders ?? [])
    .filter((row) => organization ? row.id === organization.id : workspaceIds.includes(row.workspaceId) && row.level === "team")
    // a team's workspaces share one organization and one team folder, so those rows are listed once
    .filter((row, index, all) => all.findIndex((other) => other.level === row.level && other.id === row.id) === index);
  const above = (row) => row.level === "organization" ? "root folder" : "organization folder";
  const [notice, setNotice] = useState("");
  const [busy, choose] = useSubmit(async (event, row, reset) => {
    try {
      const picked = reset ? "" : await ctx.uiWorkspace.pickDirectory();
      if (!reset && !picked) return;
      setNotice("");
      await act({ action: "set_folder_root", workspaceId: row.workspaceId, level: row.level, id: row.id, directory: picked }, undefined, setNotice);
    } catch (error) { setNotice(error.message || String(error)); }
  });
  return h("section", { className: "bees-box bees-stack" },
    h("h2", null, organization ? "Org Root Folder" : "Team folder"),
    h("p", { className: "bees-muted" }, organization
      ? "By default, this organization's folder sits inside your root folder. Choose another folder, including one synced by Google Drive, SharePoint or Dropbox, to keep its work there."
      : "All workspaces in this team use the team folder. By default, it sits inside the organization folder. Choose another folder to keep the team's work there.",
      " This setting applies to this computer. Existing run files are copied; their originals stay in place."),
    notice ? h("p", { className: "bees-callout", role: "status" }, notice) : null,
    ...rows.map((row) => h("div", { className: "bees-row", key: `${row.level}:${row.id}` },
      h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, `${FOLDER_LEVELS[row.level]} · ${row.name}`),
        h("div", { className: "bees-muted" }, row.folder),
        row.missing ? h("div", { className: "bees-error", role: "alert" }, "Not on this computer right now.") : null),
      h("span", { className: "bees-badge" }, row.picked ? "Set here" : `Uses ${above(row)}`),
      h("div", { className: "bees-detail-actions" },
        h(Button, { disabled: busy, onClick: (event) => choose(event, row) }, "Choose folder"),
        row.picked ? h(Button, { disabled: busy, onClick: (event) => choose(event, row, true) }, `Use ${above(row)}`) : null))));
}

// The browser this team's runs open. On, they browse with the person's own sign-ins; off, they browse
// in Bees' own Chrome, which leaves the person's own browser, and its sign-ins, untouched.
function BrowserSettings({ data, team, act }) {
  const [notice, setNotice] = useState("");
  const [busy, choose] = useSubmit(async (event, useDefault) => {
    try {
      setNotice("");
      await act({ action: "set_default_browser", teamId: team.id, useDefault });
    } catch (error) { setNotice(error.message || String(error)); }
  });
  const browser = data.defaultBrowser ?? {};
  const useDefault = Boolean(browser.name) && !(browser.offTeams ?? []).includes(team.id);
  return h("section", { className: "bees-box bees-stack" },
    h("h2", null, "Browser"),
    h("label", { className: "bees-toggle", style: { gap: "10px", fontWeight: "600" } },
      h("input", { type: "checkbox", role: "switch", checked: useDefault, disabled: busy || !browser.name,
        onChange: (event) => choose(event, event.target.checked) }),
      h("span", { "aria-hidden": "true" }), "Use your own browser"),
    // with no usable browser the warning already says where runs browse
    browser.name ? h("p", { className: "bees-muted" }, useDefault && browser.setup
      ? `Runs in this team browse in Bees' own Chrome for now. To have them use your ${browser.name}: ${browser.setup}`
      : useDefault ? `Runs in this team open their own tabs in your ${browser.name}, so the sites you are already signed in to work straight away. Your other tabs are left alone.`
      : `Runs in this team browse in Bees' own Chrome, where you sign in once. Your ${browser.name} is left alone.`) : null,
    browser.warning ? h("p", { className: "bees-callout", role: "status" }, browser.warning) : null,
    notice ? h("p", { className: "bees-callout", role: "status" }, notice) : null);
}

// Deleting the app on its own leaves the database, downloaded models and sessions behind, and the
// next install reads them, so the size is in front of the person before it goes.
function RemoveBeesSettings({ dataFolder }) {
  const invoke = window.__TAURI__?.core?.invoke;
  const [folder, setFolder] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // a nearly empty install reads "0.0 GB", which looks like the number failed to load
  const readable = (bytes) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
  useEffect(() => {
    if (!invoke) return;
    let active = true;
    void invoke("bees_data_size").then((row) => { if (active) setFolder(row); })
      .catch((error) => { if (active) setNotice(error?.message || String(error)); });
    return () => { active = false; };
  }, []);
  const remove = async () => {
    if (!folder) return;
    setBusy(true);
    // the app asks in its own window, false means the person kept Bees
    try { if (!await invoke("uninstall_bees")) setBusy(false); }
    catch (error) { setNotice(error?.message || String(error)); setBusy(false); }
  };
  return h("section", { className: "bees-box bees-stack" },
    h("h2", null, "Removing Bees"),
    h("p", null, "Bees keeps its downloaded models and sessions in a folder of its own. Putting the app in the Trash leaves that folder behind, and the next install makes use of it."),
    h("p", null, folder ? `${folder.path} · about ${readable(folder.bytes)}` : "Reading the size of that folder…"),
    notice ? h("p", { className: "bees-callout", role: "status" }, notice) : null,
    invoke
      ? h("div", { className: "bees-detail-actions" },
        h(Button, { className: "danger", disabled: busy || !folder, onClick: remove }, busy ? "Removing…" : "Remove Bees and its data"))
      : h("p", { className: "bees-muted" }, "Open the installed app to remove Bees from here."),
    h("p", { className: "bees-muted" }, dataFolder.shared
      ? `This removes memory, downloaded models, sessions and logs on this computer. Your shared folder at ${dataFolder.path} keeps your workspaces, runs and reviews and is not touched. After you reinstall, choose it again in Settings → Data folder.`
      : "This removes your workspaces, runs, reviews, memory, downloaded models and logs. Folders you chose yourself are not touched."));
}

function SettingsGroup({ label, routes, route, navigate, role, connected = true, divider = true }) {
  const shown = routes.filter(([, , needs]) => !needs || connected && needs.includes(role));
  if (!shown.length) return null;
  return h(React.Fragment, null,
    divider ? h("hr", { className: "bees-settings-divider" }) : null,
    h("div", { className: "bees-settings-menu-label", title: label }, label),
    ...shown.map(([id, text]) => h("button", { type: "button", key: id,
      className: route === id ? "active" : "", "aria-current": route === id ? "page" : null,
      onClick: () => navigate(id) }, text)));
}

function SettingsLayout({ route, navigate, organization, team, platform, children }) {
  const teamRoute = team && TEAM_SETTINGS.some(([id]) => id === route);
  return h("div", { className: "bees-settings-layout" },
    h("aside", { className: "bees-settings-menu" },
      teamRoute ? h(SettingsGroup, { label: team.name, routes: TEAM_SETTINGS, route, navigate, role: team.role, divider: false })
        : h(React.Fragment, null,
          h("div", { className: "bees-settings-menu-label" }, "Global"),
          ...GLOBAL_SETTINGS.filter(([id]) => id !== "platform-admin" || platform?.isPlatformAdmin).map(([id, label]) => h("button", { type: "button", key: id,
            className: route === id ? "active" : "", "aria-current": route === id ? "page" : null,
            onClick: () => navigate(id) }, label)),
          organization ? h(SettingsGroup, { label: organization.name, routes: ORGANIZATION_SETTINGS, route, navigate,
            role: organization.role, connected: organization.connected }) : null)),
    h("section", { className: "bees-settings-content" }, children));
}

export function SettingsPage({
  ctx, data, act, route, teamId, organizationId, connectionId, modelSettings, preferences, reload,
  preference = {}, openOrganization, navigate = () => undefined, productSettings, platform
}) {
  const connection = data.connections?.find(({ id }) => id === connectionId);
  const connectionTeam = data.connectionTeams?.find((row) =>
    row.connectionId === connectionId && row.teamId === teamId);
  const rawTeam = data.teams.find(({ id }) => id === teamId);
  const rawOrganization = data.organizations.find(({ id }) => id === organizationId);
  const team = rawTeam ? { ...rawTeam, role: connectionTeam?.role ?? rawTeam.role } : null;
  const organization = rawOrganization
    ? { ...rawOrganization, role: connection?.role ?? rawOrganization.role }
    : null;
  const content = ["team-settings", "team-members", "team-invitations"].includes(route) ? h("div", { className: "bees-stack" },
      team && team.role !== "admin" ? h("p", { className: "bees-callout", role: "status" },
        "Read-only team settings. Only team administrators can make changes.") : null,
      h(TeamSettings, { team, organization, connectionId, openOrganization, navigate, route }))
    : route === "team-memory" ? h("div", { className: "bees-stack" },
      team && team.role !== "admin" ? h("p", { className: "bees-callout", role: "status" },
        "Read-only workspace memory. Only team administrators can make changes.") : null,
      ...data.workspaces.filter((workspace) => workspace.teamId === teamId).map((workspace) =>
        h(MemorySettings, { key: workspace.id, workspace, canManage: team?.role === "admin" })),
      data.workspaces.some((workspace) => workspace.teamId === teamId) ? null : h(Empty, null, "This team has no workspace memory yet."))
    : route === "team-folders"
      // the folder belongs to this computer, so the person's local role decides, not a synced account's
      ? !rawTeam ? h(Empty, null, "Choose a team")
        : rawTeam.role !== "admin" ? h(Empty, null, "Only team administrators can set this team's folders")
          : h(FoldersSettings, { ctx, data, team: rawTeam, act })
    : route === "team-browser"
      // the browser is this computer's too, so the same local role decides
      ? !rawTeam ? h(Empty, null, "Choose a team")
        : rawTeam.role !== "admin" ? h(Empty, null, "Only team administrators can set this team's browser")
          : h(BrowserSettings, { data, team: rawTeam, act })

    : route === "platform-admin" ? platform?.isPlatformAdmin ? h("section", { className: "bees-box" },
      h("h2", null, "Platform Admin"),
      h("label", { style: { display: "flex", gap: "10px", alignItems: "center" } },
        h("input", { type: "checkbox", role: "switch", checked: platform.editing, disabled: platform.busy || !platform.editable,
          onChange: (event) => void productSettings.toggle(event.target.checked) }), "Edit product defaults"),
      h("p", { className: "bees-muted" }, platform.editable
        ? "Use the existing AI, appearance and layout controls. Saved defaults apply here immediately and ship in future builds. Personal settings take priority. Other installations need an updated build."
        : "Editing product defaults requires the Bees development build with a writable source checkout."))
      : h(Empty, null, "Platform administrator access is unavailable.")
    : route === "personal-ai"
      ? h(AiSettings, { ctx, modelSettings, preferences, systemDefault: platform?.editing
        ? platform.values["agent-default-model"].selection : data.systemDefaultModel, reload, productSettings,
        catalog: data.localModelCatalog })
    : route === "system-instructions"
      ? h(SystemInstructionsSettings, { preferences, instructions: preference.systemInstructions ?? "" })
    : route === "appearance" ? h(AppearanceSettings, { ctx, preferences })
    : route === "root-folder" ? h(RootFolderSettings, { ctx, data, act })
    : route === "data-folder" ? h(DataFolderSettings, { ctx, data, act })
    : route === "removing-bees" ? h(RemoveBeesSettings, { dataFolder: data.dataFolder })
    : route === "organizations" ? h(OrganizationsSettings)
    : ORGANIZATION_SETTINGS.some(([id]) => id === route)
      ? h(OrganizationSettings, {
        ctx, data, act, organization: route === "organization-root-folder" ? rawOrganization : organization, connectionId, reload, route, preferences,
        organizationColors: preference.organizationColors ?? {}
      })
      : h(Empty, null, "Choose a settings section");
  // the rail lists this computer's own settings, so its team group carries the local role
  return h(SettingsLayout, { route, navigate, organization, team: rawTeam, platform }, content);
}
