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

export function taskPlanOutput(execution: Execution): string | undefined {
  return execution.result?.taskPlan?.output;
}

function outputName(output: ExecutionOutput, taskPlan?: string): string {
  return output.logicalOutput === taskPlan ? "Proposed subtasks" : output.logicalDestination;
}

export function approvalButtons(outputId: string, busy: boolean, size: "xs" | "sm" = "sm"): string {
  return `<button class="btn btn-ghost btn-${size} text-base-content/70 hover:bg-error/10 hover:text-error" data-action="reject-output" data-id="${escapeHtml(outputId)}" ${
    busy ? "disabled" : ""
  }>Reject</button>
  <button class="btn btn-success btn-${size}" data-action="approve-output" data-id="${escapeHtml(outputId)}" ${
    busy ? "disabled" : ""
  }>Approve</button>`;
}

export function approvalCard(output: ExecutionOutput, busy: boolean, taskPlan?: string, showActions = true): string {
  const actions = showActions ? `<div class="flex shrink-0 items-center gap-2">
    ${approvalButtons(output.id, busy)}
  </div>` : "";
  const headerIcon = `<svg class="size-5 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>`;

  if (/\.md$/i.test(output.logicalOutput)) {
    return `<article class="rounded-xl border-l-4 border-l-warning border-y border-r border-base-300 bg-base-100 p-5 shadow-sm">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-2 text-sm font-bold text-base-content">
          ${headerIcon}
          Approval required
        </div>
        ${actions}
      </div>
      <button class="group mt-2 flex w-full items-center gap-3 rounded-lg border border-base-200 bg-base-100/50 p-3 text-left transition-colors hover:border-base-300 hover:bg-base-200/50 hover:shadow-sm"
        data-action="view-markdown-output" data-id="${output.id}"
        aria-haspopup="dialog"
        aria-label="Open ${escapeHtml(output.logicalOutput)} in Markdown viewer">
        <div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-base-200 text-base-content/60 shadow-sm transition-colors group-hover:bg-base-100 group-hover:text-base-content">
          <svg class="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
        </div>
        <span class="text-sm font-medium text-base-content transition-colors group-hover:text-primary">${escapeHtml(output.logicalOutput)}</span>
      </button>
    </article>`;
  }
  return `<article class="rounded-xl border-l-4 border-l-warning border-y border-r border-base-300 bg-base-100 p-5 shadow-sm">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div class="flex items-center gap-2 text-sm font-bold text-base-content">
          ${headerIcon}
          ${output.logicalOutput === taskPlan ? "Task plan approval required" : "Approval required"}
        </div>
        <h4 class="pl-7 mt-2 text-sm font-medium text-base-content/80">${escapeHtml(outputName(output, taskPlan))}</h4>
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
  return `<div class="flex flex-col items-center justify-center p-12 text-center">
    <div class="mb-4 flex size-16 items-center justify-center rounded-full bg-base-200/50 text-base-content/40">
      <svg class="size-7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
    </div>
    <h3 class="text-lg font-medium text-base-content/80">${escapeHtml(title)}</h3>
    <p class="mt-2 max-w-sm text-sm text-muted">${escapeHtml(detail)}</p>
  </div>`;
}

function overviewAssistant(): string {
  return `<div class="flex flex-col">
    <label class="mb-2 ml-1 text-sm font-bold tracking-tight text-base-content/80" for="overview-assistant-message">Ask AI Assistant</label>
    <form class="group flex w-full flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm transition-all focus-within:border-primary/40 focus-within:shadow-md focus-within:ring-1 focus-within:ring-primary/20" data-overview-assistant>
      <textarea id="overview-assistant-message" name="message"
        class="textarea w-full resize-none border-none bg-transparent p-5 text-base leading-relaxed focus:outline-none focus:ring-0 min-h-32" maxlength="20000" required
        placeholder="What would you like the team to do? Start a process, check on a task, or summarize work..."></textarea>
      
      <div class="flex items-center justify-between border-t border-base-200/50 bg-base-200/30 px-5 py-3">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-base-content/50">Press <kbd class="kbd kbd-xs bg-base-100 opacity-80">Enter</kbd> to send</span>
        </div>
        <button class="btn btn-primary btn-sm rounded-full px-6 shadow-sm gap-2" type="submit"><svg viewBox="0 0 24 24" class="size-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.4 3.6L7 8l3.6 1.4L12 13l1.4-3.6L17 8l-3.6-1.4L12 3Z"></path><path d="m19 14-.8 2.2L16 17l2.2.8L19 20l.8-2.2L22 17l-2.2-.8L19 14Z"></path><path d="m5 12-1 2.5L1.5 15.5 4 16.5 5 19l1-2.5 2.5-1L6 14.5 5 12Z"></path></svg>Go</button>
      </div>
    </form>
  </div>`;
}

export function overviewView(): string {
  return `<div class="mx-auto flex max-w-5xl flex-col gap-8 pb-12 pt-6">
    ${overviewAssistant()}
  </div>`;
}

export function welcomeView(): string {
  return `<div class="mx-auto flex max-w-2xl flex-col items-center justify-center pt-24 text-center">
    <div class="mb-6 flex size-20 items-center justify-center rounded-3xl bg-primary/10 text-primary">
      <svg class="size-10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    </div>
    <h2 class="mb-3 text-3xl font-bold tracking-tight">Let's get started</h2>
    <p class="mb-8 max-w-md text-base text-base-content/70">A workspace is organized into teams. Create your first team to invite members, manage processes, and start collaborating.</p>
    <button class="btn btn-primary btn-lg rounded-xl px-8 shadow-sm transition-transform active:scale-95" data-action="new-team">
      <svg class="mr-2 size-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14m-7-7h14"/></svg>
      Create a team
    </button>
  </div>`;
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
        <th>Process</th><th>Task name</th><th>Approval message</th><th>Files</th><th>Action</th>
      </tr></thead>
      <tbody>${rows
        .map(({ item, state }) => {
          const itemRuns = executions.filter(({ workItemId }) => workItemId === item.id);
          const errorExecutionId = item.waits.find(({ kind, resolvedAt }) => kind === "error" && !resolvedAt)?.executionId;
          const restartRun = state.reason === "step-failed" || state.reason === "run-failed"
            ? itemRuns.find(({ id }) => id === errorExecutionId) ?? [...itemRuns]
                .sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt))[0]
            : undefined;
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
            <td><div class="flex flex-wrap justify-end gap-1"><button class="btn btn-ghost btn-xs" data-action="edit-item" data-id="${item.id}">Edit</button>${restartRun
              ? `<button class="btn btn-primary btn-xs" data-action="restart-run" data-id="${restartRun.id}">Restart</button>`
              : ""}${pending.map((output) => {
              const run = itemRuns.find(({ id }) => id === output.executionId);
              const busy = run?.status === "queued" || run?.status === "running";
              return approvalButtons(output.id, busy, "xs");
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
        <button class="btn btn-ghost btn-sm text-base-content/70 hover:bg-error/10 hover:text-error" data-action="reject-output" data-inbox-output-preview-reject>Reject</button>
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
          return `<tr class="cursor-pointer hover" data-action="open-item" data-id="${item.id}">
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
  const pending = part.state === "input-available";
  const input = readableValue(part.input).slice(0, 4_000);
  const result = readableValue(part.output).slice(0, 4_000);
  const icon = failed
    ? `<svg viewBox="0 0 24 24" class="size-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>`
    : pending
    ? `<svg viewBox="0 0 24 24" class="size-3 shrink-0 animate-spin" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>`
    : `<svg viewBox="0 0 24 24" class="size-3 shrink-0 opacity-60" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>`;
  const label = `${icon}<span>${escapeHtml(part.name)}</span>`;
  const hasDetails = (input !== "None" || result !== "None") && !pending;
  if (!hasDetails) {
    return `<div class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${failed ? "bg-error/10 text-error" : "bg-base-200 text-base-content/50"}">${label}</div>`;
  }
  return `<details class="group my-1">
    <summary class="inline-flex cursor-pointer list-none items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${failed ? "bg-error/10 text-error" : "bg-base-200 text-base-content/50"} hover:bg-base-300/60">${label}<svg viewBox="0 0 24 24" class="size-2.5 shrink-0 opacity-50 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg></summary>
    <div class="mt-1.5 rounded bg-base-200/60 px-3 py-2 text-xs text-base-content/70">
      ${input !== "None" ? `<div class="mb-1 font-semibold text-base-content/50">Input</div><pre class="whitespace-pre-wrap break-words font-sans">${escapeHtml(input)}</pre>` : ""}
      ${result !== "None" ? `<div class="mb-1 mt-2 font-semibold text-base-content/50">${failed ? "Error" : "Result"}</div><pre class="whitespace-pre-wrap break-words font-sans">${escapeHtml(result)}</pre>` : ""}
    </div>
  </details>`;
}

