export const OUTCOME_LABELS = {
  candidate: "Submitted for review", blocked: "Blocked", pass: "Review passed", revise: "Sent back for changes"
};

const timestamp = (value) => new Date(value ?? 0).getTime() || 0;
const normalize = (text) => text.replace(/\s+/g, " ").trim();

export function conversationMessages(history, runs, assignments, children = []) {
  const agentName = (run) => assignments.find(({ id }) => id === run?.resolvedAgentId)?.name || "Agent";
  const currentRun = runs.find(({ id }) => id === history?.executionId);
  const messages = new Map();
  for (const message of history?.messages ?? []) {
    if (message.role === "context") continue;
    const text = (message.parts ?? []).filter((part) => part.text).map((part) => part.text).join("\n\n");
    if (!text.trim()) continue;
    const id = `message:${history.executionId}:${message.id}`;
    messages.set(id, { id, role: message.role, text, label: agentName(currentRun),
      timestamp: timestamp(message.metadata?.timestamp) });
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
