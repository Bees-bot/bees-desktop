import { describe, expect, it } from "vitest";
import {
  defaultBoardFilters,
  formatBoardFilters,
  isFiltered,
  parseBoardFilters,
  type WorkItem
} from "../src/domain.js";
import { LocalRepository } from "../src/repository.js";
import { NodeDatabase } from "./node-database.js";

const item = (status: WorkItem["status"], updatedAt: string): WorkItem =>
  ({ status, updatedAt }) as WorkItem;

describe("dashboard filters", () => {
  it("hides a status only once it is older than its rule", () => {
    const now = Date.parse("2026-07-29T12:00:00.000Z");
    const fresh = item("done", "2026-07-29T11:00:00.000Z");
    const stale = item("done", "2026-07-27T11:00:00.000Z");

    expect(isFiltered(fresh, defaultBoardFilters, now)).toBe(false);
    expect(isFiltered(stale, defaultBoardFilters, now)).toBe(true);
    // 0 hours hides every archived item, however recent.
    expect(isFiltered(item("archived", "2026-07-29T12:00:00.000Z"), defaultBoardFilters, now)).toBe(
      true
    );
    expect(isFiltered(item("open", "2020-01-01T00:00:00.000Z"), defaultBoardFilters, now)).toBe(
      false
    );
  });

  it("round-trips the edited text and rejects nonsense", () => {
    expect(formatBoardFilters(defaultBoardFilters)).toBe("done 24\narchived 0");
    expect(parseBoardFilters(" done 24 \n\narchived 0\n")).toEqual(defaultBoardFilters);
    expect(() => parseBoardFilters("finished 24")).toThrow(/not a status/);
    expect(() => parseBoardFilters("done -1")).toThrow(/hours/);
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
      filters: [{ status: "done", hours: 1 }]
    });
    expect((await repository.listBoards(local.teamId))[0]!.filters).toEqual([
      { status: "done", hours: 1 }
    ]);
  });
});
