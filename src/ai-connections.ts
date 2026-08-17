// AI provider connection metadata for an organization. Rust stores credentials in the
// operating-system credential vault; SQLite and synchronized metadata keep only `secretRef`.
//
// Claude Code remains an optional agent runtime. Codex is a normal pi-ai provider whose
// ChatGPT OAuth credential is stored in the same OS vault as API keys.

import { invoke } from "@tauri-apps/api/core";

export type AiProvider =
  | "opencode-go"
  | "openrouter"
  | "openai-codex"
  | "openai"
  | "anthropic"
  | "google"
  | "mistral"
  | "groq"
  | "deepseek"
  | "xai"
  | "cerebras"
  | "together"
  | "fireworks"
  | "openai-compatible";

export type OAuthProvider = "openai-codex";
export type ApiKeyProvider = Exclude<AiProvider, OAuthProvider>;

export interface AiConnection {
  id: string;
  provider: AiProvider;
  label: string;
  createdAt: string;
  secretRef: string;
  /** Non-secret endpoint for a generic OpenAI-compatible connection. */
  baseUrl?: string;
}

export const AI_PROVIDER_LABEL: Record<AiProvider, string> = {
  "opencode-go": "OpenCode Go",
  openrouter: "OpenRouter",
  "openai-codex": "Codex (ChatGPT)",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  mistral: "Mistral",
  groq: "Groq",
  deepseek: "DeepSeek",
  xai: "xAI",
  cerebras: "Cerebras",
  together: "Together AI",
  fireworks: "Fireworks AI",
  "openai-compatible": "OpenAI-compatible"
};

/** Minimal slice of the repository this module needs — avoids an import cycle. */
export interface SettingsStore {
  getSetting<T>(key: string, fallback: T): Promise<T>;
  setSetting(key: string, value: unknown): Promise<void>;
}

const key = (orgId: string): string => `ai_connections:${orgId}`;

export async function listAiConnections(store: SettingsStore, orgId: string): Promise<AiConnection[]> {
  return store.getSetting<AiConnection[]>(key(orgId), []);
}

/** Stored connection ids whose credential is still present in this machine's OS vault. */
export async function availableAiConnectionIds(orgId: string): Promise<Set<string>> {
  return new Set(await invoke<string[]>("available_ai_connection_ids", { organizationId: orgId }));
}

export async function addAiConnection(
  store: SettingsStore,
  orgId: string,
  connection: AiConnection
): Promise<void> {
  const list = await listAiConnections(store, orgId);
  await store.setSetting(key(orgId), [...list, connection]);
}

export async function removeAiConnection(store: SettingsStore, orgId: string, id: string): Promise<void> {
  const list = await listAiConnections(store, orgId);
  await store.setSetting(
    key(orgId),
    list.filter((connection) => connection.id !== id)
  );
}

function newConnection(provider: AiProvider, label: string, baseUrl?: string): AiConnection {
  return {
    id: crypto.randomUUID(),
    provider,
    label,
    secretRef: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...(baseUrl ? { baseUrl } : {})
  };
}

// ---- Pasted API key, no OAuth ----

export function connectApiKey(
  provider: ApiKeyProvider,
  apiKey: string,
  baseUrl?: string
): { connection: AiConnection; secret: string } {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("API key is required");
  let endpoint: string | undefined;
  if (provider === "openai-compatible") {
    const raw = baseUrl?.trim();
    if (!raw) throw new Error("Base URL is required");
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error("Base URL must be a valid http:// or https:// URL");
    }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error("Base URL must be a valid http:// or https:// URL without credentials");
    }
    endpoint = parsed.toString().replace(/\/$/, "");
  }
  return {
    connection: newConnection(provider, AI_PROVIDER_LABEL[provider], endpoint),
    secret: trimmed
  };
}

/** Persist a provider-owned OAuth credential without treating it as an API key. */
export function connectOAuthCredential(
  provider: OAuthProvider,
  credential: string
): { connection: AiConnection; secret: string } {
  if (!credential.trim()) throw new Error("OAuth credential is required");
  return {
    connection: newConnection(provider, AI_PROVIDER_LABEL[provider]),
    secret: credential
  };
}
