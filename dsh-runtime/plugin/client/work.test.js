import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: 'export { WorkItemDetails } from "./work.js"; export { SharedWorkContext, WorkDiscussion, ProcessMemoryPanel } from "./collaboration.js"; export { configureRuntime, NativeUi } from "./runtime.js";',
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
    const ctx = {
      uiSession: { sessionStatus: { getSnapshot: () => new Map([["session", { pendingInteraction: interaction }]]) } },
      configForms: { get: () => ({ getSnapshot: () => ({ status: "ready", value: {} }) }) }
    };
    const data = { items: [item, ...(delegated ? [{ id: "child", title: "Helper", parentId: item.id }] : [])],
      runs: [run], processes: [{ id: "process", workspaceId: "workspace" }], stages: [], assignments: [],
      workspaces: [{ id: "workspace" }], attachments: [], locations: [], proposals: [],
      teamQuestions: [{ id: "team-q", workItemId: item.id, question: "Team clarification", askedAt: "2026-09-28" }] };
    const html = renderToStaticMarkup(createElement(bundle.exports.NativeUi.Provider, { value: { ctx } },
      createElement(WorkItemDetails, { ctx, data, item, preference: {}, preferences: {}, capabilities: {}, layout: [{ kind: "conversation", x: 0, y: 0, w: 12, h: 9 }, { kind: "details", x: 0, y: 9, w: 12, h: 9 }] })));
    const goal = html.indexOf("Original goal");
    const teamQuestion = html.indexOf("Team clarification");
    const card = html.indexOf("bees-box bees-answer-card");
    const composer = html.indexOf("bees-composer bees-compact-composer");
    assert(goal >= 0 && goal < teamQuestion && teamQuestion < card && card < composer, `${kind}, delegated=${delegated}`);
    assert(!html.includes("Show agent steps"));
    assert.match(html, /id="bees-tab-memory"/);
    assert(html.includes(kind === "approval" ? "Approve once" : kind === "work-review" ? "Approve" : "Send answer"));
    if (kind === "question") assert.match(html, /rows="3" aria-label="Your answer"/);
  }
});

test("context and discussion present the saved content in readable sections with technical records collapsed", () => {
  const react = require("react");
  const render = (Component, view) => {
    configureRuntime((name) => name === "react" ? { ...react, useState: (initial) => react.useState(initial === null ? view : initial) }
      : name === "react-dom" ? require(name)
        : name === "@deepseek-ai/dsh-client-ui-primitives" ? { MarkdownText: ({ text }) => createElement("p", { "data-markdown": true }, text) } : {});
    return renderToStaticMarkup(createElement(Component, { item: { id: "goal", title: "Prepare launch" }, onOpenWork() {} }));
  };
  const participants = [{ id: "goal", title: "Prepare launch", status: "running" }, { id: "child-id", title: "Write announcement", status: "completed" }];
  const context = { version: 2, content: {
    goal: { title: "Prepare launch", requirements: "Use the supplied brief" },
    process: { name: "Launch process", requirements: "Review before publishing" },
    system: { requirements: "Protect private information" }, references: "The product brief",
    recurringGuidance: [{ id: "guidance", name: "Writer playbook", playbook: "Follow the brand voice" }],
    processMemory: [{ id: "memory", content: "Owner prefers plain language" }]
  }, scope: { stage: "Write", assignments: [{ id: "child-id", title: "Write announcement", requirements: "Create the first draft" }],
    producerInstructions: "Save a Markdown file", reviewFeedback: "Use a shorter headline" }, memories: [{ text: "Past launches needed a clear call to action" }] };
  const reviews = [{ id: "old", workItemId: "child-id", approved: 0, feedback: "Fix the spelling", createdAt: "2026-09-28" },
    { id: "approved", workItemId: "child-id", approved: 1, summary: "Spelling corrected", createdAt: "2026-09-29" },
    { id: "current", workItemId: "goal", approved: 0, feedback: "Include the release date", createdAt: "2026-09-29" }];
  try {
    const html = render(bundle.exports.SharedWorkContext, { context, participants, humanReview: { entries: reviews, requiredCorrections: [reviews[2]] } });
    for (const text of ["What guides this work", "Original goal", "Use the supplied brief", "Stage: Write", "Create the first draft", "Save a Markdown file", "Use a shorter headline", "Review before publishing", "Protect private information", "The product brief", "Follow the brand voice", "Past launches needed a clear call to action", "Include the release date", "Approved", "Addressed"])
      assert(html.includes(text), `Missing context: ${text}`);
    assert.match(html, /<details class="bees-context-section bees-context-technical"><summary>Technical details<\/summary>/);
    assert.match(html, /data-markdown="true"/);
    assert(html.includes("Process memory used in this run (1)") && html.includes("Owner prefers plain language"));
    const shared = render(bundle.exports.SharedWorkContext, { runContext: { ...context, scope: undefined }, participants });
    assert(shared.includes("Use the supplied brief") && !shared.includes("This agent’s assignment"));
    assert(render(bundle.exports.SharedWorkContext, {}).includes("No saved instructions yet"));
    assert(render(bundle.exports.SharedWorkContext, null).includes("Loading work context"));

    const discussion = render(bundle.exports.WorkDiscussion, { rootId: "goal", participants, hasMore: true, updates: [
      { id: "first", author: "Writer", kind: "finding", workItemId: "child-id", targetId: "goal", content: "The brief confirms the date", evidence: "Page 2 of the brief", executionId: "opaque-run-id", createdAt: "2026-09-28" },
      { id: "second", author: "Owner", kind: "decision", workItemId: "goal", content: "Use the confirmed date", createdAt: "2026-09-29" }
    ] });
    for (const text of ["Team discussion", "Working", "Finished", "Finding", "Decision", "To Prepare launch", "To everyone", "Page 2 of the brief", "View task &amp; files: Write announcement", "Load earlier messages"])
      assert(discussion.includes(text), `Missing discussion: ${text}`);
    assert(discussion.indexOf("The brief confirms the date") < discussion.indexOf("Use the confirmed date"));
    assert.match(discussion, /<details class="bees-discussion-technical"><summary>Message details<\/summary><p>Execution: opaque-run-id/);
    assert(!discussion.includes("Writer / finding") && !discussion.includes("child-id"));
    assert(render(bundle.exports.WorkDiscussion, { participants: [], updates: [] }).includes("No messages yet"));
  } finally {
    configureRuntime((name) => ["react", "react-dom"].includes(name) ? require(name)
      : name === "@deepseek-ai/dsh-client-ui-primitives" ? { MarkdownText: ({ text }) => text } : {});
  }
});

