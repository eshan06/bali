import {
  changeUnlockReason,
  checkIn,
  type Database,
  endSession,
  extendSession,
  findOrCreateStudent,
  protectionOff,
  protectionOn,
  refocus,
  startSession,
  unlock,
  type UnlockResult,
  unlockUnderTap,
} from '@bali/db';
import type {
  CheckInResponse,
  EndSessionResponse,
  ExtendSessionResponse,
  ProtectionOffResponse,
  ProtectionOnResponse,
  RefocusResponse,
  SessionView,
  StartSessionResponse,
  UnlockReasonResponse,
  UnlockResponse,
} from '@bali/shared';
import { MAX_SESSION_MINUTES, UNLOCK_REASONS } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { requireOwnClass, requireSessionOwner, requireTeacher } from '../auth/teacher.js';
import { parseRequest } from '../errors.js';
import type { NotifyClassStarted } from '../push/class-started.js';
import { mapTransitionError } from './errors.js';
import { DeviceTime, Order } from './schemas.js';

const ClassParams = z.object({ id: z.string().uuid() });
const SessionParams = z.object({ id: z.string().uuid() });
const DurationBody = z.object({
  durationMinutes: z.number().int().positive().max(MAX_SESSION_MINUTES),
});
// Extend carries an optional client-minted event id: the new end is relative to
// the current one, so a retry without it would add the time twice (rule 4).
const ExtendBody = DurationBody.extend({ eventId: z.string().uuid() });
const CheckInBody = z.object({ deviceTime: DeviceTime });
const StateChangeBody = z.object({
  eventId: z.string().uuid(),
  deviceTime: DeviceTime,
  order: Order,
});
// The unlock's optional reason can never fail validation: anything that is not
// one of the known reasons (a future value, a wrong type, garbage) is recorded
// as no reason. A 400 here would keep the unlock out of the record forever —
// the outbox retries the identical body — which is ISSUES #2 through a schema
// (docs/PLAN.md decision log, 2026-09-20).
const UnlockBody = StateChangeBody.extend({
  reason: z.enum(UNLOCK_REASONS).nullish().catch(null),
});

const TapParams = z.object({ eventId: z.string().uuid() });
// A reason change is no unlock record (A20): a reason outside the vocabulary is
// refused, never recorded as none — the unlock it is for stands either way.
const ReasonBody = z.object({ reason: z.enum(UNLOCK_REASONS), eventId: z.string().uuid() });

function toSessionView(s: { id: string; classId: string; endsAt: Date }): SessionView {
  return { id: s.id, classId: s.classId, endsAt: s.endsAt.toISOString() };
}

function toUnlockResponse(result: UnlockResult): UnlockResponse {
  return {
    outcome: result.outcome,
    recordedAs: result.recordedAs,
    state: result.state,
    session: result.session ? toSessionView(result.session) : null,
    reason: result.reason,
  };
}

/**
 * Session lifecycle. Starting and managing a session is teacher-only and
 * owner-only (via session -> class -> teacherId); the per-student actions
 * (check-in, unlock, refocus, protection-off and -on) are for the enrolled phone and resolve the caller
 * like a tap — an unlock sent under a tap too, which names its tap, not a session. All are thin
 * wrappers over the transition engine — the engine owns the writes, these just authorize and
 * shape the response.
 */
