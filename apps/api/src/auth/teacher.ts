import {
  type Database,
  findClassById,
  findSessionById,
  findUserByCognitoId,
  type UserRow,
} from '@bali/db';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../errors.js';
import { refusal } from '../routes/errors.js';
import { requireAuth } from './plugin.js';

/**
 * Resolve the authenticated caller and require they are a provisioned teacher.
 * Unlike the student boot path this never creates a row: an unknown caller or a
 * student gets 403, and a teacher is provisioned out of band (role flip). The
 * returned row's `id` is the owner the class/block/session routes authorize
 * against.
 */
export async function requireTeacher(db: Database, request: FastifyRequest): Promise<UserRow> {
  const identity = requireAuth(request);
  const user = await findUserByCognitoId(db, identity.sub);
  if (!user || user.role !== 'teacher') {
    throw ApiError.forbidden('teacher access required');
  }
  return user;
}

type SessionRow = NonNullable<Awaited<ReturnType<typeof findSessionById>>>;

/**
 * Resolve the session named by `sessionId` and require the caller be its class's
 * teacher — the shared guard for the owner-only session routes (end, extend,
 * snapshot, events, stream). A soft-removed class would 403 even its own teacher
 * (findClassById returns active classes only); no path removes a class yet, and
 * Step 4's note tracks it.
 */
export async function requireSessionOwner(
  db: Database,
  request: FastifyRequest,
  sessionId: string,
): Promise<{ teacher: UserRow; session: SessionRow }> {
  const teacher = await requireTeacher(db, request);
  const session = await findSessionById(db, sessionId);
  if (!session) throw refusal('SESSION_NOT_FOUND');
  const klass = await findClassById(db, session.classId);
  if (!klass || klass.teacherId !== teacher.id) {
    throw ApiError.forbidden('not your session');
  }
  return { teacher, session };
}
