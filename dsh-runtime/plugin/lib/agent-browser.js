import { execFile, execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stateDirectory } from "./product-database.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Bees' own browser: its own profile and port, so a team that did not ask for the person's browser
 *  never sees, or signs out of, anything the person is signed in to. */
const OWN = { port: 9333, profile: "browser-profile", state: "browser-state.json" };
/** The person's own browser on a copy of their profile, where everything they use is already signed in.
 *  A copy, because Chrome 136 and later ignore --remote-debugging-port on the profile folder in use. */
const PERSONAL = { port: 9332, profile: "browser-profile-personal", state: "browser-state-personal.json" };

/** The browsers Bees can drive, by bundle id, and where each keeps its profile folder. Safari and
 *  Firefox cannot be driven this way, and one of those as the default browser means Bees' own Chrome. */
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
  "company.thebrowser.Browser": "Arc",
  "org.chromium.Chromium": "Chromium"
};

/**
 * What carries a person's sign-ins: the cookie jar, the site storage that holds session tokens, the
 * browser's own settings, and the file that names the profile. The rest of a real profile is gigabytes
 * of history, caches, extensions and saved passwords, none of which a browsing agent needs, and copying
 * it on every launch would take minutes and the person's own passwords with it.
 */
const SIGNED_IN = [
  "Local State",
  join("Default", "Preferences"),
  join("Default", "Network", "Cookies"),
  join("Default", "Network", "Cookies-journal"),
  join("Default", "Cookies"),
  join("Default", "Local Storage")
];

/** mode -> the browser running for it, and mode -> the launch in flight. */
const children = new Map();
const starting = new Map();

let looked = false;
let found = null;

const profileOf = (spec) => join(stateDirectory(), spec.profile);
const base = (spec) => `http://127.0.0.1:${spec.port}`;
const running = (mode) => children.get(mode)?.exitCode === null && children.get(mode)?.signalCode === null;
const listening = (spec) => fetch(`${base(spec)}/json/version`).then((reply) => reply.ok, () => false);

/**
 * The person's default browser, when Bees can drive it. Asked once per launch of the app: the answer
 * only changes when they change their own settings, and every run would otherwise pay for osascript.
 */
export function defaultBrowser() {
  if (looked) return found;
  looked = true;
  found = process.platform === "darwin" ? askMacOs() : null;
  return found;
}

function askMacOs() {
  const script = `ObjC.import("AppKit");
    const app = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString("https://bees.bot"));
    if (!app) JSON.stringify({});
    else { const bundle = $.NSBundle.bundleWithURL(app);
      JSON.stringify({ id: ObjC.unwrap(bundle.bundleIdentifier), binary: ObjC.unwrap(bundle.executablePath), path: ObjC.unwrap(app.path) }); }`;
  try {
    const { id, binary, path } = JSON.parse(execFileSync("osascript", ["-l", "JavaScript", "-e", script], { encoding: "utf8" }));
    const folder = CHROMIUM[id];
    if (!binary || !folder) return null;
    const support = join(homedir(), "Library/Application Support", folder);
    // no Local State means this browser never ran here, so there is no profile to copy
    if (!existsSync(join(support, "Local State"))) return null;
    return { id, binary, name: basename(path ?? "").replace(/\.app$/, ""), support };
  } catch { return null; }
}

/** Which browser one team's runs drive. */
export const browserMode = (teamId) => teamId && usesDefaultBrowser(teamId) && defaultBrowser() ? "personal" : "own";

export const browserPort = (mode = "own") => target(mode).port;

