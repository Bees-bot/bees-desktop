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
  it("folds finished tasks into the Done group and leaves live ones in the list", () => {
    const nav = navFor([
      { id: "live", title: "Live task", isTerminal: false, open: 1 },
      { id: "finished", title: "Finished task", isTerminal: true, open: 0 },
      // Terminal status but its subtree is still working: stays visible, or the open work hides.
      { id: "wrapping-up", title: "Wrapping up", isTerminal: true, open: 2 }
    ]);
    const [live, done] = nav.split("<details>");

    expect(live).toContain("Live task");
    expect(live).toContain("Wrapping up");
    expect(live).not.toContain("Finished task");
    expect(done).toContain("Finished task");
    expect(done).toContain('data-action="archive-done"');
  });

  it("shows no Done group when nothing has finished", () => {
    expect(navFor([{ id: "live", title: "Live task", isTerminal: false, open: 1 }]))
      .not.toContain("archive-done");
  });
});
