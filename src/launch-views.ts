import type {
  Execution,
  ExecutionOutput,
  Organization,
  Schedule,
  Team,
  WorkItem
} from "./domain.js";
import { modelRef } from "./local-models.js";
import { TASK_PLAN_OUTPUT } from "./processes/goals/index.js";
import type {
  BeesConversationSnapshotV1,
  SnapshotMessage,
  SnapshotPart
} from "./conversation-snapshot.js";
import type { OutputPreview } from "./workspaces.js";
import type { SearchHit } from "./repository.js";

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

function outputName(output: ExecutionOutput): string {
  return output.logicalOutput === TASK_PLAN_OUTPUT ? "Proposed subtasks" : output.logicalDestination;
}

function approvalCard(output: ExecutionOutput, busy: boolean): string {
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
        <div class="text-xs font-bold uppercase tracking-wide text-warning">Approval required</div>
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
        <div class="text-xs font-bold uppercase tracking-wide text-warning">${
          output.logicalOutput === TASK_PLAN_OUTPUT ? "Task plan approval required" : "Approval required"
        }</div>
        <h4 class="mt-1 font-semibold">${escapeHtml(outputName(output))}</h4>
      </div>
      ${actions}
    </div>
  </article>`;
}

function when(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function duration(execution: Execution): string {
  if (!execution.startedAt || !execution.endedAt) return execution.status === "running" ? "Running" : "—";
  const seconds = Math.max(0, Math.round((Date.parse(execution.endedAt) - Date.parse(execution.startedAt)) / 1_000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function statusBadge(status: string): string {
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
    <p class="mt-2 text-sm text-base-content/55">${escapeHtml(detail)}</p>
  </div>`;
}

export interface OverviewAssistantOptions {
  projects: Organization[];
  teams: Team[];
  models: { group: string; label: string }[];
  projectId: string;
  teamId: string;
  modelIndex: number;
}

function overviewAssistant(options?: OverviewAssistantOptions): string {
  const project = options?.projects.find(({ id }) => id === options.projectId);
  const team = options?.teams.find(({ id }) => id === options.teamId);
  const models = options?.models ?? [];
  return `<form class="mt-6 w-full rounded-box border border-base-300 bg-base-100 p-4 shadow-sm" data-overview-assistant>
    <label class="mb-2 block text-sm font-bold" for="overview-assistant-message">Ask AI assistant</label>
    <textarea id="overview-assistant-message" name="message"
      class="textarea textarea-bordered min-h-28 w-full resize-y" maxlength="20000" required
      placeholder="What would you like help with?"></textarea>
    <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
      <select class="select select-bordered w-full" name="project" data-overview-project aria-label="Project context">
        <option value="">${escapeHtml(project ? `Current project: ${project.name}` : "Project (optional)")}</option>
        ${(options?.projects ?? [])
          .filter(({ id }) => id !== options?.projectId)
          .map(({ id, name }) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`)
          .join("")}
      </select>
      <select class="select select-bordered w-full" name="team" data-overview-team aria-label="Team context"
        ${options?.teams.length ? "" : "disabled"}>
        <option value="">${escapeHtml(team ? `Current team: ${team.name}` : "Team (optional)")}</option>
        ${(options?.teams ?? [])
          .filter(({ id }) => id !== options?.teamId)
          .map(({ id, name }) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`)
          .join("")}
      </select>
      <select class="select select-bordered w-full" name="model" data-overview-model aria-label="AI model"
        ${models.length ? "" : "disabled"}>
        ${
          models.length
            ? models
                .map(
                  ({ group, label }, index) =>
                    `<option value="${index}" ${index === options?.modelIndex ? "selected" : ""}>${escapeHtml(
                      `${group} · ${label}`
                    )}</option>`
                )
                .join("")
            : '<option value="">No models available</option>'
        }
      </select>
      <button class="btn btn-primary" type="submit" ${models.length ? "" : "disabled"}>Go</button>
    </div>
  </form>`;
}

export function overviewView(
  items: WorkItem[],
  executions: Execution[],
  pendingOutputs: ExecutionOutput[],
  dismissedRunIds: ReadonlySet<string> = new Set(),
  assistant?: OverviewAssistantOptions
): string {
  const running = executions.filter(({ status }) => status === "running").length;
  const attention =
    pendingOutputs.length +
    executions.filter(
      ({ id, status }) =>
        ["failed", "interrupted"].includes(status) && !dismissedRunIds.has(id)
    ).length;
  const completed = executions.filter(({ status }) => status === "completed").length;
  return `<div class="grid gap-4 md:grid-cols-3">
      ${[
        ["Running", running, "runs"],
        ["Needs attention", attention, "inbox"],
        ["Completed", completed, "runs"]
      ]
        .map(
          ([label, value, view]) => `<button class="stat rounded-box border border-base-300 bg-base-100 text-left shadow-sm" data-view="${view}">
            <div class="stat-title">${label}</div><div class="stat-value text-primary">${value}</div>
          </button>`
        )
        .join("")}
    </div>
    ${overviewAssistant(assistant)}
    <section class="mt-6">
      <div class="mb-3 flex items-center justify-between"><h2 class="text-lg font-bold">Recent runs</h2>
        <button class="btn btn-ghost btn-sm" data-view="runs">View all</button></div>
      ${
        executions.length
          ? `<div class="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table class="table table-sm"><tbody>${executions
                .slice(0, 8)
                .map(
                  (run) => `<tr><td><button class="link link-hover font-semibold" data-action="open-run" data-id="${run.id}">${escapeHtml(
                    itemName(items, run.workItemId)
                  )}</button></td><td>${statusBadge(run.status)}</td><td>${duration(run)}</td><td>${when(run.createdAt)}</td></tr>`
                )
                .join("")}</tbody></table></div>`
          : empty("No runs yet", "Start an item from Work to see activity here.")
      }
    </section>`;
}

