import type { Database } from '@bali/db';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

import { buildApp } from '../../src/app.js';
import { testEnv } from './env.js';
import { makeTestIssuer, type TestIssuer } from './test-issuer.js';

export interface AuthedApp {
  app: FastifyInstance;
  issuer: TestIssuer;
  /** A signed bearer token for the given cognito subject. */
  tokenFor(sub: string): Promise<string>;
  close(): Promise<void>;
}

/** Build an app backed by the given db and the test issuer's verifier. */
export async function makeAuthedApp(db: Database): Promise<AuthedApp> {
  const issuer = await makeTestIssuer();
  const app = buildApp(testEnv, { db, verifyToken: issuer.verifier });
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
