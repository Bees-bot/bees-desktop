import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stateDirectory } from "./product-database.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * One Chrome, owned by Bees, shared with the agent over CDP.
 *
 * The agent used to browse in its own headless Chrome while a person signed in to a second copy
 * of the same profile. Two Chromes on one profile is a lost session either way: whichever exits
 * last writes its own cookie jar over the other's, so the sign-in a person had just done went to
 * the agent as a sign-in page. There is one browser now. A person types into the very tab the
 * agent is reading, and the sign-in is simply there on the next tool call.
 *
 * It stays minimised, because a window that raises itself on every tool call is unusable, and it
 * stays running between runs, because quitting it is what loses the session. It does not start
 * with the app: the port is promised to the browser server up front and Chrome takes it when the
 * first run that can browse begins.
 */
let chrome = null;
let starting = null;
let port = 0;

const profilePath = () => join(stateDirectory(), "browser-profile");

/** Chrome cannot pick its own port before the MCP server needs it, so pick one it will take. */
async function reservePort() {
  if (port) return port;
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
  port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const alive = () => fetch(`http://127.0.0.1:${port}/json/version`).then((reply) => reply.ok, () => false);

async function cdp(method, params = {}) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("The agent's browser refused a connection")), { once: true });
    });
    return await new Promise((resolve, reject) => {
      socket.addEventListener("message", ({ data }) => {
        const reply = JSON.parse(data);
        if (reply.id !== 1) return;
        reply.error ? reject(new Error(reply.error.message)) : resolve(reply.result);
      });
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
  } finally {
    socket.close();
  }
}

async function setWindow(state) {
  if (!running()) return;
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const targetId = targets.find(({ type }) => type === "page")?.id ?? "";
  if (!targetId) return;
  const { windowId } = await cdp("Browser.getWindowForTarget", { targetId });
  await cdp("Browser.setWindowBounds", { windowId, bounds: { windowState: state } });
  if (state !== "minimized") await cdp("Target.activateTarget", { targetId });
}

const running = () => chrome?.child.exitCode === null && chrome.child.signalCode === null;

/**
 * The CDP endpoint the browser MCP server connects to. Chrome is not up yet; the server only
 * dials this when the agent's first browser tool runs, and startAgentBrowser comes first.
 * @returns the loopback endpoint, for example `http://127.0.0.1:51674`.
 */
export async function browserEndpoint() {
  if (process.platform !== "darwin") throw new Error("The agent's browser needs macOS");
  return `http://127.0.0.1:${await reservePort()}`;
}

async function launch() {
  if (process.platform !== "darwin") throw new Error("The agent's browser needs macOS");
  if (!existsSync(CHROME)) throw new Error("Google Chrome is not installed");
  await reservePort();
  const profile = profilePath();
  // A leftover Chrome from a crashed run still holds the profile lock, and a fresh one would just
  // hand it a window and quit. Chrome keeps the lock for a moment after it goes.
  const onProfile = ["-f", `Google Chrome.*${profile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`];
  spawnSync("pkill", onProfile, { stdio: "ignore" });
  for (let waited = 0; waited < 20 && spawnSync("pgrep", onProfile, { stdio: "ignore" }).status === 0; waited += 1) {
    await delay(100);
  }
  const child = spawn(CHROME, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank"
  ], { stdio: "ignore" });
  child.unref();
  for (let waited = 0; waited < 200; waited += 1) {
    if (child.exitCode !== null) throw new Error("The agent's browser stopped while starting");
    if (await alive()) {
      chrome = { child };
      await setWindow("minimized");
      return;
    }
    await delay(100);
  }
  child.kill();
  throw new Error("The agent's browser did not start");
}

/** Bring Chrome up on the promised port, minimised. Safe to call on every run; one launch at a time. */
export function startAgentBrowser() {
  if (running()) return Promise.resolve();
  starting ??= launch().finally(() => { starting = null; });
  return starting;
}

/** Put the agent's browser on screen so a person can sign in to the tab the agent is reading. */
export async function showAgentBrowser() {
  await startAgentBrowser();
  await setWindow("normal");
}

/** Put it back out of the way. The browser keeps running: quitting it is what loses the session. */
export async function hideAgentBrowser() {
  if (running()) await setWindow("minimized");
}

/** Quit on the way out, so Chrome flushes the cookie jar instead of being orphaned. */
export function stopAgentBrowser() {
  chrome?.child.kill();
  chrome = null;
}
