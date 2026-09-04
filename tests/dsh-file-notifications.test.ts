import { expect, it, vi } from "vitest";
// @ts-expect-error The DSH browser client is intentionally plain JavaScript.
import { generatedFileKeys, watchFilesViewed } from "../dsh-runtime/plugin/client/file-notifications.js";

it("counts new files across runs without counting duplicates or path separator changes", () => {
  const previous = generatedFileKeys([{ id: "one", outputs: ["reports/summary.md"] }]);
  const current = generatedFileKeys([
    { id: "one", outputs: ["reports/summary.md", "reports\\summary.md", "data.csv"] },
    { id: "two", outputs: ["reports/summary.md"] }, { id: "empty" }
  ]);
  expect(current).toHaveLength(3);
  const saved = new Set(JSON.parse(JSON.stringify(previous)));
  expect(current.filter((key: string) => !saved.has(key))).toHaveLength(2);
  expect(generatedFileKeys([])).toEqual([]);
});

it("acknowledges files once when visible in the foreground and releases observers", () => {
  let intersect!: (entries: { isIntersecting: boolean }[]) => void;
  const disconnect = vi.fn();
  const win = Object.assign(new EventTarget(), {
    IntersectionObserver: class {
      constructor(callback: typeof intersect) { intersect = callback; }
      observe() {}
      disconnect = disconnect;
    }
  });
  const doc = Object.assign(new EventTarget(), {
    defaultView: win, visibilityState: "hidden", hasFocus: (): boolean => true
  });
  const viewed = vi.fn();
  const dispose = watchFilesViewed({ ownerDocument: doc }, viewed);
  intersect([{ isIntersecting: true }]);
  expect(viewed).not.toHaveBeenCalled();
  intersect([{ isIntersecting: false }]);
  doc.visibilityState = "visible";
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(viewed).not.toHaveBeenCalled();
  doc.hasFocus = () => false;
  intersect([{ isIntersecting: true }]);
  expect(viewed).not.toHaveBeenCalled();
  doc.hasFocus = () => true;
  win.dispatchEvent(new Event("focus"));
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(viewed).toHaveBeenCalledTimes(1);
  dispose();
  expect(disconnect).toHaveBeenCalledOnce();
});
