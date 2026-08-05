---
name: software-implementation
description: Implement one approved project phase safely in a Git worktree owned by Bees
---

# Software implementation

- Read the approved architecture, current phase, and relevant existing code before editing.
- Change only what the active phase requires and preserve unrelated user work.
- Run the smallest relevant checks supported by the repository.
- Never run Git commands or edit `.git`; Bees commits the working tree after the turn.
- Do not hide failures, weaken tests, or start a future phase.
- Finish with the implemented outcome, checks run, and any blocker.