export function registerSessionsRoute(
  app: FastifyInstance,
  db: Database,
  clock: () => Date,
  notifyClassStarted: NotifyClassStarted,
): void {
  // POST /v1/classes/:id/sessions — start (or return the already-running) session.
  app.post(
    '/v1/classes/:id/sessions',
    {
      preHandler: app.authenticate,
      config: { parses: { params: ClassParams, body: DurationBody } },
    },
    async (request): Promise<StartSessionResponse> => {
      const teacher = await requireTeacher(db, request);
      const { id: classId } = parseRequest(request, 'params', ClassParams);
      const { durationMinutes } = parseRequest(request, 'body', DurationBody);

      const klass = await requireOwnClass(db, teacher, classId);

      const startedAt = clock();
      const endsAt = new Date(startedAt.getTime() + durationMinutes * 60_000);
      const result = await startSession(db, { classId, startedAt, endsAt });
      // Committed: the doorbell for the students this Start joined (N5), in the
      // background — never awaited, never failing the Start. A replay
      // ('existing') converted no one, so it sends nothing.
      notifyClassStarted({
        sessionId: result.session.id,
        className: klass.name,
        startedAt: result.session.startedAt,
        studentIds: result.convertedStudentIds,
      });

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
    { preHandler: app.authenticate, config: { parses: { params: SessionParams } } },
    async (request): Promise<EndSessionResponse> => {
      const { id } = parseRequest(request, 'params', SessionParams);
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
    {
      preHandler: app.authenticate,
      config: { parses: { params: SessionParams, body: ExtendBody } },
    },
    async (request): Promise<ExtendSessionResponse> => {
      const { id } = parseRequest(request, 'params', SessionParams);
      const { session } = await requireSessionOwner(db, request, id);
      const { durationMinutes, eventId } = parseRequest(request, 'body', ExtendBody);
      // The duration goes to the engine, not a computed end time: the
      // arithmetic belongs inside its locked read, or two simultaneous
      // presses compute the same target and the second is refused.
      const updated = await mapTransitionError(() =>
        extendSession(db, { sessionId: session.id, durationMinutes, at: clock(), eventId }),
      );
      return { outcome: 'extended', session: toSessionView(updated) };
    },
  );

  // POST /v1/sessions/:id/checkin — the ~30s heartbeat; the engine answers live/gone.
  app.post(
    '/v1/sessions/:id/checkin',
    {
      preHandler: app.authenticate,
      config: { parses: { params: SessionParams, body: CheckInBody } },
    },
    async (request): Promise<CheckInResponse> => {
      const identity = requireAuth(request);
      const { id: sessionId } = parseRequest(request, 'params', SessionParams);
      const body = parseRequest(request, 'body', CheckInBody);
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
    {
      preHandler: app.authenticate,
      config: { parses: { params: SessionParams, body: UnlockBody } },
    },
    async (request): Promise<UnlockResponse> => {
      const identity = requireAuth(request);
      const { id: sessionId } = parseRequest(request, 'params', SessionParams);
      const body = parseRequest(request, 'body', UnlockBody);
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
          reason: body.reason ?? null,
          order: body.order ?? null,
        }),
      );
      return toUnlockResponse(result);
    },
  );

  // POST /v1/taps/:eventId/unlock — the same unlock, sent under the phone's own
  // tap while that tap is unanswered (owner decision 11): filed in whatever
  // session the tap landed in, or kept with no session and a note — among the
  // caller's own taps only. Never refused either, and mapped the same way.
  app.post(
    '/v1/taps/:eventId/unlock',
    { preHandler: app.authenticate, config: { parses: { params: TapParams, body: UnlockBody } } },
    async (request): Promise<UnlockResponse> => {
      const identity = requireAuth(request);
      const { eventId: tapEventId } = parseRequest(request, 'params', TapParams);
      const body = parseRequest(request, 'body', UnlockBody);
      const student = await findOrCreateStudent(db, identity.sub);
      const result = await mapTransitionError(() =>
        unlockUnderTap(db, {
          tapEventId,
          studentId: student.id,
          eventId: body.eventId,
          deviceTime: new Date(body.deviceTime),
          reason: body.reason ?? null,
          order: body.order ?? null,
        }),
      );
      return toUnlockResponse(result);
    },
  );

  // PATCH /v1/unlocks/:eventId — the student changes their own unlock's reason
  // (A20), the unlock named by its own event id; idempotent on the body's.
  app.patch(
    '/v1/unlocks/:eventId',
    { preHandler: app.authenticate, config: { parses: { params: TapParams, body: ReasonBody } } },
    async (request): Promise<UnlockReasonResponse> => {
      const identity = requireAuth(request);
      const { eventId: unlockEventId } = parseRequest(request, 'params', TapParams);
      const body = parseRequest(request, 'body', ReasonBody);
      const student = await findOrCreateStudent(db, identity.sub);
      const { outcome, reason } = await mapTransitionError(() =>
        changeUnlockReason(db, {
          unlockEventId,
          studentId: student.id,
          eventId: body.eventId,
          reason: body.reason,
          now: clock(),
        }),
      );
      return { outcome, reason };
    },
  );

  // POST /v1/sessions/:id/protection-off — the phone found its Screen Time
  // permission revoked; iOS has already dropped every shield. Its own state,
  // never green and never an unlock (ARCHITECTURE, iOS rules). Strict like
  // refocus: it needs a live participation, so it can 409/404 — except that a
  // student who was in the session when it ended is recorded with a note, and
  // answered with no session (owner decision 10).
  app.post(
    '/v1/sessions/:id/protection-off',
    {
      preHandler: app.authenticate,
      config: { parses: { params: SessionParams, body: StateChangeBody } },
    },
    async (request): Promise<ProtectionOffResponse> => {
      const identity = requireAuth(request);
      const { id: sessionId } = parseRequest(request, 'params', SessionParams);
      const body = parseRequest(request, 'body', StateChangeBody);
      const student = await findOrCreateStudent(db, identity.sub);
      const result = await mapTransitionError(() =>
        protectionOff(db, {
          sessionId,
          studentId: student.id,
          eventId: body.eventId,
          deviceTime: new Date(body.deviceTime),
          order: body.order ?? null,
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
  // live participation is required, so this can 409/404 unlike unlock; and it
  // is refused out of protection off, which a re-tap or Screen Time back on
  // leaves). A replay after the participation ended while the session runs
  // names no session.
  app.post(
    '/v1/sessions/:id/refocus',
    {
      preHandler: app.authenticate,
      config: { parses: { params: SessionParams, body: StateChangeBody } },
    },
    async (request): Promise<RefocusResponse> => {
      const identity = requireAuth(request);
      const { id: sessionId } = parseRequest(request, 'params', SessionParams);
      const body = parseRequest(request, 'body', StateChangeBody);
      const student = await findOrCreateStudent(db, identity.sub);
      const result = await mapTransitionError(() =>
        refocus(db, {
          sessionId,
          studentId: student.id,
          eventId: body.eventId,
          deviceTime: new Date(body.deviceTime),
          order: body.order ?? null,
          now: clock(),
        }),
      );
      return {
        outcome: result.outcome,
        state: result.state,
        session: result.session ? toSessionView(result.session) : null,
      };
    },
  );

  // POST /v1/sessions/:id/protection-on — Screen Time back on in the class the
  // student tapped into (#167): out of protection off to the state before it,
  // with no re-tap. Strict like refocus: a live participation in protection
  // off, in a session running by the server's clock, or a 409/404.
  app.post(
    '/v1/sessions/:id/protection-on',
    {
      preHandler: app.authenticate,
      config: { parses: { params: SessionParams, body: StateChangeBody } },
    },
    async (request): Promise<ProtectionOnResponse> => {
      const identity = requireAuth(request);
      const { id: sessionId } = parseRequest(request, 'params', SessionParams);
      const body = parseRequest(request, 'body', StateChangeBody);
      const student = await findOrCreateStudent(db, identity.sub);
      const result = await mapTransitionError(() =>
        protectionOn(db, {
          sessionId,
          studentId: student.id,
          eventId: body.eventId,
          deviceTime: new Date(body.deviceTime),
          order: body.order ?? null,
          now: clock(),
        }),
      );
      return {
        outcome: result.outcome,
        state: result.state,
        session: result.session ? toSessionView(result.session) : null,
      };
    },
  );
}
