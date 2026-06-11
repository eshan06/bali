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

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply
        .code(400)
        .send({ error: 'invalid_body', message: err.issues[0]?.message ?? 'Invalid request' });
    }
    app.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong' });
  });

  // Encapsulated registration: hooks (auth preHandlers) stay scoped per module.
  await app.register(async (instance) => publicRoutes(instance));
  await app.register(async (instance) => authRoutes(instance));
  await app.register(async (instance) => teacherRoutes(instance));
  await app.register(async (instance) => studentRoutes(instance));

  return app;
}
