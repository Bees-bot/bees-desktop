import { describe, expect, it } from "vitest";
import { RESTORABLE_VIEWS, startupView } from "./views.js";

describe("startupView", () => {
  it("opens a first launch on Getting Started", () => {
    expect(startupView("")).toBe("getting-started");
  });

  it("reopens the last restorable view", () => {
    for (const view of RESTORABLE_VIEWS) expect(startupView(view)).toBe(view);
  });

  it("falls back to the overview for a view a later build no longer has", () => {
    expect(startupView("some-retired-view")).toBe("overview");
  });

  it("never restores a view that needs an id held only in memory", () => {
    for (const view of ["item", "item-new", "run", "process", "process-runs", "schedules"]) {
      expect(RESTORABLE_VIEWS.has(view as never)).toBe(false);
    }
  });
});
