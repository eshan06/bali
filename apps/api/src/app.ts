import { API_VERSION, type HealthzResponse } from '@bali/shared';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerAuth } from './auth/plugin.js';
import { createCognitoVerifier, type TokenVerifier } from './auth/verify.js';
import type { Env } from './env.js';
import { registerErrors } from './errors.js';

export interface AppDeps {
  /** Injected in tests (the test issuer); defaults to the Cognito remote-JWKS verifier. */
  verifyToken?: TokenVerifier;
}

/**
 * Builds the app without binding a port, so tests drive it in-process via
 * app.inject() — no listener, no port collisions, no network flakiness.
 */
export function buildApp(env: Env, deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Pretty lines for a human terminal in dev; raw JSON everywhere else.
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
  });

  registerErrors(app);
  registerAuth(app, deps.verifyToken ?? createCognitoVerifier(env));

  app.get('/healthz', (): HealthzResponse => ({ status: 'ok', version: API_VERSION }));

  return app;
}
