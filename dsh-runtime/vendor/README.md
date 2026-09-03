# DeepSeek Harness runtime bundle

The tarballs in `dsh-v0.1.2-rc.1/` were built from the official
`deepseek-ai/deepseek-harness` tag `dsh-v0.1.2-rc.1` at commit
`a66e4702047846cdaa10c66c9d3df3951f5ea70d`.

They are vendored because npm does not publish this release. The bundle includes
the release's DSH and vendor package families, the two private experimental Agent
Teams packages used by Bees, and release-locked external dependencies such as
`@earendil-works/pi-*` and `undici` that are no longer available from npm.
`scripts/install-dsh-runtime.mjs`
installs the bundle as one version-consistent set and rejects incomplete bundles.

After installation, the script applies one narrow compatibility patch to the
experimental Agent Team entry point. The rc.1 continuation manager supports
per-child model routes, but the Team wrapper does not forward that existing
field. Bees forwards it so manually configured pool members retain their model
provider when they join a roundtable.
