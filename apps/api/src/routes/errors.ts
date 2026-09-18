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
  INVALID_EXTENSION: () => ApiError.badInput('new end time must be later than the current one'),
  CLASS_NOT_FOUND: () => ApiError.notFound('no class with that join code'),
  ENROLLMENT_NOT_FOUND: () => ApiError.notFound('enrollment not found'),
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
