import type { ApiErrorBody } from '@bali/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { requireAuth } from '../src/auth/plugin.js';
import type { TokenVerifier } from '../src/auth/verify.js';
import { ApiError } from '../src/errors.js';
import { testEnv } from './helpers/env.js';
import { makeTestIssuer, TEST_AUDIENCE, type TestIssuer } from './helpers/test-issuer.js';

const errorOf = (res: LightMyRequestResponse): ApiErrorBody['error'] =>
  res.json<ApiErrorBody>().error;

/*
 * The auth middleware, exercised end-to-end against the real verifier and a
 * local key set (the test issuer). A throwaway protected route stands in for
 * the step-7 endpoints.
 */

let issuer: TestIssuer;
let app: FastifyInstance;

/** Build an app with a protected route, using the given verifier. */
function appWith(verify: TokenVerifier): FastifyInstance {
  const instance = buildApp(testEnv, { verifyToken: verify });
  instance.get('/whoami', { preHandler: instance.authenticate }, (request) => {
    const identity = requireAuth(request);
    return { sub: identity.sub };
  });
  return instance;
}

beforeEach(async () => {
  issuer = await makeTestIssuer();
  app = appWith(issuer.verifier);
});

afterEach(async () => {
  await app.close();
});

async function whoami(token?: string) {
  return app.inject({
    method: 'GET',
    url: '/whoami',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('authenticate', () => {
  it('accepts a valid access token and exposes the subject', async () => {
    const res = await whoami(await issuer.sign({ sub: 'cognito-abc' }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sub: 'cognito-abc' });
  });

  it('accepts an id token (client id in aud)', async () => {
    const res = await whoami(await issuer.sign({ audience: TEST_AUDIENCE, sub: 'id-user' }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sub: 'id-user' });
  });

  it('rejects a missing Authorization header as 401 in the error shape', async () => {
    const res = await whoami();
    expect(res.statusCode).toBe(401);
    const err = errorOf(res);
    expect(err.code).toBe('unauthorized');
    expect(typeof err.message).toBe('string');
  });

  it('rejects a non-Bearer / malformed header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Basic abc' },
    });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res).code).toBe('unauthorized');
  });

  it('rejects an expired token', async () => {
    const res = await whoami(await issuer.sign({ expiresInSeconds: -10 }));
    expect(res.statusCode).toBe(401);
    expect(errorOf(res).code).toBe('unauthorized');
  });

  it('rejects a token from the wrong issuer', async () => {
    const res = await whoami(await issuer.sign({ issuer: 'https://evil.example/pool' }));
    expect(res.statusCode).toBe(401);
  });

  it('rejects a token for a different app client id', async () => {
    const res = await whoami(await issuer.sign({ clientId: 'someone-elses-app' }));
    expect(res.statusCode).toBe(401);
    expect(errorOf(res).code).toBe('unauthorized');
  });

  it('rejects a token signed by a different key (bad signature)', async () => {
    const otherIssuer = await makeTestIssuer();
    // Signed by otherIssuer's private key, but our app verifies against issuer's.
    const res = await whoami(await otherIssuer.sign({}));
    expect(res.statusCode).toBe(401);
  });

  it('returns 503 (not 401) when the token cannot be verified for infra reasons', async () => {
    // A verifier that fails with a non-auth error stands in for a JWKS-fetch
    // failure; the honesty rule says this must not read as a rejected token.
    const flakyApp = appWith(() => Promise.reject(ApiError.unavailable('could not verify token')));
    try {
      const res = await flakyApp.inject({
        method: 'GET',
        url: '/whoami',
        headers: { authorization: 'Bearer whatever' },
      });
      expect(res.statusCode).toBe(503);
      expect(errorOf(res).code).toBe('unavailable');
    } finally {
      await flakyApp.close();
    }
  });
});
