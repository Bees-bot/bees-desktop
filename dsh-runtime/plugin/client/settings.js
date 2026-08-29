import {
  CustomAiSettings, ExternalLocalAiSettings, FreeAiSettings, h, LocalAiSettings,
  React, SubscriptionSettings, useEffect, useState
} from "./runtime.js";
import {
  ask, Button, collaboration, confirmAction, Empty, openExternal, request
} from "./shared.js";
import { SystemDefaultSettings } from "./agents.js";

function AiSettings({ ctx, modelSettings, preferences, systemDefault, reload }) {
  return h("div", { className: "bees-stack" },
    h(SystemDefaultSettings, { ctx, systemDefault, reload }),
    h(SubscriptionSettings, { modelSettings, preferences, systemDefault, ask, openExternal, Button }),
    h(FreeAiSettings, { ctx, modelSettings, preferences, systemDefault, ask, confirmAction, openExternal, Button }),
    h(LocalAiSettings, { modelSettings, preferences, systemDefault, ask, confirmAction, Button }),
    h(ExternalLocalAiSettings, { modelSettings, preferences, systemDefault, ask, Button }),
    h(CustomAiSettings, { ctx, modelSettings, preferences, systemDefault, ask, confirmAction, openExternal, Button }));
}

function AppearanceSettings({ ctx }) {
  const theme = ctx.get("theme");
  const [snapshot, setSnapshot] = useState(() => theme.getTheme());
  useEffect(() => ctx.on("theme/change", setSnapshot), [ctx]);
  return h("section", { className: "bees-box" }, h("h3", null, "Appearance"),
    h("p", { className: "bees-muted" }, "This preference applies across organizations and teams on this device."),
    h("div", { className: "bees-segmented" }, ...["system", "light", "dark"].map((id) =>
      h(Button, { key: id, className: snapshot.preference === id ? "active" : "", "aria-pressed": snapshot.preference === id,
        onClick: () => { theme.setTheme(id); setSnapshot(theme.getTheme()); } }, id[0].toUpperCase() + id.slice(1)))));
}

