import { describe, expect, it } from "vitest";
import { escalationGroups, needsAttention, workState } from "../src/supervision.js";
import type { WorkFacts } from "../src/supervision.js";
import { readableError } from "../src/domain.js";
import type { Execution, WorkItem } from "../src/domain.js";

const NOW = "2026-08-07T12:00:00.000Z";

const item = (over: Partial<WorkItem> = {}): WorkItem =>
  ({
    id: "item",
    processId: "process",
    stageId: "stage",
    title: "Ship the thing",
    isTerminal: false,
    waits: [],
    archivedAt: null,
    updatedAt: NOW,
    ...over
  }) as WorkItem;

const run = (over: Partial<Execution> = {}): Execution =>
  ({
    id: "run",
    workItemId: "item",
    status: "completed",
    logs: "",
    error: null,
    startedAt: NOW,
    createdAt: NOW,
    ...over
  }) as Execution;

const facts = (over: Partial<WorkFacts> = {}): WorkFacts => ({
  item: item(),
  stageName: "Requirements",
  runs: [],
  pendingApprovals: 0,
  hasAgent: true,
  processRunning: true,
  now: NOW,
  stallAfterMs: 15 * 60_000,
  ...over
});

describe("supervision", () => {
  it("reports work that is moving under its own power, and escalates nothing", () => {
    const running = workState(facts({ runs: [run({ status: "running" })] }));
    expect(running).toMatchObject({ kind: "running", reason: "run-in-flight" });
    expect(needsAttention(running)).toBe(false);

    const scheduled = workState(facts({ scheduledFor: "tomorrow" }));
    expect(scheduled).toMatchObject({ kind: "scheduled", reason: "schedule-pending" });
    expect(needsAttention(scheduled)).toBe(false);

    // Just-touched work is owed a sweep, not an escalation — that is what stops the inbox
    // filling with items that were created ten seconds ago.
    expect(workState(facts())).toMatchObject({ kind: "scheduled", reason: "autopilot-pending" });

    expect(workState(facts({ item: item({ isTerminal: true }) }))).toBeNull();
  });

  // The invariant: no cause has to be known, or listed here, for a person to be told.
  it("escalates an item nothing is happening to, with no known cause", () => {
    const state = workState(
      facts({ item: item({ updatedAt: "2026-08-07T10:00:00.000Z" }) })
    );
    expect(state).toMatchObject({ kind: "stalled", reason: "no-progress" });
    expect(needsAttention(state)).toBe(true);
  });

  it("escalates a step that is only ever started by a person", () => {
    const state = workState(facts({ humanStep: "Requirements" }));
    expect(state).toMatchObject({ kind: "waiting", reason: "human-step", detail: "Requirements" });
  });

  it("escalates the causes that used to be silent", () => {
    // Nothing threw and no run exists: the process simply cannot start this agent here.
    expect(
      workState(facts({ agentBlocked: "Codex (ChatGPT) is not installed on this machine" }))
    ).toMatchObject({
      kind: "stalled",
      reason: "agent-unavailable",
      detail: "Codex (ChatGPT) is not installed on this machine"
    });
    // An error the boundary caught before any run receipt existed.
    expect(
      workState(facts({ item: item({ waits: [{ kind: "error", reason: "Set a local team folder", resolvedAt: null }] as WorkItem["waits"] }) }))
    ).toMatchObject({ kind: "stalled", reason: "step-failed" });
    expect(workState(facts({ processRunning: false }))).toMatchObject({
      kind: "stalled",
      reason: "process-stopped"
    });
    expect(workState(facts({ hasAgent: false }))).toMatchObject({
      kind: "waiting",
      reason: "no-agent"
    });
    expect(workState(facts({ item: item({ waits: [{ kind: "manual", reason: "Blocked", resolvedAt: null }] as WorkItem["waits"] }) }))).toMatchObject({
      kind: "waiting",
      reason: "wait-active"
    });
    expect(
      workState(facts({ runs: [run({ status: "failed", error: "Runtime unavailable" })] }))
    ).toMatchObject({ kind: "stalled", reason: "run-failed", detail: "Runtime unavailable" });
  });

  it("keeps a parent with open subtasks out of the inbox", () => {
    expect(workState(facts({ openChildren: 3, hasAgent: false }))).toMatchObject({
      kind: "scheduled",
      reason: "subtasks-pending"
    });
    // Subtasks all settled: the parent answers for itself again.
    expect(workState(facts({ openChildren: 0, hasAgent: false }))).toMatchObject({
      kind: "waiting",
      reason: "no-agent"
    });
  });

  it("keeps waits only an agent can clear out of the inbox", () => {
    // A parent blocked on its subagent is not the human's problem yet.
    expect(
      workState(facts({ item: item({ waits: [{ kind: "dependency", reason: "Waiting on subagent", resolvedAt: null }] as WorkItem["waits"] }) }))
    ).toMatchObject({ kind: "scheduled", reason: "wait-active" });
    // But a human wait alongside it still surfaces.
    expect(
      workState(
        facts({
          item: item({
            waits: [
              { kind: "dependency", reason: "Waiting on subagent", resolvedAt: null },
              { kind: "human", reason: "Answer the question", resolvedAt: null }
            ] as WorkItem["waits"]
          })
        })
      )
    ).toMatchObject({ kind: "waiting", reason: "wait-active", detail: "Answer the question" });
  });

  it("puts a run in flight ahead of every complaint about the item", () => {
    // A running step is progress even when the last one failed and an agent looks unavailable.
    expect(
      workState(
        facts({
          runs: [run({ id: "old", status: "failed" }), run({ id: "new", status: "running" })],
          agentBlocked: "Codex is not installed",
          item: item({ waits: [{ kind: "error", reason: "boom", resolvedAt: null }] as WorkItem["waits"] })
        })
      )
    ).toMatchObject({ kind: "running" });
  });

  it("shows the sentence out of a machine's error, not its envelope", () => {
    const raw =
      'direct(sub_ik_cd018192a53822d79619519b431c6a0e) failed: 502: {"message":"You\'ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 10th, 2026 10:11 PM. (exit code 1)","type":"cli_error"}';
    expect(readableError(raw)).toBe(
      "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 10th, 2026 10:11 PM. (exit code 1)"
    );
    // Envelopes nest: the CLI shim wraps what the provider already wrapped.
    expect(readableError('{"type":"error","message":"{\\"error\\":{\\"message\\":\\"That model is not available.\\"}}"}')).toBe(
      "That model is not available."
    );
    // Plain text and unparseable braces are left exactly as they are.
    expect(readableError("Codex (ChatGPT) is not installed on this machine")).toBe(
      "Codex (ChatGPT) is not installed on this machine"
    );
    expect(readableError("failed: {not json")).toBe("failed: {not json");
    expect(workState(facts({ runs: [run({ status: "failed", error: raw })] }))!.detail).toBe(
      readableError(raw)
    );
  });

  it("groups one cause into one row, broken before waiting, longest-ignored first", () => {
    const stuck = [
      item({ id: "a", updatedAt: "2026-08-07T09:00:00.000Z" }),
      item({ id: "b", updatedAt: "2026-08-07T08:00:00.000Z" }),
      item({ id: "c" })
    ];
    const groups = escalationGroups(
      new Map([
        ["a", workState(facts({ item: stuck[0]!, agentBlocked: "Codex is not installed" }))!],
        ["b", workState(facts({ item: stuck[1]!, agentBlocked: "Codex is not installed" }))!],
        ["c", workState(facts({ item: stuck[2]!, humanStep: "Requirements" }))!],
        ["gone", workState(facts({ runs: [run({ status: "running" })] }))!]
      ]),
      stuck
    );
    expect(groups.map(({ reason }) => reason)).toEqual(["agent-unavailable", "human-step"]);
    // Two items, one row — the difference between an inbox and a wall.
    expect(groups[0]!.escalations.map(({ item: stalled }) => stalled.id)).toEqual(["b", "a"]);
    expect(groups[1]!.escalations).toHaveLength(1);
  });
});
