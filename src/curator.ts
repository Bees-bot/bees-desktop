// Skill curation: the team's skills get better by being merged, retired, and rewritten —
// not by being optimized. Bees scores no run, so there is no reward to hill-climb. What it
// does have is which skills agents actually reach for, and the text of the skills themselves.
//
// Same safety shape as the dashboard assistant: the model proposes, `resolvePlan` checks every
// name against the skills that exist right now, and nothing is written until the user applies.
// Retiring a skill is a move into `skills/.archive/`, never a delete, so a wrong call costs one
// undo rather than the team's written procedure.

import type { Capability } from "./domain.js";
import { errorText } from "./domain.js";

/** Name of the bundled agent in `.flue/agents/bees-curator.ts`. */
export const CURATOR_AGENT = "bees-curator";

export interface SkillUsage {
  capabilityRef: string;
  useCount: number;
  lastUsedAt: string;
}

/** A skill still selected by some agent has a job, however rarely it runs. */
export type SkillState = "active" | "unused";

export interface SkillReview {
  capability: Capability;
  state: SkillState;
  useCount: number;
  lastUsedAt: string | null;
  /** Set when an agent selects this skill: it is in use even with no completed runs yet. */
  selected: boolean;
}

export const UNUSED_AFTER_DAYS = 60;

function daysBetween(from: string, to: string): number {
  const start = Date.parse(from);
  const end = Date.parse(to);
  return Number.isFinite(start) && Number.isFinite(end)
    ? (end - start) / 86_400_000
    : Number.POSITIVE_INFINITY;
}

/**
 * The pure half of the curator — no model involved. A skill is unused when no agent selects it
 * and no run has reached for it inside the window. Never having been used counts as unused only
 * once the skill is older than the window would be, which we cannot know from the file, so a
 * skill with no recorded use is unused as soon as nothing selects it.
 */
export function reviewSkills(input: {
  capabilities: Capability[];
  usage: SkillUsage[];
  selectedRefs: string[];
  now: string;
  unusedAfterDays?: number;
}): SkillReview[] {
  const window = input.unusedAfterDays ?? UNUSED_AFTER_DAYS;
  const byRef = new Map(input.usage.map((entry) => [entry.capabilityRef, entry]));
  const selected = new Set(input.selectedRefs);
  return input.capabilities
    .filter(({ kind }) => kind === "skill")
    .map((capability): SkillReview => {
      const used = byRef.get(capability.ref);
      const isSelected = selected.has(capability.ref);
      const recent = used ? daysBetween(used.lastUsedAt, input.now) <= window : false;
      return {
        capability,
        state: isSelected || recent ? "active" : "unused",
        useCount: used?.useCount ?? 0,
        lastUsedAt: used?.lastUsedAt ?? null,
        selected: isSelected
      };
    });
}

// ---- What the curator is allowed to propose ----
// Keep in sync with the INSTRUCTIONS block in .flue/agents/bees-curator.ts — tests/curator.test.ts
// fails if the two lists drift apart.

export type CuratorAction =
  | {
      type: "merge_skills";
      /** Display name of the skill that absorbs the others; may or may not exist yet. */
      name: string;
      description: string;
      body: string;
      /** Display names of the skills folded into it, archived on apply. */
      absorbs: string[];
    }
  | { type: "archive_skill"; name: string; reason: string };

export const CURATOR_ACTION_TYPES: CuratorAction["type"][] = ["merge_skills", "archive_skill"];