const MSG_TRUNCATE_CHARS = 600;

function truncateText(text: string): { short: string; truncated: boolean } {
  if (text.length <= MSG_TRUNCATE_CHARS) return { short: text, truncated: false };
  // Trim at a word boundary near the limit
  const cut = text.lastIndexOf(" ", MSG_TRUNCATE_CHARS) > MSG_TRUNCATE_CHARS * 0.8
    ? text.lastIndexOf(" ", MSG_TRUNCATE_CHARS)
    : MSG_TRUNCATE_CHARS;
  return { short: text.slice(0, cut), truncated: true };
}

function messageParts(message: SnapshotMessage): string {
  const content = message.parts
    .map((part) => {
      if (part.kind === "text") {
        const { short, truncated } = truncateText(part.text);
        const id = `msg-${Math.random().toString(36).slice(2, 8)}`;
        if (!truncated) {
          return `<div class="whitespace-pre-wrap break-words leading-relaxed text-[13px]">${escapeHtml(part.text)}</div>`;
        }
        return `<div class="whitespace-pre-wrap break-words leading-relaxed text-[13px]" data-msg-collapse="${id}">
          <span data-msg-short="${id}">${escapeHtml(short)}<span class="text-base-content/30">…</span> <button class="link link-hover text-[12px] text-primary/70 font-medium" data-action="expand-msg" data-msg="${id}">Show more</button></span>
          <span data-msg-full="${id}" hidden>${escapeHtml(part.text)} <button class="link link-hover text-[12px] text-primary/70 font-medium" data-action="collapse-msg" data-msg="${id}">Show less</button></span>
        </div>`;
      }
      if (part.kind === "reasoning") {
        return `<details class="my-1"><summary class="cursor-pointer text-[11px] text-base-content/40 hover:text-base-content/60">Reasoning</summary>
          <div class="mt-1 whitespace-pre-wrap break-words text-xs text-base-content/50">${escapeHtml(part.text)}</div></details>`;
      }
      if (part.kind === "error") {
        return `<div class="mt-1 rounded bg-error/10 px-2 py-1 text-xs text-error">${escapeHtml(part.text)}</div>`;
      }
      if (part.kind === "tool") return toolPart(part);
      if (part.kind === "file") {
        return `<div class="inline-flex items-center gap-1 rounded bg-base-200 px-1.5 py-0.5 text-[11px] text-base-content/60">📎 ${escapeHtml(part.name)}</div>`;
      }
      if (part.kind === "data") {
        return `<div class="inline-flex items-center gap-1 rounded bg-base-200 px-1.5 py-0.5 text-[11px] text-base-content/60">${escapeHtml(part.name)}: ${escapeHtml(readableValue(part.value))}</div>`;
      }
      return "";
    })
    .join(" ");
  return content || '<span class="loading loading-dots loading-sm opacity-40" aria-label="Agent is replying"></span>';
}

