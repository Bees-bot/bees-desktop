import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_TOUR, parseTour, parseTourTarget, placeTip } from "../src/tour.js";

const agentSource = readFileSync(
  fileURLToPath(new URL("../flue-runtime/project/.flue/agents/bees-assistant.ts", import.meta.url)),
  "utf8"
);

describe("authoring a wizard", () => {
  it("splits on ## headings and keeps the body as Markdown", () => {
    const steps = parseTour(`# Title

Preamble that belongs to no step.

## First
Do the thing.

- a bullet

## Second
Then this.`);
    expect(steps.map(({ title }) => title)).toEqual(["First", "Second"]);
    expect(steps[0]!.body).toBe("Do the thing.\n\n- a bullet");
    expect(steps[1]!.body).toBe("Then this.");
  });

  it("lifts the Target line out of the body instead of showing it", () => {
    const [step] = parseTour("## Open Preferences\nOpen it now.\nTarget: the Preferences gear\n");
    expect(step!.target).toBe("the Preferences gear");
    expect(step!.body).toBe("Open it now.");
  });

  it("leaves the target empty when the author names none", () => {
    expect(parseTour("## Welcome\nHello.")[0]!.target).toBe("");
  });

  it("returns nothing for Markdown with no step headings", () => {
    expect(parseTour("# Only a title\n\nSome prose.")).toEqual([]);
  });

  it("parses the wizard that ships with the app", () => {
    const steps = parseTour(DEFAULT_TOUR);
    expect(steps.length).toBeGreaterThan(3);
    expect(steps.every(({ title, body }) => title && body)).toBe(true);
  });
});

describe("reading the model's answer", () => {
  it("finds the ref through a fence and surrounding prose", () => {
    expect(parseTourTarget('Sure:\n```json\n{"target":{"ref":"u12"}}\n```\n')).toBe("u12");
  });

  it("treats a null target as pointing at nothing", () => {
    expect(parseTourTarget('{"target":null}')).toBe("");
  });

  it("treats unparseable output as pointing at nothing rather than failing", () => {
    expect(parseTourTarget("I am not sure which button you mean.")).toBe("");
  });

  it("keeps the tour reply format in step with the agent instructions", () => {
    expect(agentSource).toContain('{"target":{"ref":"u1"}}');
    expect(agentSource).toContain("Bees guided tour");
  });
});

describe("placing the tooltip", () => {
  const tip = { width: 320, height: 200 };
  const view = { width: 1400, height: 900 };

  it("sits to the right of a sidebar control", () => {
    const at = placeTip({ top: 100, left: 20, width: 200, height: 32 }, tip, view);
    expect(at.side).toBe("right");
    expect(at.left).toBe(234);
    // Vertically centred on the control.
    expect(at.top).toBe(16);
  });

  it("flips to the left when the right edge has no room", () => {
    const at = placeTip({ top: 400, left: 1200, width: 160, height: 32 }, tip, view);
    expect(at.side).toBe("left");
    expect(at.left).toBe(1200 - 14 - 320);
  });

  it("goes below when neither side fits", () => {
    const at = placeTip({ top: 40, left: 0, width: 1400, height: 48 }, tip, view);
    expect(at.side).toBe("bottom");
    expect(at.top).toBe(102);
  });

  it("goes above when neither side fits and there is no room below", () => {
    const at = placeTip({ top: 700, left: 0, width: 1400, height: 48 }, tip, view);
    expect(at.side).toBe("top");
    expect(at.top).toBe(700 - 14 - 200);
  });

  it("never leaves the viewport, even against a corner", () => {
    for (const target of [
      { top: 0, left: 0, width: 24, height: 24 },
      { top: 876, left: 1376, width: 24, height: 24 },
      { top: -50, left: 1390, width: 24, height: 24 }
    ]) {
      const at = placeTip(target, tip, view);
      expect(at.left).toBeGreaterThanOrEqual(0);
      expect(at.left + tip.width).toBeLessThanOrEqual(view.width);
    }
  });

  it("points the arrow at the control's centre, but not past the card's corners", () => {
    const centred = placeTip({ top: 400, left: 20, width: 200, height: 40 }, tip, view);
    expect(centred.arrow).toBe(100);
    // A control taller than the tooltip would otherwise put the arrow off the end of it.
    const tall = placeTip({ top: 0, left: 20, width: 200, height: 880 }, tip, view);
    expect(tall.arrow).toBeGreaterThanOrEqual(14);
    expect(tall.arrow).toBeLessThanOrEqual(tip.height - 14);
  });
});
