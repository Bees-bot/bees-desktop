import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cp } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

// BEES_DATA_DIR holds the work and can be shared, BEES_APP_DATA is this computer's own folder
function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Bees did not provide ${name}`);
  return value;
}
export const dataDirectory = () => env("BEES_DATA_DIR");
export const appDirectory = () => env("BEES_APP_DATA");
export const sharedFolder = () => dataDirectory() !== appDirectory();
// several computers open a shared folder, so the app writes this computer's id beside itself
export const deviceId = () => readFileSync(join(appDirectory(), "device-id"), "utf8").trim();

/** Rebase a run folder made on the other computer onto this computer's mount. */
export function mounted(path) {
  const at = path.lastIndexOf(`${sep}workspaces${sep}`);
  return at === -1 ? path : join(dataDirectory(), path.slice(at + 1));
}

/** Which other computer holds the app's lock on that folder; a lock that will not read counts as held. */
function folderHeldBy(directory) {
  const path = join(directory, "in-use");
  if (!existsSync(path)) return "";
  try {
    const [device, computer] = readFileSync(path, "utf8").split("\n");
    return device.trim() === deviceId() ? "" : computer?.trim() || "Another computer";
  } catch { return "Another computer"; }
}

/** Point Bees at a shared folder, or back at this computer. The work is copied, never moved. */
export async function useDataFolder(database, directory) {
  const target = resolve(String(directory ?? "").trim() || appDirectory());
  if (!existsSync(target) || !statSync(target).isDirectory())
    throw new Error("That folder is not on this computer");
  if (target.startsWith(appDirectory() + sep))
    throw new Error("Choose a folder outside Bees, one this computer shares with the other");
  if (target === dataDirectory()) return { path: target, shared: sharedFolder(), restart: false };
  const busy = folderHeldBy(target);
  if (busy) throw new Error(`${busy} has that Bees folder open. Quit Bees there first.`);
  // a run writing during the copy would be left behind in the old folder
  const running = database.prepare(`SELECT count(*) AS count FROM execution_links
    WHERE status IN ('queued', 'running', 'waiting_for_input', 'waiting_for_approval')`).get().count;
  if (running) throw new Error("Wait for what is running to finish, then choose the folder");
  const file = join(target, basename(env("BEES_DATABASE_PATH")));
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
  else writeFileSync(pointer, target);
  return { path: target, shared: target !== appDirectory(), restart: true };
}
