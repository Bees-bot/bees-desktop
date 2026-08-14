import type {
  Execution,
  ExecutionOutput,
  Process,
  Schedule,
  WorkItem
} from "./domain.js";
import { itemTree, workItemCondition, workItemConditionLabel } from "./domain.js";
import { modelRef } from "./local-models.js";
import {
  lastAssistantText,
  type BeesConversationSnapshotV1,
  type SnapshotMessage,
  type SnapshotPart
} from "./conversation-snapshot.js";
import type { OutputPreview } from "./workspaces.js";
import type { SearchHit } from "./repository.js";
import type { EscalationGroup } from "./supervision.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function itemName(items: WorkItem[], id: string): string {
  return items.find((item) => item.id === id)?.title ?? "Unknown work item";
}

export function taskPlanOutput(execution: Execution): string | undefined {
  return execution.result?.taskPlan?.output;
}

function outputName(output: ExecutionOutput, taskPlan?: string): string {
  return output.logicalOutput === taskPlan ? "Proposed subtasks" : output.logicalDestination;
}

export function approvalCard(output: ExecutionOutput, busy: boolean, taskPlan?: string): string {
  const actions = `<div class="flex shrink-0 gap-2">
    <button class="btn btn-success btn-xs" data-action="approve-output" data-id="${output.id}" ${
      busy ? "disabled" : ""
    }>Approve</button>
    <button class="btn btn-error btn-outline btn-xs" data-action="reject-output" data-id="${output.id}" ${
      busy ? "disabled" : ""
    }>Reject</button>
  </div>`;
  if (/\.md$/i.test(output.logicalOutput)) {
    return `<article class="rounded-box border border-warning/40 bg-warning/5 p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="text-xs font-semibold text-warning">Approval required</div>
        ${actions}
      </div>
      <button class="mt-2 flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm font-semibold hover:bg-warning/10"
        data-action="view-markdown-output" data-id="${output.id}"
        aria-haspopup="dialog"
        aria-label="Open ${escapeHtml(output.logicalOutput)} in Markdown viewer">
        <span aria-hidden="true">&gt;</span><span>${escapeHtml(output.logicalOutput)}</span>
      </button>
    </article>`;
  }
  return `<article class="rounded-box border border-warning/40 bg-warning/5 p-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="text-xs font-semibold text-warning">${
          output.logicalOutput === taskPlan ? "Task plan approval required" : "Approval required"
        }</div>
        <h4 class="mt-1 font-semibold">${escapeHtml(outputName(output, taskPlan))}</h4>
      </div>
      ${actions}
    </div>
  </article>`;
}

