# Ask Bees: review before starting

## UX decision

Keep Home focused on the outcome. Clicking **Ask Bees** (or Cmd/Ctrl+Enter) opens
one **Review & start** screen, rather than a small configuration link that people
may miss or a multi-step wizard. The goal is not created until the final button.

The screen has four sections:

1. **Your outcome** — the original prompt, editable with context and constraints.
2. **Model & workflow** — show the real Work/Review defaults; optionally use one
   model and reasoning effort throughout this goal, without choosing agents.
3. **Tools & connections** — show connected servers and each stage's existing
   access; optionally narrow this goal to selected connections or none.
4. **Files & folders** — preview inherited inputs, add read-only input snapshots,
   and select an optional output destination. Publishing still requires approval.

The primary action is **Start with defaults**, changing to **Start goal** when
settings are customized. Model-provider and tool-connection screens are reused
inside the setup flow, with a clear return button and no lost draft. Adding a
connection is explicitly app-wide; the goal's limits remain goal-specific.

## Execution rules

- Defaults remain unchanged when no override is supplied.
- Overrides are persisted on the work item, not on shared agents or processes.
- Work and independent review use the selected model. Tool access is the
  intersection of the goal's limit and the selected agent's existing policy.
- Delegated work inherits settings and input references before it can start.
  Recurring definitions and occurrences preserve these settings too.
- A creation failure preserves the setup. A saved goal whose start fails opens
  that existing goal for recovery instead of offering to create a duplicate.
- Desktop sync carries optional `runSettings` metadata and validates incoming
  values. Older metadata updates cannot erase existing restrictions.

## Verification and remaining integration

Backend checks cover defaults, override isolation, delegation, review, recurring
work, invalid settings, tool-policy intersections, and desktop sync round-trips.
UI checks cover rendered defaults, inherited inputs, and disabled launch states.
An isolated browser preview exercises draft preservation, custom submission,
empty tool selection, start failures, keyboard entry, and a narrow window.

Server-side acceptance of `team_work_item.payload.runSettings` still needs to be
verified against the matching server branch. The available server checkout is
on `ux-improvement` and predates the desktop's team-sync API. No server files have
been changed; this is not yet an end-to-end verified cross-device feature.
