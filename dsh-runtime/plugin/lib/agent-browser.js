import { execFile, execFileSync, spawn } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { stateDirectory } from "./product-database.js";

/** A browser that stops answering must not leave a run waiting on it for ever. */
const PATIENCE = 5_000;

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Bees' own browser: its own profile and port, so a team that did not ask for the person's browser
 *  never sees, or signs out of, anything the person is signed in to. */
const OWN = { port: 9333, profile: "browser-profile", state: "browser-state.json" };
/** The person's sign-ins: a copy of their Chromium profile, or their Firefox or Safari cookies loaded into Chrome.
 *  A copy, because Chrome 136 and later ignore --remote-debugging-port on the profile folder in use. */
const PERSONAL = { port: 9332, profile: "browser-profile-personal", state: "browser-state-personal.json" };

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
/** Firefox and its forks, by bundle id, and where each keeps its Profiles folder. */
const FIREFOX = {
  "org.mozilla.firefox": "Firefox",
  "org.mozilla.firefoxdeveloperedition": "Firefox",
  "org.mozilla.nightly": "Firefox",
  "app.zen-browser.zen": "zen",
  "io.gitlab.librewolf-community": "librewolf"
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

/** mode -> the browser running for it, and mode -> the last launch or swap queued for it. */
const children = new Map();
const queued = new Map();
/** mode -> the profile folder inside its copy of the person's profile. */
const copiedFolders = new Map();
/** run -> the browser it brought up to sign in on, so only its own answer puts that window away. */
const signingIn = new Map();

let looked = false;
let found = null;

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
    if (browser.binary === CHROME) return `Runs can't browse the web. Bees uses your ${browser.name} sign-ins through Google Chrome, and Chrome isn't installed. Install Google Chrome so runs can browse.`;
    // own-browser teams and runs with no team still launch Chrome
    return "Teams that use Bees' own browser can't browse until Google Chrome is installed.";
  }
  if (!browser) return `Bees can't drive ${yours}, so runs browse in a separate Google Chrome. Sign in to each site there once.`;
  // the same check the launch makes, so the person hears it before a run stops on it
  if (browser.cookies === safariCookies) try { safariFile((path) => closeSync(openSync(path, "r"))); } catch (error) { return error.message; }
  return "";
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
    // a chromium browser that never ran has no profile to copy, so it would browse signed out
    if (CHROMIUM[app.id] && existsSync(join(support(CHROMIUM[app.id]), "Local State"))) return { name, binary: app.binary, support: support(CHROMIUM[app.id]) };
    // a browser Bees cannot drive lends its cookies to Chrome, which then browses as the person
    if (FIREFOX[app.id]) return { name, binary: CHROME, cookies: () => firefoxCookies(support(FIREFOX[app.id])) };
    if (app.id === "com.apple.Safari") return { name, binary: CHROME, cookies: safariCookies };
    return { name };
  } catch { return null; }
}

const touched = (jar) => Math.max(...["", "-wal"].map((end) => existsSync(jar + end) ? statSync(jar + end).mtimeMs : 0));

/** Firefox's cookies, from the profile used last, in the shape CDP's Storage.setCookies takes. */
function firefoxCookies(support) {
  const root = join(support, "Profiles");
  const jar = (existsSync(root) ? readdirSync(root) : []).map((name) => join(root, name, "cookies.sqlite")).filter(existsSync)
    // a running firefox writes to the wal, so the main file's time lags behind the profile in use
    .sort((a, b) => touched(b) - touched(a))[0];
  if (!jar) return [];
  // a running Firefox holds the file and keeps recent cookies in its wal, so both are read from a copy
  const copy = mkdtempSync(join(tmpdir(), "bees-cookies-"));
  let database;
  try {
    for (const end of ["", "-wal"]) if (existsSync(jar + end)) cpSync(jar + end, join(copy, `cookies.sqlite${end}`));
    database = new DatabaseSync(join(copy, "cookies.sqlite"));
    // originAttributes marks container tabs and partitioned cookies, which are not the person's own sign-ins
    return database.prepare("SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies WHERE originAttributes = ''").all()
      .map(({ host, name, value, path, expiry, isSecure, isHttpOnly, sameSite }) => ({
        domain: host, name, value, path, secure: Boolean(isSecure), httpOnly: Boolean(isHttpOnly),
        // newer Firefox counts milliseconds
        expires: expiry > 1e11 ? expiry / 1000 : expiry,
        // firefox stores None as 0, and chrome drops a None cookie that is not secure
        sameSite: sameSite === 2 ? "Strict" : sameSite === 1 ? "Lax" : isSecure ? "None" : undefined
      }));
  } finally {
    database?.close();
    rmSync(copy, { recursive: true, force: true });
  }
}

