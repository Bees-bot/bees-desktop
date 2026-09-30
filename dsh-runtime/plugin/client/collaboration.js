import { h, MarkdownText, React, useEffect, useState } from "./runtime.js";
import { ask, Button, confirmAction, oneLine, request, useBeesChangeRevision, when } from "./shared.js";

const command = (action, input) => request("/bees-api/command", {
  method: "POST", body: JSON.stringify({ action, ...input })
});

const readableText = (text) => h("div", { className: "bees-context-text" }, h(MarkdownText, { text }));
const contextSection = (title, text, hint) => text ? h("details", { className: "bees-context-section" },
  h("summary", null, title), hint ? h("p", { className: "bees-muted" }, hint) : null, readableText(text)) : null;
const participantTitle = (view, item, id) => view?.participants?.find((peer) => peer.id === id)?.title
  ?? (item.id === id ? item.title : "Related work");
const discussionKinds = { note: "Update", decision: "Decision", finding: "Finding", lesson: "Lesson learned", result: "Result" };
const participantStatuses = { ready: "Ready to start", pending: "Not started", queued: "Starting", running: "Working", waiting: "Needs input", paused: "Paused", failed: "Needs attention", completed: "Finished", cancelled: "Cancelled" };

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
  const context = view?.context ?? view?.runContext;
  const content = context?.content ?? {};
  const scope = context?.scope;
  const corrections = view?.humanReview?.requiredCorrections ?? [];
  return h("section", { className: "bees-stack bees-collaboration", "aria-label": "Work context" },
    h("header", { className: "bees-collaboration-heading" },
      h("h3", null, "What guides this work"),
      h("p", { className: "bees-muted" }, "The goal, instructions and feedback the agents use for this run.")),
    error ? h("p", { role: "alert", className: "bees-error" }, error) : null,
    !view && !error ? h("p", { role: "status", className: "bees-muted" }, "Loading work context…") : null,
    view && !context ? h("div", { className: "bees-box" }, h("h4", null, "No saved instructions yet"),
      h("p", { className: "bees-muted" }, "Instructions are saved when an agent starts working. The current goal is in Details.")) : null,
    corrections.length ? h("section", { className: "bees-box bees-context-corrections" },
      h("h4", null, "Changes needed"),
      h("p", { className: "bees-muted" }, "These review requests still need to be addressed."),
      ...corrections.map((review) => h("article", { key: review.id },
        h("strong", null, participantTitle(view, item, review.workItemId)), readableText(review.feedback)))) : null,
    context ? h(React.Fragment, null,
      h("section", { className: "bees-box bees-context-goal" },
        h("span", { className: "bees-context-label" }, "Original goal"),
        h("h4", null, content.goal?.title || item.title),
        content.goal?.requirements ? readableText(content.goal.requirements)
          : h("p", { className: "bees-muted" }, "No additional requirements were provided.")),
      scope ? h("section", { className: "bees-box" },
        h("div", { className: "bees-collaboration-meta" }, h("h4", null, "This agent’s assignment"),
          scope.stage ? h("span", { className: "bees-collaboration-badge" }, `Stage: ${scope.stage}`) : null),
        scope.assignments?.length ? scope.assignments.map((assignment) => h("article", { key: assignment.id, className: "bees-context-assignment" },
          h("strong", null, assignment.title), assignment.requirements ? readableText(assignment.requirements) : null))
          : h("p", { className: "bees-muted" }, "Work toward the original goal using the instructions below."),
        contextSection("Agent instructions", scope.producerInstructions),
        scope.reviewFeedback ? h("div", { className: "bees-context-assignment" }, h("strong", null, "Feedback for this attempt"), readableText(scope.reviewFeedback)) : null) : null,
      h("div", { className: "bees-stack" },
        contextSection(content.process?.name ? `Process instructions · ${content.process.name}` : "Process instructions", content.process?.requirements),
        contextSection("General rules", content.system?.requirements, "Rules that apply across this process."),
        contextSection("Reference material", content.references),
        content.processMemory?.length ? h("details", { className: "bees-context-section" },
          h("summary", null, `Process memory used in this run (${content.processMemory.length})`),
          h("p", { className: "bees-muted" }, "Owner-enabled notes saved when this run started. Manage future notes in Memory."),
          ...content.processMemory.map((memory) => h("article", { key: memory.id, className: "bees-context-assignment" }, readableText(memory.content)))) : null,
        content.recurringGuidance?.length ? h("details", { className: "bees-context-section" },
          h("summary", null, "Instructions for recurring work"),
          ...content.recurringGuidance.map((guidance) => h("article", { key: guidance.id, className: "bees-context-assignment" },
            h("strong", null, guidance.name), readableText(guidance.playbook)))) : null,
        context.memories?.length ? h("details", { className: "bees-context-section" },
          h("summary", null, `Lessons from past work (${context.memories.length})`),
          h("p", { className: "bees-muted" }, "Background experience to help the agents. These lessons do not replace this run’s instructions."),
          ...context.memories.map((memory, index) => h("article", { key: memory.id ?? index, className: "bees-context-assignment" }, readableText(memory.text)))) : null),
      h("p", { className: "bees-muted" }, "These instructions were saved for this run. To use different requirements, edit the item in Details and start a new execution.")) : null,
    view?.humanReview?.entries?.length ? h("details", { className: "bees-context-section" },
      h("summary", null, `Review history (${view.humanReview.entries.length})`),
      ...view.humanReview.entries.map((review) => h("article", { key: review.id, className: "bees-context-assignment" },
        h("div", { className: "bees-collaboration-meta" },
          h("strong", null, participantTitle(view, item, review.workItemId)),
          h("span", { className: "bees-collaboration-badge" }, review.approved ? "Approved" : corrections.some(({ id }) => id === review.id) ? "Changes needed" : "Addressed")),
        readableText(review.feedback || review.summary),
        h("time", { className: "bees-muted", dateTime: review.createdAt }, when(review.createdAt))))) : null,
    context ? h("details", { className: "bees-context-section bees-context-technical" },
      h("summary", null, "Technical details"),
      h("p", { className: "bees-muted" }, `Saved requirements version ${context.version}`),
      h("pre", null, JSON.stringify({ requirements: context.content, scope: context.scope }, null, 2))) : null);
}

