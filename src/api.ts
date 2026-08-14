// Thin client for the coordination API. Desktop authenticates with a better-auth
// bearer token (no cookies), so the same account works on web and desktop.

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { WorkItemCommand, WorkItemRuntimeState } from "./workflow-runtime.js";

type ServerWorkItemRuntimeState = Omit<WorkItemRuntimeState, "organizationId"> & {
  workspaceId: string;
};

function localRuntime({ workspaceId, ...runtime }: ServerWorkItemRuntimeState): WorkItemRuntimeState {
  return { ...runtime, organizationId: workspaceId };
}

/**
 * Where this build points unless something overrides it. Production, because that is what
 * every end user connects to — running against a local API is the special case, and the dev
 * scripts opt into it explicitly with `BEES_API_URL=dev`.
 *
 * `VITE_BEES_API_URL` (from `.env.production`) still wins at build time, so a build can be
 * pointed elsewhere without touching this.
 */
export const defaultApiBaseUrl: string =
  import.meta.env.VITE_BEES_API_URL ?? "https://app.bees.bot";

let currentApiBaseUrl = defaultApiBaseUrl;

/**
 * Read per request, never captured at construction: `--server` / `BEES_API_URL` is applied
 * during boot, after this module and the clients that use it are already loaded.
 */
export function apiBaseUrl(): string {
  return currentApiBaseUrl;
}

export function setApiBaseUrl(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, "");
  currentApiBaseUrl = trimmed || defaultApiBaseUrl;
}

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
}

export interface ServerWorkspace {
  id: string;
  name: string;
  role?: "owner" | "admin" | "member";
  teamEnabled: boolean;
  trialEndsAt: string | null;
}

export interface PricingPlan {
  id: string;
  name: string;
  /** Charged per team, per interval. */
  priceCents: number;
  interval: "month" | "year";
  /** Teams a workspace gets before any payment is needed. */
  freeTeams: number;
  /** Invite-ready workspaces have no charges or team limits while the beta is active. */
  freeDuringBeta: boolean;
  features: string[];
}

/** An API error that kept its HTTP status — 402 means "needs a card or a trial". */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/**
 * A dev build loads its UI from the Vite server, so the webview origin is
 * `http://127.0.0.1:1420` — an origin production's CORS allowlist does not (and should not)
 * trust, which made `BEES_API_URL=prod npm run desktop:dev` fail every call. Tauri's HTTP
 * plugin issues the request from Rust, where CORS and the webview CSP do not apply; the
 * reachable hosts are the `http:default` allowlist in `src-tauri/capabilities/main.json`.
 *
 * A packaged build keeps plain `fetch`: it serves from `tauri://localhost`, which production
 * already trusts. Also false under vitest (no Tauri globals), so tests can stub `fetch`.
 */
function crossesOrigins(): boolean {
  return import.meta.env.DEV && "__TAURI_INTERNALS__" in globalThis;
}

/**
 * `fetch` that names the failure. A dead/unreachable server rejects with an opaque
 * TypeError ("Load failed" in the Tauri webview), which tells nobody anything.
 */
async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await (crossesOrigins() ? tauriFetch(url, init) : fetch(url, init));
  } catch {
    throw new ApiError("Can't reach server", 0);
  }
}

export interface ServerTeam {
  id: string;
  workspaceId: string;
  name: string;
}

export interface PendingInvitation {
  id: string;
  workspaceId: string;
  workspaceName: string;
  role: "owner" | "admin" | "member";
  expiresAt: string;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  email?: string;
  role: "admin" | "member";
  joinedAt: string;
}

export interface WorkspaceMembership {
  id: string;
  workspaceId: string;
  userId: string;
  email?: string;
  role: "owner" | "admin" | "member";
  status: "active" | "suspended";
  joinedAt: string;
}

export interface EnterprisePolicy {
  key: string;
  value: unknown;
  updatedAt: string;
}

/** A sign-in method on the account: "credential" = email/password, else a social provider. */
export interface LinkedAccount {
  provider: string;
  accountId?: string;
}

/** An authenticated account: its user plus the bearer token to act as it. */
export interface AuthResult {
  user: SessionUser;
  token: string;
}

/**
 * Stateless coordination client. There is no "active" session — every call carries the
 * token of the account it acts as, so any number of accounts stay usable at once. Callers
 * hold the tokens (one per org / per account) and pass the right one per request.
 */
export class ApiClient {
  /** Tests pin a URL; the app leaves it unset so every call follows the current server. */
  constructor(private readonly pinnedBaseUrl?: string) {}

  private get baseUrl(): string {
    return this.pinnedBaseUrl ?? apiBaseUrl();
  }

  /** Browser URL that starts OAuth. `redirect` is the app's loopback URL for the token. */
  socialSignInUrl(provider: string, redirect?: string): string {
    const query = redirect ? `&redirect=${encodeURIComponent(redirect)}` : "";
    return `${this.baseUrl}/api/auth/desktop/start?provider=${encodeURIComponent(provider)}${query}`;
  }

