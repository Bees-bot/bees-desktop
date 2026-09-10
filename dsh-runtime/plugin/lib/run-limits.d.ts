export interface RunLimitOptions {
  maxRequests: number;
  maxTokens: number;
  reserveOutputTokens: number;
}
export interface RunLimitUsage {
  rootId: string;
  requests: number;
  tokens: number;
  reservedTokens: number;
}
export interface RunLimitSession {
  id: string;
  header?: { parentSession?: string };
}
export interface RunLimitRequest {
  sessionId?: string;
  messages?: unknown[];
  system?: string;
  tools?: unknown[];
  maxTokens?: number;
}
export declare const RUN_LIMIT_CODE: "BEES_RUN_LIMIT_EXCEEDED";
export declare const DEFAULT_RUN_LIMITS: Readonly<RunLimitOptions>;
export declare function processedTokens(usage: unknown): number | null;
export declare function estimateRequestTokens(options: RunLimitRequest): number;
export declare class RunLimits {
  constructor(database: unknown, limits?: Partial<RunLimitOptions>);
  readonly limits: RunLimitOptions;
  rootForSession(sessionId: string, executionId?: string | null): string | null;
  bind(sessionId: string, rootId: string): void;
  observeSession(session: RunLimitSession, executionId?: string | null): string | null;
  usage(rootId: string): RunLimitUsage;
  reserve(rootId: string, sessionId: string, tokens: number): string | null;
  stream(options: RunLimitRequest, next: () => AsyncIterable<any>): AsyncGenerator<any>;
}
