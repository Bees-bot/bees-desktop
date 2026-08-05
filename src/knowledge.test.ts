import { describe, expect, it } from "vitest";
import { knowledgeConnection, parseKnowledgePolicy } from "./knowledge.js";

describe("knowledge policy", () => {
  it("accepts only HTTPS for the single remote URL", () => {
    expect(parseKnowledgePolicy({ mode: "remote", url: "https://knowledge.example/mcp" })).toEqual({
      mode: "remote",
      url: "https://knowledge.example/mcp"
    });
    expect(() => parseKnowledgePolicy({ mode: "remote", url: "http://knowledge.example/mcp" })).toThrow(
      "must use HTTPS"
    );
    expect(() => parseKnowledgePolicy({ mode: "remote", url: "https://user:pass@knowledge.example/mcp" })).toThrow(
      "token field"
    );
  });

  it("creates one required read-only MCP tool for a team", () => {
    const connection = knowledgeConnection("team-a", "http://127.0.0.1:18788/mcp");
    expect(connection.id).toBe("knowledge");
    expect(connection.teamId).toBe("team-a");
    expect(connection.allowedTools).toEqual(["knowledge_search"]);
    expect(connection.tools[0]?.readOnly).toBe(true);
    expect(connection.optional).toBe(false);
  });
});
