export declare function validateRunData(value: unknown): Record<string, unknown>;
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
  constructor(context: unknown, database: unknown);
  setProposalStore(store: (proposal: Record<string, unknown>) => unknown): void;
  onSessionEvent(session: { id: string }, event: { type: string; seq: number; data: Record<string, unknown> }): void;
  pendingApproval(executionId: string): Record<string, unknown> | null;
  admit(agentName: string, executionId: string, payload: Record<string, any>): Promise<any>;
  abort(executionId: string): boolean;
  purge(executionId: string): Promise<void>;
}
