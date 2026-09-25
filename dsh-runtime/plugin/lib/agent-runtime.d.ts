export declare function validateRunData(value: unknown): Record<string, unknown>;
export declare const LATEST_SOL_MODEL: "__bees_latest_sol__";
export declare const LATEST_LUNA_MODEL: "__bees_latest_luna__";
export declare const LATEST_TERRA_MODEL: "__bees_latest_terra__";
export declare function latestCodexModel<T extends { id: string }>(models: T[], family: string): T | undefined;
export declare function typedReferences(value: string): Array<{
  namespace: "@" | "$";
  label: string;
  kind: string;
  id: string;
}>;
export declare function safeRecoverySeed(events: Array<{ type: string; seq: number }>): Array<{ type: string; seq: number }>;
export declare function recoveryToolContext(events: Array<{ type: string; seq: number; data?: any }>, pending: any): string;
export declare function authorizeReferences(database: unknown, workspaceId: string, references: ReturnType<typeof typedReferences>): void;
export declare function copyOutputs(
  workspace: string,
  location: { id: string; name: string; localPath: string },
  executionId: string,
  paths?: string[]
): { files: number; bytes: number; destination: string; existing: boolean };

export declare class AgentRuntime {
  constructor(context: unknown, database: unknown, settings?: { get(): { systemInstructions?: string } } | null, notify?: (change: Record<string, unknown>) => void, subscribe?: ((listener: (change: Record<string, any>) => void) => () => void) | null, capabilities?: unknown | null);
  command?: (input: Record<string, unknown>) => Promise<unknown>;
  setProposalStore(store: (proposal: Record<string, unknown>) => unknown): void;
  setKnowledgeSearch(search: (query: string, workspaceId: string) => Promise<unknown[]>): void;
  setKnowledgeReader(read: (resultId: string, workspaceId: string) => unknown | Promise<unknown>): void;
  setSubitemStore(store: {
    create(input: Record<string, unknown>): Promise<Array<{ id: string }>>;
    revise?(input: Record<string, unknown>): Promise<{ id: string }>;
    cancel(workItemId: string): Promise<unknown>;
  }): void;
  setWorkStarter(start: (input: Record<string, unknown>) => unknown): void;
  onSessionEvent(session: { id: string }, event: { type: string; seq: number; data: Record<string, unknown> }): void;
  pendingInteraction(executionId: string): Record<string, unknown> | null;
  needsRecovery(executionId: string): boolean;
  admit(agentName: string, executionId: string, payload: Record<string, any>): Promise<any>;
  dispatch(agentName: string, executionId: string, payload: Record<string, any>): Promise<any>;
  resumeQueued(): void;
  executeStage(executionId: string, payload: Record<string, any>, signal?: AbortSignal): Promise<any>;
  waitForDelivery(executionId: string, submissionId: string, signal?: AbortSignal, durableWaits?: boolean): Promise<any>;
  waitForPeers(ids: string[], signal?: AbortSignal): Promise<Array<Record<string, unknown>>>;
  workResult(workItemId: string, evidenceOffset?: number): Promise<Record<string, unknown>>;
  reviewEvidence(executionId: string): Promise<Record<string, unknown>>;
  abort(executionId: string): boolean;
}
