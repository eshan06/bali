import { API_VERSION, type HealthzResponse } from '@bali/shared';
import Fastify, { type FastifyInstance } from 'fastify';

import type { Env } from './env.js';

/**
 * Builds the app without binding a port, so tests drive it in-process via
 * app.inject() — no listener, no port collisions, no network flakiness.
 */
export function buildApp(env: Env): FastifyInstance {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Pretty lines for a human terminal in dev; raw JSON everywhere else.
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
  });

  app.get('/healthz', (): HealthzResponse => ({ status: 'ok', version: API_VERSION }));

  return app;
}
