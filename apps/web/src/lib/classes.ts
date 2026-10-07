import type { ClassDetail } from '@bali/shared';

import { type ApiClient, ApiError, NetworkError } from './api-client';
import { CANT_CREATE, CANT_REACH, errText } from './errors';

/* The classes home's create form (D2e), tested: the name's limit, and the create's answer. */

/**
 * The longest name `POST /v1/classes` takes once trimmed (its `CreateBody`, pinned by the test):
 * the field holds no more, so the API's 400 for a longer one, a log line, is never met.
 */
export const CLASS_NAME_MAX = 120;

/** The create's answer, as the form acts on it. */
export type CreateAnswer =
  /** The class, as the server made it. */
  | { kind: 'created'; klass: ClassDetail }
  /** No class made that the page knows of (no answer, a refusal, over the budget): Try again. */
  | { kind: 'failed'; message: string }
  /** No class made, and a resend can't change that (a deleted account, C3): said, no Try again. */
  | { kind: 'final'; message: string };

/**
 * Create a class named `name` (`POST /v1/classes`), its answer in words, never thrown, so the
 * form always comes back with something to say. The route takes no `eventId`: a resend after a
 * lost answer makes a second class, as a second press always has, so the page reads the list
 * again after every answer, and a class made either way is in it to see.
 */
export async function createClass(
  api: Pick<ApiClient, 'post'>,
  name: string,
): Promise<CreateAnswer> {
  try {
    return { kind: 'created', klass: await api.post<ClassDetail>('/v1/classes', { name }) };
  } catch (e) {
    if (e instanceof NetworkError) return { kind: 'failed', message: CANT_REACH };
    // A refusal that carries something to go by, said as errText says it: the budget's wait, or a
    // `reason` (the route's `account_deleted`), which is final.
    if (e instanceof ApiError && e.status === 429) return { kind: 'failed', message: errText(e) };
    if (e instanceof ApiError && e.status < 500 && e.reason !== undefined) {
      return { kind: 'final', message: errText(e) };
    }
    // Anything else: a 5xx, a timeout, a body that isn't JSON, or a refusal with no reason, such
    // as the 409 for a teacher with no school, which no account reaches (a redeemed invite always
    // sets one). The API's own message is written for a log.
    return { kind: 'failed', message: CANT_CREATE };
  }
}
