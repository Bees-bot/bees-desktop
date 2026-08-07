// Agent CLIs installed on this computer (Claude Code, Codex). They sign in themselves
// and run their own agent loop, so Bees never holds a credential for them — a run reaches
// one through the `claude-cli` / `codex-cli` providers the Flue app registers, which loop
// back into the runtime and spawn the CLI in the run's workspace.

import { invoke } from "@tauri-apps/api/core";

export interface CliTool {
  /** Key returned by `detect_cli_tools`, and the CLI's command name. */
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
  },
  {
    id: "codex",
    provider: "codex-cli",
    // Shipped as the Codex CLI, now also bundled inside the ChatGPT desktop app.
    label: "Codex (ChatGPT)",
    exampleModel: "codex-cli/default",
    installUrl: "https://developers.openai.com/codex"
  }
];

export function isCliProvider(provider: string | undefined): boolean {
  return CLI_TOOLS.some((tool) => tool.provider === provider);
}

export interface CliToolPath {
  path: string;
  /** The user browsed to this binary; false means it was found on PATH. */
  custom: boolean;
}

/** The CLIs this computer can run, keyed by tool id. Missing = not installed and not picked. */
export function detectCliTools(): Promise<Record<string, CliToolPath>> {
  return invoke("detect_cli_tools");
}

/** Point a tool at a binary of the user's choosing; an empty path goes back to detection. */
export function setCliToolPath(id: string, path: string): Promise<void> {
  return invoke("set_cli_tool_path", { tool: id, path });
}

/** Run the CLI's own installer. Resolves to where the binary landed. */
export function installCliTool(id: string): Promise<string> {
  return invoke("install_cli_tool", { tool: id });
}
