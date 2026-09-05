# DSH upgrade checklist

Bees ships one tested DeepSeek Harness release as a unit. The current release is
`0.1.2-rc.1`; every `@deepseek-ai/dsh*` runtime dependency and plugin peer must
use that exact version.

## Prepare a candidate

1. Read the candidate DSH release notes and public API documentation.
2. On a branch, change every `@deepseek-ai/dsh*` version in
   `dsh-runtime/package.json` and `dsh-runtime/plugin/package.json` together.
   Keep the old lockfile and package manifests available as the rollback point.
3. Run `npm install --package-lock-only --ignore-scripts --prefix dsh-runtime`
   and inspect `dsh-runtime/package-lock.json`. Reject mixed DSH versions.
4. Use only documented package exports. Do not copy, patch, or import DSH
   internals to make the candidate pass.

## Required gate

Run these from `bees-desktop`:

```sh
npm ci
npm run check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

`npm test` includes `tests/dsh-contract.test.ts`. It must prove loopback
authentication, plugin/service injection, user settings and navigation contracts,
DSH workspace registration, one provider-neutral agent turn, DSH approval policy,
typed references, durable restart, and clean plugin disposal. Recovery and
approval checkpoint tests are part of the same suite.

From `bees-server`, run the Stage 1 size gate:

```sh
./scripts/count-lines-of-code-dsh.sh
```

Regenerate the two checked-in CycloneDX files under `docs/sbom/` with the release
pipeline, review new licenses and native artifacts, and fail the release if the
SBOM does not match the packaged desktop. Finally, exercise this packaged critical
flow without a network connection:

1. launch with no account and create a team plus two workspaces;
2. map one team folder and reference it from work in both workspaces;
3. navigate between sections and switch team/workspace scope;
4. use Ask Bees to create and apply a process proposal;
5. run and schedule the process with two configured provider routes;
6. approve publication to a granted location;
7. interrupt a run, restart Bees, and recover it from its safe checkpoint;
8. confirm no Bees or DSH metadata appeared in the mapped company folder.

## Accept or roll back

Accept the candidate only after every automated check, SBOM/license review,
packaged critical flow, and installer smoke test passes. Record the tested DSH
version in the release notes.

If any check fails, restore both DSH package manifests and
`dsh-runtime/package-lock.json` from the rollback point, run `npm ci`, and ship no
partial compatibility layer. Add compatibility code only when Bees intentionally
supports two public DSH ABIs at once.