export function WorkDiscussion({ item, onOpenWork }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const revision = useBeesChangeRevision();
  useEffect(() => {
    let active = true;
    command("read_work_discussion", { itemId: item.id }).then((result) => {
      if (active) { setView(result); setError(""); }
    }).catch((reason) => active && setError(reason.message));
    return () => { active = false; };
  }, [item.id, revision]);
  const title = (id) => participantTitle(view, item, id);
  const open = (id, label) => onOpenWork
    ? h(Button, { type: "button", onClick: () => onOpenWork(id) }, label)
    : h("span", null, label);
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
  return h("section", { className: "bees-stack bees-collaboration", "aria-label": "Work item discussion" },
    h("header", { className: "bees-collaboration-heading" },
      h("h3", null, "Team discussion"),
      h("p", { className: "bees-muted" }, "Follow the messages, decisions and results shared while working on this goal.")),
    error ? h("p", { role: "alert", className: "bees-error" }, error) : null,
    view?.participants?.length ? h("details", { className: "bees-context-section", open: true },
      h("summary", null, `Work in this discussion (${view.participants.length})`),
      h("div", { className: "bees-discussion-participants" },
        ...view.participants.map((peer) => h("div", { key: peer.id, className: "bees-discussion-participant" },
          open(peer.id, peer.title),
          h("span", { className: "bees-muted" }, `${peer.id === view.rootId ? "Main task" : "Delegated task"} · ${participantStatuses[peer.status] ?? "Not started"}`))))) : null,
    !view && !error ? h("p", { role: "status", className: "bees-muted" }, "Loading discussion…") : null,
    h("div", { className: "bees-discussion-help" },
      h("strong", null, "Want to join in?"),
      h("p", { className: "bees-muted" }, "Use the chat box and type $ to choose a teammate or Everyone. Finished agents need a new assignment to reply.")),
    view?.hasMore ? h(Button, { disabled: loadingEarlier, onClick: earlier }, loadingEarlier ? "Loading..." : "Load earlier messages") : null,
    view && !view.updates.length ? h("div", { className: "bees-box bees-discussion-empty" },
      h("h4", null, "No messages yet"), h("p", { className: "bees-muted" }, "Messages appear here when you or an agent share an update with the team.")) : null,
    h("div", { role: "log", "aria-label": "Team messages, oldest first", "aria-live": "polite", className: "bees-discussion-timeline" },
      ...(view?.updates ?? []).map((entry) => h("article", { key: entry.id, className: "bees-discussion-message" },
        h("span", { className: "bees-discussion-avatar", "aria-hidden": true }, [...entry.author][0]),
        h("div", { className: "bees-box" },
          h("header", { className: "bees-collaboration-meta" },
            h("strong", null, entry.author),
            h("span", { className: "bees-collaboration-badge" }, discussionKinds[entry.kind] ?? "Update"),
            h("time", { className: "bees-muted", dateTime: entry.createdAt }, when(entry.createdAt))),
          h("p", { className: "bees-muted bees-discussion-recipient" }, entry.targetId ? `To ${title(entry.targetId)}` : "To everyone"),
          readableText(entry.content),
          contextSection("Supporting details", entry.evidence),
          h("footer", { className: "bees-discussion-footer" }, open(entry.workItemId, `View task & files: ${title(entry.workItemId)}`)),
          entry.executionId ? h("details", { className: "bees-discussion-technical" },
            h("summary", null, "Message details"), h("p", null, `Execution: ${entry.executionId}`)) : null)))),
    view?.updates.length ? h("p", { className: "bees-muted" }, "Discussion shares updates. To change the task requirements, use Details. Approval is recorded separately in Context.") : null);
}

