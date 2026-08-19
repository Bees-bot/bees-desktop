// Public collections of Agent Plugins, and the public MCP server registry. Both are read
// live: a collection publishes a Claude Code marketplace manifest naming its plugins, and the
// registry answers a search with the servers matching it. Bees takes the portable Agent
// Plugins 1.0.0 core out of a plugin — skills and remote MCP servers — and leaves the agents,
// commands, and hooks the specification reserves for each client.

import { invoke } from "@tauri-apps/api/core";
import type { AgentPluginPackage } from "./domain.js";
import { type RawAgentPluginPackage, parseAgentPlugin } from "./plugins.js";

export interface CatalogSource {
  /** GitHub `owner/name`. It is also the stable half of an installed registry's sourcePath. */
  repo: string;
  label: string;
  note: string;
}

export const PLUGIN_CATALOG: CatalogSource[] = [
  {
    repo: "anthropics/skills",
    label: "Anthropic Skills",
    note: "Documents, artifacts, and skill authoring"
  },
  {
    repo: "wshobson/agents",
    label: "wshobson Plugins",
    note: "Engineering processes across 90+ plugins"
  },
  {
    repo: "affaan-m/ECC",
    label: "ECC",
    note: "Harness optimization and research processes"
  }
];

export interface CatalogEntry {
  name: string;
  description: string;
  /** Repository-relative directory holding the plugin's files. Empty is the repository root. */
  source: string;
  /** Repository-relative skill directories. An entry with none has nothing Bees can load. */
  skills: string[];
}

export interface McpRegistryServer {
  /** Reverse-domain registry name, unique across the registry. */
  name: string;
  title: string;
  description: string;
  url: string;
  transport: "streamable-http" | "sse";
  /** The entry declares headers, so connecting it takes a key from its publisher. */
  requiresKey: boolean;
}

const SOURCE_PREFIX = "github://";

export function catalogSourcePath(repo: string, entryName: string): string {
  return `${SOURCE_PREFIX}${repo}/${entryName}`;
}

/** Split a `github://owner/name/entry` sourcePath back into what reinstalling it needs. */
export function parseCatalogSourcePath(sourcePath: string): { repo: string; entry: string } | null {
  if (!sourcePath.startsWith(SOURCE_PREFIX))
    return null;
  const [owner, name, ...entry] = sourcePath.slice(SOURCE_PREFIX.length).split("/");
  return owner && name && entry.length
    ? { repo: `${owner}/${name}`, entry: entry.join("/") }
    : null;
}

export function pluginCatalog(repo: string): Promise<CatalogEntry[]> {
  return invoke("plugin_catalog", { repo });
}

/** Staged and validated in Rust, then parsed here like any other installed plugin. */
export async function installCatalogPlugin(
  registryId: string,
  repo: string,
  entry: CatalogEntry
): Promise<AgentPluginPackage> {
  return parseAgentPlugin(
    await invoke<RawAgentPluginPackage>("install_catalog_plugin", { registryId, repo, entry })
  );
}

export function searchMcpRegistry(query: string): Promise<McpRegistryServer[]> {
  return invoke("search_mcp_registry", { query });
}
