# DSH 0.1.7-rc.2 implementation and validation

Date: 2026-09-25. Baseline: `0.1.7-alpha.1`. Target: `0.1.7-rc.2`.
Status: implemented locally; release acceptance is still conditional on the remaining gates below. Nothing was committed, deployed, or released.

## Changes applied

| Recommendation | Implementation |
| --- | --- |
| Upgrade as one release family | Pin every DSH package, override, and plugin peer to RC2. Refresh lockfile and compatible Cordis/schema support libraries; use normal upstream compatibility checks. |
| Await background work | Wait for owned running/stopping jobs and subsequent turns before settling. Observe job events without consuming DSH completion notifications. Reject successful stage submission while background work remains. |
| Make output limits visible | An exhausted model output allowance returns `OUTPUT_LIMIT` with a retry instruction. The existing failed/waiting-for-human recovery flow is reused rather than introducing another workflow state. |
| Adopt native retention | Remove Bees' repeated character-budget history rewriting. Configure native combined text/image spill at 2,000 inline tokens per result for the bundled small-context model. Keep full business evidence and the historical `bees_read_tool_result` reader. Native retention is not a total-session context bound. |
| Preview deliverables | Use the public `workspaceFiles.readBytes` API for binary media. Authorized run Office/spreadsheet/CSV/TSV files open in native document tabs inside Files; restore the previous embedded session when closing. Mapped company files keep their existing reader and authorization; this change grants no new folder access. |
| Surface progress | Embed the native preparation/execution/result UI; default to compact conversations, with compact/standard/detailed/verbose in Appearance. Saved user preferences override bundle defaults. Mount the native runtime Team UI without replacing the Bees work board. |
| Protect dynamically enabled tools (RC2) | Enforce run MCP grants at call time, prompt assembly, and tool discovery. Resolve the longest registered server namespace to prevent a `sales` grant from granting `sales__private`. |
| Preserve scheduling ownership (RC2) | Explicitly disable native schedule and schedule UI defaults. Temporal remains authoritative. Enable time context with a ten-minute refresh for Bees work. |
| Safe desktop lifecycle (RC2) | Preserve close-to-background behavior. On quit, query the authenticated activity endpoint and warn for active/queued runs or an unavailable check. A no-work quit exits directly; restart preserves its original exit code. |
| Reduce patch debt | Remove the retired HMR response map and rely on upstream lifecycle cleanup. Retain the small Agent Team route-forwarding fix, native slot embedding, startup instrumentation, and batching; all anchors match RC2. |
| Crash and Unicode resilience (RC2) | Adopt upstream abandoned-lock recovery and surrogate-safe output truncation; exercise the installed package implementations in regression tests. |

## Deliberate boundaries

- Experimental Auto review was evaluated, not enabled. It authorizes tool execution with full host access and introduces another model request per reviewed call; it does not replace Bees' business/publication approvals. The existing sandbox and human gates remain unchanged.
- Remote execution and broader browser/computer use remain deferred as the original report recommended. They require their own access model and acceptance tests.
- Existing synchronous history reads were reviewed. RC2 still supports existing callers; the frequently repeated custom pruning path is removed. A whole-history-storage rewrite would be unrelated scope and is not required for this upgrade.
- No server API redesign is needed. The server repository changes only its findings report.

## Validation performed

