# Releasing Bees

Releases are deliberate. Merging a feature runs CI; pushing a stable `vMAJOR.MINOR.PATCH`
tag runs the release pipeline. No scheduled releases or builds on every commit.

## One-time setup

- Releases publish into `Bees-bot/bees-desktop`, including while it is private.
  Website links already target that repository and need no change when it becomes public.
  Until then, only people with repository access can download releases; anonymous API
  requests fall back to the GitHub release page, which also requires repository access.

- Enable GitHub Actions in the desktop repository. Private repositories consume the
  organization's Actions allowance. Set a billing budget appropriate for four native builds.
- In Discord, create a webhook for `#updates`, named **Bees Releases**. Store its URL as
  the desktop repository's Actions secret `DISCORD_RELEASE_WEBHOOK`. Never commit it.
- Mac signing uses `APPLE_SIGNING_IDENTITY`, `APPLE_CERTIFICATE` (base64 P12),
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`.
  The identity is `Developer ID Application: FunCove LLC (T9AGT95JD7)`, and
  `APPLE_TEAM_ID` is `T9AGT95JD7`. A local build signs with the same certificate
  from the login keychain and notarizes through the `bees-notary` profile; CI passes
  the same credentials through the secrets above.
  Without these the Mac build uses ad-hoc signing. Verify these credentials before a public release.
  The bundle is signed with `src-tauri/entitlements.plist`; `bees-node` needs all
  three keys in it or the runtime dies on its first JIT allocation. `npm run prepare:dsh`
  signs the runtime binaries under `Resources` as it stages them, since the bundler only
  signs the app, the frameworks and the sidecars.
- Windows installers are currently unsigned, as disclosed in the notes and website.
  Signing them means an Azure Artifact Signing account, `trusted-signing-cli`, and a
  `bundle.windows.signCommand` in `tauri.conf.json` added only once that account exists:
  Tauri runs signCommand unconditionally, so committing it early breaks every Windows build.
- Protect `main` with required CI and review; restrict creation of `v*` tags to maintainers
  using a repository ruleset. Publishing uses the workflow's built-in `GITHUB_TOKEN`.

## Prepare a release

1. Add a `## Unreleased` section at the top of `CHANGELOG.md`. Describe user-visible
   changes, fixes, contributors, and any upgrade limitations. Keep this current in feature PRs.
2. Run `npm run release:prepare -- 0.2.1` (choose the next unused version). This updates
   npm, Tauri, Cargo and their lockfiles, and converts Unreleased to the version heading.
3. Review the diff and run `npm run check`,
   and `cargo check --manifest-path src-tauri/Cargo.toml`.
4. Commit through your normal review process and merge. From the checked, current main
   commit, run `git tag -a v0.2.1 -m 'Bees 0.2.1'` then `git push origin v0.2.1`.
   These are maintainer actions; the preparation command never commits or pushes.

## What happens automatically

The pipeline checks the app, rejects mismatched versions or missing notes, and creates a
draft. It builds Apple Silicon and Intel Mac DMGs, Linux x64 DEB/AppImage packages, and
Windows x64 MSI/EXE installers. Configured Apple notarization finishes before publication.
Only after every build succeeds does it verify all expected files, generate SHA256SUMS,
and publish the release as latest. The website reads the latest published GitHub release;
the download links update without a website rebuild. Discord receives the release notes
and download link after publication. Mentions are disabled in the automated message.

The website enhancement itself must first be deployed from bees-website. Its deployment
workflow requires Cloudflare credentials; see that repository's README.

## Failure and recovery

- A build failure leaves a draft and the previous public release/downloads in place.
  Use **Re-run failed jobs** after fixing transient infrastructure or credentials. If code
  must change, use a new version/tag; do not move a tag users may have fetched.
- If only Discord fails, fix its secret and rerun **only the failed announcement job**.
  A network timeout can occur after Discord accepted a message; check the channel first
  to avoid duplicates. The release remains available even if notification fails.
- An already published version cannot be rebuilt by this pipeline. Ship a new patch.
- Do not queue multiple releases at once: GitHub concurrency serializes runs but is not
  a FIFO release queue. Inspect Actions before pushing another tag.

## Upgrade safety

Automatic in-app updates remain disabled. Version 0.1.1 uses the legacy runtime database;
the 0.2 series uses a different database. Publishing `latest.json` is explicitly rejected
until a tested migration preserves existing data. Include concrete upgrade guidance in
each release. Do not imply that updating an existing installation is seamless.

After publication, smoke-test installation and first launch on each operating system.
Successful compilation and packaging do not establish that every user workflow works.
