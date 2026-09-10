import {
  CustomAiSettings, ExternalLocalAiSettings, FreeAiSettings, h, LocalAiSettings,
  React, SubscriptionSettings, useEffect, useState
} from "./runtime.js";
import {
  ask, Button, collaboration, confirmAction, defaultOrgColor, Empty, openExternal, request, useSubmit,
  THEME_PRESETS, usePreference
} from "./shared.js";
import { SystemDefaultSettings } from "./agents.js";

function AiSettings({ ctx, modelSettings, preferences, systemDefault, reload }) {
  const preference = usePreference(preferences);
  const isOnboarding = preference.onboarding?.active;
  const [activeTab, setActiveTab] = useState(isOnboarding ? (preference.onboardingAiFocus ?? "") : "");
  const focus = preference.onboarding?.active ? preference.onboardingAiFocus : "";
  return h("div", { className: "bees-stack" },
    focus ? h("section", { className: "bees-callout" },
      h("h2", null, "Choose how Bees thinks"),
      h("p", null, "Connect or start a model below, save it as your system default, then return to setup to test it. You can continue setup during a download."),
      h("div", { className: "bees-card-actions" },
        ...[["local", "On this computer"], ["subscriptions", "Codex or Claude"], ["other", "Other providers"], ["", "Show all"]].map(([id, label]) =>
          h(Button, { key: id, className: focus === id ? "primary" : "", onClick: () => preferences.set("onboardingAiFocus", id) }, label)))) : null,
    h(SystemDefaultSettings, { ctx, modelSettings, systemDefault, reload }),
    (!focus || focus === "subscriptions") ? h(SubscriptionSettings, { modelSettings, preferences, systemDefault, ask, openExternal, Button }) : null,
    (!focus || focus === "other") ? h(FreeAiSettings, { ctx, modelSettings, preferences, systemDefault, ask, confirmAction, openExternal, Button }) : null,
    (!focus || focus === "local") ? h(LocalAiSettings, { modelSettings, preferences, systemDefault, ask, confirmAction, Button }) : null,
    (!focus || focus === "other") ? h(ExternalLocalAiSettings, { modelSettings, preferences, systemDefault, ask, Button }) : null,
    (!focus || focus === "other") ? h(CustomAiSettings, { ctx, modelSettings, preferences, systemDefault, ask, confirmAction, openExternal, Button }) : null);
}

