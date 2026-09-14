import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Script } from "node:vm";
import { embedBeesContent } from "../scripts/embed-dsh-content.mjs";

const source = readFileSync(new URL("../dsh-runtime/plugin/client/work.js", import.meta.url), "utf8");
const render = new Script(source.slice(source.indexOf("  const conversation ="), source.indexOf("  const controls =")) + "conversation");

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

test("run details retain the selected conversation while input or approval is pending", () => {
  const run = { id: "selected-execution", sessionId: "selected-session" };
  for (const status of [null, "waiting_for_input", "waiting_for_approval"]) {
    const pendingRun = status ? { id: "pending-execution", sessionId: "pending-session", status } : undefined;
    const tree = render.runInNewContext({
      h: (component, props, ...children) => ({ component, props, children }),
      NativeConversation: "conversation", AgentInteractionPanel: "interaction",
      ctx: {}, run, pendingRun, item: {}, session: {}, interaction: {},
      handled: new Set(), answered() {}, act() {}, data: {}
    });
    const conversation = tree.children.find(child => child?.component === "conversation");
    assert.ok(conversation, `Conversation must remain mounted with status ${status}`);
    assert.equal(conversation.props.run, run, "Use the selected execution, not another pending execution");
    const card = tree.children.find(child => child?.component === "interaction");
    assert.equal(card?.props.run, pendingRun, "Keep the existing pending interaction available");
  }
});
