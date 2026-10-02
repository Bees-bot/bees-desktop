import {
  h, MarkdownText, NativeUi, React, useEffect, useRef, useState
} from "./runtime.js";
import { ProcessMemoryPanel, SharedWorkContext, WorkDiscussion } from "./collaboration.js";
import Cron, { HEADER } from "react-cron-generator";
import {
  accountLabel, ask, AuditEvent, Button, clip, confirmAction, cronText, Empty, isDone, isScheduleDefinition, PageHead, ProposalCard, request, runTitle, useBeesChangeRevision, useSnapshot, useSubmit, workItemStatus, HelpTooltip, when
} from "./shared.js";
import { applyWorkItemLayout, workItemLayoutFrom } from "./dashboard-model.js";
import { FlexibleGrid, GridStackPage } from "./flexible-grid.js";
import { addLocationFromDevice, FilePreview, inheritedInputs, ResourceFields, WorkFiles, WorkLocations } from "./location-fields.js";

import { McpAccess, useMcpPreflight } from "./agents.js";
import { ProcessMcpForm } from "./processes.js";
import { generatedFileKeys, watchFilesViewed } from "./file-notifications.js";
import { ArrowLeftIcon } from "./icons.js";
import { agentMentionOptions, agentTag, conversationMessages, mentionedRecipient, pollConversation } from "./conversation-model.js";
import { DshRunPanels } from "./native-conversation.js";

// a key typed here goes to the credential store first, so the run only sees a reference to it
const hideKeys = async (text) => (await request("/bees-api/capabilities", { method: "POST", body: JSON.stringify({ action: "stash_answer", text }) })).text;

