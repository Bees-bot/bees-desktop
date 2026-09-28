# Changelog

Notable changes, newest first. Dates are release dates.

## Unreleased

- Building from source needs Rust 1.88 instead of 1.84, which clears the open security
  alerts in the shipped dependencies.
- The installer is about 200 MB smaller: each download now carries only the builds for the
  computer it runs on, and the memory installer ships once instead of twice.
- OpenCode Zen connects like every other AI connection, so an OpenCode Go plan runs the
  models it offers.
- Agents cannot read passwords, browser profiles or Bees' own files, and they ask before
  sending email. Removing Bees asks in a real macOS window a script cannot skip.
- Only the app's own window can reach the local server that answers Bees.
- Upgrade the bundled DeepSeek Harness from 0.1.7-alpha.1 to 0.1.7-rc.2.
- Wait for owned background jobs before settling a stage. Model output limits now
  report a recoverable failure instead of reporting successful completion.
- Enforce each run's MCP grants when tools connect during an existing conversation.
- Use native text/image retention while preserving full business evidence and
  historical tool-result recall.
- Preview authorized run spreadsheets, Word documents, and presentations with the
  native document renderer. Add conversation detail preferences and native Team UI.
- Keep work running when the window closes; warn before quitting with active or
  queued work, or when activity cannot be checked. Temporal remains the scheduler.

- File previews now support images, PDFs, HTML, audio, video, and more text/code formats across run files and mapped files.
- Node 24 is required, and the app runtime, the native modules and the workflow builds all use it.
  Built under an older Node, the free AI option failed on a fresh install.
- Fixed an issue where the same output folder could not be selected multiple times by returning the existing mapped folder.
- The custom answer box for conversational reviews with options is now a multi-line text area instead of a single-line input.
- Planning runs (Process planner executions) now properly show up in the Process Runs list ("Recent process runs").


- Completed reviews now show the worker's plain-language result and files in the conversation,
  followed by the review verdict, while detailed evidence remains separate.
- Releases build installers for Apple Silicon, Intel Mac, Linux x64, and Windows x64.
  All builds must succeed before the release becomes public. Downloads include SHA-256 checksums.
- Published release notes are announced to the community's Discord updates channel.
- Upgrade notice: the 0.2 series uses a different local database from 0.1.1. Existing
  0.1.1 data is not automatically migrated. Back up your existing application data and
  keep your old installation before trying the new version. Automatic updates remain disabled.

## 0.1.1

First release signed with a real Developer ID and notarized by Apple, so macOS opens it
without a warning. Apple Silicon only for now.

- The bundled local-model runtime is signed on every build rather than only when it is first
  downloaded. It is cached between builds, so release builds were shipping a stale ad-hoc
  signature and Apple rejected the whole bundle for it.
- A goal that one worker could finish in a single run is no longer split into a task nobody
  needed. The planner was told to plan first and skip planning only as an aside, so small goals
  came back as a one-task plan with an approval attached. External actions still get their own
  approved task, however small.
- The release build no longer produces a Windows installer. Mac ships first and
  Windows follows once code signing is set up, so a release cannot pair a signed Mac
  build with an unsigned .msi that SmartScreen blocks. Linux is unaffected.
- The app checks for a new version at startup and can install it and restart. Model weights
  are downloaded separately at first run, so an update never re-downloads them.
- Releases now publish the update packages that startup check needs. The bundle was never
  asked to produce them, so a release carried installers only and no installed app ever saw
  a new version. They are signed with the updater key, which now exists.
- A release build signs the bundled local-model runtime with the real Developer ID, with a
  secure timestamp and the hardened runtime, instead of ad-hoc signing it. Apple rejects an
  ad-hoc signature at notarization. Local builds are unchanged.
- A signed build no longer kills its own agent runtime. Signing turns on the hardened
  runtime, which forbids writable-executable memory, and the bundled Node sidecar is V8, so
  it died on its first JIT allocation. The bundle now carries the two entitlements that
  allow it.
- An update that fails after you accept it now says so. The download and install were fired
  and forgotten, so a dropped connection or a bad package left the app you agreed to restart
  simply never restarting, with nothing on screen.
- The app no longer refuses to start when its database predates a column. `schema.sql` is
  all `CREATE TABLE IF NOT EXISTS`, so a shipped update that added a column left every
  existing install crashing at launch with `no such column: conversation_text`. Columns are
  now added before the schema runs.

## 0.1.0

First build. Signed with a placeholder, so macOS and Windows still block it.
Treat it as a test build.
