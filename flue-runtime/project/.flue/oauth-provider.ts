import type { AuthEvent, AuthPrompt, OAuthCredential } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { Hono } from "hono";

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

interface PendingLogin {
  /** Where the person finishes signing in to ChatGPT. */
  started: Promise<{ authUrl: string }>;
  result: Promise<OAuthCredential>;
  abort: AbortController;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function beginCodexLogin(): PendingLogin {
  const oauth = openaiCodexProvider().auth.oauth;
  if (!oauth) throw new Error("This pi-ai build has no Codex OAuth provider");
  const ready = deferred<{ authUrl: string }>();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error("Codex sign-in timed out")), LOGIN_TIMEOUT_MS);
  const result = oauth.login({
    signal: abort.signal,
    // Browser login, not device code. Device code is refused outright unless the ChatGPT
    // account has switched it on, and almost nobody has, so it turned every sign-in into a
    // dead end telling the person to go and change an account setting.
    prompt: async (prompt: AuthPrompt) => {
      if (prompt.type === "select") return "browser";
      // Browser login races a local callback server against a paste-the-code prompt. Bees has
      // nowhere to paste, and answering this at all — even by throwing — cancels the server
      // before the person has finished logging in. Leaving it unanswered lets the redirect win.
      if (prompt.type === "manual_code") return new Promise<string>(() => {});
      throw new Error(`Unexpected Codex OAuth prompt: ${prompt.type}`);
    },
    notify: (event: AuthEvent) => {
      if (event.type === "auth_url") ready.resolve({ authUrl: event.url });
    }
  }).finally(() => clearTimeout(timer));
  void result.catch(ready.reject);
  return { started: ready.promise, result, abort };
}

/** Convert pi-ai's credential to the local-store schema Rust refreshes on demand. */
export function storedCodexCredential(credential: OAuthCredential): string {
  return JSON.stringify({
    accessToken: credential.access,
    refreshToken: credential.refresh,
    expiresAt: Math.floor(credential.expires / 1000),
    tokenUrl: CODEX_TOKEN_URL,
    clientId: CODEX_CLIENT_ID
  });
}

let pending: PendingLogin | null = null;

export const oauthProviderRoutes = new Hono();

oauthProviderRoutes.post("/oauth/openai-codex/start", async (context) => {
  pending ??= beginCodexLogin();
  const current = pending;
  try {
    return context.json(await current.started);
  } catch (error) {
    if (pending === current) pending = null;
    return context.json({ error: (error as Error).message }, 502);
  }
});

oauthProviderRoutes.post("/oauth/openai-codex/await", async (context) => {
  const current = pending;
  if (!current) return context.json({ error: "No Codex sign-in is in progress" }, 409);
  try {
    const credential = storedCodexCredential(await current.result);
    return context.json({ credential });
  } catch (error) {
    return context.json({ error: (error as Error).message }, 502);
  } finally {
    current.abort.abort();
    if (pending === current) pending = null;
  }
});
