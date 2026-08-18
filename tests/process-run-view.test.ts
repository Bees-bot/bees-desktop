import { describe, expect, it } from "vitest";
import { createMainViews } from "../src/app-views.js";
import type { Execution, Process, ProcessRun, WorkItem } from "../src/domain.js";
import type { MainHost } from "../src/main.js";

const item = {
  id: "task",
  processId: "process",
  stageId: "stage",
  parentId: null,
  title: "Recover the task",
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
} satisfies WorkItem;

const process = {
  id: "process",
  teamId: "team",
  name: "Recovery",
  description: "",
  archivedAt: null,
  createdAt: "",
  updatedAt: "",
  stages: [{
    id: "stage",
    processId: "process",
    name: "Work",
    position: 0,
    completionRules: "",
    isTerminal: false,
    archivedAt: null
  }],
  definition: {
    moduleId: null,
    version: 1,
    automation: "automatic",
    renderer: "default",
    stateIds: {},
    capabilities: [],
    roleBindings: []
  },
  tags: []
} satisfies Process;

function execution(id: string, status: Execution["status"]): Execution {
  return {
    id,
    agentId: "agent",
    config: { prompt: "Work" },
    workItemId: item.id,
    runtime: "flue",
    status,
    conversationId: id,
    instanceUid: null,
    conversationSnapshot: null,
    restartedFromExecutionId: null,
    submissionId: null,
    workspaceRef: null,
    result: status === "completed" ? { continuation: true } : null,
    usage: null,
    model: null,
    logs: "",
    error: status === "failed" ? "Token expired" : null,
    startedAt: "2026-01-01T00:00:01.000Z",
    endedAt: "2026-01-01T00:00:02.000Z",
    createdAt: "2026-01-01T00:00:01.000Z"
  };
}

function detail(steps: Execution[], selected = ""): string {
  const host = {
    shell: {
      openRunStepId: selected,
      escapeHtml: (value: unknown) => String(value ?? "")
    },
    runs: {
      executionOutputs: [],
      runStageId: () => "stage"
    },
    workspaceController: {
      agents: [{ id: "agent", name: "Worker" }]
    }
  } as unknown as MainHost;
  const run = { item, steps, startedAt: item.createdAt } satisfies ProcessRun;
  return createMainViews(host).processRunDetail(process, run);
}

describe("process run recovery", () => {
  it("opens a failed step in its task conversation and exposes restart", () => {
    const html = detail([execution("failed-run", "failed")], "failed-run");

    expect(html).toContain('data-action="open-item"');
    expect(html).toContain('data-id="task"');
    expect(html).toContain('data-execution="failed-run"');
    expect(html).toContain('data-action="restart-run" data-id="failed-run"');
    expect(html).toContain("Restart");
  });

  it("exposes restart on a completed step", () => {
    const html = detail([execution("completed-run", "completed")]);

    expect(html).toContain('data-action="restart-run" data-id="completed-run"');
  });
});
