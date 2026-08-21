export declare class ProcessRuntime {
  constructor(database: unknown);
  state(organizationId: string, workItemId: string): Record<string, unknown>;
  command(organizationId: string, workItemId: string, command: Record<string, unknown>): Record<string, unknown>;
  catchUpAll(): void;
}