function AppearanceSettings({ ctx, preferences }) {
  const preference = usePreference(preferences);
  const theme = ctx.get?.("theme") ?? ctx.theme;
  const preset = THEME_PRESETS.some(({ id }) => id === preference.themePreset)
    ? preference.themePreset : "forest";
  const darkDefault = THEME_PRESETS.some(({ id }) => id === preference.darkThemePreset)
    ? preference.darkThemePreset : "forest";
  const lightDefault = THEME_PRESETS.some(({ id }) => id === preference.lightThemePreset)
    ? preference.lightThemePreset : "emerald";
  const chooseTheme = async (option) => {
    const nextMode = option.dark ? "dark" : "light";
    await preferences.set("themePreset", option.id);
    await preferences.set("colorMode", nextMode);
    theme.setTheme(nextMode);
  };
  return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box" }, h("h3", null, "Theme defaults"),
      h("p", { className: "bees-muted" }, "Choose which palettes the header button uses when switching between dark and light."),
      h("div", { className: "bees-form-grid" },
        h("label", null, "Default Dark Theme", h("select", { className: "bees-select", value: darkDefault,
          "data-theme-default": "dark", onChange: (event) => void preferences.set("darkThemePreset", event.target.value) },
        ...THEME_PRESETS.map((option) => h("option", { key: option.id, value: option.id }, option.label)))),
        h("label", null, "Default Light Theme", h("select", { className: "bees-select", value: lightDefault,
          "data-theme-default": "light", onChange: (event) => void preferences.set("lightThemePreset", event.target.value) },
        ...THEME_PRESETS.map((option) => h("option", { key: option.id, value: option.id }, option.label)))))),
    h("section", { className: "bees-box" }, h("h3", null, "Theme"),
      h("p", { className: "bees-muted" }, "All 35 themes from old Bees. The selected palette applies across organizations and teams on this device."),
      h("div", { className: "bees-theme-grid" }, ...THEME_PRESETS.map((option) =>
        h("button", { type: "button", key: option.id,
          className: `bees-theme-card ${preset === option.id ? "active" : ""}`,
          "aria-pressed": preset === option.id, onClick: () => void chooseTheme(option) },
        h("span", { className: "bees-theme-swatches", "aria-hidden": "true" },
          ...option.colors.map((color) => h("span", { key: color, style: { background: color } }))),
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
  return h("div", { className: "bees-account-auth" },
    h(Button, { disabled,
      onClick: () => onStart("social_start", { provider: "google" }) }, "Sign up/in with Google"),
    h(Button, { disabled,
      onClick: () => onStart("social_start", { provider: "github" }) }, "Sign up/in with GitHub"),
    h(Button, { disabled, onClick: async () => {
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
  useEffect(() => { void refresh(); }, []);
  const browserAuth = async (action, values) => {
    setBusy(true);
    try {
      const before = new Map((data?.accounts ?? []).map(({ userId, updatedAt }) => [userId, updatedAt]));
      const { url } = await collaboration(action, values);
      await openExternal(url);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        const next = await collaboration();
        if ((next.accounts ?? []).some(({ userId, updatedAt }) =>
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
  return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box bees-accounts" },
      ...((data.accounts ?? []).length ? data.accounts.map((account) => h("div", {
        className: "bees-row", key: account.userId
      }, h("div", { className: "bees-row-main bees-row-title" }, account.email),
      h("label", { className: "bees-account-toggle" },
        h("input", { type: "checkbox", role: "switch", checked: account.enabled !== false,
          disabled: busy, "aria-label": `Turn ${account.email} ${account.enabled === false ? "on" : "off"}`,
          onChange: (event) => run("set_account_enabled", {
            accountUserId: account.userId, enabled: event.target.checked
          }) }),
        h("span", { "aria-hidden": "true" })),
      h(Button, { className: "danger", disabled: busy, onClick: async () => {
        if (await confirmAction(`Delete ${account.email} from this device?`)) {
          await run("sign_out", { accountUserId: account.userId });
        }
      } }, "Delete"))) : [h(Empty, { key: "empty" }, "No accounts signed in")]),
      h("hr"),
      h(AccountSignInButtons, { disabled: busy, onStart: browserAuth }),
      error ? h("div", { className: "bees-error", role: "alert" }, error) : null));
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

function ConnectionsSettings() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try { setData(await request("/bees-api/connections")); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  useEffect(() => { void refresh(); }, []);
  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await request("/bees-api/connections", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "connect_google_drive" })
      });
      await openExternal(url);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        const next = await request("/bees-api/connections");
        if (next.googleDrive?.connected) { setData(next); setError(""); return; }
      }
      throw new Error("Google Drive connection was not completed");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true);
    try {
      setData(await request("/bees-api/connections", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "disconnect_google_drive" })
      }));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  if (!data) return h(Empty, null, error || "Loading connections…");
  const drive = data.googleDrive;
  return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box" }, h("h3", null, "Google Drive"),
      h("p", { className: "bees-muted" },
        "Read-only access exports Google Docs, every Sheet tab, Slides, Drawings, and Form structure into a local QMD cache. Documents and the index are not uploaded to Bees."),
      drive.connected
        ? h("div", { className: "bees-row" },
            h("div", { className: "bees-row-main" },
              h("div", { className: "bees-row-title" }, drive.profile?.displayName || drive.profile?.emailAddress || "Connected"),
              h("div", { className: "bees-muted" }, [
                drive.profile?.emailAddress || "Google Drive · read only · this device",
                drive.lastExportedAt ? `last exported ${new Date(drive.lastExportedAt).toLocaleString()}` : "exports on first knowledge search"
              ].join(" · "))),
            h(Button, { className: "danger", disabled: busy, onClick: disconnect }, "Disconnect"))
        : h(Button, { className: "primary", disabled: busy || !drive.available, onClick: connect },
            busy ? "Connecting…" : drive.available
              ? drive.needsReconnect ? "Reconnect Google Drive" : "Connect Google Drive"
              : "Not configured by server")),
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
}

function OrganizationSettings({
  organization, connectionId, reload, route, preferences, organizationColors = {}
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

  if (route === "organization-settings") return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box" }, h("h3", null, "Organization"),
      h("div", { className: "bees-row" }, h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, organization.name),
        h("div", { className: "bees-muted" }, organization.connected
          ? `Regular organization · ${organization.role}` : "Private organization · this device")))),
    h("section", { className: "bees-box" }, h("h3", null, "Branding"),
      h("p", { className: "bees-muted" },
        "Choose the color used for this organization in the switcher. This preference is saved on this device."),
      h("div", { className: "bees-org-branding" },
        h("span", { className: "bees-org-branding-preview", style: { background: organizationColor }, "aria-hidden": "true" },
          organization.name.trim().charAt(0).toLocaleUpperCase() || "•"),
        h("label", null, "Organization color", h("input", { type: "color", className: "bees-color-input",
          value: organizationColor, onChange: (event) => setOrganizationColor(event.target.value) })),
        customColor ? h(Button, { onClick: resetOrganizationColor }, "Use automatic color") : null)),
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
      h("section", { className: "bees-box" }, h("h3", null, `${organization.name} members`),
        ...(people.memberships.length ? people.memberships.map((member) => h("div", { className: "bees-row", key: member.id },
          h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, member.email || member.userId),
            h("div", { className: "bees-muted" }, member.status)),
          member.role === "owner"
            ? h("span", { className: "bees-badge" }, member.role)
            : h("select", {
                className: "bees-select",
                value: member.role,
                disabled: updatingMemberId === member.userId,
                "aria-label": `Role for ${member.email || member.userId}`,
                onChange: (event) => void changeMemberRole(member.userId, event.target.value)
              },
              h("option", { value: "member" }, "Member"),
              h("option", { value: "admin" }, "Admin"))))
          : [h(Empty, { key: "empty" }, "No organization members")])),
      h("section", { className: "bees-box" }, h("h3", null, "Invite member"),
        h("form", { className: "bees-form-row", onSubmit: invite },
          h("label", null, "Email", h("input", { className: "bees-input", name: "email", type: "email", required: true })),
          h("label", null, "Role", h("select", { className: "bees-select", name: "role" }, h("option", { value: "member" }, "Member"), h("option", { value: "admin" }, "Admin"))),
          h("button", { className: "bees-btn primary", disabled: inviting }, inviting ? "Sending…" : "Send invitation")),
        ...(people.invitations.length ? people.invitations.map((invitation) => h("div", { className: "bees-row", key: invitation.id },
          h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, invitation.email),
            h("div", { className: "bees-muted" }, invitation.expiresAt ? `Pending · expires ${new Date(invitation.expiresAt).toLocaleDateString()}` : "Pending")),
          h("select", {
            className: "bees-select",
            value: invitation.role,
            disabled: updatingInvitationId === invitation.id,
            "aria-label": `Role for invitation ${invitation.email}`,
            onChange: (event) => void changeInvitationRole(invitation.id, event.target.value)
          },
          h("option", { value: "member" }, "Member"),
          h("option", { value: "admin" }, "Admin"))))
          : [h(Empty, { key: "empty" }, "No pending organization invitations")])),
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

