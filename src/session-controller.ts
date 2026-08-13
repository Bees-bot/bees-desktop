import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  type AiProvider
} from "./ai-connections.js";
import {
  ApiError,
  type AuthResult,
  type PendingInvitation,
  type ServerOrganization,
  type SessionUser
} from "./api.js";
import {
  listMcpConnections,
  saveMcpConnection
} from "./connections.js";
import {
  loadCachedControl
} from "./control.js";
import type {
  McpConnection,
  Organization,
  Team
} from "./domain.js";
import {
  errorText
} from "./domain.js";
import {
  KNOWLEDGE_POLICY_KEY,
  cacheKnowledgePolicy,
  isKnowledgeConnection,
  loadCachedKnowledgePolicy,
  knowledgeConnection as managedKnowledgeConnection,
  parseKnowledgePolicy,
  type KnowledgePolicy
} from "./knowledge.js";
import type { KnowledgeRuntimeInfo, MainHost, OrgBranding } from "./main.js";

export function createSessionController(host: MainHost) {
  async function loadKnowledgePolicy(force = false): Promise<KnowledgePolicy | null> {
    const organizationId = host.workspaceController.workspace.organizationId;
    if (!force && knowledgePolicyOrgId === organizationId)
      return knowledgePolicy;
    let policy = await loadCachedKnowledgePolicy(host.repository, organizationId);
    const token = orgToken(organizationId);
    if (orgIsConnected(organizationId) && token) {
      try {
        const remote = (await host.api.listPolicies(token, organizationId)).policies.find(({ key }) => key === KNOWLEDGE_POLICY_KEY);
        policy = parseKnowledgePolicy(remote?.value);
        await cacheKnowledgePolicy(host.repository, organizationId, policy);
      }
      catch (error) {
        // Offline keeps the last server policy; an invalid policy is surfaced when it is edited.
        if (!(error instanceof ApiError && error.status === 0))
          throw error;
      }
    }
    knowledgePolicyOrgId = organizationId;
    knowledgePolicy = policy;
    return policy;
  }

  async function saveKnowledgePolicy(policy: KnowledgePolicy | null): Promise<void> {
    const organizationId = host.workspaceController.workspace.organizationId;
    const token = orgToken(organizationId);
    if (orgIsConnected(organizationId)) {
      if (!token)
        throw new Error("Sign in to change this organization's knowledge mode");
      await host.api.putPolicy(token, organizationId, KNOWLEDGE_POLICY_KEY, policy);
    }
    await cacheKnowledgePolicy(host.repository, organizationId, policy);
    knowledgePolicyOrgId = organizationId;
    knowledgePolicy = policy;
    knowledgeError = "";
  }

  /** Resolve the org policy into the one managed MCP connection every bee in this team receives. */
  async function ensureKnowledgeConnection(): Promise<McpConnection | null> {
    const policy = await loadKnowledgePolicy(true);
    if (!policy || !host.workspaceController.workspace.teamId) {
      knowledgeConnection = null;
      return null;
    }
    const stored = await listMcpConnections(host.repository, host.workspaceController.workspace.teamId);
    const existing = stored.find(isKnowledgeConnection);
    let connection: McpConnection;
    if (policy.mode === "local") {
      const runtime = await invoke<KnowledgeRuntimeInfo>("ensure_knowledge_worker", {
        organizationId: host.workspaceController.workspace.organizationId,
        teamId: host.workspaceController.workspace.teamId
      });
      connection = managedKnowledgeConnection(host.workspaceController.workspace.teamId, runtime.url, existing);
      await invoke("store_connection_secret", {
        secretRef: connection.secretRef,
        secret: runtime.token
      });
    }
    else {
      if (!existing) {
        throw new Error("Add the remote worker token for this team under Organization → Knowledge");
      }
      connection = managedKnowledgeConnection(host.workspaceController.workspace.teamId, policy.url, existing);
    }
    await saveMcpConnection(host.repository, connection);
    knowledgeConnection = connection;
    knowledgeError = "";
    return connection;
  }

  // A "connection" = one account signed into one org. The same org reachable by two accounts is
  // two connections, hence two switcher icons — you can be in the same org as both accounts at
  // once. There is no single "active" account. Tokens live in `accounts`; a connection is just
  // the (org, account) pair. `activeUserId` + `workspace.organizationId` name the shown one.
  const CONN_SEP = "|";

  const connKey = (orgId: string, userId: string): string => `${orgId}${CONN_SEP}${userId}`;

  const connParts = (key: string): {
    orgId: string;
    userId: string;
  } => {
    const separator = key.indexOf(CONN_SEP);
    return { orgId: key.slice(0, separator), userId: key.slice(separator + 1) };
  };

  const connections = new Set<string>();

  // Every (org, account) pair this desktop has ever connected. A pair missing from here has never
  // been logged in on this machine, so reconciliation logs it in on sight; a pair present but not in
  // `connections` was logged out on purpose and stays out.
  const seenConnections = new Set<string>();

  let activeUserId = "";

  // Every authenticated account, keyed by user id — independent of orgs, so a user can stay
  // signed into several at once. Each account carries the one bearer token for its session.
  const accounts = new Map<string, {
    user: SessionUser;
    token: string;
  }>();

  // Which orgs are server-backed ("connected"). Persisted so it survives sign-out — otherwise
  // a signed-out connected org would look local and hide its sign-in controls.
  const connectedOrgs = new Set<string>();

  let orgBranding: Record<string, OrgBranding> = {};

  // Server orgs by id, so the UI knows which local orgs are team-enabled (req 3).
  let serverOrgs = new Map<string, ServerOrganization>();

  // Org invitations waiting for any pooled account, refreshed by reconcileServerOrgs. Only the count
  // is used (the Preferences badge); the Orgs tab re-fetches its own rows when it renders.
  let pendingInvitations: PendingInvitation[] = [];

  const SEEN_CONNECTIONS_KEY = "seen_org_connections";

  const providerLabel: Record<string, string> = { google: "Google", github: "GitHub" };

  let knowledgePolicy: KnowledgePolicy | null = null;

  let knowledgePolicyOrgId = "";

  let knowledgeConnection: McpConnection | null = null;

  let knowledgeError = "";

  function currentOrganization(): Organization | undefined {
    return host.workspaceController.organizations.find(({ id }) => id === host.workspaceController.workspace.organizationId);
  }

  function currentTeam(): Team | undefined {
    return host.workspaceController.teams.find(({ id }) => id === host.workspaceController.workspace.teamId);
  }

  function activeServerOrg(): ServerOrganization | undefined {
    return serverOrgs.get(host.workspaceController.workspace.organizationId);
  }

  function activeOrgTeamEnabled(): boolean {
    return activeServerOrg()?.teamEnabled ?? false;
  }

  /** First account connected to an org (used when a plain org id needs any connection). */
  function firstConnUser(orgId: string): string {
    for (const key of connections) {
      const part = connParts(key);
      if (part.orgId === orgId)
        return part.userId;
    }
    return "";
  }

  /** Whether any account is connected to this org. */
  function orgHasConnection(orgId: string): boolean {
    return firstConnUser(orgId) !== "";
  }

  /** The account pool entry backing the active connection. */
  function activeAccount(): {
    user: SessionUser;
    token: string;
  } | undefined {
    return accounts.get(activeUserId);
  }

  /** Token for server calls in the given org = its active connection's account token. */
  function orgToken(orgId = host.workspaceController.workspace.organizationId): string | null {
    const userId = orgId === host.workspaceController.workspace.organizationId ? activeUserId : firstConnUser(orgId);
    return userId ? (accounts.get(userId)?.token ?? null) : null;
  }

  /** The account backing the active connection (for "you" / "signed in as" display). */
  function currentUser(): SessionUser | null {
    return activeAccount()?.user ?? null;
  }

  /** Whether the current org has an active connection (the shown account is signed into it). */
  function orgSignedIn(orgId = host.workspaceController.workspace.organizationId): boolean {
    return orgId === host.workspaceController.workspace.organizationId
      ? connections.has(connKey(orgId, activeUserId))
      : orgHasConnection(orgId);
  }

  /**
   * Rebuild the server-org map from EVERY signed-in account, not just one. Each account may
   * own a different set of orgs; merging keeps them all visible regardless of which org is open.
   */
  async function reconcileServerOrgs(): Promise<void> {
    serverOrgs = new Map();
    const invitations: PendingInvitation[] = [];
    const droppedFrom = new Set<string>(); // orgs an account got removed from server-side
    let accountsChanged = false;
    for (const { user, token } of accounts.values()) {
      let remote: ServerOrganization[];
      try {
        ({ organizations: remote } = await host.api.listOrganizations(token));
      }
      catch (error) {
        // A rejected token is signed out, not offline. Keeping it made the UI claim the account
        // was signed in until its next authenticated action failed with "Sign in required".
        if (error instanceof ApiError && error.status === 401) {
          accounts.delete(user.id);
          accountsChanged = true;
          forgetAccountConnections(user.id);
        }
        continue; // an unreachable server must not sign out otherwise-valid accounts
      }
      // Invitations are not memberships, so the org list never mentions them. Pulled here so a
      // pending invite can badge the UI without the user opening Preferences. Its own catch: a
      // failure here must not cost this account its orgs.
      invitations.push(...(await host.api.myInvitations(token).then((r) => r.invitations).catch(() => [])));
      // listOrganizations only returns orgs the account still belongs to. A connection to any org
      // no longer in that set means this account was removed from it — drop the stale connection.
      const ids = new Set(remote.map((org) => org.id));
      for (const key of [...connections]) {
        const part = connParts(key);
        if (part.userId === user.id && !ids.has(part.orgId)) {
          connections.delete(key);
          droppedFrom.add(part.orgId);
        }
      }
      for (const org of remote) {
        await host.repository.upsertServerOrganization(org.id, org.name);
        // A membership this desktop has never logged in (org created on the web, joined from another
        // machine, or this account added to an org another account already uses) is signed in on
        // sight — otherwise it has an org with no icon and no way in. Per (org, account), so a
        // second account joining a familiar org still gets connected, and a deliberate Logout —
        // which leaves the pair marked seen — stays logged out.
        const key = connKey(org.id, user.id);
        if (!seenConnections.has(key)) {
          connections.add(key);
          seenConnections.add(key);
        }
        serverOrgs.set(org.id, org);
        connectedOrgs.add(org.id);
      }
    }
    // An org nobody is connected to anymore: forget it and its cached boards so its icon vanishes.
    for (const orgId of droppedFrom) {
      if ([...connections].some((key) => connParts(key).orgId === orgId))
        continue;
      connectedOrgs.delete(orgId);
      await host.repository.deleteOrganization(orgId);
    }
    pendingInvitations = invitations;
    if (accountsChanged)
      await persistAccounts();
    await persistConnections();
    await host.repository.setSetting("connected_org_ids", JSON.stringify([...connectedOrgs]));
    await reconcileServerTeams();
  }

  /**
   * Pull each connected org's teams into the local store so every desktop in the org shares the same
   * team ids — without this a second machine sees the org and no teams at all. Upsert only: a failed
   * or partial list (a plain member only sees their own teams) must never delete local work.
   */
  async function reconcileServerTeams(): Promise<void> {
    for (const orgId of connectedOrgs) {
      const token = orgToken(orgId);
      if (!token)
        continue; // logged out of this org: nothing to pull with
      const remote = await host.api.listTeams(token, orgId).then(({ teams: list }) => list).catch(() => null);
      if (!remote)
        continue; // offline or rejected — keep what is already local
      for (const team of remote)
        await host.repository.upsertServerTeam(team.id, orgId, team.name);
    }
  }

  /**
   * Drop every connection an account backed, and forget that it ever had them: signing the account
   * out is a whole-account decision, so signing back in should auto-connect its orgs again rather
   * than leave them looking logged-out with no way to tell why. Caller persists.
   */
  function forgetAccountConnections(userId: string): void {
    for (const key of [...connections]) {
      if (connParts(key).userId === userId)
        connections.delete(key);
    }
    for (const key of [...seenConnections]) {
      if (connParts(key).userId === userId)
        seenConnections.delete(key);
    }
  }

  async function persistConnections(): Promise<void> {
    await host.repository.setSetting("org_connections", JSON.stringify([...connections]));
    await host.repository.setSetting(SEEN_CONNECTIONS_KEY, JSON.stringify([...seenConnections]));
  }

  async function persistAccounts(): Promise<void> {
    await host.repository.setSetting("account_sessions", JSON.stringify([...accounts.values()]));
  }

  /** Add (or refresh) an account in the pool without disturbing any other signed-in account. */
  async function rememberAccount(user: SessionUser, token: string): Promise<void> {
    accounts.set(user.id, { user, token });
    await persistAccounts();
  }

  /** Record that `user` is connected to `orgId` (its account already validated). */
  async function connect(orgId: string, user: SessionUser, token: string): Promise<void> {
    await rememberAccount(user, token);
    connections.add(connKey(orgId, user.id));
    seenConnections.add(connKey(orgId, user.id)); // a later Logout must not be undone by reconciling
    await persistConnections();
  }

  /** Remove one (org, account) connection; move off it if it was the active one. */
  async function disconnect(orgId: string, userId: string): Promise<void> {
    connections.delete(connKey(orgId, userId));
    await persistConnections();
    await reconcileServerOrgs().catch(() => { });
    if (host.workspaceController.workspace.organizationId === orgId && activeUserId === userId) {
      if (!(await moveOffHidden()))
        await host.workspaceController.refresh();
    }
    else {
      await host.workspaceController.refresh();
    }
    host.shell.showNotice("Signed out of this organization", "success");
  }

  // ---- Sign-in primitives: authenticate (setting api.token) and return the user, no org binding. ----
  async function signInUser(): Promise<AuthResult | null> {
    const data = await host.actions.edit("Sign in", [
      { name: "email", label: "Email", placeholder: "you@example.com" },
      { name: "password", label: "Password", type: "password" }
    ]);
    if (!data)
      return null;
    return host.api.signInEmail(String(data.get("email") ?? ""), String(data.get("password") ?? ""));
  }

  async function signUpUser(): Promise<AuthResult | null> {
    const data = await host.actions.edit("Create your account", [
      { name: "name", label: "Name" },
      { name: "email", label: "Email", placeholder: "you@example.com" },
      { name: "password", label: "Password", type: "password" }
    ]);
    if (!data)
      return null;
    return host.api.signUpEmail(String(data.get("name") ?? ""), String(data.get("email") ?? ""), String(data.get("password") ?? ""));
  }

  /**
   * Bumped on every attempt. `oauth_await` has no cancellation, and an abandoned browser tab
   * stays capable of completing the flow at any later time — including after the user gave up
   * and signed in again a different way. Comparing against this after the wait returns is what
   * stops that late token from reconnecting a session nobody is looking at anymore.
   */
  let oauthAttempt = 0;

  /**
   * Browser-based social sign-in via a loopback listener: the app binds a local port,
   * opens the browser, and the finished OAuth flow redirects the session token back to
   * that port over http. No custom URL scheme, so it works under `tauri dev` too.
   */
  async function socialSignInUser(provider: string): Promise<AuthResult | null> {
    const attempt = ++oauthAttempt;
    const port = await invoke<number>("oauth_start");
    await openUrl(host.api.socialSignInUrl(provider, `http://127.0.0.1:${port}/callback`));
    host.shell.showNotice(`Continue with ${providerLabel[provider] ?? provider} in your browser`, "success");
    const token = new URLSearchParams(await invoke<string>("oauth_await")).get("token");
    if (attempt !== oauthAttempt)
      return null;
    return token ? host.api.resumeSession(token) : null;
  }

  /** Pick a sign-in method, run it, and return the authenticated account. */
  async function promptSignIn(title: string): Promise<AuthResult | null> {
    const options = [
      ...Object.entries(providerLabel).map(([value, label]) => ({ label: `Continue with ${label}`, value })),
      { label: "Email — sign in", value: "signin" },
      { label: "Email — create account", value: "signup" }
    ];
    const auth = await host.actions.edit(title, [{ name: "method", label: "Continue with", type: "select", options }]);
    if (!auth)
      return null;
    const method = String(auth.get("method"));
    const result = method in providerLabel
      ? await socialSignInUser(method)
      : method === "signup"
        ? await signUpUser()
        : await signInUser();
    if (!result)
      host.shell.showNotice("Sign in failed", "error");
    return result;
  }

  /** Is the active connection still openable? Local orgs always; connected orgs need the pair. */
  function activeConnectionValid(): boolean {
    const orgId = host.workspaceController.workspace.organizationId;
    if (!orgId)
      return false;
    if (!orgIsConnected(orgId))
      return true;
    return connections.has(connKey(orgId, activeUserId));
  }

  /**
   * If the active connection just became unopenable (signed out), move to any remaining
   * connection — or a local org, or Preferences → Orgs when none remain. Refreshes either way.
   * Returns true if it handled the refresh (caller then skips its own).
   */
  async function moveOffHidden(): Promise<boolean> {
    if (activeConnectionValid())
      return false;
    const first = [...connections][0];
    if (first) {
      const { orgId, userId } = connParts(first);
      await switchConnection(orgId, userId);
      return true;
    }
    const local = host.workspaceController.organizations.find(({ id }) => !orgIsConnected(id));
    if (local) {
      await switchConnection(local.id, "");
      return true;
    }
    host.workspaceController.workspace.organizationId = "";
    activeUserId = "";
    host.shell.view = "preferences";
    host.shell.prefsTab = "orgs";
    await host.workspaceController.refresh();
    return true;
  }

  /** Drop one account from the pool and every connection it backed. */
  async function signOutAccount(userId: string): Promise<void> {
    const account = accounts.get(userId);
    accounts.delete(userId);
    await persistAccounts();
    forgetAccountConnections(userId);
    await persistConnections();
    await reconcileServerOrgs().catch(() => { });
    if (!(await moveOffHidden()))
      await host.workspaceController.refresh();
    host.shell.showNotice(`Signed out ${account?.user.email ?? "account"}`, "success");
  }

  /** Handle the OAuth deep link (bees://auth/callback?token=…) delivered by the browser. */
  async function handleAuthCallback(urls: string[]): Promise<void> {
    const token = urls
      .map((raw) => {
        try {
          return new URL(raw).searchParams.get("token");
        }
        catch {
          return null;
        }
      })
      .find(Boolean);
    if (!token)
      return;
    const result = await host.api.resumeSession(token);
    if (!result) {
      host.shell.showNotice("Sign in failed", "error");
      return;
    }
    await rememberAccount(result.user, result.token);
    // Connect this account to the current org only if it's a connected org with no connection yet.
    if (orgIsConnected(host.workspaceController.workspace.organizationId) && !orgHasConnection(host.workspaceController.workspace.organizationId)) {
      await connect(host.workspaceController.workspace.organizationId, result.user, result.token);
      activeUserId = result.user.id;
    }
    try {
      await reconcileServerOrgs();
    }
    catch (error) {
      host.shell.showNotice(errorText(error), "error");
    }
    await host.workspaceController.refresh();
    host.shell.showNotice(`Signed in as ${result.user.email}`, "success");
  }

  /**
   * Handle an invite deep link (bees://invite/<id>) from the emailed link. Open the org-invites
   * view and, if an already-signed-in account is the invitee (server matches by email), accept
   * straight away. Otherwise land on the invites tab so they can sign in and accept there.
   */
  async function handleInviteLink(id: string): Promise<void> {
    host.shell.view = "preferences";
    host.shell.prefsTab = "orgs";
    for (const account of accounts.values()) {
      const invitations = await host.api.myInvitations(account.token).then((r) => r.invitations).catch(() => []);
      if (!invitations.some((invitation) => invitation.id === id))
        continue;
      const { membership } = await host.api.acceptMyInvitation(account.token, id);
      await connect(membership.organizationId, account.user, account.token);
      await switchConnection(membership.organizationId, account.user.id);
      host.shell.showNotice("Joined organization", "success");
      return;
    }
    await host.workspaceController.refresh();
    host.shell.showNotice("Sign in as the invited email to accept the invitation", "info");
  }

  /** Route a bees:// deep link to the right handler (invite vs OAuth callback). */
  function routeDeepLink(urls: string[]): void {
    const fail = (error: unknown): void => host.shell.showNotice(errorText(error), "error");
    for (const raw of urls) {
      let routeHost: string;
      let path: string;
      try {
        const url = new URL(raw);
        routeHost = url.hostname;
        path = url.pathname;
      }
      catch {
        continue;
      }
      if (routeHost === "invite") {
        void handleInviteLink(path.replace(/^\//, "")).catch(fail);
      }
      else if (routeHost === "billing") {
        // Returned from Stripe checkout; the org appears once the webhook lands, so just refresh.
        if (path.replace(/^\//, "") === "success")
          host.shell.showNotice("Payment received — setting up your organization…", "success");
        void reconcileServerOrgs().catch(fail);
      }
      else {
        void handleAuthCallback([raw]).catch(fail);
      }
    }
  }

  /** An org is "connected" when it is backed by a server organization; otherwise local-only. */
  function orgIsConnected(orgId = host.workspaceController.workspace.organizationId): boolean {
    return connectedOrgs.has(orgId);
  }

  /**
   * Can we actually open this org right now? Local orgs always; connected orgs only while an
   * account is signed into them. Logged-out connected orgs are hidden from the switcher — you
   * log back in from Preferences → Orgs.
   */
  function canConnectOrg(orgId: string): boolean {
    return !orgIsConnected(orgId) || orgHasConnection(orgId);
  }

  function brandingFor(orgId: string): OrgBranding {
    return orgBranding[orgId] ?? {};
  }

  /** A 2.5rem org avatar: the logo if set, otherwise the first letter on the org color. */
  function orgLogoPreview(orgId: string, name: string): string {
    const branding = brandingFor(orgId);
    return branding.logo
      ? `<img src="${host.shell.escapeHtml(branding.logo)}" alt="" class="size-10 overflow-hidden rounded-lg object-cover">`
      : `<span class="grid size-10 place-items-center rounded-lg text-sm font-semibold text-white" style="background:${host.shell.escapeHtml(branding.color || defaultOrgColor(name))}">${host.shell.escapeHtml(name.slice(0, 1).toUpperCase())}</span>`;
  }

  /** Stable fallback color from the org name, so same-initial orgs (Acme vs Ace) still differ. */
  function defaultOrgColor(seed: string): string {
    let hash = 0;
    for (const char of seed)
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 55% 45%)`;
  }

  async function saveBranding(): Promise<void> {
    await host.repository.setSetting("org_branding", JSON.stringify(orgBranding));
  }

  /** Merge a color/logo patch into an org's branding and persist. Empty fields are ignored. */
  async function setBrandingValue(orgId: string, patch: OrgBranding): Promise<void> {
    const next: OrgBranding = { ...brandingFor(orgId) };
    if (patch.color)
      next.color = patch.color;
    if (patch.logo)
      next.logo = patch.logo;
    orgBranding[orgId] = next;
    await saveBranding();
  }

  async function probeKnowledgeConnection(connection: McpConnection): Promise<void> {
    const { baseUrl, token } = await host.ensureFlueRuntime();
    const response = await tauriFetch(`${baseUrl}/connections/discover`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(connection)
    });
    const body = (await response.json()) as {
      tools?: McpConnection["tools"];
      error?: string;
    };
    if (!response.ok || !body.tools?.some(({ name }) => name === "knowledge_search")) {
      throw new Error(body.error ?? "The worker does not expose knowledge_search");
    }
  }

  const AI_PROVIDER_HINT: Record<AiProvider, string> = {
    "opencode-go": "Paste the API key from opencode.ai/auth.",
    openrouter: "Paste an OpenRouter API key (openrouter.ai/keys).",
    openai: "Paste an OpenAI API key (platform.openai.com/api-keys), then use openai/<model>.",
    anthropic: "Paste an Anthropic API key (console.anthropic.com), then use anthropic/<model>."
  };

  /** Model prefix an agent must use for each connection, shown beside the connection. */
  const AI_PROVIDER_MODEL_PREFIX: Record<AiProvider, string> = {
    "opencode-go": "opencode-go/",
    openrouter: "openrouter/",
    openai: "openai/",
    anthropic: "anthropic/"
  };

  function aiConnectionScope(): string {
    return host.workspaceController.workspace.organizationId || "global";
  }

  /** Show a specific (org, account) connection. `userId` is "" for a local org. */
  async function switchConnection(organizationId: string, userId: string): Promise<void> {
    host.workspaceController.workspace.organizationId = organizationId;
    await loadCachedControl(host.repository, organizationId);
    host.runs.lastControlHealthAt = 0;
    knowledgePolicyOrgId = "";
    knowledgePolicy = null;
    knowledgeConnection = null;
    knowledgeError = "";
    activeUserId = userId;
    const organizationTeams = await host.repository.listTeams(organizationId);
    host.workspaceController.workspace.teamId = organizationTeams[0]?.id ?? "";
    host.workspaceController.activeBoard = null;
    host.workspaceController.activeProcess = null;
    host.shell.view = organizationTeams.length ? "overview" : "preferences";
    await host.assistant.refreshAssistantCatalog();
    await host.workspaceController.refresh();
  }

  async function createLocalOrg(): Promise<void> {
    const data = await host.actions.edit("New local organization", [
      { name: "name", label: "Organization name", placeholder: "My workspace" }
    ]);
    const name = String(data?.get("name") ?? "").trim();
    if (!name)
      return;
    const id = await host.repository.createOrganization(name);
    await host.workspaceController.ensureOrgFolders();
    await host.workspaceController.switchOrganization(id);
    host.shell.showNotice(`Created ${name} (local)`, "success");
  }

  async function createConnectedOrg(): Promise<void> {
    // Refresh first so an expired saved session triggers sign-in instead of a doomed create call.
    await reconcileServerOrgs();
    // The chosen account owns the org (becomes admin). Need at least one account to pick from.
    let pool = [...accounts.values()];
    if (pool.length === 0) {
      const result = await promptSignIn("Sign in to create a connected organization");
      if (!result)
        return;
      await rememberAccount(result.user, result.token);
      pool = [...accounts.values()];
    }
    const data = await host.actions.edit("New connected organization", [
      { name: "beta", label: "", type: "note", value: host.views.CONNECTED_ORG_BETA_COPY },
      { name: "name", label: "Organization name", placeholder: "Acme Inc" },
      {
        name: "admin",
        label: "Org admin account",
        type: "select",
        value: pool[0]!.user.id,
        options: pool.map(({ user }) => ({ label: user.email, value: user.id }))
      }
    ], "Create");
    const name = String(data?.get("name") ?? "").trim();
    if (!data || !name)
      return;
    const account = accounts.get(String(data.get("admin")));
    if (!account)
      return;
    const { organization } = await host.api.createOrganization(account.token, name);
    await connect(organization.id, account.user, account.token);
    await reconcileServerOrgs().catch(() => { });
    await switchConnection(organization.id, account.user.id);
    host.shell.showNotice(`Created ${name}`, "success");
  }

  /**
   * The org is out of free teams. Continue goes to payment; the footer link takes the 30-day trial.
   * Returns true when the caller should retry the action that hit the paywall.
   */
  async function resolveTeamPaywall(message: string): Promise<boolean> {
    const token = orgToken();
    if (!token)
      throw new Error("Sign in to this organization first");
    const choice = await host.actions.edit("More teams", [{ name: "explain", label: "", type: "note", value: message }], "Continue", "Or request or extend your trial by 30-days (unlimited teams)");
    if (!choice)
      return false;
    if (choice.get("__action") === "footer") {
      await host.api.startTeamTrial(token, host.workspaceController.workspace.organizationId);
      await reconcileServerOrgs();
      host.shell.showNotice("Trial running for 30 days", "success");
      return true;
    }
    const { url } = await host.api.checkout(token, host.workspaceController.workspace.organizationId);
    if (await host.api.completeStubCheckout(url)) {
      await reconcileServerOrgs();
      host.shell.showNotice("Payment complete", "success");
      return true;
    }
    await openUrl(url);
    host.shell.showNotice("Finish adding your card in the browser, then try again.", "success");
    return false;
  }

  /**
   * Register a team on the server, clearing the out-of-free-teams paywall if it fires. Returns the
   * server's team id — the local row must adopt it, or the same team gets a different id on every
   * desktop and never syncs. Null means the user backed out of paying: create nothing.
   */
  async function createServerTeam(name: string): Promise<string | null> {
    const token = orgToken();
    if (!token)
      throw new Error("Sign in to this organization first");
    try {
      return (await host.api.createTeam(token, host.workspaceController.workspace.organizationId, name)).team.id;
    }
    catch (error) {
      // Out of free teams: let them pay or start a trial, then create the team.
      if (!(error instanceof ApiError) || error.status !== 402)
        throw error;
      if (!(await resolveTeamPaywall(error.message)))
        return null;
      return (await host.api.createTeam(token, host.workspaceController.workspace.organizationId, name)).team.id;
    }
  }

  async function restoreSession(): Promise<void> {
    const brandingRaw = await host.repository.getSetting("org_branding", "");
    if (brandingRaw) {
      try {
        orgBranding = JSON.parse(brandingRaw) as Record<string, OrgBranding>;
      }
      catch {
        // ignore malformed branding
      }
    }
    const connectedRaw = await host.repository.getSetting("connected_org_ids", "");
    if (connectedRaw) {
      try {
        for (const id of JSON.parse(connectedRaw) as string[])
          connectedOrgs.add(String(id));
      }
      catch {
        // ignore malformed marker
      }
    }
    const accountsRaw = await host.repository.getSetting("account_sessions", "");
    if (accountsRaw) {
      try {
        for (const entry of JSON.parse(accountsRaw) as {
          user: SessionUser;
          token: string;
        }[]) {
          if (entry?.user?.id && entry.token)
            accounts.set(entry.user.id, entry);
        }
      }
      catch {
        // ignore malformed account pool
      }
    }
    const connectionsRaw = await host.repository.getSetting("org_connections", "");
    if (connectionsRaw) {
      try {
        for (const key of JSON.parse(connectionsRaw) as string[])
          connections.add(String(key));
      }
      catch {
        // ignore malformed connection store
      }
    }
    const seenRaw = await host.repository.getSetting(SEEN_CONNECTIONS_KEY, "");
    if (seenRaw) {
      try {
        for (const key of JSON.parse(seenRaw) as string[])
          seenConnections.add(String(key));
      }
      catch {
        // ignore malformed marker
      }
    }
    // Drop connections whose account is no longer pooled. Reconciliation below removes sessions
    // only when the server explicitly rejects them, so launching offline keeps valid sign-ins.
    for (const key of [...connections]) {
      if (!accounts.has(connParts(key).userId))
        forgetAccountConnections(connParts(key).userId);
    }
    await persistConnections();
    activeUserId = orgIsConnected(host.workspaceController.workspace.organizationId) ? firstConnUser(host.workspaceController.workspace.organizationId) : "";
    if (accounts.size)
      await reconcileServerOrgs();
  }

  return {
    loadKnowledgePolicy,
    saveKnowledgePolicy,
    ensureKnowledgeConnection,
    connKey,
    connParts,
    connections,
    get activeUserId() { return activeUserId; },
    set activeUserId(value: typeof activeUserId) { activeUserId = value; },
    accounts,
    connectedOrgs,
    get orgBranding() { return orgBranding; },
    set orgBranding(value: typeof orgBranding) { orgBranding = value; },
    get serverOrgs() { return serverOrgs; },
    set serverOrgs(value: typeof serverOrgs) { serverOrgs = value; },
    get pendingInvitations() { return pendingInvitations; },
    set pendingInvitations(value: typeof pendingInvitations) { pendingInvitations = value; },
    providerLabel,
    get knowledgePolicy() { return knowledgePolicy; },
    set knowledgePolicy(value: typeof knowledgePolicy) { knowledgePolicy = value; },
    get knowledgePolicyOrgId() { return knowledgePolicyOrgId; },
    set knowledgePolicyOrgId(value: typeof knowledgePolicyOrgId) { knowledgePolicyOrgId = value; },
    get knowledgeConnection() { return knowledgeConnection; },
    set knowledgeConnection(value: typeof knowledgeConnection) { knowledgeConnection = value; },
    get knowledgeError() { return knowledgeError; },
    set knowledgeError(value: typeof knowledgeError) { knowledgeError = value; },
    currentOrganization,
    currentTeam,
    activeServerOrg,
    activeOrgTeamEnabled,
    firstConnUser,
    orgHasConnection,
    orgToken,
    currentUser,
    orgSignedIn,
    reconcileServerOrgs,
    persistConnections,
    rememberAccount,
    connect,
    disconnect,
    signInUser,
    signUpUser,
    socialSignInUser,
    activeConnectionValid,
    moveOffHidden,
    signOutAccount,
    routeDeepLink,
    orgIsConnected,
    brandingFor,
    orgLogoPreview,
    defaultOrgColor,
    saveBranding,
    setBrandingValue,
    probeKnowledgeConnection,
    AI_PROVIDER_HINT,
    AI_PROVIDER_MODEL_PREFIX,
    aiConnectionScope,
    switchConnection,
    createLocalOrg,
    createConnectedOrg,
    createServerTeam,
    restoreSession
  };
}
