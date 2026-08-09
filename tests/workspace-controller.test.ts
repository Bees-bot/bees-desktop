import { describe, expect, it } from "vitest";
import type { Agent } from "../src/domain.js";
import type { MainHost } from "../src/main.js";
import { softwareProjectProcess } from "../src/processes/software-project/definition.js";
import { LocalRepository } from "../src/repository.js";
import { createWorkspaceController } from "../src/workspace-controller.js";
import { NodeDatabase } from "./node-database.js";

describe("workspace controller", () => {
  it("hydrates local agents from a synchronized bundled process exactly once", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const workspace = await repository.bootstrap();
    const processId = await repository.createProcess(workspace.teamId, {
      name: "Code",
      template: softwareProjectProcess.definition
    });
    const process = (await repository.listProcesses(workspace.teamId)).find(
      ({ id }) => id === processId
    )!;
    const settings = new Map<string, unknown>();
    const saved: Agent[] = [];
    const host = {
      repository: {
        getResolvedTeamFolder: async () => ({ localPath: "/shared/team", missing: false, override: false }),
        getSetting: async <T>(key: string, fallback: T) =>
          settings.has(key) ? settings.get(key) as T : fallback,
        setSetting: async (key: string, value: unknown) => { settings.set(key, value); }
      },
      workspaces: { ensureDirectory: async () => undefined },
      agentFiles: {
        save: async (_teamRoot: string, agent: Agent) => {
          saved.push(agent);
          return agent;
        }
      },
      runs: {
        RUNNING_PROCESSES_KEY: "running_processes",
        runningProcesses: new Set<string>(),
        autopilot: async () => undefined
      },
      views: { renderNavigation: () => undefined },
      shell: { activeItemId: "", render: () => undefined, showNotice: () => undefined },
      actions: { edit: async () => null }
    } as unknown as MainHost;
    const controller = createWorkspaceController(host);
    controller.workspace = workspace;
    controller.processes = [process];
    controller.agents = [];
    controller.registries = [];

    await controller.seedInstalledWorkflows();

    expect(saved).toHaveLength(softwareProjectProcess.definition.agents.length);
    for (const definition of softwareProjectProcess.definition.agents) {
      expect(saved).toContainEqual(expect.objectContaining({
        triggerStageId: process.definition.stateIds[definition.state],
        config: expect.objectContaining({ role: definition.role })
      }));
    }

    await controller.seedInstalledWorkflows();
    expect(saved).toHaveLength(softwareProjectProcess.definition.agents.length);
  });
});
