import { execFile } from "node:child_process";
import { join } from "node:path";

/**
 * An agent's browser is closed between its own tool calls, so when a sign-in wall stops it there
 * is nothing on screen for a person to type into. Open its profile for them, and close it again
 * once they are done, or the agent's next launch finds the profile locked.
 */
export function showAgentBrowser(visible) {
  if (process.platform !== "darwin" || !process.env.BEES_STATE_DIR) return;
  const profile = join(process.env.BEES_STATE_DIR, "browser-profile");
  if (visible) execFile("open", ["-na", "Google Chrome", "--args", `--user-data-dir=${profile}`], () => {});
  // Anchored on the binary: the profile path alone also matches the mcp server that owns it.
  else execFile("pkill", ["-f", `MacOS/Google Chrome .*${profile}`], () => {});
}
