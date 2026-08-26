import {
  h, MarkdownText, PendingQuestion, React, useEffect, useMemo, useState
} from "./runtime.js";
import {
  ask, AuditEvent, Button, confirmAction, Empty, isDone, request, runTitle, useSnapshot, workItemsFor
} from "./shared.js";

/** The goal opens the conversation, so a run reads from the ask down. */
function GoalMessage({ item }) {
  return h("div", { className: "bees-convo-msg user" },
    h("strong", null, "Goal"),
    h("div", null, item.description || item.title));
}

function WorkItemDetails({ data, item, teamId, act, onArchived }) {
  const process = data.processes.find(({ id }) => id === item.processId);
  const stage = data.stages.find(({ id }) => id === item.stageId);
  const assignments = data.assignments.filter(({ workspaceId }) => workspaceId === process?.workspaceId);
  const assignment = assignments.find(({ id }) => id === item.agentAssignmentId);
  const routeAgent = assignments.find(({ id }) => id === stage?.routeTargetId);
  const routePool = data.pools.find(({ id }) => id === stage?.routeTargetId);
  const routeLabel = routeAgent?.name ?? routePool?.name ?? `Workspace ${stage?.driver === "review" ? "reviewer" : "worker"}`;
  const itemRuns = data.runs.filter(({ workItemId }) => workItemId === item.id);
  const [selectedRun, setSelectedRun] = useState("");
  const [activeTab, setActiveTab] = useState("details");
  const [handled, setHandled] = useState(() => new Set());
  const [history, setHistory] = useState(null);
  const [audit, setAudit] = useState([]);
  const convoRef = React.useRef(null);
  const run = itemRuns.find(({ id }) => id === selectedRun) ?? itemRuns[0];
  const pendingRun = itemRuns.find(({ status, sessionId }) => sessionId && ["waiting_for_input", "waiting_for_approval", "interrupted"].includes(status));
  const interaction = null;
  useEffect(() => {
    setSelectedRun(""); setHistory(null); setHandled(new Set());
    setActiveTab("details");
  }, [item.id]);
  useEffect(() => {
    let active = true;
    if (!run) { setHistory(null); return () => { active = false; }; }
    request(`/bees-api/run-history?executionId=${encodeURIComponent(run.id)}`)
      .then((value) => active && setHistory(value.history))
      .catch((error) => active && setHistory({ error: error instanceof Error ? error.message : String(error) }));
    return () => { active = false; };
  }, [run?.id]);
  useEffect(() => { let active = true; request("/bees-api/audit").then(({ events }) => active && setAudit(events)); return () => { active = false; }; }, [item.id, data.runs.length]);
  
  // Auto-scroll conversation
  useEffect(() => {
    if (convoRef.current) convoRef.current.scrollTop = convoRef.current.scrollHeight;
  }, [history, pendingRun, interaction]);

  const edit = async () => { /* reuse edit logic */
    const title = await ask("Work title", item.title); if (!title) return;
    const description = await ask("Description", item.description) ?? item.description;
    const owner = await ask("Person responsible (optional)", item.owner ?? "") ?? "";
    const agentName = await ask(`Worker override (optional; blank uses stage routing):\n${assignments.map(({ name }) => name).join("\n")}`, assignment?.name ?? "");
    if (agentName === null) return;
    const nextAgent = assignments.find(({ name }) => name === agentName);
    if (agentName && !nextAgent) return;
    await act({ action: "edit_item", itemId: item.id, title, description, owner, priority: item.priority, parentId: item.parentId, agentAssignmentId: nextAgent?.id ?? null });
  };
  const addFile = async () => {
    const attached = data.attachments.filter(({ workItemId }) => workItemId === item.id).map(({ locationId }) => locationId);
    const available = data.locations.filter(({ teamId: id, archivedAt, id: locationId }) => id === teamId && !archivedAt && !attached.includes(locationId));
    const name = await ask(`Team location:\n${available.map(({ name }) => name).join("\n")}`);
    const location = available.find((row) => row.name === name); if (!location) return;
    const relativePath = location.kind === "folder" ? await ask("Relative file or folder inside this location (optional)", "") : "";
    if (relativePath !== null) await act({ action: "attach_location", itemId: item.id, locationId: location.id, relativePath });
  };
  const addSubitem = async () => {
    const title = await ask("Delegated work title", ""); if (!title) return;
    const description = await ask("What does success look like?", "") ?? "";
    const agentName = await ask(`Worker override (optional; blank uses stage routing):\n${assignments.map(({ name }) => name).join("\n")}`, assignment?.name ?? "");
    if (agentName === null) return;
    const childAgent = assignments.find(({ name }) => name === agentName);
    if (agentName && !childAgent) return;
    await act({ action: "create_item", processId: item.processId, parentId: item.id, title, description, agentAssignmentId: childAgent?.id ?? null });
  };
  const publish = async () => {
    const attached = data.attachments.filter(({ workItemId }) => workItemId === item.id).map(({ locationId }) => locationId);
    const choices = data.locations.filter(({ id }) => attached.includes(id));
    const name = await ask(`Publish to:\n${choices.map(({ name }) => name).join("\n")}`);
    const location = choices.find((row) => row.name === name);
    if (run && location) await act({ action: "publish_run", executionId: run.id, locationId: location.id });
  };
  const archive = async () => {
    if (!await confirmAction(`Archive “${item.title}”? Active work will be cancelled. Its history will be preserved.`)) return;
    if (await act({ action: "archive_item", itemId: item.id })) onArchived?.();
  };
  const answered = (key) => setHandled((current) => new Set(current).add(key));
  const runAudit = new Set(itemRuns.map(({ id }) => id));
  const events = audit.filter(({ executionId, metadata }) => runAudit.has(executionId) || metadata?.itemId === item.id || metadata?.parentId === item.id || metadata?.resultId === item.id);
  useEffect(() => {
    if (convoRef.current) {
      convoRef.current.scrollTop = convoRef.current.scrollHeight;
    }
  }, [history, pendingRun, item.runtimePhase]);
  
  const assignAgent = (agentAssignmentId) => act({
    action: "edit_item", itemId: item.id, title: item.title, description: item.description,
    owner: item.owner, priority: item.priority, parentId: item.parentId,
    agentAssignmentId: agentAssignmentId || null
  });
  
  // Collapse history messages
  const convoItems = [];
  convoItems.push(h(GoalMessage, { item, key: "start" }));
  
  if (history?.messages) {
    for (const msg of history.messages) {
      if (msg.role === "user") convoItems.push(h("div", { className: "bees-convo-msg user", key: msg.id }, h("strong", null, "You"), h("div", null, msg.parts.map(p => p.text).join(" "))));
      else {
        const textParts = msg.parts.filter(p => p.text);
        const toolParts = msg.parts.filter(p => p.type === "tool");
        if (textParts.length) convoItems.push(h("div", { className: "bees-convo-msg agent", key: msg.id }, h("strong", null, "Agent"), h("div", null, textParts.map(p => p.text).join(" "))));
        if (toolParts.length) {
          convoItems.push(h("div", { className: "bees-convo-msg system", key: `tool-${msg.id}` }, `Agent performed ${toolParts.length} task${toolParts.length > 1 ? 's' : ''}`));
        }
      }
    }
  } else if (events.length) {
    convoItems.push(h("div", { className: "bees-convo-msg system", key: "audit-events" }, `${events.length} background events recorded`));
  }

  // Inject subitems status
  const subitems = data.items.filter(i => i.parentId === item.id && !i.archivedAt);
  for (const sub of subitems) {
    if (["running", "waiting", "paused"].includes(sub.runtimePhase)) {
      convoItems.push(h("div", { className: "bees-convo-msg system", key: `sub-${sub.id}` }, h("strong", null, "Agent doing"), `${sub.title}`));
    } else if (sub.runtimePhase === "completed") {
      convoItems.push(h("div", { className: "bees-convo-msg system", key: `sub-${sub.id}` }, h("strong", null, "Agent done"), `${sub.title}`));
    } else if (sub.runtimePhase === "failed") {
      convoItems.push(h("div", { className: "bees-convo-msg system", key: `sub-${sub.id}` }, h("strong", null, "Agent failed"), `${sub.title}`));
    }
  }

  
  return h("div", { className: "bees-workspace-layout" },
    h("div", { className: "bees-convo-panel" },
      h("div", { className: "bees-convo-history", ref: convoRef },
        ...convoItems,
        pendingRun ? h("div", { className: "bees-convo-msg system" }, "⚡ Agent is waiting for your input — go to Needs You to respond.") : item.runtimePhase === "running" ? h("div", { className: "bees-convo-msg system" }, "Agent is working...") : null,
        item.runtimeError ? h("div", { className: "bees-convo-msg agent", style: { borderColor: "#d15353", background: "#a9363622" } }, h("strong", null, "Error"), h("div", null, item.runtimeError)) : null
      ),
      h("form", { className: "bees-composer", style: { margin: "16px", flexShrink: 0 } },
        h("textarea", { 
          className: "bees-composer-input", 
          placeholder: pendingRun ? "Answer above..." : "Add a note or instruction...", 
          disabled: !pendingRun,
          style: { minHeight: "50px", fontSize: "14px" } 
        }),
        h("div", { className: "bees-composer-foot" },
          h("span", { className: "bees-composer-hint" }, pendingRun ? "Agent is waiting for your answer" : "Conversation paused"),
          h("button", { className: "bees-btn primary", disabled: true }, "Send message")
        )
      )
    ),
    h("div", { className: "bees-details-panel" },
      h("div", { className: "bees-box" },
        h("div", { className: "bees-tabbar" },
          h("div", { className: "bees-tabs", role: "tablist", "aria-label": "Work item details" },
            h("button", { type: "button", role: "tab", id: "bees-tab-details", className: `bees-tab ${activeTab === "details" ? "active" : ""}`, "aria-selected": activeTab === "details", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("details") }, "Details"),
            h("button", { type: "button", role: "tab", id: "bees-tab-files", className: `bees-tab ${activeTab === "files" ? "active" : ""}`, "aria-selected": activeTab === "files", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("files") }, "Files"),
            h("button", { type: "button", role: "tab", id: "bees-tab-runs", className: `bees-tab ${activeTab === "runs" ? "active" : ""}`, "aria-selected": activeTab === "runs", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("runs") }, "Runs"),
            h("button", { type: "button", role: "tab", id: "bees-tab-audit", className: `bees-tab ${activeTab === "audit" ? "active" : ""}`, "aria-selected": activeTab === "audit", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("audit") }, "Audit")
          ),
          h("div", { className: "bees-tab-actions" },
            ["running", "waiting"].includes(item.runtimePhase) ? h(Button, { onClick: () => act({ action: "pause_item", itemId: item.id }) }, "Pause") : null,
            item.runtimePhase === "paused" ? h(Button, { className: "primary", onClick: () => act({ action: "resume_item", itemId: item.id }) }, "Resume") : null,
            item.runtimePhase === "failed" ? h(Button, { className: "primary", onClick: () => act({ action: "retry_item", itemId: item.id }) }, "Retry") : null,
            ["running", "waiting", "paused", "failed"].includes(item.runtimePhase) ? h(Button, { onClick: () => act({ action: "cancel_item", itemId: item.id }) }, "Stop") : null,
            h(Button, { className: "danger", onClick: archive }, "Archive"),
            run?.status === "completed" && run.outputs.length && data.attachments.some(({ workItemId }) => workItemId === item.id) ? h(Button, { className: "primary", onClick: publish }, "Publish outputs") : null)
        ),
        h("div", { className: "bees-tab-panel", role: "tabpanel", id: "bees-detail-panel", "aria-labelledby": `bees-tab-${activeTab}` },
          activeTab === "details" ? h(React.Fragment, null,
            h("div", { className: "bees-status" }, `${process?.name ?? "Process"} · ${stage?.name ?? "Stage"}`),
            h("h3", null, "Active Agent"),
            h("p", { className: "bees-muted" }, assignment ? `${assignment.name}${assignment.model ? ` · ${assignment.model}` : ""}` : `Stage route: ${routeLabel}`),
            stage?.driver !== "terminal" ? h("label", { className: "bees-form" }, "Agent for this item",
              h("select", { className: "bees-select", value: item.agentAssignmentId ?? "",
                "aria-label": "Agent for this work item", onChange: (event) => void assignAgent(event.target.value) },
                h("option", { value: "" }, `Use stage route (${routeLabel})`),
                ...assignments.map((agent) => h("option", { value: agent.id, key: agent.id, disabled: !agent.enabled },
                  `${agent.name}${agent.enabled ? "" : " (unavailable)"}`)))) : null,
            h("h3", null, "Process"),
            process?.description ? h(MarkdownText, { text: process.description }) : h("p", { className: "bees-muted" }, "No description"),
            h("h3", null, "Description"),
            item.description ? h(MarkdownText, { text: item.description }) : h("p", { className: "bees-muted" }, "No description"),
            h("div", { className: "bees-detail-actions" }, h(Button, { onClick: edit }, "Edit"), h(Button, { onClick: addSubitem }, "Delegate work"))
          ) : activeTab === "files" ? h(React.Fragment, null,
            h("h3", null, "Inputs"),
            h("div", { className: "bees-detail-actions", style: { marginBottom: "12px" } }, h(Button, { onClick: addFile }, "Add inputs")),
            h("h3", null, "Generated Files"),
            run?.outputs.length ? h("p", null, run.outputs.join(", ")) : h("p", { className: "bees-muted" }, "No outputs generated yet.")
          ) : activeTab === "runs" ? h(React.Fragment, null,
            h("h3", { className: "bees-section-title" }, "Runs"),
            itemRuns.length ? h("div", { className: "bees-run-list" }, ...itemRuns.map((row) => h("button", { className: `bees-run-row ${row.id === run?.id ? "active" : ""}`, key: row.id, onClick: () => setSelectedRun(row.id) },
              h("span", { className: `bees-status bees-${row.status}` }, row.status), h("span", null, new Date(row.updatedAt).toLocaleString()), h("span", { className: "bees-grow" }), h("span", { className: "bees-muted" }, `${row.outputs.length} outputs`)))) : h(Empty, null, "No runs yet")
          ) : h(React.Fragment, null,
            h("h3", null, "Audit"),
            ...(events.length ? events.map((event) => h(AuditEvent, {
              event, key: event.id,
              detail: event.metadata?.action ?? event.metadata?.outcome,
              onOpen: runAudit.has(event.executionId) ? () => { setSelectedRun(event.executionId); setActiveTab("runs"); } : null,
              openLabel: "Open run"
            })) : [h("p", { className: "bees-muted", key: "none" }, "No audit events for this work item yet")])
          )
        )
      )
    )
  );
}