const memoryKinds = { response: "User response", feedback: "Review feedback", information: "Saved information", result: "Run result" };

export function ProcessMemoryPanel({ process, act, onOpenWork }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState(false);
  const revision = useBeesChangeRevision();
  useEffect(() => {
    let active = true;
    act({ action: "read_process_memory", processId: process.id, query }, undefined, (message) => active && setError(message))
      .then((result) => { if (active && result) setView(result); });
    return () => { active = false; };
  }, [process.id, process.accountUserId, query, revision]);
  const change = async (action, input = {}) => {
    setBusy(true); setError("");
    try {
      const result = await act({ action, processId: process.id, query, ...input }, undefined, setError);
      if (result) { setView(result); return true; }
      return false;
    } finally { setBusy(false); }
  };
  const earlier = async () => {
    setBusy(true); setError("");
    try {
      const page = await act({ action: "read_process_memory", processId: process.id, query, before: view.before }, undefined, setError);
      if (page) setView((current) => ({ ...page, entries: [...new Map([...current.entries, ...page.entries].map((entry) => [entry.id, entry])).values()] }));
    } finally { setBusy(false); }
  };
  return h("section", { className: "bees-stack bees-collaboration", "aria-label": "Process memory" },
    h("header", { className: "bees-collaboration-heading" }, h("h3", null, `${process.name || "Process"} memory`),
      h("p", { className: "bees-muted" }, "Saved answers, feedback and useful information across this process’s runs. Only entries marked ‘Use in future runs’ guide new runs."),
      h("p", { className: "bees-muted" }, "Stored in Bees on this device. Context shows what a run used; Discussion keeps the conversation.")),
    error ? h("p", { role: "alert", className: "bees-error" }, error) : null,
    !view && !error ? h("p", { role: "status", className: "bees-muted" }, "Loading process memory…") : null,
    view && !view.canManage ? h("p", { className: "bees-muted" }, "Only the process owner can change these memories.") : null,
    view ? h("form", { className: "bees-row", onSubmit: (event) => { event.preventDefault(); setError(""); setQuery(search.trim()); } },
      h("input", { className: "bees-input bees-grow", type: "search", value: search, maxLength: 200, "aria-label": "Search process memory", placeholder: "Search saved memory", onChange: (event) => setSearch(event.target.value) }),
      h(Button, { type: "submit", disabled: busy }, "Search"),
      view.canManage ? h(Button, { type: "button", disabled: busy, onClick: () => setEditor({ content: "", active: true }) }, "Add memory") : null) : null,
    view?.canManage && editor ? h("form", { className: "bees-box bees-form", onSubmit: async (event) => {
      event.preventDefault();
      if (await change(editor.id ? "edit_process_memory" : "add_process_memory", { id: editor.id, expectedRevision: editor.revision, content: editor.content, active: editor.active })) setEditor(false);
    } },
      h("h4", null, editor.id ? "Edit memory" : "Add memory"),
      h("label", null, "Information to remember", h("textarea", { className: "bees-input", rows: 5, required: true, maxLength: 12000, value: editor.content, disabled: busy,
        onChange: (event) => setEditor({ ...editor, content: event.target.value }) })),
      h("label", null, h("input", { type: "checkbox", checked: editor.active, disabled: busy, onChange: (event) => setEditor({ ...editor, active: event.target.checked }) }), " Use in future runs"),
      h("p", { className: "bees-muted" }, "Changes apply to new process runs. Runs already started keep their saved memory."),
      h("div", { className: "bees-row" }, h(Button, { type: "submit", className: "primary", disabled: busy }, busy ? "Saving…" : "Save memory"),
        h(Button, { type: "button", disabled: busy, onClick: () => setEditor(false) }, "Cancel"))) : null,
    view && !view.entries.length ? h("div", { className: "bees-box" }, h("h4", null, query ? "No matching memory" : "No saved memory yet"),
      h("p", { className: "bees-muted" }, query ? "Try another search." : "User answers, review feedback, results and agent lessons will appear here. The owner can also add information directly.")) : null,
    ...(view?.entries ?? []).map((memory) => h("article", { key: memory.id, className: "bees-box bees-stack" },
      h("header", { className: "bees-collaboration-meta" }, h("strong", null, memoryKinds[memory.kind] ?? "Saved information"),
        h("span", { className: "bees-collaboration-badge" }, memory.active ? "Used in future runs" : "Saved for review"),
        h("time", { className: "bees-muted", dateTime: memory.createdAt }, when(memory.createdAt))),
      readableText(memory.content),
      memory.sourceId ? h("details", { className: "bees-context-section" }, h("summary", null, "Original source"),
        h("p", { className: "bees-muted" }, `${memory.author || "Agent"} · ${memory.sourceTitle || "Previous task"}`),
        readableText(memory.sourceContent), contextSection("Supporting evidence", memory.evidence),
        memory.workItemId && onOpenWork ? h(Button, { onClick: () => onOpenWork(memory.workItemId) }, "View source task") : null)
        : h("p", { className: "bees-muted" }, "Added by the process owner"),
      view.canManage ? h("div", { className: "bees-row" },
        h(Button, { disabled: busy, onClick: () => change("edit_process_memory", { id: memory.id, expectedRevision: memory.revision, active: !memory.active }) }, memory.active ? "Stop using in future runs" : "Use in future runs"),
        h(Button, { disabled: busy, onClick: () => setEditor({ ...memory }) }, "Edit"),
        h(Button, { disabled: busy, onClick: async () => {
          if (await confirmAction("Forget this memory? The original discussion and existing run snapshots are kept.")) {
            if (await change("forget_process_memory", { id: memory.id, expectedRevision: memory.revision })) setEditor(false);
          }
        } }, "Forget")) : null)),
    view?.hasMore ? h(Button, { disabled: busy, onClick: earlier }, busy ? "Loading…" : "Load older memories") : null);
}

