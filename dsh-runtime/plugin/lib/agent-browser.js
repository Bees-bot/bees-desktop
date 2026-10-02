import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket as Socket, WebSocketServer } from "ws";
import { stateDirectory } from "./product-database.js";

/** A browser that stops answering must not leave a run waiting on it for ever. */
const PATIENCE = 5_000;

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Bees' own browser: its own profile and port, so a team that did not ask for the person's browser
 *  never sees, or signs out of, anything the person is signed in to. */
const OWN = { port: 9333, profile: "browser-profile", state: "browser-state.json" };
/** The person's own browser, on the port its "Allow remote debugging" switch opens, seen by the agent
 *  only through the gate. A copy of their sign-ins looked stolen and signed them out everywhere. */
const PERSONAL = { port: 9222, gate: 9332, state: "browser-state-personal.json" };

/** The browsers Bees drives itself, by bundle id, and where each keeps its profile folder. */
const CHROMIUM = {
  "com.google.Chrome": "Google/Chrome",
  "com.google.Chrome.beta": "Google/Chrome Beta",
  "com.google.Chrome.canary": "Google/Chrome Canary",
  "com.brave.Browser": "BraveSoftware/Brave-Browser",
  "com.brave.Browser.beta": "BraveSoftware/Brave-Browser-Beta",
  "com.brave.Browser.nightly": "BraveSoftware/Brave-Browser-Nightly",
  "com.microsoft.edgemac": "Microsoft Edge",
  "com.vivaldi.Vivaldi": "Vivaldi",
  "com.operasoftware.Opera": "com.operasoftware.Opera",
  "company.thebrowser.Browser": "Arc/User Data",
  "org.chromium.Chromium": "Chromium"
};
/** No cookies, in the shape playwright reads. What a run that cannot read the browser gets. */
const NO_COOKIES = { cookies: [], origins: [] };

/** Nothing an agent does may close the person's browser or wipe their sign-ins. */
const FORBIDDEN = new Set(["Browser.close", "Browser.crash", "Browser.crashGpuProcess", "Storage.clearCookies",
  "Network.clearBrowserCookies", "Storage.clearDataForOrigin", "Storage.clearDataForStorageKey"]);
/** Calls that name a tab, refused for any tab the agent did not open. */
const NAMES_TAB = new Set(["Target.attachToTarget", "Target.closeTarget", "Target.activateTarget",
  "Target.getTargetInfo", "Target.exposeDevToolsProtocol"]);

/** mode -> the browser running for it, and mode -> the last launch or swap queued for it. */
const children = new Map();
const queued = new Map();
/** run -> the browser it brought up to sign in on, so only its own answer puts that window away. */
const signingIn = new Map();

let looked = false;
let found = null;
/** The gate in front of the person's browser, and the port that browser answers on. */
let gate = null;
let realPort = PERSONAL.port;

const profileOf = (spec) => join(stateDirectory(), spec.profile);
const base = (spec) => `http://127.0.0.1:${spec.port}`;
const running = (mode) => children.get(mode)?.exitCode === null && children.get(mode)?.signalCode === null;

/** One launch or swap per browser at a time, so two clicks cannot start two browsers on one profile. */
function serially(mode, work) {
  const next = (queued.get(mode) ?? Promise.resolve()).then(work);
  queued.set(mode, next.catch(() => {}));
  return next;
}

/**
 * The browser the person signs in with, when Bees can read its sign-ins. Asked once per launch of the app: the answer
 * only changes when they change their own settings, and every run would otherwise pay for osascript.
 */
export function defaultBrowser() {
  if (!looked) found = process.platform === "darwin" ? askMacOs() : null;
  looked = true;
  return found?.binary ? found : null;
}