function TeamSettings({ team, organization, connectionId, openOrganization }) {
  const [people, setPeople] = useState(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let active = true;
    setPeople(null);
    setError("");
    if (team && organization?.connected && team.role === "admin") {
      collaboration("team_people", { teamId: team.id, connectionId })
        .then((value) => active && setPeople(value))
        .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)));
    }
    return () => { active = false; };
  }, [team?.id, connectionId]);
  if (!team) return h(Empty, null, "Choose a team");
  const deleteTeam = async () => {
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
  const dangerZone = ["owner", "admin"].includes(organization?.role) ? h("section", {
    className: "bees-box bees-danger-zone"
  },
  h("h3", null, "Delete team"),
  h("p", { className: "bees-muted" },
    "Permanently deletes this team, its workspaces, and its Bees data. Files in folders outside Bees stay on disk."),
  h(Button, { className: "danger", disabled: deleting, onClick: deleteTeam },
    deleting ? "Deleting…" : "Delete team")) : null;
  const failure = error ? h("div", { className: "bees-error", role: "alert" }, error) : null;
  if (!organization?.connected) return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box" }, h("h3", null, team.name),
      h("p", { className: "bees-muted" }, "This team belongs to a Private organization on this device.")),
    dangerZone, failure);
  if (team.role !== "admin") return h("section", { className: "bees-box" }, h("h3", null, team.name),
    h("p", { className: "bees-muted" }, "Only team administrators can add organization members to this team."));
  if (!people) return h("div", { className: "bees-stack" },
    h(Empty, null, error || "Loading team members…"), dangerZone);
  const [adding, add] = useSubmit(async (event) => {
    const form = new FormData(event.currentTarget);
    try { setPeople(await collaboration("add_team_member", { teamId: team.id, connectionId,
      userId: String(form.get("userId") ?? ""), role: String(form.get("role") ?? "member") })); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  });
  return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box" }, h("h3", null, `${team.name} members`),
      ...people.members.map((member) => h("div", { className: "bees-row", key: member.id },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, member.email || member.userId),
          h("div", { className: "bees-muted" }, "Active organization member")), h("span", { className: "bees-badge" }, member.role)))),
    h("section", { className: "bees-box" }, h("h3", null, "Add organization member"),
      h("p", { className: "bees-muted" }, "Team membership starts immediately; there is no invitation to accept."),
      people.candidates.length ? h("form", { className: "bees-form-row", onSubmit: add },
        h("label", null, "Organization member", h("select", { className: "bees-select", name: "userId" },
          ...people.candidates.map((candidate) => h("option", { value: candidate.userId, key: candidate.userId }, candidate.email || candidate.userId)))),
        h("label", null, "Role", h("select", { className: "bees-select", name: "role" }, h("option", { value: "member" }, "Member"), h("option", { value: "admin" }, "Admin"))),
        h("button", { className: "bees-btn primary", disabled: adding }, adding ? "Adding…" : "Add member")) : h(Empty, null, "Every active organization member is already on this team")),
    dangerZone,
    failure);
}