export function MemorySettings({ workspace, canManage = false }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = React.useRef(0);
  useEffect(() => {
    let active = true;
    const load = () => {
      const mine = ++seq.current;
      return command("memory_status", { workspaceId: workspace.id }).then((value) => active && mine === seq.current && setState(value))
        .catch((reason) => active && setError(reason.message));
    };
    void load();
    const timer = setInterval(load, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [workspace.id]);
  const act = async (action, input = {}) => {
    if (!canManage) return false;
    setBusy(true);
    try {
      const value = await command(action, { workspaceId: workspace.id, ...input });
      seq.current += 1;
      setState((previous) => ({ ...previous, ...value })); setError(""); return true;
    } catch (reason) { setError(reason.message); return false; }
    finally { setBusy(false); }
  };
  const save = async (event) => {
    event.preventDefault();
    if (!canManage) return;
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
    state ? h("form", { key: `${state.url}:${state.model ?? ""}:${state.enabled}`, className: "bees-form", onSubmit: save },
      state.managed ? h(React.Fragment, null,
        h("label", null, "AI model for Hindsight", h("select", { name: "model", className: "bees-select", disabled: !canManage, defaultValue: state.model || "" },
          h("option", { value: "" }, "Automatic (running local model)"),
          ...(state.models ?? []).map((model) => h("option", { key: model.id, value: model.id }, model.name)),
          state.model && !state.models?.some((model) => model.id === state.model)
            ? h("option", { value: state.model }, "Selected model (currently unavailable)") : null)),
        h("p", { className: "bees-muted" }, "Applies to local memory for all workspaces on this device. Models are managed in AI settings. A selected model must be running; Bees never falls back to a cloud model."),
        state.activeModel ? h("p", null, `Using: ${state.activeModel}`) : null) : null,
      h("details", null, h("summary", null, "Advanced: custom Hindsight service"),
      h("label", null, "Hindsight endpoint", h("input", { type: "url", name: "url", required: true, className: "bees-input", disabled: !canManage, defaultValue: state.url || "http://127.0.0.1:8898" })),
      h("label", null, "API key (blank keeps the saved key)", h("input", { type: "password", name: "apiKey", autoComplete: "new-password", className: "bees-input", disabled: !canManage })),
      h("label", null, h("input", { type: "checkbox", name: "clearKey", disabled: !canManage }), " Remove saved API key")),
      h("label", null, h("input", { type: "checkbox", name: "enabled", disabled: !canManage, defaultChecked: state.enabled }), " Enable workspace memory"),
      h("div", { className: "bees-row" },
        h(Button, { type: "submit", disabled: !canManage || busy }, "Save memory settings"),
        h(Button, { type: "button", disabled: !canManage || busy || !state.enabled, onClick: () => act("memory_test") }, "Test connection"),
        h(Button, { type: "button", disabled: !canManage || busy || !state.enabled, onClick: () => act("memory_retry") }, "Retry synchronization"))) : null,
    h("h4", null, "Remembered outcomes"),
    state && !state.memories?.length ? h("p", { className: "bees-muted" }, "No outcomes yet. Accepted work completed after memory is enabled will appear here.") : null,
    ...(state?.memories ?? []).map((memory) => h("details", { key: memory.id, className: "bees-box" },
      h("summary", null, oneLine(String(memory.content ?? "").split("Accepted outcome:").pop()) || "Remembered outcome",
        " ", h("span", { className: "bees-badge" }, memory.error || memory.status)),
      h("p", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, memory.content),
      memory.evidence ? h("p", { className: "bees-muted", style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, memory.evidence) : null,
      h("div", { className: "bees-row" },
        h(Button, { disabled: !canManage || busy || memory.status === "deleting", onClick: async () => {
          if (!canManage) return;
          const content = await ask("Correct remembered outcome", memory.content, "textarea");
          if (content) await act("memory_edit", { id: memory.id, content });
        } }, "Correct"),
        h(Button, { disabled: !canManage || busy || memory.status === "deleting", onClick: () => act("memory_delete", { id: memory.id }) }, "Forget")))));
}
