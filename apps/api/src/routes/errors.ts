import { TransitionError, type TransitionErrorCode } from '@bali/db';
import type { ApiErrorCode, ApiErrorReason } from '@bali/shared';

import { ApiError } from '../errors.js';

/*
 * Translate the transition engine's domain refusals into the API error shape.
 * Kept at the route boundary so the engine stays transport-agnostic. Each
 * refusal carries its own `reason` (A5): one status can mean several of them —
 * a refocus's 409 is any of four — and the phone shows each differently.
 */
const REFUSALS: Record<
  TransitionErrorCode,
  [code: ApiErrorCode, reason: ApiErrorReason, message: string]
> = {
  SESSION_NOT_FOUND: ['not_found', 'session_not_found', 'session not found'],
  // The session isn't accepting changes (already ended) — a state conflict, not bad input.
  SESSION_NOT_RUNNING: ['conflict', 'session_not_running', 'session has ended'],
  NOT_PARTICIPATING: ['conflict', 'not_participating', 'not in this session'],
  // The route never computes an end time (it sends a duration), so the engine
  // raises this only for a duration it cannot use: non-positive, non-finite, or
  // past the Date range.
  INVALID_EXTENSION: ['bad_input', 'invalid_extension', 'invalid extension duration'],
  // The client reused an event_id that already belongs to a different event, so
  // the write cannot be made idempotently — a conflict, and never silent.
  EVENT_ID_CONFLICT: ['conflict', 'event_id_conflict', 'event_id already used by another event'],
  CLASS_NOT_FOUND: ['not_found', 'class_not_found', 'no class with that join code'],
  ENROLLMENT_NOT_FOUND: ['not_found', 'enrollment_not_found', 'enrollment not found'],
  // Refocus out of protection off: the shields are gone, so only a re-tap
  // (which re-shields) may return the student to focus.
  PROTECTION_OFF: [
    'conflict',
    'protection_off',
    'Screen Time permission is off: tap the block to rejoin',
  ],
};

/**
 * The error for an engine refusal — also for a route that finds the same
 * condition itself, so one condition never reaches a client in two shapes.
 */
export function refusal(code: TransitionErrorCode): ApiError {
  const [apiCode, reason, message] = REFUSALS[code];
  return new ApiError(apiCode, message, undefined, reason);
}

/** Run `fn`, converting any TransitionError into the matching ApiError. */
export async function mapTransitionError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TransitionError) {
      throw refusal(err.code);
    }
    throw err;
  }
}
