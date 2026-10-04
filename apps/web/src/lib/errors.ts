import { ApiError, NetworkError } from './api-client';

/**
 * Over the API's budget (`429`, L1). The API's own message ("too many requests from this
 * account") is written for a log; this one says what to do, in the phone's words for the same
 * answer but the wait: every route the portal calls spends the account's budget, whose
 * `Retry-After` is a second at L1's sizes, so "a moment", not the phone's "a minute" (R4's review).
 */
export const TOO_MANY_TRIES = 'Too many tries for now. Wait a moment, then try again.';

/** A human-readable message for any thrown API/network error, safe to display. */
export function errText(e: unknown): string {
  if (e instanceof NetworkError) return e.message;
  if (e instanceof ApiError) return e.status === 429 ? TOO_MANY_TRIES : e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}
