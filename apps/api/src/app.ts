import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { corsOrigins } from './env';
import { HttpError } from './domain';
import { authRoutes } from './routes/auth';
import { publicRoutes } from './routes/public';
import { teacherRoutes } from './routes/teacher';
import { manageRoutes } from './routes/manage';
import { reportRoutes } from './routes/reports';
import { studentRoutes } from './routes/student';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      process.env.NODE_ENV === 'production'
        ? true
        : process.env.NODE_ENV === 'test'
          ? false
          : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
    // Behind an ALB/nginx: trust X-Forwarded-* so req.ip (and IP-keyed limits) are correct.
    trustProxy: true,
    // Let app.close() drain long-lived SSE streams on deploy instead of hanging.
    forceCloseConnections: true,
  });

  await app.register(cors, {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
  });

  // Opt-in rate limiting (student write routes carry `config.rateLimit`). Keyed by
  // bearer token, NOT IP — a classroom of 28 phones shares one school IP and must
  // never be throttled as a single client.
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => req.headers.authorization ?? req.ip,
    // The builder's return value is THROWN — hand back an HttpError so the app's
    // error handler renders the standard {error, message} envelope with a 429.
    errorResponseBuilder: () =>
      new HttpError(429, 'rate_limited', 'Too many requests — give it a moment and try again.'),
  });

  // Action endpoints (refocus, end, approve…) are legitimately body-less; treat an
  // empty JSON body as undefined instead of erroring like Fastify's default parser.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '' || body === undefined) return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(Object.assign(err as Error, { statusCode: 400 }), undefined);
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply
        .code(400)
        .send({ error: 'invalid_body', message: err.issues[0]?.message ?? 'Invalid request' });
    }
    const fe = err as { statusCode?: unknown; message?: unknown };
    const statusCode = typeof fe.statusCode === 'number' && fe.statusCode >= 400 ? fe.statusCode : 500;
    if (statusCode >= 500) app.log.error(err);
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? 'internal' : 'bad_request',
      message: statusCode >= 500 ? 'Something went wrong' : String(fe.message ?? 'Bad request'),
    });
  });

  // Encapsulated registration: hooks (auth preHandlers) stay scoped per module.
  await app.register(async (instance) => publicRoutes(instance));
  await app.register(async (instance) => authRoutes(instance));
  await app.register(async (instance) => teacherRoutes(instance));
  await app.register(async (instance) => manageRoutes(instance));
  await app.register(async (instance) => reportRoutes(instance));
  await app.register(async (instance) => studentRoutes(instance));

  return app;
}
