import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stateDirectory } from "./product-database.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * The agent browses headless and keeps that browser alive between tool calls, so a sign-in wall
 * leaves nothing on screen to type into. A person opens the profile from the run that is waiting.
 * Chrome refuses a second instance on a locked profile, so the agent's copy is closed first; the
 * run is parked on a question by then, and the agent takes the profile back on its next call.
 * Nothing opens this on its own: no signal separates a sign-in wall from any other question, and
 * guessing put a window in the person's face on every question the app raised.
 */
// One profile, so one window, held against the run that asked for it. A second run finishing must
// not close a window someone is still typing in.
let opened = null;

export async function openAgentBrowser(executionId) {
  if (process.platform !== "darwin") throw new Error("Opening the agent's browser needs macOS");
  if (opened) {
    if (opened.executionId !== executionId) throw new Error("The agent's browser is open for another run");
    return;
  }
  if (!existsSync(CHROME)) throw new Error("Google Chrome is not installed");
  const profile = join(stateDirectory(), "browser-profile");
  const onProfile = ["-f", `Google Chrome.*${profile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`];
  spawnSync("pkill", onProfile, { stdio: "ignore" });
  // Chrome keeps the profile lock for a moment after it goes.
  for (let waited = 0; waited < 20 && spawnSync("pgrep", onProfile, { stdio: "ignore" }).status === 0; waited += 1) {
    await delay(100);
  }
  const child = spawn(CHROME, [`--user-data-dir=${profile}`], { stdio: "ignore" });
  // A close then reopen can deliver the old child's exit after the new one is already held.
  const forget = () => { if (opened?.child === child) opened = null; };
  child.on("error", forget);
  child.on("exit", forget);
  child.unref();
  opened = { executionId, child };
}

export function closeAgentBrowser(executionId) {
  if (opened?.executionId !== executionId) return;
  opened.child.kill();
  opened = null;
}
