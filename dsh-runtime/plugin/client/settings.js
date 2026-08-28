import {
  CustomAiSettings, ExternalLocalAiSettings, FreeAiSettings, h, LocalAiSettings,
  SubscriptionSettings, useEffect, useState
} from "./runtime.js";
import {
  ask, Button, collaboration, confirmAction, Empty, openExternal
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
    h("p", { className: "bees-muted" }, "This preference applies across organizations and workspaces on this device."),
    h("div", { className: "bees-segmented" }, ...["system", "light", "dark"].map((id) =>
      h(Button, { key: id, className: snapshot.preference === id ? "active" : "", "aria-pressed": snapshot.preference === id,
        onClick: () => { theme.setTheme(id); setSnapshot(theme.getTheme()); } }, id[0].toUpperCase() + id.slice(1)))));
}

function OrganizationsSettings({ reload }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("sign_in");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try { setData(await collaboration()); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  useEffect(() => { void refresh(); }, []);
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
    h("section", { className: "bees-box" }, h("h3", null, mode === "sign_in" ? "Sign in" : "Create account"),
      h("p", { className: "bees-muted" }, "Sign in to see organization invitations and manage connected organizations."),
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

function OrganizationSettings({ organization }) {
  const [people, setPeople] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setPeople(null);
    setError("");
    if (organization?.connected && ["owner", "admin"].includes(organization.role)) {
      collaboration("organization_people", { organizationId: organization.id })
        .then((value) => active && setPeople(value))
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

export function SettingsPage({ ctx, data, route, workspaceId, teamId, organizationId, modelSettings, preferences, reload }) {
  const workspace = data.workspaces.find(({ id }) => id === workspaceId);
  const team = data.teams.find(({ id }) => id === teamId);
  const organization = data.organizations.find(({ id }) => id === organizationId);
  if (route === "personal-ai") return h(AiSettings, { ctx, modelSettings, preferences, systemDefault: data.systemDefaultModel, reload });
  if (route === "appearance") return h(AppearanceSettings, { ctx });
  if (route === "organizations") return h(OrganizationsSettings, { reload });
  if (route === "connections") return h(Empty, null, "No external tool connections are configured in this Bees profile.");
  if (route === "workspace-settings") return workspace ? h("div", { className: "bees-grid" }, h("section", { className: "bees-box" }, h("h3", null, workspace.name), h("p", { className: "bees-muted" }, `${workspace.authority === "local" ? "Private on this device" : "Connected"} · ${workspace.hosting}`), h("p", { className: "bees-muted" }, workspace.dshWorkspaceId ? "Runtime ready" : "Runtime initializing"))) : h(Empty, null, "Choose a workspace to view workspace settings");
  if (route === "team-settings") return h(TeamSettings, { team, organization });
  if (route === "organization-settings") return h(OrganizationSettings, { organization });
  return h("div", { className: "bees-grid" }, h("section", { className: "bees-box" }, h("h3", null, "Organization role"), h("p", null, organization?.role ?? "None")), h("section", { className: "bees-box" }, h("h3", null, "Team role"), h("p", null, team?.role ?? "None")), h("section", { className: "bees-box" }, h("h3", null, "Runtime enforcement"), h("p", { className: "bees-muted" }, "Membership and role checks protect domain commands. Bees approval protects publication and protected tools.")));
}


