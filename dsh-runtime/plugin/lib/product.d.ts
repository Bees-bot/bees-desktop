export function initializeProductDatabase(database: any): void;
export class BeesProduct {
  constructor(database: any, agents: any, processes: any, defaultWorkspace: string, services?: Record<string, any>);
  initialize(): Promise<void>;
  snapshot(): Promise<any>;
  references(query: string, workspaceId: string): Promise<any>;
  search(query: string, workspaceId: string): any[];
  audit(): any[];
  runHistory(executionId: string): Promise<any>;
  storeProposal(input: Record<string, any>): any;
  command(input: Record<string, any>): Promise<any>;
}
