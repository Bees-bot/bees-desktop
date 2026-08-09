import type { Process, Stage, TaskPlanRunContext, WorkItem } from "../../domain.js";
import { processEngine } from "../registry.js";

export function hasTaskPlanCapability(process: Process | null | undefined): process is Process {
  return Boolean(process && processEngine.capability(process, "task-plan"));
}

export function taskPlanContextForRun(
  process: Process,
  stage: Stage
): TaskPlanRunContext | undefined {
  const capability = processEngine.capability(process, "task-plan");
  return capability && processEngine.state(process, stage.id)
    ? {
      state: stage.id,
      output: capability.output,
      outputBlockedStates: [capability.stageIds.waiting, capability.stageIds.done]
    }
    : undefined;
}

export function taskPlanStages(
  process: Process
): { plan: Stage; work: Stage; waiting: Stage; review: Stage; done: Stage } | null {
  const capability = processEngine.capability(process, "task-plan");
  if (!capability) return null;
  const plan = processEngine.state(process, capability.stageIds.plan);
  const work = processEngine.state(process, capability.stageIds.work);
  const waiting = processEngine.state(process, capability.stageIds.waiting);
  const review = processEngine.state(process, capability.stageIds.review);
  const done = processEngine.state(process, capability.stageIds.done);
  return plan && work && waiting && review && done
    ? { plan, work, waiting, review, done }
    : null;
}

export function completedTaskPlanParentsReadyForReview(
  items: WorkItem[],
  processes: Process[]
): Array<{ parent: WorkItem; review: Stage; logicalFiles: string[] }> {
  return items.flatMap((parent) => {
    const process = processes.find(({ id }) => id === parent.processId);
    const states = process ? taskPlanStages(process) : null;
    if (!states || parent.stageId !== states.waiting.id || parent.archivedAt || parent.waits.some(({ resolvedAt }) => !resolvedAt)) return [];
    const children = items.filter(({ parentId }) => parentId === parent.id);
    return children.length > 0 && children.every(({ isTerminal }) => isTerminal)
      ? [{ parent, review: states.review, logicalFiles: children.flatMap(({ logicalFiles }) => logicalFiles) }]
      : [];
  });
}
