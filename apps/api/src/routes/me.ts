import {
  type Database,
  findOrCreateStudent,
  getEnrolledClasses,
  getLiveParticipation,
  getTaughtClasses,
} from '@bali/db';
import { deriveDisplayState, type MeResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';

import { requireAuth } from '../auth/plugin.js';

/**
 * GET /v1/me — the boot call: who am I, my classes, my live session. The
 * first-ever call quietly creates the caller's student row (a teacher's row is
 * provisioned elsewhere; an existing row keeps its real role).
 */
export function registerMeRoute(app: FastifyInstance, db: Database): void {
  app.get('/v1/me', { preHandler: app.authenticate }, async (request): Promise<MeResponse> => {
    const identity = requireAuth(request);
    const displayName = typeof identity.claims.name === 'string' ? identity.claims.name : undefined;
    const user = await findOrCreateStudent(db, identity.sub, displayName);

    const classes =
      user.role === 'teacher'
        ? await getTaughtClasses(db, user.id)
        : await getEnrolledClasses(db, user.id);

    let session: MeResponse['session'] = null;
    if (user.role === 'student') {
      const live = await getLiveParticipation(db, user.id);
      if (live) {
        session = {
          id: live.session.id,
          classId: live.session.classId,
          endsAt: live.session.endsAt.toISOString(),
          state: deriveDisplayState(
            {
              state: live.participation.state,
              joinedAt: live.participation.joinedAt,
              lastSeenAt: live.participation.lastSeenAt,
              endedAt: live.participation.endedAt,
            },
            new Date(),
          ),
        };
      }
    }

    return {
      user: { id: user.id, role: user.role, displayName: user.displayName },
      classes: classes.map((c) => ({ id: c.id, name: c.name })),
      session,
    };
  });
}
