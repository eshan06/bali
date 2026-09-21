import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';

import { cognitoEndpoint, fetchCognitoAccessToken } from '../scripts/demo/cognito.js';

/*
 * The exit demo's real-Cognito sign-in. It is the one piece of the deployed-API
 * run that cannot be exercised locally end-to-end, so its contract is pinned
 * here: the right call shape goes out, a token comes back, and every failure
 * path throws something an operator can act on rather than returning a
 * token-shaped nothing.
 */

const config = { region: 'us-east-1', clientId: 'app-client-id' };
const creds = { username: 'demo-ana@example.test', password: 'hunter2-not-real' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('fetchCognitoAccessToken', () => {
  it('posts an unauthenticated USER_PASSWORD_AUTH InitiateAuth and returns the access token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { AuthenticationResult: { AccessToken: 'the-access-token' } }),
      );

    const token = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds);

    expect(token).toBe('the-access-token');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(cognitoEndpoint('us-east-1'));
    const headers = init.headers as Record<string, string>;
    expect(headers['x-amz-target']).toBe('AWSCognitoIdentityProviderService.InitiateAuth');
    // No AWS credentials are involved — that is why the demo needs no SDK.
    expect(Object.keys(headers).join(' ')).not.toMatch(/authorization|x-amz-security-token/i);
    expect(JSON.parse(init.body as string)).toEqual({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: 'app-client-id',
      AuthParameters: { USERNAME: creds.username, PASSWORD: creds.password },
    });
  });

  it('reports Cognito’s own error type and message, without echoing the password', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        __type: 'NotAuthorizedException',
        message: 'Incorrect username or password.',
      }),
    );

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.message).toContain('NotAuthorizedException');
    expect(err?.message).toContain('Incorrect username or password.');
    expect(err?.message).toContain(creds.username);
    // The one thing that must never reach a log line or a CI transcript.
    expect(err?.message).not.toContain(creds.password);
  });

  it('names the flow when the app client has USER_PASSWORD_AUTH disabled', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        __type: 'InvalidParameterException',
        message: 'Auth flow not enabled for this client',
      }),
    );

    await expect(fetchCognitoAccessToken({ ...config, fetchImpl }, creds)).rejects.toThrow(
      /Auth flow not enabled/,
    );
  });

  it('fails loudly on an unfinished challenge instead of returning nothing', async () => {
    // A temporary password leaves the account in NEW_PASSWORD_REQUIRED: there is
    // no token, and no amount of retrying produces one — it needs an operator.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ChallengeName: 'NEW_PASSWORD_REQUIRED' }));

    await expect(fetchCognitoAccessToken({ ...config, fetchImpl }, creds)).rejects.toThrow(
      /NEW_PASSWORD_REQUIRED/,
    );
  });

  it('treats a 200 with no access token as a failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { AuthenticationResult: {} }));

    await expect(fetchCognitoAccessToken({ ...config, fetchImpl }, creds)).rejects.toThrow(
      /no access token/,
    );
  });

  it('reports a timeout as a timeout', async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), {
      name: 'TimeoutError',
    });
    const fetchImpl = vi.fn().mockRejectedValue(timeout);

    await expect(fetchCognitoAccessToken({ ...config, fetchImpl }, creds)).rejects.toThrow(
      /did not answer within 30000ms/,
    );
  });

  it('does NOT report a DNS failure as a timeout — that points at the wrong thing', async () => {
    // A mistyped DEMO_COGNITO_REGION fails resolution instantly; blaming
    // Cognito's latency would send the operator looking in the wrong place.
    // The shape Node's fetch really produces: a bare `TypeError: fetch failed`
    // whose readable half lives on `cause`. An error carrying ENOTFOUND in its
    // own message would pass this test while the real path stayed vague.
    const dns = Object.assign(new TypeError('fetch failed'), {
      cause: new Error('getaddrinfo ENOTFOUND cognito-idp.us-east-99.amazonaws.com'),
    });
    const fetchImpl = vi.fn().mockRejectedValue(dns);

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.message).not.toMatch(/did not answer within/);
    expect(err?.message).toMatch(/ENOTFOUND/);
    expect(err?.message).toContain('cognito-idp.us-east-1.amazonaws.com');
    expect(err?.message).not.toContain(creds.password);
  });

  it('redacts the password out of a fetch-layer message that quoted it', async () => {
    // A client that echoed the request body would otherwise put DEMO_PASSWORD
    // into a CI transcript; the module's promise has to hold structurally.
    const chatty = Object.assign(new Error(`request failed: {"PASSWORD":"${creds.password}"}`), {
      name: 'TypeError',
    });
    const fetchImpl = vi.fn().mockRejectedValue(chatty);

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    // Inspect the WHOLE error, cause chain included: asserting only on
    // `.message` is what let a leak through `{ cause: err }` pass review — the
    // demo's top-level handler prints the inspected error, so that is the thing
    // that actually reaches a CI transcript.
    const printed = inspect(err, { depth: null });
    expect(printed).not.toContain(creds.password);
    expect(printed).toContain('<redacted>');
  });

  it('redacts a password that the fetch layer JSON-escaped', async () => {
    // A quoted body escapes `"` and `\\`, so an exact-substring match alone
    // would print such a password in full.
    const awkward = { username: creds.username, password: 'pa"ss\\word' };
    const escaped = JSON.stringify(awkward.password).slice(1, -1);
    const chatty = Object.assign(new TypeError('fetch failed'), {
      cause: new Error(`body was {"PASSWORD":"${escaped}"}`),
    });
    const fetchImpl = vi.fn().mockRejectedValue(chatty);

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, awkward).then(
      () => null,
      (e: unknown) => e as Error,
    );

    const printed = inspect(err, { depth: null });
    expect(printed).not.toContain(awkward.password);
    expect(printed).not.toContain(escaped);
    expect(printed).toContain('<redacted>');
  });

  it('keeps the timeout path free of the password too', async () => {
    const timeout = Object.assign(new TypeError('fetch failed'), {
      name: 'TimeoutError',
      cause: new Error(`sending {"PASSWORD":"${creds.password}"}`),
    });
    const fetchImpl = vi.fn().mockRejectedValue(timeout);

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(inspect(err, { depth: null })).not.toContain(creds.password);
  });

  it('survives a non-JSON error body (a proxy or gateway page)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));

    await expect(fetchCognitoAccessToken({ ...config, fetchImpl }, creds)).rejects.toThrow(
      /HTTP 502/,
    );
  });
});