export function when(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function duration(execution: Execution): string {
  if (!execution.startedAt || !execution.endedAt) return execution.status === "running" ? "Running" : "—";
  const seconds = Math.max(0, Math.round((Date.parse(execution.endedAt) - Date.parse(execution.startedAt)) / 1_000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function statusBadge(status: string): string {
  const tone =
    status === "completed" || status === "approved"
      ? "badge-success"
      : status === "failed" || status === "rejected" || status === "interrupted"
        ? "badge-error"
        : status === "running"
          ? "badge-info"
          : "badge-ghost";
  return `<span class="badge badge-sm ${tone}">${escapeHtml(status)}</span>`;
}

function empty(title: string, detail: string): string {
  return `<div class="rounded-box border border-dashed border-base-300 bg-base-100 p-8 text-center">
    <h3 class="font-bold">${escapeHtml(title)}</h3>
    <p class="mt-2 text-sm text-muted">${escapeHtml(detail)}</p>
  </div>`;
}

function overviewAssistant(): string {
  return `<form class="mt-6 w-full rounded-box border border-base-300 bg-base-100 p-4 shadow-sm" data-overview-assistant>
    <label class="mb-2 block text-sm font-bold" for="overview-assistant-message">Ask AI assistant</label>
    <textarea id="overview-assistant-message" name="message"
      class="textarea textarea-bordered min-h-28 w-full resize-y" maxlength="20000" required
      placeholder="What would you like help with?"></textarea>
    <div class="mt-3 flex justify-end">
      <button class="btn btn-primary" type="submit">Go</button>
    </div>
  </form>`;
}

export function overviewView(
  items: WorkItem[],
  executions: Execution[]
): string {
  return `${overviewAssistant()}
    <section class="mt-6">
      <div class="mb-3 flex items-center justify-between"><h2 class="text-lg font-bold">Recent runs</h2>
        <button class="btn btn-ghost btn-sm" data-view="runs">View all</button></div>
      ${
        executions.length
          ? `<div class="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table class="table table-sm"><tbody>${executions
                .slice(0, 8)
                .map(
                  // A bare inline link here was 17px tall, under the 24px a pointer reliably hits.
                  (run) => `<tr><td><button class="link link-hover inline-flex min-h-6 items-center text-left font-semibold" data-action="open-run" data-id="${run.id}">${escapeHtml(
                    itemName(items, run.workItemId)
                  )}</button></td><td>${statusBadge(run.status)}</td><td>${duration(run)}</td><td>${when(run.createdAt)}</td></tr>`
                )
                .join("")}</tbody></table></div>`
          : empty("No runs yet", "Start an item from Work to see activity here.")
      }
    </section>`;
}

/**
 * One row per work item that owes a person an answer, newest cause first. `escalationGroups`
 * decides what is stuck and how it reads; pending outputs supply the inline approval controls.
 */
export function inboxView(
  groups: EscalationGroup[],
  executions: Execution[],
  outputs: ExecutionOutput[],
  processes: Process[]
): string {
  const rows = groups.flatMap((group) => group.escalations.map((escalation) => ({ group, ...escalation })));
  if (!rows.length) {
    return empty("Nothing waiting on you", "Work that needs your attention will appear here.");
  }
  return `<div class="overflow-x-auto rounded-box border border-base-300 bg-base-100 shadow-sm">
    <table class="table table-zebra">
      <thead><tr>
        <th>Process</th><th>Task name</th><th>Approval message</th><th>Files</th><th>Approval</th>
      </tr></thead>
      <tbody>${rows
        .map(({ item, state }) => {
          const itemRuns = executions.filter(({ workItemId }) => workItemId === item.id);
          const pending = outputs.filter(({ executionId, status }) =>
            status === "pending" && itemRuns.some(({ id }) => id === executionId));
          const reviewRun = [...itemRuns]
            .filter(({ id }) => pending.some(({ executionId }) => executionId === id))
            .sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt))[0];
          const message = lastAssistantText(reviewRun?.conversationSnapshot ?? null) || state.detail;
          const process = processes.find(({ id }) => id === item.processId)?.name ?? "—";
          return `<tr>
            <td class="font-semibold">${escapeHtml(process)}</td>
            <td><button class="link link-hover text-left font-semibold" data-action="open-item" data-id="${item.id}">${escapeHtml(item.title)}</button></td>
            <td class="max-w-md whitespace-pre-wrap text-sm"><p class="line-clamp-3">${escapeHtml(message)}</p></td>
            <td>${pending.length
              ? `<div class="flex flex-wrap gap-1">${pending.map((output) =>
                `<button class="link link-hover text-sm" data-action="preview-inbox-output" data-id="${output.id}" aria-controls="inbox-output-preview" aria-expanded="false">${escapeHtml(output.logicalDestination)}</button>`).join("")}</div>`
              : "—"}</td>
            <td><div class="flex flex-wrap justify-end gap-1">${pending.map((output) => {
              const run = itemRuns.find(({ id }) => id === output.executionId);
              const busy = run?.status === "queued" || run?.status === "running";
              return `<button class="btn btn-success btn-xs" data-action="approve-output" data-id="${output.id}" aria-label="Approve ${escapeHtml(output.logicalDestination)}" ${busy ? "disabled" : ""}>Approve</button>`;
            }).join("")}</div></td>
          </tr>`;
        })
        .join("")}</tbody>
    </table>
  </div>
  <section id="inbox-output-preview" data-inbox-output-preview hidden class="mt-4 rounded-box border border-base-300 bg-base-100 shadow-sm">
    <header class="flex items-center justify-between gap-3 border-b border-base-300 p-4">
      <h2 class="min-w-0 truncate font-bold" data-inbox-output-preview-title>File preview</h2>
      <div class="flex shrink-0 gap-2">
        <button class="btn btn-success btn-sm" data-action="approve-output" data-inbox-output-preview-approve>Approve</button>
        <button class="btn btn-ghost btn-sm" data-action="close-inbox-output-preview">Close</button>
      </div>
    </header>
    <article class="markdown-viewer max-h-[60vh] overflow-auto p-4 text-sm" data-inbox-output-preview-body></article>
  </section>`;
}

export function runsView(items: WorkItem[], executions: Execution[], processes: Process[]): string {
  const completed = items
    .filter(({ parentId }) => !parentId)
    .flatMap((item) => {
      const tree = itemTree(items, item.id);
      const ids = new Set(tree.map(({ id }) => id));
      const steps = executions.filter(({ workItemId }) => ids.has(workItemId));
      if ((!item.isTerminal && !item.archivedAt) ||
        tree.some(({ isTerminal, archivedAt }) => !isTerminal && !archivedAt) ||
        steps.some(({ status }) => status === "queued" || status === "running"))
        return [];
      const startedAt = steps.map(({ startedAt, createdAt }) => startedAt ?? createdAt).sort()[0] ?? item.createdAt;
      const endedAt = item.archivedAt ??
        steps.flatMap(({ endedAt }) => endedAt ? [endedAt] : []).sort().at(-1) ?? item.updatedAt;
      return [{ item, startedAt, endedAt, outcome: item.archivedAt ? "Archived" : "Completed" }];
    })
    .sort((a, b) => b.endedAt.localeCompare(a.endedAt));
  if (!completed.length) return empty("No finished runs", "Completed and archived tasks will appear here.");
  return `<div class="overflow-x-auto rounded-box border border-base-300 bg-base-100 shadow-sm">
    <table class="table">
      <thead><tr><th>Primary task</th><th>Process</th><th>Outcome</th><th>Start time</th><th>End time</th></tr></thead>
      <tbody>${completed
        .map(({ item, startedAt, endedAt, outcome }) => {
          const process = processes.find(({ id }) => id === item.processId)?.name ?? "—";
          return `<tr>
            <td><button class="link link-hover text-left font-semibold" data-action="open-item" data-id="${item.id}">${escapeHtml(item.title)}</button></td>
            <td>${escapeHtml(process)}</td>
            <td><span class="badge badge-sm ${outcome === "Completed" ? "badge-success" : "badge-ghost"}">${outcome}</span></td>
            <td>${when(startedAt)}</td><td>${when(endedAt)}</td>
          </tr>`;
        })
        .join("")}</tbody>
    </table>
  </div>`;
}

/**
 * One list over both kinds of hit. A run opens the run; a work item opens the item — the same
 * two destinations the rest of the app already navigates to.
 */
export function searchResultsView(hits: SearchHit[]): string {
  if (!hits.length) {
    return empty("Nothing found", "No work item or settled run mentions every word you typed.");
  }
  return `<div class="grid gap-2">${hits
    .map(
      (hit) => `<button class="rounded-box border border-base-300 bg-base-100 p-3 text-left shadow-sm hover:bg-base-200"
        data-action="${hit.kind === "execution" ? "open-run" : "open-item"}" data-id="${hit.id}">
        <div class="flex items-center gap-2">
          <span class="badge badge-ghost badge-sm">${hit.kind === "execution" ? "Run" : "Work item"}</span>
          <span class="font-semibold">${escapeHtml(hit.title)}</span>
        </div>
        ${hit.snippet ? `<p class="mt-1 text-xs text-muted">${escapeHtml(hit.snippet)}</p>` : ""}
      </button>`
    )
    .join("")}</div>`;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readableValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (depth >= 3) return "…";
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => `• ${readableValue(item, depth + 1).replaceAll("\n", "\n  ")}`)
      .join("\n");
  }
  const entries = Object.entries(object(value)).slice(0, 20);
  if (!entries.length) return "None";
  return entries
    .map(([key, item]) => {
      const label = key
        .replaceAll(/[_-]+/g, " ")
        .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (letter) => letter.toUpperCase());
      const detail = readableValue(item, depth + 1);
      return detail.includes("\n")
        ? `${label}:\n  ${detail.replaceAll("\n", "\n  ")}`
        : `${label}: ${detail}`;
    })
    .join("\n");
}


