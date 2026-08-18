import { describe, expect, it } from "vitest";
import {
  activeExecutionsInItemTree,
  defaultBoardFilters,
  formatBoardFilters,
  isFiltered,
  itemTree,
  parseBoardFilters,
  rootItemId,
  type WorkItem
} from "../src/domain.js";
import { LocalRepository } from "../src/repository.js";
import { NodeDatabase } from "./node-database.js";

const item = (
  condition: "ready" | "terminal" | "archived",
  updatedAt: string
): WorkItem =>
  ({
    isTerminal: condition === "terminal",
    archivedAt: condition === "archived" ? updatedAt : null,
    waits: [],
    updatedAt
  }) as unknown as WorkItem;

describe("dashboard filters", () => {
  it("hides a status only once it is older than its rule", () => {
    const now = Date.parse("2026-07-29T12:00:00.000Z");
    const fresh = item("terminal", "2026-07-29T11:00:00.000Z");
    const stale = item("terminal", "2026-07-27T11:00:00.000Z");

    expect(isFiltered(fresh, defaultBoardFilters, now)).toBe(false);
    expect(isFiltered(stale, defaultBoardFilters, now)).toBe(true);
    // 0 hours hides every archived item, however recent.
    expect(isFiltered(item("archived", "2026-07-29T12:00:00.000Z"), defaultBoardFilters, now)).toBe(
      true
    );
    expect(isFiltered(item("ready", "2020-01-01T00:00:00.000Z"), defaultBoardFilters, now)).toBe(
      false
    );
  });

  it("round-trips the edited text and rejects nonsense", () => {
    expect(formatBoardFilters(defaultBoardFilters)).toBe("Done 24\nArchived 0");
    expect(parseBoardFilters(" Done 24 \n\nArchived 0\n")).toEqual(defaultBoardFilters);
    // Filters saved before the rename still parse.
    expect(parseBoardFilters("terminal 24\narchived 0")).toEqual(defaultBoardFilters);
    expect(parseBoardFilters("Done 0\nARCHIVED 0")).toEqual([
      { condition: "terminal", hours: 0 },
      { condition: "archived", hours: 0 }
    ]);
    expect(() => parseBoardFilters("finished 24")).toThrow(/not a condition/);
    expect(() => parseBoardFilters("terminal -1")).toThrow(/hours/);
  });

  it("stores filters per dashboard and defaults the ones never configured", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const board = (await repository.listBoards(local.teamId))[0]!;
    expect(board.filters).toEqual(defaultBoardFilters);

    await repository.updateBoard(board.id, local.teamId, {
      name: board.name,
      processId: board.processId,
      stageIds: board.stageIds,
      filters: [{ condition: "terminal", hours: 1 }]
    });
    expect((await repository.listBoards(local.teamId))[0]!.filters).toEqual([
      { condition: "terminal", hours: 1 }
    ]);
  });
});

describe("task trees", () => {
  const node = (id: string, parentId: string | null) => ({ id, parentId });

  it("collects a root and every descendant, and survives a parent cycle", () => {
    const all = [
      node("root", null),
      node("child", "root"),
      node("grandchild", "child"),
      node("other-root", null),
      node("other-child", "other-root")
    ];
    expect(itemTree(all, "root").map(({ id }) => id)).toEqual(["root", "child", "grandchild"]);
    expect(itemTree(all, "missing")).toEqual([]);
    expect(itemTree([node("a", "b"), node("b", "a")], "a").map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("climbs to the root a subtask belongs to", () => {
    const all = [node("root", null), node("child", "root"), node("grandchild", "child")];
    expect(rootItemId(all, "grandchild")).toBe("root");
    expect(rootItemId(all, "root")).toBe("root");
    // An orphan (parent archived away) and a cycle both have to terminate, not hang.
    expect(rootItemId([node("orphan", "gone")], "orphan")).toBe("orphan");
    expect(rootItemId([node("a", "b"), node("b", "a")], "a")).toBe("a");
  });

  it("scopes active executions to one workflow run", () => {
    const items = [node("root", null), node("child", "root"), node("other", null)];
    const executions = [
      { id: "root-run", workItemId: "root", status: "running" as const },
      { id: "child-run", workItemId: "child", status: "queued" as const },
      { id: "settled", workItemId: "root", status: "completed" as const },
      { id: "other-run", workItemId: "other", status: "running" as const }
    ];

    expect(activeExecutionsInItemTree(items, executions, "root").map(({ id }) => id))
      .toEqual(["root-run", "child-run"]);
  });
});
