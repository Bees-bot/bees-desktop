import type { Execution, ExecutionOutput, Process, WorkItem } from "../../domain.js";
import { parseTaskPlan, TASK_PLAN_OUTPUT, type PlannedTask } from "./index.js";
import { goalPlanStages } from "./runtime.js";

export interface GoalsHost {
  findWorkItem(itemId: string): WorkItem | null;
  findProcess(processId: string): Process | null;
  readOutput(execution: Execution, output: ExecutionOutput, teamRoot: string): Promise<string>;
  approveTaskPlan(
    outputId: string,
    itemId: string,
    planStageId: string,
    waitingStageId: string,
    tasks: PlannedTask[]
  ): Promise<void>;
  syncCheckpoint(itemId: string): Promise<void>;
  finishOutputReview(execution: Execution): Promise<void>;
}

export class GoalsController {
  constructor(private readonly host: GoalsHost) {}

  matchesOutput(path: string): boolean {
    return path === TASK_PLAN_OUTPUT;
  }

  async approveTaskPlan(
    output: ExecutionOutput,
    execution: Execution,
    teamRoot: string
  ): Promise<number> {
    const item = this.host.findWorkItem(execution.workItemId);
    const process = item ? this.host.findProcess(item.processId) : null;
    const stages = process ? goalPlanStages(process) : null;
    if (!item || !stages) throw new Error("The Goals process definition has changed");
    const tasks = parseTaskPlan(await this.host.readOutput(execution, output, teamRoot));
    await this.host.approveTaskPlan(
      output.id,
      item.id,
      stages.plan.id,
      stages.waiting.id,
      tasks
    );
    await this.host.syncCheckpoint(item.id);
    await this.host.finishOutputReview(execution);
    return tasks.length;
  }
}
