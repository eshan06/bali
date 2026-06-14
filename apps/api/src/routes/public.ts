import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema as s } from '@bali/db';

export function publicRoutes(app: FastifyInstance): void {
  /** W2 phone fallback: the ONLY unauthenticated data — a class display name.
   *  (Privacy: reveals nothing about people; tag codes are printed on desks anyway.) */
  // Unauthenticated → keyed by client IP. Generous enough for a classroom tapping in,
  // tight enough to stop someone enumerating tag codes.
  app.get<{ Params: { code: string } }>(
    '/v1/public/tags/:code',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const db = getDb();
    const code = req.params.code.toUpperCase();
    const tag = await db.query.tags.findFirst({
      where: and(eq(s.tags.code, code), eq(s.tags.active, true)),
    });
    if (!tag) return reply.code(404).send({ error: 'not_found', message: 'Unknown tag' });
    const cls = await db.query.classes.findFirst({
      where: and(eq(s.classes.id, tag.classId), isNull(s.classes.archivedAt)),
    });
    if (!cls) return reply.code(404).send({ error: 'not_found', message: 'Unknown tag' });
    return { className: cls.name, tagCode: tag.code };
  });

  /** Liveness: the process is up and serving. Cheap, never touches the DB. */
  app.get('/v1/health', async () => ({ ok: true, at: new Date().toISOString() }));

  /** Readiness: the process can serve real traffic (DB reachable). For load balancers /
   *  orchestrators — returns 503 when the DB is down so traffic drains off this instance. */
  app.get('/v1/ready', async (_req, reply) => {
    try {
      await getDb().execute(sql`select 1`);
      return { ready: true, at: new Date().toISOString() };
    } catch {
      return reply.code(503).send({ ready: false, error: 'db_unreachable' });
    }
  });
}
