import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { env } from './env';
import { HttpError } from './domain';
import { authRoutes } from './routes/auth';
import { publicRoutes } from './routes/public';
import { teacherRoutes } from './routes/teacher';
import { studentRoutes } from './routes/student';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      process.env.NODE_ENV === 'production'
        ? true
        : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
  });

  await app.register(cors, {
    origin: [env.CORS_ORIGIN],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
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
    const statusCode = typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
    if (statusCode >= 500) app.log.error(err);
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? 'internal' : 'bad_request',
      message: statusCode >= 500 ? 'Something went wrong' : err.message,
    });
  });

  // Encapsulated registration: hooks (auth preHandlers) stay scoped per module.
  await app.register(async (instance) => publicRoutes(instance));
  await app.register(async (instance) => authRoutes(instance));
  await app.register(async (instance) => teacherRoutes(instance));
  await app.register(async (instance) => studentRoutes(instance));

  return app;
}
