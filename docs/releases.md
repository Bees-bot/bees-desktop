# Releasing Bees

`npm run release` runs `scripts/release.sh publish`, which starts
`.github/workflows/build.yml` on GitHub for Apple silicon,
Intel Mac, Linux and Windows. Mac jobs sign and notarize their installers. The local
script downloads the builds, signs automatic updates and publishes the release.
Nothing builds on a tag or a schedule.

## One-time setup

- The updater key at `../bees-signing/bees-updater.key`, with its password in
  `bees-updater.key.password` next to it. Its public half is `plugins.updater.pubkey` in
  `src-tauri/tauri.conf.json`. Lose the key and installed copies can never update again, so
  keep a backup somewhere safe. Never commit it.
- `gh` signed in with write access to `Bees-bot/bees-desktop`, and Node 24.7 or a newer 24.x.
- The repository secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and
  `APPLE_TEAM_ID`, so GitHub signs and notarizes both Mac builds. Export the
  certificate with `openssl pkcs12 -export -legacy`, because the macOS keychain reports an
  OpenSSL 3 default export as a wrong password.

## Release

1. Keep user-visible changes under `## Unreleased` in `CHANGELOG.md` as features merge.
2. `scripts/release.sh prepare 0.2.1` sets the version everywhere, turns Unreleased into the
   0.2.1 notes, and opens a PR. Merging it releases nothing.
3. On a clean, current `main`, `npm run release` builds all platforms on GitHub,
   signs and notarizes both Mac apps and disk images, signs every update with
   the updater key, and publishes the GitHub release as latest with the installers,
   `bees-update.json` and `SHA256SUMS`.
   It refuses a version that was already released.

Local copies are kept in `src-tauri/target/releases/<version>/`, with checksums
verified before upload.

Desktop builds also produce `Bees_runtime_<version>_<platform>_<arch>.tar.gz` support
packages containing LibreOffice, Sherpa/ONNX voice libraries, `uv`, and their licenses. Mac support packages are
signed and notarized before their checksum is embedded in the app. The release must
include all four support packages: installed clients download the exact archive
named by their bundled manifest, never a moving `latest` runtime. First launch prepares
these tools, Python, and Hindsight in the background without delaying chat. Cached
support stays outside the signed app under the Client's `runtimes` directory.
Development and headless builds retain their bundled tools.

Compilation runs on GitHub. After publishing, install the DMG and open it once.
A build that packages fine can still fail to start.

Run the `Install check` workflow with a published release tag to check installers
on clean machines. Before publication, pass `build_run` to check that run's build
artifacts with read-only permissions. If a Mac build came from a separate run,
pass its run ID in `apple_build_run` or `intel_build_run`.

GitHub displays these download labels, matching the processor and package format built:

| Download label | How to choose |
| --- | --- |
| Mac (Apple silicon) - installer (.dmg) | About This Mac shows an Apple chip. |
| Mac (Intel) - installer (.dmg) | About This Mac shows an Intel processor. |
| Windows (Intel/AMD 64-bit) - installer (.exe) | Windows on an Intel/AMD 64-bit computer. This is not a native ARM build. |
| Linux (Intel/AMD 64-bit) - DEB installer (.deb) | Install with a DEB package manager. The install-check workflow covers Ubuntu 22.04 and 24.04; it does not verify Debian or other distributions. |
| Linux (Intel/AMD 64-bit) - standalone app (.AppImage) | Run without installing a DEB package. System-library requirements still apply; this is not a promise of compatibility with every Linux distribution. |

The release notes include a short selection guide. Update-only files and checksums
are labeled separately. The underlying filenames stay unchanged for automatic
updates, direct links and install checks.

These choices follow Apple's [chip and processor identification guide](https://support.apple.com/en-us/116943)
and Tauri's [DEB](https://v2.tauri.app/distribute/debian/) and
[AppImage](https://v2.tauri.app/distribute/appimage/) documentation. Package format
alone does not establish distribution compatibility.

## In-app updates

The app checks `releases/latest/download/bees-update.json` at launch and every six hours,
and offers to install a newer version and restart. Users can also choose **Check for updates**
at the top of desktop Settings. If runs are still active it asks once the
download is done, since installing replaces the files the running app uses. Each signature carries
its version, and the app refuses an update whose manifest names a different one.

## Failure and recovery

- Keep the publishing machine awake and online for the whole run, about 90 minutes.
- The script stops at the first failed step and publishes nothing until the end, so fix the
  cause and run `npm run release` again. That rebuilds everything and reuses the unpublished draft.
- A published version is never rebuilt. Ship a new patch version instead.