/** What the person must know before a run needs the browser: why runs cannot browse, or browse signed out. */
export function browserWarning() {
  if (process.platform !== "darwin") return "Runs can't browse the web yet. Bees' browser only works on a Mac.";
  const browser = defaultBrowser();
  const yours = found?.name ? `your default browser, ${found.name}` : "your default browser";
  if (!existsSync(CHROME)) {
    if (!browser) return `Runs can't browse the web. Bees can't drive ${yours}, and Google Chrome isn't installed. Install Google Chrome so runs can browse.`;
    // own-browser teams and runs with no team still launch Chrome
    if (switchedOn(browser)) return "Teams that use Bees' own browser can't browse until Google Chrome is installed.";
    return `Runs can't browse the web until you let Bees use ${browser.name} or install Google Chrome. ${turnOn(browser)}`;
  }
  if (!browser) return `Bees can't drive ${yours}, so runs browse in a separate Google Chrome. Sign in to each site there once.`;
  if (!switchedOn(browser)) return `Runs browse in Bees' own Chrome until you let Bees use ${browser.name}. ${turnOn(browser)}`;
  return "";
}

const turnOn = ({ name }) => `In ${name}, open chrome://inspect/#remote-debugging and turn on "Allow remote debugging for this browser instance".`;

/** Whether the person turned on their browser's own "Allow remote debugging" switch, which is the only
 *  way in to the profile they use: Chrome 136 and later ignore --remote-debugging-port on it. */
function switchedOn(browser) {
  try {
    return JSON.parse(readFileSync(join(browser.support, "Local State"), "utf8")).devtools?.remote_debugging?.["user-enabled"] === true;
  } catch { return false; }
}

function askMacOs() {
  const script = `ObjC.import("AppKit");
    const url = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString("https://bees.bot"));
    const bundle = url.isNil() ? null : $.NSBundle.bundleWithURL(url);
    JSON.stringify(bundle ? { id: ObjC.unwrap(bundle.bundleIdentifier), binary: ObjC.unwrap(bundle.executablePath), path: ObjC.unwrap(url.path) } : {});`;
  try {
    const app = JSON.parse(execFileSync("osascript", ["-l", "JavaScript", "-e", script], { encoding: "utf8" }));
    const name = basename(app.path ?? "").replace(/\.app$/, "");
    const support = (folder) => join(homedir(), "Library/Application Support", folder);
    // a chromium browser that never ran has no switch to turn on yet
    if (CHROMIUM[app.id] && existsSync(join(support(CHROMIUM[app.id]), "Local State"))) {
      return { name, binary: app.binary, path: app.path, support: support(CHROMIUM[app.id]) };
    }
    // firefox or safari cookies replayed from chrome look stolen, so google and linkedin sign the person out of both
    return { name };
  } catch { return null; }
}

/** Which browser one team's runs drive. */
const browserMode = (teamId) => teamId && usesDefaultBrowser(teamId) && defaultBrowser() && switchedOn(defaultBrowser()) ? "personal" : "own";

/** Which browser one run drives: the team that owns its workspace decides, and a run with no team
 *  gets Bees' own rather than a person's sign-ins it has no setting for. */
export const browserModeFor = (database, workspaceId) =>
  browserMode(database.prepare("SELECT team_id AS teamId FROM workspaces WHERE id = ?").get(workspaceId ?? "")?.teamId ?? "");

/** Where an add-on connects: the gate for the person's browser, never that browser itself. */
export const browserPort = (mode = "own") => target(mode).gate ?? target(mode).port;

/** Bees' own browser for a team that turned yours off, or when Bees can't drive yours. */
function target(mode) {
  const browser = mode === "personal" ? defaultBrowser() : null;
  return browser ? { ...PERSONAL, ...browser, port: realPort } : { ...OWN, binary: CHROME };
}

/**
 * The teams that asked for Bees' own browser. Only those are stored, so a new team, and a file Bees
 * could not read, both browse as the person instead of silently signing them out.
 */
const settingsFile = () => join(stateDirectory(), "browser-settings.json");

function offTeams() {
  try {
    const saved = JSON.parse(readFileSync(settingsFile(), "utf8"));
    return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
  } catch { return []; }
}

const usesDefaultBrowser = (teamId) => !offTeams().includes(teamId);

/** The teams that asked for Bees' own browser, which is what their settings page shows switched off. */
export const ownBrowserTeams = () => offTeams();

export function setUsesDefaultBrowser(teamId, use) {
  const next = offTeams().filter((id) => id !== teamId);
  if (!use) next.push(teamId);
  // written whole and moved into place: a half-written file reads back as no teams at all, which
  // silently hands a team that asked for Bees' own browser the person's signed-in one again
  mkdirSync(stateDirectory(), { recursive: true });
  const path = settingsFile();
  writeFileSync(`${path}.writing`, JSON.stringify(next));
  renameSync(`${path}.writing`, path);
}

