import { parseDocument } from "yaml";
import type {
  AgentPluginManifest,
  AgentPluginMcpServer,
  AgentPluginPackage,
  AgentPluginSkill,
  McpConnection,
  Registry
} from "./domain.js";

export const AGENT_PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json" as const;
export const AGENT_PLUGIN_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json" as const;

export interface RawAgentPluginSkill {
  directory: string;
  path: string;
  contents: string;
}

export interface RawAgentPluginPackage {
  manifest: AgentPluginManifest;
  skills: RawAgentPluginSkill[];
  mcp: unknown | null;
  issues: string[];
  fileCount: number;
}

// `version` is not an Agent Skills field, but published skills carry it often enough that
// warning about it would be noise rather than news.
const skillFields = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools", "version"]);
const clientHeaders = new Set([
  "accept",
  "authorization",
  "content-type",
  "last-event-id",
  "mcp-method",
  "mcp-name",
  "mcp-protocol-version",
  "mcp-session-id"
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function skill(raw: RawAgentPluginSkill, issues: string[]): AgentPluginSkill {
  const match = raw.contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error("SKILL.md must contain closed YAML frontmatter");
  const [, frontmatterText = "", body = ""] = match;
  const document = parseDocument(frontmatterText, { uniqueKeys: true });
  const firstError = document.errors[0];
  if (firstError) throw new Error(`invalid YAML: ${firstError.message}`);
  const frontmatter = record(document.toJS());
  if (!frontmatter) throw new Error("frontmatter must be a YAML mapping");
  // A field Bees does not read is not a reason to drop the skill. Published skills carry
  // authoring metadata the Agent Skills specification does not define, and refusing them
  // loses working instructions over a line Bees would have ignored anyway.
  const unknown = Object.keys(frontmatter).filter((key) => !skillFields.has(key));
  if (unknown.length) {
    issues.push(`${raw.path}: ignored unknown frontmatter field(s): ${unknown.join(", ")}.`);
  }

  const name = frontmatter.name;
  const description = frontmatter.description;
  if (typeof name !== "string" || !name.trim()) throw new Error("name must be a non-empty string");
  if (typeof description !== "string" || !description.trim()) throw new Error("description must be a non-empty string");
  const normalized = name.trim().normalize("NFKC");
  if (
    [...normalized].length > 64 ||
    normalized !== normalized.toLowerCase() ||
    normalized.startsWith("-") ||
    normalized.endsWith("-") ||
    normalized.includes("--") ||
    !/^[\p{L}\p{N}-]+$/u.test(normalized)
  ) throw new Error("name does not satisfy the Agent Skills naming rules");
  if (raw.directory.normalize("NFKC") !== normalized) throw new Error("name must match its parent directory");
  if ([...description.trim()].length > 1_024) throw new Error("description exceeds 1024 characters");
  if (frontmatter.license !== undefined && typeof frontmatter.license !== "string") {
    throw new Error("license must be a string");
  }
  if (frontmatter.compatibility !== undefined && (
    typeof frontmatter.compatibility !== "string" ||
    !frontmatter.compatibility.length ||
    [...frontmatter.compatibility].length > 500
  )) throw new Error("compatibility must be a 1-500 character string");
  if (frontmatter["allowed-tools"] !== undefined && typeof frontmatter["allowed-tools"] !== "string") {
    throw new Error("allowed-tools must be a string");
  }
  if (frontmatter.metadata !== undefined) {
    const metadata = record(frontmatter.metadata);
    if (!metadata || Object.values(metadata).some((value) => typeof value !== "string")) {
      throw new Error("metadata must map string keys to string values");
    }
  }
  return {
    path: raw.path,
    name: normalized,
    description: description.trim(),
    instructions: body.trim()
  };
}

function httpUrl(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("url must be a non-empty string");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("url must be an absolute HTTP(S) URL without user information or a fragment");
  }
  const host = url.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "[::1]" || host === "::1" ||
    /^127(?:\.[0-9]{1,3}){3}$/.test(host);
  if (url.protocol !== "https:" && !loopback) throw new Error("non-loopback MCP URLs must use HTTPS");
  return url.toString();
}

function headers(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  const input = record(value);
  if (!input) throw new Error("headers must be an object of strings");
  const seen = new Set<string>();
  const safe: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(input)) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) throw new Error(`header ${name} is duplicated with different casing`);
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof headerValue !== "string" || /[\0\r\n]/.test(headerValue)) {
      throw new Error(`header ${name} is not a valid literal HTTP header`);
    }
    seen.add(lower);
    // The standard gives client-generated HTTP/MCP/auth headers precedence. The MCP SDK
    // merges static headers last, so omit those names here and let the transport own them.
    if (!clientHeaders.has(lower)) safe[name] = headerValue;
  }
  return safe;
}

