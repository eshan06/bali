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

  it('survives a non-JSON error body (a proxy or gateway page)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));

    await expect(fetchCognitoAccessToken({ ...config, fetchImpl }, creds)).rejects.toThrow(
      /HTTP 502/,
    );
  });
});