const UserMessage = ({ children, label }) => {
  const [expanded, setExpanded] = useState(false);
  const truncated = children.length > 280;
  const text = truncated && !expanded ? clip(children, 280) : children;
  const mention = /^(\$[^\s]+)([\s\S]*)$/.exec(text);
  return h("div", { className: "bees-convo-msg user" },
    label ? h("strong", null, label) : null,
    h("div", null, mention ? h(React.Fragment, null,
      h("span", { className: "bees-agent-mention" }, mention[1]), mention[2]) : text),
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
  if (recurring.scheduleKind === "interval") return `Every ${value.everyMinutes === 60 ? "hour" : `${value.everyMinutes} minutes`} from ${when(value.anchorUtc)}`;
  // "Nepal Time" reads better than the raw Asia/Katmandu id
  const zone = new Intl.DateTimeFormat(undefined, { timeZone: recurring.timezone, timeZoneName: "longGeneric" })
    .formatToParts().find(({ type }) => type === "timeZoneName")?.value ?? recurring.timezone;
  if (recurring.scheduleKind === "cron") return `${cronText(value.expression)} · ${zone}`;
  const time = `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
  if (value.frequency === "weekly") return `Every ${value.dayOfWeek[0]}${value.dayOfWeek.slice(1).toLowerCase()} at ${time} · ${zone}`;
  if (value.frequency === "monthly") return `Day ${value.dayOfMonth} at ${time} · ${zone}`;
  return `Daily at ${time} · ${zone}`;
}

function ScheduleForm({ item, items = [], recurring, act, onClose, onCreated }) {
  const [itemId, setItemId] = useState(item?.id ?? items[0]?.id ?? "");
  const selectedItem = item ?? items.find(({ id }) => id === itemId);
  const current = recurring?.schedule ?? {};
  const currentFrequency = recurring?.scheduleKind === "cron" ? "advanced"
    : recurring?.scheduleKind === "interval" ? "hourly" : current.frequency || "daily";
  const [name, setName] = useState(recurring?.name ?? `Daily ${selectedItem?.title ?? "process"}`.slice(0, 120));
  const [frequency, setFrequency] = useState(currentFrequency);
  // an interval schedule can be any number of minutes, so saving one must not flatten it to hourly
  const [everyMinutes, setEveryMinutes] = useState(recurring?.scheduleKind === "interval" ? current.everyMinutes ?? 60 : 60);
  const [time, setTime] = useState(`${String(current.hour ?? 9).padStart(2, "0")}:${String(current.minute ?? 0).padStart(2, "0")}`);
  const [dayOfWeek, setDayOfWeek] = useState(current.dayOfWeek ?? "MONDAY");
  const [dayOfMonth, setDayOfMonth] = useState(current.dayOfMonth ?? 1);
  const [timezone, setTimezone] = useState(recurring?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
  const [cronExpression, setCronExpression] = useState(current.expression ?? "0 9 * * *");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);
  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, []);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    const [hour, minute] = time.split(":").map(Number);
    try {
      const result = await act({
        action: recurring ? "edit_recurring_work" : "create_recurring_work",
        ...(recurring ? { recurringWorkId: recurring.id } : { itemId: selectedItem.id }),
        name, frequency, hour, minute, dayOfWeek, dayOfMonth: Number(dayOfMonth), timezone,
        cronExpression, everyMinutes: frequency === "hourly" ? Number(everyMinutes) : 60,
        anchorUtc: current.anchorUtc || new Date().toISOString()
      }, undefined, setError);
      if (!result) return setBusy(false);
      onClose();
      if (!recurring && result.sourceWorkItemId) onCreated?.(result.sourceWorkItemId);
    } catch (reason) { setBusy(false); setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  
  const formContent = h("form", { className: "bees-form bees-process-form", style: { gridTemplateColumns: "minmax(0, 1fr)" }, onSubmit: submit },
    h("div", { className: "bees-row" }, h("div", null,
      h("h2", { style: { display: "flex", alignItems: "center" } }, (recurring ? "Edit recurring work" : "Schedule this work"), h("span", { style: { flex: 1 } }), h(HelpTooltip, { text: "Schedules automatically create new process runs for this work on a regular basis. You can use this for any repeatable task.", examples: ["A daily schedule to run an 'Inbox Triage' process at 9 AM", "A weekly schedule for 'Prepare Status Report'", "An advanced cron schedule to trigger 'System Backup'"] })))),
      item ? null : h("label", { className: "bees-process-name" }, "Process run to repeat", h("select", { className: "bees-select", value: itemId, onChange: (event) => {
        setItemId(event.target.value);
        const next = items.find(({ id }) => id === event.target.value);
        setName(`Daily ${next?.title ?? "process"}`.slice(0, 120));
      } }, ...items.map((option) => h("option", { value: option.id, key: option.id }, option.title)))),
      h("label", { className: "bees-process-name" }, "Name", h("input", { className: "bees-input", value: name, maxLength: 120, required: true, autoFocus: true, onChange: (event) => setName(event.target.value) })),
      h("label", { className: "bees-process-name" }, "Frequency", h("select", { className: "bees-select", value: frequency, onChange: (event) => setFrequency(event.target.value) },
        h("option", { value: "hourly" }, "Hourly"), h("option", { value: "daily" }, "Daily"),
        h("option", { value: "weekly" }, "Weekly"), h("option", { value: "monthly" }, "Monthly"),
        h("option", { value: "advanced" }, "Advanced (cron)"))),
      frequency === "hourly" ? h("label", { className: "bees-process-name" }, "Minutes between runs",
        h("input", { className: "bees-input", type: "number", min: 1, max: 525600, required: true,
          value: everyMinutes, onChange: (event) => setEveryMinutes(event.target.value) }),
        h("p", { className: "bees-callout" }, "Runs on this interval, counted from when you save it.")) :
        frequency === "advanced" ? h(React.Fragment, null,
          h("div", { className: "bees-cron-generator" }, h(Cron, {
            // the picker's hour and minute lists hold "08", so a bare "8" shows as 00
            value: cronExpression.trim().split(/\s+/).map((part, index) => index < 2 && /^\d$/.test(part) ? `0${part}` : part).join(" "), isUnix: true, showResultText: true, showResultCron: true,
            options: { headers: [HEADER.MINUTES, HEADER.HOURLY, HEADER.DAILY, HEADER.WEEKLY, HEADER.MONTHLY, HEADER.CUSTOM] },
            onChange: (value) => setCronExpression(value)
          })),
          h("p", { className: "bees-muted" }, "Advanced uses a five-field Unix cron expression.")) :
          h(React.Fragment, null,
            frequency === "weekly" ? h("label", { className: "bees-process-name" }, "Day", h("select", { className: "bees-select", value: dayOfWeek, onChange: (event) => setDayOfWeek(event.target.value) },
              ...WEEKDAYS.map((day) => h("option", { value: day, key: day }, day[0] + day.slice(1).toLowerCase())))) : null,
            frequency === "monthly" ? h("label", { className: "bees-process-name" }, "Day of month", h("input", { className: "bees-input", type: "number", min: 1, max: 31, value: dayOfMonth, onChange: (event) => setDayOfMonth(event.target.value) })) : null,
            h("label", { className: "bees-process-name" }, "Local time", h("input", { className: "bees-input", type: "time", value: time, required: true, onChange: (event) => setTime(event.target.value) }))),
      frequency !== "hourly" ? h("label", { className: "bees-process-name" }, "Timezone", h("input", { className: "bees-input", list: "bees-timezones", value: timezone, required: true, onChange: (event) => setTimezone(event.target.value), placeholder: "America/Los_Angeles" }),
        h("datalist", { id: "bees-timezones" }, ...Intl.supportedValuesOf("timeZone").map((zone) => h("option", { value: zone, key: zone })))) : null,
      h("div", { className: "bees-callout" }, "Runs happen on this computer, so Bees must be open at that time. A run missed while Bees was closed is skipped."),
      error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
      h("div", { className: "bees-detail-actions bees-process-actions", style: { justifyContent: "flex-end" } }, h(Button, { onClick: onClose, disabled: busy }, "Cancel"),
        h("button", { className: "bees-btn primary", disabled: busy }, busy ? "Saving…" : recurring ? "Save changes" : "Create schedule")));
        
  return h("dialog", {
    ref: dialogRef,
    className: "bees-modal",
    closedby: "any",
    "aria-label": recurring ? "Edit recurring work" : "Schedule work",
    onClick: (event) => {
      if (event.target !== dialogRef.current) return;
      const rect = dialogRef.current.getBoundingClientRect();
      if (!(rect.top <= event.clientY && event.clientY <= rect.top + rect.height && rect.left <= event.clientX && event.clientX <= rect.left + rect.width)) {
        onClose();
      }
    },
    onCancel: (event) => { event.preventDefault(); onClose(); },
    onClose: () => onClose()
  }, formContent);
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
            const playbook = await ask("Edit specialist playbook", specialist.playbook, "textarea");
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
            `v${version.revision} · ${version.source} · ${when(version.createdAt)}${version.feedback ? ` · ${clip(version.feedback, 120)}` : ""}`))) : null);
    });
    return h("section", { className: "bees-callout", key: recurring.id },
      h("div", { className: "bees-row" },
        h("div", { className: "bees-row-main" },
          h("h3", null, recurring.name),
          h("div", { className: "bees-muted" }, `${recurring.status === "paused" ? "Paused" : "Active"} · ${scheduleSummary(recurring)}`),
          h("div", { className: "bees-muted" }, recurring.nextRunAt
            ? `Next: ${when(recurring.nextRunAt)}`
            : recurring.status === "paused" ? "Paused, so it will not run." : "The next run time shows here shortly.")),
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

function WorkItemDetails({ ctx, data, item, teamId, act, capabilities, onOpenWork, onArchived, onScheduleCreated, board, boardActions, layout, editing, onLayout, onEditSchedule, setPageHeader, preference, preferences }) {
  const plan = item.kind === "plan";
  // ask bees titles a goal with the prompt's first line, so show only what follows it
  const bodyDescription = item.description === item.title ? ""
    : item.description?.startsWith(`${item.title}\n`) ? item.description.slice(item.title.length).trim() : item.description;
  const process = data.processes.find(({ id }) => id === item.processId);
  const stage = data.stages.find(({ id }) => id === item.stageId);
  const assignments = data.assignments.filter(({ workspaceId }) => workspaceId === process?.workspaceId);
  const itemAgents = (item.agentIds ?? []).map((id) => assignments.find((agent) => agent.id === id)).filter(Boolean);
  const stageAgents = (stage?.agentIds ?? []).map((id) => assignments.find((agent) => agent.id === id)).filter(Boolean);
  const processStages = data.stages.filter(({ processId }) => processId === item.processId);
  const schedulable = processStages.length >= 2 && processStages.at(-1)?.driver === "terminal" &&
    processStages.every(({ driver }) => ["agent", "discussion", "review", "terminal"].includes(driver));
  const recurringWork = (data.recurringWork ?? []).filter((recurring) =>
    recurring.sourceWorkItemId === item.id || recurring.originWorkItemId === item.id || recurring.id === item.recurringWorkId);
  const itemRuns = data.runs.filter(({ workItemId }) => workItemId === item.id);
  // a teammate's device holds this item's workflow, so pause, stop and retry only work there
  const elsewhere = itemRuns.length > 0 && itemRuns.every(({ ranElsewhere }) => ranElsewhere);
  const latestResult = itemRuns.filter((row) => row.resultSummary)
    .sort((left, right) => new Date(right.resultCreatedAt ?? right.updatedAt) - new Date(left.resultCreatedAt ?? left.updatedAt))[0];
  const processRunId = item.processRunId ?? item.id;
  const sharedFiles = new Map();
  for (const run of data.runs) if ((run.processRunId ?? run.workItemId) === processRunId && !sharedFiles.has(run.outputsPath ?? run.id))
    sharedFiles.set(run.outputsPath ?? run.id, run);
  const fileRuns = [...sharedFiles.values()];
  const inputReferences = data.attachments.filter(({ workItemId }) => workItemId === item.id);
  const resolvedAgentId = itemRuns.find((row) => row.dispatchStageId === item.stageId)?.resolvedAgentId
    ?? (stage?.driver !== "review" ? itemAgents[0]?.id : null) ?? stageAgents[0]?.id
    ?? assignments.find(({ systemRole }) => systemRole === (stage?.driver === "review" ? "reviewer" : "worker"))?.id;
  const inherited = inheritedInputs(data, process?.id, resolvedAgentId);

  const [selectedRun, setSelectedRun] = useState("");
  const [activeTab, setActiveTab] = useState("files");
  const filesRef = React.useRef(null);
  const fileKeys = generatedFileKeys(fileRuns);
  const seenFiles = new Set(preference.seenFiles?.[processRunId] ?? []);
  const unreadFiles = fileKeys.filter((key) => !seenFiles.has(key)).length;
  const fileRevision = JSON.stringify(fileKeys);
  useEffect(() => {
    if (activeTab !== "files" || !unreadFiles || !filesRef.current) return;
    return watchFilesViewed(filesRef.current, () => {
      // One path per run, so two runs finishing a scroll at once cannot drop each other's entry.
      void preferences.mutate([{ op: "set", path: ["seenFiles", processRunId], value: JSON.parse(fileRevision) }])
        .catch((error) => console.error("Could not save viewed files:", error));
    });
  }, [activeTab, processRunId, fileRevision, unreadFiles, preferences]);

  const [handled, setHandled] = useState(() => new Set());
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState("");
  const convoRef = React.useRef(null);
  const [composerText, setComposerText] = useState("");
  const [discussion, setDiscussion] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendNotice, setSendNotice] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  // a finished item's newest run is the reviewer, which won't edit, so follow-ups default to the worker
  const run = itemRuns.find(({ id }) => id === selectedRun)
    ?? itemRuns.find(({ mode }) => item.runtimePhase === "completed" && mode === "work") ?? itemRuns[0];
  const asks = ({ status, sessionId }) => sessionId && ["waiting_for_input", "waiting_for_approval"].includes(status);
  // a helper's question only showed on the helper's own page, which nobody opens, so show it on its parent's too
  const pendingRun = itemRuns.find(asks)
    ?? data.runs.find((row) => asks(row) && data.items.some(({ id, parentId }) => id === row.workItemId && parentId === item.id));
  const waiting = useSnapshot(ctx.uiSession.sessionStatus, EMPTY_STATUS);
  const interaction = pendingInteractionFor(waiting, (pendingRun ?? run)?.sessionId, handled);
  // The composer sends into the selected run's own session, not whichever session happens to
  // have a pending question — those can differ once a work item has more than one execution.
  const activeRun = run?.ranElsewhere ? null : run?.sessionId ? run : itemRuns.find(({ sessionId }) => sessionId);
  const liveRevision = useBeesChangeRevision();
  const itemIdRef = useRef(item.id);
  itemIdRef.current = item.id;
  useEffect(() => {
    setSelectedRun(""); setHandled(new Set()); setActiveTab("files");
    setHistory(null); setComposerText(""); setDiscussion(null);
    setSending(false); setSendNotice("");
  }, [item.id]);
  useEffect(() => {
    if (plan) return;
    let active = true;
    request("/bees-api/command", { method: "POST", body: JSON.stringify({ action: "read_work_discussion", itemId: item.id }) })
      .then((value) => { if (active) setDiscussion(value); })
      .catch((error) => { if (active) setSendError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [item.id, plan, liveRevision]);
  useEffect(() => {
    setHistoryError("");
    // The transcript lives with the session that produced it, and that is on the other device.
    if (!run || run.ranElsewhere) { setHistory(null); return; }
    return pollConversation(run.id, {
      request,
      isVisible: () => document.visibilityState !== "hidden",
      onHistory: (next) => {
        setHistory((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
        setHistoryError("");
      },
      onError: (error) => setHistoryError(error instanceof Error ? error.message : String(error))
    });
  // pollConversation repolls every 2s by itself, and a change event here would abort the request in flight
  }, [run?.id, refreshCount]);
  const isScrolledUpRef = React.useRef(false);
  useEffect(() => { isScrolledUpRef.current = false; }, [item.id]);
  const edit = async () => { /* reuse edit logic */
    const title = await ask("Work title", item.title); if (!title) return;
    const description = await ask("Description", item.description, "textarea") ?? item.description;
    const owner = await ask("Person responsible (optional)", item.owner ?? "") ?? item.owner ?? "";
    await act({ action: "edit_item", itemId: item.id, title, description, owner,
      priority: item.priority, parentId: item.parentId });
  };
  const addSubitem = async () => {
    const title = await ask("Delegated work title", ""); if (!title) return;
    const description = await ask("What does success look like?", "", "textarea") ?? "";
    await act({ action: "create_item", processId: item.processId, parentId: item.id, title, description });
  };
  const publish = async () => {
    let location = data.locations.find(({ id }) => id === (item.outputLocationId || process?.outputLocationId));
    if (!location) {
      const created = await addLocationFromDevice(ctx, act, teamId, "folder", data.locations);
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
  const apply = async (proposal) => {
    // an applied plan is done, so go back to the list where it now sits under completed
    if (await act({ action: "apply_proposal", proposalId: proposal.id })) onArchived?.();
  };
  const subitems = data.items.filter((child) => child.parentId === item.id && !child.archivedAt);
  const isWorking = ["queued", "running"].includes(run?.status) || item.runtimePhase === "running";
  const conversationRuns = data.runs.filter((row) => row.workItemId === item.id || subitems.some(({ id }) => id === row.workItemId));
  const visibleHistory = history?.executionId === run?.id ? history : null;
  const discussionPeers = discussion?.participants.filter((peer) => peer.id !== item.id).map((peer) => {
      const peerItem = data.items.find((candidate) => candidate.id === peer.id);
      const peerRun = data.runs.find((candidate) => candidate.workItemId === peer.id);
      return { ...peer, agentId: peerRun?.resolvedAgentId ?? peerItem?.agentAssignmentId ?? peerItem?.agentIds?.[0] };
    }) ?? [];
  const assignedAgentIds = [...new Set([
    ...(item.agentIds ?? []), ...(run?.resolvedAgentIds ?? []),
    ...(item.agentAssignmentId ? [item.agentAssignmentId] : []), ...(run?.resolvedAgentId ? [run.resolvedAgentId] : [])
  ])];
  const mentionOptions = discussion ? agentMentionOptions(assignedAgentIds, assignments, discussionPeers) : [];
  const typedMention = /^\$([^\s]*)$/.exec(composerText);
  const mentionSuggestions = typedMention ? mentionOptions.filter(({ tag }) => tag.startsWith(typedMention[1].toLocaleLowerCase())).slice(0, 5) : [];
  const composerMention = mentionedRecipient(composerText, mentionOptions);
  const messages = conversationMessages(visibleHistory, conversationRuns, assignments, subitems,
    (discussion?.updates ?? []).filter((entry) => ["Owner", "User"].includes(entry.author) && entry.workItemId === item.id)
      .map((entry) => ({ ...entry, label: entry.author === "Owner" ? null
        : entry.targetId ? `To: ${discussion.participants.find((peer) => peer.id === entry.targetId)?.title ?? "teammate"}` : "To: everyone" })));
  const teamQuestions = (data.teamQuestions ?? []).filter((question) => question.workItemId === item.id);
  const processExecution = (data.processExecutions ?? []).find((execution) => execution.workItemId === item.id);
  const pendingKey = interaction?.key ?? pendingRun?.id;
  const lastPendingKey = useRef(null);
  useEffect(() => {
    const newRequest = pendingKey && pendingKey !== lastPendingKey.current;
    lastPendingKey.current = pendingKey;
    if (isScrolledUpRef.current && !newRequest) return;
    const scrollToBottom = () => { if (convoRef.current && (!isScrolledUpRef.current || newRequest)) convoRef.current.scrollTop = convoRef.current.scrollHeight; };
    scrollToBottom();
    const timer = setTimeout(scrollToBottom, 50);
    return () => clearTimeout(timer);
  }, [history, discussion, pendingKey, item.runtimePhase]);
  const convoItems = [h(GoalMessage, { item, key: "start" })];
  for (const message of messages) {
    if (message.role === "user") convoItems.push(h(UserMessage, { key: message.id, label: message.label }, message.text));
    else if (message.role === "tool") convoItems.push(h("div", { className: "bees-convo-msg system bees-convo-log", key: message.id,
      style: { fontFamily: "ui-monospace, monospace", fontSize: "12px", opacity: 0.75 } }, message.text));
    else convoItems.push(h("div", { className: "bees-agent-turn", key: message.id },
      h("div", { className: "bees-agent-avatar", "aria-hidden": "true" }, "B"),
      h("div", { className: `bees-convo-msg agent${message.role === "error" ? " error" : ""}` },
        h("strong", null, message.label),
        message.outcome ? h("span", { className: "bees-message-outcome" }, message.outcome) : null,
        h(MarkdownText, { text: message.text }))));
  }
  if (run?.ranElsewhere) convoItems.push(h("div", { className: "bees-convo-msg system", key: "elsewhere" },
    ["waiting_for_input", "waiting_for_approval"].includes(run.status)
      ? "This run is waiting for an answer on the device that ran it. Open Bees there to answer; this device cannot."
      : "This ran on another device. Its result is above; the full transcript and any files it wrote stayed there."));
  else if (run && !visibleHistory && !historyError) convoItems.push(h("div", { className: "bees-convo-msg system", key: "loading" }, "Loading conversation…"));
  if (processExecution) {
    const runner = data.directory?.find((row) => row.accountUserId === processExecution.userId)?.email
      ?? data.accounts?.find((row) => row.userId === processExecution.userId)?.name ?? processExecution.userId;
    convoItems.push(h("div", { className: "bees-convo-msg system", key: "executor" },
      `Ran by ${runner} on ${processExecution.machineName} from ${when(processExecution.startedAt)}${processExecution.endedAt ? ` to ${when(processExecution.endedAt)}` : ""}.`));
  }
  const conversation = h("div", { className: "bees-convo-panel" },
    h("div", { className: "bees-convo-header" },
      h("div", { className: "bees-convo-title" }, "Conversation"),
      h("span", { className: `bees-detail-badge ${item.runtimePhase || "default"}` }, item.runtimePhase?.replaceAll("_", " ") || "pending"),
      h("span", { style: { flex: 1 } }),
      h("div", { className: "bees-tab-actions" },
        !plan && !item.parentId && !isScheduleDefinition(item) ? h(ExecutionControl, { data, item, act }) : null,
        schedulable && item.runtimePhase === "ready" && !isScheduleDefinition(item) ? h("button", { className: "bees-btn-primary", onClick: () => act({ action: "start_item", itemId: item.id }) }, "Start") : null,
        run && !elsewhere && item.runtimePhase === "paused" ? h("button", { className: "bees-btn-primary", onClick: () => act({ action: "resume_item", itemId: item.id }) }, "Resume") : null,
        run && !elsewhere && !plan && item.runtimePhase === "running" ? h("button", { className: "bees-btn-secondary", onClick: () => act({ action: "pause_item", itemId: item.id }) }, "Pause") : null,
        run && !elsewhere && (plan ? LIVE_RUN.includes(run.status) : item.runtimePhase === "running") ? h("button", { className: "bees-btn-danger-ghost",
          onClick: () => act(plan ? { action: "stop_run", executionId: run.id } : { action: "cancel_item", itemId: item.id }) }, "Stop") : null,
        run && !elsewhere && item.runtimePhase === "waiting" ? h("button", { className: "bees-btn-danger-ghost", onClick: () => act({ action: "cancel_item", itemId: item.id }) }, "Cancel routing") : null,
        run?.status === "completed" && run.outputs?.length ? h("button", { className: "bees-btn-primary", onClick: publish },
          item.outputLocationId || process?.outputLocationId ? "Publish outputs" : "Save outputs to folder…") : null)),
    item.runtimePhase === "failed" ? h("div", { className: "bees-convo-error", role: "alert" },
      h("span", { title: item.runtimeError }, item.runtimeError || "This work failed."),
      !plan && !elsewhere ? h("button", { className: "bees-btn-primary", onClick: () => act({ action: "retry_item", itemId: item.id }) },
        latestResult?.resultOutcome === "blocked" ? "Resolve and continue" : "Retry") : null) : null,
    h("div", {
      className: "bees-convo-history", ref: convoRef,
      onScroll: (event) => {
        const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
        isScrolledUpRef.current = Math.abs(scrollHeight - clientHeight - scrollTop) > 30;
      }
    },
      ...convoItems,
      ...(plan ? pendingProposals(data, run) : []).map((proposal) => h(ProposalCard, { key: proposal.id, proposal, onApply: () => apply(proposal),
        onDismiss: () => act({ action: "reject_proposal", proposalId: proposal.id }) })),
      ...teamQuestions.map((question) => h(TeamQuestionCard, { key: question.id, question, data, act })),
      pendingRun ? h(AgentInteractionPanel, { run: pendingRun, item: data.items.find(({ id }) => id === pendingRun.workItemId) ?? item,
        interaction, handled, inConversation: true, onAnswered: answered, act, data, servers: capabilities?.data?.servers, onOpenTools: process ? () => {
          setActiveTab("tools");
          document.getElementById("bees-tab-tools")?.scrollIntoView({ behavior: "smooth", block: "start" });
        } : undefined }) : null,
      !pendingRun && isWorking ? h("div", { className: "bees-convo-msg system bees-working-indicator" },
        h("span", { className: "bees-dot-typing-container" }, h("span", { className: "bees-dot-typing-dot" })),
        run?.status === "queued" ? "Agent is starting..." : [...messages].reverse().find((message) => message.pending)?.text ?? "Agent is working...") : null),
    sendError ? h("div", { className: "bees-error", role: "alert" }, sendError) : null,
    sendNotice ? h("p", { className: "bees-muted", role: "status" }, sendNotice) : null,
    h("form", { className: "bees-composer bees-compact-composer", onSubmit: async (event) => {
      event.preventDefault();
      const text = composerText.trim();
      const mention = composerMention;
      if (!text || sending || (!mention && run?.ranElsewhere)) return;
      isScrolledUpRef.current = false;
      // the reply can land after the person opened another item, so drop it then
      const stale = () => itemIdRef.current !== item.id;
      setSendError(""); setSendNotice("");
      if (mention) {
        if (!mention.body) { setSendError("Add a message after the teammate tag."); return; }
        setSending(true);
        try {
          await request("/bees-api/command", { method: "POST", body: JSON.stringify({
            action: "post_work_update", itemId: item.id, kind: "note", content: text,
            targetId: mention.recipient.targetId
          }) });
          const updated = await request("/bees-api/command", { method: "POST", body: JSON.stringify({ action: "read_work_discussion", itemId: item.id }) });
          if (stale()) return;
          setDiscussion(updated); setComposerText("");
          const recipients = mention.recipient.id === "everyone" ? updated.participants
            : mention.recipient.targetId ? updated.participants.filter((peer) => peer.id === mention.recipient.targetId)
              : [{ status: item.runtimePhase }];
          setSendNotice(recipients.some((peer) => ["ready", "queued", "running", "waiting"].includes(peer.status))
            ? "Shared with the team. Active agents can read it on their next step."
            : "Saved to Discussion. This teammate has finished; the message will not restart them. Arrange a follow-up to get a reply.");
        } catch (reason) { if (!stale()) setSendError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setSending(false); }
        return;
      }
      const finished = run && (item.runtimePhase === "completed" || item.runtimePhase === "failed");
      if (!finished && !activeRun) return;
      setSending(true);
      try {
        const said = await hideKeys(text);
        if (finished) {
          if (!await act({ action: "continue_run", executionId: run.id, text: said })) return;
        }
        else {
          // a run's session reaches this list a few seconds after the run starts
          if (!ctx.sessions.list.getSnapshot().byId[activeRun.sessionId]) await ctx.sessions.refresh();
          if (!ctx.sessions.list.getSnapshot().byId[activeRun.sessionId]) throw new Error("The agent is still starting. Send again in a few seconds.");
          const result = await ctx.sessions.using(activeRun.sessionId, { source: "bees" },
            (reference) => reference.binding.session.prompt([{ type: "text", text: said }], "queue"));
          if (!result.ok) throw result.error;
          await request("/bees-api/command", { method: "POST", body: JSON.stringify({ action: "record_owner_message", executionId: activeRun.id, text: said }) });
        }
        if (!stale()) setComposerText("");
      } catch (reason) { if (!stale()) setSendError(reason instanceof Error ? reason.message : String(reason)); }
      finally {
        setSending(false);
        if (stale()) return;
        setRefreshCount((count) => count + 1);
        setTimeout(() => setRefreshCount((count) => count + 1), 500);
      }
    } },
      composerMention ? h("div", { className: "bees-muted", style: { padding: "10px 12px 0" } },
        "Sending to ", h("span", { className: "bees-agent-mention" }, `$${composerMention.recipient.tag}`)) : null,
      mentionSuggestions.length ? h("div", { className: "bees-mention-suggestions", role: "listbox", "aria-label": "Teammate suggestions" },
        ...mentionSuggestions.map((option) => h("button", { type: "button", role: "option", key: option.id,
          onClick: () => { setComposerText(`$${option.tag} `); setSendNotice(""); } },
          h("span", { className: "bees-agent-mention" }, `$${option.tag}`), option.status ? ` · ${option.status}` : ""))) : null,
      h("textarea", {
        className: "bees-composer-input",
        placeholder: pendingRun ? "Answer the card, or type $ to message a teammate..." : "Message the current agent, or type $ for teammates...",
        disabled: sending, value: composerText, rows: 2,
        onChange: (event) => setComposerText(event.target.value),
        onKeyDown: (event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.target.form.requestSubmit(); } }
      }),
      h("button", { type: "submit", className: "bees-composer-send", disabled: sending || (run?.ranElsewhere && !composerMention) || !composerText.trim(), "aria-label": "Send message" }, sending ? "…" : "↑")));

  const details = h("div", { className: "bees-details-panel" },
    // tabs header
    h("div", { className: "bees-clean-tabs", role: "tablist", "aria-label": "Work item details" },
      h("button", { type: "button", role: "tab", id: "bees-tab-files", className: `bees-clean-tab ${activeTab === "files" ? "active" : ""}`, "aria-selected": activeTab === "files", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("files") }, "Files", unreadFiles ? h("span", { className: "bees-count", "aria-label": `${unreadFiles} new files`, title: `${unreadFiles} new files` }, unreadFiles) : null),
      h("button", { type: "button", role: "tab", id: "bees-tab-details", className: `bees-clean-tab ${activeTab === "details" ? "active" : ""}`, "aria-selected": activeTab === "details", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("details") }, "Details"),
      h("button", { type: "button", role: "tab", id: "bees-tab-tools", className: `bees-clean-tab ${activeTab === "tools" ? "active" : ""}`, "aria-selected": activeTab === "tools", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("tools") }, "Add-ons"),
      h("button", { type: "button", role: "tab", id: "bees-tab-recurring", className: `bees-clean-tab ${activeTab === "recurring" ? "active" : ""}`, "aria-selected": activeTab === "recurring", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("recurring") }, `Schedules (${recurringWork.length})`),
      h("button", { type: "button", role: "tab", id: "bees-tab-chat", className: `bees-clean-tab ${activeTab === "chat" ? "active" : ""}`, "aria-selected": activeTab === "chat", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("chat") }, "Chat"),
      !plan && itemRuns.length ? h("button", { type: "button", role: "tab", id: "bees-tab-context", className: `bees-clean-tab ${activeTab === "context" ? "active" : ""}`, "aria-selected": activeTab === "context", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("context") }, "Context") : null,
      !plan && itemRuns.length ? h("button", { type: "button", role: "tab", id: "bees-tab-discussion", className: `bees-clean-tab ${activeTab === "discussion" ? "active" : ""}`, "aria-selected": activeTab === "discussion", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("discussion") }, "Discussion") : null,
      !plan && process ? h("button", { type: "button", role: "tab", id: "bees-tab-memory", className: `bees-clean-tab ${activeTab === "memory" ? "active" : ""}`, "aria-selected": activeTab === "memory", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("memory") }, "Memory") : null,
      itemRuns.length ? h("button", { type: "button", role: "tab", id: "bees-tab-runs", className: `bees-clean-tab ${activeTab === "runs" ? "active" : ""}`, "aria-selected": activeTab === "runs", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("runs") }, "Executions") : null,
      itemRuns.length ? h("button", { type: "button", role: "tab", id: "bees-tab-audit", className: `bees-clean-tab ${activeTab === "audit" ? "active" : ""}`, "aria-selected": activeTab === "audit", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("audit") }, "Traces") : null
    ),

    // tab content
    h("div", { className: `bees-tab-panel${activeTab === "tools" ? " bees-mcp-tab-panel" : ""}`, role: "tabpanel", id: "bees-detail-panel", "aria-labelledby": `bees-tab-${activeTab}` },
      // DSH's own Chat screen stays mounted here regardless of activeTab; only its CSS
      // visibility follows it, because unmounting it would drop DSH's portal and session state.
      h(DshRunPanels, { key: item.id, ctx, run, item, activeTab }),
      activeTab === "memory" && process ? h(ProcessMemoryPanel, { key: process.id, process, act, onOpenWork })
      : activeTab === "discussion" ? h(WorkDiscussion, { key: item.id, item, onOpenWork: (id) => { onOpenWork?.(id); setActiveTab("files"); } }) : activeTab === "context" ? h(SharedWorkContext, { key: item.id, item, executionId: run?.id }) : activeTab === "details" ? h(React.Fragment, null,
        plan ? null : h("div", { className: "bees-detail-actions", style: { marginTop: 0 } },
          h("button", { className: "bees-btn-secondary", onClick: edit }, h("span", { className: "bees-btn-icon" }, "✎"), "Edit item"),
          h("button", { className: "bees-btn-secondary", onClick: addSubitem }, h("span", { className: "bees-btn-icon" }, "⑆"), "Delegate work"),
          !item.archivedAt && schedulable ? h("button", { className: "bees-btn-secondary", onClick: () => onEditSchedule(true) }, h("span", { className: "bees-btn-icon" }, "🕒"), "Schedule") : null),
        // Description
        bodyDescription || !item.description ? h("div", { className: "bees-card-section" },
          h("div", { className: "bees-card-section-head" }, "Description"),
          bodyDescription ? h(MarkdownText, { text: bodyDescription }) : h("p", { className: "bees-muted", style: { margin: 0 } }, "No description provided.")
        ) : null,

        process?.description ? h("div", { className: "bees-card-section" },
          h("div", { className: "bees-card-section-head" }, "Process Description"),
          h(MarkdownText, { text: process.description })
        ) : null,

        plan ? null : h(WorkLocations, { key: item.id, data, references: inputReferences, inherited,
          outputId: item.outputLocationId ?? "", defaultOutputId: process?.outputLocationId, act })
      ) : activeTab === "tools" ? process ? h(ProcessMcpForm, {
        key: `${process.id}:${process.mcpAccess}:${JSON.stringify(process.mcpServers)}`, ctx, process,
        servers: capabilities.data?.servers ?? [], tools: capabilities.data?.tools ?? [],
        catalog: capabilities.data?.catalog ?? [], onServerAction: capabilities.act, act, showAll: true
      }) : h(Empty, null, "This work has no process add-on settings.") : activeTab === "files" ? h(React.Fragment, null,
        h(WorkFiles, { key: processRunId, runs: fileRuns, filesRef, act })
      ) : activeTab === "runs" ? h(React.Fragment, null,
        h("h3", { className: "bees-section-title" }, "Executions"),
        itemRuns.length ? h("div", { className: "bees-run-list" }, ...itemRuns.map((row) => h("button", { className: `bees-run-row ${row.id === run?.id ? "active" : ""}`, key: row.id, onClick: () => setSelectedRun(row.id) },
          h("span", { className: `bees-status bees-${row.status}` }, row.status.replaceAll("_", " ")), h("span", null, when(row.updatedAt)), h("span", { title: row.dispatchReason }, row.agentName || row.resolvedAgentName || "Agent"), h("span", { className: "bees-muted" }, row.dispatchReason || ""), h("span", { className: "bees-grow" }), h("span", { className: "bees-muted" }, `${row.outputs?.length ?? 0} output${row.outputs?.length === 1 ? "" : "s"}`)))) : h(Empty, null, "No executions yet")
      ) : activeTab === "recurring" ? h(RecurringWorkPanel, { data, item, recurringWork, act, onEdit: onEditSchedule })
      : activeTab === "audit" ? h("div", { style: { height: "100%", display: "flex", flexDirection: "column" } },
        run ? h(RunTraces, { key: run.id, run }) : h("p", { className: "bees-muted" }, "No active run to show traces for.")
      )
      : null
    )
  );

  return h(React.Fragment, null,
    boardActions,
    h(FlexibleGrid, {
      layout, editing, onLayout,
      className: "bees-work-item-grid",
      panels: {
        kanban: { label: "Kanban", hideHeader: true, borderless: true, minW: 6, minH: 4, maxH: 4, content: board },
        conversation: { label: "Conversation", hideHeader: true, minW: 3, minH: 9, content: conversation },
        details: { label: "Details", hideHeader: true, minW: 3, minH: 9, content: details }
      }
    })
  );
}

export function ExecutionControl({ data, item, act }) {
  const local = (data.executionOwners ?? []).find((row) => row.workItemId === item.id);
  const listed = (data.processExecutions ?? []).find((row) => row.workItemId === item.id);
  const [older, setOlder] = useState(null);
  useEffect(() => {
    if (listed || local && local.state !== 'released') return;
    const abort = new AbortController();
    request('/bees-api/command', { method:'POST', signal:abort.signal,
      body:JSON.stringify({ action:'read_execution_owner',itemId:item.id }) })
      .then(({ execution }) => { if (!abort.signal.aborted) setOlder(execution); }).catch(() => {});
    return () => abort.abort();
  }, [item.id, Boolean(listed), local?.state]);
  const execution = listed ?? (older?.workItemId === item.id ? older : null);
  if (local && local.state !== 'released' && local.machineId === data.currentDeviceId) return h('span', null,
    local.continuing ? h(Button, { onClick: () => act({ action: 'continue_item', itemId: item.id }) }, 'Finish continuing') : null,
    h(Button, {
    onClick: async () => {
      if (local.state !== 'relinquishing' && !await confirmAction('Stop this process run and its delegated work, save its checkpoint beside the run files, and relinquish control? Another user can then continue on their machine. The unfinished stage will restart using the saved files.')) return;
      return act({ action: 'relinquish_item', itemId: item.id });
    }
  }, local.state === 'relinquishing' ? 'Finish relinquishing control' : 'Relinquish control'));
  const recovering = execution?.handoff && execution.machineId === data.currentDeviceId &&
    (data.accounts ?? []).some((account) => account.userId === execution.userId && account.enabled);
  if (execution?.relinquishedAt || recovering) return h(Button, { className: 'primary',
    onClick: () => act({ action: 'continue_item', itemId: item.id })
  }, 'Continue on this machine');
  if (execution) return h('span', { className: 'bees-muted' }, `Controlled on ${execution.machineName}. The owner must relinquish control before you can continue.`);
  return null;
}

function RunTraces({ run }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");
  const revision = useBeesChangeRevision();
  useEffect(() => {
    const abort = new AbortController();
    request(`/bees-api/audit?executionId=${encodeURIComponent(run.id)}`, { signal: abort.signal }).then((value) => {
      if (!abort.signal.aborted) {
        setEvents(value.events ?? []);
        setError("");
      }
    }).catch((reason) => { if (!abort.signal.aborted) setError(reason.message); });
    return () => abort.abort();
  }, [run.id, revision]);
  return error ? h("p", { className: "bees-error", role: "alert" }, error)
    : events === null ? h("p", { role: "status" }, "Loading traces...")
    : events.length ? h("div", null, ...events.map((event) => h(AuditEvent, { key: event.id, event })))
    : h(Empty, null, "No audit events for this execution yet.");
}

function WorkItemCockpit({ ctx, data, rootId, teamId, act, onBack, onScheduleCreated, preference, preferences, setPageActions, setPageHeader, capabilities }) {
  const opened = data.items.find(({ id }) => id === rootId);
  const processRunId = opened?.processRunId ?? rootId;
  const root = data.items.find(({ id }) => id === processRunId);
  const [selectedId, setSelectedId] = useState(rootId);
  const [editing, setEditing] = useState(false);
  const [scheduleEditor, setScheduleEditor] = useState(false);
  const [creatingRun, setCreatingRun] = useState(false);
  useEffect(() => setSelectedId(rootId), [rootId]);
  useEffect(() => { setEditing(false); setScheduleEditor(false); setCreatingRun(false); }, [rootId]);
  const visibleIds = new Set([processRunId]);
  for (let added = true; added;) {
    added = false;
    for (const item of data.items) if ((!root || item.processId === root.processId) && item.parentId && visibleIds.has(item.parentId) && !visibleIds.has(item.id)) {
      visibleIds.add(item.id); added = true;
    }
  }
  const items = data.items.filter(({ id, archivedAt }) => visibleIds.has(id) && !archivedAt);
  if (!root || root.archivedAt || !data.processes.some(({ id, archivedAt }) => id === root.processId && !archivedAt))
    return h(Empty, null, "Work item not found");
  const process = data.processes.find(({ id }) => id === root.processId);
  const stages = data.stages.filter(({ processId }) => processId === root.processId);
  const schedulable = stages.length >= 2 && stages.at(-1)?.driver === "terminal" &&
    stages.every(({ driver }) => ["agent", "discussion", "review", "terminal"].includes(driver));
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
  const completed = items.filter((item) => workItemStatus(item) === "completed").length;
  const total = items.length;
  const layout = workItemLayoutFrom(preference.workItemLayout);
  
  const archive = async () => {
    if (!await confirmAction(`Archive “${root.title}”? Active work will be cancelled. Its history will be preserved.`)) return;
    if (await act({ action: "archive_item", itemId: root.id })) onBack?.();
  };
  const restore = () => act({ action: "archive_item", itemId: root.id, restore: true });
  const boardComponent = h("div", { className: "bees-board bees-cockpit-board", style: { flex: 1, minHeight: 0 } }, ...stages.map((stage) => {
    const rows = items.filter(({ stageId }) => stageId === stage.id);
    return h("section", { className: "bees-column", key: stage.id },
      h("header", { className: "bees-column-head" }, stage.name, h("span", { className: "bees-count" }, rows.length)),
      h("div", { className: "bees-cards" }, ...(rows.length ? rows.map((item) => {
        const run = latest.get(item.id); const parentPath = lineage(item);
        const routedIds = run?.resolvedAgentIds?.length ? run.resolvedAgentIds : item.agentIds?.length ? item.agentIds : stage.agentIds ?? [];
        const routedAgents = routedIds.map((id) => data.assignments.find((agent) => agent.id === id)).filter(Boolean);
        return h("button", { className: `bees-hierarchy-card ${selected.id === item.id ? "active" : ""}`, key: item.id, onClick: () => setSelectedId(item.id) },
          h("h3", null, item.title),
          item.description ? h("div", { className: "bees-card-desc" }, item.description) : null,
          h("div", { className: "bees-card-badges" },
            h("span", { className: `bees-detail-badge ${workItemStatus(item)}` }, workItemStatus(item).replaceAll("_", " ")),
            item.id === root.id ? h("span", { className: "bees-root-chip" }, "Root work item") : null),
          parentPath ? h("div", { className: "bees-lineage bees-muted", title: parentPath }, `Parent: ${parentPath}`) : null,
          h("div", { className: "bees-card-metadata" },
            h("div", null, h("span", null, routedAgents.length > 1 ? "Discussion" : run?.resolvedAgentId ? "Agent" : "Assigned agent"),
              h("strong", null, routedAgents.map(({ name }) => name).join(", ") || (item.kind === "plan" ? "Bees" : run?.resolvedAgentId ? "Unavailable agent" : "Stage default"))),
            h("div", null, h("span", null, "Started"),
              run?.startedAt ? h("time", { dateTime: run.startedAt }, when(run.startedAt))
                : h("span", null, !run || run.status === "queued" ? "Not started" : "Time unavailable"))));
      }) : [h(Empty, { key: "empty" }, "No work")])));
  }));

  const boardActions = h("div", { className: "bees-row bees-answer-controls bees-work-item-actions", style: { padding: "10px 14px", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap", borderBottom: "1px solid var(--dsw-alias-border-l1)", flex: "none" } },
    !editing && !root.archivedAt && !isScheduleDefinition(root) && root.kind !== "plan" && schedulable ? h(Button, { onClick: () => setScheduleEditor(true) }, "Schedule") : null,
    root.kind !== "plan" ? (!root.archivedAt ? h(Button, { className: "danger", onClick: archive }, "Archive")
          : h(Button, { onClick: restore }, "Restore")) : null,
    !editing && !root.archivedAt && !isScheduleDefinition(root) && root.kind !== "plan" ? h(Button, { className: "primary", onClick: () => setCreatingRun(true) }, "New Process Run") : null
  );

  const board = boardComponent;
  useEffect(() => {
    if (creatingRun) return;
    setPageHeader && setPageHeader(
      h(React.Fragment, null,
        h(Button, { onClick: onBack }, h(ArrowLeftIcon), " Back"),
        h("div", { style: { display: "flex", flexDirection: "column", marginLeft: 12, minWidth: 0 } },
          h("div", { className: "bees-title", title: root.title, style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, root.title.length > 60 ? root.title.slice(0, 60).trim() + "…" : root.title),
          h("div", { className: "bees-context", style: { marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, `${process?.name ?? "Process"} · ${isScheduleDefinition(root) ? "Schedule" : `${completed} of ${total} work items complete`}`)
        )
      )
    );
    setPageActions && setPageActions(
      h("div", { className: "bees-page-actions" },
        editing ? h(Button, { onClick: () => preferences.set("workItemLayout", preferences.productDefaults
          ? [] : preferences.getSnapshot().base?.workItemLayout ?? []) }, "Reset") : null,
        h(Button, { className: editing ? "primary" : "", onClick: () => setEditing((value) => !value) }, editing ? "Done" : "Customize")
      )
    );
    return () => {
      setPageHeader && setPageHeader(null);
      setPageActions && setPageActions(null);
    };
  }, [root.title, root.processId, root.archivedAt, root.recurringWorkId, root.kind, schedulable, process?.name, completed, total, editing, creatingRun, onBack, setPageHeader, setPageActions]);

  if (creatingRun) return h(WorkItemForm, {
    ctx, data, workspaceId: process.workspaceId, defaultProcessId: process.id, act, setPageHeader, capabilities,
    onCancel: () => setCreatingRun(false), onCreated: onScheduleCreated
  });

  return h("div", { style: { display: "flex", flexDirection: "column" } },
    h(WorkItemDetails, {
      ctx, data, item: selected, teamId, act, capabilities, onOpenWork: setSelectedId, onArchived: onBack, onScheduleCreated, board, boardActions, layout, editing,
      onLayout: (value) => void preferences.set("workItemLayout", applyWorkItemLayout(value)),
      onEditSchedule: setScheduleEditor,
      setPageHeader, preference, preferences
    }),
    scheduleEditor ? h(ScheduleForm, { item: root, recurring: scheduleEditor === true ? null : scheduleEditor, act,
      onClose: () => setScheduleEditor(false), onCreated: onScheduleCreated }) : null
  );
}

function WorkItemForm({ ctx, data, kind, workspaceId, defaultProcessId, parent, act, onCancel, onCreated, setPageHeader, capabilities }) {
  const processes = data.processes.filter((process) => process.workspaceId === workspaceId);
  const assignments = data.assignments.filter((assignment) => assignment.workspaceId === workspaceId);
  const mentionableAgents = assignments.filter(({ enabled }) => enabled);
  const goal = kind === "goal";
  const processRun = !goal && !parent;
  const heading = parent ? "Add work item" : goal ? "New goal" : "Start process run";
  const backLabel = h(React.Fragment, null, h(ArrowLeftIcon), " Back");
  const initialProcess = goal ? processes.find(({ kind }) => kind === "goals")
    : processes.find(({ id }) => id === (parent?.processId ?? defaultProcessId)) ?? processes[0];
  const [processId, setProcessId] = useState(initialProcess?.id ?? "");
  const [inputLocationIds, setInputLocationIds] = useState([]);
  const [outputLocationId, setOutputLocationId] = useState("");

  if (!workspaceId) return h("div", { className: "bees-stack" },
    h(PageHead, { setPageHeader }, h(Button, { onClick: onCancel }, backLabel), h("h2", null, heading)),
    h(Empty, null, processRun ? "Choose a team before starting a process run." : "Choose a team before creating work."));

  const process = processes.find(({ id }) => id === processId) ?? initialProcess;
  const firstStage = data.stages.find(({ processId }) => processId === process?.id);
  const routedAgentId = firstStage?.agentIds?.[0]
    ?? assignments.find(({ systemRole }) => systemRole === (firstStage?.driver === "review" ? "reviewer" : "worker"))?.id;
  const inherited = [...inheritedInputs(data, process?.id, routedAgentId),
    ...(parent ? data.attachments.filter(({ workItemId }) => workItemId === parent.id)
      .map((reference) => ({ ...reference, source: "Process run" })) : [])];
  const defaultOutputId = parent?.outputLocationId || process?.outputLocationId;
  const teamId = data.workspaces.find(({ id }) => id === workspaceId)?.teamId;

  const [guardRun, preflight] = useMcpPreflight({ ctx, data, workspaceId, capabilities, act });
  const [busy, onSubmit] = useSubmit(async (event) => {
    const form = new FormData(event.currentTarget);
    const command = goal ? {
      action: "create_goal", workspaceId, title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""), priority: String(form.get("priority") ?? "normal"),
      inputLocationIds, outputLocationId
    } : {
      action: processRun ? "create_run" : "create_item", processId,
      ...(parent ? { parentId: parent.id } : {}),
      title: String(form.get("title") ?? ""), description: String(form.get("description") ?? ""),
      priority: String(form.get("priority") ?? "normal"),
      inputLocationIds, outputLocationId
    };
    if (!await guardRun(goal ? initialProcess?.id : processId)) return;
    const created = await act(command); if (created?.id) onCreated(created.id);
  });
  if (!goal && !processes.length) return h("div", { className: "bees-stack" },
    h(PageHead, { setPageHeader }, h(Button, { onClick: onCancel }, backLabel), h("h2", null, heading)),
    h(Empty, null, "Create a process template first. Work always follows a process template so Bees knows its stages."));
  return h(React.Fragment, null, preflight, h("form", { className: "bees-form bees-process-form", onSubmit },
    h(PageHead, { setPageHeader }, h(Button, { onClick: onCancel }, backLabel),
      h("div", null, h("h2", null, heading), parent || goal ?
        h("div", { className: "bees-muted" }, parent
          ? `Add to “${parent.title}” with its existing context, files and discussion.`
          : "Describe the outcome. Bees will plan and execute the work needed to reach it.") : null)),
    !goal && !parent ? h("label", { className: "bees-process-name" }, "Process template", h("select", { className: "bees-select", name: "processId", required: true,
      value: processId, onChange: (event) => {
        setProcessId(event.target.value); setOutputLocationId("");
      } },
      ...processes.map((process) => h("option", { value: process.id, key: process.id }, process.name)))) : null,
    h("label", { className: "bees-process-name" }, goal ? "Goal" : processRun ? "Run name" : "Title", h("input", { className: "bees-input", name: "title", required: true, autoFocus: true,
      placeholder: goal ? "Launch the product successfully" : "Draft the launch announcement" })),
    h("label", { className: "bees-process-name" },
      h("span", { style: { display: "flex", alignItems: "center", gap: "6px" } },
        "What does success look like?",
        h(HelpTooltip, { icon: "!", text: mentionableAgents.length
          ? `Type $ to assign agents to this work. Mentioning multiple agents (e.g. ${mentionableAgents.slice(0, 4).map(({ name }) => `$${agentTag(name)}`).join(" ")}) will start a discussion between them.`
          : "Create an agent before using $mentions." })
      ),
      h("textarea", { className: "bees-textarea", name: "description",
        placeholder: "Describe the expected outcome (e.g. $CEO and $CMO discuss the strategy...)" })),
    h("div", { className: "bees-form-row bees-process-name" },
      h("label", null, "Priority", h("select", { className: "bees-select", name: "priority", defaultValue: "normal" },
        h("option", { value: "low" }, "Low"), h("option", { value: "normal" }, "Normal"), h("option", { value: "high" }, "High")))),
    h("div", { className: "bees-process-files" },
      h(ResourceFields, { ctx, data, teamId, act, inputIds: inputLocationIds, onInputIds: setInputLocationIds,
        outputId: outputLocationId, onOutputId: setOutputLocationId, inherited,
        defaultOutputId, defaultOutputName: data.locations.find(({ id }) => id === defaultOutputId)?.name ?? "", compact: true })),
    process && !parent ? h("div", { className: "bees-process-mcps" },
      h("p", { className: "bees-muted", style: { margin: 0, marginBottom: "8px" } }, "Process add-ons are shared with every agent and future work in this process. Changes save automatically."),
      h(McpAccess, { key: process.id, ctx, servers: capabilities?.data?.servers ?? [],
        tools: capabilities?.data?.tools ?? [], catalog: capabilities?.data?.catalog ?? [],
        onServerAction: capabilities?.act, access: process.mcpAccess, chosen: process.mcpServers,
        scope: "process", showAll: true, onChange: ({ mcpAccess, mcpServers }) =>
          act({ action: "set_process_mcp", processId: process.id, mcpAccess, mcpServers }) })) : null,
    h("div", { className: "bees-detail-actions bees-process-actions", style: { justifyContent: "flex-end" } },
      h(Button, { onClick: onCancel }, "Cancel"),
      h("button", { className: "bees-btn primary", disabled: busy }, busy ? "Creating…" : parent ? "Add work item" : goal ? "Create goal" : "Start process run"))
  ));
}

function displayOption(label) {
  const text = String(label);
  const recommended = /\s*\(recommended\)\s*$/i.test(text);
  return { label: text.replace(/\s*\(recommended\)\s*$/i, ""), recommended };
}

export { FilePreview };

function WorkReviewPanel({ wait, onAnswered, act, executionId, item, data }) {
  const pending = wait;
  const question = pending.questions?.[0];
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState("current");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [guidance, setGuidance] = useState(null);
  const [playbook, setPlaybook] = useState("");
  const [futureSaved, setFutureSaved] = useState(false);
  const recurring = data?.recurringWork?.find(({ id }) => id === item?.recurringWorkId);
  const loadGuidance = async () => {
    setScope("future"); setBusy("loading"); setError("");
    try {
      if (!act || !executionId) throw new Error("Future-run guidance is unavailable for this review");
      const value = await act({ action: "specialist_feedback_context", executionId });
      if (!value) throw new Error("The producing specialist's playbook could not be loaded");
      setGuidance(value); setPlaybook(value.playbook);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(""); }
  };
  const answer = async (outcome, feedback = "") => {
    setBusy(outcome); setError("");
    let saved = futureSaved;
    try {
      const detail = feedback.trim();
      if (outcome === "reject" && scope === "future" && !saved) {
        if (!act || !executionId || !recurring || !guidance) throw new Error("Load and edit the future-run guidance first");
        // Save before answering: the native review disappears as soon as its answer is accepted.
        const learned = await act({ action: "apply_specialist_feedback", executionId, feedback: detail,
          applyToFuture: true, playbook, expectedRevision: guidance.revision });
        if (!learned) throw new Error("Future guidance was not saved. The rejection has not been sent");
        saved = true; setFutureSaved(true);
      }
      await pending.answer({ answers: [{
        id: question.id, selected: outcome === "approve" ? ["Approve"] : [],
        ...(detail ? { custom: detail } : {})
      }] });
      onAnswered(wait.key);
    } catch (reason) {
      setBusy("");
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(saved ? `Future guidance was saved, but the review answer could not be confirmed. Retry sending the rejection. ${message}` : message);
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
        busy === "approve" ? "Approving..." : "Approve")));
  return h(React.Fragment, null,
    h("div", null, h("div", { className: "bees-muted" }, "Reject work"),
      h("h3", { className: "bees-section-title" }, "What should change in this run?")),
    h("textarea", {
      className: "bees-textarea", value: reason, maxLength: 2_000, autoFocus: true, disabled: Boolean(busy) || futureSaved,
      placeholder: "Give concrete corrections. The original feedback is preserved for this run and its reviewer.",
      onChange: (event) => setReason(event.target.value)
    }),
    h("div", { className: "bees-muted" }, `${reason.length}/2000. These corrections are mandatory for this run, not optional discussion or recalled memory.`),
    recurring ? h("div", { className: "bees-question-options", role: "radiogroup", "aria-label": "Feedback scope" },
      h("button", { type: "button", role: "radio", disabled: Boolean(busy) || futureSaved, "aria-checked": scope === "current", className: `bees-choice ${scope === "current" ? "selected" : ""}`, onClick: () => setScope("current") },
        h("span", { className: "bees-choice-mark" }, "1"), h("span", { className: "bees-choice-copy" }, h("strong", null, "This run only"), h("span", { className: "bees-muted" }, "Revise this result without changing future behavior."))),
      h("button", { type: "button", role: "radio", disabled: Boolean(busy) || futureSaved, "aria-checked": scope === "future", className: `bees-choice ${scope === "future" ? "selected" : ""}`, onClick: () => void loadGuidance() },
        h("span", { className: "bees-choice-mark" }, "2"), h("span", { className: "bees-choice-copy" }, h("strong", null, `Also apply guidance to future ${recurring.name} runs`),
          h("span", { className: "bees-muted" }, "Review a concise playbook update, not a permanent copy of this rejection.")))) :
      h("p", { className: "bees-muted" }, "This feedback applies to this goal only. One-off work does not change an agent's future behavior."),
    scope === "future" && guidance ? h("div", { className: "bees-stack" },
      h("label", null, `Future guidance for ${guidance.name} (editing version ${guidance.revision})`,
        h("textarea", { className: "bees-textarea", value: playbook, maxLength: 6000, rows: 8,
          disabled: Boolean(busy) || futureSaved, onChange: (event) => setPlaybook(event.target.value),
          placeholder: "Write reusable guidance, keeping any existing rules that still apply." })),
      h("p", { className: "bees-muted" }, `${playbook.length}/6000. This replaces the full playbook: merge repeated rules, preserve useful guidance, and omit one-run exceptions. Workers and reviewers use the same frozen version in future runs; current runs keep their existing guidance.`),
      !futureSaved ? h(Button, { disabled: Boolean(busy), onClick: () => void loadGuidance() }, "Reload latest playbook (discard edits)") : null) : null,
    busy === "loading" ? h("p", { role: "status" }, "Loading the producing specialist's playbook...") : null,
    futureSaved ? h("p", { role: "status", className: "bees-callout" }, "Future guidance is saved. Finish sending the rejection below.") : null,
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
    h("div", { className: "bees-answer-actions" },
      h(Button, { disabled: Boolean(busy) || futureSaved, onClick: () => { setRejecting(false); setError(""); } }, "Back"),
      h("div", { className: "bees-grow" }),
      h(Button, { className: "danger", disabled: Boolean(busy) || reason.trim().length < 3 ||
        scope === "future" && !futureSaved && (!guidance || playbook.trim().length < 3 || playbook.trim() === guidance.playbook),
        onClick: () => void answer("reject", reason) }, busy === "reject" ? "Rejecting..." : "Reject and send feedback")));
}

// Autofocus scrolled the widget to the box, so the question above it was out of view before you read it.
const focusWithoutScroll = (element) => element?.focus({ preventScroll: true });

function TeamQuestionCard({ question, data, act }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const person = (id) => data.directory?.find((row) => row.accountUserId === id)?.email
    ?? data.accounts?.find((row) => row.userId === id)?.name ?? id;
  const send = async () => {
    if (!answer.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await act({ action: "answer_team_question", teamId: question.teamId,
        questionId: question.id, answer: answer.trim() });
      if (result?.accepted === false) setError(`Already answered by ${person(result.question.answeredBy)}.`);
      else setAnswer("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return h("div", { className: "bees-convo-msg agent bees-convo-msg-interactive" },
    h("strong", null, "Question for the team"),
    h("p", { style: { whiteSpace: "pre-wrap" } }, question.question),
    h("div", { className: "bees-muted" }, `Asked by ${person(question.askedBy)} on ${when(question.askedAt)}`),
    question.answeredAt
      ? h("div", null, h("p", null, question.answer), h("div", { className: "bees-muted" },
        `Answered by ${person(question.answeredBy)} on ${when(question.answeredAt)} · device ${question.answeredOnDevice}`))
      : h("div", null,
        h("textarea", { className: "bees-textarea", value: answer, disabled: busy,
          "aria-label": "Answer the team question", onChange: (event) => setAnswer(event.target.value) }),
        h(Button, { className: "primary", disabled: busy || !answer.trim(), onClick: send }, busy ? "Sending…" : "Answer")),
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
}

export function QuestionPanel({ wait, onAnswered, act, executionId, browser, data, workspaceId, onOpenTools, servers, since }) {
  const pending = wait;
  const questions = pending.questions ?? [];
  return h(GenericQuestionPanel, { pending, questions, wait, onAnswered, act, executionId, browser, data, workspaceId, onOpenTools, servers, since });
}

function GenericQuestionPanel({ pending, questions, wait, onAnswered, act, executionId, browser, data, workspaceId, onOpenTools, servers, since }) {
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState(() => questions.map(() => ({ selected: [], custom: "", skipped: false })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { ctx } = React.useContext(NativeUi);
  const teamId = data?.workspaces.find(({ id }) => id === workspaceId)?.teamId;
  const provideFile = async () => {
    setBusy(true); setError("");
    try {
      const location = await addLocationFromDevice(ctx, act, teamId, "file", data?.locations ?? []);
      if (!location?.id) return;
      const result = await act({ action: "provide_run_input", executionId, locationId: location.id });
      if (!result?.manifest) throw new Error("The file could not be attached to this run.");
      setDraft((current) => ({ ...current, skipped: false, custom: [current.custom, result.manifest].filter(Boolean).join("\n") }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  // connecting the add-on the agent asked for is the answer, so send it once that add-on is ready,
  // counting one connected after the run started waiting in case it was done from the Add-ons page
  const knownServers = useRef(null);
  useEffect(() => {
    if (!servers) return;
    knownServers.current ??= servers.filter(({ createdAt }) => !(Date.parse(createdAt) > Date.parse(since))).map(({ id }) => id);
    const fresh = servers.find((server) => server.status === "connected" && !knownServers.current.includes(server.id));
    if (!fresh) return;
    knownServers.current.push(fresh.id);
    const [only] = questions;
    if (busy || questions.length !== 1 || !/connect|add-on/i.test(`${only.header ?? ""} ${only.question} ${only.detail ?? ""}`)) return;
    setBusy(true); setError("");
    Promise.resolve().then(() => pending.answer({ answers: [{ id: only.id, selected: [], custom: `I connected ${fresh.label}. It's ready to use.` }] }))
      .then(() => onAnswered(wait.key), (reason) => { setBusy(false); setError(reason instanceof Error ? reason.message : String(reason)); });
  }, [servers]);
  const question = questions[index];
  if (!question) return h(Empty, null, "The agent sent an empty question request.");
  const draft = drafts[index];
  // the sign-in page the question names, so the browser opens right on it
  const links = `${question.question} ${question.detail ?? ""}`.match(/https:\/\/[^\s<>()"'`]+/g)?.map((link) => link.replace(/[.,;:!?*_\]]+$/, "")) ?? [];
  const signInUrl = links.find((link) => /sign.?in|log.?in|auth|account/i.test(link)) ?? links[0];
  const signInOption = /sign(ed|ing)?.?in|log.?in/i;
  // a sign-in question has to be answered, skipping it just asks again
  const signInQuestion = signInUrl && (question.options ?? []).some((option) => signInOption.test(option.label));
  const openBrowser = () => act({ action: "open_agent_browser", executionId, ...(signInUrl ? { url: signInUrl } : {}) });
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
      const customs = await Promise.all(nextDrafts.map(({ custom }) => custom.trim() && hideKeys(custom.trim())));
      await pending.answer({ answers: questions.map((item, itemIndex) => {
        const answer = nextDrafts[itemIndex];
        // an empty selection reads as no reply, so the agent asks the same thing again; name the skip instead
        if (answer.skipped) return { id: item.id, selected: [], custom: "Skipped." };
        return { id: item.id, selected: answer.selected, ...(customs[itemIndex] ? { custom: customs[itemIndex] } : {}) };
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
    h("div", { className: "bees-question-options", role: question.multiSelect === true ? "group" : "radiogroup", "aria-label": question.header || "Answer options" },
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
      h("textarea", {
        className: "bees-textarea", value: draft.custom, disabled: busy, rows: 3, "aria-label": "Your answer",
        ...( (question.options ?? []).length ? {} : { ref: focusWithoutScroll } ),
        placeholder: (question.options ?? []).length 
          ? (question.multiSelect === true ? "Add another answer (optional)" : "Or type another answer") 
          : "Type your answer",
        onChange: custom,
        onKeyDown: (event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); continueFlow(); }
        }
      })),
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
    h("div", { className: "bees-answer-actions" },
      index > 0 ? h(Button, { disabled: busy, onClick: () => { setIndex((current) => current - 1); setError(""); } }, "Back") : null,
      signInQuestion ? null : h(Button, { disabled: busy, onClick: skip }, "Skip"), h("div", { className: "bees-grow" }),
      teamId && act && executionId ? h(Button, { disabled: busy, onClick: provideFile }, "Provide a file") : null,
      onOpenTools ? h(Button, { disabled: busy, onClick: onOpenTools }, "Connect an add-on") : null,
      browser && act && executionId ? h(Button, {
        disabled: busy, title: "Open the browser profile this agent uses, so you can sign in on its behalf",
        onClick: openBrowser
      }, "Open browser") : null,
      h(Button, { className: "primary", disabled: busy, onClick: () => continueFlow() }, busy ? "Sending…" : index < questions.length - 1 ? "Next" : "Send answer"))
  );
}

function ApprovalPanel({ wait, onAnswered }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const answer = async (outcome) => {
    setBusy(outcome); setError("");
    try { await wait.answer(outcome); onAnswered(wait.key); }
    catch (reason) { setBusy(""); setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return h(React.Fragment, null,
    h("div", null, h("div", { className: "bees-muted" }, wait.toolName || "Agent action"),
      h("h3", { className: "bees-section-title" }, "Approve this action?")),
    wait.reason ? h("div", { className: "bees-question-detail" }, h(MarkdownText, { text: wait.reason })) : null,
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
    h("div", { className: "bees-answer-actions" },
      h(Button, { className: "danger", disabled: Boolean(busy), onClick: () => void answer("rejected") }, busy === "rejected" ? "Denying…" : "Deny"),
      h(Button, { className: "primary", disabled: Boolean(busy), onClick: () => void answer("allowed-once") }, busy === "allowed-once" ? "Approving…" : "Approve once"))
  );
}

// DSH publishes one pending interaction per session. Keep the empty snapshot stable.
const EMPTY_STATUS = new Map();

const pendingInteractionFor = (waiting, sessionId, handled) => {
  const pending = sessionId ? waiting.get(sessionId)?.pendingInteraction : undefined;
  return pending && !handled.has(pending.key) ? pending : undefined;
};

const interactionName = (kind) => kind === "approval" ? "Approval" : kind === "work-review" ? "Work review" : "Question";

export function WorkItemControls({ item, act, onDone, showUnavailable = false, data, allowReRun = false }) {
  const [busy, setBusy] = useState("");
  if (!item || !act || item.kind === "plan") return null;
  const runs = data?.runs?.filter(({ workItemId }) => workItemId === item.id) ?? [];
  // only Archive and Re-run work here when a teammate's device holds this item's workflow
  const elsewhere = runs.length > 0 && runs.every(({ ranElsewhere }) => ranElsewhere);
  const canRetry = !elsewhere && item.runtimePhase === "failed";
  const canStop = !elsewhere && ["running", "waiting", "paused"].includes(item.runtimePhase);
  const invoke = async (action, payload = {}) => {
    setBusy(action);
    try {
      const result = await act({ action, itemId: item.id, ...payload });
      if (result) onDone?.();
    } finally { setBusy(""); }
  };
  const invokeWithoutItem = async (action, payload = {}) => {
    setBusy(action);
    try {
      const result = await act({ action, ...payload });
      if (result) onDone?.();
    } finally { setBusy(""); }
  };
  const rerun = async () => {
    const inputLocationIds = [...new Set((data?.attachments ?? []).filter(({ workItemId }) => workItemId === item.id)
      .map(({ locationId }) => locationId))];
    await invokeWithoutItem("create_run", {
      processId: item.processId,
      title: String(item.title ?? ""),
      description: String(item.description ?? ""),
      priority: String(item.priority ?? "normal"),
      inputLocationIds,
      ...(item.outputLocationId ? { outputLocationId: item.outputLocationId } : {}),
      ...(item.runSettings ? { runSettings: item.runSettings } : {}),
      ...(item.agentIds?.length ? { agentIds: item.agentIds } : (item.agentAssignmentId ? { agentAssignmentId: item.agentAssignmentId } : {})),
      ...(item.owner ? { owner: item.owner } : {})
    });
  };
  const archive = async () => {
    if (!await confirmAction(`Archive “${item.title}”? Active work will be cancelled. Its history will be preserved.`)) return;
    await invoke("archive_item");
  };
  const canReRun = allowReRun && item.kind === "run" && isDone(item) && !item.parentId;
  const canPause = !elsewhere && item.runtimePhase === "running";
  const canResume = !elsewhere && item.runtimePhase === "paused";
  return h(React.Fragment, null,
    canResume || showUnavailable ? h(Button, {
      className: canResume ? "primary" : "", disabled: Boolean(busy) || !canResume,
      title: canResume ? "Resume work" : "Resume is available for paused work", onClick: () => invoke("resume_item")
    }, busy === "resume_item" ? "Resuming…" : "Resume") : null,
    canPause || showUnavailable ? h(Button, {
      disabled: Boolean(busy) || !canPause,
      title: canPause ? "Pause work" : "Pause is available for running work", onClick: () => invoke("pause_item")
    }, busy === "pause_item" ? "Pausing…" : "Pause") : null,
    canRetry || showUnavailable ? h(Button, {
      className: canRetry ? "primary" : "", disabled: Boolean(busy) || !canRetry,
      title: canRetry ? "Retry work" : "Retry is available for failed work", onClick: () => invoke("retry_item")
    }, busy === "retry_item" ? "Retrying…" : "Retry") : null,
    canStop || showUnavailable ? h(Button, {
      disabled: Boolean(busy) || !canStop,
      title: canStop ? "Stop work" : "This work is not active", onClick: () => invoke("cancel_item")
    }, busy === "cancel_item" ? "Stopping…" : "Stop") : null,
    canReRun || showUnavailable ? h(Button, {
      className: canReRun ? "primary" : "", disabled: Boolean(busy) || !canReRun,
      title: canReRun ? "Re-run this work from its starting status" : "Re-run is available for completed process runs",
      onClick: rerun
    }, busy === "create_run" ? "Re-running…" : "Re-run") : null,
    h(Button, { className: "danger", disabled: Boolean(busy), onClick: archive },
      busy === "archive_item" ? "Archiving…" : "Archive"));
}

function AgentInteractionPanel({ run, item, title, summary, interaction, handled, inConversation = false, onAnswered, onOpen, openLabel, act, onControlled, data, onOpenTools, servers }) {
  const workReview = run?.pendingInteraction === "work-review" && interaction?.kind === "question";
  return h("section", { className: "bees-box bees-answer-card" },
    h("div", { className: "bees-answer-head" }, h("div", null,
      h("div", { className: "bees-status" }, interactionName(run?.pendingInteraction ?? interaction?.kind)),
      inConversation ? null : h("h2", null, item?.title ?? title ?? summary?.displayTitle ?? "Agent run")),
    inConversation ? null : h("div", { className: "bees-grow" }), inConversation ? null : h("div", { className: "bees-answer-controls" },
      onOpen ? h(Button, { onClick: onOpen }, openLabel) : null,
      h(WorkItemControls, { item, act, onDone: onControlled }))),
    workReview ? h(WorkReviewPanel, { key: interaction.key, wait: interaction, onAnswered, act, executionId: run?.id, item, data })
      : interaction?.kind === "question" ? h(QuestionPanel, { key: interaction.key, wait: interaction, onAnswered, act, executionId: run?.id, browser: data?.browserEnabled, data, workspaceId: run.workspaceId, onOpenTools, servers, since: run?.updatedAt })
      : interaction?.kind === "approval" ? h(ApprovalPanel, { key: interaction.key, wait: interaction, onAnswered })
        : h(Empty, null, handled.size ? "Answer sent. Waiting for the agent…"
          // a run left waiting across a restart has no live session to ask from until it resumes
          : run.recovering ? "Bees restarted and this run has not picked up again yet. If it stays like this, stop it or archive it."
            : "Loading the agent's request…")
  );
}

export function useNeedsYouQueue(ctx, data, workspaceIds, initialSelectedId = "", autoSelect = true) {
  const sessions = useSnapshot(ctx.sessions.list, { ids: [], byId: {} });
  const waiting = useSnapshot(ctx.uiSession.sessionStatus, EMPTY_STATUS);
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [handled, setHandled] = useState(() => new Set());
  const [handledRuns, setHandledRuns] = useState(() => new Set());
  const seen = new Set();
  const activeRuns = data.runs.filter((run) => workspaceIds.includes(run.workspaceId) &&
    !isDone(data.items.find(({ id }) => id === run.workItemId) ?? {}));
  const rows = activeRuns.filter((run) => run.sessionId)
    .map((run) => ({ run, session: sessions.byId[run.sessionId], item: data.items.find(({ id }) => id === run.workItemId) }))
    .filter(({ run }) => ["waiting_for_input", "waiting_for_approval"].includes(run.status) && !seen.has(run.sessionId) && seen.add(run.sessionId));
  const rowKey = rows.map(({ run }) => `${run.id}:${waiting.get(run.sessionId)?.pendingInteraction?.kind ?? "none"}`).join("|");
  useEffect(() => setSelectedId((current) => rows.some(({ run }) => run.id === current)
    ? current : autoSelect ? rows[0]?.run.id ?? "" : ""), [rowKey, autoSelect]);
  useEffect(() => setHandledRuns((current) => new Set([...current].filter((id) => activeRuns.some((run) => run.id === id)))), [rowKey]);
  const selected = rows.find(({ run }) => run.id === selectedId) ?? rows[0];
  const interaction = pendingInteractionFor(waiting, selected?.run.sessionId, handled);
  // Answered runs stay on screen while Bees works, so an answer does not just make the row vanish.
  const working = activeRuns.filter((run) => handledRuns.has(run.id) && ["queued", "running"].includes(run.status));
  const answered = (key, candidates = rows) => {
    setHandled((current) => new Set(current).add(key));
    const completed = new Set(handledRuns);
    if (selected) completed.add(selected.run.id);
    setHandledRuns(completed);
    const next = candidates.find(({ run }) => !completed.has(run.id));
    if (next) setSelectedId(next.run.id);
  };
  return { rows, selected, selectedId, setSelectedId, interaction, handled, working, answered };
}

/** The one list the Needs you count and the rows under it both read, so they cannot disagree. */
export function needsYouRows(queue, data, rowsForRoute) {
  const liveByItemId = new Map(queue.rows.filter(({ item }) => item).map((row) => [row.item.id, row]));
  const records = rowsForRoute("waiting")
    .map((row) => ({ id: row.id, label: row.label, open: row.open, live: liveByItemId.get(row.id) }))
    .filter((record) => record.live);
  const listedItemIds = new Set(records.map(({ id }) => id));
  // An Ask Bees run asks its questions before any work item exists, so it gets a row of its own.
  for (const live of queue.rows) {
    if (!live.item || !listedItemIds.has(live.item.id)) {
      records.push({ id: live.run.id, label: live.item?.title ?? runTitle(data, live.run) ?? live.session?.displayTitle, live });
    }
  }
  return records;
}

export function NeedsYouWidget({ data, act, queue, records, limit = 8 }) {
  const visibleRecords = records.slice(0, limit);
  const selected = visibleRecords.find(({ live }) => live.run.id === queue.selectedId)?.live;
  const select = (runId) => queue.setSelectedId((current) => current === runId ? "" : runId);
  const workingRows = queue.working.map((run) => h("div", { key: run.id, className: "bees-dashboard-need-row" },
    h("div", { className: "bees-dashboard-row" },
      h("span", { className: "bees-dashboard-need-copy" }, runTitle(data, run)),
      h("span", { className: "bees-badge" }, "Working…"))));

  if (!visibleRecords.length && !workingRows.length) {
    return h(Empty, { style: { height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", border: "none" } }, "Nothing needs you right now.");
  }

  return h("div", { className: "bees-dashboard-needs" },
    h("div", { className: "bees-dashboard-list", "aria-label": "Work needing attention" }, ...visibleRecords.map((record) => {
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
            h("span", { className: "bees-badge" }, interactionName(live.run.pendingInteraction))),
          record.open ? h("button", {
            type: "button", className: "bees-dashboard-launch", title: `Open ${record.label}`,
            "aria-label": `Open ${record.label}`, onClick: record.open
          }, "↗") : null),
        isSelected ? h("div", { className: "bees-dashboard-needs-answer", id: panelId },
          h(AgentInteractionPanel, {
            run: selected.run, item: selected.item, title: runTitle(data, selected.run), summary: selected.session, data,
            interaction: queue.interaction, handled: queue.handled,
            onOpen: record.open, openLabel: "Open work",
            onAnswered: (key) => queue.answered(key, visibleRecords.map(r => r.live)), act,
            onControlled: () => queue.answered(`control:${selected.run.id}`, visibleRecords.map(r => r.live))
          })) : null
      );
    }), ...workingRows)
  );
}

const pendingProposals = (data, run) => data.proposals.filter(({ sessionId, status }) => status === "pending" && sessionId && [run.sessionId, run.previousSessionId].includes(sessionId));
const LIVE_RUN = ["queued", "running", "waiting_for_input", "waiting_for_approval"];

// a plan has no work item yet, so the process run screen shows its run as one
const planView = (data, run) => ({ ...data,
  processes: [...data.processes, { id: run.id, name: "Build with Bees", workspaceId: run.workspaceId }],
  stages: [...data.stages, { id: run.id, processId: run.id, name: "Plan" }],
  items: [...data.items, { id: run.id, kind: "plan", processId: run.id, stageId: run.id, title: runTitle(data, run), description: run.purpose, runtimePhase: run.status }],
  runs: data.runs.map((row) => row.id === run.id ? { ...row, workItemId: run.id } : row) });

export function WorkPage({ ctx, data, route, workspaceIds, workspaceId, teamId, workItemId, setWorkItemId, creating, setCreating, defaultProcessId, setWorkProcessId, act, preference, preferences, setPageActions, setPageHeader, capabilities }) {
  const [newSchedule, setNewSchedule] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(route === "completed" ? "completed" : "all");
  const [processFilter, setProcessFilter] = useState("all");
  const [itemScope, setItemScope] = useState("primary");
  const [owner, setOwner] = useState("all");
  useEffect(() => { setStatus(route === "completed" ? "completed" : "all"); }, [route]);
  useEffect(() => { setQuery(""); setProcessFilter("all"); setItemScope("primary"); setOwner("all"); setNewSchedule(false); }, [route, workspaceIds.join(",")]);
  const plan = data.runs.find((run) => run.id === workItemId && !run.workItemId);
  if (workItemId) return h(WorkItemCockpit, {
    ctx, data: plan ? planView(data, plan) : data, rootId: workItemId, teamId, act, preference, preferences, capabilities, onBack: () => setWorkItemId(""),
    onScheduleCreated: (id) => setWorkItemId(id),
    setPageActions, setPageHeader
  });
  const items = data.items.filter((item) => {
    const process = data.processes.find(({ id }) => id === item.processId);
    return !item.archivedAt && !process?.archivedAt && workspaceIds.includes(process?.workspaceId) &&
      (route === "schedules" ? isScheduleDefinition(item) : !isScheduleDefinition(item)) &&
      (route !== "goals" || process?.kind === "goals");
  });
  const processes = data.processes.filter((process) => !process.archivedAt && workspaceIds.includes(process.workspaceId))
    .sort((left, right) => left.name.localeCompare(right.name));
  const schedulableItems = data.items.filter((item) => {
    if (item.parentId || item.archivedAt || isScheduleDefinition(item)) return false;
    const process = processes.find(({ id }) => id === item.processId);
    const stages = data.stages.filter(({ processId }) => processId === item.processId);
    return process && stages.length >= 2 && stages.at(-1)?.driver === "terminal" &&
      stages.every(({ driver }) => ["agent", "discussion", "review", "terminal"].includes(driver));
  });
  
  if (["work", "run", "goal"].includes(creating)) return h(WorkItemForm, {
    ctx, data, kind: creating, workspaceId, defaultProcessId, act, capabilities, onCancel: () => setCreating(""),
    onCreated: (id) => { setCreating(""); setWorkItemId(id); }, setPageHeader
  });
  const ownerId = (item) => {
    if (item.accountUserId) return item.accountUserId;
    const process = data.processes.find(({ id }) => id === item.processId);
    const workspace = data.workspaces?.find(({ id }) => id === process?.workspaceId);
    const team = data.teams?.find(({ id }) => id === workspace?.teamId);
    const organization = data.organizations?.find(({ id }) => id === team?.organizationId);
    return organization?.personal ? "local" : "";
  };
  const ownerLabel = (id) => id === "local" ? "You" : accountLabel(data, id) || "Unknown owner";
  const owners = [...new Set(items.map(ownerId))]
    .map((id) => ({ id, label: ownerLabel(id) }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const scheduleFor = (item) => route === "schedules"
    ? (data.recurringWork ?? []).find(({ sourceWorkItemId }) => sourceWorkItemId === item.id) : null;
  const statusFor = (item) => scheduleFor(item)?.status ?? workItemStatus(item);
  const statuses = [...new Set(items.map(statusFor))].sort();
  const needle = query.trim().toLocaleLowerCase();
  const rows = items.filter((item) => {
    const recurring = scheduleFor(item);
    return (!needle || `${item.title} ${recurring?.name ?? ""}`.toLocaleLowerCase().includes(needle)) &&
    (status === "all" || statusFor(item) === status) &&
    (processFilter === "all" || item.processId === processFilter) &&
    (itemScope === "all" || !item.parentId) &&
    (owner === "all" || ownerId(item) === owner);
  });
  const plans = route === "schedules" || status !== "all" || processFilter !== "all" || owner !== "all" ? []
    : data.runs.filter((run) => !run.workItemId && workspaceIds.includes(run.workspaceId) && runTitle(data, run).toLocaleLowerCase().includes(needle));
  // a plan with nothing live and nothing left to apply is finished, however it ended
  const planDone = (run) => !LIVE_RUN.includes(run.status) && !pendingProposals(data, run).length;
  const renderRows = (records, empty, showColumns = false, includeReRun = false, planRows = []) => {
    if (!records.length && !planRows.length) return h(Empty, null, empty);
    const rendered = records.map((item) => {
      const process = data.processes.find(({ id }) => id === item.processId);
      const stage = data.stages.find(({ id }) => id === item.stageId);
      const recurring = scheduleFor(item);
      const initiator = ownerId(item) ? ownerLabel(ownerId(item)) : null;
      const subtitle = recurring ? [
        item.title !== recurring.name && item.title, process?.name ?? "Process", scheduleSummary(recurring),
        recurring.nextRunAt ? `Next ${when(recurring.nextRunAt)}` : recurring.status === "paused" ? "Not running" : "Next run pending"
      ].filter(Boolean).join(" · ") : [
        item.kind === "run" ? item.recurringWorkId ? "scheduled run" : "process run" : item.kind === "work" ? "process item" : item.kind,
        process?.name ?? "Process",
        stage?.name ?? "Stage",
        initiator && !showColumns ? `by ${initiator}` : null
      ].filter(Boolean).join(" · ");
      const title = h("span", { className: "bees-row-main" }, h("span", { className: "bees-row-title" }, recurring?.name ?? item.title), h("span", { className: "bees-muted" }, subtitle));
      const statusValue = statusFor(item);
      const status = h("span", { className: `bees-status bees-${statusValue}` }, statusValue.replaceAll("_", " "));
      const open = { type: "button", className: "bees-row bees-work-item-row", onClick: () => setWorkItemId(item.id) };
      return showColumns ? h("tr", { key: item.id },
        h("td", null, h("button", { ...open, title: item.title }, title)),
        h("td", null, recurring ? "Schedule" : item.kind === "run" ? "Process run" : "Process item"),
        h("td", null, h("span", { className: "bees-work-owner", title: initiator || "Unknown owner" }, initiator || "Unknown owner")),
        h("td", null, status),
          h("td", null, h("div", { className: "bees-answer-controls", role: "group", "aria-label": `Actions for ${item.title}` },
            recurring ? h(Button, { className: "bees-btn-secondary", onClick: () => act({ action: recurring.status === "paused" ? "resume_recurring_work" : "pause_recurring_work", recurringWorkId: recurring.id }) }, recurring.status === "paused" ? "Resume" : "Pause") : null,
            h(WorkItemControls, { item, act, showUnavailable: false, data, allowReRun: includeReRun }))))
        : h("button", { ...open, key: item.id }, title, status);
    });
    return showColumns ? h("table", { className: "bees-work-table", "aria-label": route === "schedules" ? "Schedules" : "Active process runs" },
      h("thead", null, h("tr", null, ...[route === "schedules" ? "Schedule" : "Process", "Type", "Owner", "Status", "Actions"].map((label) => h("th", { key: label, scope: "col" }, label)))),
      h("tbody", null, ...planRows.map((run) => {
        const workspace = data.workspaces?.find(({ id }) => id === run.workspaceId);
        const organizationId = data.teams?.find(({ id }) => id === workspace?.teamId)?.organizationId;
        // a plan only ever runs on this device, so it is this device's account in that organization
        const runInitiatorId = data.organizations?.find(({ id }) => id === organizationId)?.personal ? "local"
          : data.connections?.find((connection) => connection.organizationId === organizationId)?.accountUserId;
        const runInitiator = runInitiatorId ? ownerLabel(runInitiatorId) : null;
        return h("tr", { key: run.id },
          h("td", null, h("button", { type: "button", className: "bees-row bees-work-item-row", onClick: () => setWorkItemId(run.id) },
            h("span", { className: "bees-row-main" }, h("span", { className: "bees-row-title" }, runTitle(data, run))))),
          h("td", null, "Plan"),
          h("td", null, h("span", { className: "bees-work-owner", title: runInitiator || "Unknown owner" }, runInitiator || "Unknown owner")),
          h("td", null, h("span", { className: `bees-status bees-${run.status}` }, LIVE_RUN.includes(run.status) || planDone(run) ? run.status.replaceAll("_", " ") : "ready to apply")),
          h("td"));
      }), ...rendered)) : rendered;
  };
  return h("div", { className: "bees-flex-page bees-stack" },
    h("div", { className: "bees-search" },
      h("input", { className: "bees-input bees-grow", value: query, onChange: (event) => setQuery(event.target.value),
        placeholder: route === "schedules" ? "Search schedules" : "Search process runs", "aria-label": route === "schedules" ? "Search schedules by name" : "Search process runs by name" }),
      h("select", { className: "bees-select", value: status, onChange: (event) => setStatus(event.target.value), "aria-label": "Filter by status" },
        h("option", { value: "all" }, "All statuses"),
        ...statuses.map((value) => h("option", { value, key: value }, value[0].toUpperCase() + value.slice(1).replaceAll("_", " ")))),
      h("select", { className: "bees-select", value: processFilter, onChange: (event) => setProcessFilter(event.target.value), "aria-label": "Filter by process template" },
        h("option", { value: "all" }, "All process templates"),
        ...processes.map((process) => h("option", { value: process.id, key: process.id }, process.name))),
      h("select", { className: "bees-select", value: itemScope, onChange: (event) => setItemScope(event.target.value), "aria-label": route === "schedules" ? "Filter by schedule scope" : "Filter by process scope" },
        h("option", { value: "primary" }, "Primary only"),
        h("option", { value: "all" }, route === "schedules" ? "All schedules" : "All process items")),
      h("select", { className: "bees-select bees-owner-filter", value: owner, onChange: (event) => setOwner(event.target.value), "aria-label": "Filter by owner" },
        h("option", { value: "all" }, "All owners"),
        ...owners.map(({ id, label }) => h("option", { value: id, key: id }, label))),
      route === "schedules" ? h(Button, { className: "primary", disabled: !schedulableItems.length,
        title: schedulableItems.length ? "Schedule an existing process run" : "Start a process run before scheduling it",
        onClick: () => setNewSchedule(true) }, "New Schedule") : h(Button, { className: "primary", disabled: !workspaceId, onClick: () => {
        setWorkProcessId?.(""); setCreating("run");
      } }, "New Process Run")),
    h(GridStackPage, {
      layoutId: "work", defaults: WORK_PAGE_LAYOUT, preference, preferences, setPageActions, setPageHeader,
      panels: {
        "active-work": { label: route === "schedules" ? "Schedules" : "Active process runs", minW: 6, minH: 3, content: renderRows(rows.filter((item) => !isDone(item)), route === "schedules" ? "No schedules yet" : "No active process runs match these filters", true, false, plans.filter((run) => !planDone(run))), helpText: route === "schedules" ? "Recurring schedules automatically start process runs at specific times or intervals." : "Process runs and process items that are currently active.", helpExamples: route === "schedules" ? ["A daily schedule to run an 'Inbox Triage' process at 9 AM", "An hourly schedule to check for new GitHub issues"] : [] },
        "finished-work": { label: "Completed & stopped", minW: 6, minH: 3, content: renderRows(rows.filter(isDone), route === "schedules" ? "No completed or stopped schedules match these filters" : "No completed or stopped process runs match these filters", true, true, plans.filter(planDone)) }
      }
    }),
    newSchedule ? h(ScheduleForm, { items: schedulableItems, act, onClose: () => setNewSchedule(false),
      onCreated: (id) => setWorkItemId(id) }) : null
  );
}
