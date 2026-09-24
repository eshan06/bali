import type { Database } from '@bali/db';
import type { ApiErrorBody } from '@bali/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { errors as joseErrors } from 'jose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { requireAuth } from '../src/auth/plugin.js';
import { createVerifier, type TokenVerifier } from '../src/auth/verify.js';
import { ApiError } from '../src/errors.js';
import { makeTestDb } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import {
  makeTestIssuer,
  TEST_AUDIENCE,
  TEST_ISSUER,
  type TestIssuer,
} from './helpers/test-issuer.js';

const errorOf = (res: LightMyRequestResponse): ApiErrorBody['error'] =>
  res.json<ApiErrorBody>().error;

/*
 * The auth middleware, exercised end-to-end against the real verifier and a
 * local key set (the test issuer). A throwaway protected route stands in for
 * the step-7 endpoints. The db is shared and unused (these routes don't touch it).
 */

let issuer: TestIssuer;
let app: FastifyInstance;
let db: Database;
let closeDb: () => Promise<void>;

/** Build an app with a protected route, using the given verifier. */
function appWith(verify: TokenVerifier): FastifyInstance {
  const instance = buildApp(testEnv, { db, verifyToken: verify });
  instance.get('/whoami', { preHandler: instance.authenticate }, (request) => {
    const identity = requireAuth(request);
    return { sub: identity.sub };
  });
  return instance;
}

beforeAll(async () => {
  ({ db, close: closeDb } = await makeTestDb());
});

afterAll(async () => {
  await closeDb();
});

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

  it('surfaces a verifier 503 through the middleware as unavailable', async () => {
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

/*
 * The app clients a token may come from (`AUTH_AUDIENCE`, B4): the portal and the
 * phone each have their own Cognito app client in the one pool, so the API
 * accepts a list — and one id accepts exactly that client, as it always did.
 */
describe('the app clients a token may come from', () => {
  async function accepts(clientIds: string[], token: (issuer: TestIssuer) => Promise<string>) {
    const issuer = await makeTestIssuer();
    const verify = createVerifier({ issuer: TEST_ISSUER, clientIds, getKey: issuer.getKey });
    return verify(await token(issuer)).then(
      () => true,
      (err: unknown) => (err instanceof ApiError ? err.code : 'threw-non-api'),
    );
  }
  const access = (clientId: string) => (issuer: TestIssuer) => issuer.sign({ clientId });
  const id = (audience: string) => (issuer: TestIssuer) => issuer.sign({ audience });

  it('one id accepts that client, by either token, and no other', async () => {
    expect(await accepts(['web'], access('web'))).toBe(true);
    expect(await accepts(['web'], id('web'))).toBe(true);
    expect(await accepts(['web'], access('phone'))).toBe('unauthorized');
    expect(await accepts(['web'], id('phone'))).toBe('unauthorized');
  });

  it('a list accepts a token from any client it names, by either token', async () => {
    for (const client of ['web', 'phone']) {
      expect(await accepts(['web', 'phone'], access(client))).toBe(true);
      expect(await accepts(['web', 'phone'], id(client))).toBe(true);
    }
  });

  it('a token from neither client is refused 401', async () => {
    expect(await accepts(['web', 'phone'], access('someone-elses-app'))).toBe('unauthorized');
    expect(await accepts(['web', 'phone'], id('someone-elses-app'))).toBe('unauthorized');

    // End to end: the middleware answers it 401, in the error shape.
    const issuer = await makeTestIssuer();
    const listApp = appWith(
      createVerifier({ issuer: TEST_ISSUER, clientIds: ['web', 'phone'], getKey: issuer.getKey }),
    );
    try {
      const whoamiWith = async (clientId: string) =>
        listApp.inject({
          method: 'GET',
          url: '/whoami',
          headers: { authorization: `Bearer ${await issuer.sign({ clientId })}` },
        });
      expect((await whoamiWith('phone')).statusCode).toBe(200);
      const refused = await whoamiWith('someone-elses-app');
      expect(refused.statusCode).toBe(401);
      expect(errorOf(refused).code).toBe('unauthorized');
    } finally {
      await listApp.close();
    }
  });
});

/*
 * The 401-vs-503 classification is the crux of the honesty rule, so it is tested
 * against the REAL createVerifier (not an injected stub): a genuinely bad token
 * is a 401, but a failure to reach or parse the key set is a 503 — never a
 * logout. Key-set failures are simulated by a getKey that throws the jose error
 * jwtVerify would surface, so no network is needed.
 */
describe('createVerifier failure classification', () => {
  async function classify(token: string, getKey: Parameters<typeof createVerifier>[0]['getKey']) {
    const verify = createVerifier({ issuer: TEST_ISSUER, clientIds: [TEST_AUDIENCE], getKey });
    return verify(token).then(
      () => null,
      (err: unknown) => (err instanceof ApiError ? err.code : 'threw-non-api'),
    );
  }

  it('a JWKS timeout is 503, not a logout', async () => {
    const issuer = await makeTestIssuer();
    const token = await issuer.sign({});
    expect(
      await classify(token, () => {
        throw new joseErrors.JWKSTimeout();
      }),
    ).toBe('unavailable');
  });

  it('a non-200 / unparseable JWKS response is 503', async () => {
    const issuer = await makeTestIssuer();
    const token = await issuer.sign({});
    expect(
      await classify(token, () => {
        // What jose throws for a non-200 key-set fetch: a plain JOSEError.
        throw new joseErrors.JOSEError('Expected 200 OK from the JSON Web Key Set HTTP response');
      }),
    ).toBe('unavailable');
  });

  it('an expired token is a 401 even though the key set was reachable', async () => {
    const issuer = await makeTestIssuer();
    const token = await issuer.sign({ expiresInSeconds: -10 });
    expect(await classify(token, issuer.getKey)).toBe('unauthorized');
  });

  it('a bad signature (wrong key reachable) is a 401', async () => {
    const issuer = await makeTestIssuer();
    const otherIssuer = await makeTestIssuer();
    const token = await issuer.sign({});
    // The key set resolves fine, but to the wrong key → signature fails.
    expect(await classify(token, otherIssuer.getKey)).toBe('unauthorized');
  });
});
