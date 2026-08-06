import { describe, expect, it } from "vitest";
import { FOLLOW_UP_LIMIT } from "../../domain.js";
import type { Execution, Process, WorkItem } from "../../domain.js";
import {
  MAX_DEBATE_ROUNDS,
  SOFTWARE_PROJECT_QUESTIONS,
  SOFTWARE_PROJECT_ROLES,
  emptySoftwareProjectState,
  parseDebateTurn,
  parseImplementationPlan,
  routeSoftwareProject,
  softwareProjectStateKey,
  softwareProjectView,
  type SoftwareProjectState
} from "./index.js";
import {
  SoftwareProjectController,
  type ProcessAgentTurn,
  type SoftwareProjectHost
} from "./controller.js";
import { softwareProjectProcess } from "./definition.js";

describe("software project router", () => {
  it("requires each approval gate", () => {
    expect(routeSoftwareProject("Requirements", "requirements-approved")).toBe("Architecture");
    expect(routeSoftwareProject("Architecture", "architecture-approved")).toBe("Plan");
    expect(routeSoftwareProject("Plan", "plan-approved")).toBe("Implement");
    expect(routeSoftwareProject("Implement", "tests-passed")).toBe("Phase Review");
    expect(routeSoftwareProject("Phase Review", "phase-approved", true)).toBe("Implement");
    expect(routeSoftwareProject("Phase Review", "phase-approved", false)).toBe("Final Review");
    expect(routeSoftwareProject("Final Review", "final-tests-passed")).toBe("Done");
  });

  it("rejects impossible transitions", () => {
    expect(() => routeSoftwareProject("Requirements", "plan-approved")).toThrow();
  });
});

describe("software project module contract", () => {
  it("claims only its own process and Studio forms", () => {
    const controller = new SoftwareProjectController({} as SoftwareProjectHost);
    const form = {
      matches: (selector: string) => selector.includes("form[data-project-plan]")
    } as HTMLFormElement;
    expect(controller.matches("Software Project")).toBe(true);
    expect(controller.matches("Goals")).toBe(false);
    expect(controller.handlesSubmit(form)).toBe(true);
  });

  it("collects requirements for new and continued software work", () => {
    const changeType = SOFTWARE_PROJECT_QUESTIONS.find(({ id }) => id === "changeType");
    expect(changeType && "options" in changeType ? changeType.options : []).toEqual(
      expect.arrayContaining(["New project", "Bug fix", "New feature", "Refactor"])
    );
    expect(SOFTWARE_PROJECT_QUESTIONS.some(({ id }) => id === "preserve")).toBe(true);
  });

  it("requires one local project folder before requirements", () => {
    const view = softwareProjectView({
      item: { title: "Change the app" } as WorkItem,
      stage: "Requirements",
      state: emptySoftwareProjectState(),
      runs: [],
      mapping: null,
      git: null
    });
    expect(view).toContain('data-action="project-select-folder"');
    expect(view).not.toContain("data-project-requirements");
  });
});

const DEBATE_ITEM = { id: "item-1", title: "Ship it" } as WorkItem;

function proposal(summary: string): Record<string, unknown> {
  return {
    summary,
    decisions: [{ area: "Language", choice: "TypeScript", reason: "Matches the repository" }],
    repositoryPlan: [],
    commands: {},
    risks: [],
    questions: []
  };
}

function debateReply(concerns: string[], resolved: boolean): string {
  return JSON.stringify({
    critique: { summary: "Reviewed", strengths: [], concerns, recommendedChanges: [] },
    proposal: proposal(resolved ? "Agreed" : "Still disputed"),
    resolved
  });
}

function receipt(id: string, text: string): Execution {
  return {
    id,
    conversationSnapshot: { messages: [{ role: "assistant", parts: [{ kind: "text", text }] }] }
  } as unknown as Execution;
}

/** A studio host parked on Architecture with both opening proposals already in state. */
function debateHost(reply: (round: number) => string): {
  host: SoftwareProjectHost;
  batches: ProcessAgentTurn[][];
  state: () => SoftwareProjectState;
} {
  const settings = new Map<string, unknown>();
  const batches: ProcessAgentTurn[][] = [];
  settings.set(softwareProjectStateKey(DEBATE_ITEM.id), {
    ...emptySoftwareProjectState(),
    requirements: { summary: "Ship it" },
    requirementsApprovedAt: "2026-01-01T00:00:00.000Z",
    architecture: {
      openai: proposal("OpenAI opening"),
      anthropic: proposal("Anthropic opening"),
      rounds: [],
      openaiExecutionId: "openai-0",
      anthropicExecutionId: "anthropic-0"
    }
  } as unknown as SoftwareProjectState);
  const host = {
    current: () => ({
      item: DEBATE_ITEM,
      process: { name: "Software Project", stages: [] } as unknown as Process,
      stage: "Architecture"
    }),
    getSetting: async (key: string, fallback: unknown) =>
      settings.has(key) ? settings.get(key) : fallback,
    setSetting: async (key: string, value: unknown) => {
      settings.set(key, value);
    },
    runAgentTurns: async (_item: WorkItem, turns: ProcessAgentTurn[]) => {
      batches.push(turns);
      const answer = reply(batches.length);
      return turns.map((turn, index) => receipt(`${turn.role}-${batches.length}-${index}`, answer));
    },
    refresh: async () => undefined,
    notify: () => undefined
  } as unknown as SoftwareProjectHost;
  return {
    host,
    batches,
    state: () => settings.get(softwareProjectStateKey(DEBATE_ITEM.id)) as SoftwareProjectState
  };
}

