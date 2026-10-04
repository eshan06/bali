import { describe, expect, it } from 'vitest';

import { ApiError, createApiClient, NetworkError } from './api-client';
import { errText, NOT_AN_INVITE_CODE, TOO_MANY_TRIES } from './errors';

describe('errText', () => {
  it('says what to do over the budget, never the API’s own 429 message', () => {
    const e = new ApiError(429, 'rate_limited', 'too many requests from this account');
    expect(errText(e)).toBe(TOO_MANY_TRIES);
    expect(TOO_MANY_TRIES).toBe('Too many tries for now. Wait a moment, then try again.');
  });

  it('maps the 429 the API client throws from the real error shape', async () => {
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 'rate_limited', message: 'too many requests from this account' },
            }),
            { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '20' } },
          ),
        ),
    });
    const failure: unknown = await api.get('/v1/me').catch((e: unknown) => e);
    expect(errText(failure)).toBe(TOO_MANY_TRIES);
  });

  it('keeps every other error’s own words', () => {
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
