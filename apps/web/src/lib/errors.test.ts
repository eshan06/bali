import { describe, expect, it } from 'vitest';

import { ApiError, createApiClient, NetworkError } from './api-client';
import { errText, TOO_MANY_TRIES } from './errors';

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
