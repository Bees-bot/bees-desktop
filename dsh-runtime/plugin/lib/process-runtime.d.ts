export declare class ProcessRuntime {
  constructor(database: unknown);
  schedules(workspaceId: string, targetKind: "process" | "work_item", targetId: string): any[];
  allSchedules(workspaceIds: string[]): any[];
  state(workspaceId: string, workItemId: string): any;
  scheduleCommand(workspaceId: string, targetKind: "process" | "work_item", targetId: string, command: Record<string, unknown>): any;
  command(workspaceId: string, workItemId: string, command: Record<string, unknown>): any;
  catchUpAll(now?: number): any[];
}