export interface CuratorPlan {
  summary: string;
  actions: CuratorAction[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

/** Same tolerance as the assistant: fenced or apologetic JSON still parses; prose proposes nothing. */
function extractJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseAction(value: unknown): CuratorAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const name = text(raw.name);
  if (!name) return null;
  if (text(raw.type) === "merge_skills") {
    const body = text(raw.body);
    const absorbs = textList(raw.absorbs).filter((entry) => entry.toLowerCase() !== name.toLowerCase());
    return body && absorbs.length
      ? { type: "merge_skills", name, description: text(raw.description) || name, body, absorbs }
      : null;
  }
  if (text(raw.type) === "archive_skill") {
    return { type: "archive_skill", name, reason: text(raw.reason) };
  }
  return null;
}

export function parseCuratorPlan(raw: string): CuratorPlan {
  const parsed = extractJson(raw);
  if (!parsed) return { summary: raw.trim(), actions: [] };
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions.map(parseAction).filter((action): action is CuratorAction => action !== null)
    : [];
  return { summary: text(parsed.summary) || (actions.length ? "" : raw.trim()), actions };
}

// ---- Resolving names against the skills that exist ----

export interface ResolvedCuratorAction {
  action: CuratorAction;
  /** What the user reads on the card. */
  summary: string;
  /** Skills this action archives, resolved to real capabilities. */
  archives: Capability[];
  /** Set when the action names a skill that is not there — the card cannot be applied. */
  error?: string;
}

function findSkill(capabilities: Capability[], name: string): Capability | undefined {
  const wanted = name.trim().toLowerCase();
  return capabilities.find(
    ({ kind, name: candidate }) => kind === "skill" && candidate.trim().toLowerCase() === wanted
  );
}

export function resolveCuratorPlan(
  actions: CuratorAction[],
  capabilities: Capability[]
): ResolvedCuratorAction[] {
  return actions.map((action): ResolvedCuratorAction => {
    if (action.type === "archive_skill") {
      const skill = findSkill(capabilities, action.name);
      return {
        action,
        summary: `Retire "${action.name}"${action.reason ? ` — ${action.reason}` : ""}`,
        archives: skill ? [skill] : [],
        ...(skill ? {} : { error: `No skill called "${action.name}"` })
      };
    }
    const missing = action.absorbs.filter((name) => !findSkill(capabilities, name));
    const archives = action.absorbs.flatMap((name) => {
      const skill = findSkill(capabilities, name);
      return skill ? [skill] : [];
    });
    return {
      action,
      summary: `Merge ${action.absorbs.map((name) => `"${name}"`).join(", ")} into "${action.name}"`,
      archives,
      ...(missing.length ? { error: `No skill called "${missing[0]}"` } : {})
    };
  });
}

export function applicableCuratorActions(
  resolved: ResolvedCuratorAction[]
): ResolvedCuratorAction[] {
  return resolved.filter((entry) => !entry.error && entry.archives.length > 0);
}

// ---- Applying ----

export interface CuratorApplyContext {
  /** Writes <teamRoot>/skills/<slug>/SKILL.md, as the New skill button already does. */
  saveSkill(name: string, description: string, body: string): Promise<void>;
  /** Moves <teamRoot>/skills/<slug> under skills/.archive — recoverable, never deleted. */
  archiveSkill(slug: string): Promise<void>;
}

/** The folder a registry capability came from: `skills/<slug>/SKILL.md` under the team folder. */
export function skillSlugOf(capability: Capability): string {
  const segments = capability.path.replaceAll("\\", "/").split("/").filter(Boolean);
  return segments.at(-2) ?? capability.name;
}

/**
 * Applies what the user approved. The merged skill is written before anything is archived, so a
 * failure halfway leaves the team with both the new skill and the old ones rather than neither.
 */
export async function applyCuratorPlan(
  resolved: ResolvedCuratorAction[],
  context: CuratorApplyContext
): Promise<{ applied: number; errors: string[] }> {
  const errors: string[] = [];
  let applied = 0;
  for (const entry of applicableCuratorActions(resolved)) {
    const { action } = entry;
    try {
      if (action.type === "merge_skills") {
        await context.saveSkill(action.name, action.description, action.body);
      }
      for (const skill of entry.archives) {
        await context.archiveSkill(skillSlugOf(skill));
      }
      applied += 1;
    } catch (error) {
      errors.push(`${entry.summary}: ${errorText(error)}`);
    }
  }
  return { applied, errors };
}

// ---- What the curator is told ----

/** Everything the curator sees. Bodies are omitted: names, descriptions, and use are enough. */
export function curatorPrompt(reviews: SkillReview[]): string {
  if (!reviews.length) return "This team has no skills yet. Propose no actions.";
  const lines = reviews.map(({ capability, state, useCount, selected }) => {
    const use = useCount ? `used ${useCount} time(s)` : "never used";
    return `- "${capability.name}" — ${use}; ${selected ? "selected by an agent" : "selected by no agent"}; ${state}`;
  });
  return `Skills in this team:\n${lines.join("\n")}`;
}
