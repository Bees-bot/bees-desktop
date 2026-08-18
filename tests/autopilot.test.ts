import { describe, expect, it } from "vitest";
import {
  activeExecutionForItem,
  autonomousRunKeys,
  isProposal,
  needsAutonomousRun,
  workItemCondition,
  workItemForRetry
} from "../src/domain.js";
import { skillFile, skillSlug } from "../src/agent-files.js";
import type { Agent, Execution, WorkItem } from "../src/domain.js";
import { runPrompt } from "../src/run-coordinator.js";

const item = {
  id: "item-1",
  processId: "process-1",
  stageId: "stage-1",
  parentId: null,
  title: "Draft",
  description: "",
  owner: null,
  goal: null,
  isTerminal: false,
  waits: [],
  logicalFiles: [],
  syncVersion: 0,
  checkpointStageId: null,
  checkpointAt: null,
  archivedAt: null,
  deletedAt: null,
  createdAt: "2026-07-29T10:00:00.000Z",
  updatedAt: "2026-07-29T10:00:00.000Z"
} satisfies WorkItem;

const execution = (createdAt: string): Execution =>
  ({ workItemId: item.id, createdAt, config: { prompt: "" } }) as Execution;

describe("needsAutonomousRun", () => {
  it("runs an item nothing has picked up", () => {
    expect(needsAutonomousRun(item, [], new Set())).toBe(true);
  });

  it("leaves a run that already happened since the item changed", () => {
    expect(needsAutonomousRun(item, [execution("2026-07-29T10:05:00.000Z")], new Set())).toBe(false);
  });

  it("runs again once the item moves on", () => {
    const moved = { ...item, stageId: "stage-2", updatedAt: "2026-07-29T10:10:00.000Z" };
    expect(needsAutonomousRun(moved, [execution("2026-07-29T10:05:00.000Z")], new Set())).toBe(true);
  });

  it("will not restart a status the process checkpointed into", () => {
    const checkpointed = { ...item, checkpointAt: item.updatedAt };
    expect(needsAutonomousRun(checkpointed, [], new Set(autonomousRunKeys(item)))).toBe(false);
  });

  it("runs again when a rejected output makes the item due", () => {
    const rejected = { ...item, checkpointAt: "2026-07-29T10:00:00.000Z", updatedAt: "2026-07-29T10:20:00.000Z" };
    const started = new Set(autonomousRunKeys(item));
    expect(needsAutonomousRun(rejected, [execution("2026-07-29T10:05:00.000Z")], started)).toBe(true);
  });

  it("ignores items that are done", () => {
    expect(needsAutonomousRun({ ...item, isTerminal: true }, [], new Set())).toBe(false);
  });
});

describe("manual retry", () => {
  it("acknowledges active errors without discarding unrelated waits", () => {
    const errored = {
      ...item,
      waits: [
        { id: "error", kind: "error", resolvedAt: null },
        { id: "approval", kind: "human", resolvedAt: null },
        { id: "old-error", kind: "error", resolvedAt: item.updatedAt }
      ] as WorkItem["waits"]
    };

    expect(workItemCondition(errored)).toBe("error");
    expect(workItemForRetry(errored).waits.map(({ id }) => id)).toEqual(["approval", "old-error"]);
    expect(workItemCondition(workItemForRetry(errored))).toBe("waiting");
  });
});

