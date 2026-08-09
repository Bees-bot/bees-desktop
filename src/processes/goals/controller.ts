import type { Execution, ExecutionOutput, Process, WorkItem } from "../../domain.js";
import { parseTaskPlan, type PlannedTask } from "./index.js";
import { processEngine } from "../registry.js";
import { taskPlanStages } from "./runtime.js";

export interface TaskPlanHost {
  findWorkItem(itemId: string): WorkItem | null;
  findProcess(processId: string): Process | null;
  readOutput(execution: Execution, output: ExecutionOutput, teamRoot: string): Promise<string>;
  approveTaskPlan(
    outputId: string,
    itemId: string,
    sourceStageId: string,
    workStageId: string,
    waitingStageId: string,
    reviewStageId: string,
    tasks: PlannedTask[]
  ): Promise<string[]>;
  workerRoles(): string[];
  syncCheckpoint(itemId: string): Promise<void>;
  finishOutputReview(execution: Execution): Promise<void>;
}

export class TaskPlanController {
  constructor(private readonly host: TaskPlanHost) {}

  matchesOutput(path: string, execution: Execution): boolean {
    const item = this.host.findWorkItem(execution.workItemId);
    const process = item ? this.host.findProcess(item.processId) : null;
    return Boolean(process && processEngine.capability(process, "task-plan")?.output === path);
  }

  async readTaskPlan(
    output: ExecutionOutput,
    execution: Execution,
    teamRoot: string
  ): Promise<PlannedTask[]> {
    return parseTaskPlan(await this.host.readOutput(execution, output, teamRoot));
  }

  async approveTaskPlan(
    output: ExecutionOutput,
    execution: Execution,
    teamRoot: string,
    selectedTasks?: PlannedTask[]
  ): Promise<number> {
    const item = this.host.findWorkItem(execution.workItemId);
    const process = item ? this.host.findProcess(item.processId) : null;
    const stages = process ? taskPlanStages(process) : null;
    if (!item || !stages) throw new Error("The task-plan process definition has changed");
    const tasks = selectedTasks ?? (await this.readTaskPlan(output, execution, teamRoot));
    const available = new Map(this.host.workerRoles().map((role) => [role.toLowerCase(), role]));
    const approved = tasks.map((task) => {
      const role = available.get(task.role.toLowerCase());
      if (!role) throw new Error(`Goal task role is unavailable: ${task.role}`);
      return { ...task, role };
    });
    const ids = await this.host.approveTaskPlan(
      output.id,
      item.id,
      item.stageId,
      stages.work.id,
      stages.waiting.id,
      stages.review.id,
      approved
    );
    await this.host.syncCheckpoint(item.id);
    await this.host.finishOutputReview(execution);
    return ids.length;
  }
}
