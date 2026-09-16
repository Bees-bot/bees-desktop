# Startup timings

Launch Bees normally. Native startup, DSH, and browser milestones append JSON lines
prefixed `[bees-startup]` to the app data directory's `dsh-state/startup.log`.
On macOS:

```sh
tail -f "$HOME/Library/Application Support/bot.bees.desktop/dsh-state/startup.log"
```

The previous native launch is kept in `startup.log.1`. Development preparation
(`build.frontend`, `build.dsh.install`, `build.dsh.plugins`,
`build.bundled-runtimes`) is timed in the launch terminal, before the native app
exists. Cargo's build output covers compilation/linking after that preparation.

Each record contains a wall-clock `atMs` for correlating processes, `pid`, `source`,
`phase`, and `event`. Runtime/native `elapsedMs` is relative to that process.
Finished steps include `durationMs`. Native `end` records include early error
returns; JavaScript steps distinguish `done` and `failed`. A `start` with no end
locates an interrupted or hung step.

The sequence includes:

- Native application construction, cleanup scans, tray setup, and splash invocation.
- Profile preparation, Temporal spawn/readiness, Node spawn, and HTTP readiness.
- CLI imports, profile composition, each plugin module import, dependency wait,
  and initialization, plus the overall DSH tree settling.
- Bees database, agent/workspace setup, each MCP mount, recovery, Temporal
  connections, workflow bundling, and reconciliation.
- Background Hindsight installation/startup, first team sync, and local model startup.
- Webview navigation/load, Bees client module loading, shell mounting, and
  `ui.data-rendered` after the first populated UI has had a frame to paint.

Durations are **inclusive and may overlap**: do not add plugin durations to obtain
total startup. `plugin.wait:*` measures time waiting on injected services;
`plugin.init:*` measures activation itself. Compare wall-clock milestones to find
gaps, then inspect the nested steps. Browser milestones are recorded when their
local HTTP notification arrives, so they include a small delivery delay.

No credentials, URLs, model prompts, or error messages are included. Instrumentation
does not reorder startup. DSH hooks are checked against the pinned package and
reapplied by `scripts/install-dsh-runtime.mjs` during normal preparation.

## Measured bundle bottleneck (September 16, 2026)

The desktop trace reached the splash at 1.4 seconds and populated UI at 32.5
seconds after native entry. Temporal readiness took 3.9 seconds; DSH boot took
24.5 seconds. These times exclude development builds before native entry.

A separate Node CPU profile attributed 19.3 seconds to the client module
registry repeatedly composing browser bundles and source maps during plugin
activation. Concurrent imports therefore appeared slow while waiting for this
synchronous work.

`batch-dsh-client-modules.mjs` batches those updates until DSH's existing
`appReady` notification. Initial validation remains synchronous; an early graph
or page request flushes pending updates, and subsequent hot reloads retain their
microtask behavior. The installer reapplies the checked patch to the pinned DSH
package.

With temporary app data (no accounts, MCP integrations, or saved runs; Hindsight
disabled), DSH boot fell from **22.7 seconds to 2.9 seconds** in two successful
measurements after the fix. The authenticated page and its two browser bundles
covering all 57 client modules were available in **3.2 seconds** after Node
spawn. This measures runtime/page delivery, not webview rendering; a normal
desktop relaunch is still needed to measure the full UI improvement.

## Incremental development launches

The launch hook itself originally took 0.94 seconds. Cargo's build script then
copied the DSH/llama.cpp resource trees (15.3 seconds in one timing report), and
the application recompiled/relinked. Preparation replaced the Node and Temporal
executables on every launch, invalidating Cargo even when their bytes were
unchanged. A measurement through the actual `tauri:dev` command spent 27.2
seconds in Cargo.

Development commands now merge `src-tauri/tauri.dev.conf.json`. It omits resource
copies because the debug application already reads those trees from the source
checkout, and waits for preparation before starting Cargo. Executable staging
publishes only when bytes or permissions change, preserving Cargo's normal
incremental build behavior. Release packaging still uses the full resource list.

With dependencies and runtimes already prepared, the first build with this
configuration took **5.6 seconds** in Cargo. A repeat launch took **0.79 seconds**
in Cargo and **3.8 seconds total** for preparation plus build. These measurements
used the real development command with a runner that substitutes `cargo build`
for `cargo run`, stopping before Bees opens or starts saved work. Fresh checkouts
still need dependency downloads and initial compilation.