function toolPart(part: Extract<SnapshotPart, { kind: "tool" }>): string {
  const failed = part.state === "output-error";
  const name = part.name;
  const state = failed
    ? "Tool failed"
    : part.state === "input-available"
      ? "Using tool"
      : "Used tool";
  const input = readableValue(part.input).slice(0, 4_000);
  const result = readableValue(part.output).slice(0, 4_000);
  return `<details class="my-2 rounded-lg border border-base-content/10 bg-base-200/60 px-3 py-2 text-sm">
    <summary class="cursor-pointer font-semibold">${escapeHtml(state)} · ${escapeHtml(name)}</summary>
    <div class="mt-2 grid gap-2">
      ${input !== "None" ? `<div><div class="text-xs font-semibold text-muted">Input</div><pre class="mt-1 whitespace-pre-wrap break-words font-sans text-xs">${escapeHtml(input)}</pre></div>` : ""}
      ${result !== "None" ? `<div><div class="text-xs font-semibold text-muted">${failed ? "Error" : "Result"}</div><pre class="mt-1 whitespace-pre-wrap break-words font-sans text-xs">${escapeHtml(result)}</pre></div>` : ""}
    </div>
  </details>`;
}

function messageParts(message: SnapshotMessage): string {
  const content = message.parts
    .map((part) => {
      if (part.kind === "text") {
        return `<div class="whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(part.text)}</div>`;
      }
      if (part.kind === "reasoning") {
        return `<details class="my-2 text-sm opacity-75"><summary class="cursor-pointer font-semibold">Reasoning</summary>
          <div class="mt-2 whitespace-pre-wrap break-words">${escapeHtml(part.text)}</div></details>`;
      }
      if (part.kind === "error") {
        return `<div class="my-2 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">${escapeHtml(part.text)}</div>`;
      }
      if (part.kind === "tool") return toolPart(part);
      if (part.kind === "file") {
        return `<div class="my-2 rounded-lg border border-base-content/10 px-3 py-2 text-sm">Attachment · ${escapeHtml(
          part.name
        )}</div>`;
      }
      if (part.kind === "data") {
        return `<div class="my-2 rounded-lg border border-base-content/10 px-3 py-2 text-sm">${escapeHtml(
          part.name
        )}: ${escapeHtml(readableValue(part.value))}</div>`;
      }
      return "";
    })
    .join("");
  return content || '<span class="loading loading-dots loading-sm" aria-label="Agent is replying"></span>';
}

