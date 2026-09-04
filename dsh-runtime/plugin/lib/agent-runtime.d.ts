export declare function validateRunData(value: unknown): Record<string, unknown>;
export declare const LATEST_SOL_MODEL: "__bees_latest_sol__";
export declare const LATEST_LUNA_MODEL: "__bees_latest_luna__";
export declare const LATEST_TERRA_MODEL: "__bees_latest_terra__";
export declare function latestCodexModel<T extends { id: string }>(models: T[], family: string): T | undefined;
export declare function latestSolModel<T extends { id: string }>(models: T[]): T | undefined;
export declare function typedReferences(value: string): Array<{
  namespace: "@" | "$";
  label: string;
  kind: string;
  id: string;
}>;
export declare function safeRecoverySeed(events: Array<{ type: string; seq: number }>): Array<{ type: string; seq: number }>;
export declare function authorizeReferences(database: unknown, workspaceId: string, references: ReturnType<typeof typedReferences>): void;
export declare function copyOutputs(
  workspace: string,
  location: { localPath: string },
  executionId: string
): { files: number; bytes: number; destination: string; existing: boolean };

export declare class AgentRuntime {
  constructor(context: unknown, database: unknown, settings?: { get(): { systemInstructions?: string } } | null, notify?: (change: Record<string, unknown>) => void, subscribe?: ((listener: (change: Record<string, any>) => void) => () => void) | null, capabilities?: unknown | null);
  command?: (input: Record<string, unknown>) => Promise<unknown>;
  setProposalStore(store: (proposal: Record<string, unknown>) => unknown): void;
  setKnowledgeSearch(search: (query: string, workspaceId: string) => Promise<unknown[]>): void;
  setKnowledgeReader(read: (resultId: string, workspaceId: string) => unknown | Promise<unknown>): void;
  setSubitemStore(store: {
    create(input: Record<string, unknown>): Promise<Array<{ id: string }>>;
    cancel(workItemId: string): Promise<unknown>;
  }): void;
  setWorkStarter(start: (input: Record<string, unknown>) => unknown): void;
  onSessionEvent(session: { id: string }, event: { type: string; seq: number; data: Record<string, unknown> }): void;
  pendingInteraction(executionId: string): Record<string, unknown> | null;
  pendingApproval(executionId: string): Record<string, unknown> | null;
  needsRecovery(executionId: string): boolean;
  admit(agentName: string, executionId: string, payload: Record<string, any>): Promise<any>;
  dispatch(agentName: string, executionId: string, payload: Record<string, any>): Promise<any>;
  resumeQueued(): void;
  executeStage(executionId: string, payload: Record<string, any>, signal?: AbortSignal): Promise<any>;
  waitForPeers(ids: string[], signal?: AbortSignal): Promise<Array<Record<string, unknown>>>;
  reviewEvidence(executionId: string): Promise<Record<string, unknown>>;
  abort(executionId: string): boolean;
  purge(executionId: string): Promise<void>;
}