function mcpServers(value: unknown, issues: string[]): AgentPluginMcpServer[] {
  if (value === null) return [];
  const config = record(value);
  if (!config) {
    issues.push("mcp.json: top level must be a JSON object; MCP was disabled.");
    return [];
  }
  const unknown = Object.keys(config).filter((key) => !["$schema", "mcpServers"].includes(key));
  if (config.$schema !== AGENT_PLUGIN_MCP_SCHEMA || !record(config.mcpServers) || unknown.length) {
    issues.push("mcp.json: invalid or unsupported top-level Agent Plugins 1.0.0 configuration; MCP was disabled.");
    return [];
  }
  return Object.entries(config.mcpServers as Record<string, unknown>).flatMap(([name, value]) => {
    const server = record(value);
    if (!server || typeof server.type !== "string") {
      issues.push(`mcp.json ${name}: server must be an object with a type; entry was skipped.`);
      return [];
    }
    if (server.type === "stdio") {
      issues.push(`mcp.json ${name}: Bees does not support stdio plugin servers; entry was skipped.`);
      return [];
    }
    if (!["streamable-http", "sse"].includes(server.type)) {
      issues.push(`mcp.json ${name}: unsupported transport ${server.type}; entry was skipped.`);
      return [];
    }
    const extra = Object.keys(server).filter((key) => !["type", "url", "headers"].includes(key));
    try {
      if (extra.length) throw new Error(`unknown field(s): ${extra.join(", ")}`);
      return [{
        name,
        transport: server.type as AgentPluginMcpServer["transport"],
        url: httpUrl(server.url),
        headers: headers(server.headers)
      }];
    } catch (error) {
      issues.push(`mcp.json ${name}: ${error instanceof Error ? error.message : String(error)}; entry was skipped.`);
      return [];
    }
  });
}

function rawSkill(value: unknown): RawAgentPluginSkill | null {
  const entry = record(value);
  return entry && typeof entry.path === "string" && typeof entry.contents === "string"
    ? { directory: String(entry.directory ?? ""), path: entry.path, contents: entry.contents }
    : null;
}

/**
 * Takes `unknown` because `invoke<T>` asserts T without checking it: a command that failed to build
 * a package resolved null, and reading `.issues` off that threw three frames away. Throws rather
 * than substituting an empty package, which would install nothing and report success.
 */
export function parseAgentPlugin(value: unknown): AgentPluginPackage {
  const raw = record(value);
  const manifest = record(raw?.manifest);
  if (
    !raw || !manifest
    || typeof manifest.$schema !== "string" || typeof manifest.name !== "string"
    || !Array.isArray(raw.skills) || !Array.isArray(raw.issues)
    || typeof raw.fileCount !== "number"
  )
    throw new Error("The installer returned an unreadable plugin package.");

  const issues = raw.issues.filter((issue): issue is string => typeof issue === "string");
  // Screened before `skill` runs: the catch reports by path, and an entry without one would throw twice.
  const skills = raw.skills.flatMap((entry) => {
    const candidate = rawSkill(entry);
    if (!candidate) {
      issues.push("A skill entry was unreadable and was skipped.");
      return [];
    }
    try {
      return [skill(candidate, issues)];
    } catch (error) {
      issues.push(`${candidate.path}: ${error instanceof Error ? error.message : String(error)}; skill was skipped.`);
      return [];
    }
  });
  return {
    manifest: manifest as unknown as AgentPluginManifest,
    skills,
    mcpServers: mcpServers(raw.mcp, issues),
    issues,
    fileCount: raw.fileCount
  };
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

function connectionName(pluginName: string, serverName: string): string {
  return [...`${pluginName} · ${serverName}`].slice(0, 80).join("");
}

export function pluginMcpConnections(registries: Registry[], teamId: string): McpConnection[] {
  const timestamp = new Date().toISOString();
  return registries.flatMap((registry) => registry.plugin.mcpServers.map((server) => ({
    id: `plugin-${registry.id}-${hash(server.name)}`,
    teamId,
    name: connectionName(registry.plugin.manifest.name, server.name),
    url: server.url,
    transport: server.transport,
    authType: "none" as const,
    secretRef: "",
    headers: server.headers,
    allTools: true,
    pluginId: registry.id,
    optional: true,
    tools: [],
    allowedTools: [],
    checkedAt: null,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp
  })));
}