const GLOBAL_SETTINGS = [
  ["personal-ai", "AI connections"],
  ["appearance", "Appearance"],
  ["system-instructions", "System instructions"],
  ["organizations", "Organizations"],
  ["connections", "Connections"]
];

const ORGANIZATION_SETTINGS = [
  ["organization-settings", "General"],
  ["organization-members", "Members & invitations", ["owner", "admin"]],
  ["organization-authentication", "Authentication", ["owner"]]
];

function SettingsLayout({ route, navigate, organization, children }) {
  return h("div", { className: "bees-settings-layout" },
    h("aside", { className: "bees-settings-menu" },
      h("div", { className: "bees-settings-menu-label" }, "Global"),
      ...GLOBAL_SETTINGS.map(([id, label]) => h("button", { type: "button", key: id,
        className: route === id ? "active" : "", "aria-current": route === id ? "page" : null,
        onClick: () => navigate(id) }, label)),
      organization ? h(React.Fragment, null,
        h("hr", { className: "bees-settings-divider" }),
        h("div", { className: "bees-settings-menu-label", title: organization.name }, organization.name),
        ...ORGANIZATION_SETTINGS.filter(([, , roles]) => !roles || organization.connected && roles.includes(organization.role))
          .map(([id, label]) => h("button", { type: "button", key: id,
          className: route === id ? "active" : "", "aria-current": route === id ? "page" : null,
          onClick: () => navigate(id) }, label))) : null),
    h("section", { className: "bees-settings-content" }, children));
}

export function SettingsPage({
  ctx, data, route, teamId, organizationId, connectionId, modelSettings, preferences, reload,
  preference = {}, openOrganization, navigate = () => undefined
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
  if (route === "team-settings") return h(TeamSettings, {
    team, organization, connectionId, openOrganization
  });
  const content = route === "personal-ai"
    ? h(AiSettings, { ctx, modelSettings, preferences, systemDefault: data.systemDefaultModel, reload })
    : route === "system-instructions"
      ? h(SystemInstructionsSettings, { preferences, instructions: preference.systemInstructions ?? "" })
    : route === "appearance" ? h(AppearanceSettings, { ctx, preferences })
    : route === "organizations" ? h(OrganizationsSettings)
    : route === "connections" ? h(ConnectionsSettings)
    : ORGANIZATION_SETTINGS.some(([id]) => id === route)
      ? h(OrganizationSettings, {
        organization, connectionId, reload, route, preferences,
        organizationColors: preference.organizationColors ?? {}
      })
      : h(Empty, null, "Choose a settings section");
  return h(SettingsLayout, { route, navigate, organization }, content);
}
