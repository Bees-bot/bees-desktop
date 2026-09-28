import { existsSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cp } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

// BEES_DATA_DIR holds the work and can be shared, BEES_APP_DATA is this computer's own folder
export const dataDirectory = () => process.env.BEES_DATA_DIR;
export const appDirectory = () => process.env.BEES_APP_DATA;
export const sharedFolder = () => dataDirectory() !== appDirectory();
// several computers open a shared folder, so the app writes this computer's id beside itself
export const deviceId = () => readFileSync(join(appDirectory(), "device-id"), "utf8").trim();

// native realpath also fixes the letter case, which a case-insensitive disk would otherwise let slip past
const real = (path) => { try { return realpathSync.native(path); } catch { return dirname(path) === path ? path : join(real(dirname(path)), basename(path)); } };
const under = (path, root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

/** What agents may never read: Bees' own files, keys, logins and browser profiles. Runs, uploads and skills stay open. */
export function readFence() {
  const home = homedir(), dsh = process.env.DSH_HOME, db = process.env.BEES_DATABASE_PATH;
  const list = (paths) => [...new Set(paths.filter(Boolean).map((path) => real(resolve(path))))];
  return {
    closed: list([appDirectory(), ...["", "-wal", "-shm"].map((end) => db && db + end), dataDirectory() && join(dataDirectory(), "api-specs"),
      ...[".ssh", ".aws", "Library/Keychains", "Library/Safari"].map((name) => join(home, name)),
      ...["Google", "BraveSoftware", "Firefox", "Microsoft Edge", "Arc"].map((name) => join(home, "Library/Application Support", name))]),
    open: list([process.env.BEES_DEFAULT_WORKSPACE, dsh && join(dsh, "attachments"), dsh && join(dsh, "skills")])
  };
}

/** Whether the fence closes this path. A search also counts as closed when a closed folder sits somewhere below it. */
export function fenced(path, search = false) {
  const { closed, open } = readFence(), target = real(resolve(path));
  return closed.some((root) => under(target, root) || (search && under(root, target))) && !open.some((root) => under(target, root));
}

/** Which other computer holds the app's lock on that folder; a lock that will not read counts as held. */
function folderHeldBy(directory) {
  try {
    const [device, computer] = readFileSync(join(directory, "in-use"), "utf8").split("\n");
    return device.trim() === deviceId() ? "" : computer?.trim() || "Another computer";
  } catch (error) { return error.code === "ENOENT" ? "" : "Another computer"; }
}

/** A run waiting to start holds the folder it was queued with, and a live one writes into it now. */
export function assertNothingRunning(database, live) {
  const queued = database.prepare("SELECT count(*) AS count FROM execution_links WHERE status = 'queued'").get().count;
  if (live?.size || queued) throw new Error("Wait for what is running to finish, then choose the folder");
}

/** Point Bees at a shared folder, or back at this computer. The work is copied, never moved. */
export async function useDataFolder(database, directory, live) {
  const target = resolve(String(directory ?? "").trim() || appDirectory());
  if (!existsSync(target) || !statSync(target).isDirectory())
    throw new Error("That folder is not on this computer. Pick one that exists here, or open Settings → Data folder and use this computer again.");
  if (target.startsWith(appDirectory() + sep))
    throw new Error("Choose a folder outside Bees, one this computer shares with your other computer");
  if (target === dataDirectory()) return { path: target, shared: sharedFolder(), restart: false };
  const busy = folderHeldBy(target);
  if (busy) throw new Error(`${busy} has that Bees folder open. Quit Bees there first.`);
  assertNothingRunning(database, live);
  const file = join(target, basename(process.env.BEES_DATABASE_PATH));
  // a shared folder that already has a database is the other computer's work, so join it instead
  if (target === appDirectory() || !existsSync(file)) {
    // staged and renamed in last, so a copy that dies halfway never replaces or passes for a whole one
    const staged = `${file}.copying`;
    rmSync(staged, { force: true });
    database.exec(`VACUUM INTO '${staged.replaceAll("'", "''")}'`);
    for (const name of ["workspaces", "api-specs"])
      if (existsSync(join(dataDirectory(), name)))
        await cp(join(dataDirectory(), name), join(target, name), { recursive: true });
    for (const suffix of ["-wal", "-shm"]) rmSync(file + suffix, { force: true });
    renameSync(staged, file);
  }
  const pointer = join(appDirectory(), "data-folder");
  if (target === appDirectory()) rmSync(pointer, { force: true });
  else {
    // renamed in last, so a write that dies halfway leaves the last good folder named
    writeFileSync(`${pointer}.writing`, target);
    renameSync(`${pointer}.writing`, pointer);
  }
  return { path: target, shared: target !== appDirectory(), restart: true };
}
