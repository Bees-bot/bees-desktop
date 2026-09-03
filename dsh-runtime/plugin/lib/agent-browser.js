import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
  await setWindow("minimized");
}

/** The CDP endpoint the browser MCP server dials. Chrome is not up yet; a run starts it first. */
export async function browserEndpoint() {
  return `http://127.0.0.1:${await reservePort()}`;
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
  await setWindow("normal");
}

/** Back out of the way once the person has answered. */
export async function hideAgentBrowser() {
  if (running()) await setWindow("minimized");
}

/**
 * Every run shares this Chrome and none of them tidy up, so each page an agent opened stayed open
 * and holding memory. Seven runs left 25 live tabs behind. Called when no run is using the browser
 * any more, so there is nothing to interrupt: wind back to a single blank tab.
 */
export async function releaseAgentBrowser() {
  if (!running()) return;
  try {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
    const pages = targets.filter(({ type }) => type === "page");
    if (!pages.length) return;
    // A fresh blank tab first: closing every page can take Chrome down with it. Background, so
    // this does not raise the window at somebody who is working.
    await cdp("Target.createTarget", { url: "about:blank", background: true });
    for (const { id } of pages) await cdp("Target.closeTarget", { targetId: id }).catch(() => undefined);
  } catch {
    // A browser that is shutting down or already gone needs no tidying.
  }
}