function WorkItemCockpit({ ctx, data, rootId, teamId, act, onBack }) {
  const root = data.items.find(({ id }) => id === rootId);
  const [selectedId, setSelectedId] = useState(rootId);
  useEffect(() => setSelectedId(rootId), [rootId]);
  const visibleIds = new Set([rootId]);
  for (let added = true; added;) {
    added = false;
    for (const item of data.items) if ((!root || item.processId === root.processId) && item.parentId && visibleIds.has(item.parentId) && !visibleIds.has(item.id)) {
      visibleIds.add(item.id); added = true;
    }
  }
  const items = data.items.filter(({ id, archivedAt }) => visibleIds.has(id) && !archivedAt);
  if (!root) return h(Empty, null, "Work item not found");
  const process = data.processes.find(({ id }) => id === root.processId);
  const stages = data.stages.filter(({ processId }) => processId === root.processId);
  const selected = items.find(({ id }) => id === selectedId) ?? root;
  const latest = new Map();
  for (const run of data.runs) if (run.workItemId && !latest.has(run.workItemId)) latest.set(run.workItemId, run);
  const lineage = (item) => {
    const names = []; let current = item;
    while (current?.parentId && visibleIds.has(current.parentId)) {
      current = data.items.find(({ id }) => id === current.parentId);
      if (current) names.unshift(current.title);
    }
    return names.join(" → ");
  };
  const completed = items.filter(({ completed }) => completed).length;
  const total = items.length;
  return h("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } },
    h("header", { className: "bees-cockpit-head" }, h(Button, { onClick: onBack }, "← Work"),
      h("div", null, h("h2", null, root.title), h("div", { className: "bees-muted" }, `${process?.name ?? "Process"} · ${completed} of ${total} work items complete`))),
    h("div", { className: "bees-board bees-cockpit-board" }, ...stages.map((stage) => {
      const rows = items.filter(({ stageId }) => stageId === stage.id);
      return h("section", { className: "bees-column", key: stage.id },
        h("header", { className: "bees-column-head" }, stage.name, h("span", { className: "bees-count" }, rows.length)),
        h("div", { className: "bees-cards" }, ...(rows.length ? rows.map((item) => {
          const run = latest.get(item.id); const parentPath = lineage(item);
          const routedAgent = data.assignments.find(({ id }) => id === (run?.resolvedAgentId ?? item.agentAssignmentId));
          return h("button", { className: `bees-hierarchy-card ${selected.id === item.id ? "active" : ""}`, key: item.id, onClick: () => setSelectedId(item.id) },
            h("h3", null, item.title), h("div", { className: "bees-lineage bees-muted" }, item.id === root.id ? "Root work item" : parentPath || "Delegated work"),
            h("div", { className: "bees-muted" }, [item.runtimePhase, routedAgent?.name, run?.status].filter(Boolean).join(" · ")));
        }) : [h(Empty, { key: "empty" }, "No work in this stage")])));
    })),
    h(WorkItemDetails, { data, item: selected, teamId, act, onArchived: onBack })
  );
}