export function conversationView(
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
    return `<p class="text-sm text-base-content/50 py-4 text-center">${escapeHtml(fallback)}</p>`;
  }
  // Only text/agent messages and user messages — skip pure tool-only messages with no text
  const visible = messages.filter(m => m.parts.some(p => p.kind === "text" || p.kind === "error" || p.kind === "reasoning" || (p.kind === "tool" && p.state === "output-error")));
  if (!visible.length) {
    return `<p class="text-sm text-base-content/50 py-4 text-center">Agent is working…</p>`;
  }
  return visible
    .map((message) => {
      const user = message.role === "user";
      const tools = message.parts.filter(p => p.kind === "tool");
      const textParts = message.parts.filter(p => p.kind !== "tool");
      const toolsHtml = tools.length ? `<div class="mt-1 flex flex-wrap gap-1">${tools.map(p => p.kind === "tool" ? toolPart(p) : "").join("")}</div>` : "";
      const textHtml = messageParts({ ...message, parts: textParts as typeof message.parts });
      if (user) {
        return `<div class="flex justify-end mb-3">
          <div class="max-w-[82%] rounded-2xl rounded-tr-sm bg-primary/10 px-3.5 py-2.5 text-[13px] text-base-content">${textHtml}${toolsHtml}</div>
        </div>`;
      }
      return `<div class="flex gap-2.5 mb-3">
        <div class="mt-0.5 size-6 shrink-0 rounded-full bg-base-200 grid place-items-center">
          <svg viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.4 3.6L7 8l3.6 1.4L12 13l1.4-3.6L17 8l-3.6-1.4L12 3Z"></path><path d="m19 14-.8 2.2L16 17l2.2.8L19 20l.8-2.2L22 17l-2.2-.8L19 14Z"></path><path d="m5 12-1 2.5L1.5 15.5 4 16.5 5 19l1-2.5 2.5-1L6 14.5 5 12Z"></path></svg>
        </div>
        <div class="min-w-0 flex-1">${textHtml}${toolsHtml}</div>
      </div>`;
    })
    .join("");
};

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

