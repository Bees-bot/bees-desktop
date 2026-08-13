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
    const scope = `coordination:${organizationId}`;
    const currentCursor = (await this.repository.syncCursor(scope)) ?? "0";
    const projection = await this.repository.coordinationProjection(teamId);
    projection.forEach((record) => assertMetadataOnly(record.payload));
    await this.transport.push(organizationId, projection);
    const pulled = await this.transport.pull(organizationId, currentCursor);
    // The response is parsed JSON from the network, so it is checked rather than trusted: a 200
    // carrying an error envelope has no `records`, and spreading undefined threw before the
    // cursor could move — the same batch then failed on every later attempt.
    const records = Array.isArray(pulled?.records) ? pulled.records : [];
    const cursor = typeof pulled?.cursor === "string" ? pulled.cursor : currentCursor;
    const ordered = [...records].sort(
      (a, b) =>
        ["file_location", "process", "stage", "work_item"].indexOf(a.recordType) -
        ["file_location", "process", "stage", "work_item"].indexOf(b.recordType)
    );
    /*
     * One record at a time, each on its own. A single unusable record — two work items colliding
     * on the goal-key index, a payload missing a required field — used to abort the loop before
     * `completeSyncEntries` ran, so the cursor never advanced and the next sync pulled the same
     * poison batch. That is unrecoverable without hand-editing the database, and it gets worse
     * the longer it runs. Skipping the record and advancing costs one row; stopping costs sync.
     */
    let applied = 0;
    const skipped: string[] = [];
    for (const record of ordered) {
      try {
        assertMetadataOnly(record.payload);
        await this.repository.applyCoordinationRecord(record);
        applied += 1;
      }
      catch (error) {
        skipped.push(`${record.recordType}:${record.recordId} (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    if (skipped.length)
      console.warn(`Sync skipped ${skipped.length} unusable record(s): ${skipped.join("; ")}`);
    await this.repository.completeSyncEntries([], cursor, scope);
    return applied;
  }
}
