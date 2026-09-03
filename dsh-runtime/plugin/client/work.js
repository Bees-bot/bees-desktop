import {
  h, MarkdownText, PendingQuestion, React, useEffect, useMemo, useState
} from "./runtime.js";
import Cron, { HEADER } from "react-cron-generator";
import {
  ask, AuditEvent, Button, clip, confirmAction, Empty, isDone, isScheduleDefinition, PageHead, request, runTitle, useBeesChangeRevision, useSnapshot, useSubmit, workItemStatus, HelpTooltip
} from "./shared.js";
import { applyWorkItemLayout, workItemLayoutFrom } from "./dashboard-model.js";
import { FlexibleGrid, GridStackPage } from "./flexible-grid.js";
import { addLocationFromDevice, FilePreview, inheritedInputs, ResourceFields, WorkFiles } from "./location-fields.js";

const UserMessage = ({ children, label }) => {
  const [expanded, setExpanded] = useState(false);
  const truncated = children.length > 280;
  return h("div", { className: "bees-convo-msg user" },
    label ? h("strong", null, label) : null,
    h("div", null, truncated && !expanded ? `${clip(children, 280).trimEnd()}…` : children),
    truncated ? h("button", {
      type: "button", "aria-expanded": expanded, onClick: () => setExpanded((value) => !value),
      style: { display: "block", marginTop: 6, padding: 0, border: 0, color: "inherit", background: "none", font: "inherit", fontSize: 12, fontWeight: 700, textDecoration: "underline", cursor: "pointer" }
    }, expanded ? "Show less" : "Show more") : null);
};

/** The goal opens the conversation, so a run reads from the ask down. */
const GoalMessage = ({ item }) => h(UserMessage, { label: "Goal" }, item.description || item.title);

const WORK_PAGE_LAYOUT = [
  { kind: "active-work", x: 0, y: 0, w: 12, h: 6 },
  { kind: "finished-work", x: 0, y: 6, w: 12, h: 6 }
];

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

