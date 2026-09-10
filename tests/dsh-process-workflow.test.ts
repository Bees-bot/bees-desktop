import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Execute the real workflow with deterministic activity/signal boundaries, without a Temporal server.
function harness(outcomes: string[], patched = true) {
  const projections: any[] = [];
  const calls: any[] = [];
  const handlers = new Map<string, () => void>();
  let wake: (() => void) | undefined;
  const temporal = {
    CancellationScope: { nonCancellable: (fn: () => unknown) => fn() },
    condition: (ready: () => boolean) => ready() ? Promise.resolve() : new Promise<void>((resolve) => {
      wake = () => { if (ready()) resolve(); };
    }),
    defineSignal: (name: string) => name,
    deprecatePatch: () => undefined,
    isCancellation: () => false,
    patched: () => patched,
    proxyActivities: () => ({
      projectWorkItem: async (state: any) => { projections.push({ ...state }); },
      runDshStage: async (stage: any) => {
        calls.push({ ...stage });
        const outcome = outcomes.shift();
        if (!outcome) throw new Error("Unexpected extra model stage");
        return { outcome, summary: outcome === "revise" ? "Fix the candidate" : "Verified" };
      },
    }),
    setHandler: (name: string, handler: () => void) => handlers.set(name, handler),
  };
  const source = readFileSync(new URL("../dsh-runtime/plugin/lib/process-workflow.js", import.meta.url), "utf8")
    .replace(/import\s*\{([\s\S]*?)\}\s*from "@temporalio\/workflow";/, "const {$1} = temporal;")
    .replaceAll("export async function", "async function");
  const run = runInNewContext(`${source}\nprocessWorkflow`, { temporal }) as (input: any) => Promise<any>;
  return {
    run, calls, projections,
    retry: () => { handlers.get("retry")!(); wake?.(); },
  };
}

const stages = [
  { id: "work", name: "Work", driver: "agent" },
  { id: "review", name: "Review", driver: "review" },
  { id: "done", name: "Done", driver: "terminal" },
];
const input = { workItemId: "goal", processId: "goals", stageId: "work", maxAttempts: 3, stages };

describe("Process review budget", () => {
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
