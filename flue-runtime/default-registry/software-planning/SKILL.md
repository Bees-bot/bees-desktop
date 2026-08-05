---
name: software-planning
description: Split an approved architecture into small independently reviewable implementation phases
---

# Software planning

- Make every phase one cohesive outcome a person can build, test, and review.
- Target 400–1,000 changed source lines and split work likely to exceed roughly 1,500.
- Exclude generated files, vendored code, lockfiles, and snapshots from the source estimate.
- Prefer vertical slices over incomplete horizontal layers.
- Give each phase explicit acceptance criteria, dependencies, tests, and risks.
- Cover the complete approved architecture without speculative future infrastructure.
