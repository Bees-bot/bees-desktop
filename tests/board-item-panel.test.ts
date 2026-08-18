import { describe, expect, it } from "vitest";
import { createMainViews } from "../src/app-views.js";
import type { Execution, ExecutionOutput, Process, WorkItem } from "../src/domain.js";
import type { MainHost } from "../src/main.js";

describe("task panel run controls", () => {
  it("renders restart and delete in the task header, not the conversation", async () => {
    const item = {
      id: "task",
      processId: "process",
      stageId: "stage",
      parentId: null,
      title: "Fix authentication",
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
        name: "Failed",
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
    const run = {
      id: "run",
      agentId: "agent",
      workItemId: item.id,
      runtime: "flue",
      status: "failed",
      conversationId: "run",
      instanceUid: null,
      conversationSnapshot: null,
      restartedFromExecutionId: null,
      submissionId: null,
      workspaceRef: null,
      config: { prompt: "Fix it" },
      model: null,
      usage: null,
      result: null,
      error: "Token expired",
      logs: "",
      startedAt: null,
      endedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z"
    } satisfies Execution;
    const host = {
      shell: {
        activeExecutionId: run.id,
        boardTab: "conversation",
        boardFileRef: "",
        boardFileEditing: false,
        escapeHtml: (value: unknown) => String(value ?? "")
      },
      runs: {
        executions: [run],
        executionOutputs: [],
        liveEvents: new Map(),
        supervise: () => new Map()
      },
      workspaceController: { teamItems: [item] }
    } as unknown as MainHost;

    const html = await createMainViews(host).renderBoardItemPanel(item, process);
    const tabs = html.indexOf('role="tablist"');

    expect(html.indexOf('data-action="restart-run" data-id="run"')).toBeLessThan(tabs);
    expect(html.indexOf('data-action="delete-run" data-id="run"')).toBeLessThan(tabs);
    expect(html).not.toContain('data-action="download-receipt"');

    const activeRun = { ...run, status: "running", error: null } satisfies Execution;
    const pendingOutput = {
      id: "output",
      executionId: activeRun.id,
      logicalOutput: "fix.md",
      logicalDestination: "fix.md",
      status: "pending",
      reason: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      decidedAt: null
    } satisfies ExecutionOutput;
    const activeHost = {
      ...host,
      shell: { ...host.shell, activeExecutionId: activeRun.id },
      runs: { ...host.runs, executions: [activeRun], executionOutputs: [pendingOutput] }
    } as unknown as MainHost;
    const activeHtml = await createMainViews(activeHost).renderBoardItemPanel(item, process);
    const activeTabs = activeHtml.indexOf('role="tablist"');

    expect(activeHtml.indexOf('data-action="stop-run" data-id="run">Stop run</button>')).toBeLessThan(activeTabs);
    expect(activeHtml.indexOf('data-action="approve-output" data-id="output" disabled>Approve</button>')).toBeLessThan(activeTabs);
    expect(activeHtml.match(/data-action="approve-output"/g)).toHaveLength(1);
    expect(activeHtml).not.toContain('data-board-tab="approval"');
  });
});
