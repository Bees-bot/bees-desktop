export interface PinnedWorkContext {
  id: string;
  rootId: string;
  workItemId: string;
  executionId: string;
  version: number;
  content: Record<string, any>;
  scope: { stage: string; assignments: Array<{ id: string; title: string; requirements: string }>; producerInstructions: string };
  memories: Array<Record<string, any>>;
}
export declare class WorkContext {
  constructor(database: unknown, notify?: (event: Record<string, any>) => void);
  lineage(itemId: string): Array<Record<string, any>>;
  run(executionId: string): PinnedWorkContext | null;
  latest(itemId: string): PinnedWorkContext | null;
  pin(executionId: string, item: Record<string, any>, options?: Record<string, any>): PinnedWorkContext;
  setMemories(executionId: string, memories: Array<Record<string, any>>): void;
  updates(itemId: string, after?: number): { updates: Array<Record<string, any>>; next: number };
  post(itemId: string, update: Record<string, any>): { id: string; rootId: string };
  discussion(itemId: string, before?: number): Record<string, any>;
  view(itemId: string, executionId?: string, after?: number): Record<string, any>;
  prompt(executionId: string): string;
  findings(executionId: string, value: string): Array<Record<string, any>>;
  candidate(executionId: string): { artifactHash: string; directory: string | null; findings: string } | undefined;
  resultEvidence(executionId: string, data: Record<string, any>, workspace: string, result: Record<string, any>, findings: Array<Record<string, any>>): { artifactHash: string; directory: string | null };
  recordResult(executionId: string, data: Record<string, any>, result: Record<string, any>, findings: Array<Record<string, any>>, evidence: { artifactHash: string; directory: string | null }): void;
}
