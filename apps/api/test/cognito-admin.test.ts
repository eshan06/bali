import { describe, expect, it } from 'vitest';

import { CognitoError, cognitoDeleter } from '../src/cognito/admin.js';
import { testEnv } from './helpers/env.js';

/*
 * Deleting a sign-in from Cognito (2026-10-09): the two calls, signed (`sigv4.test.ts` pins the
 * signing), against what Cognito answers, through a fake fetch.
 */

interface Sent {
  url: string;
  init: RequestInit & { headers: Record<string, string>; body: string };
}

const KEYED = {
  ...testEnv,
  AUTH_ISSUER: 'https://cognito-idp.us-west-2.amazonaws.com/us-west-2_AbC123',
  COGNITO_DELETER_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  COGNITO_DELETER_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

/** The deleter against a fake Cognito that answers each call in turn from `answers`. */
function cognito(...answers: (() => Response)[]) {
  const sent: Sent[] = [];
  const fetchImpl = ((url: string, init: Sent['init']) => {
    sent.push({ url, init });
    return Promise.resolve(answers[sent.length - 1]!());
  }) as unknown as typeof fetch;
  const deleteSignIn = cognitoDeleter(KEYED, fetchImpl, () => new Date('2026-10-09T12:00:00Z'))!;
  const signIn = { username: 'Google_42', sub: 'sub-42' };
  return { run: () => deleteSignIn(signIn, AbortSignal.timeout(5_000)), sent };
}

const user = (sub?: string) => () =>
  Response.json({
    Username: 'Google_42',
    UserAttributes: [
      { Name: 'email', Value: 'ana@example.edu' },
      ...(sub === undefined ? [] : [{ Name: 'sub', Value: sub }]),
    ],
  });
const deleted = () => new Response('', { status: 200 });
const refusal = (type: string) => () =>
  Response.json({ __type: type, message: 'User Google_42 is not allowed' }, { status: 400 });
const targetOf = ({ init }: Sent) => init.headers['x-amz-target'];

describe('the deleter', () => {
  it('reads the user, then deletes it, at AUTH_ISSUER’s pool and region, each call signed', async () => {
    const { run, sent } = cognito(user('sub-42'), deleted);

    expect(await run()).toBe('deleted');

    expect(sent.map(targetOf)).toEqual([
      'AWSCognitoIdentityProviderService.AdminGetUser',
      'AWSCognitoIdentityProviderService.AdminDeleteUser',
    ]);
    for (const { url, init } of sent) {
      expect(url).toBe('https://cognito-idp.us-west-2.amazonaws.com/');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        UserPoolId: 'us-west-2_AbC123',
        Username: 'Google_42',
      });
      expect(init.headers).toMatchObject({
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-date': '20261009T120000Z',
      });
      expect(init.headers.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20261009\/us-west-2\/cognito-idp\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/,
      );
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('never deletes a user its username names now under another sub', async () => {
    const { run, sent } = cognito(user('a-new-sign-in'));
    expect(await run()).toBe('not_theirs');
    expect(sent.map(targetOf)).toEqual(['AWSCognitoIdentityProviderService.AdminGetUser']);
  });

  it('reads a user the pool has none of as gone, its type past any namespace', async () => {
    const namespaced = 'com.amazonaws.cognito.identity.idp.model#UserNotFoundException';
    expect(await cognito(refusal('UserNotFoundException')).run()).toBe('gone');
    expect(await cognito(refusal(namespaced)).run()).toBe('gone');
    // Gone between the read and the delete: the phone's own DeleteUser, say.
    expect(await cognito(user('sub-42'), refusal(namespaced)).run()).toBe('gone');
  });

  it('throws any other refusal as its type and status, never Cognito’s words', async () => {
    const err = await cognito(refusal('AccessDeniedException'))
      .run()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect(err).toMatchObject({ type: 'AccessDeniedException', status: 400 });
    expect((err as Error).message).not.toContain('Google_42');

    // An answer that is not Cognito's JSON — a proxy's 503 page, say — is a refusal too.
    const page = () => new Response('<html>busy</html>', { status: 503 });
    await expect(cognito(page).run()).rejects.toMatchObject({ type: 'unknown', status: 503 });
  });

  it('reads an answer naming no sub as no answer, never as another sign-in', async () => {
    await expect(cognito(user()).run()).rejects.toMatchObject({ type: 'UnreadableAnswer' });
  });

  it('is undefined — deletion off — while the key is unset', () => {
    expect(cognitoDeleter({ ...KEYED, COGNITO_DELETER_ACCESS_KEY_ID: undefined })).toBeUndefined();
    expect(
      cognitoDeleter({ ...KEYED, COGNITO_DELETER_SECRET_ACCESS_KEY: undefined }),
    ).toBeUndefined();
  });
});
