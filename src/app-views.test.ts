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
});
