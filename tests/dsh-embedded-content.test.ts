import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
// @ts-expect-error Runtime patch is JavaScript.
import { embedBeesContent } from "../scripts/embed-dsh-content.mjs";
// @ts-expect-error Client modules are JavaScript.
import { configureRuntime } from "../dsh-runtime/plugin/client/runtime.js";
// @ts-expect-error Client modules are JavaScript.
import { NativeContentHost, NativeConversation, nativeEmbedding } from "../dsh-runtime/plugin/client/native-conversation.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
// Return portal content directly so server rendering can exercise destination selection.
const destinations: unknown[] = [];
configureRuntime((id: string) => id === "react" ? React : id === "react-dom" ? {
  createPortal: (content: unknown, target: unknown) => { destinations.push(target); return content; }
} : {});
afterEach(() => { nativeEmbedding.update({ target: null, debug: false }); destinations.length = 0; });

it("keeps native conversation and resource content in Bees, with an explicit debug escape", () => {
  const target = { main: {}, rightbar: {} };
  nativeEmbedding.update({ target });
  const render = (kind: string) => renderToStaticMarkup(React.createElement(NativeContentHost, {
    content: React.createElement("p", null, "Native content"), kind, width: 360
  }));
  expect(render("main")).toContain("bees-embedded-main");
  expect(render("rightbar")).toContain("bees-embedded-rightbar");
  expect(destinations).toEqual([target.main, target.rightbar]);
  nativeEmbedding.update({ debug: true });
  expect(render("main")).toBe("<p>Native content</p>");
  expect(destinations).toHaveLength(2);
  nativeEmbedding.update({ debug: false, target: null });
  expect(render("main")).toBe("<p>Native content</p>");
});

it("patches the pinned frame idempotently and rejects an incompatible upgrade", () => {
  const source = readFileSync(new URL("../dsh-runtime/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js", import.meta.url), "utf8");
  const patched = embedBeesContent(source);
  expect(patched).toContain('renderOwnedSlot("shell.content"');
  expect(patched).toContain('"shell.content": { kind: "keyed", scope: "root" }');
  expect(embedBeesContent(patched)).toBe(patched);
  expect(() => embedBeesContent("incompatible frame")).toThrow("no longer matches");
});

it.each(["ready", "queued", "unmounted"])("opens only a listed run and follows session availability (%s)", async (state) => {
  let effect: () => () => void;
  configureRuntime((id: string) => id === "react" ? {
    ...React, useEffect: (callback: typeof effect) => { effect = callback; }
  } : {});
  let release!: () => void;
  const refreshed = new Promise<void>(resolve => { release = resolve; });
  const refresh = vi.fn(() => refreshed);
  let snapshot: { byId: Record<string, object>; current?: string } = {
    byId: state === "ready" ? { "run-session": {} } : {}, current: "previous-run"
  };
  let notify!: () => void;
  const open = vi.fn((id: string) => {
    if (!snapshot.byId[id]) throw new Error(`sessions.select: unknown session ${id}`);
    snapshot.current = id;
    notify(); // DSH publishes selection synchronously.
  });
  const unsubscribe = vi.fn();
  let cleanup: (() => void) | undefined;
  try {
    renderToStaticMarkup(React.createElement(NativeConversation, {
      ctx: { uiWorkspace: {}, sessions: { refresh, open, list: {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => { notify = listener; return unsubscribe; }
      } } },
      run: { sessionId: "run-session", status: "running" }
    }));
    cleanup = effect!();
    expect(open).not.toHaveBeenCalled();
    if (state === "unmounted") { cleanup(); cleanup = undefined; }
    release();
    await refreshed;
    if (state !== "ready") {
      expect(open).not.toHaveBeenCalled();
      expect(nativeEmbedding.getSnapshot().target).toBeNull();
      notify(); // An unrelated update must neither select the old run nor refresh again.
      expect(refresh).toHaveBeenCalledOnce();
      snapshot.byId["run-session"] = {};
      notify();
    }
    if (state === "unmounted") {
      expect(open).not.toHaveBeenCalled();
      return;
    }
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("run-session"));
    expect(open).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(nativeEmbedding.getSnapshot().target).not.toBeNull();
    snapshot = { byId: {} }; // Writer release temporarily removes the selected session.
    notify();
    await refreshed;
    expect(nativeEmbedding.getSnapshot().target).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(2);
    snapshot.byId["run-session"] = {};
    notify();
    expect(open).toHaveBeenCalledTimes(2);
    expect(nativeEmbedding.getSnapshot().target).not.toBeNull();
  } finally {
    cleanup?.();
    configureRuntime((id: string) => id === "react" ? React : id === "react-dom" ? {
      createPortal: (content: unknown, target: unknown) => { destinations.push(target); return content; }
    } : {});
  }
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(nativeEmbedding.getSnapshot().target).toBeNull();
});
