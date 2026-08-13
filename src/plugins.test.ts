import { describe, expect, it } from "vitest";
import { AGENT_PLUGIN_MCP_SCHEMA, AGENT_PLUGIN_SCHEMA, parseAgentPlugin, pluginMcpConnections } from "./plugins.js";

const manifest = { $schema: AGENT_PLUGIN_SCHEMA, name: "acme-tools", version: "1.0.0" } as const;

describe("Agent Plugins 1.0.0", () => {
  it("loads valid Agent Skills and supported MCP transports", () => {
    const plugin = parseAgentPlugin({
      manifest,
      skills: [{
        directory: "summarize",
        path: "skills/summarize/SKILL.md",
        contents: `---\nname: summarize\ndescription: Summarize documents when a concise brief is requested.\nmetadata:\n  author: acme\n---\n\nSummarize the supplied documents.`
      }],
      mcp: {
        $schema: AGENT_PLUGIN_MCP_SCHEMA,
        mcpServers: {
          remote: {
            type: "streamable-http",
            url: "https://tools.example.com/mcp",
            headers: { "X-Tenant": "public", "Mcp-Protocol-Version": "package-value" }
          },
          legacy: { type: "sse", url: "http://127.1.2.3/sse" }
        }
      },
      issues: [],
      fileCount: 3
    });

    expect(plugin.skills).toMatchObject([{ name: "summarize", description: expect.stringContaining("brief") }]);
    expect(plugin.mcpServers.map(({ name, transport }) => [name, transport])).toEqual([
      ["remote", "streamable-http"],
      ["legacy", "sse"]
    ]);
    expect(plugin.mcpServers[0]?.headers).toEqual({ "X-Tenant": "public" });
    expect(plugin.issues).toEqual([]);
  });

  it("keeps a skill carrying frontmatter Bees does not read", () => {
    const skill = (directory: string, extra: string) => ({
      directory,
      path: `skills/${directory}/SKILL.md`,
      contents: `---\nname: ${directory}\ndescription: Describe the ${directory} procedure this team follows.\n${extra}---\n\nFollow the procedure.`
    });
    const plugin = parseAgentPlugin({
      manifest,
      skills: [skill("versioned", "version: 2.1.0\n"), skill("annotated", "author: acme\nstatus: draft\n")],
      mcp: null,
      issues: [],
      fileCount: 2
    });

    expect(plugin.skills.map(({ name }) => name)).toEqual(["versioned", "annotated"]);
    // `version` is common enough to pass quietly; anything else is reported but kept.
    expect(plugin.issues).toEqual([
      "skills/annotated/SKILL.md: ignored unknown frontmatter field(s): author, status."
    ]);
  });

  it("accepts the Agent Skills description boundary and isolates an overflow", () => {
    const plugin = parseAgentPlugin({
      manifest,
      skills: [
        {
          directory: "valid",
          path: "skills/valid/SKILL.md",
          contents: `---\nname: valid\ndescription: ${"x".repeat(1_024)}\n---\n`
        },
        {
          directory: "overflow",
          path: "skills/overflow/SKILL.md",
          contents: `---\nname: overflow\ndescription: ${"x".repeat(1_025)}\n---\n`
        }
      ],
      mcp: null,
      issues: [],
      fileCount: 3
    });
    expect(plugin.skills.map(({ name }) => name)).toEqual(["valid"]);
    expect(plugin.issues).toHaveLength(1);
  });

  it("isolates invalid skills and MCP entries", () => {
    const plugin = parseAgentPlugin({
      manifest,
      skills: [
        {
          directory: "valid",
          path: "skills/valid/SKILL.md",
          contents: "---\nname: valid\ndescription: Valid skill\n---\n\nUse it."
        },
        {
          directory: "wrong-folder",
          path: "skills/wrong-folder/SKILL.md",
          contents: "---\nname: another-name\ndescription: Invalid skill\n---\n\nSkip it."
        }
      ],
      mcp: {
        $schema: AGENT_PLUGIN_MCP_SCHEMA,
        mcpServers: {
          local: { type: "streamable-http", url: "http://localhost:8080/mcp" },
          stdio: { type: "stdio", command: "node", args: ["server.js"] },
          unsafe: { type: "streamable-http", url: "http://example.com/mcp" },
          extra: { type: "sse", url: "https://example.com/sse", token: "not-portable" }
        }
      },
      issues: [],
      fileCount: 5
    });

    expect(plugin.skills.map(({ name }) => name)).toEqual(["valid"]);
    expect(plugin.mcpServers.map(({ name }) => name)).toEqual(["local"]);
    expect(plugin.issues).toHaveLength(4);
  });

  it("disables only MCP when its top-level document is invalid", () => {
    const plugin = parseAgentPlugin({
      manifest,
      skills: [{
        directory: "valid",
        path: "skills/valid/SKILL.md",
        contents: "---\nname: valid\ndescription: Valid skill\n---\n"
      }],
      mcp: { $schema: AGENT_PLUGIN_MCP_SCHEMA, mcpServers: {}, extra: true },
      issues: [],
      fileCount: 3
    });
    expect(plugin.skills).toHaveLength(1);
    expect(plugin.mcpServers).toEqual([]);
    expect(plugin.issues[0]).toContain("MCP was disabled");
  });

  // `invoke<T>` asserts its return type without checking it, so a backend command that fails to
  // build a package resolves with null. Reading `.issues` off that threw
  // `Cannot read properties of null` from three frames away; it names the problem now.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an array", []],
    ["a string", "boom"],
    ["a package with no manifest", { skills: [], issues: [], fileCount: 0 }],
    ["a package whose skills are not a list", { manifest, skills: null, issues: [], fileCount: 0 }],
    ["a package whose issues are not a list", { manifest, skills: [], issues: null, fileCount: 0 }],
    ["a package with no file count", { manifest, skills: [], issues: [] }]
  ])("rejects %s by name rather than failing later", (_label, value) => {
    expect(() => parseAgentPlugin(value)).toThrow("unreadable plugin package");
  });

  it("skips an unreadable skill entry and keeps the rest of the package", () => {
    const plugin = parseAgentPlugin({
      manifest,
      skills: [
        null,
        { directory: "valid", path: "skills/valid/SKILL.md", contents: "---\nname: valid\ndescription: Valid skill\n---\n" }
      ],
      mcp: null,
      issues: [],
      fileCount: 2
    });
    expect(plugin.skills.map(({ name }) => name)).toEqual(["valid"]);
    expect(plugin.issues).toEqual(["A skill entry was unreadable and was skipped."]);
  });

  it("creates stable optional runtime connections without embedded credentials", () => {
    const registry = {
      id: "11111111-1111-1111-1111-111111111111",
      teamId: "team",
      name: "acme-tools",
      sourcePath: "/plugins/acme",
      plugin: {
        manifest,
        skills: [],
        mcpServers: [{
          name: "remote",
          transport: "streamable-http" as const,
          url: "https://tools.example.com/mcp",
          headers: { "X-Tenant": "public" }
        }],
        issues: [],
        fileCount: 2
      },
      copiedAt: "",
      createdAt: "",
      updatedAt: ""
    };
    const [connection] = pluginMcpConnections([registry], "team");
    expect(connection).toMatchObject({
      id: "plugin-11111111-1111-1111-1111-111111111111-c78d7953",
      authType: "none",
      secretRef: "",
      allTools: true,
      optional: true
    });
  });
});
