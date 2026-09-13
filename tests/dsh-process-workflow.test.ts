import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Execute the real workflow with deterministic activity/signal boundaries, without a Temporal server.
function harness(outcomes: (string | Error)[], patched = true, answerBeforeSuspension = false) {
  const projections: any[] = [];
  const calls: any[] = [];
  const activityOptions: any[] = [];
  const handlers = new Map<string, (...args: any[]) => void>();
  let wake: (() => void) | undefined;
  const temporal = {
    CancellationScope: { nonCancellable: (fn: () => unknown) => fn() },
    condition: (ready: () => boolean) => ready() ? Promise.resolve() : new Promise<void>((resolve) => {
      wake = () => { if (ready()) resolve(); };
    }),
    defineSignal: (name: string) => name,
    sleep: async () => undefined,
    deprecatePatch: () => undefined,
    isCancellation: () => false,
    patched: () => patched,
    proxyActivities: (options: any) => { activityOptions.push(options); return {
      projectWorkItem: async (state: any) => { projections.push({ ...state }); },
      runDshStage: async (stage: any) => {
        calls.push({ ...stage });
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        if (!outcome) throw new Error("Unexpected extra model stage");
        if (outcome === "suspended" && answerBeforeSuspension)
          handlers.get("stageChanged")!(stage.executionId);
        return { outcome, summary: outcome === "revise" ? "Fix the candidate" : "Verified" };
      },
    }; },
    setHandler: (name: string, handler: (...args: any[]) => void) => handlers.set(name, handler),
  };
  const source = readFileSync(new URL("../dsh-runtime/plugin/lib/process-workflow.js", import.meta.url), "utf8")
    .replace(/import\s*\{([\s\S]*?)\}\s*from "@temporalio\/workflow";/, "const {$1} = temporal;")
    .replaceAll("export async function", "async function");
  const run = runInNewContext(`${source}\nprocessWorkflow`, { temporal }) as (input: any) => Promise<any>;
  return {
    run, calls, projections, activityOptions,
    retry: () => { handlers.get("retry")!(); wake?.(); },
    changed: (executionId: string) => { handlers.get("stageChanged")!(executionId); wake?.(); },
  };
}

const stages = [
  { id: "work", name: "Work", driver: "agent" },
  { id: "review", name: "Review", driver: "review" },
  { id: "done", name: "Done", driver: "terminal" },
];
const input = { workItemId: "goal", processId: "goals", stageId: "work", maxAttempts: 3, stages };