export function inboxView(
  items: WorkItem[],
  executions: Execution[],
  pendingOutputs: ExecutionOutput[],
  dismissedRunIds: ReadonlySet<string> = new Set()
): string {
  const failed = executions.filter(
    ({ id, status }) =>
      ["failed", "interrupted"].includes(status) && !dismissedRunIds.has(id)
  );
  if (!pendingOutputs.length && !failed.length) {
    return empty("Inbox clear", "Approvals and failed runs will appear here.");
  }
  return `<div class="grid gap-3">
    ${pendingOutputs
      .map((output) => {
        const run = executions.find(({ id }) => id === output.executionId);
        return `<article class="card border border-warning/40 bg-base-100 shadow-sm"><div class="card-body p-4">
          <div class="flex items-center justify-between gap-3"><div><div class="text-xs font-bold uppercase tracking-wide text-warning">${
            output.logicalOutput === TASK_PLAN_OUTPUT ? "Task plan approval" : "File approval"
          }</div>
          <h3 class="font-bold">${escapeHtml(outputName(output))}</h3>
          <p class="text-sm text-base-content/55">${escapeHtml(run ? itemName(items, run.workItemId) : "Run")}</p></div>
          <button class="btn btn-primary btn-sm" data-action="open-run" data-id="${output.executionId}">Review</button></div>
        </div></article>`;
      })
      .join("")}
    ${failed
      .map(
        (run) => `<article class="card border border-error/30 bg-base-100 shadow-sm"><div class="card-body p-4">
          <div class="flex items-center justify-between gap-3"><div>${statusBadge(run.status)}
          <h3 class="mt-1 font-bold">${escapeHtml(itemName(items, run.workItemId))}</h3>
          <p class="line-clamp-2 text-sm text-error">${escapeHtml(run.error || run.logs || "Run stopped before the step completed.")}</p></div>
          <div class="flex shrink-0 gap-2">
            <button class="btn btn-ghost btn-sm" data-action="dismiss-run" data-id="${run.id}">Dismiss</button>
            <button class="btn btn-ghost btn-sm" data-action="open-run" data-id="${run.id}">Open run</button>
          </div></div>
        </div></article>`
      )
      .join("")}
  </div>`;
}

