import { describe, expect, it } from 'vitest';

import { ApiError, createApiClient, NetworkError } from './api-client';
import {
  CANT_ADD_TIME,
  errText,
  NOT_A_SESSION_LENGTH,
  NOT_AN_INVITE_CODE,
  TOO_MANY_TRIES,
  TOO_MANY_TRIES_MINUTE,
} from './errors';

describe('errText', () => {
  it('says what to do over the budget, never the API’s own 429 message', () => {
    const e = new ApiError(429, 'rate_limited', 'too many requests from this account');
    expect(errText(e)).toBe(TOO_MANY_TRIES);
    expect(TOO_MANY_TRIES).toBe('Too many tries for now. Wait a moment, then try again.');
  });

  it('maps the 429 the API client throws from the real error shape, its wait from Retry-After', async () => {
    const thrown = async (retryAfter: string | null) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (retryAfter !== null) headers['retry-after'] = retryAfter;
      const api = createApiClient({
        baseUrl: 'http://api',
        getToken: () => 'tok',
        fetchImpl: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                error: { code: 'rate_limited', message: 'too many requests from this account' },
              }),
              { status: 429, headers },
            ),
          ),
      });
      return api.get('/v1/me').catch((e: unknown) => e);
    };
    // The account's budget: a second, or no header at all, is "a moment" (S4a).
    expect(errText(await thrown('1'))).toBe(TOO_MANY_TRIES);
    expect(errText(await thrown('5'))).toBe(TOO_MANY_TRIES);
    expect(errText(await thrown(null))).toBe(TOO_MANY_TRIES);
    // An HTTP date isn't what the API sends: the wait is unknown, so "a moment".
    expect(errText(await thrown('Wed, 21 Oct 2026 07:28:00 GMT'))).toBe(TOO_MANY_TRIES);
    // The invite budget's: up to a minute, so "a minute".
    expect(errText(await thrown('6'))).toBe(TOO_MANY_TRIES_MINUTE);
    expect(errText(await thrown('60'))).toBe(TOO_MANY_TRIES_MINUTE);
    expect((await thrown('60')) as ApiError).toMatchObject({ status: 429, retryAfter: 60 });
    expect(TOO_MANY_TRIES_MINUTE).toBe('Too many tries for now. Wait a minute, then try again.');
  });

  it('says an event_id_conflict in words, keyed on its reason (S4a)', () => {
    expect(
      errText(new ApiError(409, 'conflict', 'event_id already used', 'event_id_conflict')),
    ).toBe("That didn't go through, so nothing changed. Try again.");
  });

  it('says an extend past the bell in words, with the way on (P10)', () => {
    expect(
      errText(new ApiError(409, 'conflict', 'session is not running', 'session_not_running')),
    ).toBe('This session is past its bell, so no time was added. End it, then start a new one.');
  });

  it('holds the class page’s words (P10): no em-dash, no exclamation mark, a way on', () => {
    expect(NOT_A_SESSION_LENGTH).toBe(
      'A session runs 1 to 480 minutes. Enter a whole number of minutes.',
    );
    expect(CANT_ADD_TIME).toBe("Bali couldn't add the time just now. Try again.");
    for (const words of [NOT_A_SESSION_LENGTH, CANT_ADD_TIME]) {
      expect(words).not.toMatch(/[—!]/);
    }
  });

  it('keeps every other error’s own words', () => {
    // No reason: a newer server's, or none; the message is all there is.
    expect(errText(new ApiError(409, 'conflict', 'session is not running'))).toBe(
      'session is not running',
    );
    expect(errText(new NetworkError())).toBe(new NetworkError().message);
    expect(errText(new Error('boom'))).toBe('boom');
    expect(errText('not an error')).toBe('Something went wrong.');
  });
});

describe('errText for a redeem’s refusals (T2)', () => {
  const REFUSALS = [
    [400, 'bad_input', 'invite_code_invalid', NOT_AN_INVITE_CODE],
    [
      404,
      'not_found',
      'invite_not_found',
      "That code doesn't match any invite. Check each letter and digit against the one you were sent.",
    ],
    [
      409,
      'conflict',
      'invite_used',
      'That code has already been used. Ask the person who sent it for a new one.',
    ],
    [
      409,
      'conflict',
      'invite_expired',
      'Codes last 14 days, and this one has expired. Ask the person who sent it for a new one.',
    ],
    [409, 'conflict', 'already_teacher', 'This account is already set up for teaching.'],
    [
      409,
      'conflict',
      'student_in_class',
      'This account is a student in a class. Use a separate account for teaching, and enter your code there.',
    ],
  ] as const;

  it('says each in its words, keyed on the reason, whatever the message', () => {
    for (const [status, code, reason, words] of REFUSALS) {
      for (const message of ['', 'that invite code has been used', 'student_in_class']) {
        expect(errText(new ApiError(status, code, message, reason)), reason).toBe(words);
      }
    }
    expect(NOT_AN_INVITE_CODE).toBe(
      'An invite code is 25 letters and digits, with no 0, O, 1, I or L. Check it against the one you were sent.',
    );
  });

  it('reads them from the real error shape the API client throws', async () => {
    for (const [status, code, reason, words] of REFUSALS) {
      const api = createApiClient({
        baseUrl: 'http://api',
        getToken: () => 'tok',
        fetchImpl: () =>
          Promise.resolve(
            new Response(JSON.stringify({ error: { code, reason, message: 'a log line' } }), {
              status,
              headers: { 'content-type': 'application/json' },
            }),
          ),
      });
      const failure: unknown = await api
        .post('/v1/teacher-invites/redeem', {})
        .catch((e: unknown) => e);
      expect(errText(failure), reason).toBe(words);
    }
  });

  it('keeps the message for a reason it has no words for, a newer server’s or none, and a 429 is still a wait', () => {
    expect(errText(new ApiError(409, 'conflict', 'a newer refusal', 'not_a_reason_yet'))).toBe(
      'a newer refusal',
    );
    expect(errText(new ApiError(409, 'conflict', 'constructor', 'constructor'))).toBe(
      'constructor',
    );
    expect(errText(new ApiError(404, 'not_found', 'class not found', 'class_not_found'))).toBe(
      'class not found',
    );
    expect(errText(new ApiError(429, 'rate_limited', 'too many', 'invite_not_found'))).toBe(
      TOO_MANY_TRIES,
    );
  });
});
