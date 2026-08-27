import { execFile } from "node:child_process";

/**
 * The browser an agent drives works out of sight. It comes forward only when a person has to
 * type in it, which is the one moment the agent cannot get past on its own.
 */
export function showAgentBrowser(visible) {
  if (process.platform !== "darwin") return;
  execFile("osascript", ["-e",
    `tell application "System Events" to set visible of `
    + `(every process whose name is "Google Chrome for Testing") to ${Boolean(visible)}`
  ], () => {});
}