- `npm run check` in Desktop: type checking, schedule/page-fetch/process-interaction regressions, the new RC2 checks, file-preview tests, and frontend production build pass.
- `cargo check --manifest-path src-tauri/Cargo.toml` passes.
- `npm run prepare:dsh` and repeated installer staging pass; all runtime entries activate and the loopback health and authenticated Bees routes work.
- `npm run check` in Server passes: 46 tests pass, one pre-existing test is skipped, API build/typecheck pass.
- Stage 1 size report: 27,337 production lines (report only). Its existing stale reference to `dsh-runtime/profile/cordis.patch.yml` is warned and skipped.
- Regression tests cover late MCP registration, server-name collisions, changed grants, owned/unrelated jobs, two successive completions and their next turns, output-limit failure, mixed large Unicode text/image retention and recovery paths, failed spill preservation, historical recall, crashed lock-holder takeover, consistent version pins, and denied/truncated file reads.
- Isolated local DSH + Temporal + mock model smoke: planning creates a proposal; applying it creates work; worker and review stages complete; file output survives restart. An interrupted write with uncertain outcome requires explicit Retry rather than silent replay. A mock fixture initially emitted repeated writes; this run is not a throughput, quality, or token-use benchmark.
- Appearance detail preference persists across restart. The native UI displays spreadsheet sheets/formulas, Word content, and slide content from generated local fixtures. This verifies local renderer integration, not every supported document format or every platform.
- A separate macOS application ID/data directory (`com.bees.rc2-smoke`) avoids existing user data. Its packaged `.app` launches into onboarding and exits cleanly with Cmd-Q while idle.
- The activity endpoint returns zero for the settled smoke workspace; an unauthenticated request returns HTTP 401.
- Slide fullscreen/restore, CSV rendering, and return to the run's chat after closing a preview pass in the final local runtime.
- The macOS `.app` builds. Standard DMG styling fails because macOS denies Finder Apple Events (`-1743`). The same bundler succeeds with its supported `--skip-jenkins` headless option, producing `/tmp/Bees_RC2_smoke.dmg` (471,050,403 bytes); `hdiutil verify` reports a valid checksum. This test DMG omits Finder styling, is not notarized, and is not a release artifact.
- Restaging plugin files while the development runtime was live triggered an upstream root-slot HMR error. A service restart plus page reload recovered it. Packaged startup was tested separately; this does not establish seamless development hot reload during installation.

## Dependencies and SBOM

Both CycloneDX inventories are refreshed. No new license identifiers or newly introduced native package families were found compared with the alpha.1 lockfile; platform-specific binaries still require their target-platform release checks.

A runtime dependency audit exposed `libreoffice-kit`'s nested `fflate@0.8.2`. A scoped override selects `0.8.3` (the fixed ZIP parser); the final runtime audit reports zero vulnerabilities. The existing `pdfjs-dist@6.2.108` override remains.

Desktop inventory command:

```sh
npm sbom --package-lock-only --omit=dev --sbom-format=cyclonedx > docs/sbom/desktop-runtime.cdx.json
```

DSH inventory command (CLI runs externally; it is not added to the shipped dependencies):

```sh
npm exec --yes --package=@cyclonedx/cyclonedx-npm@6.0.1 -- cyclonedx-npm --ignore-npm-errors --package-lock-only --omit dev --output-reproducible --spec-version 1.5 --output-file docs/sbom/dsh-runtime.cdx.json -- dsh-runtime/package.json
```

`--ignore-npm-errors` is limited to SBOM generation because npm's tree validation reports overridden peer edges (including Cordis/schema/support packages and PDF dependencies) and an upstream absent test/mock peer. It is not a runtime compatibility exemption. The lockfile and installed RC2 versions were checked separately.

## Remaining release gates

The [upgrade checklist](dsh-upgrade-checklist.md) remains authoritative. This work does **not** establish release readiness:

- Complete the packaged critical flow with the network disconnected, real/local provider routes, scheduling, granted-folder publication, unresolved approvals, and repeated background completions. The loopback mock smoke was not network-isolated: startup may refresh the free-model catalog.
- Exercise active/unknown-status quit confirmation and cancellation in the packaged app; only idle clean quit was manually verified here.
- Standard macOS DMG creation is blocked by the host denying Finder Apple Events (`-1743`); the application binary and `.app` bundle build successfully. Do not change host security settings as part of this upgrade.
- Complete signing/notarization, Windows/Linux/Intel Mac installer checks, and representative packaged document previews.
- Reconcile the older checklist's two-workspaces-per-team scenario with the current command surface, without silently marking it passed.

The tracked pre-upgrade manifests and lockfile remain available at the branch baseline. Roll back them together, reinstall dependencies, and restage the runtime; never mix release families.
