import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Script } from "node:vm";
import { embedBeesContent } from "../scripts/embed-dsh-content.mjs";

const source = readFileSync(new URL("../dsh-runtime/plugin/client/work.js", import.meta.url), "utf8");
const render = new Script(source.slice(source.indexOf("  const isWorking ="), source.indexOf("  const controls =")) + "conversation");

/** Depth-first search through the stubbed `h(component, props, ...children)` tree. */
function findComponent(node, component) {
  if (!node) return undefined;
  if (node.component === component) return node;
  for (const child of node.children ?? []) {
    const found = findComponent(child, component);
    if (found) return found;
  }
  return undefined;
}

test("native layout slots reach the Bees conversation and file destinations", () => {
  for (const legacy of [false, true]) {
    const signature = legacy
      ? "function AppFrame({ useStore, useSessions, actions, renderSlot, SessionProvider, t }) {"
      : "function AppFrame({ useStore, useSessions, usePanelInfo, actions, renderSlot, t }) {";
    const keys = legacy ? ["conversation", "details"] : ["main", "rightbar"];
    const patched = embedBeesContent(`${signature}
      const cols = { details: 360 };
      return ${JSON.stringify(keys)}.map(key => renderSlot(key, { width: 360 }));
    }
    const slots = { "shell.overlay": {
    } };
    AppFrame;`);
    const frame = new Script(patched).runInNewContext();
    const content = { messages: ["Run-specific message"] };
    const results = frame({ renderSlot: (key, owner, options) =>
      key === "shell.content" ? { owner, options } : content });
    assert.deepEqual(Array.from(results, result => result.options.entryKey), ["main", "rightbar"]);
    for (const result of results) {
      assert.equal(result.owner.content, content);
      assert.equal(result.options.fallback, content);
      assert.equal(result.owner.width, 360);
    }
    assert.equal(embedBeesContent(patched), patched);
  }
});

test("conversation history and composer follow the selected run, independent of a pending interaction", async () => {
  const run = { id: "selected-execution", sessionId: "selected-session" };
  for (const status of [null, "waiting_for_input", "waiting_for_approval"]) {
    const pendingRun = status ? { id: "pending-execution", sessionId: "pending-session", status } : undefined;
    let submitted;
    const tree = render.runInNewContext({
      h: (component, props, ...children) => ({ component, props, children }),
      GoalMessage: "goal", UserMessage: "user", AgentInteractionPanel: "interaction", ProposalCard: "proposal",
      conversationMessages: () => [], useEffect: () => {}, setTimeout: () => {},
      ctx: {}, run, pendingRun, item: { runtimePhase: "completed" }, session: {}, interaction: {},
      handled: new Set(), answered() {}, act: (payload) => { submitted = payload; return Promise.resolve(true); },
      data: { runs: [] }, plan: false, subitems: [], assignments: [], history: null, historyError: "",
      sending: false, composerText: "Keep going", sendError: "", activeBinding: null,
      convoRef: { current: null }, isScrolledUpRef: { current: false },
      setSending() {}, setSendError() {}, setComposerText() {}, setRefreshCount() {}
    });
    // The Bees-native panel is always mounted here (DSH's own screens live in the Details tabs now).
    assert.equal(tree.component, "div", `Conversation panel must remain mounted with status ${status}`);
    assert.equal(tree.props.className, "bees-convo-panel");
    const card = findComponent(tree, "interaction");
    assert.equal(card?.props.run, pendingRun, "Keep the existing pending interaction available");

    const form = tree.children.find(child => child?.component === "form");
    await form.props.onSubmit({ preventDefault() {} });
    assert.equal(submitted?.action, "continue_run");
    assert.equal(submitted?.executionId, run.id, "Send composer text to the selected execution, not a pending one");
  }
});
