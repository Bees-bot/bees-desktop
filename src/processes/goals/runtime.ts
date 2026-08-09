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
  const state = capability && processEngine.state(process, stage.id)?.key;
  return capability && state
    ? {
      state,
      output: capability.output,
      outputBlockedStates: [capability.states.waiting, capability.states.done]
    }
    : undefined;
}

export function taskPlanStages(
  process: Process
): { plan: Stage; work: Stage; waiting: Stage; review: Stage; done: Stage } | null {
  const capability = processEngine.capability(process, "task-plan");
  if (!capability) return null;
  const stage = (key: string): Stage | undefined => {
    const state = processEngine.stateByKey(process, key);
    return state && process.stages.find(({ id }) => id === state.stageId);
  };
  const plan = stage(capability.states.plan);
  const work = stage(capability.states.work);
  const waiting = stage(capability.states.waiting);
  const review = stage(capability.states.review);
  const done = stage(capability.states.done);
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
    if (!states || parent.stageId !== states.waiting.id || parent.status !== "open") return [];
    const children = items.filter(({ parentId }) => parentId === parent.id);
    return children.length > 0 && children.every(({ status }) => status === "done")
      ? [{ parent, review: states.review, logicalFiles: children.flatMap(({ logicalFiles }) => logicalFiles) }]
      : [];
  });
}
