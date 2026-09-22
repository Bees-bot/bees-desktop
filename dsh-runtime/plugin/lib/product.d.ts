export function initializeProductDatabase(database: any): void;
export class BeesProduct {
  constructor(database: any, agents: any, processes: any, defaultWorkspace: string, services?: Record<string, any>);
  initialize(): Promise<void>;
  recoverRuns(): Promise<void>;
  canStartItem(workItemId: string): Promise<{ ready: boolean; reason?: string }>;
  runProcessStage(stage: Record<string, any>, signal?: AbortSignal): Promise<any>;
  snapshot(): Promise<any>;
  references(query: string, workspaceId: string): Promise<any>;
  search(query: string, workspaceId: string): Promise<any[]>;
  readKnowledge(resultId: string, workspaceId: string): any;
  audit(): any[];
  runHistory(executionId: string): Promise<any>;
  locationFile(locationId: string, filePath?: string): any;
  runFile(executionId: string, filePath: string, native: true): { sessionId: string; status: string; path: string };
  runFile(executionId: string, filePath: string, native?: false): {
    name: string; path: string; format: "markdown" | "text"; content: string; size: number; truncated: boolean;
  };
  storeProposal(input: Record<string, any>): any;
  createSubitems(input: { parentId: string; executionId?: string; items: Array<{ title: string; description?: string; agentAssignmentId?: string }> }): Promise<any[]>;
  startWork(input: Record<string, any>): Promise<any>;
  command(input: Record<string, any>): Promise<any>;
}