function resultText(execution: Execution): string | null {
  const find = (value: unknown, depth = 0): string | null => {
    if (typeof value === "string" && value.trim()) return value;
    if (depth >= 3) return null;
    const raw = object(value);
    for (const key of ["text", "message", "output", "result"]) {
      const found = find(raw[key], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return find(execution.result);
}

function conversationView(
  execution: Execution,
  snapshot: BeesConversationSnapshotV1 | null
): string {
  const messages = snapshot?.messages ?? [];
  if (!messages.length) {
    const fallback =
      execution.error ??
      resultText(execution) ??
      (["queued", "running"].includes(execution.status)
        ? "The agent is working…"
        : "No conversation was recorded for this run.");
    return `<div class="chat chat-start">
      <div class="chat-header mb-1 text-xs text-muted">Agent</div>
      <div class="chat-bubble border border-base-300 bg-base-100 text-base-content">${escapeHtml(fallback)}</div>
    </div>`;
  }
  return messages
    .map((message) => {
      const user = message.role === "user";
      return `<div class="chat ${user ? "chat-end" : "chat-start"}">
        <div class="chat-header mb-1 text-xs text-muted">
          ${user ? "You" : "Agent"}${message.timestamp ? ` · ${escapeHtml(when(message.timestamp))}` : ""}
        </div>
        <div class="chat-bubble max-w-[88%] ${
          user
            ? "chat-bubble-primary"
            : "border border-base-300 bg-base-100 text-base-content"
        }">${messageParts(message)}</div>
      </div>`;
    })
    .join("");
}

function usageSummary(execution: Execution): string {
  if (!execution.usage) return "Not reported";
  const usage = execution.usage;
  const tokens = usage.totalTokens ?? usage.total_tokens ?? usage.tokens;
  const costValue =
    typeof usage.cost === "object" && usage.cost
      ? (usage.cost as Record<string, unknown>).total
      : usage.cost;
  const parts = [];
  if (tokens !== undefined) parts.push(`${String(tokens)} tokens`);
  if (typeof costValue === "number") parts.push(`$${costValue.toFixed(4)}`);
  return parts.join(" · ") || "Reported by provider";
}

export function runView(input: {
  execution: Execution;
  item: WorkItem | null;
  outputs: ExecutionOutput[];
  /** Live runs adapt the runtime stream; settled runs pass the row's stored snapshot. */
  snapshot: BeesConversationSnapshotV1 | null;
  previews: Map<string, OutputPreview>;
  remoteConnections?: string[];
}): string {
  const { execution, item, outputs, snapshot, previews, remoteConnections = [] } = input;
  const busy = ["queued", "running"].includes(execution.status);
  const taskPlan = taskPlanOutput(execution);
  const model = String(
    execution.model?.id ?? execution.model?.model ?? modelRef(execution.config)
  );
  return `<div class="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>${statusBadge(execution.status)}
        <h2 class="mt-2 text-xl font-bold">${escapeHtml(item?.title ?? "Run")}</h2>
        <p class="text-sm text-muted">${when(execution.startedAt ?? execution.createdAt)} · ${duration(execution)}</p>
      </div>
      <div class="flex gap-2">
        ${
          execution.status === "running"
            ? `<button class="btn btn-error btn-sm" data-action="stop-run" data-id="${execution.id}">Stop</button>`
            : execution.status === "queued"
              ? `<button class="btn btn-sm" disabled>Starting…</button>`
              : `<button class="btn btn-primary btn-sm" data-action="restart-run" data-id="${execution.id}"
                   title="Starts a clean run of the same work item using the agent's latest published configuration">Restart with current config</button>`
        }
        <button class="btn btn-ghost btn-sm border border-base-300" data-action="download-receipt" data-id="${execution.id}">Receipt</button>
        <button class="btn btn-ghost btn-sm text-error" data-action="delete-run" data-id="${execution.id}"
          title="Deletes the receipt, its files, and the agent conversation">Delete</button>
      </div>
    </div>
    <div class="mb-5 rounded-box border border-base-300 bg-base-100 px-4 py-3 text-xs text-muted">
      Document files: local · Model: ${escapeHtml(model)} · Bees cloud: coordination metadata only
      <span class="ml-3">Usage: ${escapeHtml(usageSummary(execution))}</span>
      ${
        remoteConnections.length
          ? `<span class="ml-3 text-warning">Remote MCP: ${escapeHtml(remoteConnections.join(", "))} · tool data may leave this device</span>`
          : ""
      }
      ${
        execution.restartedFromExecutionId
          ? `<span class="ml-3">Restarted from <button class="link" data-action="open-run" data-id="${execution.restartedFromExecutionId}">an earlier run</button></span>`
          : ""
      }
    </div>
    <div class="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <section><h3 class="mb-3 font-bold">Conversation</h3>
        <div class="grid gap-3 rounded-box border border-base-300 bg-base-200/40 p-4">
          <div class="grid gap-2">${conversationView(execution, snapshot)}</div>
          ${outputs
            .filter(({ status }) => status === "pending")
            .map((output) => approvalCard(output, busy, taskPlan))
            .join("")}
          <form class="mt-2 border-t border-base-300 pt-4" data-run-followup="${execution.id}">
            <!-- Per run: two runs render this twice, and a duplicate id sends every label to the first box. -->
            <label class="sr-only" for="run-followup-message-${execution.id}">Continue conversation</label>
            <textarea id="run-followup-message-${execution.id}" name="message" class="textarea min-h-24 w-full resize-y" maxlength="20000"
              placeholder="${busy ? "Wait for the agent to finish…" : "Ask a follow-up or give more direction…"}" required ${
                busy ? "disabled" : ""
              }></textarea>
            <div class="mt-2 flex items-center justify-between gap-3">
              <p class="text-xs text-muted">Enter to send · Shift+Enter for a new line</p>
              <button class="btn btn-primary btn-sm" type="submit" ${busy ? "disabled" : ""}>Send</button>
            </div>
          </form>
        </div>
      </section>
      <section><h3 class="mb-3 font-bold">Files</h3>
        <div class="grid gap-3">${
          outputs.length
            ? outputs
                .map((output) => {
                  const preview = previews.get(output.id);
                  return `<article class="rounded-box border border-base-300 bg-base-100 p-4">
                    <div class="flex items-start justify-between gap-3"><div><h4 class="font-semibold">${escapeHtml(
                      outputName(output, taskPlan)
                    )}</h4>${statusBadge(output.status)}</div></div>
                    ${
                      output.reason
                        ? `<p class="mt-2 text-xs text-muted"><span class="font-bold">Asked for instead:</span> ${escapeHtml(
                            output.reason
                          )}</p>`
                        : ""
                    }
                    ${
                      preview
                        ? `<div class="mt-3 grid gap-2 lg:grid-cols-2">
                            <div><div class="mb-1 text-xs font-bold text-muted">Before</div><pre class="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-base-200 p-2 text-xs">${escapeHtml(
                              preview.before ?? "(new file or binary)"
                            )}</pre></div>
                            <div><div class="mb-1 text-xs font-bold text-muted">After</div><pre class="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-base-200 p-2 text-xs">${escapeHtml(
                              preview.after ?? "(binary file)"
                            )}</pre></div>
                          </div>${preview.truncated ? `<p class="mt-2 text-xs text-warning">Preview truncated to 256 KB.</p>` : ""}`
                        : output.status === "pending"
                          ? `<button class="btn btn-ghost btn-xs mt-3" data-action="preview-output" data-id="${output.id}">Show before / after</button>`
                          : ""
                    }
                  </article>`;
                })
                .join("")
            : empty("No proposed files", "This run did not write output files.")
        }</div>
      </section>
    </div>`;
}

function cronSchedule(schedule: Schedule): string {
  const date = new Date(schedule.nextRunAt);
  if (Number.isNaN(date.getTime())) return schedule.recurrence;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: schedule.timezone,
      hourCycle: "h23",
      hour: "numeric",
      minute: "numeric"
    }).formatToParts(date);
  }
  catch {
    return schedule.recurrence;
  }
  const part = (type: "hour" | "minute"): number => Number(parts.find((value) => value.type === type)?.value ?? 0);
  const minute = part("minute");
  if (schedule.recurrence === "hourly") return `${minute} * * * *`;
  const hour = part("hour");
  return schedule.recurrence === "weekdays"
    ? `${minute} ${hour} * * 1-5`
    : `${minute} ${hour} * * *`;
}

