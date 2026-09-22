# DSH 0.1.7 upgrade

Pinned runtime: **0.1.7-alpha.1**, from the official npm packages and lockfile.
Release: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-alpha.1

0.1.7 hands the profile's patch document to DSH's own settings layer. Every
setting the browser writes lands in `<profile>/cordis.patch.yml`, which is the
file Bees used to overwrite on each launch, so the overlay Bees ships had to
move out of it.

## Where the Bees overlay lives now

Bees' composition (session-query path, sandbox policy, the `@bees/*` entries,
the `llm-pi-ai` local provider, the tool rows) is a bundle layer:
`dsh-runtime/plugin/cordis.patch.yml`, declared through `dsh.bundle.patch` in the
plugin's `package.json` and listed last in `dsh.profile.bundles`.

A bundle layer composes before the user layer, so a saved setting always wins
over the shipped default. That ordering matters: 0.1.7's settings editor refuses
to write an entry pinned by a home patch or a `--patch` overlay, so a launcher
overlay would have broken every settings write instead of fixing anything.

The desktop shell no longer copies an overlay into the profile. It writes an
empty user layer when the profile has none, and replaces a file that still
carries the old Bees overlay header, which pins entries the settings screens are
expected to write. Anything else in that file is left alone.

## What else changed

- Plugins declare their settings as the plugin's Config schema with volatile
  fields, and the Bees plugin takes over its own settings presentation
  (`ctx.settings.configure({ auto: false })`) so DSH does not generate a second
  page over the same fields.
- The client reads and writes through `ctx.configForms.get(entryId)`;
  `settingsScope` is gone. The AI screens read the `llm-pi-ai` namespace, the
  Bees screens read `bees`.
- Client writes wait until the host has described a namespace. The first render
  holds no values, and the screens persist what they read when they mount, so
  without that gate the defaults were written over the stored settings on every
  launch (theme, color mode, scope, onboarding, local providers). The same screen
  pushes the chosen color mode into DSH's own theme, which is a second namespace;
  that call waits for the served settings too, otherwise the light/dark half of a
  theme choice was reset to forest-dark on every launch.
- `@deepseek-ai/dsh-deepseek-account` and `@deepseek-ai/dsh-ptc-runtime` are
  direct dependencies and lockfile overrides. Their platform packages import
  them at boot and nothing else pulled them in.
- The installer patch set is re-anchored for 0.1.7. Both long-standing fixes
  (Agent Team model routing, HMR response completion) are still required, and
  the patch applier fails loudly if an anchor moves.

## Validation

Runtime boot under a sandbox profile: every profile entry activates, the web
server answers, and the Bees routes answer with the launch token. A settings
write from the running UI lands as a patch row for both `bees` and `llm-pi-ai`,
survives a restart, and reads back into the interface. The desktop check suite,
`cargo check`, and the packaged critical flow from the upgrade checklist remain
this branch's gate.

The checked-in SBOM under `docs/sbom/` is older than the 0.1.5 pin and was not
regenerated here, because the CycloneDX step runs in the release pipeline and
`npm sbom` cannot read this workspace (file dependencies plus a test-only peer
absent from the install).
