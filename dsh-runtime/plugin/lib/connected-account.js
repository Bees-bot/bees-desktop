import { transaction } from "./product-database.js";

const defaultServer = "https://app.bees.bot";
const sessionCredential = "BEES_ACCOUNT_SESSION";

function message(body, status) {
  return body?.error?.message ?? body?.message ?? `Request failed (${status})`;
}

export class ConnectedAccount {
  constructor(database, credentials, baseUrl = process.env.BEES_API_URL ?? defaultServer) {
    this.database = database;
    this.credentials = credentials;
    this.baseUrl = String(baseUrl).trim().replace(/\/+$/, "") || defaultServer;
  }

  account() {
    const row = this.database.prepare(
      "SELECT user_id AS userId, email, name FROM bees_account WHERE slot = 1"
    ).get();
    return row ?? null;
  }

  publicAccount() {
    const row = this.account();
    return row ? { userId: row.userId, email: row.email, name: row.name } : null;
  }

  async request(path, { method = "GET", body, organizationId, authenticated = true } = {}) {
    const account = this.account();
    if (authenticated && !account) throw new Error("Sign in to manage connected organizations");
    const token = account ? await this.credentials.resolve(sessionCredential) : null;
    if (authenticated && !token?.value) throw new Error("Your Bees session expired; sign in again");
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(token?.value ? { authorization: `Bearer ${token.value}` } : {}),
          ...(organizationId ? { "x-organization-id": organizationId } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000)
      });
    } catch {
      throw new Error("Can't reach the Bees server");
    }
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(message(value, response.status));
    return value;
  }

  async authenticate(path, payload) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000)
      });
    } catch {
      throw new Error("Can't reach the Bees server");
    }
    const value = await response.json().catch(() => ({}));
    if (!response.ok || !value.user?.id || !value.user?.email) throw new Error(message(value, response.status));
    const token = response.headers.get("set-auth-token");
    if (!token) throw new Error("Server did not return a session token");
    await this.credentials.set(sessionCredential, token);
    this.database.prepare(`
      INSERT INTO bees_account(slot, user_id, email, name, token)
      VALUES (1, ?, ?, ?, '')
      ON CONFLICT(slot) DO UPDATE SET user_id = excluded.user_id, email = excluded.email,
        name = excluded.name, token = ''
    `).run(value.user.id, value.user.email, value.user.name ?? value.user.email);
    return this.summary();
  }

  signIn(email, password) {
    return this.authenticate("/api/auth/sign-in/email", { email, password });
  }

  signUp(name, email, password) {
    return this.authenticate("/api/auth/sign-up/email", { name, email, password });
  }

  async signOut() {
    const account = this.account();
    await this.credentials.unset(sessionCredential);
    if (!account) return;
    this.database.prepare(`
      UPDATE organization_memberships SET status = 'suspended'
      WHERE user_id = (SELECT id FROM users ORDER BY created_at LIMIT 1)
        AND organization_id IN (
          SELECT organization_id FROM bees_connected_organizations WHERE account_user_id = ?
        )
    `).run(account.userId);
    this.database.prepare("DELETE FROM bees_account WHERE slot = 1").run();
  }

  async sync() {
    const account = this.account();
    if (!account) return [];
    const { organizations = [] } = await this.request("/api/organizations");
    // Read the whole remote picture first: a half-applied sync leaves memberships no later pass repairs.
    const remote = await Promise.all(organizations.map(async (organization) => ({
      organization,
      teams: await this.request("/api/teams", { organizationId: organization.id })
        .then(({ teams = [] }) => Promise.all(teams.map(async (team) => ({
          team,
          members: await this.request(`/api/teams/${team.id}/members`, { organizationId: organization.id })
            .then(({ members }) => members).catch(() => [])
        }))))
    })));
    const localUser = this.database.prepare("SELECT id FROM users ORDER BY created_at LIMIT 1").get();
    const at = new Date().toISOString();
    transaction(this.database, () => {
      for (const { organization, teams } of remote) {
        this.database.prepare(`
          INSERT INTO organizations(id, name, personal, created_by, status, created_at, updated_at)
          VALUES (?, ?, 0, ?, 'active', ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = 'active', updated_at = excluded.updated_at
        `).run(organization.id, organization.name, localUser.id, at, at);
        this.database.prepare(`
          INSERT INTO organization_memberships(user_id, organization_id, role, status, created_at)
          VALUES (?, ?, ?, 'active', ?)
          ON CONFLICT(user_id, organization_id) DO UPDATE SET role = excluded.role, status = 'active'
        `).run(localUser.id, organization.id, organization.role ?? "member", at);
        this.database.prepare(`
          INSERT INTO bees_connected_organizations(organization_id, account_user_id)
          VALUES (?, ?) ON CONFLICT(organization_id) DO UPDATE SET account_user_id = excluded.account_user_id
        `).run(organization.id, account.userId);
        for (const { team, members } of teams) {
          this.database.prepare(`
            INSERT INTO teams(id, organization_id, name, personal, created_by, status, created_at, updated_at)
            VALUES (?, ?, ?, 0, ?, 'active', ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = 'active', updated_at = excluded.updated_at
          `).run(team.id, organization.id, team.name, localUser.id, at, at);
          const own = members.find(({ userId }) => userId === account.userId);
          if (own) this.database.prepare(`
            INSERT INTO team_memberships(user_id, team_id, role, status, created_at)
            VALUES (?, ?, ?, 'active', ?)
            ON CONFLICT(user_id, team_id) DO UPDATE SET role = excluded.role, status = 'active'
          `).run(localUser.id, team.id, own.role, at);
        }
      }
      this.database.prepare(`
        UPDATE organization_memberships SET status = 'suspended'
        WHERE user_id = ? AND organization_id IN (
          SELECT organization_id FROM bees_connected_organizations WHERE account_user_id = ?
        ) AND organization_id NOT IN (SELECT value FROM json_each(?))
      `).run(localUser.id, account.userId, JSON.stringify(organizations.map(({ id }) => id)));
    });
    return organizations;
  }

  async summary() {
    const account = this.publicAccount();
    if (!account) return { account: null, organizations: [], invitations: [] };
    const organizations = await this.sync();
    const { invitations = [] } = await this.request("/api/me/organization-invitations");
    return { account, organizations, invitations };
  }

  async acceptInvitation(invitationId) {
    await this.request(`/api/me/organization-invitations/${encodeURIComponent(invitationId)}/accept`, {
      method: "POST"
    });
    return this.summary();
  }

  async organizationPeople(organizationId) {
    const [{ memberships = [] }, { invitations = [] }] = await Promise.all([
      this.request(`/api/organizations/${encodeURIComponent(organizationId)}/members`),
      this.request(`/api/organizations/${encodeURIComponent(organizationId)}/invitations`)
    ]);
    return { memberships, invitations };
  }

  async inviteOrganizationMember(organizationId, email, role) {
    await this.request(`/api/organizations/${encodeURIComponent(organizationId)}/invitations`, {
      method: "POST",
      body: { email, role }
    });
    return this.organizationPeople(organizationId);
  }

  async teamPeople(teamId) {
    const team = this.database.prepare(
      "SELECT organization_id AS organizationId FROM teams WHERE id = ?"
    ).get(teamId);
    if (!team) throw new Error("Team not found");
    const [{ members = [] }, { candidates = [] }] = await Promise.all([
      this.request(`/api/teams/${encodeURIComponent(teamId)}/members`, {
        organizationId: team.organizationId
      }),
      this.request(`/api/teams/${encodeURIComponent(teamId)}/candidates`, {
        organizationId: team.organizationId
      })
    ]);
    return { members, candidates };
  }

  async addTeamMember(teamId, userId, role) {
    const team = this.database.prepare(
      "SELECT organization_id AS organizationId FROM teams WHERE id = ?"
    ).get(teamId);
    if (!team) throw new Error("Team not found");
    await this.request(`/api/teams/${encodeURIComponent(teamId)}/members`, {
      method: "POST",
      organizationId: team.organizationId,
      body: { userId, role }
    });
    return this.teamPeople(teamId);
  }

  async command(input) {
    switch (input.action) {
      case "sign_in": return this.signIn(input.email, input.password);
      case "sign_up": return this.signUp(input.name, input.email, input.password);
      case "sign_out": await this.signOut(); return this.summary();
      case "sync": return this.summary();
      case "accept_invitation": return this.acceptInvitation(input.invitationId);
      case "organization_people": return this.organizationPeople(input.organizationId);
      case "invite_organization_member":
        return this.inviteOrganizationMember(input.organizationId, input.email, input.role);
      case "team_people": return this.teamPeople(input.teamId);
      case "add_team_member": return this.addTeamMember(input.teamId, input.userId, input.role);
      default: throw new Error("Unknown collaboration action");
    }
  }
}
