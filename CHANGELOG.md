# Changelog

Notable changes, newest first. Dates are release dates.

## Unreleased

- The release build no longer produces a Windows installer. Mac ships first and
  Windows follows once code signing is set up, so a release cannot pair a signed Mac
  build with an unsigned .msi that SmartScreen blocks. Linux is unaffected.
- The app checks for a new version at startup and can install it and restart. Model weights
  are downloaded separately at first run, so an update never re-downloads them.
- A release build signs the bundled local-model runtime with the real Developer ID, with a
  secure timestamp and the hardened runtime, instead of ad-hoc signing it. Apple rejects an
  ad-hoc signature at notarization. Local builds are unchanged.
- The app no longer refuses to start when its database predates a column. `schema.sql` is
  all `CREATE TABLE IF NOT EXISTS`, so a shipped update that added a column left every
  existing install crashing at launch with `no such column: conversation_text`. Columns are
  now added before the schema runs.

## 0.1.0

First build. Signed with a placeholder, so macOS and Windows still block it.
Treat it as a test build.
