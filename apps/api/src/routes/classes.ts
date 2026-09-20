import {
  createClass,
  type Database,
  findClassById,
  findLiveSessionForClass,
  getRoster,
  updateClass,
} from '@bali/db';
import type { ClassDetail, RosterResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireTeacher } from '../auth/teacher.js';
import { ApiError, parse } from '../errors.js';

const Params = z.object({ id: z.string().uuid() });
const CreateBody = z.object({ name: z.string().trim().min(1).max(120) });
const UpdateBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    regenerateCode: z.boolean().optional(),
  })
  // PATCH must change something — an empty body is a 400, not a silent no-op.
  .refine((b) => b.name !== undefined || b.regenerateCode === true, {
    message: 'provide a new name or set regenerateCode',
  });

function toClassDetail(
  c: {
    id: string;
    name: string;
    joinCode: string;
    createdAt: Date;
  },
  liveSessionId: string | null,
): ClassDetail {
  return {
    id: c.id,
    name: c.name,
    joinCode: c.joinCode,
    createdAt: c.createdAt.toISOString(),
    liveSessionId,
  };
}

/**
 * Class management — all teacher-only and, for a specific class, owner-only.
 *
 * POST   /v1/classes            create a class (server-generated join code)
 * GET    /v1/classes/:id        the class as its teacher manages it
 * PATCH  /v1/classes/:id        rename and/or regenerate the join code
 * GET    /v1/classes/:id/roster the class's active roster
 *
 * These writes never touch participations/events, so they call the `@bali/db`
 * management helpers directly rather than the engine. Creates return 200 with
 * the resource, matching the house style (start-session, enrollment-join).
 */
export function registerClassesRoutes(app: FastifyInstance, db: Database): void {
  app.post(
    '/v1/classes',
    { preHandler: app.authenticate },
    async (request): Promise<ClassDetail> => {
      const teacher = await requireTeacher(db, request);
      const body = parse(CreateBody, request.body);
      if (!teacher.schoolId) {
        // A class needs a school; a teacher without one isn't fully provisioned.
        throw ApiError.conflict('teacher is not assigned to a school');
      }
      const klass = await createClass(db, {
        teacherId: teacher.id,
        schoolId: teacher.schoolId,
        name: body.name,
      });
      return toClassDetail(klass, null);
    },
  );

  app.get(
    '/v1/classes/:id',
    { preHandler: app.authenticate },
    async (request): Promise<ClassDetail> => {
      const teacher = await requireTeacher(db, request);
      const { id } = parse(Params, request.params);
      const klass = await findClassById(db, id);
      if (!klass) throw ApiError.notFound('class not found');
      if (klass.teacherId !== teacher.id) throw ApiError.forbidden('not your class');
      return toClassDetail(klass, (await findLiveSessionForClass(db, id))?.id ?? null);
    },
  );

  app.patch(
    '/v1/classes/:id',
    { preHandler: app.authenticate },
    async (request): Promise<ClassDetail> => {
      const teacher = await requireTeacher(db, request);
      const { id } = parse(Params, request.params);
      const body = parse(UpdateBody, request.body);
      const klass = await findClassById(db, id);
      if (!klass) throw ApiError.notFound('class not found');
      if (klass.teacherId !== teacher.id) throw ApiError.forbidden('not your class');

      const updated = await updateClass(db, {
        classId: id,
        name: body.name,
        regenerateCode: body.regenerateCode,
      });
      // Undefined only if the class was removed between the check and the write
      // (no production path does this yet) — treat as gone.
      if (!updated) throw ApiError.notFound('class not found');
      return toClassDetail(updated, (await findLiveSessionForClass(db, id))?.id ?? null);
    },
  );

  app.get(
    '/v1/classes/:id/roster',
    { preHandler: app.authenticate },
    async (request): Promise<RosterResponse> => {
      const teacher = await requireTeacher(db, request);
      const { id: classId } = parse(Params, request.params);
      const klass = await findClassById(db, classId);
      if (!klass) throw ApiError.notFound('class not found');
      if (klass.teacherId !== teacher.id) throw ApiError.forbidden('not your class');

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
