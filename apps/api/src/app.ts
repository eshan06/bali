import cors from '@fastify/cors';
import type { Database } from '@bali/db';
import { API_VERSION, type HealthzResponse } from '@bali/shared';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerAuth } from './auth/plugin.js';
import { createCognitoVerifier, type TokenVerifier } from './auth/verify.js';
import type { Env } from './env.js';
import { registerErrors } from './errors.js';
import { registerBlocksRoutes } from './routes/blocks.js';
import { registerClassesRoutes } from './routes/classes.js';
import { registerEnrollmentsRoutes } from './routes/enrollments.js';
import { registerFeedRoutes } from './routes/feed.js';
import { registerHistoryRoute } from './routes/history.js';
import { registerInternalRoutes } from './routes/internal.js';
import { registerMeRoute } from './routes/me.js';
import { registerSessionsRoute } from './routes/sessions.js';
import { registerTapsRoute } from './routes/taps.js';
import type { StreamHubOptions } from './sse/hub.js';

export interface AppDeps {
  /** The database handle. Injected in tests (PGlite); server.ts builds it from DATABASE_URL. */
  db: Database;
  /** Injected in tests (the test issuer); defaults to the Cognito remote-JWKS verifier. */
  verifyToken?: TokenVerifier;
  /** Live-stream tuning; tests shorten the re-poll/heartbeat for deterministic delivery. */
  stream?: StreamHubOptions;
  /**
   * Where the logger writes. Injected only by tests that need to ASSERT on a
   * log line — the stream route's teardown level is a decision, not a detail,
   * and it has twice been broken by an unpinned call site. Unset everywhere
   * else, so production keeps pino's own default destination.
   */
  logStream?: NodeJS.WritableStream;
}

/**
 * Builds the app without binding a port, so tests drive it in-process via
 * app.inject() — no listener, no port collisions, no network flakiness.
 */
export function buildApp(env: Env, deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // pino refuses both at once ("only one of option.transport or
      // option.stream can be specified"), so an injected stream wins outright
      // rather than being spread on top of a transport and throwing an opaque
      // construction error. Pretty lines for a human terminal in dev; raw JSON
      // everywhere else; a captured stream only where a test is asserting on
      // what was logged.
      ...(deps.logStream
        ? { stream: deps.logStream }
        : env.NODE_ENV === 'development'
          ? { transport: { target: 'pino-pretty' } }
          : {}),
    },
  });

  registerErrors(app);

  // CORS only when origins are configured (the browser portal). Native apps and
  // server-to-server send no Origin and are unaffected; the header list is the
  // Authorization bearer, no cookies, so no credentials mode. Unset = no CORS.
  const corsOrigins =
    env.CORS_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) ?? [];
  if (corsOrigins.length > 0) {
    void app.register(cors, { origin: corsOrigins });
  }

  registerAuth(app, deps.verifyToken ?? createCognitoVerifier(env));

  app.get('/healthz', (): HealthzResponse => ({ status: 'ok', version: API_VERSION }));
  registerMeRoute(app, deps.db);
  registerHistoryRoute(app, deps.db);
  registerTapsRoute(app, deps.db);
  registerSessionsRoute(app, deps.db);
  registerEnrollmentsRoutes(app, deps.db);
  registerClassesRoutes(app, deps.db);
  registerBlocksRoutes(app, deps.db);
  registerFeedRoutes(app, deps.db, deps.stream);
  registerInternalRoutes(app, deps.db, env.INTERNAL_API_KEY);

  return app;
}
