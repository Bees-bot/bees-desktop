import type { Agent, Execution, ExecutionOutput, WorkItem } from "./domain.js";

export function runReceipt(
  execution: Execution,
  workItem: WorkItem,
  agent: Agent | null,
  outputs: ExecutionOutput[]
): string {
  const duration =
    execution.startedAt && execution.endedAt
      ? Math.max(0, Date.parse(execution.endedAt) - Date.parse(execution.startedAt))
      : null;
  const cost = Number(execution.usage?.cost && (execution.usage.cost as Record<string, unknown>).total);
  return [
    "# Bees run receipt",
    "",
    `- Status: ${execution.status}`,
    `- Work item: ${workItem.title}`,
    `- Agent: ${agent?.name ?? "removed"}`,
    `- Started: ${execution.startedAt ?? execution.createdAt}`,
    `- Duration: ${duration === null ? "unknown" : `${Math.round(duration / 1_000)}s`}`,
    `- Model: ${String(execution.model?.provider ?? "unknown")}/${String(execution.model?.id ?? "unknown")}`,
    `- Cost: ${Number.isFinite(cost) ? `$${cost.toFixed(4)}` : "not reported"}`,
    `- Files: ${outputs.map(({ logicalDestination }) => logicalDestination).join(", ") || "none"}`,
    "",
    "Document contents omitted. Generated locally by Bees."
  ].join("\n");
}
