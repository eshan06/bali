import cors from '@fastify/cors';
import type { Database } from '@bali/db';
import { API_VERSION, type HealthzResponse } from '@bali/shared';
import Fastify, { type FastifyInstance, type onRouteHookHandler } from 'fastify';

import { registerAuth } from './auth/plugin.js';
import { createCognitoVerifier, type TokenVerifier } from './auth/verify.js';
import type { Env } from './env.js';
import { registerErrors } from './errors.js';
import { createLimiter, type LimitOptions } from './limits.js';
import { registerBlocksRoutes } from './routes/blocks.js';
import { registerClassesRoutes } from './routes/classes.js';
import { registerEnrollmentsRoutes } from './routes/enrollments.js';
import { registerFeedRoutes } from './routes/feed.js';
import { registerHistoryRoute } from './routes/history.js';
import { registerInternalRoutes } from './routes/internal.js';
import { registerMeRoute } from './routes/me.js';
import { registerReportsRoutes } from './routes/reports.js';
import { registerSessionsRoute } from './routes/sessions.js';
import { registerTapsRoute } from './routes/taps.js';
import { registerTeacherInvitesRoute } from './routes/teacher-invites.js';
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
  /**
   * The server's clock, which judges whether a session still runs — for a
   * tap, a return to focus and an extend (A17), a Start (A18) and a leave
   * (A19). Unset, it is the system's; tests whose lessons are on a fixed day
   * set it to that day.
   */
  clock?: () => Date;
  /**
   * Shown each route as it is registered: how the API snapshot
   * (`contracts/openapi.json`, O1) reads the route table. Unset everywhere else.
   */
  onRoute?: onRouteHookHandler;
  /**
   * The rate limits (ISSUES #1): a budget to change from `BUDGETS`, and the
   * clock they refill by. Unset, `BUDGETS` on the process's monotonic clock;
   * tests shrink a budget and drive the clock.
   */
  limits?: LimitOptions;
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
    // No forwarded header moves `request.ip`: Railway documents no hop count
    // for X-Forwarded-For, so the rate limits read its X-Real-IP instead
    // (`clientAddress`, limits.ts).
    trustProxy: false,
  });
  // Before any route: Fastify shows a route to its onRoute hooks as it registers it.
  if (deps.onRoute) app.addHook('onRoute', deps.onRoute);

  registerErrors(app);

  // CORS only when origins are configured (the browser portal). Native apps and
  // server-to-server send no Origin and are unaffected; the header list is the
  // Authorization bearer, no cookies, so no credentials mode. Unset = no CORS.
  const corsOrigins =
    env.CORS_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) ?? [];
  if (corsOrigins.length > 0) {
    // A 429's Retry-After, readable by the portal's fetch, not only sent.
    void app.register(cors, { origin: corsOrigins, exposedHeaders: ['retry-after'] });
  }

  // Every /v1 route's budget is spent in `authenticate`; /healthz and the
  // internal routes, which never call it, spend none.
  const limits = createLimiter(deps.limits);
  registerAuth(app, deps.verifyToken ?? createCognitoVerifier(env), limits);

  app.get('/healthz', (): HealthzResponse => ({ status: 'ok', version: API_VERSION }));
  const clock = deps.clock ?? (() => new Date());
  registerMeRoute(app, deps.db, clock);
  registerHistoryRoute(app, deps.db);
  registerTapsRoute(app, deps.db, clock);
  registerSessionsRoute(app, deps.db, clock);
  registerEnrollmentsRoutes(app, deps.db, clock, limits);
  registerTeacherInvitesRoute(app, deps.db, limits);
  registerClassesRoutes(app, deps.db);
  registerReportsRoutes(app, deps.db, clock);
  registerBlocksRoutes(app, deps.db);
  registerFeedRoutes(app, deps.db, deps.stream);
  registerInternalRoutes(app, deps.db, env.INTERNAL_API_KEY);

  return app;
}