export function usageSummary(execution: Execution): string {
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
  const pendingOutput = outputs.find(({ status }) => status === "pending");
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
        ${pendingOutput ? approvalButtons(pendingOutput.id, busy) : ""}
        ${
          execution.status === "running"
            ? `<button class="btn btn-error btn-sm" data-action="stop-run" data-id="${execution.id}">Stop run</button>`
            : execution.status === "queued"
              ? `<button class="btn btn-sm" disabled>Starting…</button>`
              : `<button class="btn btn-primary btn-sm" data-action="restart-run" data-id="${execution.id}"
                   title="Starts a clean run of the same work item using the agent's latest published configuration">Restart with current config</button>`
        }
        <button class="btn btn-ghost btn-sm text-error" data-action="delete-run" data-id="${execution.id}"
          title="Deletes this run, its files, and the agent conversation">Delete</button>
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
            .map((output, index) => approvalCard(output, busy, taskPlan, index > 0))
            .join("")}
          <form class="mt-2 border-t border-base-300 pt-4" data-run-followup="${execution.id}">
            <!-- Per run: two runs render this twice, and a duplicate id sends every label to the first box. -->
            <label class="sr-only" for="run-followup-message-${execution.id}">Continue conversation</label>
            <textarea id="run-followup-message-${execution.id}" name="message" class="textarea min-h-24 w-full resize-y" maxlength="20000"
              placeholder="${busy ? "Wait for the agent to finish…" : "Ask a follow-up or give more direction…"}" required ${
                busy ? "disabled" : ""
              }></textarea>
            <div class="mt-2 flex items-center justify-end">
              <button class="btn btn-primary btn-sm gap-1.5" type="submit" ${busy ? "disabled" : ""}>
                <span>Send</span>
                <svg viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
              </button>
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
