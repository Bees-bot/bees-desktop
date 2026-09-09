import { randomBytes } from "node:crypto";
import {
  currentIdentity, insertDefaultWorkspace, stableUuid, transaction
} from "./product-database.js";
import { syncTeamRecords } from "./team-sync.js";

const defaultServer = "https://app.bees.bot";
const legacySessionCredential = "BEES_ACCOUNT_SESSION";
const sessionCredential = (userId) =>
  `${legacySessionCredential}_${Buffer.from(String(userId), "utf8").toString("hex")}`;
const connectedSeedAt = "1970-01-01T00:00:00.000Z";
/** Consecutive background 401s before the session is really gone, not just interrupted. */
const SIGN_OUT_AFTER_REJECTED_SYNCS = 3;

function message(body, status) {
  return body?.error?.message ?? body?.message ?? `Request failed (${status})`;
}

function responseError(body, status) {
  return Object.assign(new Error(message(body, status)), { status });
}

export class ConnectedAccount {
  constructor(database, credentials, baseUrl = process.env.BEES_ACCOUNT_API_URL ?? defaultServer, logger = console) {
    this.database = database;
    this.credentials = credentials;
    const configured = String(baseUrl).trim();
    this.baseUrl = (configured || defaultServer).replace(/\/+$/, "");
    this.logger = logger;
    this.syncQueue = Promise.resolve();
    this.closed = false;
    this.rejectedSyncs = new Map();
    if (typeof this.credentials.unset === "function") void Promise.resolve(
      this.credentials.unset(legacySessionCredential)
    ).catch(() => undefined);
  }

  accounts() {
    return this.database.prepare(`
      SELECT user_id AS userId, email, name, enabled,
             created_at AS createdAt, updated_at AS updatedAt
      FROM bees_accounts ORDER BY created_at, user_id
    `).all().map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
  }

  account(userId = "") {
    const row = userId
      ? this.database.prepare(`
          SELECT user_id AS userId, email, name, enabled,
                 created_at AS createdAt, updated_at AS updatedAt
          FROM bees_accounts WHERE user_id = ?
        `).get(userId)
      : this.accounts().find(({ enabled }) => enabled) ?? null;
    return row ? { ...row, enabled: Boolean(row.enabled) } : null;
  }

  publicAccount() {
    const row = this.account();
    return row ? { userId: row.userId, email: row.email, name: row.name } : null;
  }

  connections() {
    return this.database.prepare(`
      SELECT c.id, c.organization_id AS organizationId, c.account_user_id AS accountUserId,
             c.role, o.name AS organizationName, a.email, a.name AS accountName
      FROM bees_connections c JOIN organizations o ON o.id = c.organization_id
      JOIN bees_accounts a ON a.user_id = c.account_user_id
      WHERE a.enabled = 1
      ORDER BY o.name, a.email
    `).all();
  }

  accountForConnection(connectionId) {
    const row = this.database.prepare(`
      SELECT c.account_user_id AS accountUserId FROM bees_connections c
      JOIN bees_accounts a ON a.user_id = c.account_user_id
      WHERE c.id = ? AND a.enabled = 1
    `).get(connectionId);
    if (!row) throw new Error("Organization connection not found");
    return row.accountUserId;
  }

  async tokenFor(userId) {
    const token = await this.credentials.resolve(sessionCredential(userId));
    return token?.value ?? null;
  }

