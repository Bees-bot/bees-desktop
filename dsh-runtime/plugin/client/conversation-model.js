export const OUTCOME_LABELS = {
  candidate: "Submitted for review", blocked: "Blocked", skipped: "Nothing to do", pass: "Review passed", revise: "Sent back for changes"
};

const timestamp = (value) => new Date(value ?? 0).getTime() || 0;
const normalize = (text) => text.replace(/\s+/g, " ").trim();

export const agentTag = (name) => String(name).toLocaleLowerCase()
  .replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/g, "");

export function mentionedRecipient(text, options) {
  const match = /^(\$[^\s]+)(?:\s+([\s\S]+))?$/.exec(text.trim());
  const recipient = match && options.find(({ tag }) => `$${tag}` === match[1].toLocaleLowerCase());
  return recipient ? { recipient, body: match[2]?.trim() ?? "" } : null;
}

export function agentMentionOptions(agentIds, assignments, peers) {
  const assigned = agentIds.map((id) => {
    const agent = assignments.find((candidate) => candidate.id === id);
    const peer = peers.find((candidate) => candidate.agentId === id);
    return agent && { id, targetId: peer?.id ?? null, name: agent.name, tag: agentTag(agent.name), status: peer?.status ?? "assigned" };
  }).filter(Boolean);
  const delegated = peers.map((peer) => {
    const name = assignments.find((agent) => agent.id === peer.agentId)?.name ?? peer.title;
    return { id: peer.agentId ?? peer.id, targetId: peer.id, name, tag: agentTag(name), status: peer.status };
  });
  return [{ id: "everyone", targetId: null, name: "Everyone", tag: "everyone", status: "" }, ...assigned, ...delegated]
    .filter((option, index, options) => option.tag && options.findIndex(({ tag }) => tag === option.tag) === index);
}

const TOOL_TARGET = ["url", "query", "file_path", "path", "command", "pattern", "title", "items_json"];
// A run screen full of send_message and mcp__freelancer__invoke-api-endpoint reads like a log file.
const TOOL_NAMES = {
  bash: "Ran a command", read: "Read a file", write: "Wrote a file", edit: "Edited a file",
  glob: "Looked for files", grep: "Searched the files", web_search: "Searched the web", web_fetch: "Read a page",
  send_message: "Messaged a teammate", wait_agent: "Waiting for a teammate", bees_wait_for_team: "Waiting for a teammate", followup_task: "Asked for another round",
  ask_user_question: "Asked you a question", bees_control: "Set up Bees",
  bees_delegate_work: "Handed work to a peer", bees_submit_stage_result: "Submitted this stage",
  bees_request_work_review: "Asked you to approve", bees_publish_outputs: "Published the deliverables"
};
export const readableTool = (name = "") => (Object.hasOwn(TOOL_NAMES, name) ? TOOL_NAMES[name] : name.startsWith("mcp__")
  ? name.split("__").slice(1).join(" · ").replace(/[-_]/g, " ")
  : name.replace(/[-_]/g, " "));
export function toolLine(part) {
  const input = part.input && typeof part.input === "object" ? part.input : {};
  const target = TOOL_TARGET.map((key) => input[key]).find(Boolean);
  return `${readableTool(part.toolName)}${target ? ` · ${String(target).slice(0, 120).replace(/\s+/g, " ").slice(0, 90)}` : ""}`;
}

// Seat traffic carries its own plumbing: an envelope with a uuid, and a note when a background seat
// stops. Show the critique under the seat's name; drop the note unless it reports a failure.
const TEAM_ENVELOPE = /^Team message [\w-]+ from ([^:\n]+):\s*/;
const SUBAGENT_NOTE = /^Background subagent [0-9a-f-]+ finished/;
const seatName = (name) => /^participant-\d+$/.test(name.trim()) ? "Plan reviewer" : name.trim();

export function conversationMessages(history, runs, assignments, children = []) {
  const agentName = (run) => assignments.find(({ id }) => id === run?.resolvedAgentId)?.name || "Agent";
  const currentRun = runs.find(({ id }) => id === history?.executionId);
  const messages = new Map();
  for (const message of history?.messages ?? []) {
    if (message.role === "context") continue;
    const tool = (message.parts ?? []).find((part) => part.type === "tool");
    const said = (message.parts ?? []).filter((part) => part.text).map((part) => part.text).join("\n\n");
    const raw = [said, tool ? toolLine(tool) : ""].filter(Boolean).join("\n\n");
    if (!raw.trim()) continue;
    if (SUBAGENT_NOTE.test(raw) && !/error|failed/i.test(raw)) continue;
    const seat = message.role === "user" ? null : TEAM_ENVELOPE.exec(raw);
    const text = seat ? raw.slice(seat[0].length) : raw;
    const id = `message:${history.executionId}:${message.id}`;
    messages.set(id, { id, text, timestamp: timestamp(message.metadata?.timestamp),
      role: seat ? "assistant" : tool && !said ? "tool" : message.role,
      pending: Boolean(tool) && tool.state === "input-available",
      label: seat ? seatName(seat[1]) : agentName(currentRun) });
  }
  for (const run of runs) {
    if (!run.resultSummary) continue;
    if (run.id === history?.executionId && [...messages.values()].some((message) =>
      message.role === "assistant" && normalize(message.text) === normalize(run.resultSummary))) continue;
    const child = children.find(({ id }) => id === run.workItemId);
    const id = `result:${run.id}`;
    messages.set(id, { id, role: "assistant", text: run.resultSummary,
      label: `${agentName(run)}${child ? ` · ${child.title}` : ""}`,
      outcome: OUTCOME_LABELS[run.resultOutcome],
      timestamp: timestamp(run.resultCreatedAt ?? run.updatedAt) });
  }
  return [...messages.values()].sort((left, right) => left.timestamp - right.timestamp);
}

export function pollConversation(executionId, { request, onHistory, onError, isVisible = () => true }) {
  const controller = new AbortController();
  let timer;
  const poll = async () => {
    try {
      if (isVisible()) {
        const value = await request(`/bees-api/run-history?executionId=${encodeURIComponent(executionId)}`, { signal: controller.signal });
        if (!controller.signal.aborted) onHistory({ executionId, messages: value.history?.messages ?? [] });
      }
    } catch (error) {
      if (!controller.signal.aborted) onError(error);
    } finally {
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    }
  };
  void poll();
  return () => { controller.abort(); clearTimeout(timer); };
}
