import {
  type Database,
  endEnrollment,
  findClassById,
  findEnrollmentById,
  findOrCreateStudent,
  findUserByCognitoId,
  joinClassByCode,
  previewJoinCode,
} from '@bali/db';
import type {
  EndEnrollmentResponse,
  EnrollmentJoinResponse,
  JoinCodePreviewResponse,
} from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { ApiError, parseRequest } from '../errors.js';
import { guessing, type Limiter } from '../limits.js';
import { mapTransitionError, refusal } from './errors.js';
import { DeviceTime, JoinCode } from './schemas.js';

const JoinBody = z.object({
  joinCode: JoinCode,
  eventId: z.string().uuid(),
  deviceTime: DeviceTime,
});
const Params = z.object({ id: z.string().uuid() });
// Optional (A19): the endpoint shipped with no body, so a caller sending none
// (or `null`) still ends the enrollment, under an id the engine mints.
const EndBody = z.object({ eventId: z.string().uuid().optional() }).nullish();
const CodeParams = z.object({ code: JoinCode });

// A teacher owns classes; they don't join one as a student (which would only
// pollute the roster) — nor preview joining one.
const teacherCannotJoin = () => ApiError.forbidden('teachers cannot join a class as a student');

/**
 * Enrollment lifecycle routes.
 *
 * GET /v1/join-codes/:code — what a code opens, before joining it (A6): the
 * class, its teacher's name, and whether the caller is in it already. A read
 * that writes nothing, matched as the join matches (`JoinCode`), so a code the
 * join would refuse is refused here the same way.
 *
 * POST /v1/enrollments — join a class by code (auth decision 3). The caller is
 * enrolled as a student; joining a class they are already in is a no-op.
 *
 * DELETE /v1/enrollments/:id — a student may delete their own enrollment
 * ('left_class'); the class's teacher may delete any of its enrollments
 * ('removed_from_class'); anyone else gets 403 `enrollment_not_yours`, and a
 * caller with no account here yet 403 `unknown_user`. The removal is the engine's
 * one-transaction case: it ends any live participation and records the event, so
 * a mid-session removal reaches the grid and the phone honestly. A student never
 * leaves while the class has a session running: 409 `class_in_session` (A19).
 * The body's optional `eventId` is what the event is recorded under.
 *
 * The preview and the join look a code up, so each is a guess at one (ISSUES
 * #1): an account's tries, and a backstop on its address's misses, since
 * accounts are free while self sign-up is on (`Limiter.guess`).
 */
export function registerEnrollmentsRoutes(
  app: FastifyInstance,
  db: Database,
  clock: () => Date,
  limits: Limiter,
): void {
  const guessingJoinCodes = guessing(app, limits, 'join');

  app.get(
    '/v1/join-codes/:code',
    { ...guessingJoinCodes, config: { parses: { params: CodeParams } } },
    async (request): Promise<JoinCodePreviewResponse> => {
      const identity = requireAuth(request);
      const { code } = parseRequest(request, 'params', CodeParams);

      // Looked up, never created: someone signing in for the first time has
      // no row yet, and is answered as the student a join would make them.
      const caller = await findUserByCognitoId(db, identity.sub);
      if (caller?.role === 'teacher') throw teacherCannotJoin();
      const preview = await previewJoinCode(db, code, caller?.id);
      if (!preview) throw refusal('CLASS_NOT_FOUND');
      return {
        class: { id: preview.class.id, name: preview.class.name },
        teacher: { displayName: preview.teacherDisplayName },
        alreadyEnrolled: preview.alreadyEnrolled,
      };
    },
  );

  app.post(
    '/v1/enrollments',
    { ...guessingJoinCodes, config: { parses: { body: JoinBody } } },
    async (request): Promise<EnrollmentJoinResponse> => {
      const identity = requireAuth(request);
      const body = parseRequest(request, 'body', JoinBody);

      const student = await findOrCreateStudent(db, identity.sub);
      // Enrollments are the student-to-class relation.
      if (student.role === 'teacher') throw teacherCannotJoin();
      const result = await mapTransitionError(() =>
        joinClassByCode(db, {
          studentId: student.id,
          joinCode: body.joinCode,
          eventId: body.eventId,
          occurredAt: new Date(body.deviceTime),
        }),
      );
      return {
        outcome: result.outcome,
        enrollmentId: result.enrollmentId,
        class: { id: result.class.id, name: result.class.name },
      };
    },
  );

  app.delete(
    '/v1/enrollments/:id',
    { preHandler: app.authenticate, config: { parses: { params: Params, body: EndBody } } },
    async (request): Promise<EndEnrollmentResponse> => {
      const identity = requireAuth(request);
      const { id: enrollmentId } = parseRequest(request, 'params', Params);
      const { eventId } = parseRequest(request, 'body', EndBody) ?? {};

      const user = await findUserByCognitoId(db, identity.sub);
      if (!user) throw ApiError.forbidden('unknown user', 'unknown_user');

      const enrollment = await findEnrollmentById(db, enrollmentId);
      if (!enrollment) throw refusal('ENROLLMENT_NOT_FOUND');

      // The student may leave their own; the class's teacher may remove any.
      let reason: 'left_class' | 'removed_from_class';
      if (enrollment.studentId === user.id) {
        reason = 'left_class';
      } else {
        // findClassById returns only active classes, so a soft-removed class would
        // make even its own teacher hit this 403. No production path sets
        // classes.removedAt yet; when Step 4 adds class soft-delete it must end the
        // class's enrollments (or this authz must tolerate a removed class here),
        // AND end the class's running session with its participations — tapIn's
        // replay branch is bounded on the participation being live, so a live row
        // in a deleted class would be replayed as current truth.
        const klass = await findClassById(db, enrollment.classId);
        if (!klass || klass.teacherId !== user.id) {
          throw ApiError.forbidden('not allowed to remove this enrollment', 'enrollment_not_yours');
        }
        reason = 'removed_from_class';
      }

      const result = await mapTransitionError(() =>
        endEnrollment(db, { enrollmentId, reason, at: clock(), eventId }),
      );
      return { outcome: result.outcome, reason, endedParticipation: result.endedParticipation };
    },
  );
}
