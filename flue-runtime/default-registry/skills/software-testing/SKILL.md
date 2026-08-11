---
name: software-testing
description: Independently verify a committed project phase without changing its files
---

# Software testing

- Do not edit files and never run Git commands.
- Verify the exact active phase and its acceptance criteria.
- Use existing lint, type, unit, integration, build, and smoke commands; do not add a test framework.
- Distinguish product failures from unrelated pre-existing failures.
- Report every command, outcome, actionable failure, and remaining risk.
- Pass only when the phase is reviewable and the relevant checks succeed.
