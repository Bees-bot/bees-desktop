// Shipping a fix is only half of it — this is the half that gets the fix onto machines that
// already have the app. Without it a security release reaches nobody who already installed.
//
// The model is deliberately not part of this. Weights are downloaded at first run into
// application data (see `local-models.ts`), not bundled, so replacing the app bundle never
// re-downloads gigabytes.
//
// ponytail: check once at startup, ask, install, restart. No background polling, no staged
// rollout, no "remind me later" state to persist. Add those when the release cadence makes
// once-per-launch too slow.

import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

/** Asked before anything is downloaded, so an update is never a surprise restart. */
type Confirm = (message: string) => Promise<boolean> | boolean;

/**
 * Returns the version installed, or null when nothing was installed — no update available,
 * the check failed, or the user said no. Never throws: a broken update endpoint must not
 * stop the app from starting.
 */
export async function checkForUpdate(confirm: Confirm): Promise<string | null> {
  try {
    const update = await check();
    if (!update?.available) return null;
    const notes = update.body?.trim();
    const accepted = await confirm(
      `Bees ${update.version} is available.${notes ? `\n\n${notes}` : ""}\n\nInstall it and restart?`
    );
    if (!accepted) return null;
    await update.downloadAndInstall();
    await relaunch();
    return update.version;
  } catch {
    // Offline, an unreachable endpoint, or a signature that does not verify. A failed update
    // check is not a reason to interrupt someone who is trying to work.
    return null;
  }
}
