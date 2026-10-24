# DSH upgrade checklist

Bees ships one DeepSeek Harness release at a time. The current release is
`0.2.1-rc.3`; every `@deepseek-ai/dsh*` runtime dependency and plugin peer must
use that exact version.

## Prepare a candidate

1. Read the candidate DSH release notes and public API documentation.
2. On a branch, change every `@deepseek-ai/dsh*` version in
   `dsh-runtime/package.json`, `dsh-runtime/plugin/package.json`, and all
   `dsh-runtime/plugins/*/package.json` peers together.
   Keep the old lockfile and package manifests available as the rollback point.
3. Run `npm install --package-lock-only --ignore-scripts --legacy-peer-deps --prefix dsh-runtime`
   and inspect `dsh-runtime/package-lock.json`. Reject mixed DSH versions.
4. Use documented package exports for integration. The installer retains an
   exact-match fix for Agent Team model routing, native-slot embedding, startup
   timing, and client-load batching. Recheck these against each candidate. RC2
   owns HMR response cleanup; the old Bees response map is removed. Add no ABI
   compatibility shim.

## Required gate

Run these from `bees-desktop`:

```sh
npm ci
npm run check
npm run prepare:dsh
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

The candidate is proven by running the app: sign in through loopback, one agent
turn, a restart that keeps the run, and a clean quit.

Review new licenses and native artifacts, and run `npm run sbom` with npm 11.12 or
newer to rebuild the two
checked-in CycloneDX files under `docs/sbom/` from the lockfiles. Finally,
exercise this packaged critical flow without a network connection:

1. launch with no account, choose local mode, and create a team with Goals and Chat threads;
2. choose a work root, attach team/thread files, and confirm the generated results;
3. configure three team agents and exercise A → B → C with a local model;
4. confirm C cannot invoke A, B or itself, and helpers respect their add-on permissions;
5. continue Chat, restart Bees, and confirm history and output files remain available;
6. run and schedule a Goals process and answer its approval stage;
7. stop work and restart Bees; unfinished actions must not execute automatically;
8. confirm no Bees credentials or database files appeared in the work folder.

## Accept or roll back

Accept the candidate only after every automated check, SBOM/license review,
packaged critical flow, and installer smoke test passes. Record the tested DSH
version in the release notes.

If any check fails, restore both DSH package manifests and
`dsh-runtime/package-lock.json` from the rollback point, run `npm ci`, and ship no
partial compatibility layer. Add compatibility code only when Bees intentionally
supports two public DSH ABIs at once.

## 0.2.1 candidate status

See [the upgrade record](dsh-0.2.1-upgrade.md) for automated evidence and remaining
installer/manual release checks. npm 11.5.1 incorrectly marks valid sibling
overrides as invalid during SBOM generation; npm 11.12 fixes that resolver bug.
