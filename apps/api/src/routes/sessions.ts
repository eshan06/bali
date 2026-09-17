import { type Database, findClassById, findUserByCognitoId, startSession } from '@bali/db';
import type { StartSessionResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { ApiError, parse } from '../errors.js';

const Params = z.object({ id: z.string().uuid() });
const Body = z.object({ durationMinutes: z.number().int().positive().max(480) });

/**
 * POST /v1/classes/{id}/sessions — the teacher starts a session for their class.
 * Only the class's own teacher may start it. If one is already running, the
 * running session is returned instead of a duplicate; waiting armed taps become
 * participations (decision 5).
 */
export function registerSessionsRoute(app: FastifyInstance, db: Database): void {
  app.post(
    '/v1/classes/:id/sessions',
    { preHandler: app.authenticate },
    async (request): Promise<StartSessionResponse> => {
      const identity = requireAuth(request);
      const { id: classId } = parse(Params, request.params);
      const { durationMinutes } = parse(Body, request.body);

      const user = await findUserByCognitoId(db, identity.sub);
      // Defense-in-depth over the ownership check below (a student is never a
      // class's teacherId), but it gives a student a clearer reason.
      if (!user || user.role !== 'teacher') {
        throw ApiError.forbidden('only a teacher can start a session');
      }
      const klass = await findClassById(db, classId);
      if (!klass) throw ApiError.notFound('class not found');
      if (klass.teacherId !== user.id) {
        throw ApiError.forbidden('not your class');
      }

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
}
