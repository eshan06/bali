import {
  type Database,
  endEnrollment,
  findClassById,
  findEnrollmentById,
  findOrCreateStudent,
  findUserByCognitoId,
  joinClassByCode,
} from '@bali/db';
import type { EndEnrollmentResponse, EnrollmentJoinResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { ApiError, parse } from '../errors.js';
import { mapTransitionError, refusal } from './errors.js';
import { DeviceTime } from './schemas.js';

const JoinBody = z.object({
  joinCode: z.string().min(1),
  eventId: z.string().uuid(),
  deviceTime: DeviceTime,
});
const Params = z.object({ id: z.string().uuid() });

/**
 * Enrollment lifecycle routes.
 *
 * POST /v1/enrollments — join a class by code (auth decision 3). The caller is
 * enrolled as a student; joining a class they are already in is a no-op.
 *
 * DELETE /v1/enrollments/:id — a student may delete their own enrollment
 * ('left_class'); the class's teacher may delete any of its enrollments
 * ('removed_from_class'); anyone else gets 403. The removal is the engine's
 * one-transaction case: it ends any live participation and records the event, so
 * a mid-session removal reaches the grid and the phone honestly.
 */
export function registerEnrollmentsRoutes(app: FastifyInstance, db: Database): void {
  app.post(
    '/v1/enrollments',
    { preHandler: app.authenticate },
    async (request): Promise<EnrollmentJoinResponse> => {
      const identity = requireAuth(request);
      const body = parse(JoinBody, request.body);

      const student = await findOrCreateStudent(db, identity.sub);
      // Enrollments are the student-to-class relation; a teacher owns classes,
      // they don't join one as a student (which would only pollute the roster).
      if (student.role === 'teacher') {
        throw ApiError.forbidden('teachers cannot join a class as a student');
      }
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
    { preHandler: app.authenticate },
    async (request): Promise<EndEnrollmentResponse> => {
      const identity = requireAuth(request);
      const { id: enrollmentId } = parse(Params, request.params);

      const user = await findUserByCognitoId(db, identity.sub);
      if (!user) throw ApiError.forbidden('unknown user');

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
          throw ApiError.forbidden('not allowed to remove this enrollment');
        }
        reason = 'removed_from_class';
      }

      const result = await mapTransitionError(() =>
        endEnrollment(db, { enrollmentId, reason, at: new Date() }),
      );
      return { outcome: result.outcome, reason, endedParticipation: result.endedParticipation };
    },
  );
}
