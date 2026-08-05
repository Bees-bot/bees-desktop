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

/** Absolute paths of the CLIs found on this computer, keyed by tool id. Missing = not installed. */
export function detectCliTools(): Promise<Record<string, string>> {
  return invoke("detect_cli_tools");
}
