import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Execution, WorkItem } from "../src/domain.js";
import type { FlueProjectService } from "../src/flue-project.js";
import type { LocalRepository } from "../src/repository.js";
import {
  RunCoordinator,
  type RunHost,
  type RustRunRequest,
  type SettledRun
} from "../src/run-coordinator.js";
import type { TemporaryWorkspaceService } from "../src/workspaces.js";

/** A stand-in for the Rust RunService: records what it was asked, settles when told. */
function host(settled: Partial<SettledRun> = {}) {
  const startRun = vi.fn(async () => undefined);
  const resumeRun = vi.fn(async () => undefined);
  const stopRun = vi.fn(async () => undefined);
  return {
    startRun,
    resumeRun,
    stopRun,
    awaitSettled: async (executionId: string): Promise<SettledRun> => ({
      executionId,
      status: "completed",
      outputs: [],
      statusName: "",
      ...settled
    })
  };
}

function coordinator(
  repository: Partial<LocalRepository>,
  workspaces: Partial<TemporaryWorkspaceService>,
  runHost: RunHost,
  flueProject: Partial<FlueProjectService> = { bindWorkspace: vi.fn().mockResolvedValue([]) }
) {
  return new RunCoordinator(
    {
      beginExecutionDelivery: vi.fn(),
      updateExecution: vi.fn(),
      ...repository
    } as LocalRepository,
    workspaces as TemporaryWorkspaceService,
    flueProject as FlueProjectService,
    async () => ({ baseUrl: "http://runtime", token: "tok" }),
    runHost
  );
}

