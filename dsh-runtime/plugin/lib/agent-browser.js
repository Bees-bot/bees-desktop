import { execFile, execFileSync, spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stateDirectory } from "./product-database.js";

/** A browser that stops answering must not leave a run waiting on it for ever. */
const PATIENCE = 5_000;

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
  "company.thebrowser.Browser": "Arc/User Data",
  "org.chromium.Chromium": "Chromium"
};

/**
 * What carries a person's sign-ins: the cookie jar, the site storage that holds session tokens, the
 * browser's own settings, and the file that names the profile. The rest of a real profile is gigabytes
 * of history, caches, extensions and saved passwords, none of which a browsing agent needs, and copying
 * it on every launch would take minutes and the person's own passwords with it.
 */
const signInFiles = (folder) => [
  "Local State",
  join(folder, "Preferences"),
  join(folder, "Network", "Cookies"),
  join(folder, "Network", "Cookies-journal"),
  join(folder, "Cookies"),
  join(folder, "Local Storage")
];

/** No cookies, in the shape playwright reads. What a run that cannot read the browser gets. */
const NO_COOKIES = { cookies: [], origins: [] };

/** mode -> the browser running for it, and mode -> the launch in flight. */
const children = new Map();
const starting = new Map();
/** mode -> the profile folder inside its copy of the person's profile. */
const copiedFolders = new Map();

let looked = false;
let found = null;

const profileOf = (spec) => join(stateDirectory(), spec.profile);
const base = (spec) => `http://127.0.0.1:${spec.port}`;
const running = (mode) => children.get(mode)?.exitCode === null && children.get(mode)?.signalCode === null;

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

/** Which browser one run drives: the team that owns its workspace decides, and a run with no team
 *  gets Bees' own rather than a copy of a person's profile it has no setting for. */
export const browserModeFor = (database, workspaceId) =>
  browserMode(database.prepare("SELECT team_id AS teamId FROM workspaces WHERE id = ?").get(workspaceId ?? "")?.teamId ?? "");

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
 * Whether the browser on this port is the one this Bees started. Two installs on one Mac, a dev build
 * and the released app, both want the same port, and the one that starts second would otherwise drive
 * the other's browser and read a profile it never copied.
 */
async function ours(spec) {
  const pid = await browserPid(spec);
  if (!pid) return false;
  return (await browserArgs(pid)).includes(`--user-data-dir=${profileOf(spec)}`);
}

const macApp = (pid, call) => new Promise((resolve) => execFile("osascript", ["-l", "JavaScript", "-e",
  `ObjC.import("AppKit"); const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}); app && app.${call};`],
  () => resolve()));

/** In front of the person, for the one thing only they can do: sign in. Activating unhides the app and
 *  raises its windows, and it has to ignore whoever is in front already: macOS hands focus only to an
 *  app the person asked for otherwise, which for a browser Bees opened means no sign-in page in sight. */
async function bringUp(spec) {
  const pid = await browserPid(spec);
  if (pid) await macApp(pid, "activateWithOptions($.NSApplicationActivateAllWindows | $.NSApplicationActivateIgnoringOtherApps)");
}

/**
 * The one window the agent browses in, opened in the background: a window Chrome opens itself comes to
 * the front and takes the person's focus with it, which a browser they did not ask for has no business
 * doing. Whether the window is minimised or full size does not matter, because the app is hidden.
 */
async function openWindow(spec) {
  const open = await fetch(`${base(spec)}/json/list`, { signal: AbortSignal.timeout(PATIENCE) }).then((r) => r.json());
  // a window the person has closed, or one a failed launch never made, is nothing to sign in to
  if (open.some(({ type }) => type === "page")) return;
  await cdp(spec, "Target.createTarget", { url: "about:blank", background: true });
}

/** Out of the person's way: a hidden app shows no window, whatever the agent does inside it. */
async function putAway(spec) {
  const pid = await browserPid(spec);
  if (pid) await macApp(pid, "hide");
}

/**
 * The person's sign-ins live in the browser they use, so their copy is taken fresh each time Bees
 * opens it, and is thrown away first: a copy that only ever grows keeps sign-ins the person has since
 * removed, and holds the profile lock a killed browser left behind.
 */
function copyProfile(mode, spec) {
  const profile = profileOf(spec);
  // a real browser holds several profiles and opens the one it last used, which is not always "Default"
  const folder = activeProfile(spec);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(join(profile, folder), { recursive: true });
  for (const part of signInFiles(folder)) {
    if (existsSync(join(spec.support, part))) cpSync(join(spec.support, part), join(profile, part), { recursive: true });
  }
  copiedFolders.set(mode, folder);
  return folder;
}

/** Which profile folder the browser itself would open, so the copy is the one with the sign-ins in it. */
function activeProfile(spec) {
  try {
    const { profile } = JSON.parse(readFileSync(join(spec.support, "Local State"), "utf8"));
    // a name left behind by a deleted profile would copy nothing at all, so it has to exist here
    if (typeof profile?.last_used === "string" && existsSync(join(spec.support, profile.last_used, "Preferences"))) {
      return profile.last_used;
    }
  } catch { /* no Local State to read, so the folder every browser keeps */ }
  return "Default";
}