export function schedulesView(items: WorkItem[], schedules: Schedule[], processes: Process[]): string {
  return `<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted">Runs while Bees is open and this computer is awake. Task-plan schedules create one catch-up occurrence after downtime.</p>
      <button class="btn btn-primary btn-sm" data-action="new-schedule">New schedule</button>
    </div>
    ${
      schedules.length
        ? `<div class="overflow-x-auto rounded-box border border-base-300 bg-base-100 shadow-sm">
            <table class="table">
              <thead><tr><th>Task name</th><th>Process name</th><th>Cron schedule</th><th></th></tr></thead>
              <tbody>${schedules
            .map((schedule) => {
              const item = items.find(({ id }) => id === schedule.workItemId);
              const process = processes.find(({ id }) => id === item?.processId)?.name ?? "—";
              return `<tr>
                <td><div class="font-semibold">${escapeHtml(item?.title ?? "Unknown task")}</div><div class="text-xs text-muted">${escapeHtml(schedule.name)}</div></td>
                <td>${escapeHtml(process)}</td>
                <td><code>${escapeHtml(cronSchedule(schedule))}</code><div class="text-xs text-muted">${escapeHtml(schedule.timezone)} · next ${when(schedule.nextRunAt)}</div></td>
                <td><div class="flex justify-end gap-2"><button class="btn btn-primary btn-xs" data-action="run-schedule" data-id="${schedule.id}">Run now</button>
                  <button class="btn btn-ghost btn-xs" data-action="toggle-schedule" data-id="${schedule.id}">${schedule.enabled ? "Pause" : "Enable"}</button>
                  <button class="btn btn-ghost btn-xs text-error" data-action="delete-schedule" data-id="${schedule.id}">Remove</button></div></td>
              </tr>`;
            })
            .join("")}</tbody></table></div>`
        : empty("No schedules", "Add a recurrence to any existing work item.")
    }`;
}

