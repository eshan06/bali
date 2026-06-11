import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as s } from '@bali/db';

export function publicRoutes(app: FastifyInstance): void {
  /** W2 phone fallback: the ONLY unauthenticated data — a class display name.
   *  (Privacy: reveals nothing about people; tag codes are printed on desks anyway.) */
  app.get<{ Params: { code: string } }>('/v1/public/tags/:code', async (req, reply) => {
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

  app.get('/v1/health', async () => ({ ok: true, at: new Date().toISOString() }));
}
