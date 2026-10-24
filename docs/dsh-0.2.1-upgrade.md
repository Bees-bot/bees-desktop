# DSH 0.2.1-rc.3 upgrade

Upgrades Bees from `0.1.7-rc.2` to `0.2.1-rc.3`. The desktop and hosted clients
use the same runtime. All 314 resolved DSH packages use the candidate version.
The removed `dsh-invariants` and `dsh-subagent-in-process-driver` packages are no
longer installed; retired `backgroundMode` configuration is removed.

## Chat continuity

A single-stage Chat process resumes its local DSH session on each reply. Bees
passes the latest request and any new discussion messages, rather than repeatedly
pasting the last forty messages. The saved transcript retains assistant replies,
tool calls and results; DSH owns context compaction. This does not imply a fixed
token-cost reduction: model requests still use retained context.

Chat replies share their original run workspace. Attachments refresh from the
thread and team, output files remain available, and unchanged outputs are not
attached again. Each reply records only its own activity and tool evidence.
Continuation pointers, message cursors and authoritative activity bounds stay in
local preferences, outside shared checkpoints. A transferred chat or missing session log bootstraps
from the visible conversation. A changed stage agent/preset or moved work root
starts a fresh session with that history. Workflow work/review stages remain
independent executions. Unfinished inbox actions are cleared before a chat resumes.

## Team helpers

Every enabled agent in the current team is available through
`bees_delegate_agent`; there is no additional configuration field. Each helper
uses its saved preset, instructions, model, reasoning effort and allowed add-ons.
The original stage's workspace, review restrictions and approval requirements
continue to apply. Human decisions from parallel helpers queue one at a time.

Named agent identities follow the actual runtime parent chain, including ordinary
spawned/forked children and cold-resumed helpers. The tool rejects self and every
ancestor: A → B → C cannot delegate to A, B or C. Explicit messages that would
wake an ancestor are also rejected; DSH delivers completion results automatically.
Delegation uses DSH's managed activation lifecycle and active-child limit, with a
maximum depth of eight for named helpers. Bees joins progressing descendants
before finishing a stage, and stopping a run cancels its agents.

The new `working_directory` tool may report the directory, but cannot change a
thread agent's directory: the file guard and file-lock tools share the fixed run
workspace. This preserves the existing file boundary.

## Dependency review

New package licenses are MIT, BSD-2-Clause, ISC, or MIT/CC0. Native updates include
LibreOffice Kit platform packages `0.1.5` (MPL-2.0), Koffi `3.1.1` (MIT), and
node-addon-require-builtin `0.1.9` (MIT). The new musl builds are optional and
removed by the existing platform pruning. Existing third-party notices and
bundled license files continue to cover these libraries.

Compatible fixes for Zod, the MCP client, body-parser, fast-uri, ip-address and
undici clear the npm advisory report. Both lockfiles report zero vulnerabilities
after a clean install. The CycloneDX inventories are regenerated from the locks.
SBOM generation uses npm `11.12.1`; npm `11.5.1` has a sibling-override resolver
bug fixed in [npm 11.12](https://github.com/npm/cli/pull/9110).

## Validation

- Clean `npm ci`, complete `npm run check`, `npm run prepare:dsh`, and
  `cargo check --manifest-path src-tauri/Cargo.toml` pass.
- The isolated runtime proof passes on desktop and through the hosted gateway.
  It covers history beyond forty messages, delta input, restart continuity,
  retained files, per-reply evidence, A → B → C, rejected cycles and unavailable
  agents, saved helper models/add-ons, file boundaries, approvals, five parallel
  children, and recovery of durable execution evidence.
- The proof also passes using the Node binary and DSH runtime inside the built
  Apple Silicon `.app`, including native shell execution.
- `CI=true npm run tauri:build` produces the Apple Silicon `.app` and `.dmg`.
  Standard local DMG styling requires Finder Automation permission; CI mode
  skips that styling using Tauri's existing packaging option.
- `npm run sbom` passes using npm `11.12.1` without changing the global npm install.

Manual offline UI/installer acceptance, notarization, and Windows/Linux builds
remain release checks. No production data is used by the automated proofs.
