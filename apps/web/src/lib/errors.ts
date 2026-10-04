import type { ApiErrorReason } from '@bali/shared';

import { ApiError, NetworkError } from './api-client';

/**
 * Over the API's budget (`429`, L1). The API's own message ("too many requests from this
 * account") is written for a log; this one says what to do, in the phone's words for the same
 * answer but the wait, which its `Retry-After` picks: the account's budget, which every route
 * spends, says a second at L1's sizes, so "a moment"; the guessing budgets wait longer (join
 * tries up to 30 s, join misses 10 s, invite tries a minute), so "a minute", the phone's words
 * (S4a, from T2's review).
 */
export const TOO_MANY_TRIES = 'Too many tries for now. Wait a moment, then try again.';
export const TOO_MANY_TRIES_MINUTE = 'Too many tries for now. Wait a minute, then try again.';

/** The longest `Retry-After`, in seconds, still said as "a moment". */
const A_MOMENT = 5;

/** A code that can't be an invite's (T2): said before it is sent, and if the redeem says so. */
export const NOT_AN_INVITE_CODE =
  'An invite code is 25 letters and digits, with no 0, O, 1, I or L. Check it against the one you were sent.';

/**
 * The refusals a person can act on, in their words (T2): keyed on the error's `reason`, never its
 * message, which is written for a log. Each says what happened and what to do next.
 */
const REFUSALS = new Map<string | undefined, string>(
  Object.entries({
    // POST /v1/teacher-invites/redeem (T1b): nothing was redeemed or changed by any of them.
    invite_code_invalid: NOT_AN_INVITE_CODE,
    invite_not_found:
      "That code doesn't match any invite. Check each letter and digit against the one you were sent.",
    invite_used: 'That code has already been used. Ask the person who sent it for a new one.',
    invite_expired:
      'Codes last 14 days, and this one has expired. Ask the person who sent it for a new one.',
    already_teacher: 'This account is already set up for teaching.',
    // The owner's ruling (2026-10-04): a separate account for teaching. The code is still good.
    student_in_class:
      'This account is a student in a class. Use a separate account for teaching, and enter your code there.',
    // Any mutation: its `event_id` already names another event (rule 4). Nothing was changed.
    event_id_conflict: "That didn't go through, so nothing changed. Try again.",
  } satisfies Partial<Record<ApiErrorReason, string>>),
);

/** A human-readable message for any thrown API/network error, safe to display. */
export function errText(e: unknown): string {
  if (e instanceof NetworkError) return e.message;
  if (e instanceof ApiError) {
    if (e.status === 429) {
      return (e.retryAfter ?? 0) > A_MOMENT ? TOO_MANY_TRIES_MINUTE : TOO_MANY_TRIES;
    }
    return REFUSALS.get(e.reason) ?? e.message;
  }
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}
