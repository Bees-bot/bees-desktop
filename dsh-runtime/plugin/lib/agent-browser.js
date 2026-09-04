import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stateDirectory } from "./product-database.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * One Chrome, started by Bees, shared with the agent over CDP. Two Chromes on one profile lost
 * the session: whichever exited last overwrote the other's cookies, so a person's sign-in came
 * back to the agent as a sign-in page. Now they share the tab. It stays minimised while the agent
 * works and keeps running between runs. The port is promised to the browser server up front and
 * Chrome takes it with the first run that can browse. Bees kills it on quit.
 */
let chrome = null;
let starting = null;
let port = 0;
let wantedOnScreen = false;

const running = () => chrome?.exitCode === null && chrome.signalCode === null;
const listening = () => fetch(`http://127.0.0.1:${port}/json/version`).then((reply) => reply.ok, () => false);

/** Both the server mount and the launch come through here, and neither means anything off macOS. */
async function reservePort() {
  if (process.platform !== "darwin") throw new Error("The agent's browser needs macOS");
  if (port) return port;
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
  port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function cdp(method, params) {
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
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

/**
 * Chrome takes the foreground the moment it starts, before any minimise can land, so a run that
 * browses pulls the person out of whatever they were doing. Hiding the application keeps it off
 * screen through everything the agent does afterwards, including the new tabs Playwright opens.
 */
function setAppHidden(hidden) {
  // Unhiding alone leaves Chrome behind whatever the person is looking at, so the sign-in it was
  // opened for is never seen. Bringing it forward is the whole point of showing it.
  const script = hidden
    ? `tell application "System Events" to set visible of (every process whose name is "Google Chrome") to false`
    : `tell application "Google Chrome" to activate`;
  return new Promise((resolve) => execFile("osascript", ["-e", script], () => resolve()));
}

async function setWindow(windowState) {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const targetId = targets.find(({ type }) => type === "page")?.id;
  if (!targetId) return;
  const { windowId } = await cdp("Browser.getWindowForTarget", { targetId });
  await cdp("Browser.setWindowBounds", { windowId, bounds: { windowState } });
  if (windowState === "normal") await cdp("Target.activateTarget", { targetId });
}

async function launch() {
  await reservePort();
  if (!existsSync(CHROME)) throw new Error("Google Chrome is not installed");
  const child = spawn(CHROME, [
    `--user-data-dir=${join(stateDirectory(), "browser-profile")}`,
    `--remote-debugging-port=${port}`,
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
  await setAppHidden(true);
  await setWindow("minimized");
}


/**
 * Where each run's browser reads its cookies from, in playwright's storageState shape. It has to
 * exist before a run starts or every navigation fails on ENOENT, and on a fresh install nobody has
 * signed in yet, so an empty file stands in for "no cookies".
 */
export function browserStatePath() {
  const path = join(stateDirectory(), "browser-state.json");
  if (!existsSync(path)) {
    mkdirSync(stateDirectory(), { recursive: true });
    writeFileSync(path, JSON.stringify({ cookies: [], origins: [] }));
  }
  return path;
}

/** Copy this browser's cookies out so the next run starts signed in to whatever a person just used. */
export async function saveBrowserState() {
  if (!running()) return false;
  try {
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
    return true;
  } catch {
    return false;
  }
}


/** Bring Chrome up minimised on the promised port. Cheap once it runs; one launch at a time. */
export function startAgentBrowser() {
  if (running()) return Promise.resolve();
  starting ??= launch().finally(() => { starting = null; });
  return starting;
}

/** Put the window on screen so a person can sign in to the tab the agent is reading. */
export async function showAgentBrowser() {
  await startAgentBrowser();
  wantedOnScreen = true;
  await setAppHidden(false);
  await setWindow("normal");
}

/** Back out of the way once the person has answered. */
export async function hideAgentBrowser() {
  wantedOnScreen = false;
  if (!running()) return;
  // Whatever they just signed into is what the next run has to inherit.
  await saveBrowserState();
  await setWindow("minimized");
  await setAppHidden(true);
}