async function launch(mode, visible, takeCopy = true) {
  if (process.platform !== "darwin") throw new Error("The agent's browser needs macOS");
  const spec = target(mode);
  if (!existsSync(spec.binary)) throw new Error(`${mode === "personal" ? "Your default browser" : "Google Chrome"} is not installed`);
  // a relaunch keeps the profile it is holding: the copy carries the sign-in the person just did in it,
  // and taking a fresh one would wipe that sign-in along with it
  const copied = spec.support ? (takeCopy ? copyProfile(mode, spec) : copiedFolders.get(mode)) : null;
  const child = spawn(spec.binary, [
    `--user-data-dir=${profileOf(spec)}`,
    // the copy says which profile it last used, and that can name one the person has deleted, so the
    // profile we actually copied is the one it opens
    ...(copied ? [`--profile-directory=${copied}`] : []),
    `--remote-debugging-port=${spec.port}`,
    "--no-first-run",
    "--no-default-browser-check",
    // quitting Bees kills this browser, so every launch would ask to restore pages
    "--hide-crash-restore-bubble",
    // A browser nobody is signing in on runs headless: macOS registers that one as a background app,
    // so it holds the person's sign-ins without a window to pop up and without a Dock icon beside
    // their own browser all day. The one a person signs in on has a window, made in the background.
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
  if (!visible) return;
  // however the window goes, the browser ends up out of the person's way
  try { await openWindow(spec); } finally { await putAway(spec); }
}

/** The port stops answering while the browser that held it goes, so the next launch is not refused by
 *  the dying one, which still answers for a moment. */
async function untilFree(spec) {
  const deadline = Date.now() + PATIENCE * 2;
  while (await answering(spec)) {
    if (Date.now() > deadline) return;
    await delay(100);
  }
}

/** Swap the two shapes of the same browser. Both work on the same profile, so the sign-in the person
 *  just did, and every cookie in it, is there for whichever one comes up. */
async function relaunch(mode, visible) {
  const spec = target(mode);
  if (running(mode)) children.get(mode).kill();
  children.delete(mode);
  await untilFree(spec);
  await launch(mode, visible, false);
}

/** The browser a person signs in on, which is the one with a window. */
async function makeVisible(mode) {
  const spec = target(mode);
  if (await headless(spec)) await relaunch(mode, true);
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
export async function saveBrowserState(mode = "own") {
  const spec = target(mode);
  // ours, not running: a browser started by an earlier Bees is still the one holding the cookies,
  // and its process handle died with the old Bees.
  const state = await ours(spec) ? await cookiesOf(spec) : NO_COOKIES;
  const path = browserStatePath(mode);
  // this file holds the person's live sign-ins, so only they can read it
  writeFileSync(path, JSON.stringify(state), { mode: 0o600 });
  // the mode above counts only when the write creates the file, and an earlier Bees left it open
  chmodSync(path, 0o600);
}

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

/** Bring the browser up. Cheap once it runs; one launch at a time, however many ask. */
export function startAgentBrowser(mode = "own") {
  if (running(mode) || starting.has(mode)) return starting.get(mode) ?? Promise.resolve();
  const launched = launchIfAbsent(mode).finally(() => { starting.delete(mode); });
  starting.set(mode, launched);
  return launched;
}

async function launchIfAbsent(mode) {
  const spec = target(mode);
  // a browser an earlier Bees left on this port still holds the sign-ins, and taking a fresh copy of
  // the person's profile would pull it out from under that browser, so it is adopted as it stands.
  if (await ours(spec)) return;
  // anything else on the port is not ours to read from or to drive, and saying which process holds
  // it saves whoever has to sort this out a hunt for a second Bees that may not be there
  if (await answering(spec)) {
    const pid = await browserPid(spec);
    throw new Error(`Something else is using the agent's browser port ${spec.port}${pid ? ` (process ${pid})` : ""}`);
  }
  await launch(mode, false);
}

/** Put the browser in front so a person can sign in, and land on the tab the agent is reading. */
export async function showAgentBrowser(mode = "own", url) {
  if (url) return navigateAgentBrowser(mode, url);
  await startAgentBrowser(mode);
  await makeVisible(mode);
  const spec = target(mode);
  await openWindow(spec);
  await bringUp(spec);
}

/**
 * Navigate the agent's browser to a specific URL and bring it forward. Used when an agent hits a
 * login wall so the person lands directly on the sign-in page rather than about:blank.
 */
export async function navigateAgentBrowser(mode = "own", url) {
  await startAgentBrowser(mode);
  await makeVisible(mode);
  const spec = target(mode);
  // own tab brought to the front, so the person sees the sign-in page and the agent's tab is left alone
  try {
    const pages = await fetch(`${base(spec)}/json/list`, { signal: AbortSignal.timeout(PATIENCE) }).then((r) => r.json());
    const open = pages.find((page) => page.type === "page" && page.url === url)
      ?? await fetch(`${base(spec)}/json/new?${encodeURI(url)}`, { method: "PUT" }).then((r) => r.json());
    await fetch(`${base(spec)}/json/activate/${open.id}`);
  } catch { /* the window still comes up, and the person can type the address themselves */ }
  await bringUp(spec);
}

/** Back out of the person's way once they have answered. Ours, not running: a browser an earlier Bees
 *  started is still the window on screen, and its process handle died with the old Bees. */
export async function hideAgentBrowser(mode = "own") {
  const spec = target(mode);
  if (!(await ours(spec))) return;
  await putAway(spec);
  // nobody is signing in any more, so the window, and the Dock icon that comes with it, both go
  if (!(await headless(spec))) await relaunch(mode, false);
}

/** Bees is going away and no browser has an owner left, so neither would sit there as an orphan window. */
export function closeAgentBrowser() {
  for (const [mode, child] of children) if (running(mode)) child.kill();
  children.clear();
}
