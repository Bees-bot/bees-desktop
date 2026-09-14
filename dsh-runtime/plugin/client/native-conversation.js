import { createPortal, h, NativeUi, React, useEffect, useState } from "./runtime.js";
import { loadRunFile } from "./run-file-preview.js";

const liveStatuses = new Set(["running", "waiting_for_input", "waiting_for_approval"]);

const listeners = new Set();
let embedding = { target: null, debug: false };
export const nativeEmbedding = {
  subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  getSnapshot: () => embedding,
  update: (patch) => { embedding = { ...embedding, ...patch }; for (const listener of listeners) listener(); }
};

/** Portal the owner's rendered slots, retaining DSH's session scope and store ownership. */
export function NativeContentHost({ content, kind, width }) {
  const { target, debug } = React.useSyncExternalStore(nativeEmbedding.subscribe, nativeEmbedding.getSnapshot, nativeEmbedding.getSnapshot);
  if (!target || debug) return content;
  return createPortal(h("div", { className: `bees-embedded-${kind}`, style: {
    width: kind === "rightbar" ? width : "100%", height: "100%", minWidth: 0, maxWidth: "100%", overflow: "hidden"
  } }, content), target[kind]);
}

/** DSH owns streaming, attachments, message queues, steering, and tool/approval rendering. */
export function NativeConversation({ ctx, run, item = {}, act }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const main = React.useRef(null);
  const rightbar = React.useRef(null);
  const sessionId = run?.ranElsewhere ? null : run?.sessionId;
  const live = liveStatuses.has(run?.status) && !item.archivedAt;
  useEffect(() => {
    setError("");
    if (!sessionId) return;
    let disposed = false, refreshing = false, selected = sessionId, opened = false;
    const target = { main: main.current, rightbar: rightbar.current };
    const open = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        await ctx.sessions.refresh();
        if (disposed) return;
        ctx.uiWorkspace.openSession(selected);
        opened = true;
        nativeEmbedding.update({ target });
      } catch (reason) { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { refreshing = false; }
    };
    const unsubscribe = ctx.sessions.list.subscribe(() => {
      if (!opened) return;
      const current = ctx.sessions.list.getSnapshot().current;
      if (current) selected = current;
      else void open(); // Keep durable history visible when Bees releases a completed writer.
    });
    void open();
    return () => {
      disposed = true; unsubscribe();
      if (nativeEmbedding.getSnapshot().target === target) nativeEmbedding.update({ target: null });
    };
  }, [ctx, sessionId]);
  if (run?.ranElsewhere) return h("p", null, "This run's conversation and files are on its original device.");
  if (!sessionId) return h("p", { role: "status" }, "The conversation will appear when this run starts.");
  return h(React.Fragment, null,
    h("div", { className: "bees-native-widgets", "aria-label": "Work conversation" },
      h("div", { ref: main, className: "bees-native-main" }),
      h("div", { ref: rightbar, style: { display: "contents" } })),
    !live && !item.archivedAt && act && run.workItemId ? h("form", { className: "bees-composer", onSubmit: async (event) => {
      event.preventDefault();
      if (!text.trim() || sending) return;
      setSending(true); setError("");
      try {
        const result = await act({ action: "continue_run", executionId: run.id, text: text.trim() });
        if (!result) throw new Error("The run could not be continued.");
        setText("");
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { setSending(false); }
    } }, h("textarea", { className: "bees-input", value: text, "aria-label": "Continue work", placeholder: "Continue this work…",
      onChange: event => setText(event.target.value) }),
    h("button", { className: "bees-btn primary", disabled: sending || !text.trim() }, sending ? "Starting…" : "Continue work")) : null,
    error ? h("p", { role: "alert", className: "bees-error" }, error) : null);
}

/** Read through the native file API without selecting a conversation or opening DSH. */
export function NativeRunFilePreview({ target, onClose, inline, Preview }) {
  const { ctx } = React.useContext(NativeUi);
  const loadFile = React.useCallback((value, signal) => loadRunFile(ctx, value, signal), [ctx]);
  return h(Preview, { target, onClose, inline, loadFile });
}