  private async request<T>(
    token: string | null,
    path: string,
    init: RequestInit = {},
    workspaceId?: string
  ): Promise<T> {
    const response = await apiFetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
        ...init.headers
      }
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      message?: string;
    };
    if (!response.ok) {
      throw new ApiError(
        body.error?.message ?? body.message ?? `Request failed (${response.status})`,
        response.status
      );
    }
    return body as T;
  }

  /** Email/password sign-up. Same better-auth store as the web app, so the account works on both. */
  async signUpEmail(name: string, email: string, password: string): Promise<AuthResult> {
    return this.authenticate(`${this.baseUrl}/api/auth/sign-up/email`, { name, email, password });
  }

  /** Email/password sign-in. The bearer plugin returns the session token in a header. */
  async signInEmail(email: string, password: string): Promise<AuthResult> {
    return this.authenticate(`${this.baseUrl}/api/auth/sign-in/email`, { email, password });
  }

  private async authenticate(url: string, payload: Record<string, string>): Promise<AuthResult> {
    const response = await apiFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = (await response.json().catch(() => ({}))) as {
      user?: SessionUser;
      message?: string;
    };
    if (!response.ok || !body.user) {
      throw new Error(body.message ?? "Authentication failed");
    }
    const token = response.headers.get("set-auth-token");
    if (!token) throw new Error("Server did not return a session token");
    return { user: body.user, token };
  }

  /** Verify a token (e.g. one delivered by the deep-link callback) and load its account. */
  async resumeSession(token: string): Promise<AuthResult | null> {
    const response = await apiFetch(`${this.baseUrl}/api/auth/get-session`, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as { user?: SessionUser } | null;
    if (!body?.user) return null;
    return { user: body.user, token };
  }

  listWorkspaces(token: string): Promise<{ workspaces: ServerWorkspace[] }> {
    return this.request(token, "/api/workspaces");
  }

  /** An account's linked sign-in methods (email/password + social providers). */
  async listAccounts(token: string | null): Promise<LinkedAccount[]> {
    if (!token) return [];
    const response = await apiFetch(`${this.baseUrl}/api/auth/list-accounts`, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok) return [];
    // better-auth spells the field "providerId" (older builds: "provider"). Normalize and
    // dedupe so one method = one row (no mystery repeated dots).
    const body = (await response.json().catch(() => [])) as { provider?: string; providerId?: string }[];
    if (!Array.isArray(body)) return [];
    const providers = new Set<string>();
    for (const account of body) {
      const provider = account.provider ?? account.providerId;
      if (provider) providers.add(provider);
    }
    return [...providers].map((provider) => ({ provider }));
  }

  /** Members of a workspace (admin view). */
  listMemberships(token: string, organizationId: string): Promise<{ memberships: WorkspaceMembership[] }> {
    return this.request(token, "/api/memberships", {}, organizationId);
  }

  /** Remove a member from the workspace (admin only; owner cannot be removed). */
  removeMember(token: string, organizationId: string, userId: string): Promise<{ ok: true }> {
    return this.request(
      token,
      `/api/memberships/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
      organizationId
    );
  }

  /** Invite someone to the workspace by email. */
  createWorkspaceInvitation(
    token: string,
    organizationId: string,
    email: string,
    role: "admin" | "member"
  ): Promise<{ invitation: { id: string; email: string } }> {
    return this.request(
      token,
      "/api/invitations",
      { method: "POST", body: JSON.stringify({ email, role }) },
      organizationId
    );
  }

  createWorkspace(token: string, name: string): Promise<{ workspace: ServerWorkspace }> {
    return this.request(token, "/api/workspaces", { method: "POST", body: JSON.stringify({ name }) });
  }

  /** The single plan ($/team/month) and how many teams are free. */
  plan(token: string): Promise<{ plan: PricingPlan }> {
    return this.request(token, "/api/plan");
  }

  /**
   * Start checkout for a workspace that wants teams beyond the free tier. Returns the URL to open in
   * a browser; the license activates once the webhook lands, so callers re-list on return.
   */
  checkout(token: string, organizationId: string): Promise<{ url: string }> {
    return this.request(
      token,
      "/api/checkout",
      { method: "POST", body: JSON.stringify({ workspaceId: organizationId }) },
      organizationId
    );
  }

  /**
   * Dev-only: when the server runs Stripe in stub mode the checkout URL carries the completed
   * event as a query param; replay it against the webhook so the workspace provisions without a real
   * browser round-trip. Returns false for real (non-stub) URLs — open those in a browser.
   * ponytail: dev shortcut, gated on the stub_event marker the stub billing adds.
   */
  async completeStubCheckout(url: string): Promise<boolean> {
    const event = new URL(url).searchParams.get("stub_event");
    if (!event) return false;
    await apiFetch(`${this.baseUrl}/api/stripe/webhook`, {
      method: "POST",
      body: decodeURIComponent(event)
    });
    return true;
  }

  renameWorkspace(
    token: string,
    organizationId: string,
    name: string
  ): Promise<{ workspace: ServerWorkspace }> {
    return this.request(
      token,
      "/api/workspaces",
      { method: "PATCH", body: JSON.stringify({ name }) },
      organizationId
    );
  }

  deleteWorkspace(token: string, organizationId: string): Promise<{ ok: boolean }> {
    return this.request(token, "/api/workspaces", { method: "DELETE" }, organizationId);
  }

  /** Pending workspace-level invitations (admin view). */
  listWorkspaceInvitations(
    token: string,
    organizationId: string
  ): Promise<{ invitations: { id: string; email: string; role: string; expiresAt: string }[] }> {
    return this.request(token, "/api/workspaces/invitations", {}, organizationId);
  }

  /** Pending invites for the account's email. */
  myInvitations(token: string): Promise<{ invitations: PendingInvitation[] }> {
    return this.request(token, "/api/invitations/mine");
  }

  acceptMyInvitation(
    token: string,
    invitationId: string
  ): Promise<{ membership: { workspaceId: string } }> {
    return this.request(token, "/api/invitations/mine/accept", {
      method: "POST",
      body: JSON.stringify({ invitationId })
    });
  }

  listTeams(token: string, organizationId: string): Promise<{ teams: ServerTeam[] }> {
    return this.request(token, "/api/teams", {}, organizationId);
  }

  listPolicies(
    token: string,
    organizationId: string
  ): Promise<{ policies: EnterprisePolicy[] }> {
    return this.request(token, "/api/policies", {}, organizationId);
  }

  putPolicy(
    token: string,
    organizationId: string,
    key: string,
    value: unknown
  ): Promise<{ policy: EnterprisePolicy }> {
    return this.request(
      token,
      `/api/policies/${encodeURIComponent(key)}`,
      { method: "PUT", body: JSON.stringify({ value }) },
      organizationId
    );
  }

  reportControl(
    token: string,
    organizationId: string,
    report: Record<string, unknown>
  ): Promise<{ accepted: true }> {
    return this.request(
      token,
      "/api/control/report",
      { method: "POST", body: JSON.stringify(report) },
      organizationId
    );
  }

  createTeam(token: string, organizationId: string, name: string): Promise<{ team: ServerTeam }> {
    return this.request(
      token,
      "/api/teams",
      { method: "POST", body: JSON.stringify({ name }) },
      organizationId
    );
  }

  startTeamTrial(
    token: string,
    organizationId: string
  ): Promise<{ license: { features: string[]; expiresAt: string | null } }> {
    return this.request(token, "/api/team/trial", { method: "POST" }, organizationId);
  }

  listTeamMembers(
    token: string,
    organizationId: string,
    teamId: string
  ): Promise<{ members: TeamMember[] }> {
    return this.request(token, `/api/teams/${teamId}/members`, {}, organizationId);
  }

  createTeamInvitation(
    token: string,
    organizationId: string,
    teamId: string,
    email: string,
    role: "admin" | "member"
  ): Promise<{ invitation: { token: string; email: string } }> {
    return this.request(
      token,
      `/api/teams/${teamId}/invitations`,
      { method: "POST", body: JSON.stringify({ email, role }) },
      organizationId
    );
  }

  setTeamMemberRole(
    token: string,
    organizationId: string,
    teamId: string,
    userId: string,
    role: "admin" | "member"
  ): Promise<{ member: TeamMember }> {
    return this.request(
      token,
      `/api/teams/${teamId}/members/${encodeURIComponent(userId)}/role`,
      { method: "POST", body: JSON.stringify({ role }) },
      organizationId
    );
  }

  acceptTeamInvitation(token: string, inviteToken: string): Promise<{ member: TeamMember }> {
    return this.request(token, "/api/team-invitations/accept", {
      method: "POST",
      body: JSON.stringify({ token: inviteToken })
    });
  }

  async workItemRuntime(
    token: string,
    organizationId: string,
    workItemId: string
  ): Promise<{ runtime: WorkItemRuntimeState }> {
    const result = await this.request<{ runtime: ServerWorkItemRuntimeState }>(
      token,
      `/api/work-items/${encodeURIComponent(workItemId)}/runtime`,
      {},
      organizationId
    );
    return { runtime: localRuntime(result.runtime) };
  }

  async commandWorkItem(
    token: string,
    organizationId: string,
    workItemId: string,
    command: WorkItemCommand
  ): Promise<{ runtime: WorkItemRuntimeState }> {
    const result = await this.request<{ runtime: ServerWorkItemRuntimeState }>(
      token,
      `/api/work-items/${encodeURIComponent(workItemId)}/runtime`,
      { method: "POST", body: JSON.stringify(command) },
      organizationId
    );
    return { runtime: localRuntime(result.runtime) };
  }

}
