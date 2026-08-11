// Getting a fix onto machines that already have the app. Without this, a security release
// reaches nobody who already installed.
//
// The model is not part of an update. Weights are downloaded at first run into application
// data (see local-models.ts) and are not bundled, so replacing the app never re-downloads
// them.

import { resourceDir } from "@tauri-apps/api/path";
import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

/**
 * A still-quarantined app runs from a read-only copy under AppTranslocation, so replacing the
 * bundle fails. The updater only escalates on a permission error, not a read-only volume.
 */
async function runningFromReadOnlyCopy(): Promise<boolean> {
  try {
    return (await resourceDir()).includes("/AppTranslocation/");
  } catch {
    // If the path cannot be read, try the install anyway.
    return false;
  }
}

/**
 * Checks once, asks, installs, restarts. An unreachable endpoint or a signature that does
 * not verify must not stop the app from starting, so the check itself cannot throw.
 *
 * Installing is different: the user has said yes and is waiting for the app to restart, so
 * a failure there is thrown for the caller to show. Swallowing it would leave them watching
 * an update that never arrives.
 */
export async function checkForUpdate(): Promise<void> {
  let update;
  try {
    update = await check();
  } catch {
    // Offline, endpoint down, or the manifest signature did not verify.
    return;
  }
  if (!update) return;

  // Say it up front, rather than failing later on a filesystem error that names nothing.
  if (await runningFromReadOnlyCopy()) {
    throw new Error(
      `Bees ${update.version} is available, but this copy is running from a read-only location and cannot replace itself. Move Bees to your Applications folder in Finder, open it from there, and check again.`
    );
  }

  const notes = update.body?.trim();
  const accepted = await ask(
    `Bees ${update.version} is available.${notes ? `\n\n${notes}` : ""}\n\nInstall it and restart?`,
    { title: "Update Bees", kind: "info" }
  );
  if (!accepted) return;

  await update.downloadAndInstall();
  await relaunch();
}
