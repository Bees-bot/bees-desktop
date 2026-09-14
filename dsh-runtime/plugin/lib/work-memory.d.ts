export declare class WorkMemory {
  constructor(database: unknown, credentials: unknown, fetcher?: typeof fetch);
  settings(workspaceId: string): { url: string; enabled: boolean; status: string; bank: string };
  configure(workspaceId: string, input: Record<string, any>): Promise<Record<string, any>>;
  request(workspaceId: string, suffix: string, method?: string, body?: unknown): Promise<Record<string, any>>;
  recall(workspaceId: string, query: string): Promise<Array<Record<string, any>>>;
  remember(workspaceId: string, content: string, evidence: string, id?: string): { id: string };
  flush(workspaceId: string): Promise<void>;
  command(action: string, input: Record<string, any>): Promise<Record<string, any>>;
}