/** Whether anything answers on the port yet. Cheap enough to poll while a launch settles. */
async function answering(spec) {
  try {
    await fetch(`${base(spec)}/json/version`, { signal: AbortSignal.timeout(1_000) });
    return true;
  } catch { return false; }
}

/** Whether the browser on this port runs with no UI at all, which is how a holder stays out of sight. */
async function headless(spec) {
  const about = await fetch(`${base(spec)}/json/version`, { signal: AbortSignal.timeout(PATIENCE) }).then((r) => r.json());
  return String(about["User-Agent"] ?? "").includes("HeadlessChrome");
}

async function cdp(spec, method, params) {
  const { webSocketDebuggerUrl } = await fetch(`${base(spec)}/json/version`, { signal: AbortSignal.timeout(PATIENCE) })
    .then((r) => r.json());
  const socket = new WebSocket(webSocketDebuggerUrl);
  // closing the socket settles the promise below, so a browser that stops answering rejects instead
  const timer = setTimeout(() => socket.close(), PATIENCE);
  try {
    return await new Promise((resolve, reject) => {
      socket.onerror = () => reject(new Error("The agent's browser refused a connection"));
      socket.onclose = () => reject(new Error("The agent's browser stopped answering"));
      socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }));
      socket.onmessage = ({ data }) => {
        const { error, result } = JSON.parse(data);
        error ? reject(new Error(error.message)) : resolve(result);
      };
    });
  } finally {
    clearTimeout(timer);
    socket.close();
  }
}

/** The browser process itself, by the port it owns: it is the one with a window and a Dock icon.
 *  Both of these are external commands, so neither is allowed to outlive the patience a launch has. */
const browserPid = (spec) => new Promise((resolve) => execFile("/usr/sbin/lsof", ["-ti", `tcp:${spec.port}`, "-sTCP:LISTEN"],
  { timeout: PATIENCE }, (_, out) => resolve(Number.parseInt(out ?? "", 10) || null)));

/** What the process on that port was started with, straight from the kernel. Chrome will not report
 *  its own command line unless it runs with --enable-automation, which puts an infobar on screen. */
const browserArgs = (pid) => new Promise((resolve) => execFile("/bin/ps", ["-o", "args=", "-p", String(pid)],
  { timeout: PATIENCE }, (_, out) => resolve(out ?? "")));

/**
 * What the browser on this port was started with, or nothing when this Bees did not start it, so a
 * second install (dev and released) on the same port does not drive a browser it never copied.
 */
async function ours(spec) {
  const pid = await browserPid(spec);
  const args = pid ? await browserArgs(pid) : "";
  return args.includes(`--user-data-dir=${profileOf(spec)}`) ? args : "";
}

const macApp = (pid, call) => new Promise((resolve) => execFile("osascript", ["-l", "JavaScript", "-e",
  `ObjC.import("AppKit"); const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}); app && app.${call};`],
  { timeout: PATIENCE }, () => resolve()));

/** In front of the person, for the one thing only they can do: sign in. Activating unhides the app and
 *  raises its windows, and it has to ignore whoever is in front already: macOS hands focus only to an
 *  app the person asked for otherwise, which for a browser Bees opened means no sign-in page in sight. */
async function bringUp(spec) {
  const pid = await browserPid(spec);
  if (pid) await macApp(pid, "activateWithOptions($.NSApplicationActivateAllWindows | $.NSApplicationActivateIgnoringOtherApps)");
}

/** The tab the person signs in on, opened on the page the agent was stuck at, or whatever tab is already there. */
async function openWindow(spec, url) {
  const pages = (await fetch(`${base(spec)}/json/list`, { signal: AbortSignal.timeout(PATIENCE) }).then((r) => r.json()))
    .filter(({ type }) => type === "page");
  const page = url ? pages.find((open) => open.url === url) : pages[0];
  // a window the person has closed, or one a fresh launch never made, is nothing to sign in to
  const targetId = page?.id ?? (await cdp(spec, "Target.createTarget", { url: url ?? "about:blank" })).targetId;
  await cdp(spec, "Target.activateTarget", { targetId });
}

