export declare class AgentCapacityError extends Error {}
export declare function resolveStageAgent(database: any, input: {
  executionId: string;
  item: any;
  stageId: string;
  purpose: "worker" | "reviewer";
  candidateExecutionId?: string;
}): any;
