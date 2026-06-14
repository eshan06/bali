import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb, schema as s } from '@bali/db';
import { bootstrapBodySchema } from '@bali/shared';
import { authenticate, bootstrapIdentity } from '../auth';

export function authRoutes(app: FastifyInstance): void {
  // Provisioning is idempotent and per-user; cap it so a leaked token can't spray the
  // adoption logic. Keyed by token (the global keyGenerator), never by shared classroom IP.
  app.post(
    '/v1/auth/bootstrap',
    { preHandler: authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const body = bootstrapBodySchema.parse(req.body ?? {});
    try {
      const result = await bootstrapIdentity(req.identity!, body);
      return result;
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message: string };
      if (e.statusCode) return reply.code(e.statusCode).send({ error: e.code, message: e.message });
      throw err;
    }
  });

  app.get('/v1/me', { preHandler: authenticate }, async (req) => {
    const db = getDb();
    const sub = req.identity!.sub;

    const teacher = await db.query.teachers.findFirst({ where: eq(s.teachers.cognitoSub, sub) });
    if (teacher) {
      const school = await db.query.schools.findFirst({ where: eq(s.schools.id, teacher.schoolId) });
      return {
        role: 'teacher' as const,
        teacher: {
          id: teacher.id,
          name: teacher.name,
          displayName: teacher.displayName,
          email: teacher.email,
          schoolName: school?.name ?? '',
          notifyEmergency: teacher.notifyEmergency,
          notifyRevoked: teacher.notifyRevoked,
          notifyWeekly: teacher.notifyWeekly,
        },
      };
    }

    const student = await db.query.students.findFirst({ where: eq(s.students.cognitoSub, sub) });
    if (student) {
      return {
        role: 'student' as const,
        student: { id: student.id, firstName: student.firstName, lastName: student.lastName },
      };
    }

    return { role: null };
  });
}