describe("runPrompt", () => {
  const agent = { config: { prompt: "Write a tweet" } } as Agent;
  const stages = (...names: string[]) => names.map((name) => ({ id: `${name.toLowerCase()}-id`, name }));

  it("tells the agent what the rejections asked for", () => {
    const prompt = runPrompt({
      item,
      agent,
      teamRoot: "/team",
      stages: stages("Draft", "Review"),
      feedback: ["Too long", "  ", "Wrong tone"]
    });
    expect(prompt).toContain("- Too long");
    expect(prompt).toContain("- Wrong tone");
  });

  it("says nothing about rejections on a first attempt", () => {
    const prompt = runPrompt({ item, agent, teamRoot: "/team", stages: stages("Draft") });
    expect(prompt).not.toContain("rejected");
    expect(prompt).toContain("Draft: draft-id");
    expect(prompt).toContain("write the chosen status ID");
  });

  it("shows live status destinations without asking the agent to construct paths", () => {
    const [draft, review] = stages("Draft", "Human review");
    const prompt = runPrompt({
      item,
      agent,
      teamRoot: "/team",
      stages: [draft!, { ...review!, outputFolder: "ready-for-human-review" }]
    });
    expect(prompt).toContain("Human review: human review-id — approved files publish under ready-for-human-review/");
    expect(prompt).toContain("Write files directly under outputs; Bees adds");
  });

  it("supplies the strict Goals schema and external-action receipt contract", () => {
    const prompt = runPrompt({
      item: {
        ...item,
        goal: {
          key: "reply:123",
          role: "publisher",
          effect: "external_write",
          planOutputId: "output",
          authorizedAt: item.updatedAt,
          occurrenceOf: null
        }
      },
      agent,
      teamRoot: "/team",
      stages: stages("Work", "Review"),
      taskPlan: {
        state: "work",
        output: ".tasks.json",
        outputBlockedStates: ["waiting", "done"]
      },
      goalEffect: "external_write",
      workerRoles: [{ role: "publisher", purpose: "Publishes approved replies" }]
    });
    expect(prompt).toContain('"effect":"read|prepare|external_write"');
    expect(prompt).toContain("publisher: Publishes approved replies");
    expect(prompt).toContain("action-receipt.json");
    expect(prompt).toContain("If success is uncertain");
  });

  it("gives subtasks their parent goal and gives parents their task progress", () => {
    const child = { ...item, id: "child", parentId: item.id, title: "Write copy" };
    const prompt = runPrompt({
      item: child,
      parent: item,
      children: [{ ...child, isTerminal: true, logicalFiles: ["copy.md"] }],
      agent,
      teamRoot: "/team",
      stages: stages("Work", "Review")
    });
    expect(prompt).toContain("Parent goal: Draft");
    expect(prompt).toContain("[done] Write copy — files: copy.md");
  });

  it("sends a follow-up as the next message in the existing conversation", () => {
    const prompt = runPrompt({
      item,
      agent,
      teamRoot: "/team",
      stages: stages("Draft", "Review"),
      message: "  Can you make the opening friendlier?  "
    });
    expect(prompt).toBe("Can you make the opening friendlier?");
  });
});

describe("isProposal", () => {
  const proposal = { config: { prompt: "", proposalStageId: "stage-1" } } as unknown as Execution;

  it("does not count a skill proposal as work on the item", () => {
    expect(isProposal(proposal)).toBe(true);
    const work = [proposal, execution("2026-07-29T10:30:00.000Z")].filter((run) => !isProposal(run));
    expect(needsAutonomousRun(item, work, new Set())).toBe(false);
    expect(needsAutonomousRun(item, [proposal].filter((run) => !isProposal(run)), new Set())).toBe(true);
  });
});

describe("activeExecutionForItem", () => {
  it("finds task activity without mistaking a skill proposal for the task run", () => {
    const proposal = {
      workItemId: item.id,
      status: "running",
      config: { prompt: "", proposalStageId: item.stageId }
    } as unknown as Execution;
    const run = {
      workItemId: item.id,
      status: "queued",
      config: { prompt: "" }
    } as unknown as Execution;
    expect(activeExecutionForItem(item.id, [proposal, run])).toBe(run);
    expect(activeExecutionForItem(item.id, [{ ...run, status: "completed" }])).toBeUndefined();
  });
});

describe("skill files", () => {
  it("writes frontmatter the runtime can read", () => {
    expect(skillFile("Brand Voice", "How we write", "Keep it short.")).toBe(
      "---\nname: brand-voice\ndescription: How we write\n---\n\nKeep it short.\n"
    );
  });

  it("refuses a name with no usable characters", () => {
    expect(() => skillSlug("!!!")).toThrow();
  });
});