/** Out of the person's way: a hidden app shows no window, whatever the agent does inside it. */
async function putAway(spec) {
  const pid = await browserPid(spec);
  if (pid) await macApp(pid, "hide");
}

/** Bees' own Chrome. The person's browser is never started with flags, only through the gate. */
async function launch(mode, visible) {
  if (process.platform !== "darwin") throw new Error("The agent's browser needs macOS");
  const spec = target(mode);
  if (!existsSync(spec.binary)) throw new Error(`${basename(spec.binary)} is not installed`);
  const child = spawn(spec.binary, [
    `--user-data-dir=${profileOf(spec)}`,
    `--remote-debugging-port=${spec.port}`,
    "--no-first-run",
    "--no-default-browser-check",
    // quitting Bees kills this browser, so every launch would ask to restore pages
    "--hide-crash-restore-bubble",
    // A browser nobody is signing in on runs headless: macOS registers that one as a background app,
    // so it holds the person's sign-ins without a window to pop up and without a Dock icon beside
    // their own browser all day. The one a person signs in on gets its window from showAgentBrowser.
    ...(visible ? ["--no-startup-window"] : ["--headless=new"])
  ], { stdio: "ignore" });
  child.unref();
  // a spawn that fails leaves the child with no exit code, and an unhandled error event would take
  // the whole runtime down, so it is kept for the wait below to report
  let failed = null;
  child.on("error", (error) => { failed = error; });
  const deadline = Date.now() + PATIENCE * 4;
  while (!(await answering(spec))) {
    if (failed || child.exitCode !== null || Date.now() > deadline) {
      child.kill();
      throw failed ?? new Error("The agent's browser did not start");
    }
    await delay(100);
  }
  children.set(mode, child);
}

/** The port the person's running browser listens on, read from the process itself. 9222 is only the
 *  usual one: the switch takes another when something else holds it. */
async function findRealPort(spec) {
  const run = (file, args) => new Promise((resolve) => execFile(file, args, { timeout: PATIENCE }, (_, out) => resolve(out ?? "")));
  const pid = (await run("/bin/ps", ["-axo", "pid=,comm="])).split("\n")
    .map((line) => line.trim().match(/^(\d+) (.+)$/)).find((match) => match?.[2] === spec.binary)?.[1];
  if (!pid) return null;
  const listening = (await run("/usr/sbin/lsof", ["-nP", "-a", "-p", pid, "-iTCP@127.0.0.1", "-sTCP:LISTEN", "-Fn"]))
    .match(/^n127\.0\.0\.1:(\d+)$/m)?.[1];
  return { pid, port: listening ? Number(listening) : null };
}

/**
 * The person's browser, through a gate that shows each add-on connection only the tabs it opened
 * itself. Both add-ons drive the first tab they find, and in a real browser that is the person's
 * own mail or call. The gate also closes those tabs when the add-on goes, and refuses anything that
 * would close the browser or clear its sign-ins.
 */
function openGate() {
  if (gate) return gate;
  const server = createServer(async (request, response) => {
    if (!/^\/json\/version\/?$/.test(request.url ?? "")) return response.writeHead(404).end();
    try {
      const about = await fetch(`http://127.0.0.1:${realPort}/json/version`, { signal: AbortSignal.timeout(PATIENCE) }).then((r) => r.json());
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ...about, webSocketDebuggerUrl: `ws://127.0.0.1:${PERSONAL.gate}/devtools/browser/bees` }));
    } catch { response.writeHead(502).end(); }
  });
  new WebSocketServer({ server, perMessageDeflate: false }).on("connection", passThrough);
  gate = new Promise((resolve, reject) => {
    server.once("error", (error) => {
      gate = null;
      reject(error.code === "EADDRINUSE" ? new Error(`Port ${PERSONAL.gate} is in use, maybe by a second Bees. Quit it and try again.`) : error);
    });
    server.listen(PERSONAL.gate, "127.0.0.1", () => resolve(server));
  });
  return gate;
}

