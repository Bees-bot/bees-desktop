import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
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

/**
 * The tools the server exposes right now.
 *
 * `connection.tools` is only a record of the last check. DSH refuses a whole submission when the
 * allowlist names a tool the server has since dropped, and scrubs the reason on the way out, so
 * anything about to run asks the server again rather than trusting that record.
 */
export async function discoverMcpTools(
  connection: McpConnection,
  runtime: { baseUrl: string; token: string }
): Promise<McpTool[]> {
  const response = await tauriFetch(`${runtime.baseUrl}/connections/discover`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${runtime.token}` },
    // A public API has nothing in the vault, so it is asked for nothing.
    body: JSON.stringify(
      connection.authType === "none" ? { ...connection, secretRef: undefined } : connection
    )
  });
  const body = (await response.json()) as { tools?: McpTool[]; error?: string };
  if (!response.ok || !body.tools)
    throw new Error(body.error ?? `HTTP ${response.status}`);
  return body.tools;
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
  const chosen = config.mcpToolRefs?.[connection.id];
  // A tool the owner disallows is a refusal and stays refused. A name the server no longer
  // exposes at all is stale config, not a decision: once every name in the subset has gone that
  // way, the agent follows the connection's own allowlist instead of falling silent.
  const stale = Boolean(chosen?.length)
    && chosen!.every((name) => !connection.tools.some((tool) => tool.name === name));
  const selected = chosen && !stale ? chosen : connection.allowedTools;
  return {
    ...connection,
    url: secureMcpUrl(connection.url),
    allowedTools: selected.filter((name) => connection.allowedTools.includes(name))
  };
}