/**
 * The stage a process is in, at a glance — the same badge strip everywhere a process shows
 * progress, so a person learns it once. Reused by the generic item page and by process-specific
 * renderers (e.g. the software-project studio) instead of each inventing its own.
 */
export function stageProgressStrip(stages: readonly { id: string; name: string }[], currentStageId: string): string {
  return `<div class="mb-4 flex flex-wrap gap-2">${stages
    .map(({ id, name }) => `<span class="badge ${id === currentStageId ? "badge-primary" : "badge-ghost"}">${escapeHtml(name)}</span>`)
    .join("")}</div>`;
}

/**
 * One item, one page. Every run is a `<details>` row — the one holding a pending approval opens
 * itself, so a person lands on the thing they owe an answer to instead of an inert "Overview"
 * tab and having to go find it.
 */
export function workItemView(input: {
  item: WorkItem;
  stages: readonly { id: string; name: string }[] | null;
  runs: Execution[];
  outputsByExecution: Map<string, ExecutionOutput[]>;
  snapshotsByExecution: Map<string, BeesConversationSnapshotV1 | null>;
  previews: Map<string, OutputPreview>;
}): string {
  const { item, stages, runs, outputsByExecution, snapshotsByExecution, previews } = input;
  const ordered = [...runs].sort((a, b) =>
    (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt)
  );
  return `${stages ? stageProgressStrip(stages, item.stageId) : ""}
    <div class="rounded-box border border-base-300 bg-base-100 p-5 mb-5"><p>${escapeHtml(
      item.description || "No description."
    )}</p><dl class="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt class="text-muted">Status</dt><dd>${escapeHtml(
      workItemConditionLabel(workItemCondition(item, runs))
    )}</dd></div><div><dt class="text-muted">Files</dt><dd>${escapeHtml(
      item.logicalFiles.join(", ") || "None"
    )}</dd></div><div><dt class="text-muted">Last checkpoint</dt><dd>${when(
      item.checkpointAt
    )}</dd></div></dl></div>
    <div class="grid gap-3">${
      ordered.length
        ? ordered
            .map((run) => {
              const outputs = outputsByExecution.get(run.id) ?? [];
              const pending = outputs.some(({ status }) => status === "pending");
              return `<details class="rounded-box border border-base-300 bg-base-100" ${pending ? "open" : ""}>
                <summary class="flex cursor-pointer flex-wrap items-center gap-2 p-4 font-semibold">
                  ${statusBadge(run.status)}
                  <span class="text-sm font-normal text-muted">${when(run.startedAt ?? run.createdAt)}</span>
                  ${pending ? `<span class="badge badge-warning badge-sm">Needs you</span>` : ""}
                </summary>
                <div class="border-t border-base-300 p-4">${runView({
                  execution: run,
                  item,
                  outputs,
                  snapshot: snapshotsByExecution.get(run.id) ?? null,
                  previews
                })}</div>
              </details>`;
            })
            .join("")
        : empty("No runs yet", "This item has not run.")
    }</div>`;
}