/** One add-on connection, relayed to the person's browser with every tab it did not open left out. */
async function passThrough(client) {
  const held = [];
  client.on("message", (data) => held.push(data));
  const about = await fetch(`http://127.0.0.1:${realPort}/json/version`, { signal: AbortSignal.timeout(PATIENCE) })
    .then((r) => r.json()).catch(() => null);
  if (!about?.webSocketDebuggerUrl) return client.close(1011, "The browser is not answering");
  const browser = new Socket(about.webSocketDebuggerUrl, { perMessageDeflate: false });
  const mine = new Set();
  const sessions = new Set();
  /** what each of the add-on's calls was, for the answers the gate has to read or trim */
  const asked = new Map();
  /** answers to the gate's own calls, which the add-on never sent */
  const ownCalls = new Map();
  let nextId = 1_000_000_000;
  const call = (method, params = {}, sessionId) => new Promise((resolve) => {
    const id = nextId++;
    ownCalls.set(id, resolve);
    browser.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const refuse = (message, text) => client.send(JSON.stringify({ id: message.id, sessionId: message.sessionId, error: { code: -32000, message: text } }));
  const fromClient = (data) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (FORBIDDEN.has(message.method)) return message.method === "Browser.close"
      ? client.send(JSON.stringify({ id: message.id, result: {} })) : refuse(message, "Bees keeps the person's sign-ins and browser open");
    if (!message.sessionId && NAMES_TAB.has(message.method) && message.params?.targetId && !mine.has(message.params.targetId)) {
      return refuse(message, "No target with given id found");
    }
    // a new tab must not pull the person off the one they are using
    if (message.method === "Target.createTarget") message.params = { ...message.params, background: true };
    // the agent's downloads must not move the person's own
    if (message.method === "Browser.setDownloadBehavior") return client.send(JSON.stringify({ id: message.id, result: {} }));
    if (!message.sessionId) asked.set(message.id, message.method);
    browser.send(JSON.stringify(message));
  };
  // frames and workers carry no tab of the person's on their own, so only tabs and pages are held back
  const ours = (info) => !["page", "tab"].includes(info.type) || mine.has(info.targetId) || mine.has(info.openerId);
  browser.on("message", (data, binary) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (ownCalls.has(message.id)) {
      ownCalls.get(message.id)(message.result ?? {});
      return ownCalls.delete(message.id);
    }
    // the page inside a tab the gate is looking into, which is the gate's to read and nobody else's
    if (looking.has(message.sessionId)) {
      if (message.method === "Target.attachedToTarget") looking.set(message.sessionId, message.params);
      return;
    }
    if (message.id !== undefined && !message.sessionId) {
      const method = asked.get(message.id);
      asked.delete(message.id);
      if (method === "Target.createTarget" && message.result) mine.add(message.result.targetId);
      if (method === "Target.getTargets" && message.result) {
        message.result.targetInfos = message.result.targetInfos.filter(ours);
        return client.send(JSON.stringify(message));
      }
    }
    if (message.sessionId && !sessions.has(message.sessionId)) return;
    const { method, params = {} } = message;
    if (method === "Target.attachedToTarget") {
      if (params.targetInfo.type === "tab" && !message.sessionId && !mine.has(params.targetInfo.targetId)) return claimTab(params, data, binary);
      // a tab the person opens while the agent is attached waits for a debugger, so it is let go at once
      if (!ours(params.targetInfo) && !message.sessionId) {
        if (params.waitingForDebugger) call("Runtime.runIfWaitingForDebugger", {}, params.sessionId);
        return call("Target.detachFromTarget", { sessionId: params.sessionId });
      }
      mine.add(params.targetInfo.targetId);
      sessions.add(params.sessionId);
    }
    if (["Target.targetCreated", "Target.targetInfoChanged"].includes(method)) {
      if (!ours(params.targetInfo)) return;
      // a popup the agent's tab opened is the agent's too
      if (["page", "tab"].includes(params.targetInfo.type)) mine.add(params.targetInfo.targetId);
    }
    if (method === "Target.detachedFromTarget" && !message.sessionId && !sessions.delete(params.sessionId)) return;
    client.send(data, { binary });
  });
  /** A tab's id is not its page's, so the gate looks at the page inside before it lets the add-on see the tab. */
  const looking = new Map();
  const claimTab = async (params, data, binary) => {
    const tab = params.sessionId;
    looking.set(tab, null);
    await call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, tab);
    const page = looking.get(tab);
    looking.delete(tab);
    if (page) await call("Target.detachFromTarget", { sessionId: page.sessionId }, tab);
    await call("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false }, tab);
    if (page && mine.has(page.targetInfo.targetId)) {
      mine.add(params.targetInfo.targetId);
      sessions.add(tab);
      return client.readyState === Socket.OPEN && client.send(data, { binary });
    }
    if (params.waitingForDebugger) call("Runtime.runIfWaitingForDebugger", {}, tab);
    call("Target.detachFromTarget", { sessionId: tab });
  };
  browser.on("open", async () => {
    // every connection starts on a blank tab of its own, so the first tab an add-on finds is never the person's
    const tabs = async () => (await call("Target.getTargets", { filter: [{ type: "tab" }] })).targetInfos ?? [];
    const before = new Set((await tabs()).map((t) => t.targetId));
    mine.add((await call("Target.createTarget", { url: "about:blank", background: true })).targetId);
    // the seed's tab must be known before the add-on looks, or puppeteer never finds a page
    // ponytail: a blank tab the person opens in these few milliseconds would be taken too
    for (const t of await tabs()) if (!before.has(t.targetId) && t.url === "about:blank") mine.add(t.targetId);
    client.removeAllListeners("message");
    client.on("message", fromClient);
    held.forEach(fromClient);
  });
  const done = () => {
    client.terminate();
    if (browser.readyState !== Socket.OPEN) return browser.terminate();
    // the agent's tabs go with it, and the person's stay as they were
    for (const targetId of mine) browser.send(JSON.stringify({ id: nextId++, method: "Target.closeTarget", params: { targetId } }));
    browser.close();
  };
  client.on("close", done);
  browser.on("close", done);
  browser.on("error", done);
  client.on("error", done);
}

