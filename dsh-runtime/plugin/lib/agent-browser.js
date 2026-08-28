import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stateDirectory } from "./product-database.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * An agent's browser is closed between its tool calls, so a sign-in wall leaves nothing on screen
 * to type into. A person opens the profile from the run that is waiting, and it closes when that
 * run stops waiting, or the agent's next launch finds the profile locked. Nothing opens it on its
 * own: no signal separates a sign-in wall from any other question, and guessing put a window in
 * the person's face on every question and approval the app raised.
 */
// One profile, so one window, held against the run that asked for it. A second run finishing must
// not close a window someone is still typing in.
let opened = null;

export function openAgentBrowser(executionId) {
  if (process.platform !== "darwin") throw new Error("Opening the agent's browser needs macOS");
  if (opened) {
    if (opened.executionId !== executionId) throw new Error("The agent's browser is open for another run");
    return;
  }
  if (!existsSync(CHROME)) throw new Error("Google Chrome is not installed");
  const child = spawn(CHROME, [`--user-data-dir=${join(stateDirectory(), "browser-profile")}`], { stdio: "ignore" });
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
