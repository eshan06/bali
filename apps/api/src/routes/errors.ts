import { TransitionError, type TransitionErrorCode } from '@bali/db';

import { ApiError } from '../errors.js';

/*
 * Translate the transition engine's domain refusals into the API error shape.
 * Kept at the route boundary so the engine stays transport-agnostic.
 */
const STATUS_BY_CODE: Record<TransitionErrorCode, () => ApiError> = {
  SESSION_NOT_FOUND: () => ApiError.notFound('session not found'),
  // The session isn't accepting changes (already ended) — a state conflict, not bad input.
  SESSION_NOT_RUNNING: () => ApiError.conflict('session has ended'),
  NOT_PARTICIPATING: () => ApiError.conflict('not in this session'),
  // The route never computes an end time (it sends a duration), so the engine
  // raises this only for a duration it cannot use: non-positive, non-finite, or
  // past the Date range.
  INVALID_EXTENSION: () => ApiError.badInput('invalid extension duration'),
  // The client reused an event_id that already belongs to a different event, so
  // the write cannot be made idempotently — a conflict, and never silent.
  EVENT_ID_CONFLICT: () => ApiError.conflict('event_id already used by another event'),
  CLASS_NOT_FOUND: () => ApiError.notFound('no class with that join code'),
  ENROLLMENT_NOT_FOUND: () => ApiError.notFound('enrollment not found'),
  // Refocus out of protection off: the shields are gone, so only a re-tap
  // (which re-shields) may return the student to focus.
  PROTECTION_OFF: () => ApiError.conflict('Screen Time permission is off: tap the block to rejoin'),
};

/** Run `fn`, converting any TransitionError into the matching ApiError. */
export async function mapTransitionError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TransitionError) {
      throw STATUS_BY_CODE[err.code]();
    }
    throw err;
  }
}