describe("RunCoordinator", () => {
  it("hands a run to Rust with everything settlement needs, and owns none of it after", async () => {
    const repository = {
      createExecution: vi.fn().mockResolvedValue("run-new"),
      getExecution: vi.fn().mockResolvedValue(null),
      updateExecution: vi.fn()
    };
    const workspaces = { prepare: vi.fn().mockResolvedValue("/cache/workspaces/run-new") };
    const flueProject = { bindWorkspace: vi.fn().mockResolvedValue([]) };
    const runHost = host({ outputs: ["draft.md"], statusName: "Review" });

    const outcome = await coordinator(repository, workspaces, runHost, flueProject).start({
      item: { id: "item-1", title: "Draft", description: "", logicalFiles: [] } as unknown as WorkItem,
      agent: {
        id: "agent-1",
        config: { prompt: "Work.", validationRules: ["require-output"] }
      } as unknown as Agent,
      teamRoot: "/team",
      stages: ["Review", "Done"],
      goalStage: "Plan"
    });

    // One id: the execution addresses the conversation, the pointer, and the sandbox.
    expect(flueProject.bindWorkspace).toHaveBeenCalledWith(
      "run-new",
      "/cache/workspaces/run-new",
      "/team",
      [],
      []
    );
    expect(runHost.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "run-new",
        agentName: "bees-run",
        workspace: "/cache/workspaces/run-new",
        baseUrl: "http://runtime",
        token: "tok",
        validationRules: ["require-output"],
        stages: ["Review", "Done"],
        goalStage: "Plan"
      })
    );
    expect(outcome).toMatchObject({
      executionId: "run-new",
      status: "completed",
      outputs: ["draft.md"],
      statusName: "Review"
    });
  });

  it("keeps a follow-up in its existing execution and workspace", async () => {
    const repository = {
      createExecution: vi.fn(),
      getExecution: vi.fn().mockResolvedValue({
        id: "run-old",
        conversationId: "run-old",
        instanceUid: "uid-old"
      }),
      updateExecution: vi.fn()
    };
    const workspaces = { prepare: vi.fn().mockResolvedValue("/cache/workspaces/run-old") };
    const runHost = host();

    const outcome = await coordinator(repository, workspaces, runHost).start({
      executionId: "run-old",
      item: { id: "goal-3", logicalFiles: [] } as unknown as WorkItem,
      agent: { id: "planner", config: { prompt: "Plan it." } } as unknown as Agent,
      teamRoot: "/team",
      message: "Add a sixth task",
      stages: ["Plan", "Work"]
    });

    expect(repository.createExecution).not.toHaveBeenCalled();
    expect(workspaces.prepare).toHaveBeenCalledWith("run-old", "/team", []);
    expect(outcome.executionId).toBe("run-old");
    // The follow-up is the prompt, not the whole task briefing.
    const [sent] = runHost.startRun.mock.calls[0] as unknown as [{ prompt: string }];
    expect(sent).toMatchObject({
      prompt: "Add a sixth task",
      instanceUid: "uid-old",
      continuation: true
    });
  });

  it("runs software coding turns in the validated project worktree", async () => {
    const repository = {
      createExecution: vi.fn().mockResolvedValue("run-project"),
      getExecution: vi.fn().mockResolvedValue(null),
      beginExecutionDelivery: vi.fn(),
      updateExecution: vi.fn()
    };
    const workspaces = {
      prepare: vi.fn(),
      projectWorkspace: vi.fn().mockResolvedValue("/projects/app")
    };
    const flueProject = { bindWorkspace: vi.fn().mockResolvedValue([]) };
    const runHost = host();

    await coordinator(repository, workspaces, runHost, flueProject).start({
      item: { id: "project-1", title: "App", description: "", logicalFiles: [] } as unknown as WorkItem,
      agent: { id: "coder", config: { prompt: "Code." } } as unknown as Agent,
      teamRoot: "/team",
      stages: [],
      projectWorkItemId: "project-1",
      manualProjection: true
    });

    expect(workspaces.prepare).not.toHaveBeenCalled();
    expect(flueProject.bindWorkspace).toHaveBeenCalledWith(
      "run-project",
      "/projects/app",
      "/team",
      [],
      [],
      "project-1"
    );
    expect(repository.beginExecutionDelivery).toHaveBeenCalledWith(
      "run-project",
      expect.objectContaining({ projectMode: true, manualProjection: true })
    );
    expect(runHost.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: "/projects/app",
        projectMode: true,
        manualProjection: true
      })
    );
  });

  it("links a restart to the receipt it came from without touching that receipt", async () => {
    const repository = {
      createExecution: vi.fn().mockResolvedValue("run-new"),
      getExecution: vi.fn().mockResolvedValue(null),
      updateExecution: vi.fn()
    };
    const runHost = host();

    await coordinator(
      repository,
      { prepare: vi.fn().mockResolvedValue("/cache/workspaces/run-new") },
      runHost
    ).start({
      item: { id: "item-1", logicalFiles: [] } as unknown as WorkItem,
      agent: { id: "agent-1", config: { prompt: "Republished prompt." } } as unknown as Agent,
      teamRoot: "/team",
      stages: [],
      restartedFromExecutionId: "run-old"
    });

    expect(repository.createExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        restartedFromExecutionId: "run-old",
        config: { prompt: "Republished prompt." }
      })
    );
    expect(repository.updateExecution.mock.calls.map(([id]) => id)).not.toContain("run-old");
  });

  it("surfaces a Rust-side failure without overwriting the status Rust already wrote", async () => {
    const repository = {
      createExecution: vi.fn().mockResolvedValue("run-new"),
      getExecution: vi.fn().mockResolvedValue({ id: "run-new", endedAt: "2026-07-31T00:00:00Z" }),
      updateExecution: vi.fn()
    };
    const runHost = host({ status: "failed", error: "Agent validation requires at least one output file" });

    await expect(
      coordinator(repository, { prepare: vi.fn().mockResolvedValue("/ws") }, runHost).start({
        item: { id: "item-1", logicalFiles: [] } as unknown as WorkItem,
        agent: { id: "agent-1", config: { prompt: "Work." } } as unknown as Agent,
        teamRoot: "/team",
        stages: []
      })
    ).rejects.toThrow("Agent validation requires at least one output file");

    // Rust owns the terminal receipt; the webview must not stamp a second one over it.
    expect(repository.updateExecution.mock.calls.filter(([, status]) => status === "failed")).toEqual([]);
  });

  it("re-adopts an admitted run instead of re-sending its prompt", async () => {
    const runHost = host();

    await coordinator({}, {}, runHost).resume(
      [
        {
          id: "run-old",
          agentId: "agent-1",
          submissionId: "sub-1",
          instanceUid: "uid-1",
          workspaceRef: "/cache/workspaces/run-old",
          config: { prompt: "Work.", validationRules: [] },
          result: {
            deliveryId: "delivery-1",
            stages: ["Plan", "Done"],
            goalStage: "Plan",
            continuation: false,
            projectionState: "pending"
          }
        } as unknown as Execution
      ]
    );

    expect(runHost.resumeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "run-old",
        deliveryId: "delivery-1",
        prompt: "",
        workspace: "/cache/workspaces/run-old",
        instanceUid: "uid-1",
        stages: ["Plan", "Done"],
        goalStage: "Plan"
      }),
      "sub-1"
    );
    expect(runHost.startRun).not.toHaveBeenCalled();
  });

  it("retries the same persisted delivery when admission crashed before its receipt", async () => {
    const runHost = host();

    await coordinator({}, {}, runHost).resume(
      [
        {
          id: "run-pre-admission",
          agentId: "agent-1",
          submissionId: null,
          instanceUid: null,
          workspaceRef: "/cache/workspaces/run-pre-admission",
          config: { prompt: "Work." },
          result: {
            deliveryId: "delivery-stable",
            prompt: "Persisted prompt",
            stages: [],
            continuation: false,
            initialData: {
              version: 1,
              executionId: "run-pre-admission",
              agentId: "agent-1",
              agentName: "Agent",
              purpose: "",
              model: "openai/gpt-5",
              instructions: "Work.",
              teamId: "team-1",
              browser: false,
              browserWrite: false,
              localTools: false,
              skills: [],
              mcpConnections: [],
              delegates: [],
              grants: []
            },
            projectionState: "pending"
          }
        } as unknown as Execution
      ]
    );

    expect(runHost.resumeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "run-pre-admission",
        deliveryId: "delivery-stable",
        agentName: "bees-run",
        prompt: "Persisted prompt",
        continuation: false,
        initialData: expect.objectContaining({ executionId: "run-pre-admission" })
      }),
      ""
    );
  });

  it("uses a fresh delivery key for each follow-up in one conversation", async () => {
    const repository = {
      getExecution: vi.fn().mockResolvedValue({ id: "run-old", instanceUid: "uid-old" }),
      beginExecutionDelivery: vi.fn(),
      updateExecution: vi.fn()
    };
    const runHost = host();
    const runCoordinator = coordinator(
      repository,
      { prepare: vi.fn().mockResolvedValue("/cache/workspaces/run-old") },
      runHost
    );
    const request = {
      executionId: "run-old",
      item: { id: "item", logicalFiles: [] } as unknown as WorkItem,
      agent: { id: "agent", config: { prompt: "Work." } } as unknown as Agent,
      teamRoot: "/team",
      stages: [],
      message: "First follow-up"
    };

    await runCoordinator.start(request);
    await runCoordinator.start({ ...request, message: "Second follow-up" });

    const deliveries = (
      runHost.startRun.mock.calls as unknown as Array<[RustRunRequest]>
    ).map(([sent]) => sent.deliveryId);
    expect(new Set(deliveries).size).toBe(2);
    expect(repository.beginExecutionDelivery).toHaveBeenNthCalledWith(
      2,
      "run-old",
      expect.objectContaining({ deliveryId: deliveries[1], prompt: "Second follow-up" })
    );
  });
});