describe("architecture debate", () => {
  it("always terminates, and refuses a round past the budget", async () => {
    const { host, state } = debateHost(() => debateReply(["Still disagree"], false));
    const controller = new SoftwareProjectController(host);
    for (let round = 0; round < MAX_DEBATE_ROUNDS; round += 1) {
      await controller.handleAction("project-debate-architecture", {} as HTMLElement);
    }
    expect(state().architecture?.rounds).toHaveLength(MAX_DEBATE_ROUNDS);
    await expect(
      controller.handleAction("project-debate-architecture", {} as HTMLElement)
    ).rejects.toThrow(/already settled/);
  });

  it("stops early once both architects concede", async () => {
    const { host, state } = debateHost(() => debateReply([], true));
    const controller = new SoftwareProjectController(host);
    await controller.handleAction("project-debate-architecture", {} as HTMLElement);
    expect(state().architecture?.rounds).toHaveLength(1);
    await expect(
      controller.handleAction("project-debate-architecture", {} as HTMLElement)
    ).rejects.toThrow(/already settled/);
  });

  it("runs both sides of a round concurrently, each continuing its own conversation", async () => {
    const { host, batches, state } = debateHost(() => debateReply(["One left"], false));
    const controller = new SoftwareProjectController(host);
    await controller.handleAction("project-debate-architecture", {} as HTMLElement);
    await controller.handleAction("project-debate-architecture", {} as HTMLElement);
    expect(batches.map(({ length }) => length)).toEqual([2, 2]);
    expect(batches[0]!.map(({ executionId }) => executionId)).toEqual(["openai-0", "anthropic-0"]);
    // Round two resumes the receipts round one produced rather than opening a cold conversation.
    expect(batches[1]!.map(({ executionId }) => executionId)).toEqual([
      `${SOFTWARE_PROJECT_ROLES.openaiArchitect}-1-0`,
      `${SOFTWARE_PROJECT_ROLES.anthropicArchitect}-1-1`
    ]);
    // A warm conversation is not re-fed the requirements it already read.
    expect(batches[1]![0]!.prompt).not.toContain("Approved requirements");
    expect(state().architecture?.openai?.summary).toBe("Still disputed");
  });

  it("keeps a continued round inside the follow-up character budget", async () => {
    const { host, batches } = debateHost(() =>
      JSON.stringify({
        critique: {
          summary: "Reviewed",
          strengths: [],
          concerns: ["c".repeat(2_000)],
          recommendedChanges: ["r".repeat(2_000)]
        },
        proposal: {
          ...proposal("Fat"),
          repositoryPlan: Array.from({ length: 60 }, () => "path/".repeat(40))
        },
        resolved: false
      })
    );
    const controller = new SoftwareProjectController(host);
    for (let round = 0; round < MAX_DEBATE_ROUNDS; round += 1) {
      await controller.handleAction("project-debate-architecture", {} as HTMLElement);
    }
    // runPrompt throws above the limit when a turn continues an existing conversation, so an
    // oversized round must drop to a cold conversation rather than fail.
    for (const turn of batches.flat()) {
      if (turn.executionId) expect(turn.prompt.length).toBeLessThanOrEqual(FOLLOW_UP_LIMIT);
    }
    expect(batches.flat().some(({ executionId }) => !executionId)).toBe(true);
  });

  it("will not synthesize a decision before the debate has run", async () => {
    const { host } = debateHost(() => debateReply([], true));
    const controller = new SoftwareProjectController(host);
    await expect(
      controller.handleAction("project-synthesize-architecture", {} as HTMLElement)
    ).rejects.toThrow(/Run the architecture debate first/);
  });

  it("rejects a round that argues without revising its own proposal", () => {
    expect(() =>
      parseDebateTurn('{"critique":{"summary":"No"},"resolved":false}')
    ).toThrow();
  });
});

describe("studio agent triggers", () => {
  it("puts several agents on one status, which only a studio process may do", () => {
    const { mode, definition } = softwareProjectProcess;
    const perStage = new Map<string, number>();
    for (const { stage } of definition.agents) {
      perStage.set(stage, (perStage.get(stage) ?? 0) + 1);
    }
    expect(mode).toBe("studio");
    expect(perStage.get("Architecture")).toBe(2);
    expect([...perStage.values()].some((count) => count > 1)).toBe(true);
  });
});

describe("implementation plan parser", () => {
  it("accepts reviewable structured phases", () => {
    expect(
      parseImplementationPlan(JSON.stringify({
        phases: [{
          id: "phase-01",
          title: "Foundation",
          outcome: "The app starts",
          acceptanceCriteria: ["Build passes"],
          estimatedChangedLines: 700
        }]
      }))[0]
    ).toMatchObject({ id: "phase-01", estimatedChangedLines: 700 });
  });

  it("rejects phases a human cannot verify", () => {
    expect(() => parseImplementationPlan('{"phases":[{"title":"Mystery"}]}')).toThrow();
  });
});
