import { type Database, findUserByCognitoId, type UserRow } from '@bali/db';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../errors.js';
import { requireAuth } from './plugin.js';

/**
 * Resolve the authenticated caller and require they are a provisioned teacher.
 * Unlike the student boot path this never creates a row: an unknown caller or a
 * student gets 403, and a teacher is provisioned out of band (role flip). The
 * returned row's `id` is the owner the class/block routes authorize against.
 */
export async function requireTeacher(db: Database, request: FastifyRequest): Promise<UserRow> {
  const identity = requireAuth(request);
  const user = await findUserByCognitoId(db, identity.sub);
  if (!user || user.role !== 'teacher') {
    throw ApiError.forbidden('teacher access required');
  }
  return user;
}
