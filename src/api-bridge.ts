import { invoke } from "@tauri-apps/api/core";
import type { McpConnection } from "./domain.js";

/** The same connection, addressed at its bridge. Starting is idempotent. */
export async function withBridgeUrl(connection: McpConnection): Promise<McpConnection> {
  const bridge = connection.bridge;
  if (!bridge) return connection;
  const url = await invoke<string>("ensure_api_bridge", {
    request: {
      connectionId: connection.id,
      ...bridge,
      secretRef: connection.authType === "none" ? undefined : connection.secretRef
    }
  });
  return { ...connection, url };
}
