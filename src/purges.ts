import type { ConversationPurge } from "./domain.js";
import { errorText } from "./domain.js";

export interface PurgeRepository {
  listPendingConversationPurges(limit?: number): Promise<ConversationPurge[]>;
  completeConversationPurge(conversationId: string): Promise<void>;
  recordConversationPurgeFailure(conversationId: string, error: string): Promise<void>;
}

export interface ConversationPurger {
  purgeConversation(agentName: string, conversationId: string): Promise<void>;
}

export interface PurgeReport {
  purged: number;
  pending: number;
  lastError: string | null;
}

/**
 * Drains queued conversation purges. DSH 2 has no delete route yet, so today every attempt
 * fails and every tombstone survives — which is the point: a run is reported deleted only
 * once its conversation is really gone. Retry on startup and after each settled run; when
 * the runtime grows the route, the backlog clears itself with no migration.
 *
 * ponytail: retries are unbounded and unthrottled because the queue only grows on an
 * explicit user delete. Add backoff if a permanently unpurgeable conversation ever appears.
 */
export async function drainConversationPurges(
  repository: PurgeRepository,
  purger: ConversationPurger,
  limit = 50
): Promise<PurgeReport> {
  const pending = await repository.listPendingConversationPurges(limit);
  let purged = 0;
  let lastError: string | null = null;
  for (const { conversationId, agentName } of pending) {
    try {
      await purger.purgeConversation(agentName, conversationId);
      await repository.completeConversationPurge(conversationId);
      purged += 1;
    } catch (error) {
      lastError = errorText(error);
      await repository.recordConversationPurgeFailure(conversationId, lastError);
    }
  }
  return { purged, pending: pending.length - purged, lastError };
}

/**
 * What to tell the user after a delete. Never says "deleted" while conversation data is
 * still in the runtime — the plan's rule that only the Bees row went is not a deletion.
 */
export function purgeNotice({ pending }: PurgeReport): string {
  if (!pending) return "Run deleted";
  return pending === 1
    ? "Bees removed its record. The agent conversation could not be deleted yet and will be retried."
    : `Bees removed its records. ${pending} agent conversations could not be deleted yet and will be retried.`;
}
