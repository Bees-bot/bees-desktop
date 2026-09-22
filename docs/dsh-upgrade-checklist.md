# DSH upgrade checklist

Bees ships one DeepSeek Harness release at a time. The current release is
`0.1.5-rc.2`; every `@deepseek-ai/dsh*` runtime dependency and plugin peer must
use that exact version.

## Prepare a candidate

1. Read the candidate DSH release notes and public API documentation.
2. On a branch, change every `@deepseek-ai/dsh*` version in
   `dsh-runtime/package.json` and all `dsh-runtime/plugins/*/package.json` peers together.
   Keep the old lockfile and package manifests available as the rollback point.
3. Run `npm install --package-lock-only --ignore-scripts --legacy-peer-deps --prefix dsh-runtime`
   and inspect `dsh-runtime/package-lock.json`. Reject mixed DSH versions.
4. Use documented package exports for integration. The installer retains two
   existing, exact-match fixes for Agent Team model routing and HMR response
   completion; recheck both against each candidate. Add no ABI compatibility shim.

## Required gate

Run these from `bees-desktop`:

```sh
npm ci
npm run check
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

The candidate is proven by running the app: sign in through loopback, one agent
turn, a restart that keeps the run, and a clean quit.

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
