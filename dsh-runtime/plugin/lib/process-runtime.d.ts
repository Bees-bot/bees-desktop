export declare const PROCESS_TASK_QUEUE = "bees-processes-v1";
export declare function processWorkflowId(workItemId: string): string;
export declare function recurringScheduleId(recurringWorkId: string): string;

export declare class ProcessRuntime {
  constructor(database: any, options?: { client?: any; logger?: any; workerFactory?: (options: any) => Promise<any> });
  item(workItemId: string): any;
  stages(processId: string): any[];
  input(workItemId: string): any;
  isAutomatic(processId: string): boolean;
  start(runStage: (stage: any, signal?: AbortSignal) => Promise<any>): Promise<void>;
  recurring(recurringWorkId: string): any;
  scheduleSpec(recurring: any): any;
  createRecurring(recurringWorkId: string): Promise<any>;
  updateRecurring(recurringWorkId: string): Promise<any>;
  setRecurringPaused(recurringWorkId: string, paused: boolean): Promise<void>;
  deleteRecurring(recurringWorkId: string): Promise<void>;
  createRecurringWorkItem(recurringWorkId: string): any;
  close(): Promise<void>;
  reconcile(): Promise<void>;
  startItem(workItemId: string): Promise<any>;
  signal(workItemId: string, type: "pause" | "resume" | "retry" | "cancel"): Promise<any>;
  move(workItemId: string, targetStageId: string): any;
  archive(workItemId: string, restore?: boolean): Promise<any>;
  project(state: any): any;
}
