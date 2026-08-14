// Native agent runtimes. Codex ships through the official SDK; Claude Code remains an
// explicit opt-in adapter because its subscription login is owned by its external CLI.

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

export const BUNDLED_AGENT_TOOLS: CliTool[] = [
  {
    id: "codex",
    provider: "codex-cli",
    label: "Codex (ChatGPT)",
    exampleModel: "codex-cli/default",
    installUrl: "https://developers.openai.com/codex"
  }
];

export const NATIVE_AGENT_TOOLS: CliTool[] = [...BUNDLED_AGENT_TOOLS, ...CLI_TOOLS];
export const BUNDLED_AGENT_PROVIDERS = BUNDLED_AGENT_TOOLS.map(({ provider }) => provider);

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
