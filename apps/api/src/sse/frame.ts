import type { FeedEventRow } from '@bali/db';
import type { FeedEvent } from '@bali/shared';

/** One event as the catch-up page and the live stream both serialize it. */
export function toFeedEvent(e: FeedEventRow): FeedEvent {
  return {
    seq: e.seq,
    eventId: e.eventId,
    type: e.type,
    userId: e.userId,
    occurredAt: e.occurredAt.toISOString(),
    payload: e.payload,
  };
}

/**
 * An SSE frame for one event: the seq goes in `id:` (so a reconnecting client
 * resumes from it) and the FeedEvent JSON in `data:`. A blank line terminates
 * the event. `data` is single-line JSON, so no embedded newline can split it.
 */
export function frameFor(e: FeedEventRow): string {
  return `id: ${e.seq}\ndata: ${JSON.stringify(toFeedEvent(e))}\n\n`;
}
