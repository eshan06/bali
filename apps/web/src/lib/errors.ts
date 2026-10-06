import { type ApiErrorReason, MAX_SESSION_MINUTES } from '@bali/shared';

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

/** A block's ID (P3): said before it is sent, and if the register refuses it. */
export const NOT_A_BLOCK_ID =
  'A block ID is 10 letters and digits. Check it against the one written on your block.';

/** `POST /v1/blocks`'s one 409 (P3): a live block of another teacher's holds the tag. */
export const BLOCK_TAKEN =
  'That block is registered to another teacher. If the ID matches the one on your block, ask whoever sent your invite code to move it to you.';

/**
 * No answer from the API (P3), and so every `NetworkError` a page shows (D2c-2): the connection,
 * never the person, and never a sign-out (ARCHITECTURE, Web portal, decision 4).
 */
export const CANT_REACH = "Couldn't reach Bali. Check your connection, then try again.";

/** A 5xx or a timeout on the register (P3): the API's own message is written for a log. */
export const CANT_REGISTER = "Bali couldn't register the block just now. Try again.";

/** A class's name left empty (D2e): said before anything is sent. */
export const NO_CLASS_NAME = 'Enter a name for the class.';

/** A 5xx or a timeout on a create (D2e): the API's own message is written for a log. */
export const CANT_CREATE = "Bali couldn't create the class just now. Try again.";

/** A session length typed under Other (P10): said before a Start is sent with it. */
export const NOT_A_SESSION_LENGTH = `A session runs 1 to ${MAX_SESSION_MINUTES} minutes. Enter a whole number of minutes.`;

/** A 5xx or a timeout on an extend (P10): Try again resends it under the same id. */
export const CANT_ADD_TIME = "Bali couldn't add the time just now. Try again.";

/** A 5xx or a timeout on a new join code (P11): Try again sends it again. */
export const CANT_MAKE_CODE = "Bali couldn't make a new code just now. Try again.";

/** The new join code is in place (P11), said beside it. */
export const NEW_CODE_MADE = 'This is the new code. The old one has stopped working.';

/**
 * A Start answered `existing` (P10): a session of the class was already running, started from
 * another tab or a phone, so the length picked here set nothing; the bell beside the grid is its.
 */
export const SESSION_ALREADY_RUNNING =
  "A session was already running, so the length you picked wasn't used. It ends at the time shown.";

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
    // POST /v1/sessions/{id}/extend (P10): past the bell, or ended, no time is added (decision
    // 12). An End in that gap ends it at its bell and shows the recap, and a Start then works.
    session_not_running:
      'This session is past its bell, so no time was added. End it, then start a new one.',
  } satisfies Partial<Record<ApiErrorReason, string>>),
);

/** A human-readable message for any thrown API/network error, safe to display beside a retry. */
export function errText(e: unknown): string {
  if (e instanceof NetworkError) return CANT_REACH;
  if (e instanceof ApiError) {
    if (e.status === 429) {
      return (e.retryAfter ?? 0) > A_MOMENT ? TOO_MANY_TRIES_MINUTE : TOO_MANY_TRIES;
    }
    return REFUSALS.get(e.reason) ?? e.message;
  }
  if (e instanceof Error) return e.message;
  return 'Something went wrong. Try again.';
}
