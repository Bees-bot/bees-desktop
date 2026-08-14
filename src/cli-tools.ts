// Optional native agent runtimes. Codex is a direct pi-ai OAuth provider; Claude Code is
// the only external CLI adapter and is configured explicitly rather than discovered.

import { invoke } from "@tauri-apps/api/core";

export interface CliTool {
  /** Key returned by `configured_cli_tools`. */
  id: string;
  /** Provider id an agent names in its model, e.g. `claude-cli/sonnet`. */
  provider: string;
  label: string;
  /** Example model an agent can be pointed at. */
  exampleModel: string;
  installUrl: string;
}

export const CLI_TOOLS: CliTool[] = [
  {
    id: "claude",
    provider: "claude-cli",
    label: "Claude Code",
    exampleModel: "claude-cli/sonnet",
    installUrl: "https://claude.com/claude-code"
  }
];

export const NATIVE_AGENT_TOOLS: CliTool[] = CLI_TOOLS;

export function isCliProvider(provider: string | undefined): boolean {
  return NATIVE_AGENT_TOOLS.some((tool) => tool.provider === provider);
}

export interface CliToolPath {
  path: string;
  /** False once the user switches this CLI off by hand; runs stop being offered it. */
  enabled: boolean;
}

/** Explicitly configured external CLIs, keyed by tool id. Bees never scans PATH. */
export function configuredCliTools(): Promise<Record<string, CliToolPath>> {
  return invoke("configured_cli_tools");
}

/** Point a tool at a binary of the user's choosing; an empty path disconnects it. */
export function setCliToolPath(id: string, path: string): Promise<void> {
  return invoke("set_cli_tool_path", { tool: id, path });
}

/** Switch a CLI off or on by hand, without forgetting the binary it is pointed at. */
export function setCliToolEnabled(id: string, enabled: boolean): Promise<void> {
  return invoke("set_cli_tool_enabled", { tool: id, enabled });
}
