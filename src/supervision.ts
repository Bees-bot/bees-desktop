// Whether a piece of work is moving, and who is owed an answer when it is not.
//
// The rule is an invariant rather than a catalogue: open work is running, scheduled, waiting on
// a person, or stalled — never anything else. A workflow does not have to report that it is
// stuck, or handle its own errors, or know this file exists; absence of progress is detected
// from the outside, so a cause nobody has thought of yet still reaches a person.

import { readableError } from "./domain.js";
import type { Execution, WorkItem } from "./domain.js";

/** The fixed set. Adding a state means adding a member here and a rule below — nothing else. */
export type WorkStateKind = "running" | "scheduled" | "waiting" | "stalled";

/**
 * Why the work is in that state. Best-effort: `no-progress` is the honest answer when nothing
 * more specific applies, and it is what keeps unknown causes from being silently dropped.
 */
export type WorkStateReason =
  | "run-in-flight"
  | "approval-pending"
  | "wait-active"
  | "step-failed"
  | "run-failed"
  | "human-step"
  | "agent-unavailable"
  | "no-agent"
  | "process-stopped"
  | "schedule-pending"
  | "autopilot-pending"
  | "no-progress";

export interface WorkState {
  kind: WorkStateKind;
  reason: WorkStateReason;
  /** Heading. Identical for every item sharing a reason, so the inbox can group on it. */
  label: string;
  /** This item's specifics, under the heading. */
  detail: string;
}

/** What one item's supervision needs to know. Assembled from data the app already holds. */
export interface WorkFacts {
  item: WorkItem;
  stageName: string;
  /** This item's runs. Dismissed failures are left out by the caller. */
  runs: Execution[];
  pendingApprovals: number;
  /** The next step only a person can take. Set for studio items, which never self-start. */
  humanStep?: string;
  /** Why the agent for this status cannot run here, when it cannot. */
  agentBlocked?: string;
  /** False when no agent would ever pick this status up — a human status by construction. */
  hasAgent: boolean;
  processRunning: boolean;
  /** When a schedule will next fire for this item. */
  scheduledFor?: string;
  /** ISO now. */
  now: string;
  /** How long an open item may sit untouched, with nothing running, before it is stalled. */
  stallAfterMs: number;
}

const state = (
  kind: WorkStateKind,
  reason: WorkStateReason,
  label: string,
  detail: string
): WorkState => ({ kind, reason, label, detail });

const latest = (runs: Execution[]): Execution | undefined =>
  [...runs].sort((a, b) =>
    (a.startedAt ?? a.createdAt).localeCompare(b.startedAt ?? b.createdAt)
  ).at(-1);

/**
 * Ordered. The first rule that answers wins, so this list is also the priority the inbox shows
 * things in: what is already happening, then what a person owes, then what broke, then silence.
 */
const RULES: ReadonlyArray<(facts: WorkFacts) => WorkState | null> = [
  ({ runs }) =>
    runs.some(({ status }) => status === "queued" || status === "running")
      ? state("running", "run-in-flight", "Running", "An agent is working on this now")
      : null,

  ({ pendingApprovals }) =>
    pendingApprovals
      ? state(
          "waiting",
          "approval-pending",
          "Waiting for your approval",
          `${pendingApprovals} file${pendingApprovals === 1 ? "" : "s"} to review`
        )
      : null,

  ({ item }) => {
    const wait = item.waits.find(({ resolvedAt, kind }) => !resolvedAt && kind === "error");
    return wait
      ? state("stalled", "step-failed", "A step failed", readableError(wait.reason))
      : null;
  },

  ({ item }) => {
    const wait = item.waits.find(({ resolvedAt }) => !resolvedAt);
    return wait
      ? state(
          "waiting",
          "wait-active",
          wait.kind === "human" ? "Waiting on you" : "Waiting",
          wait.reason
        )
      : null;
  },

  ({ runs }) => {
    const last = latest(runs);
    return last && (last.status === "failed" || last.status === "interrupted")
      ? state(
          "stalled",
          "run-failed",
          "A run failed",
          readableError(last.error || last.logs.trim().slice(-300)) ||
            "The run stopped before the step completed"
        )
      : null;
  },

  ({ humanStep }) =>
    humanStep ? state("waiting", "human-step", "Waiting on you", humanStep) : null,

  ({ agentBlocked }) =>
    agentBlocked
      ? state("stalled", "agent-unavailable", "An agent cannot run here", agentBlocked)
      : null,

  ({ hasAgent, stageName }) =>
    hasAgent
      ? null
      : state(
          "waiting",
          "no-agent",
          "Waiting on you",
          `No agent runs at ${stageName} — a person moves this on`
        ),

  ({ processRunning }) =>
    processRunning
      ? null
      : state("stalled", "process-stopped", "Process is stopped", "Press Run, or the work sits here"),

  ({ scheduledFor }) =>
    scheduledFor
      ? state("scheduled", "schedule-pending", "Scheduled", `Next run ${scheduledFor}`)
      : null,

  ({ item, now, stallAfterMs }) =>
    Date.parse(now) - Date.parse(item.updatedAt) < stallAfterMs
      ? state("scheduled", "autopilot-pending", "Queued", "Waiting for the next sweep to start it")
      : null,

  ({ item }) =>
    state(
      "stalled",
      "no-progress",
      "Nothing is happening",
      `Untouched since ${new Date(item.updatedAt).toLocaleString()}, and no run started`
    )
];

/** The one classifier. Settled work has no state; everything else lands on exactly one rule. */
export function workState(facts: WorkFacts): WorkState | null {
  if (facts.item.isTerminal || facts.item.archivedAt) return null;
  for (const rule of RULES) {
    const answer = rule(facts);
    if (answer) return answer;
  }
  return null;
}

/** Work that owes a person something: everything not moving under its own power. */
export function needsAttention(state: WorkState | null): boolean {
  return state?.kind === "waiting" || state?.kind === "stalled";
}

export interface Escalation {
  item: WorkItem;
  state: WorkState;
}

export interface EscalationGroup {
  reason: WorkStateReason;
  kind: WorkStateKind;
  label: string;
  escalations: Escalation[];
}

/**
 * One row per cause, not per item: a single uninstalled CLI stalling six items is one line
 * naming six, which is the difference between an inbox and a wall. Broken before waiting,
 * oldest first inside a group — the longest-ignored thing is the one worth showing first.
 */
export function escalationGroups(states: ReadonlyMap<string, WorkState>, items: WorkItem[]): EscalationGroup[] {
  const groups = new Map<WorkStateReason, EscalationGroup>();
  for (const item of items) {
    const state = states.get(item.id);
    if (!state || !needsAttention(state)) continue;
    const group = groups.get(state.reason) ?? {
      reason: state.reason,
      kind: state.kind,
      label: state.label,
      escalations: []
    };
    group.escalations.push({ item, state });
    groups.set(state.reason, group);
  }
  for (const group of groups.values()) {
    group.escalations.sort((a, b) => a.item.updatedAt.localeCompare(b.item.updatedAt));
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(b.kind === "stalled") - Number(a.kind === "stalled") ||
      b.escalations.length - a.escalations.length
  );
}
