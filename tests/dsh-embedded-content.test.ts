import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, expect, it } from "vitest";
// @ts-expect-error Runtime patch is JavaScript.
import { embedBeesContent } from "../scripts/embed-dsh-content.mjs";
// @ts-expect-error Client modules are JavaScript.
import { configureRuntime } from "../dsh-runtime/plugin/client/runtime.js";
// @ts-expect-error Client modules are JavaScript.
import { NativeContentHost, nativeEmbedding } from "../dsh-runtime/plugin/client/native-conversation.js";

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
