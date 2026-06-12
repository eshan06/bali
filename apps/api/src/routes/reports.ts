import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { getDb, schema as s } from '@bali/db';
import { z } from 'zod';
import { authenticate, requireTeacher } from '../auth';
import { renderEvent } from '../serialize';
import { focusMinutesReport, unlocksCsv, unlocksReport } from '../reports';

const reportQuerySchema = z.object({
  range: z.enum(['week', 'month']).default('month'),
  classId: z.string().uuid().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

/** W9's filter chips are groups, not raw event types — the mapping lives here only. */
const EVENT_GROUPS: Record<string, (typeof s.eventTypeEnum.enumValues)[number][]> = {
  emergencies: ['emergency_unlock', 'reason_shared', 'refocused'],
  passes: ['pass_granted', 'pass_ended'],
  permission: ['permission_revoked', 'permission_restored'],
  sessions: ['session_started', 'session_extended', 'session_ended'],
};

const eventsQuerySchema = z.object({
  type: z.enum(['all', 'emergencies', 'passes', 'permission', 'sessions']).default('all'),
  classId: z.string().uuid().optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export function reportRoutes(app: FastifyInstance): void {
  app.addHook('preHandler', authenticate);

  // ---------- W8 reports ----------
  app.get('/v1/reports/unlocks', async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const query = reportQuerySchema.parse(req.query);
    const report = await unlocksReport({ teacherId: teacher.id, classId: query.classId, range: query.range });

    const wantsCsv = query.format === 'csv' || req.headers.accept === 'text/csv';
    if (wantsCsv) {
      const stamp = new Date().toISOString().slice(0, 10);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="bali-unlocks-${stamp}.csv"`)
        .send(unlocksCsv(report));
    }
    return report;
  });

  app.get('/v1/reports/focus-minutes', async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const query = reportQuerySchema.parse(req.query);
    return focusMinutesReport({ teacherId: teacher.id, classId: query.classId, range: query.range });
  });

  // ---------- W9 event log ----------
  app.get('/v1/events', async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const query = eventsQuerySchema.parse(req.query);
    const db = getDb();

    const myClasses = await db.query.classes.findMany({
      where: eq(s.classes.teacherId, teacher.id),
      columns: { id: true },
    });
    if (myClasses.length === 0) return { events: [], nextCursor: null };

    const where = [
      inArray(
        s.events.classId,
        myClasses.map((c) => c.id),
      ),
    ];
    if (query.classId) where.push(eq(s.events.classId, query.classId));
    if (query.type !== 'all') {
      const types = EVENT_GROUPS[query.type];
      if (types) where.push(inArray(s.events.type, types));
    }
    if (query.cursor) where.push(lt(s.events.id, query.cursor));

    const rows = await db.query.events.findMany({
      where: and(...where),
      orderBy: desc(s.events.id),
      limit: query.limit + 1,
    });

    const page = rows.slice(0, query.limit);
    const nextCursor = rows.length > query.limit ? String(page[page.length - 1]!.id) : null;
    return { events: page.map(renderEvent), nextCursor };
  });
}
