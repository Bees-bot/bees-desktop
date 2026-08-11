import { describe, expect, it } from "vitest";
import type { AgentConfig, McpConnection } from "./domain.js";
import { mcpConnectionForAgent, toolPickableConnections } from "./connections.js";

function connection(overrides: Partial<McpConnection>): McpConnection {
  return {
    id: "salesforce",
    teamId: "team",
    name: "Salesforce",
    url: "https://mcp.example.com/mcp",
    transport: "streamable-http",
    authType: "api-key",
    secretRef: "secret",
    headers: {},
    allTools: false,
    optional: false,
    tools: [
      { name: "read_lead", description: "", readOnly: true },
      { name: "delete_lead", description: "", readOnly: false }
    ],
    allowedTools: ["read_lead", "delete_lead"],
    checkedAt: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

const config = (overrides: Partial<AgentConfig>): AgentConfig => ({ prompt: "", ...overrides });

describe("per-agent MCP tool subsets", () => {
  it("offers a picker only where the answer would mean something", () => {
    const connections = [
      connection({}),
      // Selected, but nothing discovered yet — a plugin server resolves its tools at run start.
      connection({ id: "plugin", tools: [], allowedTools: [] }),
      connection({ id: "unselected" })
    ];
    const pickable = toolPickableConnections(
      connections,
      config({ mcpConnectionRefs: ["salesforce", "plugin"] })
    );

    expect(pickable.map(({ id }) => id)).toEqual(["salesforce"]);
    // No agent, no prior selection: a brand new agent is asked nothing.
    expect(toolPickableConnections(connections, undefined)).toEqual([]);
  });

  it("narrows an agent to its own tools without widening the connection's allowlist", () => {
    const owner = connection({ allowedTools: ["read_lead"] });

    expect(mcpConnectionForAgent(owner, config({ mcpToolRefs: { salesforce: ["read_lead"] } })).allowedTools)
      .toEqual(["read_lead"]);
    // The agent asking for a tool its owner disallowed does not get it.
    expect(mcpConnectionForAgent(owner, config({ mcpToolRefs: { salesforce: ["delete_lead"] } })).allowedTools)
      .toEqual([]);
    // No per-agent subset recorded means the connection's own allowlist stands.
    expect(mcpConnectionForAgent(owner, config({})).allowedTools).toEqual(["read_lead"]);
  });
});
