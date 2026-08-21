import { describe, expect, it } from "vitest";
import { createMainViews } from "./app-views.js";
import type { MainHost } from "./main.js";

describe("task board", () => {
  it("shows Run when its process is stopped", async () => {
    let html = "";
    const process = {
      id: "process-1",
      name: "Delivery",
      stages: [],
      definition: { automation: "automatic" }
    };
    const item = {
      id: "task-1",
      title: "Ship",
      parentId: null,
      waits: [],
      archivedAt: null,
      isTerminal: false,
      updatedAt: "2026-08-18T00:00:00.000Z"
    };
    const host = {
      session: { currentTeam: () => ({ name: "Team" }) },
      shell: {
        view: "board",
        boardRootItemId: item.id,
        boardItemId: "",
        setHeader: () => undefined,
        swap: (value: string) => { html = value; },
        escapeHtml: (value: string) => value
      },
      workspaceController: {
        activeBoard: { id: "board-1", name: "Board", stageIds: [], filters: [] },
        activeProcess: process,
        processes: [process],
        items: [item],
        teamItems: [item],
        openWork: () => []
      },
      runs: {
        runningProcesses: new Set(),
        executions: [],
        supervise: () => new Map()
      }
    } as unknown as MainHost;

    await createMainViews(host).renderBoard();

    expect(html).toContain('data-action="start-process"');
  });

  it("does not show archived runs on the unscoped process board", async () => {
    let html = "";
    const process = {
      id: "goals",
      name: "Goals",
      stages: [{ id: "plan", name: "Plan" }],
      definition: { automation: "automatic" }
    };
    const active = {
      id: "active",
      processId: process.id,
      stageId: "plan",
      title: "Current goal",
      parentId: null,
      waits: [],
      logicalFiles: [],
      archivedAt: null,
      isTerminal: false,
      updatedAt: "2026-08-20T00:00:00.000Z"
    };
    const archived = {
      ...active,
      id: "archived",
      title: "Archived goal",
      archivedAt: "2026-08-19T00:00:00.000Z"
    };
    const host = {
      session: { currentTeam: () => ({ name: "Team" }) },
      shell: {
        view: "board",
        boardRootItemId: "",
        boardItemId: "",
        setHeader: () => undefined,
        swap: (value: string) => { html = value; },
        escapeHtml: (value: string) => value
      },
      workspaceController: {
        activeBoard: { id: "board", name: "Goals", stageIds: ["plan"], filters: [] },
        activeProcess: process,
        processes: [process],
        items: [active, archived],
        teamItems: [active, archived],
        agents: [],
        openWork: (items: typeof active[]) => items.filter(({ archivedAt }) => !archivedAt)
      },
      runs: {
        runningProcesses: new Set([process.id]),
        executions: [],
        supervise: () => new Map()
      }
    } as unknown as MainHost;

    await createMainViews(host).renderBoard();

    expect(html).toContain("Current goal");
    expect(html).not.toContain("Archived goal");
  });
});

describe("settings", () => {
  it("defaults the workspace settings picker to the current workspace", async () => {
    let html = "";
    const host = {
      session: {
        currentOrganization: () => ({ id: "workspace-2", name: "Second" }),
        currentTeam: () => null
      },
      shell: {
        view: "settings",
        settingsTab: "theme",
        themePreset: "bees",
        darkDefaultTheme: "bees-dark",
        lightDefaultTheme: "bees",
        themePresets: [],
        setHeader: () => undefined,
        swap: (value: string) => { html = value; },
        escapeHtml: (value: string) => value,
        activeClass: () => ""
      },
      workspaceController: {
        organizations: [
          { id: "workspace-1", name: "First" },
          { id: "workspace-2", name: "Second" }
        ],
        workspace: { organizationId: "workspace-2" }
      }
    } as unknown as MainHost;

    await createMainViews(host).renderSettings();

    expect(html).toContain('data-settings-workspace');
    expect(html).toContain('<option value="workspace-2" selected>Second</option>');
  });
});

describe("process library", () => {
  it("opens an installed library process for editing without making a copy", () => {
    let html = "";
    const host = {
      session: { currentTeam: () => ({ name: "Team" }) },
      shell: {
        setHeader: () => undefined,
        swap: (value: string) => { html = value; },
        escapeHtml: (value: string) => value
      },
      workspaceController: {
        processes: [{ id: "goals-process", definition: { moduleId: "goals" } }],
        agents: []
      },
      assistant: {
        assistantModel: { provider: "openai-codex", model: "gpt-5.6-sol" },
        assistantCatalog: [],
        machineModelAvailability: {
          localModelIds: [],
          connectedProviders: ["openai-codex"],
          cliProviders: []
        }
      }
    } as unknown as MainHost;

    createMainViews(host).renderProcessLibrary();

    expect(html).toContain('data-action="edit-process" data-id="goals-process">Edit team process</button>');
    expect(html).toContain("Create another copy");
  });
});