test("process memory presents saved entries with provenance and owner controls without add-on configuration", () => {
  const react = require("react");
  const entries = [
    { id: "answer", kind: "response", content: "Use plain language", sourceId: "original", sourceContent: "Can you keep it simple?", author: "Owner", sourceTitle: "Launch brief", workItemId: "task", active: true, createdAt: "2026-09-29" },
    { id: "feedback", kind: "feedback", content: "Include the release date", active: false, createdAt: "2026-09-29" }
  ];
  const render = (view) => {
    configureRuntime((name) => name === "react" ? { ...react, useState: (initial) => react.useState(initial === null ? view : initial) }
      : name === "react-dom" ? require(name) : name === "@deepseek-ai/dsh-client-ui-primitives" ? { MarkdownText: ({ text }) => createElement("p", null, text) } : {});
    return renderToStaticMarkup(createElement(bundle.exports.ProcessMemoryPanel, { process: { id: "process", name: "Launch" }, act: async () => view, onOpenWork() {} }));
  };
  try {
    const owner = render({ canManage: true, entries, hasMore: true });
    for (const text of ["Launch memory", "User response", "Review feedback", "Used in future runs", "Saved for review", "Original source", "Can you keep it simple?", "Owner · Launch brief", "View source task", "Search saved memory", "Add memory", "Stop using in future runs", "Use in future runs", "Edit", "Forget", "Load older memories", "Stored in Bees on this device"])
      assert(owner.includes(text), `Missing memory UI: ${text}`);
    assert(!owner.includes("Memory add-ons") && !owner.includes("add-on picker"));
    const viewer = render({ canManage: false, entries });
    assert(viewer.includes("Only the process owner") && viewer.includes("Use plain language"));
    for (const control of ["Add memory", "Stop using in future runs", ">Edit<", ">Forget<", "Memory add-ons"]) assert(!viewer.includes(control));
    assert(render({ canManage: true, entries: [] }).includes("No saved memory yet"));
  } finally {
    configureRuntime((name) => ["react", "react-dom"].includes(name) ? require(name)
      : name === "@deepseek-ai/dsh-client-ui-primitives" ? { MarkdownText: ({ text }) => text } : {});
  }
});
