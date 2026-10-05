# Known limitations

What the 0.2 series does not do yet. Everything here is deliberate, not a bug list. Last
reviewed 5 October 2026.

## Installing

- Windows installers are unsigned and SmartScreen warns on them. They stay unsigned until
  there is an Azure signing account.
- Linux packages are not signed. The 0.2.0 Linux downloads need Ubuntu 24.04 or newer (glibc 2.39). Later releases run on Ubuntu 22.04 too.
- macOS builds are signed with a Developer ID and notarized by Apple. A build from source
  without that certificate is ad-hoc signed, and Gatekeeper blocks its first launch.
- Only the latest release receives security fixes.

## Updating and upgrading

- Bees updates itself starting with 0.2.0. Version 0.1.1 looks for updates somewhere else, so
  it never sees 0.2 and has to be replaced by hand.
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

- Releases cover Apple Silicon and Intel Macs, Linux x64 and Windows x64. The Mac build has
  had far more use than the Linux and Windows builds.
- The desktop bundles neither Docker nor PostgreSQL nor Python. Memory downloads its own Python
  the first time it starts.

## What the app does not do yet

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
- The agent's own Chrome listens on a local debugging port, 9333, that has no password. While
  it runs, any other program on the same computer can drive it, along with every site it is
  signed in to. The gate on port 9332, in front of your own browser when you allow that, has
  the same gap. We plan to close both.
- Gmail, Google Calendar and Google Drive connect through a Bees Google app that Google has not
  verified yet. Google shows an unverified-app warning when you sign in, and only the first 100
  people can connect.
