# DSH 0.1.5 upgrade

Pinned runtime: **0.1.5-rc.2**, from the official npm packages and lockfile.
Release: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2

Implemented the critical and high-priority scope:

- Migrate persistence reads to owned read handles with guaranteed closure, and
  migrate recovery/pruning surface ranges and Agent Team inbox access to the new API.
- Embed native DSH conversations inside Bees for both work and execution history. DSH owns
  streaming, rendering, uploads, queue/steer controls, questions and approvals.
- Preview generated files inside Bees, using the native file API for binary formats.
  Bees still validates team access, run paths and symlinks before reading.
- Allow the agent to read only exact file/image attachments admitted to its own
  session. DSH owns upload storage, progress, cancellation and receipts.
- Enable native continuable-subagent controls and expose read_image and present.
- Inherit the upstream stream, cancellation, prompt and persistence fixes.

Cold continuations start a new managed session seeded with the previous history.
This avoids competing with the native viewer's writer and reusing a disposed
client control stream. The work identity, workspace, grants and delivery tracking
remain with Bees. Previous sessions remain readable. Active follow-ups and
steering use DSH's native inbox. Use **Continue work** beneath the embedded conversation after a run
finishes; the native composer remains available during active work.

Bees stays visible for questions, approvals, execution history, resource widgets,
and traces. Only the hidden Cmd/Ctrl+Alt+Shift+D debug shortcut exposes the DSH
view. An installer patch adds an optional frame content slot so native widgets
can be portalled into Bees while retaining their original slot and session owners.

The obsolete 0.1.2 vendored tarballs and custom conversation renderers are removed.
The two pre-existing installer fixes for team model routing and HMR response
completion remain necessary in the pinned upstream version.

Medium–high and lower items are excluded: provider-settings migration, general
panel/navigation migration, dynamic cache changes and unrelated tool-policy work.

Validation includes the desktop check suite, real agent-loop steering/queue and
cancellation tests, owned-history continuation, binary preview authorization and
attachment access checks. The local UI smoke test uses a mock model and isolated
test data. A signed installer/release remains a separate release gate.

The runtime SBOM is refreshed. Dependency validation includes every local plugin's
DSH peer pins. The high-severity fast-uri finding is patched to 3.1.7; npm audit
reports two remaining moderate findings (hono and qs), outside this scope.
