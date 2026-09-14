import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
// @ts-expect-error Client runtime is JavaScript.
import { configureRuntime, MarkdownText } from "../dsh-runtime/plugin/client/runtime.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

it("renders Markdown file contents with code fences and footnotes through the native renderer", () => {
  // Bundle the browser renderer with styles omitted for server-rendered regression checks.
  const { outputFiles } = buildSync({
    entryPoints: [fileURLToPath(new URL("../dsh-runtime/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", loader: { ".css": "empty", ".module.css": "empty" }
  });
  const native = { exports: {} };
  new Function("require", "module", "exports", outputFiles[0]!.text)(require, native, native.exports);
  const primitives = native.exports;
  configureRuntime((id: string) => id === "react" ? React
    : id === "@deepseek-ai/dsh-client-ui-primitives" ? primitives : {});
  const text = '# Run report\n\n```json\n{"ok":true}\n```\n\nEvidence[^1]\n\n[^1]: Source note';
  const markup = renderToStaticMarkup(React.createElement(MarkdownText, { text }));
  expect(markup).toContain("Run report");
  expect(markup).toContain("Copy");
  expect(markup).toContain("Source note");
  expect(markup).toContain("Footnotes");
});
