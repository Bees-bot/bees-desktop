import { expect, it, vi } from "vitest";
// @ts-expect-error The DSH browser client is intentionally plain JavaScript.
import { installScrollbars } from "../dsh-runtime/plugin/client/scrollbars.js";

it("reveals only scrolling elements, extends activity, and cleans up on disposal", () => {
  vi.useFakeTimers();
  const element = () => ({ setAttribute: vi.fn(), removeAttribute: vi.fn() });
  const page = element();
  const panel = element();
  const doc = Object.assign(new EventTarget(), { scrollingElement: page });
  const scroll = (target: unknown) => {
    const event = new Event("scroll");
    Object.defineProperty(event, "target", { value: target });
    doc.dispatchEvent(event);
  };
  const dispose = installScrollbars(doc);
  try {
    scroll(panel);
    expect(panel.setAttribute).toHaveBeenCalledWith("data-bees-scrolling", "");
    expect(page.setAttribute).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    scroll(panel);
    scroll(doc);
    vi.advanceTimersByTime(500);
    expect(panel.removeAttribute).not.toHaveBeenCalled();
    expect(page.setAttribute).toHaveBeenCalledWith("data-bees-scrolling", "");
    vi.advanceTimersByTime(300);
    expect(panel.removeAttribute).toHaveBeenCalledWith("data-bees-scrolling");
    expect(page.removeAttribute).toHaveBeenCalledWith("data-bees-scrolling");
    scroll(panel);
    dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(panel.removeAttribute).toHaveBeenCalledTimes(2);
    panel.setAttribute.mockClear();
    scroll(panel);
    expect(panel.setAttribute).not.toHaveBeenCalled();
  } finally {
    dispose();
    vi.useRealTimers();
  }
});
