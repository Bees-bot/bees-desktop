// Getting a fix onto machines that already have the app. Without this, a security release
// reaches nobody who already installed.
//
// The model is not part of an update. Weights are downloaded at first run into application
// data (see local-models.ts) and are not bundled, so replacing the app never re-downloads
// them.

import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

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

  const notes = update.body?.trim();
  const accepted = await ask(
    `Bees ${update.version} is available.${notes ? `\n\n${notes}` : ""}\n\nInstall it and restart?`,
    { title: "Update Bees", kind: "info" }
  );
  if (!accepted) return;

  await update.downloadAndInstall();
  await relaunch();
}