function AccountSettings({ reload }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("sign_in");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try { setData(await collaboration()); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  useEffect(() => { void refresh(); }, []);
  const browserAuth = async (action, values) => {
    setBusy(true);
    try {
      const { url } = await collaboration(action, values);
      await openExternal(url);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        const next = await collaboration();
        if (next.account) {
          setData(next); setError(""); await reload(); return;
        }
      }
      throw new Error("Sign in was not completed");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const auth = async (event) => {
    event.preventDefault(); setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      setData(await collaboration(mode, {
        name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? "")
      }));
      setError(""); await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  if (!data) return h(Empty, null, error || "Loading account…");
  if (!data.account) return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box" }, h("h3", null, "Account"),
      h("p", { className: "bees-muted" }, "Sign in to see organization invitations and manage connected organizations."),
      data.auth?.socialProviders?.length ? h("div", { className: "bees-form-row" },
        ...data.auth.socialProviders.map((provider) => h(Button, {
          key: provider, disabled: busy,
          onClick: () => browserAuth("social_start", { provider })
        }, `Continue with ${{ google: "Google", github: "GitHub" }[provider] ?? provider}`))) : null,
      data.auth?.ssoEnabled ? h(Button, { disabled: busy, onClick: async () => {
        const email = await ask("Work email for company SSO", "");
        if (email) await browserAuth("sso_start", { email });
      } }, "Continue with company SSO") : null,
      h("hr"),
      h("h3", null, mode === "sign_in" ? "Sign in with email" : "Create account with email"),
      h("div", { className: "bees-segmented" },
        h(Button, { className: mode === "sign_in" ? "active" : "", onClick: () => setMode("sign_in") }, "Sign in"),
        h(Button, { className: mode === "sign_up" ? "active" : "", onClick: () => setMode("sign_up") }, "Create account")),
      h("form", { className: "bees-form", onSubmit: auth },
        mode === "sign_up" ? h("label", null, "Name", h("input", { className: "bees-input", name: "name", required: true })) : null,
        h("label", null, "Email", h("input", { className: "bees-input", name: "email", type: "email", required: true })),
        h("label", null, "Password", h("input", { className: "bees-input", name: "password", type: "password", minLength: 8, required: true })),
        h(Button, { type: "submit", className: "primary", disabled: busy }, busy ? "Connecting…" : mode === "sign_in" ? "Sign in" : "Create account"))),
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
  const run = async (action, values = {}) => {
    setBusy(true);
    try { setData(await collaboration(action, values)); setError(""); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box" }, h("h3", null, data.account.name || data.account.email),
      h("p", { className: "bees-muted" }, data.account.email),
      h("div", { className: "bees-form-row" }, h(Button, { disabled: busy, onClick: () => run("sync") }, "Refresh"),
        h(Button, { className: "danger", disabled: busy, onClick: () => run("sign_out") }, "Sign out"))),
    h("section", { className: "bees-box" }, h("h3", null, "Organizations"),
      ...(data.organizations.length ? data.organizations.map((organization) => h("div", { className: "bees-row", key: organization.id },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, organization.name), h("div", { className: "bees-muted" }, organization.role))))
        : [h(Empty, { key: "empty" }, "No connected organizations yet")])),
    h("section", { className: "bees-box" }, h("h3", null, "Pending invitations"),
      ...(data.invitations.length ? data.invitations.map((invitation) => h("div", { className: "bees-row", key: invitation.id },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, invitation.organizationName),
          h("div", { className: "bees-muted" }, `${invitation.role} · expires ${new Date(invitation.expiresAt).toLocaleDateString()}`)),
        h(Button, { className: "primary", disabled: busy, onClick: () => run("accept_invitation", { invitationId: invitation.id }) }, "Accept")))
        : [h(Empty, { key: "empty" }, "No pending organization invitations")])),
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
        "Read-only access exports Google Docs, Sheets, and Slides pointer files into a local QMD cache. Documents and the index are not uploaded to Bees."),
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
            busy ? "Connecting…" : drive.available ? "Connect Google Drive" : "Not configured by server")),
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
}

