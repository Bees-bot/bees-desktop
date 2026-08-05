import { assertMetadataOnly } from "./domain.js";
import type { LocalRepository } from "./repository.js";

export interface SyncRecord {
  recordType: string;
  recordId: string;
  version: number;
  deleted: boolean;
  payload: Record<string, unknown>;
}

export interface SyncTransport {
  push(organizationId: string, records: SyncRecord[]): Promise<{ cursor: string }>;
  pull(
    organizationId: string,
    cursor: string | null
  ): Promise<{ cursor: string; records: SyncRecord[] }>;
}

export class HttpSyncTransport implements SyncTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly organizationHeader: string,
    // Bearer token for the signed-in user (desktop auth is token-based, not cookies).
    private readonly getToken: () => string | null = () => null,
    private readonly request: typeof fetch = fetch.bind(globalThis)
  ) {}

  async push(organizationId: string, records: SyncRecord[]): Promise<{ cursor: string }> {
    return this.send("/api/sync/push", organizationId, { records });
  }

  async pull(
    organizationId: string,
    cursor: string | null
  ): Promise<{ cursor: string; records: SyncRecord[] }> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return this.send(`/api/sync/pull${query}`, organizationId);
  }

  private async send<T>(
    path: string,
    organizationId: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const token = this.getToken();
    const response = await this.request(`${this.baseUrl}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        [this.organizationHeader]: organizationId,
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) {
      throw new Error(`Sync request failed with ${response.status}`);
    }
    return (await response.json()) as T;
  }
}

export class MetadataSyncService {
  constructor(
    private readonly repository: LocalRepository,
    private readonly transport: SyncTransport
  ) {}

  async synchronize(organizationId: string, teamId: string): Promise<number> {
    const projection = await this.repository.coordinationProjection(teamId);
    projection.forEach((record) => assertMetadataOnly(record.payload));
    const pushed = await this.transport.push(organizationId, projection);
    const currentCursor = (await this.repository.syncCursor()) ?? pushed.cursor;
    const pulled = await this.transport.pull(organizationId, currentCursor);
    const ordered = [...pulled.records].sort(
      (a, b) =>
        ["file_location", "process", "stage", "work_item"].indexOf(a.recordType) -
        ["file_location", "process", "stage", "work_item"].indexOf(b.recordType)
    );
    for (const record of ordered) {
      assertMetadataOnly(record.payload);
      await this.repository.applyCoordinationRecord(record);
    }
    await this.repository.completeSyncEntries([], pulled.cursor);
    return ordered.length;
  }
}
