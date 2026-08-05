import { describe, expect, it } from "vitest";
import type { McpConnection } from "../src/domain.js";
import {
  mcpConnectionForAgent,
  newMcpConnection,
  withMcpHealth
} from "../src/connections.js";

function connection(): McpConnection {
  return {
    id: "connection-1",
    teamId: "team-1",
    name: "Tasks",
    url: "https://mcp.example.com/",
    transport: "streamable-http",
    authType: "api-key",
    secretRef: "secret-1",
    optional: false,
    tools: [
      { name: "read", description: "Read", readOnly: true },
      { name: "write", description: "Write", readOnly: false }
    ],
    allowedTools: ["read", "write"],
    checkedAt: null,
    lastError: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z"
  };
}

describe("MCP connections", () => {
  it("requires encryption for non-loopback servers", () => {
    expect(() =>
      newMcpConnection({
        teamId: "team-1",
        name: "Unsafe",
        url: "http://mcp.example.com",
        authType: "api-key"
      })
    ).toThrow("must use HTTPS");
  });

  it("intersects an agent allowlist with the connection owner's allowlist", () => {
    const selected = mcpConnectionForAgent(connection(), {
      prompt: "Work.",
      mcpToolRefs: { "connection-1": ["write", "not-in-catalog"] }
    });
    expect(selected.allowedTools).toEqual(["write"]);
  });

  it("drops stale allowlist entries after discovery", () => {
    expect(
      withMcpHealth(connection(), [{ name: "read", description: "Read", readOnly: true }])
        .allowedTools
    ).toEqual(["read"]);
  });
});
