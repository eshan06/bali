import {
  type Database,
  findSessionById,
  getClassSessionsPage,
  getSessionEvents,
  sessionEvents,
  taughtSessionsSince,
} from '@bali/db';
import {
  ACTIVITY_LIMIT,
  type ActivityEventType,
  type ActivityResponse,
  type ReportEvent,
  type ReportStudent,
  type ReportWindow,
  SESSION_REPORTS_PAGE_LIMIT,
  type SessionReportResponse,
  type SessionReportsPage,
  sessionReport,
} from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireOwnClass, requireTeacher } from '../auth/teacher.js';
import { ApiError, parseRequest } from '../errors.js';
import { refusal } from './errors.js';

const Params = z.object({ id: z.string().uuid(), sessionId: z.string().uuid() });
const ClassParams = z.object({ id: z.string().uuid() });
const PageQuery = z.object({
  /** The last session of the page before: the cursor is a row, never an offset. */
  before: z.string().uuid().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SESSION_REPORTS_PAGE_LIMIT)
    .default(SESSION_REPORTS_PAGE_LIMIT),
});

/** Exact minutes, whole for display: the nearest, a half up (minutes are never negative). */
const whole = (minutes: number) => Math.round(minutes);

/**
 * A session's report as both routes give it: `sessionReport` (R1) by the server's clock, each
 * figure whole and rounded from its exact one, so a row of the list never disagrees with its
 * session's report.
 */
function counted(session: ReportWindow, events: readonly ReportEvent[], now: Date) {
  const report = sessionReport(session, events, now);
  return {
    ...report,
    focusMinutes: whole(report.focusMinutes),
    averageFocusMinutes:
      report.averageFocusMinutes === null ? null : whole(report.averageFocusMinutes),
    silentMinutes: whole(report.silentMinutes),
  };
}

/**
 * Reports (Phase 4), the class's own teacher only.
 *
 * GET /v1/classes/:id/reports/sessions/:sessionId  one session's report (R2)
 * GET /v1/classes/:id/reports/sessions             the class's sessions, newest first, paged (R3)
 * GET /v1/me/activity                              Recent activity across the teacher's classes (PV3)
 *
 * What `sessionReport` (R1) counts from each session's own events, by the server's clock: a
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
      const klass = await requireOwnClass(db, teacher, classId);
      const session = await findSessionById(db, sessionId);
      if (!session || session.classId !== klass.id) throw refusal('SESSION_NOT_FOUND');

      const events = await getSessionEvents(db, session.id);
      const report = counted(session, events, clock());
      const names = new Map(events.map((e) => [e.userId, e.displayName]));
      const student = (id: string): ReportStudent => ({ id, displayName: names.get(id) ?? null });
      return {
        ended: session.endedAt !== null,
        joined: report.joined.map(student),
        focusMinutes: report.focusMinutes,
        averageFocusMinutes: report.averageFocusMinutes,
        silentMinutes: report.silentMinutes,
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

  app.get(
    '/v1/classes/:id/reports/sessions',
    { preHandler: app.authenticate, config: { parses: { params: ClassParams, query: PageQuery } } },
    async (request): Promise<SessionReportsPage> => {
      const teacher = await requireTeacher(db, request);
      // A malformed request is a client bug; a cursor the class does not hold
      // is the cue to reload from the top — a reason each, as the history's.
      const { id: classId } = parseRequest(request, 'params', ClassParams, 'invalid_request');
      const { before, limit } = parseRequest(request, 'query', PageQuery, 'invalid_request');
      const klass = await requireOwnClass(db, teacher, classId);
      const page = await getClassSessionsPage(db, klass.id, { before, limit });
      if (!page) {
        throw ApiError.badInput(
          'before is not a session of this class',
          undefined,
          'unknown_cursor',
        );
      }

      if (page.sessions.length === 0) return { sessions: [], nextBefore: null };

      // Every row by one clock, from every event its session holds, read in one statement.
      const now = clock();
      const events = await sessionEvents(
        db,
        page.sessions.map((session) => session.id),
      );
      return {
        sessions: page.sessions.map((session) => {
          const own = events.filter((e) => e.sessionId === session.id);
          const report = counted(session, own, now);
          return {
            id: session.id,
            startedAt: session.startedAt.toISOString(),
            endsAt: session.endsAt.toISOString(),
            endedAt: session.endedAt?.toISOString() ?? null,
            ended: session.endedAt !== null,
            joinedCount: report.joined.length,
            focusMinutes: report.focusMinutes,
            averageFocusMinutes: report.averageFocusMinutes,
            silentMinutes: report.silentMinutes,
            unlockCount: report.unlocks.length,
            protectionOffCount: report.protectionOffs.length,
          };
        }),
        nextBefore: page.nextBefore,
      };
    },
  );

  // Home's Recent activity (PV3): today's sessions of the teacher's own live classes, today from
  // midnight by the server's clock in the school's zone (hosting decision 5). It takes nothing:
  // Home shows the newest four, and a student has none to read (403).
  app.get(
    '/v1/me/activity',
    { preHandler: app.authenticate },
    async (request): Promise<ActivityResponse> => {
      const teacher = await requireTeacher(db, request);
      const now = clock();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const todays = await taughtSessionsSince(db, teacher.id, today);
      if (todays.length === 0) return { events: [] };

      // Every event of those sessions in one statement, as R3 reads a page's.
      const events = await sessionEvents(
        db,
        todays.map(({ session }) => session.id),
      );
      const moments = todays.flatMap(({ session, className }) => {
        const own = events.filter((e) => e.sessionId === session.id);
        // The unlocks and protection offs its report lists, by the report's own function, so
        // Home never shows one the report leaves out, or leaves out one it lists; an unlock
        // with its reason now (A20).
        const { unlocks, protectionOffs } = sessionReport(session, own, now);
        const reasons = new Map(unlocks.map((u) => [u.eventId, u.reason]));
        const offs = new Set(protectionOffs.map((off) => off.eventId));
        const klass = { id: session.classId, name: className };
        return own
          .filter(
            (e) => e.type === 'session_started' || reasons.has(e.eventId) || offs.has(e.eventId),
          )
          .map((e) => ({ e, klass, reason: reasons.get(e.eventId) ?? null }));
      });
      return {
        events: moments
          // Newest first; at one instant the later record, as the engine numbered them.
          .sort((a, b) => b.e.occurredAt.getTime() - a.e.occurredAt.getTime() || b.e.seq - a.e.seq)
          .slice(0, ACTIVITY_LIMIT)
          .map(({ e, klass, reason }) => ({
            eventId: e.eventId,
            type: e.type as ActivityEventType,
            occurredAt: e.occurredAt.toISOString(),
            class: klass,
            // As the report names them; a session's start names no one.
            student: e.userId === null ? null : { id: e.userId, displayName: e.displayName },
            reason,
          })),
      };
    },
  );
}
