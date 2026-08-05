// AI provider connection metadata for an organization. Rust stores credentials in the
// operating-system credential vault; SQLite and synchronized metadata keep only `secretRef`.
//
// Codex and Claude Code are not here: they are driven through the CLIs the user has
// installed (see cli-tools.ts and .flue/cli-provider.ts), which own their own login.

export type AiProvider = "opencode-go" | "openrouter" | "openai" | "anthropic";

export type ApiKeyProvider = AiProvider;

export interface AiConnection {
  id: string;
  provider: AiProvider;
  label: string;
  createdAt: string;
  secretRef: string;
}

export const AI_PROVIDER_LABEL: Record<AiProvider, string> = {
  "opencode-go": "OpenCode Go",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic"
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

function newConnection(provider: AiProvider, label: string): AiConnection {
  return {
    id: crypto.randomUUID(),
    provider,
    label,
    secretRef: crypto.randomUUID(),
    createdAt: new Date().toISOString()
  };
}

// ---- Pasted API key, no OAuth ----

export function connectApiKey(
  provider: ApiKeyProvider,
  apiKey: string
): { connection: AiConnection; secret: string } {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("API key is required");
  return { connection: newConnection(provider, AI_PROVIDER_LABEL[provider]), secret: trimmed };
}
