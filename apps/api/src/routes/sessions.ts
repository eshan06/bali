import {
  checkIn,
  type Database,
  endSession,
  extendSession,
  findClassById,
  findOrCreateStudent,
  refocus,
  startSession,
  unlock,
} from '@bali/db';
import type {
  CheckInResponse,
  EndSessionResponse,
  ExtendSessionResponse,
  RefocusResponse,
  SessionView,
  StartSessionResponse,
  UnlockResponse,
} from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { requireSessionOwner, requireTeacher } from '../auth/teacher.js';
import { ApiError, parse } from '../errors.js';
import { mapTransitionError } from './errors.js';

const ClassParams = z.object({ id: z.string().uuid() });
const SessionParams = z.object({ id: z.string().uuid() });
const DurationBody = z.object({ durationMinutes: z.number().int().positive().max(480) });
// Extend carries an optional client-minted event id: the new end is relative to
// the current one, so a retry without it would add the time twice (rule 4).
const ExtendBody = DurationBody.extend({ eventId: z.string().uuid() });
const CheckInBody = z.object({ deviceTime: z.string().datetime() });
const StateChangeBody = z.object({
  eventId: z.string().uuid(),
  deviceTime: z.string().datetime(),
});

function toSessionView(s: { id: string; classId: string; endsAt: Date }): SessionView {
  return { id: s.id, classId: s.classId, endsAt: s.endsAt.toISOString() };
}

/**
 * Session lifecycle. Starting and managing a session is teacher-only and
 * owner-only (via session -> class -> teacherId); the per-student actions
 * (check-in, unlock, refocus) are for the enrolled phone and resolve the caller
 * like a tap. All are thin wrappers over the transition engine — the engine owns
 * the writes, these just authorize and shape the response.
 */
export function registerSessionsRoute(app: FastifyInstance, db: Database): void {
  // POST /v1/classes/:id/sessions — start (or return the already-running) session.
  app.post(
    '/v1/classes/:id/sessions',
    { preHandler: app.authenticate },
    async (request): Promise<StartSessionResponse> => {
      const teacher = await requireTeacher(db, request);
      const { id: classId } = parse(ClassParams, request.params);
      const { durationMinutes } = parse(DurationBody, request.body);

      const klass = await findClassById(db, classId);
      if (!klass) throw ApiError.notFound('class not found');
      if (klass.teacherId !== teacher.id) throw ApiError.forbidden('not your class');

      const startedAt = new Date();
      const endsAt = new Date(startedAt.getTime() + durationMinutes * 60_000);
      const result = await startSession(db, { classId, startedAt, endsAt });

      return {
        outcome: result.outcome,
        session: {
          id: result.session.id,
          classId: result.session.classId,
          startedAt: result.session.startedAt.toISOString(),
          endsAt: result.session.endsAt.toISOString(),
        },
        armedConverted: result.armedConverted,
      };
    },
  );

  // POST /v1/sessions/:id/end — the owning teacher ends a running session.
  app.post(
    '/v1/sessions/:id/end',
    { preHandler: app.authenticate },
    async (request): Promise<EndSessionResponse> => {
      const { id } = parse(SessionParams, request.params);
      const { session } = await requireSessionOwner(db, request, id);
      const result = await mapTransitionError(() =>
        endSession(db, { sessionId: session.id, at: new Date(), reason: 'ended' }),
      );
      return {
        outcome: result.ended ? 'ended' : 'already_ended',
        endedParticipations: result.endedParticipations,
      };
    },
  );

  // POST /v1/sessions/:id/extend — the owning teacher adds time.
  app.post(
    '/v1/sessions/:id/extend',
    { preHandler: app.authenticate },
    async (request): Promise<ExtendSessionResponse> => {
      const { id } = parse(SessionParams, request.params);
      const { session } = await requireSessionOwner(db, request, id);
      const { durationMinutes, eventId } = parse(ExtendBody, request.body);
      const now = Date.now();
      // Add time to whichever is later — the current end (extend the remaining
      // time) or now (a session already past its end but not yet swept gets a
      // fresh window rather than a new end still in the past).
      const base = Math.max(now, session.endsAt.getTime());
      const newEndsAt = new Date(base + durationMinutes * 60_000);
      const updated = await mapTransitionError(() =>
        extendSession(db, { sessionId: session.id, newEndsAt, at: new Date(), eventId }),
      );
      return { outcome: 'extended', session: toSessionView(updated) };
    },
  );

  // POST /v1/sessions/:id/checkin — the ~30s heartbeat; the engine answers live/gone.
  app.post(
    '/v1/sessions/:id/checkin',
    { preHandler: app.authenticate },
    async (request): Promise<CheckInResponse> => {
      const identity = requireAuth(request);
      const { id: sessionId } = parse(SessionParams, request.params);
      const body = parse(CheckInBody, request.body);
      const student = await findOrCreateStudent(db, identity.sub);
      const result = await mapTransitionError(() =>
        checkIn(db, { sessionId, studentId: student.id, deviceTime: new Date(body.deviceTime) }),
      );
      return {
        status: result.status,
        state: result.state,
        // 'gone' means this caller has nothing live here — don't hand back the
        // class id and bell window to someone who merely knows a session id.
        session: result.status === 'live' ? toSessionView(result.session) : null,
      };
    },
  );

  // POST /v1/sessions/:id/unlock — emergency unlock. NOT gated on a live
  // participation (step 2 / ISSUES #2): it is always recorded, even for a
  // removed student or an unknown session id, so no response can mean "discard".
  app.post(
    '/v1/sessions/:id/unlock',
    { preHandler: app.authenticate },
    async (request): Promise<UnlockResponse> => {
      const identity = requireAuth(request);
      const { id: sessionId } = parse(SessionParams, request.params);
      const body = parse(StateChangeBody, request.body);
      const student = await findOrCreateStudent(db, identity.sub);
      // Wrapped even though unlock is built never to refuse: it can still raise
      // EVENT_ID_CONFLICT when the client reuses an id that already belongs to
      // a different event. That must reach the phone as a 409 — which the
      // unlock contract reads as "keep the record, retry, and surface" — rather
      // than an unmapped 500.
      const result = await mapTransitionError(() =>
        unlock(db, {
          sessionId,
          studentId: student.id,
          eventId: body.eventId,
          deviceTime: new Date(body.deviceTime),
        }),
      );
      return {
        outcome: result.outcome,
        recordedAs: result.recordedAs,
        state: result.state,
        session: result.session ? toSessionView(result.session) : null,
      };
    },
  );

  // POST /v1/sessions/:id/refocus — return to focus after an unlock (strict: a
  // live participation is required, so this can 409/404 unlike unlock).
  app.post(
    '/v1/sessions/:id/refocus',
    { preHandler: app.authenticate },
    async (request): Promise<RefocusResponse> => {
      const identity = requireAuth(request);
      const { id: sessionId } = parse(SessionParams, request.params);
      const body = parse(StateChangeBody, request.body);
      const student = await findOrCreateStudent(db, identity.sub);
      const result = await mapTransitionError(() =>
        refocus(db, {
          sessionId,
          studentId: student.id,
          eventId: body.eventId,
          deviceTime: new Date(body.deviceTime),
        }),
      );
      return {
        outcome: result.outcome,
        state: result.state,
        session: toSessionView(result.session),
      };
    },
  );
}
