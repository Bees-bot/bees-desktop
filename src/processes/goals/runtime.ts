import type { Process, Stage, WorkItem } from "../../domain.js";
import { GOALS_PROCESS_NAME, GOALS_STAGES } from "./index.js";

export function isGoalsProcess(process: Process | null | undefined): boolean {
  return process?.name.toLowerCase() === GOALS_PROCESS_NAME.toLowerCase();
}

export function goalStageForRun(process: Process, stage: Stage): string | undefined {
  return isGoalsProcess(process) ? stage.name : undefined;
}

export function goalPlanStages(
  process: Process
): { plan: Stage; work: Stage; waiting: Stage; review: Stage } | null {
  if (!isGoalsProcess(process)) return null;
  const plan = process.stages.find(({ name }) => name === GOALS_STAGES[0]);
  const work = process.stages.find(({ name }) => name === GOALS_STAGES[1]);
  const waiting = process.stages.find(({ name }) => name === GOALS_STAGES[2]);
  const review = process.stages.find(({ name }) => name === GOALS_STAGES[3]);
  return plan && work && waiting && review ? { plan, work, waiting, review } : null;
}

export function completedGoalsReadyForReview(
  items: WorkItem[],
  processes: Process[]
): Array<{ parent: WorkItem; review: Stage; logicalFiles: string[] }> {
  return items.flatMap((parent) => {
    const process = processes.find(({ id }) => id === parent.processId);
    if (!process || !isGoalsProcess(process)) return [];
    const waiting = process.stages.find(({ name }) => name === GOALS_STAGES[2]);
    const review = process.stages.find(({ name }) => name === GOALS_STAGES[3]);
    if (parent.stageId !== waiting?.id || !review || parent.status !== "open") return [];
    const children = items.filter(({ parentId }) => parentId === parent.id);
    return children.length > 0 && children.every(({ status }) => status === "done")
      ? [{ parent, review, logicalFiles: children.flatMap(({ logicalFiles }) => logicalFiles) }]
      : [];
  });
}
