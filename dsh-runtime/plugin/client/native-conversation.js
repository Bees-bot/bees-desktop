import { createPortal, h, NativeUi, React, useEffect, useState } from "./runtime.js";
import { loadLocationFile, loadRunFile } from "./run-file-preview.js";
import { usePreference } from "./shared.js";
import { sessionFileAddress } from "@deepseek-ai/dsh-util-workspace-path";

const WORK_DETAIL_MODES = [
  ["compact", "Compact"], ["standard", "Standard"], ["detailed", "Detailed"],
  ["verbose", "Fully expanded while running"]
];

const listeners = new Set();
let embedding = { target: null };
export const nativeEmbedding = {
  subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  getSnapshot: () => embedding,
  update: (patch) => { embedding = { ...embedding, ...patch }; for (const listener of listeners) listener(); }
};

/** Portal the owner's rendered slots, retaining DSH's session scope and store ownership. */
export function NativeContentHost({ content, kind }) {
  const { target } = React.useSyncExternalStore(nativeEmbedding.subscribe, nativeEmbedding.getSnapshot, nativeEmbedding.getSnapshot);
  if (!target) return null;
  return createPortal(h("div", { className: `bees-embedded-${kind}`, style: {
    height: "100%", minWidth: 0, overflow: "hidden"
  } }, content), target[kind]);
}

/** Hosts DSH's own conversation screen (chat plus its file/detail sidebar) for the work item's
 *  Details "Chat" tab. DSH owns streaming, attachments, message queues, steering, and tool/
 *  approval rendering inside it. The portal targets stay mounted in the DOM at all times
 *  regardless of `activeTab` — only their CSS visibility follows it — because unmounting them
 *  drops DSH's createPortal connection and the session state with it. */
export function DshRunPanels({ ctx, run, item = {}, activeTab }) {
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(true);
  const chatSettings = React.useMemo(() => ctx.configForms.get("ui-chat"), [ctx]);
  const chatPreference = usePreference(chatSettings);
  const transcriptView = ({ normal: "standard", expanded: "detailed" })[chatPreference.transcriptView]
    ?? chatPreference.transcriptView ?? "compact";
  const main = React.useRef(null);
  const rightbar = React.useRef(null);
  const sessionId = run?.ranElsewhere ? null : run?.sessionId;
  useEffect(() => {
    setError("");
    setOpening(true);
    if (!sessionId) return;
    let disposed = false, opened = false;
    const target = { main: main.current, rightbar: rightbar.current };
    const fail = (reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)); };
    const open = () => {
      if (disposed || opened || !ctx.sessions.list.getSnapshot().byId[sessionId]) return;
      // openSession updates the list, which calls open again before it returns
      opened = true;
      try {
        ctx.uiWorkspace.openSession(sessionId);
        setError(""); setOpening(false);
        nativeEmbedding.update({ target });
      } catch (reason) { opened = false; fail(reason); }
    };
    // a queued retry may be listed only after the first refresh
    const unsubscribe = ctx.sessions.list.subscribe(open);
    ctx.sessions.refresh().then(open, fail);
    return () => {
      disposed = true; unsubscribe();
      if (nativeEmbedding.getSnapshot().target === target) nativeEmbedding.update({ target: null });
    };
  }, [ctx, sessionId]);
  const empty = run?.ranElsewhere ? "This run's conversation and files are on its original device."
    : !sessionId ? "The conversation will appear when this run starts." : null;
  return h("div", { className: "bees-dsh-tab", style: { display: activeTab === "chat" ? "flex" : "none", flexDirection: "column", height: "100%" } },
    empty ? h("p", { role: "status" }, empty) : h(React.Fragment, null,
      h("div", { className: "bees-work-details-toolbar" },
        h("label", null, "Work process display · all conversations",
          h("select", { className: "bees-select", value: transcriptView,
            disabled: chatSettings.getSnapshot().status !== "ready",
            onChange: (event) => void chatSettings.set("transcriptView", event.target.value).catch((reason) =>
              setError(reason instanceof Error ? reason.message : String(reason))) },
          ...WORK_DETAIL_MODES.map(([value, label]) => h("option", { key: value, value }, label))))),
      opening && !error ? h("p", { role: "status" }, "Waiting for this run's conversation…") : null,
      h("div", { className: "bees-native-widgets" },
        h("div", { ref: main, className: "bees-native-main" }),
        h("div", { ref: rightbar, style: { display: "contents" } })),
      error ? h("p", { role: "alert", className: "bees-error" }, error) : null));
}

/** Read through the native file API without selecting a conversation or opening DSH. */
export function NativeRunFilePreview({ target, onClose, inline, Preview }) {
  const { ctx } = React.useContext(NativeUi);
  const loadFile = React.useCallback((value, signal) => value.executionId
    ? loadRunFile(ctx, value, signal) : loadLocationFile(value, signal), [ctx]);
  return h(Preview, { target, onClose, inline, loadFile, Document: NativeDocumentPreview });
}

/** Use the native document tab with its session providers and tab-owned zoom state. */
function NativeDocumentPreview({ file }) {
  const { ctx } = React.useContext(NativeUi);
  const main = React.useRef(null), rightbar = React.useRef(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false, opened = false;
    const previous = nativeEmbedding.getSnapshot().target;
    const previousSession = ctx.sidebarRight.mounted.getSnapshot();
    const target = { main: main.current, rightbar: rightbar.current };
    const open = () => {
      if (disposed || opened || ctx.sidebarRight.mounted.getSnapshot() !== file.sessionId) return;
      try {
        opened = true;
        ctx.sidebarRight.openResource(sessionFileAddress(file.sessionId, file.path));
      } catch (reason) { setError(reason.message); }
    };
    const unsubscribe = ctx.sidebarRight.mounted.subscribe(open);
    ctx.sessions.refresh().then(() => {
      if (disposed) return;
      ctx.uiWorkspace.openSession(file.sessionId);
      nativeEmbedding.update({ target });
      open();
    }).catch((reason) => { if (!disposed) setError(reason.message); });
    return () => {
      disposed = true; unsubscribe();
      if (nativeEmbedding.getSnapshot().target === target) {
        nativeEmbedding.update({ target: previous?.main?.isConnected ? previous : null });
        if (previousSession && ctx.sessions.list.getSnapshot().byId[previousSession])
          ctx.uiWorkspace.openSession(previousSession);
      }
    };
  }, [ctx, file.sessionId, file.path]);
  return h("div", { className: "bees-native-document", style: { height: "65vh", minHeight: 320, display: "flex" } },
    h("div", { ref: main, style: { display: "none" } }),
    h("div", { ref: rightbar, style: { display: "contents" } }),
    error ? h("p", { className: "bees-error", role: "alert" }, error) : null);
}