/** Bees' own browser whenever the person's is not there or cannot be driven, so a run still browses. */
function target(mode) {
  const browser = mode === "personal" ? defaultBrowser() : null;
  return browser
    ? { ...PERSONAL, binary: browser.binary, support: browser.support }
    : { ...OWN, binary: CHROME };
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

export const usesDefaultBrowser = (teamId) => !offTeams().includes(teamId);

/** The teams that asked for Bees' own browser, which is what their settings page shows switched off. */
export const ownBrowserTeams = () => offTeams();

export function setUsesDefaultBrowser(teamId, use) {
  const next = offTeams().filter((id) => id !== teamId);
  if (!use) next.push(teamId);
  mkdirSync(stateDirectory(), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(next));
}

async function cdp(spec, method, params) {
  const { webSocketDebuggerUrl } = await fetch(`${base(spec)}/json/version`).then((r) => r.json());
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
 *  whatever they were doing and cannot move the browser they were already using. */
async function setWindow(spec, windowState) {
  const targets = await fetch(`${base(spec)}/json/list`).then((r) => r.json());
  const pages = targets.filter(({ type }) => type === "page");
  // Prefer a real page the devtools server navigated to over the initial about:blank.
  const targetId = (pages.find(({ url }) => url && url !== "about:blank") ?? pages[0])?.id;
  if (!targetId) return;
  const { windowId } = await cdp(spec, "Browser.getWindowForTarget", { targetId });
  await cdp(spec, "Browser.setWindowBounds", { windowId, bounds: { windowState } });
  if (windowState === "normal") await cdp(spec, "Target.activateTarget", { targetId });
}

// by process, not by name: the same browser is the person's own, and that is what came forward
const bringForward = (spec) => new Promise((resolve) => execFile("/usr/sbin/lsof", ["-ti", `tcp:${spec.port}`, "-sTCP:LISTEN"], (_, pid) => {
  if (!/^\d+/.test(pid ?? "")) return resolve();
  execFile("osascript", ["-l", "JavaScript", "-e",
    `ObjC.import("AppKit"); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${parseInt(pid)}).activateWithOptions($.NSApplicationActivateAllWindows)`], () => resolve());
}));

/**
 * The person's sign-ins live in the browser they use, so their copy is taken fresh each time Bees
 * opens it, and is thrown away first: a copy that only ever grows keeps sign-ins the person has since
 * removed, and holds the profile lock a killed browser left behind.
 */
function copyProfile(spec) {
  const profile = profileOf(spec);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(join(profile, "Default"), { recursive: true });
  for (const part of SIGNED_IN) {
    if (existsSync(join(spec.support, part))) cpSync(join(spec.support, part), join(profile, part), { recursive: true });
  }
}

async function launch(mode) {
  if (process.platform !== "darwin") throw new Error("The agent's browser needs macOS");
  const spec = target(mode);
  if (!existsSync(spec.binary)) throw new Error(`${mode === "personal" ? "Your default browser" : "Google Chrome"} is not installed`);
  if (spec.support) copyProfile(spec);
  const child = spawn(spec.binary, [
    `--user-data-dir=${profileOf(spec)}`,
    `--remote-debugging-port=${spec.port}`,
    "--no-first-run",
    "--no-default-browser-check",
    // quitting Bees kills this browser, so every launch would ask to restore pages
    "--hide-crash-restore-bubble",
    "about:blank"
  ], { stdio: "ignore" });
  child.unref();
  for (let waited = 0; !(await listening(spec)); waited += 1) {
    if (child.exitCode !== null || waited === 200) {
      child.kill();
      throw new Error("The agent's browser did not start");
    }
    await delay(100);
  }
  children.set(mode, child);
  await setWindow(spec, "minimized");
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
    writeFileSync(path, JSON.stringify({ cookies: [], origins: [] }));
  }
  return path;
}

/**
 * Copy the browser's cookies out so a run that browses in its own headless session starts signed in.
 * Throws when the browser cannot answer, and the caller logs it: a run that starts signed out is not
 * fatal, but it must not be silent.
 */
export async function saveBrowserState(mode = "own") {
  const spec = target(mode);
  // listening, not running: a browser started by an earlier Bees is still the one holding the
  // cookies, and its process handle died with the old Bees.
  if (!(await listening(spec))) return;
  const { cookies } = await cdp(spec, "Storage.getCookies", {});
  writeFileSync(browserStatePath(mode), JSON.stringify({
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
export function startAgentBrowser(mode = "own") {
  if (running(mode) || starting.has(mode)) return starting.get(mode) ?? Promise.resolve();
  const launched = launch(mode).finally(() => { starting.delete(mode); });
  starting.set(mode, launched);
  return launched;
}

/** Put the window on screen so a person can sign in, and land on the tab the agent is reading. */
export async function showAgentBrowser(mode = "own", url) {
  if (url) return navigateAgentBrowser(mode, url);
  await startAgentBrowser(mode);
  const spec = target(mode);
  await setWindow(spec, "normal");
  await bringForward(spec);
}

/**
 * Navigate the agent's browser to a specific URL and bring it forward. Used when an agent hits a
 * login wall so the person lands directly on the sign-in page rather than about:blank.
 */
export async function navigateAgentBrowser(mode = "own", url) {
  await startAgentBrowser(mode);
  const spec = target(mode);
  // own tab brought to the front, so the person sees the sign-in page and the agent's tab is left alone
  try {
    const pages = await fetch(`${base(spec)}/json/list`).then((r) => r.json());
    const open = pages.find((page) => page.type === "page" && page.url === url)
      ?? await fetch(`${base(spec)}/json/new?${encodeURI(url)}`, { method: "PUT" }).then((r) => r.json());
    await fetch(`${base(spec)}/json/activate/${open.id}`);
  } catch { /* the window still comes up, and the person can type the address themselves */ }
  await setWindow(spec, "normal");
  await bringForward(spec);
}

/** Back out of the way once the person has answered. Listening, not running: a browser an earlier
 *  Bees started is still the window on screen, and its process handle died with the old Bees. */
export async function hideAgentBrowser(mode = "own") {
  const spec = target(mode);
  if (!(await listening(spec))) return;
  await setWindow(spec, "minimized");
}

/** Bees is going away and no browser has an owner left, so neither would sit there as an orphan window. */
export function closeAgentBrowser() {
  for (const [mode, child] of children) if (running(mode)) child.kill();
  children.clear();
}
