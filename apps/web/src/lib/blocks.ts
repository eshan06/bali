import type { BlockDetail } from '@bali/shared';

import { type ApiClient, ApiError, NetworkError } from './api-client';
import { BLOCK_TAKEN, CANT_REACH, CANT_REGISTER, errText, NOT_A_BLOCK_ID } from './errors';

/* The block section's logic (P3), tested: the ID's check before sending, and the register. */

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
  /** No answer to go by (unreachable, a timeout, a 5xx, over the budget): Try again resends it. */
  | { kind: 'failed'; message: string };

/**
 * Register `tagId` (`POST /v1/blocks`). The route takes no `eventId`: it is idempotent on the tag
 * itself, as a resend of one's own tag hands back the same block, so any failure may be sent again
 * as it was. `owned` is what the section lists, to tell a block that was the teacher's already.
 */
export async function registerBlock(
  api: Pick<ApiClient, 'post'>,
  tagId: string,
  owned: readonly BlockDetail[],
): Promise<RegisterAnswer> {
  try {
    const block = await api.post<BlockDetail>('/v1/blocks', { tagId });
    return { kind: 'registered', block, already: owned.some((b) => b.id === block.id) };
  } catch (e) {
    if (e instanceof NetworkError) return { kind: 'failed', message: CANT_REACH };
    if (!(e instanceof ApiError)) throw e;
    // The route's one 409 and its one 400: another teacher's tag, and an ID it can't take.
    if (e.status === 409) return { kind: 'refused', message: BLOCK_TAKEN };
    if (e.status === 400) return { kind: 'refused', message: NOT_A_BLOCK_ID };
    if (e.status >= 500 || e.status === 408) return { kind: 'failed', message: CANT_REGISTER };
    return { kind: 'failed', message: errText(e) };
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
