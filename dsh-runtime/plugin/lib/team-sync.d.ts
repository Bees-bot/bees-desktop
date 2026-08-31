export interface TeamSyncRecord {
  recordType: string;
  recordId: string;
  version: number;
  deleted: boolean;
  payload: Record<string, any>;
}

export function teamRecords(database: any, organizationId: string, connectionId?: string): TeamSyncRecord[];
export function applyTeamRecords(database: any, organizationId: string, records: TeamSyncRecord[]): void;
export function syncTeamRecords(
  database: any,
  request: (path: string, options?: Record<string, any>) => Promise<any>,
  organizationId: string,
  connectionId: string
): Promise<{ pushed: number; pulled: number; cursor: string }>;
