import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stateDirectory } from "./product-database.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// One browser, always the same address, so the MCP server and every run find the window the person
// signed in to instead of each opening one of their own.
const PORT = 9333;
const base = `http://127.0.0.1:${PORT}`;

/**
 * The one visible Chrome, started on demand and never per run. It carries its own real profile with
 * no --enable-automation and no mock keychain, which is what makes Google accept a sign-in here
 * instead of refusing the browser as automated. Sessions are reachable by any run that is granted
 * the browser, so signing in once is enough.
 */
let chrome = null;
let starting = null;

const running = () => chrome?.exitCode === null && chrome?.signalCode === null;
const listening = () => fetch(`${base}/json/version`).then((reply) => reply.ok, () => false);

async function cdp(method, params) {
  const { webSocketDebuggerUrl } = await fetch(`${base}/json/version`).then((r) => r.json());
  const socket = new WebSocket(webSocketDebuggerUrl);
  try {
    return await new Promise((resolve, reject) => {
      socket.onerror = () => reject(new Error("The agent's browser refused a connection"));
      socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }));
      socket.onmessage = ({ data }) => {
        const { error, result } = JSON.parse(data);
        error ? reject(new Error(error.message)) : resolve(result);
      };
    });
  } finally {
    socket.close();
  }
}

/** Placed on its own window and never by app, so a run starting up cannot pull the person off
 *  whatever they were doing and cannot move the Chrome they were already using. */
async function setWindow(windowState) {
  const targets = await fetch(`${base}/json/list`).then((r) => r.json());
  const targetId = targets.find(({ type }) => type === "page")?.id;
  if (!targetId) return;
  const { windowId } = await cdp("Browser.getWindowForTarget", { targetId });
  await cdp("Browser.setWindowBounds", { windowId, bounds: { windowState } });
  if (windowState === "normal") await cdp("Target.activateTarget", { targetId });
}

async function launch() {
  if (process.platform !== "darwin") throw new Error("The agent's browser needs macOS");
  if (!existsSync(CHROME)) throw new Error("Google Chrome is not installed");
  const child = spawn(CHROME, [
    `--user-data-dir=${join(stateDirectory(), "browser-profile")}`,
    `--remote-debugging-port=${PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank"
  ], { stdio: "ignore" });
  child.unref();
  for (let waited = 0; !(await listening()); waited += 1) {
    if (child.exitCode !== null || waited === 200) {
      child.kill();
      throw new Error("The agent's browser did not start");
    }
    await delay(100);
  }
  chrome = child;
  await setWindow("minimized");
}

/**
 * Where a run reads its cookies from, in playwright's storageState shape. It has to exist before a
 * run starts or every navigation fails on ENOENT, and on a fresh install nobody has signed in yet,
 * so an empty file stands in for "no cookies".
 */
export function browserStatePath() {
  const path = join(stateDirectory(), "browser-state.json");
  if (!existsSync(path)) {
    mkdirSync(stateDirectory(), { recursive: true });
    writeFileSync(path, JSON.stringify({ cookies: [], origins: [] }));
  }
  return path;
}

/**
 * Copy the browser's cookies out so a run that browses in its own headless session starts signed in.
 * Throws when Chrome cannot answer, and the caller logs it: a run that starts signed out is not
 * fatal, but it must not be silent.
 */
export async function saveBrowserState() {
  // listening, not running: a Chrome started by an earlier Bees is still the browser holding the
  // cookies, and its process handle died with the old Bees.
  if (!(await listening())) return;
  const { cookies } = await cdp("Storage.getCookies", {});
  writeFileSync(browserStatePath(), JSON.stringify({
    cookies: cookies.map(({ name, value, domain, path, expires, httpOnly, secure, sameSite }) => ({
      name, value, domain, path, httpOnly, secure,
      expires: expires > 0 ? Math.floor(expires) : -1,
      // chrome reports None/Lax/Strict or nothing; playwright insists on one of its three.
      sameSite: ["Strict", "Lax", "None"].includes(sameSite) ? sameSite : "Lax"
    })),
    origins: []
  }));
}

/** Bring the browser up minimised. Cheap once it runs; one launch at a time, however many ask. */
export function startAgentBrowser() {
  if (running() || starting) return starting ?? Promise.resolve();
  starting = launch().finally(() => { starting = null; });
  return starting;
}

/** Put the window on screen so a person can sign in, and land on the tab the agent is reading. */
export async function showAgentBrowser() {
  await startAgentBrowser();
  await setWindow("normal");
  await new Promise((resolve) => execFile("osascript", ["-e", `tell application "Google Chrome" to activate`], () => resolve()));
}

/** Back out of the way once the person has answered. Listening, not running: a Chrome an earlier
 *  Bees started is still the window on screen, and its process handle died with the old Bees. */
export async function hideAgentBrowser() {
  if (!(await listening())) return;
  await setWindow("minimized");
}

/** Bees is going away and the browser has no owner left, so it would sit there as an orphan window. */
export function closeAgentBrowser() {
  if (running()) chrome.kill();
  chrome = null;
}
