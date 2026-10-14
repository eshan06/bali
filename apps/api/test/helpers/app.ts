import type { Database } from '@bali/db';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

import { type AppDeps, buildApp } from '../../src/app.js';
import type { DeckStorage } from '../../src/deck-storage.js';
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
  inviteTries: ROOMY,
  inviteMisses: ROOMY,
};

export interface AuthedApp {
  app: FastifyInstance;
  issuer: TestIssuer;
  /** A signed bearer token for the given cognito subject. */
  tokenFor(sub: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * One issuer per test file (Vitest isolates each), for every app built here: an RSA key pair takes
 * tens of milliseconds to generate, more on CI, and most suites build an app per test. A test that
 * needs a key no app trusts calls `makeTestIssuer` itself, which always makes a new pair.
 */
let fileIssuer: Promise<TestIssuer> | undefined;

/**
 * Build an app backed by the given db and the test issuer's verifier, on `clock` if given, with
 * budgets no test meets (`ROOMY_LIMITS`), decks' storage when given (M2), and any `more` deps.
 */
export async function makeAuthedApp(
  db: Database,
  clock?: () => Date,
  deckStorage?: DeckStorage,
  more: Partial<AppDeps> = {},
): Promise<AuthedApp> {
  const issuer = await (fileIssuer ??= makeTestIssuer());
  const limits = ROOMY_LIMITS;
  const verifyToken = issuer.verifier;
  const app = buildApp(testEnv, { db, verifyToken, clock, limits, deckStorage, ...more });
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
  opts: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; payload?: object },
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: opts.method,
    url: opts.url,
    headers: { authorization: `Bearer ${token}` },
    payload: opts.payload,
  });
}
