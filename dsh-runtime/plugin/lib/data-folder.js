import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cp } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

// Tauri sets both. BEES_DATA_DIR holds the work: the database and the workspaces. BEES_APP_DATA is
// this computer's own folder and keeps what cannot travel: models, logs, sessions and credentials.
function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Bees did not provide ${name}`);
  return value;
}
export const dataDirectory = () => env("BEES_DATA_DIR");
export const appDirectory = () => env("BEES_APP_DATA");
/** True once the person points Bees at a folder they share between computers. */
export const sharedFolder = () => dataDirectory() !== appDirectory();

/** Identity of this computer, not of the work: a shared folder is opened by several computers, so
 *  this cannot come out of the database. The app writes it before it starts us. */
export const deviceId = () => readFileSync(join(appDirectory(), "device-id"), "utf8").trim();

/** A run folder is stored as the absolute path of the computer that made it, and a shared folder
 *  sits somewhere different on each one, so a path from the other computer is rebased onto ours. */
export function mounted(path) {
  const at = path.lastIndexOf(`${sep}workspaces${sep}`);
  return at === -1 ? path : join(dataDirectory(), path.slice(at + 1));
}

/** Which computer has that folder open, empty when it is free or the lock left behind is our own.
 *  The app claims and releases it; this only reads, to refuse a folder before switching to it.
 *  A lock that will not read counts as held: half a download is not permission. */
function folderHeldBy(directory) {
  const path = join(directory, "in-use");
  if (!existsSync(path)) return "";
  try {
    const [device, computer] = readFileSync(path, "utf8").split("\n");
    return device.trim() === deviceId() ? "" : computer?.trim() || "Another computer";
  } catch { return "Another computer"; }
}

/** Point Bees at a folder shared between computers, or back at this one. The work is copied,
 *  never moved, so a failed switch still leaves everything where it was. */
export async function useDataFolder(database, directory) {
  const target = resolve(String(directory ?? "").trim() || appDirectory());
  if (!existsSync(target) || !statSync(target).isDirectory())
    throw new Error("That folder is not on this computer");
  if (target.startsWith(appDirectory() + sep))
    throw new Error("Choose a folder outside Bees, one this computer shares with the other");
  if (target === dataDirectory()) return { path: target, shared: sharedFolder(), restart: false };
  const busy = folderHeldBy(target);
  if (busy) throw new Error(`${busy} has that Bees folder open. Quit Bees there first.`);
  // The database is copied before the files are, so anything that writes while the copy runs would
  // be left behind in the old folder. Nothing else writes on its own while a person sits in settings.
  const running = database.prepare(`SELECT count(*) AS count FROM execution_links
    WHERE status IN ('queued', 'running', 'waiting_for_input', 'waiting_for_approval')`).get().count;
  if (running) throw new Error("Wait for what is running to finish, then choose the folder");
  const file = join(target, basename(env("BEES_DATABASE_PATH")));
  // A shared folder that already holds a database is the other computer's work: join it, never write
  // over it. This computer's own folder is the opposite, since the shared copy is always the newer one.
  const copied = target === appDirectory() || !existsSync(file);
  if (copied) {
    // Written beside the target and moved in once it is whole, so a copy that dies halfway neither
    // destroys what was there nor gets mistaken for a finished one on the next try. The database
    // goes first: a run it knows about then always has its files, and later files are only spare.
    const staged = `${file}.copying`;
    rmSync(staged, { force: true });
    database.exec(`VACUUM INTO '${staged.replaceAll("'", "''")}'`);
    for (const name of ["workspaces", "api-specs"])
      if (existsSync(join(dataDirectory(), name)))
        await cp(join(dataDirectory(), name), join(target, name), { recursive: true });
    // Only the sidecars are deleted; renaming over the database replaces it in one step, so there
    // is no moment where the folder has no database at all.
    for (const suffix of ["-wal", "-shm"]) rmSync(file + suffix, { force: true });
    renameSync(staged, file);
  }
  const pointer = join(appDirectory(), "data-folder");
  if (target === appDirectory()) rmSync(pointer, { force: true });
  else writeFileSync(pointer, target);
  return { path: target, shared: target !== appDirectory(), restart: true };
}
