import { h, React, useEffect, useState } from "./runtime.js";
import { ask, Button, request, useBeesChangeRevision } from "./shared.js";

const command = (action, input) => request("/bees-api/command", {
  method: "POST", body: JSON.stringify({ action, ...input })
});

export function SharedWorkContext({ item, executionId }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const revision = useBeesChangeRevision();
  useEffect(() => {
    let active = true;
    command("read_work_context", { itemId: item.id, executionId }).then((result) => {
      if (active) { setView(result); setError(""); }
    }).catch((reason) => active && setError(reason.message));
    return () => { active = false; };
  }, [item.id, executionId, revision]);
  return h("div", { className: "bees-stack" },
    error ? h("p", { role: "alert", className: "bees-error" }, error) : null,
    h("h3", null, "Shared task context"),
    h("p", { className: "bees-muted" }, view?.context
      ? `Requirements version ${view.context.version}. This execution and its reviewer use the same requirements. Discussion and memories do not change them.`
      : "Requirements are pinned when execution starts. Edit the work item or process to change requirements for a new execution."),
    view?.context ? h("details", { open: true }, h("summary", null, "Exact requirements and assigned scope"),
      h("pre", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, JSON.stringify({ requirements: view.context.content, scope: view.context.scope }, null, 2))) : null,
    view?.humanReview?.entries?.length ? h("details", { open: Boolean(view.humanReview.requiredCorrections.length) },
      h("summary", null, `Human review feedback (revision ${view.humanReview.version})`),
      h("p", { className: "bees-muted" }, "Original feedback is preserved here. Unresolved rejections are required corrections for this run, not ordinary discussion or recalled memory."),
      ...view.humanReview.entries.map((review) => h("article", { key: review.id, className: "bees-box" },
        h("strong", null, `${review.approved ? "Approved" : "Rejected"}: ${review.workItemId}`),
        h("p", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, review.feedback || review.summary),
        h("small", null, `Execution: ${review.executionId}`)))) : null,
    view?.context?.memories?.length ? h("details", null, h("summary", null, "Recalled experience"),
      ...view.context.memories.map((memory, index) => h("p", { key: memory.id ?? index }, memory.text))) : null);
}