function WorkItemForm({ data, kind, workspaceId, defaultProcessId, act, onCancel, onCreated }) {
  const processes = data.processes.filter((process) => process.workspaceId === workspaceId);
  const assignments = data.assignments.filter((assignment) => assignment.workspaceId === workspaceId);
  const goal = kind === "goal";
  if (!workspaceId) return h("div", { className: "bees-stack" },
    h("div", { className: "bees-page-head" }, h(Button, { onClick: onCancel }, "← Work"), h("h2", null, goal ? "New goal" : "New work")),
    h(Empty, null, "Choose one workspace before creating work."));
  if (!goal && !processes.length) return h("div", { className: "bees-stack" },
    h("div", { className: "bees-page-head" }, h(Button, { onClick: onCancel }, "← Work"), h("h2", null, "New work")),
    h(Empty, null, "Create a process first. Work always follows a process so Bees knows its stages."));
  return h("form", { className: "bees-box bees-form", onSubmit: async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const command = goal ? {
      action: "create_goal", workspaceId, title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""), priority: String(form.get("priority") ?? "normal")
    } : {
      action: "create_item", processId: String(form.get("processId") ?? ""),
      title: String(form.get("title") ?? ""), description: String(form.get("description") ?? ""),
      priority: String(form.get("priority") ?? "normal"), agentAssignmentId: String(form.get("agentAssignmentId") ?? "") || null
    };
    const created = await act(command); if (created?.id) onCreated(created.id);
  } },
    h("div", { className: "bees-page-head" }, h(Button, { onClick: onCancel }, "← Work"),
      h("div", null, h("h2", null, goal ? "New goal" : "New work"),
        h("div", { className: "bees-muted" }, goal
          ? "Describe the outcome. Bees will plan and execute the work needed to reach it."
          : "Create the whole work item here, then Bees starts it in the process's first stage."))),
    !goal ? h("label", null, "Process", h("select", { className: "bees-select", name: "processId", required: true,
      defaultValue: processes.some(({ id }) => id === defaultProcessId) ? defaultProcessId : processes[0]?.id },
      ...processes.map((process) => h("option", { value: process.id, key: process.id }, process.name)))) : null,
    h("label", null, goal ? "Goal" : "Title", h("input", { className: "bees-input", name: "title", required: true, autoFocus: true,
      placeholder: goal ? "Launch the product successfully" : "Draft the launch announcement" })),
    h("label", null, "What does success look like?", h("textarea", { className: "bees-textarea", name: "description",
      placeholder: "Include the result, constraints, and evidence Bees should produce." })),
    h("div", { className: "bees-form-row" },
      h("label", null, "Priority", h("select", { className: "bees-select", name: "priority", defaultValue: "normal" },
        h("option", { value: "low" }, "Low"), h("option", { value: "normal" }, "Normal"), h("option", { value: "high" }, "High"))),
      !goal ? h("label", null, "Agent override (optional)", h("select", { className: "bees-select", name: "agentAssignmentId", defaultValue: "" },
        h("option", { value: "" }, "Use each stage's assigned agent"),
        ...assignments.map((agent) => h("option", { value: agent.id, key: agent.id, disabled: !agent.enabled }, agent.name)))) : null),
    h("div", { className: "bees-detail-actions" }, h("button", { className: "bees-btn primary" }, goal ? "Create goal" : "Create work"),
      h(Button, { onClick: onCancel }, "Cancel"))
  );
}

