import { type Database, findClassById, findSessionById, getSessionEvents } from '@bali/db';
import { type ReportStudent, type SessionReportResponse, sessionReport } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireTeacher } from '../auth/teacher.js';
import { ApiError, parseRequest } from '../errors.js';
import { refusal } from './errors.js';

const Params = z.object({ id: z.string().uuid(), sessionId: z.string().uuid() });

/** Exact minutes, whole for display: the nearest, a half up (minutes are never negative). */
const whole = (minutes: number) => Math.round(minutes);

/**
 * Reports (Phase 4), the class's own teacher only.
 *
 * GET /v1/classes/:id/reports/sessions/:sessionId  one session's report (R2)
 *
 * What `sessionReport` (R1) counts from the session's own events, by the server's clock: a
 * session not yet marked over is answered too, counted to now or to its bell, and says so. A
 * session in another class is the unknown session's 404, so no class's report names another's.
 */
export function registerReportsRoutes(app: FastifyInstance, db: Database, clock: () => Date): void {
  app.get(
    '/v1/classes/:id/reports/sessions/:sessionId',
    { preHandler: app.authenticate, config: { parses: { params: Params } } },
    async (request): Promise<SessionReportResponse> => {
      const teacher = await requireTeacher(db, request);
      const { id: classId, sessionId } = parseRequest(request, 'params', Params);
      const klass = await findClassById(db, classId);
      if (!klass) throw ApiError.notFound('class not found', 'class_not_found');
      if (klass.teacherId !== teacher.id) throw ApiError.forbidden('not your class');
      const session = await findSessionById(db, sessionId);
      if (!session || session.classId !== klass.id) throw refusal('SESSION_NOT_FOUND');

      const events = await getSessionEvents(db, session.id);
      const report = sessionReport(session, events, clock());
      const names = new Map(events.map((e) => [e.userId, e.displayName]));
      const student = (id: string): ReportStudent => ({ id, displayName: names.get(id) ?? null });
      return {
        ended: session.endedAt !== null,
        joined: report.joined.map(student),
        focusMinutes: whole(report.focusMinutes),
        averageFocusMinutes:
          report.averageFocusMinutes === null ? null : whole(report.averageFocusMinutes),
        silentMinutes: whole(report.silentMinutes),
        unlocks: report.unlocks.map((u) => ({
          eventId: u.eventId,
          student: student(u.studentId),
          occurredAt: u.occurredAt.toISOString(),
          reason: u.reason,
          recordedAs: u.recordedAs,
        })),
        protectionOffs: report.protectionOffs.map((off) => ({
          eventId: off.eventId,
          student: student(off.studentId),
          occurredAt: off.occurredAt.toISOString(),
          recordedAs: off.recordedAs,
        })),
      };
    },
  );
}
