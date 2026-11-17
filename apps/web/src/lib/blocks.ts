import type { BlockDetail, BlockListResponse, RemoveBlockResponse } from '@bali/shared';

import { type ApiClient, ApiError, NetworkError, SAVE_TIMEOUT_MS } from './api-client';
import {
  BLOCK_NOT_REMOVED,
  BLOCK_TAKEN,
  CANT_REACH,
  CANT_REGISTER,
  CANT_REMOVE_BLOCK,
  errText,
  NOT_A_BLOCK_ID,
} from './errors';
import { newEventId } from './event-id';

/*
 * The block section's logic (P3), tested: the ID's check before sending, the register, and since
 * LO11 a lost block's removal.
 */

/**
 * The ID written on a block, as the phone reads it off the tag (BaliCore's `BlockTag.code`): ten
 * ASCII letters and digits, sent upper-case. Typed in any case, with any spaces; null: not one.
 */
export function blockIdOf(typed: string): string | null {
  const id = typed.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{10}$/.test(id) ? id : null;
}

/** The register's answer, as the section acts on it. */
export type RegisterAnswer =
  /** The block is the teacher's: just now, or already (a lost answer's retry, or a re-type). */
  | { kind: 'registered'; block: BlockDetail; already: boolean }
  /** Refused, nothing changed: the ID is the thing to put right. */
  | { kind: 'refused'; message: string }
  /** Refused for the account, never the ID (a deleted one, C3): nothing to put right or resend. */
  | { kind: 'final'; message: string }
  /** No answer to go by (unreachable, a timeout, a 5xx, over the budget): Try again resends it. */
  | { kind: 'failed'; message: string };

/**
 * Register `tagId` (`POST /v1/blocks`). The route takes no `eventId`: it is idempotent on the tag
 * itself, as a resend of one's own tag hands back the same block, so any failure may be sent again
 * as it was, one with no answer within a save's limit too. `owned` is what the section lists, to
 * tell a block that was the teacher's already.
 */
export async function registerBlock(
  api: Pick<ApiClient, 'post'>,
  tagId: string,
  owned: readonly BlockDetail[],
): Promise<RegisterAnswer> {
  try {
    const block = await api.post<BlockDetail>('/v1/blocks', { tagId }, SAVE_TIMEOUT_MS);
    return { kind: 'registered', block, already: owned.some((b) => b.id === block.id) };
  } catch (e) {
    if (e instanceof NetworkError) return { kind: 'failed', message: CANT_REACH };
    // The route's 409s and its one 400: another teacher's tag, an account deleted on its way (said
    // as errText says it, the ID being fine), and an ID it can't take.
    if (e instanceof ApiError && e.status === 409) {
      return e.reason === undefined
        ? { kind: 'refused', message: BLOCK_TAKEN }
        : { kind: 'final', message: errText(e) };
    }
    if (e instanceof ApiError && e.status === 400) {
      return { kind: 'refused', message: NOT_A_BLOCK_ID };
    }
    if (e instanceof ApiError && e.status === 429) return { kind: 'failed', message: errText(e) };
    // Anything else (a 5xx, a timeout, a body that isn't JSON) is answered too, never thrown, so
    // the form always comes back with words and Try again.
    return { kind: 'failed', message: CANT_REGISTER };
  }
}

/** One removal (LO10b's `DELETE /v1/blocks/{id}`): the block, and the `eventId` it is sent under. */
export interface RemoveAttempt {
  blockId: string;
  eventId: string;
}

/**
 * The removal of `blockId` whose answer never came, sent again under its id: it may have landed,
 * and the route answers its resend `replay`, writing nothing twice. Else a fresh one.
 */
export const removeAttemptFor = (
  unanswered: RemoveAttempt | null,
  blockId: string,
  mint = newEventId,
): RemoveAttempt => (unanswered?.blockId === blockId ? unanswered : { blockId, eventId: mint() });

/** A removal's answer, as the section acts on it. */
export type RemoveAnswer =
  /** Gone: removed now, or already (`replay`: this removal's lost answer, or another tab's). */
  | { kind: 'removed' }
  /** Refused, nothing removed: a resend under this id would be refused the same way. */
  | { kind: 'refused'; message: string }
  /** No answer to go by (unreachable, a timeout, a 5xx, over the budget): sent again under its id. */
  | { kind: 'failed'; message: string };

/**
 * Remove a lost block (`DELETE /v1/blocks/{id}`, LO10b), within a save's limit: its code is free
 * from then on for anyone to register again. `removed` and `replay` both mean it is gone, so both
 * are `removed` here. Never thrown, so the confirm always comes back with words.
 */
export async function removeBlock(
  api: Pick<ApiClient, 'del'>,
  attempt: RemoveAttempt,
): Promise<RemoveAnswer> {
  try {
    await api.del<RemoveBlockResponse>(
      `/v1/blocks/${attempt.blockId}`,
      { eventId: attempt.eventId },
      SAVE_TIMEOUT_MS,
    );
    return { kind: 'removed' };
  } catch (e) {
    if (e instanceof NetworkError) return { kind: 'failed', message: CANT_REACH };
    if (e instanceof ApiError && e.status === 429) return { kind: 'failed', message: errText(e) };
    // A refusal (a 4xx but 408): nothing was removed. An id another removal holds says so in its own
    // words; the rest (another account's block, one Bali has no record of) send the teacher to the
    // blocks as Bali holds them.
    if (e instanceof ApiError && e.status < 500 && e.status !== 408) {
      return {
        kind: 'refused',
        message: e.reason === 'event_id_conflict' ? errText(e) : BLOCK_NOT_REMOVED,
      };
    }
    // A 5xx, a timeout's 408, a body that isn't JSON: answered too, Try again sending it again.
    return { kind: 'failed', message: CANT_REMOVE_BLOCK };
  }
}

/**
 * The teacher's blocks as Bali holds them now (`GET /v1/blocks`), read once a confirm closes on a
 * removal whose answer never came, which may have landed: null when the read fails, never thrown.
 */
export async function blocksNow(api: Pick<ApiClient, 'get'>): Promise<BlockDetail[] | null> {
  try {
    const { blocks } = await api.get<BlockListResponse>('/v1/blocks');
    return Array.isArray(blocks) ? blocks : null;
  } catch {
    return null;
  }
}

/**
 * What to add to "Couldn't load your blocks." for `e`, the list's failure: the connection, or the
 * budget's wait, in their words; nothing for anything else, whose message is written for a log.
 */
export function loadProblem(e: unknown): string | null {
  if (e instanceof NetworkError) return CANT_REACH;
  if (e instanceof ApiError && e.status === 429) return errText(e);
  return null;
}