export function WorkDiscussion({ item, onOpenWork }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [notice, setNotice] = useState("");
  const revision = useBeesChangeRevision();
  useEffect(() => {
    let active = true;
    command("read_work_discussion", { itemId: item.id }).then((result) => {
      if (active) { setView(result); setError(""); }
    }).catch((reason) => active && setError(reason.message));
    return () => { active = false; };
  }, [item.id, revision]);
  const title = (id) => view?.participants.find((peer) => peer.id === id)?.title ?? id;
  const open = (id, label) => onOpenWork
    ? h(Button, { type: "button", onClick: () => onOpenWork(id) }, label)
    : h("span", null, label);
  const post = async (event) => {
    event.preventDefault();
    const form = event.currentTarget, values = new FormData(form);
    setBusy(true); setNotice("");
    try {
      await command("post_work_update", { itemId: item.id, kind: values.get("kind"), content: values.get("content"),
        evidence: values.get("evidence"), targetId: values.get("targetId") || null });
      const updated = await command("read_work_discussion", { itemId: item.id });
      setView(updated);
      const recipients = values.get("targetId") ? updated.participants.filter((peer) => peer.id === values.get("targetId")) : updated.participants;
      const active = recipients.some((peer) => ["ready", "queued", "running", "waiting"].includes(peer.status));
      setNotice(active
        ? "Saved to the shared journal. Active agents can read it on their next model step; agents waiting on peer work are notified. This is not a read receipt or an approval."
        : "Saved to the shared journal. No selected recipient is active. Open their work item to resume, retry, or arrange a follow-up; this message alone does not restart work.");
      form.reset(); setError("");
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  const earlier = async () => {
    const before = view.before;
    setLoadingEarlier(true);
    try {
      const page = await command("read_work_discussion", { itemId: item.id, before });
      setView((current) => {
        const entries = new Map([...page.updates, ...current.updates].map((entry) => [entry.id, entry]));
        return { ...current, before: page.before, hasMore: page.hasMore, updates: [...entries.values()].sort((a, b) => a.seq - b.seq) };
      });
    } catch (reason) { setError(reason.message); }
    finally { setLoadingEarlier(false); }
  };
  return h("section", { className: "bees-stack", "aria-label": "Work item discussion" },
    h("h3", null, "Discussion"),
    h("p", { className: "bees-muted" }, "Shared messages, decisions and results from this primary work item and its peers. These are explicit contributions, not private agent reasoning. Completed agents need a follow-up assignment to respond."),
    error ? h("p", { role: "alert", className: "bees-error" }, error) : null,
    view ? h("div", { className: "bees-row", style: { flexWrap: "wrap" } },
      ...view.participants.map((peer) => h("span", { key: peer.id }, open(peer.id, `${peer.title} (${peer.status})`)))) : h("p", { role: "status" }, "Loading discussion..."),
    view?.hasMore ? h(Button, { disabled: loadingEarlier, onClick: earlier }, loadingEarlier ? "Loading..." : "Load earlier messages") : null,
    view && !view.updates.length ? h("p", { className: "bees-muted" }, "No shared messages yet. Creating peer work items does not itself start a discussion.") : null,
    h("div", { role: "log", "aria-label": "Agent messages", "aria-live": "polite", className: "bees-stack" },
      ...(view?.updates ?? []).map((entry) => h("article", { key: entry.id, className: "bees-box" },
        h("strong", null, `${entry.author} / ${entry.kind}`),
        h("p", { className: "bees-muted" }, entry.targetId ? `To: ${title(entry.targetId)}` : "To: everyone in this work item"),
        h("p", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, entry.content),
        entry.evidence ? h("p", { className: "bees-muted", style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, entry.evidence) : null,
        h("time", { dateTime: entry.createdAt }, new Date(entry.createdAt).toLocaleString()),
        h("div", null, open(entry.workItemId, `Work and files: ${title(entry.workItemId)}`)),
        entry.executionId ? h("small", null, `Execution: ${entry.executionId}`) : null))),
    notice ? h("p", { role: "status", className: "bees-callout" }, notice) : null,
    h("p", { className: "bees-muted" }, "Messages and suggestions do not change pinned requirements or grant approval. To change requirements, use Details > Edit item and start a new execution with those requirements."),
    h("form", { className: "bees-form", onSubmit: post },
      h("label", null, "Send to", h("select", { name: "targetId", className: "bees-select" },
        h("option", { value: "" }, "Everyone"),
        ...(view?.participants ?? []).map((peer) => h("option", { key: peer.id, value: peer.id }, peer.title)))),
      h("label", null, "Update type", h("select", { name: "kind", className: "bees-select" },
        ...["note", "decision", "finding", "lesson"].map((kind) => h("option", { key: kind, value: kind }, kind)))),
      h("label", null, "Join the discussion", h("textarea", { name: "content", required: true, maxLength: 6000, className: "bees-textarea" })),
      h("label", null, "Evidence (required for findings and lessons)", h("textarea", { name: "evidence", maxLength: 6000, className: "bees-textarea" })),
      h(Button, { type: "submit", disabled: busy || !view }, busy ? "Sharing..." : "Send message")));
}

export function MemorySettings({ workspace, canManage = false }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () => command("memory_status", { workspaceId: workspace.id }).then((value) => active && setState(value))
      .catch((reason) => active && setError(reason.message));
    void load();
    const timer = setInterval(load, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [workspace.id]);
  const act = async (action, input = {}) => {
    setBusy(true);
    try {
      const value = await command(action, { workspaceId: workspace.id, ...input });
      setState((previous) => ({ ...previous, ...value })); setError(""); return true;
    } catch (reason) { setError(reason.message); return false; }
    finally { setBusy(false); }
  };
  const save = async (event) => {
    event.preventDefault();
    const form = event.currentTarget, values = new FormData(form);
    if (await act("memory_configure", { url: values.get("url"), model: values.get("model") ?? undefined, enabled: values.get("enabled") === "on", apiKey: values.get("apiKey"), clearKey: values.get("clearKey") === "on" })) {
      form.elements.apiKey.value = "";
      form.elements.clearKey.checked = false;
    }
  };
  return h("section", { className: "bees-box bees-stack" },
    h("h3", null, `${workspace.name} memory`),
    h("p", { className: "bees-muted" }, "Hindsight recalls past outcomes and consolidates lessons. When enabled, newly accepted summaries and their evidence are sent to the configured endpoint. Exact task requirements and discussions remain in Bees."),
    h("p", { className: "bees-muted" }, "Memory is enabled automatically for new workspaces. Bees installs and starts local Hindsight on this device; first setup needs internet to download dependencies. Outcomes queue safely while setup or your local AI is starting. No cloud model or API key is required for local memory."),
    state?.bank ? h("p", { className: "bees-muted" }, `Memory bank: ${state.bank}`) : null,
    h("p", { role: "status" }, state?.status ?? "Loading memory settings..."),
    error ? h("p", { role: "alert", className: "bees-error" }, error) : null,
    canManage && state ? h("form", { key: `${state.url}:${state.model ?? ""}:${state.enabled}`, className: "bees-form", onSubmit: save },
      state.managed ? h(React.Fragment, null,
        h("label", null, "AI model for Hindsight", h("select", { name: "model", className: "bees-select", defaultValue: state.model || "" },
          h("option", { value: "" }, "Automatic (running local model)"),
          ...(state.models ?? []).map((model) => h("option", { key: model.id, value: model.id }, model.name)),
          state.model && !state.models?.some((model) => model.id === state.model)
            ? h("option", { value: state.model }, "Selected model (currently unavailable)") : null)),
        h("p", { className: "bees-muted" }, "Applies to local memory for all workspaces on this device. Models are managed in AI settings. A selected model must be running; Bees never falls back to a cloud model."),
        state.activeModel ? h("p", null, `Using: ${state.activeModel}`) : null) : null,
      h("details", null, h("summary", null, "Advanced: custom Hindsight service"),
      h("label", null, "Hindsight endpoint", h("input", { type: "url", name: "url", required: true, className: "bees-input", defaultValue: state.url || "http://127.0.0.1:8898" })),
      h("label", null, "API key (blank keeps the saved key)", h("input", { type: "password", name: "apiKey", autoComplete: "new-password", className: "bees-input" })),
      h("label", null, h("input", { type: "checkbox", name: "clearKey" }), " Remove saved API key")),
      h("label", null, h("input", { type: "checkbox", name: "enabled", defaultChecked: state.enabled }), " Enable workspace memory"),
      h("div", { className: "bees-row" },
        h(Button, { type: "submit", disabled: busy }, "Save memory settings"),
        h(Button, { type: "button", disabled: busy || !state.enabled, onClick: () => act("memory_test") }, "Test connection"),
        h(Button, { type: "button", disabled: busy || !state.enabled, onClick: () => act("memory_retry") }, "Retry synchronization"))) : null,
    h("h4", null, "Remembered outcomes"),
    state && !state.memories?.length ? h("p", { className: "bees-muted" }, "No outcomes yet. Accepted work completed after memory is enabled will appear here.") : null,
    ...(state?.memories ?? []).map((memory) => h("article", { key: memory.id, className: "bees-box" },
      h("p", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, memory.content),
      h("p", { className: "bees-muted" }, memory.evidence),
      h("small", null, memory.error || memory.status),
      canManage ? h("div", { className: "bees-row" },
        h(Button, { disabled: busy || memory.status === "deleting", onClick: async () => {
          const content = await ask("Correct remembered outcome", memory.content);
          if (content) await act("memory_edit", { id: memory.id, content });
        } }, "Correct"),
        h(Button, { disabled: busy || memory.status === "deleting", onClick: () => act("memory_delete", { id: memory.id }) }, "Forget")) : null)));
}
