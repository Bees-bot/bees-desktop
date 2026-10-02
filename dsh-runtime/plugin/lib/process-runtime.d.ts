export declare const PROCESS_TASK_QUEUE = "bees-processes-v1";
export declare function processWorkflowId(workItemId: string): string;
export declare function recurringScheduleId(recurringWorkId: string, accountUserId?: string): string;

export declare class ProcessRuntime {
  constructor(database: any, options?: {
    client?: any; logger?: any; workerFactory?: (options: any) => Promise<any>; claims?: any;
    notify?: (change: Record<string, unknown>) => void;
    abortAgent?: (executionId: string) => unknown;
    stopAgents?: (workItemIds: string[]) => Promise<void>;
    needsRecovery?: (executionId: string) => boolean;
    pendingInteraction?: (executionId: string) => unknown;
    canStart?: (workItemId: string) => Promise<{ ready: boolean; reason?: string }> | { ready: boolean; reason?: string };
  });
  item(workItemId: string): any;
  stages(processId: string): any[];
  input(workItemId: string): any;
  isAutomatic(processId: string): boolean;
  start(runStage: (stage: any, signal?: AbortSignal) => Promise<any>): Promise<void>;
  recurring(recurringWorkId: string, accountUserId?: string): any;
  scheduleSpec(recurring: any): any;
  createRecurring(recurringWorkId: string): Promise<any>;
  updateRecurring(recurringWorkId: string): Promise<any>;
  setRecurringPaused(recurringWorkId: string, paused: boolean): Promise<void>;
  createRecurringWorkItem(recurringWorkId: string, occurrenceAt?: string, accountUserId?: string): Promise<any>;
  close(): Promise<void>;
  reconcile(): Promise<void>;
  reconcileSchedules(): Promise<void>;
  wakeStage(executionId: string): Promise<void>;
  startItem(workItemId: string, options?: { explicit?: boolean; continueWork?: boolean }): Promise<any>;
  relinquish(workItemId: string, saveCheckpoint: (checkpoints: any[]) => Promise<void>, checkFiles?: () => unknown): Promise<any>;
  restartItem(workItemId: string, text: string, requestId: string): Promise<any>;
  reviseItem(workItemId: string, feedback: string, requestId: string, signal?: AbortSignal): Promise<{ id: string }>;
  resolveFailedItem(workItemId: string, reason: string, requestId: string, replacementWorkItemId?: string | null, signal?: AbortSignal): Promise<{ id: string; action: string; replacementWorkItemId: string | null }>;
  signal(workItemId: string, type: "pause" | "resume" | "retry" | "cancel"): Promise<any>;
  archive(workItemId: string, restore?: boolean): Promise<any>;
  project(state: any): any;
}
