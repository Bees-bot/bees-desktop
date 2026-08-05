import type { McpConnection, McpTool } from "./domain.js";
import type { SettingsStore } from "./ai-connections.js";
import { newMcpConnection } from "./connections.js";

export type KnowledgePolicy =
  | { mode: "local" }
  | { mode: "remote"; url: string };

export const KNOWLEDGE_POLICY_KEY = "knowledge";
export const KNOWLEDGE_CONNECTION_ID = "knowledge";
export const KNOWLEDGE_TOOL: McpTool = {
  name: "knowledge_search",
  description: "Search organization documents available to this team and return cited evidence.",
  readOnly: true
};

const settingKey = (organizationId: string): string => `knowledge_policy:${organizationId}`;

export function parseKnowledgePolicy(value: unknown): KnowledgePolicy | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.mode === "local") return { mode: "local" };
  if (candidate.mode !== "remote" || typeof candidate.url !== "string") return null;
  const url = new URL(candidate.url.trim());
  if (url.protocol !== "https:") throw new Error("The remote knowledge URL must use HTTPS");
  if (url.username || url.password) throw new Error("Put credentials in the token field, not the URL");
  if (url.hash) throw new Error("The remote knowledge URL cannot contain a fragment");
  return { mode: "remote", url: url.toString() };
}

export async function loadCachedKnowledgePolicy(
  store: SettingsStore,
  organizationId: string
): Promise<KnowledgePolicy | null> {
  return parseKnowledgePolicy(await store.getSetting<unknown>(settingKey(organizationId), null));
}

export async function cacheKnowledgePolicy(
  store: SettingsStore,
  organizationId: string,
  policy: KnowledgePolicy | null
): Promise<void> {
  await store.setSetting(settingKey(organizationId), policy);
}

export function isKnowledgeConnection(connection: McpConnection): boolean {
  return connection.id === KNOWLEDGE_CONNECTION_ID;
}

export function knowledgeConnection(
  teamId: string,
  url: string,
  existing?: McpConnection
): McpConnection {
  const base = existing ?? newMcpConnection({
    teamId,
    name: "Bees Knowledge",
    url,
    authType: "api-key"
  });
  const timestamp = new Date().toISOString();
  return {
    ...base,
    id: KNOWLEDGE_CONNECTION_ID,
    teamId,
    name: "Bees Knowledge",
    url,
    transport: "streamable-http",
    authType: "api-key",
    optional: false,
    tools: [KNOWLEDGE_TOOL],
    allowedTools: [KNOWLEDGE_TOOL.name],
    checkedAt: timestamp,
    lastError: null,
    updatedAt: timestamp
  };
}