/** Whether the process has exited, giving it a moment. */
async function gone(pid) {
  const deadline = Date.now() + PATIENCE;
  for (;;) {
    try { process.kill(pid, 0); } catch { return true; }
    if (Date.now() > deadline) return false;
    await delay(100);
  }
}

/** Closed, not killed, so it writes out its cookies, and found by port since an earlier Bees' has no handle here. */
async function quit(spec) {
  const pid = await browserPid(spec);
  if (!pid) return;
  await cdp(spec, "Browser.close", {}).catch(() => {});
  if (await gone(pid)) return;
  try { process.kill(pid, "SIGKILL"); } catch { /* it went on its own after all */ }
  await gone(pid);
}

/** Swap the two shapes of the same browser. Both work on the same profile, so the sign-in the person
 *  just did, and every cookie in it, is there for whichever one comes up. */
async function relaunch(mode, visible) {
  const spec = target(mode);
  await quit(spec);
  children.delete(mode);
  // the old browser still holding the profile would take the new launch over, so it has to be gone
  if (await answering(spec)) throw new Error(`The agent's browser port ${spec.port} is still in use`);
  await launch(mode, visible);
}

/**
 * Where a run reads its cookies from, in playwright's storageState shape. It has to exist before a
 * run starts or every navigation fails on ENOENT, and on a fresh install nobody has signed in yet,
 * so an empty file stands in for "no cookies".
 */
export function browserStatePath(mode = "own") {
  const path = join(stateDirectory(), target(mode).state);
  if (!existsSync(path)) {
    mkdirSync(stateDirectory(), { recursive: true });
    writeFileSync(path, JSON.stringify(NO_COOKIES), { mode: 0o600 });
  }
  return path;
}

/**
 * Copy the browser's cookies out so a run that browses in its own headless session starts signed in.
 * Anything the browser cannot answer for hands this run no cookies at all: the last run's jar is not
 * this run's, and a sign-in the person has since removed must not come back with it.
 */
export const saveBrowserState = (mode = "own") => serially(mode, async () => {
  const spec = target(mode);
  // ours, not running: a browser started by an earlier Bees is still the one holding the cookies,
  // and its process handle died with the old Bees. The person's browser is driven in place, so it
  // hands out none, and this also empties the jar an older Bees copied out of it.
  const state = mode === "own" && await ours(spec) ? await cookiesOf(spec) : NO_COOKIES;
  const path = browserStatePath(mode);
  // only the person can read their live sign-ins, and a run starting mid-write reads the old file whole
  writeFileSync(`${path}.writing`, JSON.stringify(state), { mode: 0o600 });
  renameSync(`${path}.writing`, path);
});