function scheduleSummary(recurring) {
  const value = recurring.schedule;
  if (recurring.scheduleKind === "interval") return `Every ${value.everyMinutes === 60 ? "hour" : `${value.everyMinutes} minutes`} · UTC anchor ${new Date(value.anchorUtc).toLocaleString()}`;
  if (recurring.scheduleKind === "cron") return `${value.expression} · ${recurring.timezone}`;
  const time = `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
  if (value.frequency === "weekly") return `${value.dayOfWeek.toLowerCase()} at ${time} · ${recurring.timezone}`;
  if (value.frequency === "monthly") return `Day ${value.dayOfMonth} at ${time} · ${recurring.timezone}`;
  return `Daily at ${time} · ${recurring.timezone}`;
}

function ScheduleForm({ item, recurring, act, onClose, onCreated }) {
  const current = recurring?.schedule ?? {};
  const currentFrequency = recurring?.scheduleKind === "cron" ? "advanced"
    : recurring?.scheduleKind === "interval" ? "hourly" : current.frequency || "daily";
  const [name, setName] = useState(recurring?.name ?? `Daily ${item.title}`.slice(0, 120));
  const [frequency, setFrequency] = useState(currentFrequency);
  const [time, setTime] = useState(`${String(current.hour ?? 9).padStart(2, "0")}:${String(current.minute ?? 0).padStart(2, "0")}`);
  const [dayOfWeek, setDayOfWeek] = useState(current.dayOfWeek ?? "MONDAY");
  const [dayOfMonth, setDayOfMonth] = useState(current.dayOfMonth ?? 1);
  const [timezone, setTimezone] = useState(recurring?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
  const [cronExpression, setCronExpression] = useState(current.expression ?? "0 9 * * *");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    const [hour, minute] = time.split(":").map(Number);
    try {
      const result = await act({
        action: recurring ? "edit_recurring_work" : "create_recurring_work",
        ...(recurring ? { recurringWorkId: recurring.id } : { itemId: item.id }),
        name, frequency, hour, minute, dayOfWeek, dayOfMonth: Number(dayOfMonth), timezone,
        cronExpression, everyMinutes: 60, anchorUtc: current.anchorUtc || new Date().toISOString()
      });
      if (!result) throw new Error("The schedule could not be saved");
      onClose();
      if (!recurring && result.sourceWorkItemId) onCreated?.(result.sourceWorkItemId);
    } catch (reason) { setBusy(false); setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return h("div", { className: "bees-modal-backdrop", role: "presentation" },
    h("form", { className: "bees-box bees-form bees-modal", role: "dialog", "aria-modal": "true", "aria-label": recurring ? "Edit recurring work" : "Schedule work", onSubmit: submit },
      h("div", { className: "bees-row" }, h("div", null,
        h("h2", { style: { display: "flex", alignItems: "center" } }, (recurring ? "Edit recurring work" : "Schedule this work"), h("span", { style: { flex: 1 } }), h(HelpTooltip, { text: "Schedules automatically create new process runs for this work on a regular basis. You can use this for any repeatable task.", examples: ["A daily schedule to run an 'Inbox Triage' process at 9 AM", "A weekly schedule for 'Prepare Status Report'", "An advanced cron schedule to trigger 'System Backup'"] })),
        h("p", { className: "bees-muted" }, "Bees creates a new primary work item at the process's starting stage. Delegated child work is not copied. Each scheduled occurrence is fresh, and learning stays inside this named recurring work."))),
      h("label", null, "Name", h("input", { className: "bees-input", value: name, maxLength: 120, required: true, autoFocus: true, onChange: (event) => setName(event.target.value) })),
      h("label", null, "Frequency", h("select", { className: "bees-select", value: frequency, onChange: (event) => setFrequency(event.target.value) },
        h("option", { value: "hourly" }, "Hourly"), h("option", { value: "daily" }, "Daily"),
        h("option", { value: "weekly" }, "Weekly"), h("option", { value: "monthly" }, "Monthly"),
        h("option", { value: "advanced" }, "Advanced (cron)"))),
      frequency === "hourly" ? h("p", { className: "bees-callout" }, "Runs every hour from a UTC anchor, so daylight-saving changes do not alter the interval.") :
        frequency === "advanced" ? h(React.Fragment, null,
          h("div", { className: "bees-cron-generator" }, h(Cron, {
            value: cronExpression, isUnix: true, showResultText: true, showResultCron: true,
            options: { headers: [HEADER.MINUTES, HEADER.HOURLY, HEADER.DAILY, HEADER.WEEKLY, HEADER.MONTHLY, HEADER.CUSTOM] },
            onChange: (value) => setCronExpression(value)
          })),
          h("p", { className: "bees-muted" }, "Advanced uses a five-field Unix cron expression. Temporal validates it again before saving.")) :
          h(React.Fragment, null,
            frequency === "weekly" ? h("label", null, "Day", h("select", { className: "bees-select", value: dayOfWeek, onChange: (event) => setDayOfWeek(event.target.value) },
              ...WEEKDAYS.map((day) => h("option", { value: day, key: day }, day[0] + day.slice(1).toLowerCase())))) : null,
            frequency === "monthly" ? h("label", null, "Day of month", h("input", { className: "bees-input", type: "number", min: 1, max: 31, value: dayOfMonth, onChange: (event) => setDayOfMonth(event.target.value) })) : null,
            h("label", null, "Local time", h("input", { className: "bees-input", type: "time", value: time, required: true, onChange: (event) => setTime(event.target.value) }))),
      frequency !== "hourly" ? h("label", null, "Timezone", h("input", { className: "bees-input", value: timezone, required: true, onChange: (event) => setTimezone(event.target.value), placeholder: "America/Los_Angeles" })) : null,
      h("p", { className: "bees-muted" }, "Calendar schedules keep the chosen local clock time and IANA timezone; Temporal computes each UTC run time."),
      h("div", { className: "bees-callout" }, "Runs execute on this device. Bees must be open and the device must be available; missed runs older than one minute are not replayed automatically."),
      error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
      h("div", { className: "bees-detail-actions" }, h(Button, { onClick: onClose, disabled: busy }, "Cancel"),
        h("button", { className: "bees-btn primary", disabled: busy }, busy ? "Saving…" : recurring ? "Save changes" : "Create schedule"))));
}

function RecurringWorkPanel({ data, item, recurringWork, act, onEdit }) {
  if (!recurringWork.length) return h(Empty, null, "This work has no schedule yet. Scheduling creates an isolated learning scope for future runs.");
  return h("div", { className: "bees-stack" }, ...recurringWork.map((recurring) => {
    const specialists = data.specializations.filter(({ recurringWorkId }) => recurringWorkId === recurring.id);
    const specialistCards = specialists.map((specialist) => {
      const base = data.assignments.find(({ id }) => id === specialist.agentAssignmentId);
      const versions = data.specializationVersions.filter(({ specializationId }) => specializationId === specialist.id);
      return h("div", { className: "bees-box", key: specialist.id },
        h("strong", null, specialist.name),
        h("div", { className: "bees-muted" }, `Base agent: ${base?.name || "Unknown"} · Version ${specialist.revision}`),
        specialist.playbook ? h("pre", { className: "bees-playbook" }, specialist.playbook)
          : h("p", { className: "bees-muted" }, "No learned guidance yet; this specialist currently behaves like its base agent."),
        h("div", { className: "bees-detail-actions" },
          h(Button, { onClick: async () => {
            const playbook = await ask("Edit specialist playbook", specialist.playbook);
            if (playbook !== null) await act({ action: "edit_specialist_playbook", specializationId: specialist.id, playbook });
          } }, "Edit"),
          h(Button, { disabled: specialist.revision < 1, onClick: () => act({ action: "undo_specialist_playbook", specializationId: specialist.id }) }, "Undo"),
          h(Button, { disabled: !specialist.playbook, onClick: async () => {
            if (await confirmAction(`Reset “${specialist.name}” to its base agent behavior?`))
              await act({ action: "reset_specialist_playbook", specializationId: specialist.id });
          } }, "Reset")),
        versions.length ? h("details", null,
          h("summary", null, "Version history"),
          ...versions.map((version) => h("div", { className: "bees-muted", key: version.id },
            `v${version.revision} · ${version.source} · ${new Date(version.createdAt).toLocaleString()}${version.feedback ? ` · ${clip(version.feedback, 120)}` : ""}`))) : null);
    });
    return h("section", { className: "bees-callout", key: recurring.id },
      h("div", { className: "bees-row" },
        h("div", { className: "bees-row-main" },
          h("h3", null, recurring.name),
          h("div", { className: "bees-muted" }, `${recurring.status} · ${scheduleSummary(recurring)}`),
          h("div", { className: "bees-muted" }, recurring.nextRunAt
            ? `Next: ${new Date(recurring.nextRunAt).toLocaleString()} · ${recurring.nextRunAt} UTC`
            : "Next run will appear after Temporal computes it.")),
        h("div", { className: "bees-detail-actions" },
          h(Button, { onClick: () => onEdit(recurring) }, "Edit schedule"),
          h(Button, { onClick: () => act({
            action: recurring.status === "paused" ? "resume_recurring_work" : "pause_recurring_work",
            recurringWorkId: recurring.id
          }) }, recurring.status === "paused" ? "Resume" : "Pause"))),
      h("h4", null, "Specialist playbooks"),
      ...(specialistCards.length ? specialistCards
        : [h("p", { className: "bees-muted", key: "empty" }, "Specialists are created automatically the first time each base agent handles a run.")])
    );
  }));
}

function WorkItemDetails({ ctx, data, item, teamId, act, onArchived, onScheduleCreated, board, layout, editing, onLayout, onEditSchedule, setPageHeader }) {
  const process = data.processes.find(({ id }) => id === item.processId);
  const stage = data.stages.find(({ id }) => id === item.stageId);
  const assignments = data.assignments.filter(({ workspaceId }) => workspaceId === process?.workspaceId);
  const assignment = assignments.find(({ id }) => id === item.agentAssignmentId);
  const routeAgent = assignments.find(({ id }) => id === stage?.routeTargetId);
  const routePool = data.pools.find(({ id }) => id === stage?.routeTargetId);
  const routeLabel = routeAgent?.name ?? routePool?.name ?? `Team ${stage?.driver === "review" ? "reviewer" : "worker"}`;
  const processStages = data.stages.filter(({ processId }) => processId === item.processId);
  const schedulable = processStages.length >= 2 && processStages.at(-1)?.driver === "terminal" &&
    processStages.every(({ driver }) => ["agent", "review", "terminal"].includes(driver));
  const recurringWork = (data.recurringWork ?? []).filter((recurring) =>
    recurring.sourceWorkItemId === item.id || recurring.id === item.recurringWorkId);
  const itemRuns = data.runs.filter(({ workItemId }) => workItemId === item.id);
  const inputReferences = data.attachments.filter(({ workItemId }) => workItemId === item.id);
  const resolvedAgentId = itemRuns.find((row) => row.dispatchStageId === item.stageId)?.resolvedAgentId
    ?? (stage?.driver !== "review" ? assignment?.id : null) ?? (stage?.routeType === "agent" ? routeAgent?.id
      : !stage?.routeType ? assignments.find(({ systemRole }) => systemRole === (stage?.driver === "review" ? "reviewer" : "worker"))?.id : null);
  const inherited = inheritedInputs(data, process?.id, resolvedAgentId);

  const [selectedRun, setSelectedRun] = useState("");
  const [activeTab, setActiveTab] = useState("files");

  const [handled, setHandled] = useState(() => new Set());
  const [history, setHistory] = useState(null);
  const [audit, setAudit] = useState([]);
  const convoRef = React.useRef(null);
  const run = itemRuns.find(({ id }) => id === selectedRun) ?? itemRuns[0];
  const pendingRun = itemRuns.find(({ status, sessionId }) => sessionId && ["waiting_for_input", "waiting_for_approval"].includes(status));
  // Use the latest run that has a sessionId for sending messages (not just pending ones)
  const activeRun = run?.sessionId ? run : itemRuns.find(({ sessionId }) => sessionId);
  const activeBinding = activeRun ? ctx.sessions.binding(activeRun.sessionId) : null;
  const binding = pendingRun ? ctx.sessions.binding(pendingRun.sessionId) : activeBinding;
  const session = useSnapshot(binding?.session);
  const [composerText, setComposerText] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const liveRevision = useBeesChangeRevision();
  const interaction = session?.pending?.find((pending) => !handled.has(pending.key));
  useEffect(() => {
    setSelectedRun(""); setHistory(null); setHandled(new Set());
    setActiveTab("files"); setComposerText(""); setSending(false);
  }, [item.id]);
  useEffect(() => {
    let active = true;
    if (!run) { setHistory(null); return () => { active = false; }; }
    request(`/bees-api/run-history?executionId=${encodeURIComponent(run.id)}`)
      .then((value) => active && setHistory(value.history))
      .catch((error) => active && setHistory({ error: error instanceof Error ? error.message : String(error) }));
    return () => { active = false; };
  }, [run?.id, refreshCount, liveRevision]);
  useEffect(() => {
    let interval;
    if (run && ["running", "waiting", "waiting_for_input", "waiting_for_approval"].includes(item.runtimePhase)) {
      interval = setInterval(() => setRefreshCount(c => c + 1), 5000);
    }
    return () => clearInterval(interval);
  }, [run?.id, item.runtimePhase]);
  // The audit strip is supplementary, so a failed refresh leaves it empty rather than taking the page down.
  useEffect(() => {
    let active = true;
    request("/bees-api/audit")
      .then(({ events }) => active && setAudit(events ?? []))
      .catch(() => active && setAudit([]));
    return () => { active = false; };
  }, [item.id, data.runs.length, liveRevision]);
  
  // Auto-scroll conversation robustly
  useEffect(() => {
    const scrollToBottom = () => { if (convoRef.current) convoRef.current.scrollTop = convoRef.current.scrollHeight; };
    scrollToBottom();
    let id1 = setTimeout(scrollToBottom, 50);
    let id2 = setTimeout(scrollToBottom, 300);
    return () => { clearTimeout(id1); clearTimeout(id2); };
  }, [history, pendingRun, interaction, item.runtimePhase]);
  const edit = async () => { /* reuse edit logic */
    const title = await ask("Work title", item.title); if (!title) return;
    const description = await ask("Description", item.description) ?? item.description;
    const owner = await ask("Person responsible (optional)", item.owner ?? "") ?? item.owner ?? "";
    const agentName = await ask(`Worker override (optional; blank uses stage routing):\n${assignments.map(({ name }) => name).join("\n")}`, assignment?.name ?? "");
    if (agentName === null) return;
    const nextAgent = assignments.find(({ name }) => name === agentName);
    if (agentName && !nextAgent) return;
    await act({ action: "edit_item", itemId: item.id, title, description, owner, priority: item.priority, parentId: item.parentId, agentAssignmentId: nextAgent?.id ?? null });
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
    let location = data.locations.find(({ id }) => id === (item.outputLocationId || process?.outputLocationId));
    if (!location) {
      const created = await addLocationFromDevice(ctx, act, teamId, "folder");
      if (!created?.id) return;
      await act({ action: "set_output_location", itemId: item.id, locationId: created.id });
      location = { id: created.id };
    }
    if (run && location) await act({ action: "publish_run", executionId: run.id, locationId: location.id });
  };
  const archive = async () => {
    if (!await confirmAction(`Archive “${item.title}”? Active work will be cancelled. Its history will be preserved.`)) return;
    if (await act({ action: "archive_item", itemId: item.id })) onArchived?.();
  };
  const restore = () => act({ action: "archive_item", itemId: item.id, restore: true });
  const answered = (key) => setHandled((current) => new Set(current).add(key));
  const runAudit = new Set(itemRuns.map(({ id }) => id));
  const events = audit.filter(({ executionId, metadata }) => runAudit.has(executionId) || metadata?.itemId === item.id || metadata?.parentId === item.id || metadata?.resultId === item.id);
  

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
      if (msg.role === "user") convoItems.push(h(UserMessage, { key: msg.id }, msg.parts.map(p => p.text).join(" ")));
      else if (msg.role === "context") convoItems.push(h("div", { className: "bees-convo-msg system", key: msg.id }, h("span", { style: { opacity: 0.7, marginRight: 6 } }, "⚡"), h("span", { style: { whiteSpace: "pre-wrap", wordBreak: "break-word" } }, msg.parts.map(p => p.text).join(" "))));
      else if (msg.role === "error") convoItems.push(h("div", { className: "bees-convo-msg system", key: msg.id, style: { color: "#cf5b5b" } }, h("span", { style: { fontSize: "16px" } }, "✕"), h("span", { style: { whiteSpace: "pre-wrap", wordBreak: "break-word" } }, msg.parts.map(p => p.text).join(" "))));
      else {
        const textParts = msg.parts.filter(p => p.text);
        const toolParts = msg.parts.filter(p => p.type === "tool");
        if (textParts.length) {
          convoItems.push(h("div", { className: "bees-agent-turn", key: msg.id },
            h("div", { className: "bees-agent-avatar", "aria-hidden": "true" }, "B"),
            h("div", { className: "bees-convo-msg agent" },
              h("strong", null, "Coordinator"),
              h("div", { style: { whiteSpace: "pre-wrap", wordBreak: "break-word" } }, textParts.map(p => p.text).join(" ")))));
        }
      }
    }
  } else if (history === null) {
    convoItems.push(h("div", { className: "bees-convo-msg system", key: "loading" }, "Loading conversation..."));
  } else if (history?.error) {
    convoItems.push(h("div", { className: "bees-convo-msg system", key: "hist-error", style: { color: "#cf5b5b" } }, `Failed to load history: ${history.error}`));
  } else if (events.length) {
    convoItems.push(h("div", { className: "bees-convo-msg system", key: "audit-events" }, `${events.length} background events recorded`));
  }

  // Inject subitems status
  const subitems = data.items.filter(i => i.parentId === item.id && !i.archivedAt);
  for (const sub of subitems) {
    if (["running", "waiting", "paused"].includes(sub.runtimePhase)) {
      convoItems.push(h("div", { className: "bees-convo-msg agent", key: `sub-${sub.id}` }, h("strong", null, "Agent working on"), h("div", null, sub.title), h("div", { className: "bees-working-indicator", style: { padding: 4, justifyContent: "flex-start" } }, h("span", { className: "bees-dot-typing-container" }, h("span", { className: "bees-dot-typing-dot" })))));
    } else if (sub.runtimePhase === "completed") {
      convoItems.push(h("div", { className: "bees-convo-msg agent", key: `sub-${sub.id}` }, h("strong", null, "Agent finished"), h("div", null, sub.title)));
    } else if (sub.runtimePhase === "failed") {
      convoItems.push(h("div", { className: "bees-convo-msg agent error", key: `sub-${sub.id}` }, h("strong", null, "Agent failed"), h("div", null, sub.title)));
    }
  }

  // A finished stage writes its own account of what it did. Without this the run just stops
  // and the conversation goes quiet, with the result sitting unread in the database.
  const OUTCOME = { candidate: "Submitted for review", blocked: "Blocked", pass: "Review passed", revise: "Sent back for changes" };
  for (const settled of itemRuns.filter((r) => r.resultSummary).reverse()) {
    convoItems.push(h("div", { className: `bees-convo-msg agent${settled.resultOutcome === "blocked" ? " error" : ""}`, key: `result-${settled.id}` },
      h("strong", null, OUTCOME[settled.resultOutcome]),
      h("div", { style: { whiteSpace: "pre-wrap", wordBreak: "break-word" } }, settled.resultSummary)));
  }

  const isWorking = ["queued", "running"].includes(run?.status) ||
    item.runtimePhase === "running" || (item.runtimePhase === "waiting" && !pendingRun);
  const isAgentBusy = isWorking || sending;
  const workReview = pendingRun?.pendingInteraction === "work-review" && interaction?.kind === "question";
  
  const conversation = h("div", { className: "bees-convo-panel" },
      h("div", { className: "bees-convo-header" },
        h("div", { className: "bees-convo-title" }, "Conversation"),
        isWorking ? h("span", { className: "bees-detail-badge running" }, run?.status === "queued" ? "Agent starting" : "Agent active") : null
      ),
      h("div", { className: "bees-convo-history", ref: convoRef },
        ...convoItems,
        workReview ? h("div", { className: "bees-convo-msg agent bees-convo-msg-interactive" }, h("div", { className: "bees-answer-card", style: { padding: "16px" } }, h("div", { style: { color: "#EAB308", fontSize: "11px", fontWeight: "600", marginBottom: "8px" } }, "Needs your input"), h(WorkReviewPanel, { key: interaction.key, wait: interaction, onAnswered: answered, act, executionId: pendingRun?.id, item, data })))
        : interaction?.kind === "question" ? h("div", { className: "bees-convo-msg agent bees-convo-msg-interactive" }, h("div", { className: "bees-answer-card", style: { padding: "16px" } }, h("div", { style: { color: "#EAB308", fontSize: "11px", fontWeight: "600", marginBottom: "8px" } }, "Needs your input"), h(QuestionPanel, { key: interaction.key, wait: interaction, onAnswered: answered, act, executionId: pendingRun?.id })))
        : interaction?.kind === "approval" ? h("div", { className: "bees-convo-msg agent bees-convo-msg-interactive" }, h("div", { className: "bees-answer-card", style: { padding: "16px" } }, h("div", { style: { color: "#EAB308", fontSize: "11px", fontWeight: "600", marginBottom: "8px" } }, "Needs your input"), h(ApprovalPanel, { key: interaction.key, wait: interaction, onAnswered: answered })))
        : isWorking ? h("div", { className: "bees-convo-msg system bees-working-indicator" }, h("span", { className: "bees-dot-typing-container" }, h("span", { className: "bees-dot-typing-dot" })), run?.status === "queued" ? "Agent is starting..." : "Agent is working...")
        : null,
        item.runtimeError ? h("div", { className: "bees-convo-msg agent error" }, h("strong", null, "Error"), h("div", null, item.runtimeError)) : null
      ),
      h("form", { className: "bees-composer bees-compact-composer", onSubmit: async (event) => {
          event.preventDefault();
          const text = composerText.trim();
          if (!text || isAgentBusy) return;
          const sessionBinding = activeBinding;
          // If there is no active binding but the user is trying to send a message, we continue the conversation with the backend action
          if (!sessionBinding) {
             if (run && (item.runtimePhase === "completed" || item.runtimePhase === "failed")) {
               setSending(true);
               try {
                 await act({ action: "continue_run", executionId: run.id, text });
                 setComposerText("");
               } catch (err) {
                 console.error("Failed to continue run:", err);
               } finally {
                 setSending(false);
                 setRefreshCount(c => c + 1);
                 setTimeout(() => setRefreshCount(c => c + 1), 500);
               }
             }
             return;
          }
          setSending(true);
          try {
            await sessionBinding.session.prompt([{ type: "text", text }], "queue");
            setComposerText("");
          } catch (err) {
            console.error("Failed to send message:", err);
          } finally {
            setSending(false);
            setRefreshCount(c => c + 1);
            setTimeout(() => setRefreshCount(c => c + 1), 500);
          }
        }},
        h("textarea", { 
          className: "bees-composer-input", 
          placeholder: pendingRun ? "Answer above or add a note..." : isWorking ? "Agent is working..." : "Add a note or instruction to continue...",
          disabled: isAgentBusy,
          value: composerText,
          rows: 2,
          onChange: (e) => setComposerText(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.target.form.requestSubmit(); }
          }
        }),
        h("button", { type: "submit", className: "bees-composer-send", disabled: isAgentBusy || !composerText.trim(), "aria-label": "Send message" }, sending ? "…" : "↑")
      ));
  const details = h("div", { className: "bees-details-panel" },
    // 1. TABS HEADER
    h("div", { className: "bees-clean-tabs", role: "tablist", "aria-label": "Work item details" },
      h("button", { type: "button", role: "tab", id: "bees-tab-files", className: `bees-clean-tab ${activeTab === "files" ? "active" : ""}`, "aria-selected": activeTab === "files", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("files") }, "Files"),
      h("button", { type: "button", role: "tab", id: "bees-tab-details", className: `bees-clean-tab ${activeTab === "details" ? "active" : ""}`, "aria-selected": activeTab === "details", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("details") }, "Details"),
      h("button", { type: "button", role: "tab", id: "bees-tab-runs", className: `bees-clean-tab ${activeTab === "runs" ? "active" : ""}`, "aria-selected": activeTab === "runs", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("runs") }, "Executions"),
      schedulable && !item.parentId ? h("button", { type: "button", role: "tab", id: "bees-tab-recurring", className: `bees-clean-tab ${activeTab === "recurring" ? "active" : ""}`, "aria-selected": activeTab === "recurring", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("recurring") }, `Schedules${recurringWork.length ? ` (${recurringWork.length})` : ""}`) : null,
      h("button", { type: "button", role: "tab", id: "bees-tab-audit", className: `bees-clean-tab ${activeTab === "audit" ? "active" : ""}`, "aria-selected": activeTab === "audit", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("audit") }, "Traces")
    ),

    // 3. TAB CONTENT
    h("div", { className: "bees-tab-panel", role: "tabpanel", id: "bees-detail-panel", "aria-labelledby": `bees-tab-${activeTab}` },
      h("div", { className: "bees-action-ribbon" },
        h("div", { className: "bees-ribbon-left", style: { flexDirection: "column", alignItems: "flex-start", gap: "6px" } },
          h("div", { style: { display: "flex", alignItems: "center", gap: "10px" } },
            h("span", { className: `bees-detail-badge ${item.runtimePhase}` }, item.runtimePhase === "waiting" && pendingRun ? "waiting for assignment" : item.runtimePhase),
            item.parentId ? h("span", { className: "bees-muted", style: { fontSize: "11px" } }, "in ", data.items.find(i => i.id === item.parentId)?.title) : null
          ),
          item.runtimeError ? h("div", { style: { color: "#f87171", fontSize: "13px", marginTop: "4px", whiteSpace: "pre-wrap", wordBreak: "break-word" } }, item.runtimeError) : null
        ),
        h("div", { className: "bees-tab-actions" },
          run && item.runtimePhase === "failed" ? h("button", { className: "bees-btn-primary", onClick: () => act({ action: "retry_item", itemId: item.id }) }, h("span", {className: "bees-btn-icon"}, "↻"), "Retry") : null,
          run && item.runtimePhase === "paused" ? h("button", { className: "bees-btn-primary", onClick: () => act({ action: "resume_item", itemId: item.id }) }, h("span", {className: "bees-btn-icon"}, "▶"), "Resume") : null,
          run && item.runtimePhase === "running" ? h("button", { className: "bees-btn-secondary", onClick: () => act({ action: "pause_item", itemId: item.id }) }, h("span", {className: "bees-btn-icon"}, "⏸"), "Pause") : null,
          run && item.runtimePhase === "running" ? h("button", { className: "bees-btn-danger-ghost", onClick: () => act({ action: "cancel_item", itemId: item.id }) }, h("span", {className: "bees-btn-icon"}, "⏹"), "Stop") : null,
          run && item.runtimePhase === "waiting" ? h("button", { className: "bees-btn-danger-ghost", onClick: () => act({ action: "cancel_item", itemId: item.id }) }, h("span", {className: "bees-btn-icon"}, "⏹"), "Cancel routing") : null,
          !item.archivedAt ? h("button", { className: "bees-btn-secondary", onClick: edit }, h("span", {className: "bees-btn-icon"}, "✎"), "Edit") : null,
          run && ["failed", "completed"].includes(item.runtimePhase) ? h("a", { className: "bees-btn-secondary", href: `/bees-api/harness?executionId=${run.id}`, target: "_blank", title: "Open in dev harness" }, h("span", {className: "bees-btn-icon"}, "🌐"), "Browser") : null,
          !item.archivedAt ? h("button", { className: "bees-btn-danger-ghost", onClick: archive }, h("span", {className: "bees-btn-icon"}, "📦"), "Archive")
            : h("button", { className: "bees-btn-secondary", onClick: restore }, h("span", {className: "bees-btn-icon"}, "↩"), "Restore"),
          run?.status === "completed" && run.outputs?.length ? h("button", { className: "bees-btn-primary", onClick: publish },
            item.outputLocationId || process?.outputLocationId ? "Publish outputs" : "Save outputs to folder…") : null
        )
      ),
      activeTab === "details" ? h(React.Fragment, null,
        // Card 1: Routing & Assignee
        h("div", { className: "bees-card-section" },
          h("div", { className: "bees-card-section-head" }, "Routing & Assignment"),
          h("div", { className: "bees-field-row" },
            h("div", { className: "bees-field-label" }, "Active Agent"),
            h("div", { className: "bees-field-val" },
              stage?.driver !== "terminal" ? h("select", { className: "bees-field-select", value: item.agentAssignmentId ?? "",
                "aria-label": "Agent for this work item", onChange: (event) => void assignAgent(event.target.value) },
                h("option", { value: "" }, `Use stage route (${routeLabel})`),
                ...assignments.map((agent) => h("option", { value: agent.id, key: agent.id, disabled: !agent.enabled },
                  `${agent.name}${agent.enabled ? "" : " (unavailable)"}`))) 
                : h("div", null, assignment ? `${assignment.name}${assignment.model ? ` · ${assignment.model}` : ""}` : `Stage route: ${routeLabel}`)
            )
          )
        ),
        
        // Card 2: Description
        h("div", { className: "bees-card-section" },
          h("div", { className: "bees-card-section-head" }, "Description"),
          item.description ? h(MarkdownText, { text: item.description }) : h("p", { className: "bees-muted", style: { margin: 0 } }, "No description provided.")
        ),

        process?.description ? h("div", { className: "bees-card-section" },
          h("div", { className: "bees-card-section-head" }, "Process Description"),
          h(MarkdownText, { text: process.description })
        ) : null,

        // Card 3: Footer Actions
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "auto", paddingTop: "8px" } },
          h("button", { className: "bees-btn-secondary", onClick: edit }, h("span", {className: "bees-btn-icon"}, "✎"), "Edit item"),
          h("button", { className: "bees-btn-secondary", onClick: addSubitem }, h("span", {className: "bees-btn-icon"}, "⑆"), "Delegate work"),
          h("button", { className: "bees-btn-secondary", onClick: () => setActiveTab("files") }, "Files & folders")
        )
      ) : activeTab === "files" ? h(React.Fragment, null,
        item.runSettings && Object.keys(item.runSettings).length ? h("section", { className: "bees-callout" },
          h("h3", null, "Goal run settings"),
          Object.hasOwn(item.runSettings, "model") ? h("p", null, `Model: ${item.runSettings.model || "System default"}${item.runSettings.reasoningEffort ? ` · ${item.runSettings.reasoningEffort} effort` : ""}`) : null,
          item.runSettings.mcpAccess ? h("p", null, `Connected tools: ${item.runSettings.mcpAccess === "none" ? "None" : item.runSettings.mcpAccess === "listed" ? "Selected connections only" : "Workflow defaults"}`) : null,
          h("p", { className: "bees-muted" }, "Applies to work, review, and delegated tasks. Each agent's tool restrictions still apply.")) : null,
        h(WorkFiles, { key: item.id, data, runs: itemRuns,
          references: inputReferences, inherited, outputId: item.outputLocationId ?? "",
          defaultOutputId: process?.outputLocationId })
      ) : activeTab === "runs" ? h(React.Fragment, null,
        h("h3", { className: "bees-section-title" }, "Executions"),
        itemRuns.length ? h("div", { className: "bees-run-list" }, ...itemRuns.map((row) => h("button", { className: `bees-run-row ${row.id === run?.id ? "active" : ""}`, key: row.id, onClick: () => setSelectedRun(row.id) },
          h("span", { className: `bees-status bees-${row.status}` }, row.status), h("span", null, new Date(row.updatedAt).toLocaleString()), h("span", { className: "bees-grow" }), h("span", { className: "bees-muted" }, `${(row.outputs?.length ?? 0)} outputs`)))) : h(Empty, null, "No executions yet")
      ) : activeTab === "recurring" ? h(RecurringWorkPanel, { data, item, recurringWork, act, onEdit: onEditSchedule })
      : h("div", { style: { height: "100%", minHeight: "500px", display: "flex", flexDirection: "column" } },
        run ? h("iframe", {
          src: `/bees-api/harness?executionId=${run.id}`,
          style: { width: "100%", flex: 1, border: "none", borderRadius: "8px", minHeight: "500px" },
          title: "DSH Traces"
        }) : h("p", { className: "bees-muted" }, "No active run to show traces for.")
      )
    )
  );

  return h(FlexibleGrid, {
    layout, editing, onLayout,
    className: "bees-work-item-grid",
    panels: {
      kanban: { label: "Kanban", hideHeader: true, borderless: true, sizeToContent: true, minW: 6, minH: 2, content: board },
      conversation: { label: "Conversation", hideHeader: true, sizeToContent: true, minW: 3, minH: 4, content: conversation },
      details: { label: "Details", hideHeader: true, sizeToContent: true, minW: 3, minH: 4, content: details }
    }
  });
}

function WorkItemCockpit({ ctx, data, rootId, teamId, act, onBack, onNewWork, onScheduleCreated, preference, preferences, setPageActions, setPageHeader }) {
  const root = data.items.find(({ id }) => id === rootId);
  const [selectedId, setSelectedId] = useState(rootId);
  const [editing, setEditing] = useState(false);
  const [scheduleEditor, setScheduleEditor] = useState(false);
  useEffect(() => setSelectedId(rootId), [rootId]);
  useEffect(() => { setEditing(false); setScheduleEditor(false); }, [rootId]);
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
  const schedulable = stages.length >= 2 && stages.at(-1)?.driver === "terminal" &&
    stages.every(({ driver }) => ["agent", "review", "terminal"].includes(driver));
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
  const layout = workItemLayoutFrom(preference.workItemLayout);
  const board = h("div", { className: "bees-board bees-cockpit-board" }, ...stages.map((stage) => {
    const rows = items.filter(({ stageId }) => stageId === stage.id);
    return h("section", { className: "bees-column", key: stage.id },
      h("header", { className: "bees-column-head" }, stage.name, h("span", { className: "bees-count" }, rows.length)),
      h("div", { className: "bees-cards" }, ...(rows.length ? rows.map((item) => {
        const run = latest.get(item.id); const parentPath = lineage(item);
        const routedAgent = data.assignments.find(({ id }) => id === (run?.resolvedAgentId ?? item.agentAssignmentId));
        return h("button", { className: `bees-hierarchy-card ${selected.id === item.id ? "active" : ""}`, key: item.id, onClick: () => setSelectedId(item.id) },
          h("h3", null, item.title),
          item.description ? h("div", { className: "bees-card-desc" }, item.description) : null,
          h("div", { className: "bees-lineage bees-muted" }, item.id === root.id ? "Root work item" : parentPath || "Delegated work"),
          h("div", { className: "bees-muted" }, [workItemStatus(item), routedAgent?.name].filter(Boolean).join(" · ")));
      }) : [h(Empty, { key: "empty" }, "No work in this stage")])));
  }));
  useEffect(() => {
    setPageHeader && setPageHeader(
      h(React.Fragment, null,
        h(Button, { onClick: onBack }, "← Process Runs"),
        h("div", { style: { display: "flex", flexDirection: "column", marginLeft: 12 } },
          h("div", { className: "bees-title" }, root.title),
          h("div", { className: "bees-context", style: { marginTop: 4 } }, `${process?.name ?? "Process"} · ${completed} of ${total} work items complete`)
        )
      )
    );
    setPageActions && setPageActions(
      h(React.Fragment, null,
        editing ? h(Button, { onClick: () => preferences.set("workItemLayout", []) }, "Reset") : null,
        !root.archivedAt && schedulable ? h(Button, { onClick: () => setScheduleEditor(true) }, h("span", {className: "bees-btn-icon"}, "🕒"), "Schedule") : null,
        h(Button, { className: editing ? "primary" : "", onClick: () => setEditing((value) => !value) }, editing ? "Done" : "Edit layout"),
        !editing ? h(Button, { className: "primary", onClick: () => onNewWork?.(root.processId) }, "New work") : null
      )
    );
    return () => {
      setPageHeader && setPageHeader(null);
      setPageActions && setPageActions(null);
    };
  }, [root.title, root.processId, root.archivedAt, schedulable, process?.name, completed, total, editing, onBack, setPageHeader, setPageActions, onNewWork]);

  return h("div", { style: { display: "flex", flexDirection: "column" } },
    h(WorkItemDetails, {
      ctx, data, item: selected, teamId, act, onArchived: onBack, onScheduleCreated, board, layout, editing,
      onLayout: (value) => void preferences.set("workItemLayout", applyWorkItemLayout(value)),
      onEditSchedule: setScheduleEditor,
      setPageHeader
    }),
    scheduleEditor ? h(ScheduleForm, { item: root, recurring: scheduleEditor === true ? null : scheduleEditor, act,
      onClose: () => setScheduleEditor(false), onCreated: onScheduleCreated }) : null
  );
}

function WorkItemForm({ ctx, data, kind, workspaceId, defaultProcessId, act, onCancel, onCreated, setPageHeader }) {
  const processes = data.processes.filter((process) => process.workspaceId === workspaceId);
  const assignments = data.assignments.filter((assignment) => assignment.workspaceId === workspaceId);
  const goal = kind === "goal";
  const processRun = kind === "run";
  const initialProcess = goal ? processes.find(({ kind }) => kind === "goals")
    : processes.find(({ id }) => id === defaultProcessId) ?? processes[0];
  const [processId, setProcessId] = useState(initialProcess?.id ?? "");
  const [inputLocationIds, setInputLocationIds] = useState([]);
  const [outputLocationId, setOutputLocationId] = useState("");
  const [agentId, setAgentId] = useState("");

  if (!workspaceId) return h("div", { className: "bees-stack" },
    h(PageHead, { setPageHeader }, h(Button, { onClick: onCancel }, "← Process Runs"), h("h2", null, goal ? "New goal" : processRun ? "Start process run" : "New work")),
    h(Empty, null, processRun ? "Choose a team before starting a process run." : "Choose a team before creating work."));

  const process = processes.find(({ id }) => id === processId) ?? initialProcess;
  const firstStage = data.stages.find(({ processId }) => processId === process?.id);
  const routedAgentId = (firstStage?.driver !== "review" ? agentId : "") || (firstStage?.routeType === "agent" ? firstStage.routeTargetId
    : !firstStage?.routeType ? assignments.find(({ systemRole }) => systemRole === (firstStage?.driver === "review" ? "reviewer" : "worker"))?.id : null);
  const inherited = inheritedInputs(data, process?.id, routedAgentId);
  const teamId = data.workspaces.find(({ id }) => id === workspaceId)?.teamId;

  const [busy, onSubmit] = useSubmit(async (event) => {
    const form = new FormData(event.currentTarget);
    const command = goal ? {
      action: "create_goal", workspaceId, title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""), priority: String(form.get("priority") ?? "normal"),
      inputLocationIds, outputLocationId
    } : {
      action: processRun ? "create_run" : "create_item", processId,
      title: String(form.get("title") ?? ""), description: String(form.get("description") ?? ""),
      priority: String(form.get("priority") ?? "normal"), agentAssignmentId: String(form.get("agentAssignmentId") ?? "") || null,
      inputLocationIds, outputLocationId
    };
    const created = await act(command); if (created?.id) onCreated(created.id);
  });
  if (!goal && !processes.length) return h("div", { className: "bees-stack" },
    h(PageHead, { setPageHeader }, h(Button, { onClick: onCancel }, "← Process Runs"), h("h2", null, processRun ? "Start process run" : "New work")),
    h(Empty, null, "Create a process template first. Work always follows a process template so Bees knows its stages."));
  return h("form", { className: "bees-box bees-form", onSubmit },
    h(PageHead, { setPageHeader }, h(Button, { onClick: onCancel }, "← Process Runs"),
      h("div", null, h("h2", null, goal ? "New goal" : processRun ? "Start process run" : "New work"),
        h("div", { className: "bees-muted" }, goal
          ? "Describe the outcome. Bees will plan and execute the work needed to reach it."
          : processRun ? "Name this process run and provide its inputs. Bees starts it in the template's first stage."
          : "Create the whole work item here, then Bees starts it in the process template's first stage."))),
    !goal ? h("label", null, "Process template", h("select", { className: "bees-select", name: "processId", required: true,
      value: processId, onChange: (event) => {
        setProcessId(event.target.value); setOutputLocationId("");
      } },
      ...processes.map((process) => h("option", { value: process.id, key: process.id }, process.name)))) : null,
    h("label", null, goal ? "Goal" : processRun ? "Run name" : "Title", h("input", { className: "bees-input", name: "title", required: true, autoFocus: true,
      placeholder: goal ? "Launch the product successfully" : "Draft the launch announcement" })),
    h("label", null, "What does success look like?", h("textarea", { className: "bees-textarea", name: "description",
      placeholder: "Include the result, constraints, and evidence Bees should produce." })),
    h("div", { className: "bees-form-row" },
      h("label", null, "Priority", h("select", { className: "bees-select", name: "priority", defaultValue: "normal" },
        h("option", { value: "low" }, "Low"), h("option", { value: "normal" }, "Normal"), h("option", { value: "high" }, "High"))),
      !goal ? h("label", null, "Agent override (optional)", h("select", { className: "bees-select", name: "agentAssignmentId", value: agentId, onChange: (event) => setAgentId(event.target.value) },
        h("option", { value: "" }, "Use each stage's assigned agent"),
        ...assignments.map((agent) => h("option", { value: agent.id, key: agent.id, disabled: !agent.enabled }, agent.name)))) : null),
    h(ResourceFields, { ctx, data, teamId, act, inputIds: inputLocationIds, onInputIds: setInputLocationIds,
      outputId: outputLocationId, onOutputId: setOutputLocationId, inherited,
      defaultOutputId: process?.outputLocationId, defaultOutputName: data.locations.find(({ id }) => id === process?.outputLocationId)?.name ?? "" }),
    h("div", { className: "bees-detail-actions" }, h("button", { className: "bees-btn primary", disabled: busy }, busy ? "Creating…" : goal ? "Create goal" : processRun ? "Start process run" : "Create work"),
      h(Button, { onClick: onCancel }, "Cancel"))
  );
}

function displayOption(label) {
  const text = String(label);
  const recommended = /\s*\(recommended\)\s*$/i.test(text);
  return { label: text.replace(/\s*\(recommended\)\s*$/i, ""), recommended };
}

export { FilePreview };

function WorkReviewPanel({ wait, onAnswered, act, executionId, item, data }) {
  const pending = useMemo(() => new PendingQuestion(wait), [wait]);
  const question = pending.questions?.[0];
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState("current");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const recurring = data?.recurringWork?.find(({ id }) => id === item?.recurringWorkId);
  const producerRun = data?.runs?.find((run) => run.workItemId === item?.id && run.mode === "work" && run.specializationId);
  const specialist = data?.specializations?.find(({ id }) => id === producerRun?.specializationId);
  const answer = async (outcome, feedback = "") => {
    setBusy(outcome); setError("");
    try {
      const detail = feedback.trim();
      await pending.answer({ answers: [{
        id: question.id, selected: outcome === "approve" ? ["Approve"] : [],
        ...(detail ? { custom: detail } : {})
      }] });
      if (outcome === "reject" && scope === "future") {
        if (!act || !executionId || !recurring) throw new Error("Future-run learning is unavailable for this review");
        const learned = await act({ action: "apply_specialist_feedback", executionId, feedback });
        if (!learned) throw new Error("The work was rejected, but its future-run guidance could not be updated");
      }
      onAnswered(wait.key);
    } catch (reason) {
      setBusy(""); setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  if (!question) return h(Empty, null, "The work review request is unavailable.");
  if (!rejecting) return h(React.Fragment, null,
    h("div", null,
      h("div", { className: "bees-muted" }, question.header || "Review"),
      h("h3", { className: "bees-section-title" }, question.question)),
    question.detail ? h("div", { className: "bees-question-detail" }, h(MarkdownText, { text: question.detail })) : null,
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
    h("div", { className: "bees-answer-actions" },
      h(Button, { className: "danger", disabled: Boolean(busy), onClick: () => setRejecting(true) }, "Reject"),
      h("div", { className: "bees-grow" }),
      h(Button, { className: "primary", disabled: Boolean(busy), onClick: () => void answer("approve") },
        busy === "approve" ? "Approving…" : "Approve")));
  return h(React.Fragment, null,
    h("div", null, h("div", { className: "bees-muted" }, "Reject work"),
      h("h3", { className: "bees-section-title" }, "What should change?")),
    h("textarea", {
      className: "bees-textarea", value: reason, maxLength: 2_000, autoFocus: true, disabled: Boolean(busy),
      placeholder: "Give specific feedback so the agent can revise the work.",
      onChange: (event) => setReason(event.target.value)
    }),
    h("div", { className: "bees-muted" }, `${reason.length}/2000`),
    recurring ? h("div", { className: "bees-question-options", role: "radiogroup", "aria-label": "Feedback scope" },
      h("button", { type: "button", role: "radio", "aria-checked": scope === "current", className: `bees-choice ${scope === "current" ? "selected" : ""}`, onClick: () => setScope("current") },
        h("span", { className: "bees-choice-mark" }, "1"), h("span", { className: "bees-choice-copy" }, h("strong", null, "This run only"), h("span", { className: "bees-muted" }, "Revise this result without changing future behavior."))),
      h("button", { type: "button", role: "radio", "aria-checked": scope === "future", className: `bees-choice ${scope === "future" ? "selected" : ""}`, onClick: () => setScope("future") },
        h("span", { className: "bees-choice-mark" }, "2"), h("span", { className: "bees-choice-copy" }, h("strong", null, `Future ${recurring.name} runs`),
          h("span", { className: "bees-muted" }, `Also update ${specialist?.name || "the producing specialist"}.`)))) :
      h("p", { className: "bees-muted" }, "This feedback applies to this goal only. One-off work does not change an agent's future behavior."),
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
    h("div", { className: "bees-answer-actions" },
      h(Button, { disabled: Boolean(busy), onClick: () => { setRejecting(false); setError(""); } }, "Back"),
      h("div", { className: "bees-grow" }),
      h(Button, { className: "danger", disabled: Boolean(busy) || reason.trim().length < 3,
        onClick: () => void answer("reject", reason) }, busy === "reject" ? "Rejecting…" : "Reject and send feedback")));
}

function QuestionPanel({ wait, onAnswered, act, executionId }) {
  const pending = useMemo(() => new PendingQuestion(wait), [wait]);
  const questions = pending.questions ?? [];
  return h(GenericQuestionPanel, { pending, questions, wait, onAnswered, act, executionId });
}

function GenericQuestionPanel({ pending, questions, wait, onAnswered, act, executionId }) {
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
      // a question is the only time someone has to reach the agent's browser, so the way in lives
      // on the question rather than on whichever panel happens to be wrapping it
      act && executionId ? h(Button, {
        disabled: busy, title: "Open the browser profile this agent uses, so you can sign in on its behalf",
        onClick: () => act({ action: "open_agent_browser", executionId })
      }, "Open browser") : null,
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

const interactionName = (kind) => kind === "approval" ? "Approval"
  : kind === "work-review" ? "Work review" : kind === "plan-review" ? "Plan review" : "Question";

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

function AgentInteractionPanel({ run, item, title, summary, session, interaction, handled, onAnswered, onOpen, openLabel, act, onControlled, data }) {
  const files = [...new Set(run.files ?? (run.outputs ?? []).map((path) => `outputs/${path}`))];
  const [viewer, setViewer] = useState(files.length ? { executionId: run.id, path: files[0] } : null);
  const fileKey = files.join("|");
  useEffect(() => setViewer((current) => files.length
    ? current?.executionId === run.id && files.includes(current.path)
      ? current : { executionId: run.id, path: files[0] }
    : null), [run.id, fileKey]);
  const workReview = run?.pendingInteraction === "work-review" && interaction?.kind === "question";
  return h("section", { className: "bees-box bees-answer-card" },
    h("div", { className: "bees-answer-head" }, h("div", null,
      h("div", { className: "bees-status" }, interactionName(run?.pendingInteraction ?? summary?.pendingInteraction ?? interaction?.kind)),
      h("h2", null, item?.title ?? title ?? summary?.displayTitle ?? "Agent run")),
    h("div", { className: "bees-grow" }), h("div", { className: "bees-answer-controls" },
      onOpen ? h(Button, { onClick: onOpen }, openLabel) : null,
      h(NeedsYouControls, { item, act, onDone: onControlled }))),
    workReview ? h(WorkReviewPanel, { key: interaction.key, wait: interaction, onAnswered, act, executionId: run?.id, item, data })
      : interaction?.kind === "question" ? h(QuestionPanel, { key: interaction.key, wait: interaction, onAnswered, act, executionId: run?.id })
      : interaction?.kind === "approval" ? h(ApprovalPanel, { key: interaction.key, wait: interaction, onAnswered })
        : h(Empty, null, session?.pending?.some(({ key }) => handled.has(key))
          ? "Answer sent. Waiting for the agent…" : "Loading the agent's request…"),
    files.length ? h("div", { className: "bees-file-list" }, h("span", { className: "bees-muted" }, "Files"),
      ...files.map((path) => h(Button, { className: `bees-file-chip ${viewer?.path === path ? "active" : ""}`, key: path, title: path,
        onClick: () => setViewer({ executionId: run.id, path }) }, path))) : null,
    viewer ? h(FilePreview, { target: { ...viewer, updatedAt: run.updatedAt } }) : null
  );
}

function useNeedsYouQueue(ctx, data, workspaceIds, initialSelectedId = "", autoSelect = true) {
  const sessions = useSnapshot(ctx.sessions.list, { ids: [], byId: {} });
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [handled, setHandled] = useState(() => new Set());
  const [handledRuns, setHandledRuns] = useState(() => new Set());
  const seen = new Set();
  const activeRuns = data.runs.filter((run) => workspaceIds.includes(run.workspaceId) &&
    !isDone(data.items.find(({ id }) => id === run.workItemId) ?? {}));
  const rows = activeRuns.filter((run) => run.sessionId)
    .map((run) => ({ run, session: sessions.byId[run.sessionId], item: data.items.find(({ id }) => id === run.workItemId) }))
    .filter(({ run }) => ["waiting_for_input", "waiting_for_approval"].includes(run.status) && !seen.has(run.sessionId) && seen.add(run.sessionId));
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
  const blocked = activeRuns.filter((run) =>
    ["waiting_for_input", "waiting_for_approval"].includes(run.status) && !actionableRunIds.has(run.id));
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

export function NeedsYouWidget({ ctx, data, workspaceIds, act, openNeedsYou, rowsForRoute, limit = 8, setPageHeader }) {
  const queue = useNeedsYouQueue(ctx, data, workspaceIds, "", false);
  const liveByItemId = new Map(queue.rows.filter(({ item }) => item).map((row) => [row.item.id, row]));
  const records = rowsForRoute("waiting")
    .map((row) => ({ id: row.id, label: row.label, open: row.open, live: liveByItemId.get(row.id) }))
    .filter((record) => record.live);
  const listedItemIds = new Set(records.map(({ id }) => id));
    
  for (const live of queue.rows) {
    if (!live.item || !listedItemIds.has(live.item.id)) {
      records.push({ id: live.run.id, label: live.item?.title ?? runTitle(data, live.run) ?? live.session?.displayTitle, live });
    }
  }
  
  const visibleRecords = records.slice(0, limit);
  const selected = visibleRecords.find(({ live }) => live.run.id === queue.selectedId)?.live;
  const select = (runId) => queue.setSelectedId((current) => current === runId ? "" : runId);

  return h("div", { className: "bees-dashboard-needs" },
    visibleRecords.length ? h("div", { className: "bees-dashboard-list", "aria-label": "Work needing attention" }, ...visibleRecords.map((record) => {
      const { live } = record;
      const isSelected = Boolean(selected && live.run.id === selected.run.id);
      const panelId = `bees-dashboard-need-${live.run.id}`;
      return h(React.Fragment, { key: record.id },
        h("div", { className: "bees-dashboard-need-row" },
          h("button", {
            type: "button", className: `bees-dashboard-row ${isSelected ? "active" : ""}`,
            title: record.label, "aria-expanded": isSelected, "aria-controls": panelId,
            onClick: () => select(live.run.id)
          }, h("span", { className: "bees-dashboard-need-copy" }, record.label),
            h("span", { className: "bees-badge" }, interactionName(live.run.pendingInteraction ?? live.session?.pendingInteraction))),
          record.open ? h("button", {
            type: "button", className: "bees-dashboard-launch", title: `Open ${record.label}`,
            "aria-label": `Open ${record.label}`, onClick: record.open
          }, "↗") : null),
        isSelected ? h("div", { className: "bees-dashboard-needs-answer", id: panelId },
          h(AgentInteractionPanel, {
            run: selected.run, item: selected.item, title: runTitle(data, selected.run), summary: selected.session, data,
            session: queue.session, interaction: queue.interaction, handled: queue.handled,
            onAnswered: (key) => queue.answered(key, visibleRecords.map(r => r.live)), act,
            onControlled: () => queue.answered(`control:${selected.run.id}`, visibleRecords.map(r => r.live))
          })) : null
      );
    })) : h(Empty, null, "Nothing needs you right now.")
  );
}



export function WorkPage({ ctx, data, route, workspaceIds, workspaceId, teamId, workItemId, setWorkItemId, creating, setCreating, defaultProcessId, setWorkProcessId, act, preference, preferences, setPageActions, setPageHeader }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(route === "completed" ? "completed" : "all");
  const [type, setType] = useState("all");
  useEffect(() => { setStatus(route === "completed" ? "completed" : "all"); setType("all"); }, [route]);
  if (workItemId) return h(WorkItemCockpit, {
    ctx, data, rootId: workItemId, teamId, act, preference, preferences, onBack: () => setWorkItemId(""),
    onScheduleCreated: (id) => setWorkItemId(id),
    onNewWork: (processId) => {
      setWorkProcessId?.(processId);
      setWorkItemId("");
      setCreating("work");
    },
    setPageActions, setPageHeader
  });
  if (["work", "run", "goal"].includes(creating)) return h(WorkItemForm, {
    ctx, data, kind: creating, workspaceId, defaultProcessId, act, onCancel: () => setCreating(""),
    onCreated: (id) => { setCreating(""); setWorkItemId(id); }, setPageHeader
  });
  const items = data.items.filter((item) => {
    const process = data.processes.find(({ id }) => id === item.processId);
    return workspaceIds.includes(process?.workspaceId) &&
      (route === "schedules" ? isScheduleDefinition(item) : !isScheduleDefinition(item)) &&
      (route !== "goals" || process?.kind === "goals");
  });
  const statuses = [...new Set(items.map(workItemStatus))].sort();
  const types = [...new Set(items.map(({ kind }) => kind))].sort();
  const needle = query.trim().toLocaleLowerCase();
  const rows = items.filter((item) => (!needle || item.title.toLocaleLowerCase().includes(needle)) &&
    (status === "all" || workItemStatus(item) === status) && (type === "all" || item.kind === type));
  const renderRows = (records, empty) => records.length ? records.map((item) => {
    const process = data.processes.find(({ id }) => id === item.processId);
    const stage = data.stages.find(({ id }) => id === item.stageId);
    return h("button", { type: "button", className: "bees-row bees-work-item-row", key: item.id, onClick: () => setWorkItemId(item.id) },
      h("span", { className: "bees-row-main" }, h("span", { className: "bees-row-title" }, item.title), h("span", { className: "bees-muted" }, `${item.kind === "run" ? "scheduled run" : item.kind} · ${process?.name ?? "Process"} · ${stage?.name ?? "Stage"}`)),
      h("span", { className: `bees-status bees-${workItemStatus(item)}` }, workItemStatus(item)));
  }) : h(Empty, null, empty);
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
      route !== "schedules" ? h(Button, { disabled: !workspaceId, onClick: () => setCreating("goal") }, "New goal") : null,
      route !== "schedules" ? h(Button, { className: "primary", disabled: !workspaceId, onClick: () => setCreating("work") }, "New work") : null),
    h(GridStackPage, {
      layoutId: "work", defaults: WORK_PAGE_LAYOUT, preference, preferences, setPageActions, setPageHeader,
      panels: {
        "active-work": { label: route === "schedules" ? "Schedules" : "Active work", minW: 6, minH: 3, content: renderRows(rows.filter((item) => !isDone(item)), route === "schedules" ? "No schedules yet" : "No active work matches these filters"), helpText: route === "schedules" ? "Recurring schedules automatically start process runs at specific times or intervals." : "Process runs that are currently active.", helpExamples: route === "schedules" ? ["A daily schedule to run an 'Inbox Triage' process at 9 AM", "An hourly schedule to check for new GitHub issues"] : [] },
        "finished-work": { label: "Completed, archived & stopped", minW: 6, minH: 3, content: renderRows(rows.filter(isDone), "No completed, archived, or stopped work matches these filters") }
      }
    })
  );
}
