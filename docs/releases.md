# Releasing Bees

Releases are built, signed and published from a maintainer's Mac with `scripts/release.sh`.
Nothing builds on a tag or a schedule. The Mac builds Apple Silicon itself and starts
`.github/workflows/build.yml` on GitHub for the Intel Mac, Linux and Windows builds.

## One-time setup

- The Developer ID certificate `Developer ID Application: FunCove LLC (T9AGT95JD7)` in the
  login keychain, and a notarytool keychain profile named `bees-notary`
  (`xcrun notarytool store-credentials bees-notary`).
- The updater key at `../bees-signing/bees-updater.key`, with its password in
  `bees-updater.key.password` next to it. Its public half is `plugins.updater.pubkey` in
  `src-tauri/tauri.conf.json`. Lose the key and installed copies can never update again, so
  keep a backup somewhere safe. Never commit it.
- `gh` signed in with write access to `Bees-bot/bees-desktop`, and Node 24.7 or a newer 24.x.
- The repository secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` and
  `APPLE_SIGNING_IDENTITY`, so GitHub signs the Intel build. This Mac notarizes it. Export the
  certificate with `openssl pkcs12 -export -legacy`, because the macOS keychain reports an
  OpenSSL 3 default export as a wrong password.

## Release

1. Keep user-visible changes under `## Unreleased` in `CHANGELOG.md` as features merge.
2. `scripts/release.sh prepare 0.2.1` sets the version everywhere, turns Unreleased into the
   0.2.1 notes, and opens a PR. Merging it releases nothing.
3. On a clean, current `main`, `scripts/release.sh publish` builds Apple Silicon here while
   GitHub builds the rest, notarizes both Mac apps and disk images, signs every update with
   the updater key, and publishes the GitHub release as latest with the installers,
   `bees-update.json` and `SHA256SUMS`. It refuses a version that was already released.

The build takes most of this machine's memory, so close heavy apps first. After publishing,
install the DMG and open it once. A build that packages fine can still fail to start.

## In-app updates

The app checks `releases/latest/download/bees-update.json` at launch and every six hours,
and offers to install a newer version and restart. If runs are still active it asks once the
download is done, since installing replaces the files the running app uses. Each signature carries
its version, and the app refuses an update whose manifest names a different one.

Version 0.1.1 polls `latest.json` in this repository and trusts a different key. Its data
lives in a database the 0.2 series does not read, so it must never be offered a 0.2 build:
never publish a `latest.json` here, and never sign a release with the old `updater.key`.

## Failure and recovery

- Keep the lid open for the whole run, about 90 minutes. A locked keychain stops signing.
- The script stops at the first failed step and publishes nothing until the end, so fix the
  cause and run `publish` again. That rebuilds everything and reuses the unpublished draft.
- A published version is never rebuilt. Ship a new patch version instead.
