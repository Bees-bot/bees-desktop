# Known limitations

What the 0.2 series does not do yet. Everything here is deliberate, not a bug list. Last
reviewed 22 September 2026.

## Installing

- macOS builds are signed with a Developer ID and notarized by Apple. Without the Apple
  credentials available to CI the build falls back to ad-hoc signing, and Gatekeeper blocks
  the first launch.
- Windows installers are unsigned and SmartScreen warns on them. Enabling signing needs both
  Azure credentials and a `signCommand` in the Tauri bundle config; the second is deliberately
  absent until the first exists.
- Linux packages are not signed.
- Downloads need access to `Bees-bot/bees-desktop`. While that repository is private, anonymous
  downloads fall back to the release page, which also needs access.
- Only the latest release receives security fixes.

## Updating and upgrading

- The 0.2 series has no in-app updater. 0.1.1 had one; the rewrite dropped it, and publishing
  the `latest.json` it reads is explicitly rejected.
- A 0.1.1 installation does not take its data with it. 0.1.1 used the legacy runtime database
  and 0.2 uses a different one, so an upgrade opens an app with no existing workspaces or runs.
  Back up the old data and keep the old installation until you have moved what you need.
- There is no path back to an earlier version.
- A published version cannot be rebuilt. A correction ships as a new patch.

## Uninstalling

**Settings → Removing Bees** names the application data folder and its size, then deletes the
folder and quits Bees. There is no undo, and shared folders you chose yourself are left alone.

The app itself is still removed by hand: drag it from Applications to the Trash. Doing only that
leaves the data folder behind, and the next install reads it as it was.

## Platforms

- Release builds are configured for Apple Silicon, Intel Mac, Linux x64 and Windows x64. All
  four must succeed before a release becomes public.
- 0.1.1 shipped Apple Silicon only and produced no Windows installer.
- The Mac build has had far more use than the Linux and Windows builds.
- The desktop bundles neither Docker nor PostgreSQL nor Python.

## What the app does not do yet

- Workspaces and runs from earlier Bees versions are not migrated. Product data starts fresh.
- Turning memory off stops new retention. It does not erase sources already stored.
- A failed terminal extraction needs a manual retry from the interface.
- Shared application state is capped at 16 MB and is not a general-purpose data store.
- Applications are declarative JSON. They have no JavaScript hooks, no shell access, no
  arbitrary tool installation, no access to a signed-in browser, and no access to a private
  team folder.
- Paid actions are not available.
- Shared writes need a reachable server. A write that cannot be confirmed is refused locally
  rather than queued as an offline approval.
- Model weights are downloaded at first run and are not distributed with the software.