describe("Process review budget", () => {
  it("returns delegated candidates to the parent without running an automatic reviewer", async () => {
    const state = harness(["candidate"]);
    await expect(state.run({ ...input, parentReview: true })).resolves.toMatchObject({ phase: "completed" });
    expect(state.calls.map(({ purpose }) => purpose)).toEqual(["worker"]);
  });

  it("preserves an explicit human approval stage for delegated work", async () => {
    const state = harness(["candidate", "pass"]);
    await state.run({ ...input, parentReview: true,
      stages: stages.map((stage) => stage.driver === "review" ? { ...stage, requiresHumanApproval: true } : stage) });
    expect(state.calls[1]).toMatchObject({ purpose: "reviewer", requiresHumanApproval: true });
  });

  it("gives a parent correction a fresh identity and its existing candidate and feedback", async () => {
    const state = harness(["candidate"]);
    await state.run({ ...input, parentReview: true,
      correction: { attempt: 2, candidateExecutionId: "goal-stage-0-work-1", feedback: "Use the RSS timestamps already retrieved" } });
    expect(state.calls).toEqual([expect.objectContaining({ executionId: "goal-stage-0-work-2",
      candidateExecutionId: "goal-stage-0-work-1", feedback: "Use the RSS timestamps already retrieved" })]);
  });

  it("runs failed agent activity once and waits for an explicit retry", async () => {
    const state = harness([new Error("Provider unavailable"), "waiting", "candidate", "pass"]);
    expect(state.activityOptions).toEqual([
      expect.objectContaining({ retry: { maximumAttempts: 5 } }),
      expect.objectContaining({ retry: { maximumAttempts: 1 } }),
      expect.objectContaining({ retry: { initialInterval: "1 second", maximumInterval: "30 seconds" } }),
    ]);
    const completed = state.run(input);
    await vi.waitFor(() => expect(state.projections.at(-1)).toMatchObject({
      phase: "failed", attempt: 1, error: "Provider unavailable",
    }));
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].retryRequest).toBe(0);
    state.retry();
    await expect(completed).resolves.toMatchObject({ phase: "completed", attempt: 2, retryRequest: 0 });
    expect(state.calls).toHaveLength(4);
    expect(state.calls[1].retryRequest).toBe(1);
    expect(state.calls[2].retryRequest).toBe(1);
    expect(state.calls[3].retryRequest).toBe(0);
  });

  it("assigns one stable retry request to each explicit heartbeat retry while preserving the execution id", async () => {
    const state = harness([new Error("activity Heartbeat timeout"), new Error("activity Heartbeat timeout"), "candidate", "pass"], false);
    const completed = state.run(input);
    await vi.waitFor(() => expect(state.projections.at(-1)).toMatchObject({
      phase: "failed", attempt: 1, retryRequest: 0,
    }));
    expect(state.calls).toHaveLength(1);
    state.retry();
    await vi.waitFor(() => expect(state.projections.at(-1)).toMatchObject({
      phase: "failed", attempt: 1, retryRequest: 1,
    }));
    expect(state.calls).toHaveLength(2);
    expect(state.calls[1]).toMatchObject({ executionId: state.calls[0].executionId, retryRequest: 1 });
    state.retry();
    await expect(completed).resolves.toMatchObject({ phase: "completed", attempt: 1, retryRequest: 0 });
    expect(state.calls).toHaveLength(4);
    expect(state.calls[2]).toMatchObject({ executionId: state.calls[0].executionId, retryRequest: 2 });
    expect(state.calls[3].retryRequest).toBe(0);
  });

  it("stops after three rejected candidates and resumes only after an explicit retry", async () => {
    const state = harness(["candidate", "revise", "candidate", "revise", "candidate", "revise", "candidate", "pass"]);
    const completed = state.run(input);
    await vi.waitFor(() => expect(state.projections.at(-1)).toMatchObject({
      phase: "failed", revisions: 3, error: "Fix the candidate",
    }));
    expect(state.calls).toHaveLength(6);
    expect(state.calls.filter(({ purpose }) => purpose === "reviewer").map(({ revisions }) => revisions))
      .toEqual([0, 1, 2]);
    state.retry();
    await expect(completed).resolves.toMatchObject({ phase: "completed", revisions: 0 });
    expect(state.calls).toHaveLength(8);
  });

  it("recovers heartbeat loss in Review without another review identity or a user retry", async () => {
    const state = harness(["candidate", new Error("activity Heartbeat timeout"), "pass"]);
    await expect(state.run(input)).resolves.toMatchObject({ phase: "completed", attempt: 1, reviewCycle: 1 });
    expect(state.calls[2]).toEqual(state.calls[1]);
    expect(state.projections.some(({ phase }) => phase === "failed")).toBe(false);
    expect(state.calls[2]).toMatchObject({ durableWaits: true, retryRequest: 0 });
  });

  it("releases the Review activity during a human wait and resumes only the matching execution", async () => {
    const state = harness(["candidate", "suspended", "pass"]);
    const completed = state.run(input);
    await vi.waitFor(() => expect(state.projections.at(-1)).toMatchObject({
      phase: "waiting", waitingForInput: true, reviewCycle: 1,
    }));
    const review = state.calls[1];
    state.changed("unrelated-execution");
    await Promise.resolve();
    expect(state.calls).toHaveLength(2);
    state.changed(review.executionId);
    await expect(completed).resolves.toMatchObject({ phase: "completed", reviewCycle: 1 });
    expect(state.calls[2].executionId).toBe(review.executionId);
  });

  it("does not lose an answer that arrives before the suspended activity reply", async () => {
    const state = harness(["candidate", "suspended", "pass"], true, true);
    await expect(state.run(input)).resolves.toMatchObject({ phase: "completed", reviewCycle: 1 });
    expect(state.calls[2].executionId).toBe(state.calls[1].executionId);
  });

  it("clears the budget after a pass before reviewing the next stage", async () => {
    const state = harness(Array.from({ length: 2 }, () => [
      "candidate", "revise", "candidate", "revise", "candidate", "pass",
    ]).flat());
    await expect(state.run({ ...input, stages: [
      ...stages.slice(0, 2),
      { id: "next-work", name: "Next work", driver: "discussion" },
      { id: "next-review", name: "Next review", driver: "review" },
      stages[2],
    ] })).resolves.toMatchObject({ phase: "completed", revisions: 0 });
    expect(state.projections.some(({ phase }) => phase === "failed")).toBe(false);
    expect(state.calls.filter(({ purpose }) => purpose === "reviewer").map(({ revisions }) => revisions))
      .toEqual([0, 1, 2, 0, 1, 2]);
  });

  it("preserves the old transition when replaying a history without the patch", async () => {
    const state = harness(["candidate", "revise", "candidate", "revise", "candidate", "revise", "candidate", "pass"], false);
    await expect(state.run(input)).resolves.toMatchObject({ phase: "completed" });
    expect(state.calls.filter(({ purpose }) => purpose === "reviewer").map(({ revisions }) => revisions))
      .toEqual([0, 0, 0, 0]);
  });
});