export function runsView(items: WorkItem[], executions: Execution[]): string {
  if (!executions.length) return empty("No run history", "Run a work item to create the first entry.");
  return `<div class="overflow-x-auto rounded-box border border-base-300 bg-base-100 shadow-sm">
    <table class="table">
      <thead><tr><th>Work item</th><th>Status</th><th>Started</th><th>Duration</th><th></th></tr></thead>
      <tbody>${executions
        .map(
          (run) => `<tr><td class="font-semibold">${escapeHtml(itemName(items, run.workItemId))}</td><td>${statusBadge(
            run.status
          )}</td><td>${when(run.startedAt ?? run.createdAt)}</td><td>${duration(run)}</td>
          <td class="text-right"><button class="btn btn-ghost btn-xs" data-action="open-run" data-id="${run.id}">Open</button></td></tr>`
        )
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
        ${hit.snippet ? `<p class="mt-1 text-xs text-base-content/60">${escapeHtml(hit.snippet)}</p>` : ""}
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
      ${input !== "None" ? `<div><div class="text-xs font-bold uppercase text-base-content/45">Input</div><pre class="mt-1 whitespace-pre-wrap break-words font-sans text-xs">${escapeHtml(input)}</pre></div>` : ""}
      ${result !== "None" ? `<div><div class="text-xs font-bold uppercase text-base-content/45">${failed ? "Error" : "Result"}</div><pre class="mt-1 whitespace-pre-wrap break-words font-sans text-xs">${escapeHtml(result)}</pre></div>` : ""}
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
      <div class="chat-header mb-1 text-xs text-base-content/50">Agent</div>
      <div class="chat-bubble border border-base-300 bg-base-100 text-base-content">${escapeHtml(fallback)}</div>
    </div>`;
  }
  return messages
    .map((message) => {
      const user = message.role === "user";
      return `<div class="chat ${user ? "chat-end" : "chat-start"}">
        <div class="chat-header mb-1 text-xs text-base-content/50">
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
  const model = String(
    execution.model?.id ?? execution.model?.model ?? modelRef(execution.config)
  );
  return `<div class="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>${statusBadge(execution.status)}
        <h2 class="mt-2 text-xl font-bold">${escapeHtml(item?.title ?? "Run")}</h2>
        <p class="text-sm text-base-content/55">${when(execution.startedAt ?? execution.createdAt)} · ${duration(execution)}</p>
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
    <div class="mb-5 rounded-box border border-base-300 bg-base-100 px-4 py-3 text-xs text-base-content/60">
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
            .map((output) => approvalCard(output, busy))
            .join("")}
          <form class="mt-2 border-t border-base-300 pt-4" data-run-followup="${execution.id}">
            <label class="sr-only" for="run-followup-message">Continue conversation</label>
            <textarea id="run-followup-message" name="message" class="textarea min-h-24 w-full resize-y" maxlength="20000"
              placeholder="${busy ? "Wait for the agent to finish…" : "Ask a follow-up or give more direction…"}" required ${
                busy ? "disabled" : ""
              }></textarea>
            <div class="mt-2 flex items-center justify-between gap-3">
              <p class="text-xs text-base-content/50">Enter to send · Shift+Enter for a new line</p>
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
                      outputName(output)
                    )}</h4>${statusBadge(output.status)}</div></div>
                    ${
                      output.reason
                        ? `<p class="mt-2 text-xs text-base-content/60"><span class="font-bold">Asked for instead:</span> ${escapeHtml(
                            output.reason
                          )}</p>`
                        : ""
                    }
                    ${
                      preview
                        ? `<div class="mt-3 grid gap-2 lg:grid-cols-2">
                            <div><div class="mb-1 text-xs font-bold text-base-content/45">Before</div><pre class="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-base-200 p-2 text-xs">${escapeHtml(
                              preview.before ?? "(new file or binary)"
                            )}</pre></div>
                            <div><div class="mb-1 text-xs font-bold text-base-content/45">After</div><pre class="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-base-200 p-2 text-xs">${escapeHtml(
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

export function schedulesView(items: WorkItem[], schedules: Schedule[], executions: Execution[]): string {
  return `<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-base-content/60">Runs while Bees is open and this computer is awake. Goal schedules create one catch-up occurrence after downtime.</p>
      <button class="btn btn-primary btn-sm" data-action="new-schedule">New schedule</button>
    </div>
    ${
      schedules.length
        ? `<div class="grid gap-3">${schedules
            .map((schedule) => {
              const occurrenceIds = new Set(
                items.filter(({ goal }) => goal?.occurrenceOf === schedule.workItemId).map(({ id }) => id)
              );
              const recent = executions.filter(
                ({ workItemId }) => workItemId === schedule.workItemId || occurrenceIds.has(workItemId)
              ).slice(0, 3);
              const behavior = schedule.mode === "spawn_goal"
                ? `new goal occurrence · ${schedule.role}`
                : "rerun item";
              return `<article class="card border border-base-300 bg-base-100 shadow-sm"><div class="card-body p-4">
                <div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="font-bold">${escapeHtml(schedule.name)}</h3>
                  <p class="text-sm text-base-content/55">${escapeHtml(itemName(items, schedule.workItemId))} · ${escapeHtml(
                    schedule.recurrence
                  )} · ${escapeHtml(behavior)} · ${escapeHtml(schedule.timezone)}</p>
                  <p class="mt-1 text-xs">Next: ${when(schedule.nextRunAt)}</p></div>
                  <div class="flex gap-2"><button class="btn btn-primary btn-xs" data-action="run-schedule" data-id="${schedule.id}">Run now</button>
                    <button class="btn btn-ghost btn-xs" data-action="toggle-schedule" data-id="${schedule.id}">${
                      schedule.enabled ? "Pause" : "Enable"
                    }</button><button class="btn btn-ghost btn-xs text-error" data-action="delete-schedule" data-id="${schedule.id}">Remove</button></div>
                </div>
                ${
                  recent.length
                    ? `<div class="mt-3 flex flex-wrap gap-2">${recent
                        .map(
                          (run) => `<button class="badge badge-ghost gap-1" data-action="open-run" data-id="${run.id}">${statusBadge(
                            run.status
                          )} ${when(run.createdAt)}</button>`
                        )
                        .join("")}</div>`
                    : ""
                }
              </div></article>`;
            })
            .join("")}</div>`
        : empty("No schedules", "Add a recurrence to any existing work item.")
    }`;
}

export function workItemView(
  item: WorkItem,
  runs: Execution[],
  snapshots: BeesConversationSnapshotV1[],
  tab: "overview" | "conversation" | "runs"
): string {
  const tabs = ["overview", "conversation", "runs"] as const;
  return `<div class="tabs tabs-border mb-5">${tabs
    .map(
      (value) => `<button class="tab ${tab === value ? "tab-active" : ""}" data-item-tab="${value}">${
        value[0]!.toUpperCase() + value.slice(1)
      }</button>`
    )
    .join("")}</div>
    ${
      tab === "overview"
        ? `<div class="rounded-box border border-base-300 bg-base-100 p-5"><p>${escapeHtml(
            item.description || "No description."
          )}</p><dl class="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt class="text-base-content/45">Status</dt><dd>${escapeHtml(
            item.status
          )}</dd></div><div><dt class="text-base-content/45">Files</dt><dd>${escapeHtml(
            item.logicalFiles.join(", ") || "None"
          )}</dd></div><div><dt class="text-base-content/45">Last checkpoint</dt><dd>${when(
            item.checkpointAt
          )}</dd></div></dl></div>`
        : tab === "conversation"
          ? `<div class="grid gap-3">${
              snapshots.some(({ messages }) => messages.length)
                ? snapshots
                    .flatMap(({ messages }) => messages)
                    .map(
                      (message) => `<div class="chat ${message.role === "user" ? "chat-end" : "chat-start"}">
                        <div class="chat-header mb-1 text-xs text-base-content/50">${
                          message.role === "user" ? "You" : "Agent"
                        }</div>
                        <div class="chat-bubble max-w-[88%] ${
                          message.role === "user"
                            ? "chat-bubble-primary"
                            : "border border-base-300 bg-base-100 text-base-content"
                        }">${messageParts(message)}</div>
                      </div>`
                    )
                    .join("")
                : empty("No conversation yet", "Run this item to start one.")
            }</div>`
          : runsView([item], runs)
    }`;
}
