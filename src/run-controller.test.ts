import { describe, expect, it, vi } from "vitest";
import type { Execution, ExecutionOutput, Process, WorkItem } from "./domain.js";
import type { MainHost } from "./main.js";
import { createRunController } from "./run-controller.js";

describe("process running", () => {
  it("toggles from loaded state without reloading the workspace", async () => {
    const refresh = vi.fn();
    const render = vi.fn();
    const setSetting = vi.fn();
    const process = {
      id: "process-1",
      definition: { automation: "automatic" }
    };
    const host = {
      repository: { setSetting },
      shell: { render, showNotice: vi.fn() },
      workspaceController: {
        processes: [process],
        teamItems: [],
        refresh
      }
    } as unknown as MainHost;

    const runs = createRunController(host);
    await runs.setProcessRunning(process.id, true);
    await runs.setProcessRunning(process.id, false);

    expect(setSetting).toHaveBeenCalledWith("running_processes", [process.id]);
    expect(setSetting).toHaveBeenLastCalledWith("running_processes", []);
    expect(render).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("settled file outputs", () => {
  it.each([
    { name: "an ordinary file", logicalOutputs: ["result.txt"], published: ["result.txt"], checkpoints: true },
    { name: "an approval request", logicalOutputs: ["approval-request.md"], published: [], checkpoints: false },
    {
      name: "only ordinary files beside an approval request",
      logicalOutputs: ["approval-request.md", "result.txt"],
      published: ["result.txt"],
      checkpoints: false
    }
  ])("publishes $name", async ({ logicalOutputs, published, checkpoints }) => {
    const item = {
      id: "item-1",
      processId: "process-1",
      stageId: "work",
      title: "Write the result"
    } as WorkItem;
    const process = {
      id: "process-1",
      stages: [
        { id: "work", position: 0 },
        { id: "done", position: 1 }
      ],
      definition: { automation: "automatic", capabilities: [], outputFolders: {} }
    } as unknown as Process;
    const execution = {
      id: "run-1",
      agentId: "agent-1",
      workItemId: item.id,
      config: { prompt: "" },
      status: "completed",
      workspaceRef: "workspace-1",
      result: { outputs: logicalOutputs, projectionState: "pending" }
    } as Execution;
    const outputs = logicalOutputs.map((logicalOutput, index) => ({
      id: `output-${index + 1}`,
      executionId: execution.id,
      logicalOutput,
      logicalDestination: logicalOutput,
      status: "pending"
    } as ExecutionOutput));
    const publishApproved = vi.fn();
    const checkpointWorkItem = vi.fn();
    const repository = {
      getExecution: vi.fn(async () => execution),
      getWorkItem: vi.fn(async () => item),
      getWorkItemScope: vi.fn(async () => ({ organizationId: "org-1" })),
      getResolvedTeamFolder: vi.fn(async () => ({ localPath: "/team" })),
      getSetting: vi.fn(async () => null),
      listExecutionOutputs: vi.fn(async (_executionId?: string, status?: string) =>
        outputs.filter((output) => !status || output.status === status)),
      markExecutionProjectionLocal: vi.fn(async () => {
        execution.result!.projectionState = "local_applied";
      }),
      decideExecutionOutput: vi.fn(async (id: string) => {
        const output = outputs.find((candidate) => candidate.id === id);
        if (output) output.status = "approved";
      }),
      checkpointWorkItem,
      completeExecutionProjection: vi.fn(async () => {
        execution.result!.projectionState = "done";
      })
    };
    const host = {
      repository,
      session: { currentUser: vi.fn(() => null), serverOrgs: new Map() },
      shell: { showNotice: vi.fn(), notifyLocal: vi.fn() },
      workflowRuntime: { command: vi.fn(async () => ({})) },
      workspaces: { publishApproved },
      workspaceController: {
        workspace: { organizationId: "org-1", teamId: "team-1" },
        teamItems: [item],
        processes: [process],
        agents: [],
        refresh: vi.fn()
      }
    } as unknown as MainHost;

    await createRunController(host).applySettledExecution(execution.id, false, false);

    expect(publishApproved.mock.calls.map(([, logicalOutput]) => logicalOutput)).toEqual(published);
    expect(repository.decideExecutionOutput.mock.calls.map(([id]) =>
      outputs.find((output) => output.id === id)?.logicalOutput)).toEqual(published);
    for (const output of outputs) {
      expect(output.status).toBe(published.includes(output.logicalOutput) ? "approved" : "pending");
    }
    if (checkpoints) {
      expect(checkpointWorkItem).toHaveBeenCalledWith(
        item.id,
        logicalOutputs,
        "done",
        execution.id,
        item.stageId
      );
    }
    else {
      expect(checkpointWorkItem).not.toHaveBeenCalled();
    }
  });
});
