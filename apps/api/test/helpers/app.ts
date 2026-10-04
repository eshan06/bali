import type { Database } from '@bali/db';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

import { buildApp } from '../../src/app.js';
import type { Budget, LimitOptions } from '../../src/limits.js';
import { testEnv } from './env.js';
import { makeTestIssuer, type TestIssuer } from './test-issuer.js';

/**
 * Budgets no test meets (L1's review): the production ones (`BUDGETS`) are
 * rate-limits.test.ts's and limits.test.ts's to pin, so a suite sending many
 * requests under one account, or many join-code misses from one address, never
 * meets a 429 that has nothing to do with what it tests.
 */
const ROOMY: Budget = { burst: 1_000_000, perMinute: 1_000_000 };
const ROOMY_LIMITS: LimitOptions = {
  account: ROOMY,
  unsigned: ROOMY,
  joinTries: ROOMY,
  joinMisses: ROOMY,
};

export interface AuthedApp {
  app: FastifyInstance;
  issuer: TestIssuer;
  /** A signed bearer token for the given cognito subject. */
  tokenFor(sub: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * Build an app backed by the given db and the test issuer's verifier, on `clock` if given, with
 * budgets no test meets (`ROOMY_LIMITS`).
 */
export async function makeAuthedApp(db: Database, clock?: () => Date): Promise<AuthedApp> {
  const issuer = await makeTestIssuer();
  const app = buildApp(testEnv, { db, verifyToken: issuer.verifier, clock, limits: ROOMY_LIMITS });
  return {
    app,
    issuer,
    tokenFor: (sub: string) => issuer.sign({ sub }),
    close: () => app.close(),
  };
}

export async function authedInject(
  app: FastifyInstance,
  token: string,
  opts: { method: 'GET' | 'POST'; url: string; payload?: object },
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: opts.method,
    url: opts.url,
    headers: { authorization: `Bearer ${token}` },
    payload: opts.payload,
  });
}
