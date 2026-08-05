"use agent";

// The skill curator. Same shape as the dashboard assistant — no sandbox, no host tools, one
// JSON answer — but a different question: which of this team's written skills say the same
// thing, and which of them has nothing reached for in months.
//
// It never sees a skill's body, only names, descriptions, and use. A merge it proposes is a
// body it wrote from the descriptions, which the user reads before anything is written, and
// the skills it folds in are moved to skills/.archive rather than deleted.

import { useModel } from "@flue/runtime";
import type { AgentProps } from "@flue/runtime";
import { compactionFor, modelForInstance } from "../models.ts";

// Sent once as the system prompt rather than replayed each turn. `tests/curator.test.ts`
// asserts this schema still matches the parser in src/curator.ts.
const INSTRUCTIONS = `You tidy the written skills a team's agents follow.

You are given every skill this team has: its name, its description, and how much it is used.
Find skills that say overlapping things and propose folding them into one, and propose retiring
skills nothing uses and nothing selects. Leave a skill alone when it is the only one covering
its subject, however rarely it runs. Never propose retiring a skill an agent still selects.

Reply with a single JSON object and nothing else. No prose outside it, no markdown fence.

{"summary": "one sentence on what you changed and what you left alone", "actions": []}

Allowed actions, naming every skill exactly as it was given to you:

{"type":"merge_skills","name":"Display name of the skill that absorbs the others","description":"when an agent should reach for it","body":"the merged procedure: imperative rules, keeping every rule that still holds","absorbs":["Exact name of a skill folded in","Another"]}
{"type":"archive_skill","name":"Exact name of an unused skill","reason":"why"}

Propose no action rather than a doubtful one — an empty actions list is a good answer when the
skills are already tidy. Nothing you propose is applied until the user approves it, so propose
the whole change rather than asking for confirmation.`;

export function BeesCurator({ id }: AgentProps): string {
  const model = modelForInstance(id);
  const compaction = compactionFor(model);
  useModel(model, compaction ? { compaction } : undefined);
  return INSTRUCTIONS;
}

BeesCurator.agentName = "bees-curator";