function OrganizationSettings({ organization }) {
  const [people, setPeople] = useState(null);
  const [sso, setSso] = useState(null);
  const [protocol, setProtocol] = useState("oidc");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setPeople(null);
    setError("");
    if (organization?.connected && ["owner", "admin"].includes(organization.role)) {
      Promise.all([
        collaboration("organization_people", { organizationId: organization.id }),
        collaboration("organization_sso", { organizationId: organization.id })
      ]).then(([nextPeople, nextSso]) => {
        if (active) { setPeople(nextPeople); setSso(nextSso); }
      })
        .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)));
    }
    return () => { active = false; };
  }, [organization?.id]);
  if (!organization) return h(Empty, null, "Choose an organization");
  if (!organization.connected) return h("section", { className: "bees-box" }, h("h3", null, organization.name),
    h("p", { className: "bees-muted" }, "This organization is local to this device. Connect an account to invite members."));
  if (!["owner", "admin"].includes(organization.role)) return h("section", { className: "bees-box" }, h("h3", null, organization.name),
    h("p", { className: "bees-muted" }, `Your role is ${organization.role}. Only organization administrators can invite members.`));
  const invite = async (event) => {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    try { setPeople(await collaboration("invite_organization_member", { organizationId: organization.id,
      email: String(form.get("email") ?? ""), role: String(form.get("role") ?? "member") })); setError(""); formElement.reset(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const registerSso = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      setSso(await collaboration("register_organization_sso", {
        organizationId: organization.id,
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
  };
  const removeSso = async (providerId) => {
    if (!await confirmAction(`Remove enterprise sign-in provider “${providerId}”?`)) return;
    try {
      setSso(await collaboration("remove_organization_sso", { organizationId: organization.id, providerId }));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const verification = async (providerId, action) => {
    try {
      setSso(await collaboration(
        action === "verify" ? "verify_organization_sso" : "request_organization_sso_verification",
        { organizationId: organization.id, providerId }
      ));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  if (!people) return h(Empty, null, error || "Loading organization members…");
  return h("div", { className: "bees-stack" },
    h("section", { className: "bees-box" }, h("h3", null, `${organization.name} members`),
      ...people.memberships.map((member) => h("div", { className: "bees-row", key: member.id },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, member.email || member.userId),
          h("div", { className: "bees-muted" }, member.status)), h("span", { className: "bees-badge" }, member.role)))),
    h("section", { className: "bees-box" }, h("h3", null, "Invite organization member"),
      h("form", { className: "bees-form-row", onSubmit: invite },
        h("label", null, "Email", h("input", { className: "bees-input", name: "email", type: "email", required: true })),
        h("label", null, "Role", h("select", { className: "bees-select", name: "role" }, h("option", { value: "member" }, "Member"), h("option", { value: "admin" }, "Admin"))),
        h("button", { className: "bees-btn primary" }, "Send invitation")),
      ...people.invitations.map((invitation) => h("div", { className: "bees-row", key: invitation.id },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, invitation.email),
          h("div", { className: "bees-muted" }, `Pending · expires ${new Date(invitation.expiresAt).toLocaleDateString()}`)),
        h("span", { className: "bees-badge" }, invitation.role)))),
    organization.role === "owner" ? h("section", { className: "bees-box" }, h("h3", null, "Enterprise authentication"),
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
        h(Button, { type: "submit", className: "primary" }, "Add identity provider")))
      : h("section", { className: "bees-box" }, h("h3", null, "Enterprise authentication"),
          h("p", { className: "bees-muted" }, "Only the organization owner can configure company SSO.")),
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
}

function TeamSettings({ team, organization }) {
  const [people, setPeople] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setPeople(null);
    setError("");
    if (team && organization?.connected && team.role === "admin") {
      collaboration("team_people", { teamId: team.id })
        .then((value) => active && setPeople(value))
        .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)));
    }
    return () => { active = false; };
  }, [team?.id]);
  if (!team) return h(Empty, null, "Choose a team");
  if (!organization?.connected) return h("section", { className: "bees-box" }, h("h3", null, team.name),
    h("p", { className: "bees-muted" }, "This team is local to this device."));
  if (team.role !== "admin") return h("section", { className: "bees-box" }, h("h3", null, team.name),
    h("p", { className: "bees-muted" }, "Only team administrators can add organization members to this team."));
  if (!people) return h(Empty, null, error || "Loading team members…");
  const add = async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { setPeople(await collaboration("add_team_member", { teamId: team.id,
      userId: String(form.get("userId") ?? ""), role: String(form.get("role") ?? "member") })); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
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
        h("button", { className: "bees-btn primary" }, "Add member")) : h(Empty, null, "Every active organization member is already on this team")),
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
}

export function SettingsPage({ ctx, data, route, teamId, organizationId, modelSettings, preferences, reload }) {
  const team = data.teams.find(({ id }) => id === teamId);
  const organization = data.organizations.find(({ id }) => id === organizationId);
  if (route === "personal-ai") return h(AiSettings, { ctx, modelSettings, preferences, systemDefault: data.systemDefaultModel, reload });
  if (route === "appearance") return h(AppearanceSettings, { ctx });
  if (route === "organizations") return h(AccountSettings, { reload });
  if (route === "connections") return h(ConnectionsSettings);
  if (route === "team-settings") return h(TeamSettings, { team, organization });
  if (route === "organization-settings") return h(OrganizationSettings, { organization });
  return h("div", { className: "bees-grid" }, h("section", { className: "bees-box" }, h("h3", null, "Organization role"), h("p", null, organization?.role ?? "None")), h("section", { className: "bees-box" }, h("h3", null, "Team role"), h("p", null, team?.role ?? "None")), h("section", { className: "bees-box" }, h("h3", null, "Runtime enforcement"), h("p", { className: "bees-muted" }, "Membership and role checks protect domain commands. Bees approval protects publication and protected tools.")));
}