  async request(path, {
    method = "GET", body, organizationId, accountUserId = "", connectionId = "", authenticated = true
  } = {}) {
    const userId = accountUserId || (connectionId ? this.accountForConnection(connectionId) : this.account()?.userId);
    const account = userId ? this.account(userId) : null;
    if (authenticated && !account) throw new Error("Sign in to manage connected organizations");
    if (authenticated && !account.enabled) throw new Error(`Turn on ${account.email} to use this account`);
    const token = account ? await this.tokenFor(account.userId) : null;
    if (authenticated && !token) throw new Error(`The session for ${account?.email ?? "this account"} expired; sign in again`);
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(organizationId ? { "x-organization-id": organizationId } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000)
      });
    } catch {
      throw new Error("Can't reach the Bees server");
    }
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw responseError(value, response.status);
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
    const token = response.headers.get("set-auth-token") ?? value.token;
    if (!token) throw new Error("Server did not return a session token");
    return this.resumeSession(token, value.user);
  }

  async resumeSession(token, knownUser = null) {
    let value = { user: knownUser };
    if (!knownUser) {
      let response;
      try {
        response = await fetch(`${this.baseUrl}/api/me`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20_000)
        });
      } catch {
        throw new Error("Can't reach the Bees server");
      }
      value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(message(value, response.status));
    }
    if (!value.user?.id || !value.user?.email) throw new Error("The sign-in response was incomplete");
    const at = new Date().toISOString();
    await this.credentials.set(sessionCredential(value.user.id), token);
    this.database.prepare(`
      INSERT INTO bees_accounts(user_id, email, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, name = excluded.name,
        updated_at = excluded.updated_at, enabled = 1
    `).run(value.user.id, value.user.email, value.user.name ?? value.user.email, at, at);
    return this.summary();
  }

  async authConfig() {
    try {
      const config = await this.request("/api/config", { authenticated: false });
      return {
        ...config,
        socialProviders: [...new Set(["google", "github", ...(config.socialProviders ?? [])])],
        ssoEnabled: true
      };
    } catch {
      return {
        socialProviders: ["google", "github"], ssoEnabled: true,
        googleDriveDesktopClientId: ""
      };
    }
  }

  async startBrowserSignIn(kind, value, callbackPort) {
    const port = Number(callbackPort);
    if (!Number.isInteger(port) || port < 1) throw new Error("The local sign-in callback is unavailable");
    const config = await this.authConfig();
    if (kind === "social" && !config.socialProviders?.includes(value)) {
      throw new Error("That sign-in provider is not configured");
    }
    if (kind === "sso" && !config.ssoEnabled) throw new Error("Company SSO is not configured");
    const state = randomBytes(24).toString("hex");
    this.database.prepare("DELETE FROM bees_sign_in_attempts WHERE expires_at < ?").run(Date.now());
    this.database.prepare("INSERT INTO bees_sign_in_attempts(state, expires_at) VALUES (?, ?)")
      .run(state, Date.now() + 10 * 60_000);
    const callback = `http://127.0.0.1:${port}/bees-social-callback?state=${state}`;
    const path = kind === "sso" ? "/api/auth/desktop/sso/start" : "/api/auth/desktop/start";
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set(kind === "sso" ? "email" : "provider", value);
    url.searchParams.set("redirect", callback);
    return { url: url.toString() };
  }

  async completeBrowserSignIn(params) {
    let state = String(params.get("state") ?? "");
    let token = params.get("token");
    let callbackError = params.get("error");
    // The deployed server used to append `?token=` even though the callback already
    // had `?state=`. Accept that malformed query until every server runs the fixed route.
    const legacy = !token && !callbackError
      ? state.match(/^([0-9a-f]{48})\?(token|error)=(.*)$/s)
      : null;
    if (legacy) {
      state = legacy[1];
      if (legacy[2] === "token") token = legacy[3];
      else callbackError = legacy[3];
    }
    const accepted = this.database.prepare(`
      DELETE FROM bees_sign_in_attempts WHERE state = ? AND expires_at >= ? RETURNING state
    `).get(state, Date.now());
    if (!accepted) throw new Error("This sign-in attempt expired; try again");
    if (callbackError) throw new Error("Sign in was not completed");
    if (!token) throw new Error("The server did not return a sign-in token");
    return this.resumeSession(token);
  }

  signIn(email, password) {
    return this.authenticate("/api/auth/sign-in/email", { email, password });
  }

  signUp(name, email, password) {
    return this.authenticate("/api/auth/sign-up/email", { name, email, password });
  }

  /** A background sync is a poor reason to sign someone out. A revoked token fails every
   *  time and still gets here; one 401 during a deploy or a token rotation should not. */
  async rejectSync(account) {
    const rejections = (this.rejectedSyncs.get(account.userId) ?? 0) + 1;
    if (rejections < SIGN_OUT_AFTER_REJECTED_SYNCS) {
      this.rejectedSyncs.set(account.userId, rejections);
      this.logger.warn?.(`bees: the server refused ${account.email} (${rejections}/${SIGN_OUT_AFTER_REJECTED_SYNCS})`);
      return;
    }
    this.rejectedSyncs.delete(account.userId);
    await this.signOut(account.userId);
  }

  async signOut(userId = this.account()?.userId) {
    const account = userId ? this.account(userId) : null;
    if (!account) return;
    const affected = this.database.prepare(
      "SELECT organization_id AS id FROM bees_connections WHERE account_user_id = ?"
    ).all(account.userId).map(({ id }) => id);
    await this.credentials.unset(sessionCredential(account.userId));
    if (this.accounts().length === 1) await this.credentials.unset(legacySessionCredential);
    this.database.prepare("DELETE FROM bees_accounts WHERE user_id = ?").run(account.userId);
    this.rejectedSyncs.delete(account.userId);
    this.refreshLocalAccess(affected);
  }

  async setAccountEnabled(userId, enabled) {
    const account = this.account(userId);
    if (!account) throw new Error("Account not found");
    const affected = this.database.prepare(
      "SELECT organization_id AS id FROM bees_connections WHERE account_user_id = ?"
    ).all(account.userId).map(({ id }) => id);
    this.database.prepare("UPDATE bees_accounts SET enabled = ?, updated_at = ? WHERE user_id = ?")
      .run(enabled ? 1 : 0, new Date().toISOString(), account.userId);
    this.rejectedSyncs.delete(account.userId);
    this.refreshLocalAccess(affected);
    return this.summary();
  }

  refreshLocalAccess(affectedOrganizationIds = []) {
    const localUser = this.database.prepare("SELECT id FROM users ORDER BY created_at LIMIT 1").get();
    if (!localUser) return;
    const organizationRank = { member: 1, admin: 2, owner: 3 };
    const teamRank = { member: 1, admin: 2 };
    const connections = this.connections();
    for (const organizationId of new Set(connections.map(({ organizationId }) => organizationId))) {
      const role = connections.filter((row) => row.organizationId === organizationId)
        .map(({ role }) => role).sort((a, b) => organizationRank[b] - organizationRank[a])[0];
      this.database.prepare(`
        INSERT INTO organization_memberships(user_id, organization_id, role, status, created_at)
        VALUES (?, ?, ?, 'active', ?)
        ON CONFLICT(user_id, organization_id) DO UPDATE SET role = excluded.role, status = 'active'
      `).run(localUser.id, organizationId, role, new Date().toISOString());
    }
    for (const organizationId of affectedOrganizationIds) if (!connections.some(
      (row) => row.organizationId === organizationId
    )) this.database.prepare(`
      UPDATE organization_memberships SET status = 'suspended'
      WHERE user_id = ? AND organization_id = ? AND EXISTS (
        SELECT 1 FROM organizations WHERE id = ? AND personal = 0
      )
    `).run(localUser.id, organizationId, organizationId);
    const teams = this.database.prepare(`
      SELECT ct.team_id AS teamId, ct.role FROM bees_connection_teams ct
      JOIN bees_connections c ON c.id = ct.connection_id
      JOIN bees_accounts a ON a.user_id = c.account_user_id AND a.enabled = 1
    `).all();
    for (const teamId of new Set(teams.map(({ teamId }) => teamId))) {
      const role = teams.filter((row) => row.teamId === teamId)
        .map(({ role }) => role).sort((a, b) => teamRank[b] - teamRank[a])[0];
      this.database.prepare(`
        INSERT INTO team_memberships(user_id, team_id, role, status, created_at)
        VALUES (?, ?, ?, 'active', ?)
        ON CONFLICT(user_id, team_id) DO UPDATE SET role = excluded.role, status = 'active'
      `).run(localUser.id, teamId, role, new Date().toISOString());
    }
    this.database.prepare(`
      UPDATE team_memberships SET status = 'suspended' WHERE user_id = ?
        AND team_id IN (SELECT t.id FROM teams t JOIN organizations o ON o.id = t.organization_id WHERE o.personal = 0)
        AND team_id NOT IN (
          SELECT ct.team_id FROM bees_connection_teams ct
          JOIN bees_connections c ON c.id = ct.connection_id
          JOIN bees_accounts a ON a.user_id = c.account_user_id AND a.enabled = 1
        )
    `).run(localUser.id);
  }

  async syncAccount(account) {
    const oldOrganizationIds = this.database.prepare(
      "SELECT organization_id AS id FROM bees_connections WHERE account_user_id = ?"
    ).all(account.userId).map(({ id }) => id);
    const { organizations = [] } = await this.request("/api/organizations", { accountUserId: account.userId });
    // Read the whole remote picture first: a half-applied sync leaves memberships no later pass repairs.
    const remote = await Promise.all(organizations.map(async (organization) => {
      const { teams = [] } = await this.request("/api/teams", {
        organizationId: organization.id, accountUserId: account.userId
      });
      return { organization, teams: await Promise.all(teams.map(async (team) => ({
        team,
        members: await this.request(`/api/teams/${team.id}/members`, {
          organizationId: organization.id, accountUserId: account.userId
        })
          .then(({ members }) => members).catch(() => [])
      }))) };
    }));
    const localUser = this.database.prepare("SELECT id FROM users ORDER BY created_at LIMIT 1").get();
    const at = new Date().toISOString();
    transaction(this.database, () => {
      for (const { organization, teams } of remote) {
        this.database.prepare(`
          INSERT INTO organizations(id, name, personal, created_by, status, created_at, updated_at)
          VALUES (?, ?, 0, ?, 'active', ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = 'active', updated_at = excluded.updated_at
        `).run(organization.id, organization.name, localUser.id, at, at);
        const connectionId = stableUuid(`bees-connection:${organization.id}:${account.userId}`);
        this.database.prepare(`
          INSERT INTO bees_connections(id, organization_id, account_user_id, role, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, account_user_id) DO UPDATE SET
            role = excluded.role, updated_at = excluded.updated_at
        `).run(connectionId, organization.id, account.userId, organization.role ?? "member", at, at);
        this.database.prepare("DELETE FROM bees_connection_teams WHERE connection_id = ?").run(connectionId);
        for (const { team, members } of teams) {
          this.database.prepare(`
            INSERT INTO teams(id, organization_id, name, personal, created_by, status, created_at, updated_at)
            VALUES (?, ?, ?, 0, ?, 'active', ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = 'active', updated_at = excluded.updated_at
          `).run(team.id, organization.id, team.name, localUser.id, at, at);
          const own = members.find(({ userId }) => userId === account.userId);
          const role = own?.role ?? (["owner", "admin"].includes(organization.role) ? "admin" : "member");
          this.database.prepare(`
            INSERT INTO bees_connection_teams(connection_id, team_id, role, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(connectionId, team.id, role, at, at);
          if (!this.database.prepare(
            "SELECT 1 FROM workspaces WHERE team_id = ? AND status = 'active' LIMIT 1"
          ).get(team.id)) insertDefaultWorkspace(this.database, team.id, {
            id: stableUuid(`connected-workspace:${team.id}`), authority: "connected", at: connectedSeedAt
          });
          else this.database.prepare(
            "UPDATE workspaces SET authority = 'connected' WHERE team_id = ? AND status = 'active'"
          ).run(team.id);
        }
      }
      this.database.prepare(`
        DELETE FROM teams WHERE personal = 0
          AND organization_id IN (SELECT value FROM json_each(?))
          AND NOT EXISTS (
            SELECT 1 FROM bees_connection_teams ct WHERE ct.team_id = teams.id
          )
      `).run(JSON.stringify(organizations.map(({ id }) => id)));
      this.database.prepare(`
        DELETE FROM bees_connections WHERE account_user_id = ?
          AND organization_id NOT IN (SELECT value FROM json_each(?))
      `).run(account.userId, JSON.stringify(organizations.map(({ id }) => id)));
    });
    this.refreshLocalAccess([...oldOrganizationIds, ...organizations.map(({ id }) => id)]);
    return organizations;
  }

  async sync() {
    const results = [];
    for (const account of this.accounts().filter(({ enabled }) => enabled)) {
      try {
        results.push(...await this.syncAccount(account));
        this.rejectedSyncs.delete(account.userId);
      }
      catch (error) {
        if (error?.status === 401) await this.rejectSync(account);
        else this.logger.warn?.(`bees: account sync unavailable for ${account.email}: ${error instanceof Error ? error.message : error}`);
      }
    }
    await this.syncCoordination();
    return results;
  }

  syncCoordination(connectionIds = null) {
    if (this.closed) return Promise.resolve([]);
    const connections = this.connections().filter(({ id }) => !connectionIds || connectionIds.includes(id));
    const pending = this.syncQueue.then(async () => {
      const results = [];
      for (const connection of connections) {
        try {
          const request = (path, options = {}) => this.request(path, {
            ...options, accountUserId: connection.accountUserId
          });
          results.push(await syncTeamRecords(
            this.database, request, connection.organizationId, connection.id
          ));
        } catch (error) {
          this.logger.warn?.(`bees: team sync unavailable for ${connection.email}: ${error instanceof Error ? error.message : error}`);
        }
      }
      return results;
    });
    this.syncQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async close() {
    this.closed = true;
    await this.syncQueue;
  }

  claimScope(teamId, accountUserId = "") {
    if (!accountUserId) return this.database.prepare(`
      SELECT t.organization_id AS organizationId, NULL AS connectionId
      FROM teams t JOIN organizations o ON o.id = t.organization_id
      WHERE t.id = ? AND o.personal = 1
    `).get(teamId) ?? null;
    return this.database.prepare(`
      SELECT t.organization_id AS organizationId, c.id AS connectionId
      FROM teams t JOIN bees_connection_teams ct ON ct.team_id = t.id
      JOIN bees_connections c ON c.id = ct.connection_id
      JOIN bees_accounts a ON a.user_id = c.account_user_id
      WHERE t.id = ? AND c.account_user_id = ? AND a.enabled = 1
    `).get(teamId, accountUserId) ?? null;
  }

  executionClaims() {
    const acquire = async (kind, id, teamId, occurrenceAt = "", accountUserId = "") => {
      const scope = this.claimScope(teamId, accountUserId);
      if (!scope) return null;
      if (!scope.connectionId) return { local: true, accountUserId: "" };
      const claimId = kind === "work_item" ? id : stableUuid(`${kind}:${id}:${occurrenceAt}`);
      const machineId = currentIdentity(this.database).deviceId;
      const result = await this.request(`/api/execution-claims/${encodeURIComponent(claimId)}`, {
        method: "POST", organizationId: scope.organizationId, accountUserId,
        body: { teamId, machineId, permanent: kind !== "work_item" }
      });
      return result.acquired
        ? {
            claimId, teamId, machineId, organizationId: scope.organizationId,
            accountUserId, token: result.token, permanent: kind !== "work_item"
          }
        : null;
    };
    const renew = async (claim) => {
      if (claim.local) return claim;
      const result = await this.request(`/api/execution-claims/${encodeURIComponent(claim.claimId)}`, {
        method: "POST", organizationId: claim.organizationId, accountUserId: claim.accountUserId,
        body: { teamId: claim.teamId, machineId: claim.machineId, token: claim.token }
      });
      return result.acquired ? claim : null;
    };
    const release = async (claim) => {
      if (claim?.local || claim?.permanent || !claim) return;
      await this.request(`/api/execution-claims/${encodeURIComponent(claim.claimId)}`, {
        method: "DELETE", organizationId: claim.organizationId, accountUserId: claim.accountUserId,
        body: { teamId: claim.teamId, machineId: claim.machineId, token: claim.token }
      });
    };
    return { acquire, renew, release };
  }

  async summary() {
    let accounts = this.accounts().map(({ userId, email, name, enabled, updatedAt }) =>
      ({ userId, email, name, enabled, updatedAt }));
    const auth = await this.authConfig();
    if (!accounts.length) return {
      account: null, accounts: [], connections: [], organizations: [], invitations: [], auth
    };
    let invitations = [];
    try {
      await this.sync();
      accounts = this.accounts().map(({ userId, email, name, enabled, updatedAt }) =>
        ({ userId, email, name, enabled, updatedAt }));
      for (const account of accounts.filter(({ enabled }) => enabled)) {
        const result = await this.request("/api/me/organization-invitations", {
          accountUserId: account.userId
        });
        invitations.push(...(result.invitations ?? []).map((invitation) => ({
          ...invitation, accountUserId: account.userId, accountEmail: account.email
        })));
      }
    } catch (error) {
      if (error?.status !== 404) throw error;
      this.logger.warn?.("bees: production coordination routes are not deployed yet");
    }
    const connections = this.connections();
    return {
      account: accounts.find(({ enabled }) => enabled) ?? null, accounts, connections,
      organizations: connections.map((connection) => ({
        id: connection.organizationId,
        name: connection.organizationName,
        role: connection.role,
        connectionId: connection.id,
        accountUserId: connection.accountUserId,
        accountEmail: connection.email
      })),
      invitations, auth
    };
  }

  async acceptInvitation(invitationId, accountUserId) {
    await this.request(`/api/me/organization-invitations/${encodeURIComponent(invitationId)}/accept`, {
      method: "POST", accountUserId
    });
    return this.summary();
  }

  async organizationPeople(organizationId, connectionId) {
    const [{ memberships = [] }, { invitations = [] }] = await Promise.all([
      this.request(`/api/organizations/${encodeURIComponent(organizationId)}/members`, { connectionId }),
      this.request(`/api/organizations/${encodeURIComponent(organizationId)}/invitations`, { connectionId })
    ]);
    return { memberships, invitations };
  }

  async organizationSso(organizationId, connectionId) {
    return this.request(`/api/organizations/${encodeURIComponent(organizationId)}/sso`, { connectionId });
  }

  async registerOrganizationSso(input) {
    const { provider } = await this.request(`/api/organizations/${encodeURIComponent(input.organizationId)}/sso`, {
      method: "POST",
      connectionId: input.connectionId,
      body: {
        providerId: input.providerId,
        domain: input.domain,
        issuer: input.issuer,
        protocol: input.protocol,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        discoveryEndpoint: input.discoveryEndpoint,
        entryPoint: input.entryPoint,
        cert: input.cert
      }
    });
    const summary = await this.organizationSso(input.organizationId, input.connectionId);
    return {
      ...summary,
      verification: provider?.domainVerificationToken ? {
        providerId: input.providerId,
        domain: input.domain,
        dnsName: `_better-auth-token.${input.domain}`,
        domainVerificationToken: provider.domainVerificationToken
      } : null
    };
  }

  async removeOrganizationSso(organizationId, providerId, connectionId) {
    await this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/sso/${encodeURIComponent(providerId)}`,
      { method: "DELETE", connectionId }
    );
    return this.organizationSso(organizationId, connectionId);
  }

  async verifyOrganizationSso(organizationId, providerId, action, connectionId) {
    const result = await this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/sso/${encodeURIComponent(providerId)}/verification`,
      { method: "POST", body: { action }, connectionId }
    );
    if (action !== "verify") return {
      ...await this.organizationSso(organizationId, connectionId), verification: result
    };
    return this.organizationSso(organizationId, connectionId);
  }

  async inviteOrganizationMember(organizationId, email, role, connectionId) {
    await this.request(`/api/organizations/${encodeURIComponent(organizationId)}/invitations`, {
      method: "POST",
      connectionId,
      body: { email, role }
    });
    return this.organizationPeople(organizationId, connectionId);
  }

  async setOrganizationMemberRole(organizationId, userId, role, connectionId) {
    await this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}/role`,
      { method: "POST", connectionId, body: { role } }
    );
    return this.organizationPeople(organizationId, connectionId);
  }

  async setOrganizationInvitationRole(organizationId, invitationId, role, connectionId) {
    await this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitationId)}/role`,
      { method: "POST", connectionId, body: { role } }
    );
    return this.organizationPeople(organizationId, connectionId);
  }

  async teamPeople(teamId, connectionId) {
    const team = this.database.prepare(
      "SELECT organization_id AS organizationId FROM teams WHERE id = ?"
    ).get(teamId);
    if (!team) throw new Error("Team not found");
    const [{ members = [] }, { candidates = [] }] = await Promise.all([
      this.request(`/api/teams/${encodeURIComponent(teamId)}/members`, {
        organizationId: team.organizationId, connectionId
      }),
      this.request(`/api/teams/${encodeURIComponent(teamId)}/candidates`, {
        organizationId: team.organizationId, connectionId
      })
    ]);
    return { members, candidates };
  }

  async addTeamMember(teamId, userId, role, connectionId) {
    const team = this.database.prepare(
      "SELECT organization_id AS organizationId FROM teams WHERE id = ?"
    ).get(teamId);
    if (!team) throw new Error("Team not found");
    await this.request(`/api/teams/${encodeURIComponent(teamId)}/members`, {
      method: "POST",
      organizationId: team.organizationId,
      connectionId,
      body: { userId, role }
    });
    return this.teamPeople(teamId, connectionId);
  }

  async createOrganization(name, accountUserId) {
    const account = this.account(accountUserId);
    if (!account) throw new Error("Choose a signed-in account");
    const { organization } = await this.request("/api/organizations", {
      method: "POST", accountUserId, body: { name }
    });
    await this.syncAccount(account);
    return {
      id: organization.id,
      connectionId: stableUuid(`bees-connection:${organization.id}:${accountUserId}`),
      accountUserId
    };
  }

  async deleteOrganization(organizationId, connectionId) {
    const connection = this.connections().find(({ id }) => id === connectionId);
    if (!connection || connection.organizationId !== organizationId) {
      throw new Error("Choose the organization connection to delete");
    }
    await this.request("/api/workspaces", {
      method: "DELETE", organizationId, connectionId
    });
    return this.summary();
  }

  async createTeam(name, connectionId) {
    const connection = this.connections().find(({ id }) => id === connectionId);
    if (!connection) throw new Error("Choose an organization connection");
    const { team } = await this.request("/api/teams", {
      method: "POST", organizationId: connection.organizationId,
      accountUserId: connection.accountUserId, body: { name }
    });
    await this.syncAccount(this.account(connection.accountUserId));
    return { id: team.id, connectionId };
  }

  async deleteTeam(teamId, connectionId) {
    const connection = this.connections().find(({ id }) => id === connectionId);
    const team = this.database.prepare(
      "SELECT organization_id AS organizationId FROM teams WHERE id = ?"
    ).get(teamId);
    if (!connection || !team || connection.organizationId !== team.organizationId) {
      throw new Error("Choose the workspace connection that owns this team");
    }
    await this.request(`/api/teams/${encodeURIComponent(teamId)}`, {
      method: "DELETE", organizationId: team.organizationId, connectionId
    });
    this.database.prepare("DELETE FROM teams WHERE id = ?").run(teamId);
    return { id: teamId, organizationId: team.organizationId };
  }

  async command(input) {
    switch (input.action) {
      case "sign_in": return this.signIn(input.email, input.password);
      case "sign_up": return this.signUp(input.name, input.email, input.password);
      case "social_start": return this.startBrowserSignIn("social", input.provider, input.callbackPort);
      case "sso_start": return this.startBrowserSignIn("sso", input.email, input.callbackPort);
      case "set_account_enabled": return this.setAccountEnabled(input.accountUserId, input.enabled !== false);
      case "sign_out": await this.signOut(input.accountUserId); return this.summary();
      case "sync": return this.summary();
      case "accept_invitation": return this.acceptInvitation(input.invitationId, input.accountUserId);
      case "organization_people": return this.organizationPeople(input.organizationId, input.connectionId);
      case "organization_sso": return this.organizationSso(input.organizationId, input.connectionId);
      case "register_organization_sso": return this.registerOrganizationSso(input);
      case "remove_organization_sso":
        return this.removeOrganizationSso(input.organizationId, input.providerId, input.connectionId);
      case "request_organization_sso_verification":
        return this.verifyOrganizationSso(input.organizationId, input.providerId, "request", input.connectionId);
      case "verify_organization_sso":
        return this.verifyOrganizationSso(input.organizationId, input.providerId, "verify", input.connectionId);
      case "invite_organization_member":
        return this.inviteOrganizationMember(
          input.organizationId, input.email, input.role, input.connectionId
        );
      case "set_organization_member_role":
        return this.setOrganizationMemberRole(
          input.organizationId, input.userId, input.role, input.connectionId
        );
      case "set_organization_invitation_role":
        return this.setOrganizationInvitationRole(
          input.organizationId, input.invitationId, input.role, input.connectionId
        );
      case "team_people": return this.teamPeople(input.teamId, input.connectionId);
      case "add_team_member":
        return this.addTeamMember(input.teamId, input.userId, input.role, input.connectionId);
      case "create_organization": return this.createOrganization(input.name, input.accountUserId);
      case "delete_organization": return this.deleteOrganization(input.organizationId, input.connectionId);
      case "create_team": return this.createTeam(input.name, input.connectionId);
      case "delete_team": return this.deleteTeam(input.teamId, input.connectionId);
      default: throw new Error("Unknown collaboration action");
    }
  }
}
