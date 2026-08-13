import type { AgentConfig, McpConnection, McpTool } from "./domain.js";
import { requiredText } from "./domain.js";
import type { SettingsStore } from "./ai-connections.js";

const key = (teamId: string): string => `mcp_connections:${teamId}`;

function secureMcpUrl(value: string): string {
  const url = new URL(requiredText(value, "MCP URL", 2_048));
  const host = url.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "[::1]" || host === "::1" ||
    /^127(?:\.[0-9]{1,3}){3}$/.test(host);
  if (url.protocol !== "https:" && !loopback) {
    throw new Error("Remote MCP connections must use HTTPS");
  }
  return url.toString();
}

export async function listMcpConnections(
  store: SettingsStore,
  teamId: string
): Promise<McpConnection[]> {
  return store.getSetting<McpConnection[]>(key(teamId), []);
}

export async function saveMcpConnection(
  store: SettingsStore,
  connection: McpConnection
): Promise<void> {
  const list = await listMcpConnections(store, connection.teamId);
  const next = list.filter(({ id }) => id !== connection.id);
  await store.setSetting(key(connection.teamId), [...next, connection]);
}

export async function removeMcpConnection(
  store: SettingsStore,
  teamId: string,
  id: string
): Promise<void> {
  const list = await listMcpConnections(store, teamId);
  await store.setSetting(
    key(teamId),
    list.filter((connection) => connection.id !== id)
  );
}

export function newMcpConnection(input: {
  teamId: string;
  name: string;
  url: string;
  authType: McpConnection["authType"];
  transport?: McpConnection["transport"];
  optional?: boolean;
  bridge?: McpConnection["bridge"];
}): McpConnection {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    teamId: requiredText(input.teamId, "Team", 120),
    name: requiredText(input.name, "Connection name", 80),
    // A bridged connection has no address until its process starts, so there is none to check.
    url: input.bridge ? "" : secureMcpUrl(input.url),
    ...(input.bridge ? { bridge: input.bridge } : {}),
    transport: input.transport ?? "streamable-http",
    authType: input.authType,
    secretRef: crypto.randomUUID(),
    optional: input.optional ?? false,
    tools: [],
    allowedTools: [],
    checkedAt: null,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function withMcpHealth(
  connection: McpConnection,
  tools: McpTool[],
  error: string | null = null
): McpConnection {
  const available = new Set(tools.map(({ name }) => name));
  return {
    ...connection,
    url: secureMcpUrl(connection.url),
    tools,
    allowedTools: connection.allowedTools.filter((name) => available.has(name)),
    checkedAt: new Date().toISOString(),
    lastError: error,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Connections the agent editor can offer a per-agent tool subset for: ones this agent already
 * uses, whose tools Bees has discovered. A connection added in the same edit has no picker
 * yet and keeps the whole allowlist, so both the form and the save must agree on this list.
 */
export function toolPickableConnections(
  connections: McpConnection[],
  config: AgentConfig | undefined
): McpConnection[] {
  const selected = new Set(config?.mcpConnectionRefs ?? []);
  return connections.filter(({ id, tools }) => selected.has(id) && tools.length > 0);
}

/** Freeze one agent's narrower allowlist without widening the connection owner's policy. */
export function mcpConnectionForAgent(
  connection: McpConnection,
  config: AgentConfig
): McpConnection {
  if (connection.allTools) return { ...connection, url: secureMcpUrl(connection.url) };
  const selected = config.mcpToolRefs?.[connection.id] ?? connection.allowedTools;
  return {
    ...connection,
    url: secureMcpUrl(connection.url),
    allowedTools: selected.filter((name) => connection.allowedTools.includes(name))
  };
}
