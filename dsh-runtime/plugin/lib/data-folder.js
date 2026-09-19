import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cp } from "node:fs/promises";
import { hostname } from "node:os";
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

/** Identity of this computer, not of the data: a shared folder is opened by several computers,
 *  so this cannot be read out of the database the way it used to be. */
export function deviceId() {
  const path = join(appDirectory(), "device-id");
  if (!existsSync(path)) writeFileSync(path, randomUUID());
  return readFileSync(path, "utf8").trim();
}

const LOCK = "in-use.json";
/** One computer at a time. Two of them writing into the same synced folder corrupts the database,
 *  and no sync service honours a file lock, so Bees keeps its own and refuses to be the second.
 *  Nothing expires: Google Drive can take longer to carry the lock than any wait worth having. */
export function claimDataFolder() {
  if (!sharedFolder()) return () => {};
  const busy = folderHeldBy(dataDirectory());
  if (busy) throw new Error(`${busy} has this Bees folder open. Quit Bees there, let Google Drive finish, then open it here.`);
  const path = join(dataDirectory(), LOCK);
  writeFileSync(path, JSON.stringify({ device: deviceId(), computer: hostname() }));
  return () => rmSync(path, { force: true });
}

/** Which computer has the folder open. Empty when it is free, or when the lock left behind is this
 *  computer's own. A lock that will not read counts as held: half a download is not permission. */
export function folderHeldBy(directory) {
  const path = join(directory, LOCK);
  if (!existsSync(path)) return "";
  try {
    const held = JSON.parse(readFileSync(path, "utf8"));
    return held.device === deviceId() ? "" : held.computer || "Another computer";
  } catch { return "Another computer"; }
}

/** Point Bees at a folder shared between computers, or back at this one. The work is copied,
 *  never moved, so a failed switch still leaves everything where it was. */
export async function useDataFolder(database, directory) {
  const target = resolve(String(directory ?? "").trim() || appDirectory());
  if (!existsSync(target) || !statSync(target).isDirectory())
    throw new Error("That folder is not on this computer");
  if (target !== appDirectory() && target.startsWith(appDirectory() + sep))
    throw new Error("Choose a folder outside Bees, one this computer shares with the other");
  if (target === dataDirectory()) return { path: target, shared: sharedFolder(), restart: false };
  const busy = folderHeldBy(target);
  if (busy) throw new Error(`${busy} has that Bees folder open. Quit Bees there first.`);
  const file = join(target, basename(env("BEES_DATABASE_PATH")));
  // A shared folder that already holds a database is the other computer's work: join it, never write
  // over it. This computer's own folder is the opposite, since the shared copy is always the newer
  // one. The database is copied last, so a half-finished copy never looks like a finished one.
  const copied = target === appDirectory() || !existsSync(file);
  if (copied) {
    for (const name of ["workspaces", "api-specs"])
      if (existsSync(join(dataDirectory(), name)))
        await cp(join(dataDirectory(), name), join(target, name), { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
    database.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  }
  writeFileSync(join(appDirectory(), "data-folder"), target === appDirectory() ? "" : target);
  return { path: target, shared: target !== appDirectory(), restart: true, copied };
}