function displayOption(label) {
  const text = String(label);
  const recommended = /\s*\(recommended\)\s*$/i.test(text);
  return { label: text.replace(/\s*\(recommended\)\s*$/i, ""), recommended };
}

function FilePreview({ target }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setFile(null); setError("");
    const query = new URLSearchParams({ executionId: target.executionId, path: target.path });
    request(`/bees-api/run-file?${query}`).then((value) => { if (current) setFile(value); })
      .catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { current = false; };
  }, [target.executionId, target.path]);
  return h("section", { className: "bees-file-preview", "aria-label": "File contents" },
    h("div", { className: "bees-file-preview-head" }, h("strong", null, file?.path ?? target.path)),
    error ? h("div", { className: "bees-error", role: "alert" }, error)
      : !file ? h("div", { className: "bees-loading" }, "Opening file…")
        : file.format === "markdown" ? h(MarkdownText, { text: file.content }) : h("pre", null, file.content)
  );
}

function QuestionPanel({ wait, onAnswered }) {
  const pending = useMemo(() => new PendingQuestion(wait), [wait]);
  const questions = pending.questions ?? [];
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState(() => questions.map(() => ({ selected: [], custom: "", skipped: false })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const question = questions[index];
  if (!question) return h(Empty, null, "The agent sent an empty question request.");
  const draft = drafts[index];
  const setDraft = (change) => setDrafts((current) => current.map((value, itemIndex) => itemIndex === index ? change(value) : value));
  const choose = (label) => setDraft((current) => ({
    ...current,
    selected: question.multiSelect === true
      ? current.selected.includes(label) ? current.selected.filter((value) => value !== label) : [...current.selected, label]
      : [label],
    custom: question.multiSelect === true ? current.custom : "",
    skipped: false
  }));
  const submit = async (nextDrafts) => {
    setBusy(true); setError("");
    try {
      await pending.answer({ answers: questions.map((item, itemIndex) => {
        const answer = nextDrafts[itemIndex];
        return { id: item.id, selected: answer.selected, ...(answer.custom.trim() ? { custom: answer.custom.trim() } : {}) };
      }) });
      onAnswered(wait.key);
    } catch (reason) { setBusy(false); setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const continueFlow = (nextDrafts = drafts) => {
    const answer = nextDrafts[index];
    if (!answer.skipped && !answer.selected.length && !answer.custom.trim()) {
      setError("Choose an option or enter an answer."); return;
    }
    setError("");
    if (index < questions.length - 1) setIndex((current) => current + 1);
    else void submit(nextDrafts);
  };
  const skip = () => {
    const next = drafts.map((value, itemIndex) => itemIndex === index
      ? { selected: [], custom: "", skipped: true } : value);
    setDrafts(next); continueFlow(next);
  };
  const custom = (event) => {
    const value = event.target.value;
    setDraft((current) => ({ ...current, custom: value, selected: question.multiSelect === true ? current.selected : [], skipped: false }));
  };
  return h(React.Fragment, null,
    h("div", null,
      h("div", { className: "bees-muted" }, [question.header, questions.length > 1 ? `Question ${index + 1} of ${questions.length}` : ""].filter(Boolean).join(" · ")),
      h("h3", { className: "bees-section-title" }, question.question)),
    question.detail ? h("div", { className: "bees-question-detail" }, h(MarkdownText, { text: question.detail })) : null,
    h("div", { className: "bees-question-options", role: question.multiSelect === true ? "group" : "radiogroup" },
      ...(question.options ?? []).map((option, optionIndex) => {
        const selected = draft.selected.includes(option.label);
        const shown = displayOption(option.label);
        return h("button", {
          type: "button", key: `${option.label}:${optionIndex}`, disabled: busy,
          className: `bees-choice ${selected ? "selected" : ""}`,
          role: question.multiSelect === true ? "checkbox" : "radio", "aria-checked": selected,
          onClick: () => choose(option.label)
        }, h("span", { className: "bees-choice-mark", "aria-hidden": "true" }, question.multiSelect === true ? selected ? "✓" : "" : optionIndex + 1),
          h("span", { className: "bees-choice-copy" }, h("strong", null, shown.label, shown.recommended ? " · Recommended" : ""),
            option.description ? h("span", { className: "bees-muted" }, option.description) : null));
      }),
      (question.options ?? []).length ? h("input", {
        className: "bees-input", type: "text", value: draft.custom, disabled: busy,
        placeholder: question.multiSelect === true ? "Add another answer (optional)" : "Or type another answer",
        onChange: custom, onKeyDown: (event) => {
          if (event.key === "Enter" && !event.nativeEvent?.isComposing) { event.preventDefault(); continueFlow(); }
        }
      }) : h("textarea", {
        className: "bees-textarea", value: draft.custom, disabled: busy, autoFocus: true,
        placeholder: "Type your answer", onChange: custom,
        onKeyDown: (event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); continueFlow(); }
        }
      })),
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
    h("div", { className: "bees-answer-actions" },
      index > 0 ? h(Button, { disabled: busy, onClick: () => { setIndex((current) => current - 1); setError(""); } }, "Back") : null,
      h(Button, { disabled: busy, onClick: skip }, "Skip"), h("div", { className: "bees-grow" }),
      h(Button, { className: "primary", disabled: busy, onClick: () => continueFlow() }, busy ? "Sending…" : index < questions.length - 1 ? "Next" : "Send answer"))
  );
}

function ApprovalPanel({ wait, onAnswered }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const answer = async (outcome) => {
    setBusy(outcome); setError("");
    try {
      const receipt = await wait.respond({ ok: true, value: {
        sessionId: wait.sessionId, approvalId: wait.payload.approvalId, outcome
      } });
      if (!receipt.accepted) throw new Error(`approval response rejected: ${receipt.reason}`);
      onAnswered(wait.key);
    } catch (reason) { setBusy(""); setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return h(React.Fragment, null,
    h("div", null, h("div", { className: "bees-muted" }, wait.payload.toolName || "Agent action"),
      h("h3", { className: "bees-section-title" }, "Approve this action?")),
    wait.payload.reason ? h("div", { className: "bees-question-detail" }, h(MarkdownText, { text: wait.payload.reason })) : null,
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
    h("div", { className: "bees-answer-actions" },
      h(Button, { className: "danger", disabled: Boolean(busy), onClick: () => void answer("rejected") }, busy === "rejected" ? "Denying…" : "Deny"),
      h(Button, { className: "primary", disabled: Boolean(busy), onClick: () => void answer("allowed-once") }, busy === "allowed-once" ? "Approving…" : "Approve once"))
  );
}

const interactionName = (kind) => kind === "approval" ? "Approval" : kind === "plan-review" ? "Plan review" : "Question";

function NeedsYouControls({ item, act, onDone }) {
  const [busy, setBusy] = useState("");
  if (!item || !act) return null;
  const invoke = async (action) => {
    setBusy(action);
    const result = await act({ action, itemId: item.id });
    setBusy("");
    if (result) onDone?.();
  };
  const archive = async () => {
    if (!await confirmAction(`Archive “${item.title}”? Active work will be cancelled. Its history will be preserved.`)) return;
    await invoke("archive_item");
  };
  return h(React.Fragment, null,
    item.runtimePhase === "failed" ? h(Button, {
      className: "primary", disabled: Boolean(busy), onClick: () => void invoke("retry_item")
    }, busy === "retry_item" ? "Retrying…" : "Retry") : null,
    ["running", "waiting", "paused", "failed"].includes(item.runtimePhase) ? h(Button, {
      disabled: Boolean(busy), onClick: () => void invoke("cancel_item")
    }, busy === "cancel_item" ? "Stopping…" : "Stop") : null,
    h(Button, { className: "danger", disabled: Boolean(busy), onClick: () => void archive() },
      busy === "archive_item" ? "Archiving…" : "Archive"));
}

function AgentInteractionPanel({ run, item, title, summary, session, interaction, handled, onAnswered, onOpen, openLabel, act, onControlled }) {
  const files = run.files ?? (run.outputs ?? []).map((path) => `outputs/${path}`);
  const [viewer, setViewer] = useState(files.length ? { executionId: run.id, path: files[0] } : null);
  const fileKey = files.join("|");
  useEffect(() => setViewer((current) => files.length
    ? current?.executionId === run.id && files.includes(current.path)
      ? current : { executionId: run.id, path: files[0] }
    : null), [run.id, fileKey]);
  return h("section", { className: "bees-box bees-answer-card" },
    h("div", { className: "bees-answer-head" }, h("div", null,
      h("div", { className: "bees-status" }, interactionName(summary?.pendingInteraction ?? interaction?.kind)),
      h("h2", null, item?.title ?? title ?? summary?.displayTitle ?? "Agent run")),
    h("div", { className: "bees-grow" }), h("div", { className: "bees-answer-controls" },
      onOpen ? h(Button, { onClick: onOpen }, openLabel) : null,
      h(NeedsYouControls, { item, act, onDone: onControlled }))),
    interaction?.kind === "question" ? h(QuestionPanel, { key: interaction.key, wait: interaction, onAnswered })
      : interaction?.kind === "approval" ? h(ApprovalPanel, { key: interaction.key, wait: interaction, onAnswered })
        : h(Empty, null, run.status === "interrupted"
          ? "The prior request was interrupted. Retry the work to ask again."
          : session?.pending?.some(({ key }) => handled.has(key)) ? "Answer sent. Waiting for the agent…" : "Loading the agent's request…"),
    files.length ? h("div", { className: "bees-file-list" }, h("span", { className: "bees-muted" }, "Files"),
      ...files.map((path) => h(Button, { className: `bees-file-chip ${viewer?.path === path ? "active" : ""}`, key: path, title: path,
        onClick: () => setViewer({ executionId: run.id, path }) }, path))) : null,
    viewer ? h(FilePreview, { target: viewer }) : null
  );
}

function useNeedsYouQueue(ctx, data, workspaceIds, initialSelectedId = "", autoSelect = true) {
  const sessions = useSnapshot(ctx.sessions.list, { ids: [], byId: {} });
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [handled, setHandled] = useState(() => new Set());
  const [handledRuns, setHandledRuns] = useState(() => new Set());
  const seen = new Set();
  const rows = data.runs.filter((run) => workspaceIds.includes(run.workspaceId) && run.sessionId)
    .map((run) => ({ run, session: sessions.byId[run.sessionId], item: data.items.find(({ id }) => id === run.workItemId) }))
    .filter(({ run }) => ["waiting_for_input", "waiting_for_approval", "interrupted"].includes(run.status) && !seen.has(run.sessionId) && seen.add(run.sessionId));
  const rowKey = rows.map(({ run, session }) => `${run.id}:${session?.pendingInteraction ?? "none"}`).join("|");
  useEffect(() => setSelectedId((current) => rows.some(({ run }) => run.id === current)
    ? current : autoSelect ? rows[0]?.run.id ?? "" : ""), [rowKey, autoSelect]);
  useEffect(() => setHandledRuns((current) => new Set([...current].filter((id) => rows.some(({ run }) => run.id === id)))), [rowKey]);
  const selected = rows.find(({ run }) => run.id === selectedId) ?? rows[0];
  const binding = selected ? ctx.sessions.binding(selected.run.sessionId) : null;
  const session = useSnapshot(binding?.session);
  const interaction = session?.pending?.find((pending) => !handled.has(pending.key) &&
    (selected?.session?.pendingInteraction === "plan-review" ? pending.kind === "question" : pending.kind === selected?.session?.pendingInteraction))
    ?? session?.pending?.find((pending) => !handled.has(pending.key));
  const actionableRunIds = new Set(rows.map(({ run }) => run.id));
  const blocked = data.runs.filter((run) => workspaceIds.includes(run.workspaceId) &&
    ["waiting_for_input", "waiting_for_approval", "interrupted"].includes(run.status) && !actionableRunIds.has(run.id));
  const answered = (key, candidates = rows) => {
    setHandled((current) => new Set(current).add(key));
    const completed = new Set(handledRuns);
    if (selected) completed.add(selected.run.id);
    setHandledRuns(completed);
    const next = candidates.find(({ run }) => !completed.has(run.id));
    if (next) setSelectedId(next.run.id);
  };
  return { rows, selected, selectedId, setSelectedId, session, interaction, handled, blocked, answered };
}

export function NeedsYouWidget({ ctx, data, workspaceIds, act, openNeedsYou, rowsForRoute, limit = 8 }) {
  const queue = useNeedsYouQueue(ctx, data, workspaceIds, "", false);
  const liveByItemId = new Map(queue.rows.filter(({ item }) => item).map((row) => [row.item.id, row]));
  const listedItemIds = new Set();
  const records = rowsForRoute("waiting").map((row) => {
    listedItemIds.add(row.id);
    return { id: row.id, label: row.label, open: row.open, live: liveByItemId.get(row.id) };
  });
  for (const live of queue.rows) if (!live.item || !listedItemIds.has(live.item.id)) {
    records.push({ id: live.run.id, label: live.item?.title ?? runTitle(data, live.run) ?? live.session?.displayTitle, live });
  }
  const visibleRecords = records.slice(0, limit);
  const visibleLiveRows = visibleRecords.flatMap(({ live }) => live ? [live] : []);
  const selected = visibleLiveRows.find(({ run }) => run.id === queue.selectedId);
  const select = (runId) => queue.setSelectedId((current) => current === runId ? "" : runId);
  return h("div", { className: "bees-dashboard-needs" },
    visibleRecords.length ? h("div", { className: "bees-dashboard-list", "aria-label": "Work needing attention" }, ...visibleRecords.map((record) => {
      const { live } = record;
      const panelId = live ? `bees-dashboard-need-${live.run.id}` : undefined;
      return h("div", { className: "bees-dashboard-need-row", key: record.id },
        h("button", {
          type: "button", className: `bees-dashboard-row ${live?.run.id === selected?.run.id ? "active" : ""}`,
          title: record.label, ...(live ? {
            "aria-expanded": live.run.id === selected?.run.id, "aria-controls": panelId,
            onClick: () => select(live.run.id)
          } : { onClick: record.open })
        }, h("span", { className: "bees-dashboard-need-copy" }, record.label),
          h("span", { className: "bees-badge" }, live ? interactionName(live.session?.pendingInteraction) : "Blocked")),
        h("button", {
          type: "button", className: "bees-dashboard-launch", title: `Open ${record.label} in Needs you`,
          "aria-label": `Open ${record.label} in Needs you`, onClick: () => openNeedsYou(live?.run.id ?? "")
        }, "↗"));
    })) : h(Empty, null, "Nothing needs you right now."),
    selected ? h("div", { className: "bees-dashboard-needs-answer", id: `bees-dashboard-need-${selected.run.id}` },
      h(AgentInteractionPanel, {
        run: selected.run, item: selected.item, title: runTitle(data, selected.run), summary: selected.session,
        session: queue.session, interaction: queue.interaction, handled: queue.handled,
        onAnswered: (key) => queue.answered(key, visibleLiveRows), act,
        onControlled: () => queue.answered(`control:${selected.run.id}`, visibleLiveRows)
      })) : null,
    h(Button, { className: "bees-dashboard-view-all", onClick: () => openNeedsYou("") }, "View all")
  );
}

export function NeedsYouPage({ ctx, data, workspaceIds, act, openWorkItem, openRun, initialSelectedId = "" }) {
  const { rows, selected, selectedId, setSelectedId, session, interaction, handled, blocked, answered } =
    useNeedsYouQueue(ctx, data, workspaceIds, initialSelectedId);
  return h(React.Fragment, null,
    h("div", { className: "bees-callout" }, h("h3", null, "Answer agents without leaving the queue"),
      h("div", null, "Questions and approvals update live. After you answer, Bees moves to the next waiting agent.")),
      rows.length ? h("div", { className: "bees-inbox" },
        h("div", { className: "bees-inbox-list", "aria-label": "Waiting agents" }, ...rows.map(({ run, session: summary, item }) => {
          const agent = data.assignments.find(({ id }) => id === run.resolvedAgentId);
          const rowTitle = item?.title ?? runTitle(data, run) ?? summary?.displayTitle;
          return h("button", { type: "button", className: `bees-inbox-row ${run.id === selected?.run.id ? "active" : ""}`, key: run.id, onClick: () => setSelectedId(run.id) },
            h("span", { className: "bees-inbox-dot", "aria-hidden": "true" }),
            h("span", { className: "bees-inbox-copy" }, h("strong", null, rowTitle),
              h("span", { className: "bees-muted" }, agent?.name ?? summary?.agentPreset ?? "Agent")),
            h("span", { className: "bees-badge" }, interactionName(summary?.pendingInteraction)));
        })),
        h(AgentInteractionPanel, {
          run: selected.run, item: selected.item, title: runTitle(data, selected.run), summary: selected.session, session, interaction, handled,
          onAnswered: answered, act, onControlled: () => answered(`control:${selected.run.id}`),
          onOpen: selected.item ? () => openWorkItem(selected.item.id) : () => openRun(selected.run.id),
          openLabel: selected.item ? "Open work" : "Open run"
        })
    ) : h(Empty, null, "No live agent questions or approvals right now"),
    blocked.length ? h("section", { className: "bees-blocked" }, h("h3", null, "Other blocked work"),
      ...blocked.map((run) => {
        const item = data.items.find(({ id }) => id === run.workItemId);
        return h("div", { className: "bees-row", key: run.id }, h("div", { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, item?.title ?? runTitle(data, run)),
          h("div", { className: "bees-muted" }, run.status === "interrupted" ? "The prior wait was interrupted; retry the work to ask again." : "Reconnect to the agent or open the work item to recover.")),
          h(NeedsYouControls, { item, act }),
          h(Button, { onClick: item ? () => openWorkItem(item.id) : () => openRun(run.id) }, item ? "Open work" : "Open run"));
      })) : null
  );
}

export function WorkPage({ ctx, data, route, workspaceIds, workspaceId, teamId, workItemId, setWorkItemId, creating, setCreating, defaultProcessId, act }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(route === "completed" ? "completed" : "all");
  const [type, setType] = useState(route === "goals" ? "goal" : "all");
  if (workItemId) return h(WorkItemCockpit, { ctx, data, rootId: workItemId, teamId, act, onBack: () => setWorkItemId("") });
  if (["work", "goal"].includes(creating)) return h(WorkItemForm, {
    data, kind: creating, workspaceId, defaultProcessId, act, onCancel: () => setCreating(""),
    onCreated: (id) => { setCreating(""); setWorkItemId(id); }
  });
  const items = data.items.filter((item) => workspaceIds.includes(data.processes.find(({ id }) => id === item.processId)?.workspaceId) && item.kind !== "run");
  const itemStatus = (item) => isDone(item) ? "completed" : item.runtimePhase || "pending";
  const statuses = [...new Set(items.map(itemStatus))].sort();
  const types = [...new Set(items.map(({ kind }) => kind))].sort();
  const needle = query.trim().toLocaleLowerCase();
  const rows = items.filter((item) => (!needle || item.title.toLocaleLowerCase().includes(needle)) &&
    (status === "all" || itemStatus(item) === status) && (type === "all" || item.kind === type));
  return h("div", null,
    h("div", { className: "bees-row" },
      h("input", { className: "bees-input bees-grow", value: query, onChange: (event) => setQuery(event.target.value),
        placeholder: "Search by task name", "aria-label": "Search work items by task name" }),
      h("select", { className: "bees-select", value: status, onChange: (event) => setStatus(event.target.value), "aria-label": "Filter by status" },
        h("option", { value: "all" }, "All statuses"),
        ...statuses.map((value) => h("option", { value, key: value }, value))),
      h("select", { className: "bees-select", value: type, onChange: (event) => setType(event.target.value), "aria-label": "Filter by type" },
        h("option", { value: "all" }, "All types"),
        ...types.map((value) => h("option", { value, key: value }, value === "goal" ? "Goals" : value === "work" ? "Work items" : value))),
      h(Button, { disabled: !workspaceId, onClick: () => setCreating("goal") }, "New goal"),
      h(Button, { className: "primary", disabled: !workspaceId, onClick: () => setCreating("work") }, "New work")),
    ...(rows.length ? rows.map((item) => {
      const process = data.processes.find(({ id }) => id === item.processId);
      const stage = data.stages.find(({ id }) => id === item.stageId);
      return h("button", { className: "bees-row bees-nav-link", key: item.id, onClick: () => setWorkItemId(item.id) },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, item.title), h("div", { className: "bees-muted" }, `${item.kind} · ${process?.name ?? "Process"} · ${stage?.name ?? "Stage"}`)),
        h("span", { className: `bees-status bees-${itemStatus(item)}` }, itemStatus(item)));
    }) : [h(Empty, { key: "empty" }, "No work items match these filters")])
  );
}
