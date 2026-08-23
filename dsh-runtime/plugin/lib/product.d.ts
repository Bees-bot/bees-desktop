export function initializeProductDatabase(database: any): void;
export class BeesProduct {
  constructor(database: any, agents: any, processes: any, defaultWorkspace: string, services?: Record<string, any>);
  initialize(): Promise<void>;
  createSubitems(input: { parentId: string; items: Array<{ title: string; description?: string }> }): Promise<any[]>;
  runProcessStage(stage: Record<string, any>, signal?: AbortSignal): Promise<any>;
  snapshot(): Promise<any>;
  references(query: string, workspaceId: string): Promise<any>;
  search(query: string, workspaceId: string): any[];
  audit(): any[];
  runHistory(executionId: string): Promise<any>;
  storeProposal(input: Record<string, any>): any;
  command(input: Record<string, any>): Promise<any>;
}
