import { type Database, findClassById, findUserByCognitoId, getRoster } from '@bali/db';
import type { RosterResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { ApiError, parse } from '../errors.js';

const Params = z.object({ id: z.string().uuid() });

/**
 * Class-scoped reads. GET /v1/classes/:id/roster — the class's active roster,
 * teacher-only and owner-only. (Class create/get/patch land in Step 4.)
 */
export function registerClassesRoutes(app: FastifyInstance, db: Database): void {
  app.get(
    '/v1/classes/:id/roster',
    { preHandler: app.authenticate },
    async (request): Promise<RosterResponse> => {
      const identity = requireAuth(request);
      const { id: classId } = parse(Params, request.params);

      const user = await findUserByCognitoId(db, identity.sub);
      if (!user || user.role !== 'teacher') {
        throw ApiError.forbidden('only a teacher can view the roster');
      }
      const klass = await findClassById(db, classId);
      if (!klass) throw ApiError.notFound('class not found');
      if (klass.teacherId !== user.id) throw ApiError.forbidden('not your class');

      const roster = await getRoster(db, classId);
      return {
        students: roster.map((r) => ({
          enrollmentId: r.enrollmentId,
          studentId: r.studentId,
          displayName: r.displayName,
          joinedAt: r.joinedAt.toISOString(),
        })),
      };
    },
  );
}
