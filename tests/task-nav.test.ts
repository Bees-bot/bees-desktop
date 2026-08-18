import { describe, expect, it } from "vitest";
import { createMainViews } from "../src/app-views.js";
import type { MainHost } from "../src/main.js";

function navFor(roots: Array<{ id: string; title: string; isTerminal: boolean; open: number }>): string {
  const host = {
    shell: {
      view: "overview",
      boardRootItemId: "",
      escapeHtml: (value: string) => String(value ?? ""),
      activeClass: () => ""
    },
    runs: { runningProcesses: new Set<string>() },
    workspaceController: {
      activeBoard: null,
      dashboardsByTeam: new Map([[
        "team",
        [{
          board: { id: "board" },
          process: { id: "process", name: "Process" },
          roots: roots.map(({ id, title, isTerminal, open }) => ({ item: { id, title, isTerminal }, open }))
        }]
      ]])
    }
  } as unknown as MainHost;
  return createMainViews(host).teamTaskNav("team");
}

describe("left menu task rows", () => {
  it("shows one primary task per active run under the label", () => {
    const nav = navFor([
      { id: "live", title: "Live task", isTerminal: false, open: 0 },
      { id: "finished", title: "Finished task", isTerminal: true, open: 0 },
      { id: "wrapping-up", title: "Wrapping up", isTerminal: true, open: 2 }
    ]);

    expect(nav).toContain("Active tasks");
    expect(nav).toContain("Live task");
    expect(nav).not.toContain('title="1 open task"');
    // The primary task has finished, but its run still has open child work.
    expect(nav).toContain("Wrapping up");
    expect(nav).not.toContain("Finished task");
  });

  it("shows an empty running state instead of completed tasks", () => {
    const nav = navFor([{ id: "finished", title: "Finished task", isTerminal: true, open: 0 }]);
    expect(nav).toContain("No active tasks");
    expect(nav).not.toContain("Finished task");
  });
});
