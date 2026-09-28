import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: 'export { WorkItemDetails } from "./work.js"; export { configureRuntime, NativeUi } from "./runtime.js";',
    resolveDir: fileURLToPath(new URL(".", import.meta.url))
  },
  plugins: [{ name: "test-private-component", setup(builder) {
    builder.onLoad({ filter: /\/client\/work\.js$/ }, ({ path }) => ({
      contents: `${readFileSync(path, "utf8")}\nexport { WorkItemDetails };`, loader: "js"
    }));
  } }],
  bundle: true, write: false, format: "cjs", platform: "node",
  external: ["react", "react-dom"], loader: { ".css": "text" }
});
const bundle = { exports: {} };
new Function("require", "module", "exports", outputFiles[0].text)(require, bundle, bundle.exports);
const { WorkItemDetails, configureRuntime } = bundle.exports;
configureRuntime((name) => ["react", "react-dom"].includes(name) ? require(name)
  : name === "@deepseek-ai/dsh-client-ui-primitives" ? { MarkdownText: ({ text }) => text } : {});
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

test("pending questions, approvals and reviews follow history in the conversation, including delegated runs", () => {
  for (const kind of ["question", "approval", "work-review"]) for (const delegated of [false, true]) {
    const item = { id: "goal", title: "Original goal", processId: "process", runtimePhase: "waiting" };
    const run = { id: "run", workItemId: delegated ? "child" : item.id, workspaceId: "workspace", sessionId: "session",
      status: kind === "approval" ? "waiting_for_approval" : "waiting_for_input", pendingInteraction: kind };
    const interaction = { key: "request", kind: kind === "approval" ? kind : "question", toolName: "Write file",
      questions: [{ id: "q", header: "Next step", question: "Please confirm the next step" }] };
    const ctx = { uiSession: { sessionStatus: { getSnapshot: () => new Map([["session", { pendingInteraction: interaction }]]) } } };
    const data = { items: [item, ...(delegated ? [{ id: "child", title: "Helper", parentId: item.id }] : [])],
      runs: [run], processes: [{ id: "process", workspaceId: "workspace" }], stages: [], assignments: [],
      workspaces: [{ id: "workspace" }], attachments: [], locations: [], proposals: [],
      teamQuestions: [{ id: "team-q", workItemId: item.id, question: "Team clarification", askedAt: "2026-09-28" }] };
    const html = renderToStaticMarkup(createElement(bundle.exports.NativeUi.Provider, { value: { ctx } },
      createElement(WorkItemDetails, { ctx, data, item, preference: {}, preferences: {}, capabilities: {}, layout: [{ kind: "conversation", x: 0, y: 0, w: 12, h: 9 }] })));
    const goal = html.indexOf("Original goal");
    const teamQuestion = html.indexOf("Team clarification");
    const card = html.indexOf("bees-box bees-answer-card");
    const composer = html.indexOf("bees-composer bees-compact-composer");
    assert(goal >= 0 && goal < teamQuestion && teamQuestion < card && card < composer, `${kind}, delegated=${delegated}`);
    assert(!html.includes("Show agent steps"));
    assert(html.includes(kind === "approval" ? "Approve once" : kind === "work-review" ? "Approve" : "Send answer"));
    if (kind === "question") assert.match(html, /rows="3" aria-label="Your answer"/);
  }
});