/** The cookies the browser holds, in the shape playwright's --storage-state reads. */
async function cookiesOf(spec) {
  const { cookies } = await cdp(spec, "Storage.getCookies", {});
  return {
    cookies: cookies.map(({ name, value, domain, path, expires, httpOnly, secure, sameSite }) => ({
      name, value, domain, path, httpOnly, secure,
      expires: expires > 0 ? Math.floor(expires) : -1,
      // chrome reports None/Lax/Strict or nothing; playwright insists on one of its three.
      sameSite: ["Strict", "Lax", "None"].includes(sameSite) ? sameSite : "Lax"
    })),
    // cookies only: the agent's window keeps its site storage in its own profile
    origins: []
  };
}

/** Bring the browser up, or back after a crash or a quit. Cheap once it runs. */
export const startAgentBrowser = (mode = "own") => serially(mode, () => launchIfAbsent(mode));

async function launchIfAbsent(mode) {
  if (running(mode)) return;
  const spec = target(mode);
  if (spec.gate) return reachPersonal(spec);
  // a browser an earlier Bees left on this port is adopted as it stands
  if (await ours(spec)) return;
  // anything else on the port is not ours to read from or to drive, and saying which process holds
  // it saves whoever has to sort this out a hunt for a second Bees that may not be there
  if (await answering(spec)) {
    const pid = await browserPid(spec);
    throw new Error(`Something else is using the agent's browser port ${spec.port}${pid ? ` (process ${pid})` : ""}`);
  }
  await launch(mode, false);
}

/** The person's browser, started for them in the background when it is closed, and the gate in front of it. */
async function reachPersonal(spec) {
  // an older Bees kept a copy of the person's sign-ins here
  rmSync(join(stateDirectory(), "browser-profile-personal"), { recursive: true, force: true });
  let live = await findRealPort(spec);
  if (!live) {
    execFile("/usr/bin/open", ["-g", "-a", spec.path]);
    for (const deadline = Date.now() + PATIENCE * 4; !live?.port && Date.now() < deadline; await delay(500)) live = await findRealPort(spec);
  }
  if (!live?.port) throw new Error(`${spec.name} is not letting Bees in. ${turnOn(spec)} Or switch off "Use your own browser" in Bees' settings.`);
  realPort = live.port;
  await openGate();
}

/** Put the browser in front so a person can sign in for this run, on the page the agent hit when it says which. */
export function showAgentBrowser(mode, runId, url) {
  // marked before its turn, so an answer that lands before the window is up still counts
  signingIn.set(runId, mode);
  return serially(mode, async () => {
    // answered while it waited its turn, so there is nothing left to sign in to
    if (!signingIn.has(runId)) return;
    await launchIfAbsent(mode);
    const spec = target(mode);
    if (!spec.gate && await headless(spec)) await relaunch(mode, true);
    await openWindow(spec, url);
    await bringUp(spec);
  });
}

/** Out of the person's way once every run signing in on it has its answer, on the browser the run showed. */
export async function hideAgentBrowser(runId) {
  const mode = signingIn.get(runId);
  // a run that never raised the window has nothing to put away
  if (!signingIn.delete(runId)) return;
  await serially(mode, async () => {
    const spec = target(mode);
    // ours, not running: a browser an earlier Bees started is still the window on screen. The
    // person's own browser stays where they put it.
    if (spec.gate || [...signingIn.values()].includes(mode) || !(await ours(spec))) return;
    await putAway(spec);
    // nobody is signing in any more, so the window, and the Dock icon that comes with it, both go
    if (!(await headless(spec))) await relaunch(mode, false);
  });
}

/** Bees is going away and no browser has an owner left, so neither would sit there as an orphan window. */
export function closeAgentBrowser() {
  for (const [mode, child] of children) if (running(mode)) child.kill();
  children.clear();
  gate?.then((server) => server.close(), () => {});
  gate = null;
}