/** Safari's cookie file sits behind Full Disk Access; one Safari never stored a cookie in is null. */
function safariFile(read) {
  try {
    return read(join(homedir(), "Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
    throw new Error("Runs can't use your Safari sign-ins yet. Give Bees Full Disk Access in System Settings, Privacy & Security, then reopen Bees.");
  }
}

/** Safari's cookies, read from its binarycookies file, in the shape CDP's Storage.setCookies takes. */
function safariCookies() {
  const file = safariFile(readFileSync);
  if (!file) return [];
  try { return parseBinaryCookies(file); } catch { throw new Error("Safari's cookie file is in a format Bees cannot read"); }
}

function parseBinaryCookies(file) {
  if (file.toString("latin1", 0, 4) !== "cook") throw new Error("not a cookie file");
  // big-endian page count and sizes, then little-endian pages of cookies whose strings sit at offsets
  const cookies = [];
  const pages = file.readUInt32BE(4);
  for (let page = 0, at = 8 + 4 * pages; page < pages; at += file.readUInt32BE(8 + 4 * page++)) {
    for (let index = 0; index < file.readUInt32LE(at + 4); index++) {
      const cookie = at + file.readUInt32LE(at + 8 + 4 * index);
      const text = (field) => {
        const from = cookie + file.readUInt32LE(cookie + field);
        return file.toString("utf8", from, file.indexOf(0, from));
      };
      const flags = file.readUInt32LE(cookie + 8);
      cookies.push({ domain: text(16), name: text(20), path: text(24), value: text(28), secure: Boolean(flags & 1),
        // apple counts from 2001
        httpOnly: Boolean(flags & 4), expires: file.readDoubleLE(cookie + 40) + 978_307_200 });
    }
  }
  return cookies;
}

/** Which browser one team's runs drive. */
const browserMode = (teamId) => teamId && usesDefaultBrowser(teamId) && defaultBrowser() ? "personal" : "own";

/** Which browser one run drives: the team that owns its workspace decides, and a run with no team
 *  gets Bees' own rather than a person's sign-ins it has no setting for. */
export const browserModeFor = (database, workspaceId) =>
  browserMode(database.prepare("SELECT team_id AS teamId FROM workspaces WHERE id = ?").get(workspaceId ?? "")?.teamId ?? "");

export const browserPort = (mode = "own") => target(mode).port;

/** Bees' own browser for a team that turned yours off, or when Bees can't drive yours. */
function target(mode) {
  const browser = mode === "personal" ? defaultBrowser() : null;
  return browser ? { ...PERSONAL, ...browser } : { ...OWN, binary: CHROME };
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

/**
 * The person's sign-ins live in the browser they use, so their copy is taken fresh the first time
 * each Bees opens it, and is thrown away first: a copy that only ever grows keeps sign-ins the person
 * has since removed, and holds the profile lock a killed browser left behind.
 */
function copyProfile(mode, spec) {
  const profile = profileOf(spec);
  // a real browser holds several profiles and opens the one it last used, which is not always "Default"
  const folder = spec.support ? activeProfile(spec) : "Default";
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(join(profile, folder), { recursive: true });
  for (const part of spec.support ? signInFiles(folder) : []) {
    if (existsSync(join(spec.support, part))) cpSync(join(spec.support, part), join(profile, part), { recursive: true });
  }
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
  if (!existsSync(spec.binary)) throw new Error(`${basename(spec.binary)} is not installed`);
  // read before anything starts, so a browser Bees cannot read stops the launch instead of browsing signed out
  // chrome refuses the whole batch over one cookie it would never store
  const seed = takeCopy && spec.cookies ? spec.cookies().filter(({ name, value, path, expires }) => expires > Date.now() / 1000
    && name.length + value.length <= 4096 && path.length <= 1024 && !/[;\x00-\x1f\x7f]/.test(name + value)) : null;
  // a relaunch keeps the profile it is holding: the copy carries the sign-in the person just did in it,
  // and taking a fresh one would wipe that sign-in along with it
  const copied = spec.support || spec.cookies ? (takeCopy ? copyProfile(mode, spec) : copiedFolders.get(mode)) : null;
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
  if (seed) await cdp(spec, "Storage.setCookies", { cookies: seed }).catch((error) => { child.kill(); throw error; });
  // only a copy that came up with its cookies counts, or a crash relaunch would keep an empty one
  if (copied) copiedFolders.set(mode, copied);
  children.set(mode, child);
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
  await launch(mode, visible, false);
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
  // and its process handle died with the old Bees.
  const state = await ours(spec) ? await cookiesOf(spec) : NO_COOKIES;
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
  // a browser an earlier Bees left on this port still holds the sign-ins, and taking a fresh copy of
  // the person's profile would pull it out from under that browser, so it is adopted as it stands.
  const args = await ours(spec);
  if (args) {
    // a swap has to reopen the profile it opened, and only the old Bees knew which
    const folder = args.match(/--profile-directory=(.+?) --remote-debugging-port=/)?.[1];
    if (folder) copiedFolders.set(mode, folder);
    return;
  }
  // anything else on the port is not ours to read from or to drive, and saying which process holds
  // it saves whoever has to sort this out a hunt for a second Bees that may not be there
  if (await answering(spec)) {
    const pid = await browserPid(spec);
    throw new Error(`Something else is using the agent's browser port ${spec.port}${pid ? ` (process ${pid})` : ""}`);
  }
  // one that crashed comes back on the copy it had, with whatever the person signed in to since
  await launch(mode, false, !copiedFolders.has(mode));
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
    if (await headless(spec)) await relaunch(mode, true);
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
    // ours, not running: a browser an earlier Bees started is still the window on screen
    if ([...signingIn.values()].includes(mode) || !(await ours(spec))) return;
    await putAway(spec);
    // nobody is signing in any more, so the window, and the Dock icon that comes with it, both go
    if (!(await headless(spec))) await relaunch(mode, false);
  });
}

/** Bees is going away and no browser has an owner left, so neither would sit there as an orphan window. */
export function closeAgentBrowser() {
  for (const [mode, child] of children) if (running(mode)) child.kill();
  children.clear();
}
