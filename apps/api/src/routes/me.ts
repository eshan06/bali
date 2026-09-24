import {
  type Database,
  findOrCreateStudent,
  getEnrolledClasses,
  getLiveParticipation,
  getTaughtClasses,
  renameStudent,
} from '@bali/db';
import { deriveDisplayState, type MeResponse, type UpdateMeResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { displayNameFromClaims } from '../auth/verify.js';
import { DisplayName } from '../display-name.js';
import { ApiError, parse } from '../errors.js';
import { mapTransitionError } from './errors.js';

const UpdateBody = z.object({ displayName: z.string(), eventId: z.string().uuid() });
const NewName = z.object({ displayName: DisplayName });

/**
 * GET /v1/me — the boot call: who am I, my classes, my live session. The
 * first-ever call quietly creates the caller's student row (a teacher's row is
 * provisioned elsewhere; an existing row keeps its real role).
 *
 * PATCH /v1/me — a student sets their own display name (A8), unique within
 * each class they are in (owner decision 8; `renameStudent`). Idempotent on
 * `eventId`: a replay applies nothing and answers the name now. A teacher's
 * name is not set here (403): the ruling is about students in a class.
 */
export function registerMeRoute(app: FastifyInstance, db: Database): void {
  app.get('/v1/me', { preHandler: app.authenticate }, async (request): Promise<MeResponse> => {
    const identity = requireAuth(request);
    const user = await findOrCreateStudent(
      db,
      identity.sub,
      displayNameFromClaims(identity.claims),
    );

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

  app.patch(
    '/v1/me',
    { preHandler: app.authenticate },
    async (request): Promise<UpdateMeResponse> => {
      const identity = requireAuth(request);
      // A malformed body is a client bug; a name that breaks a rule is the
      // student's to change — a reason each.
      const body = parse(UpdateBody, request.body, 'invalid_request');
      const { displayName } = parse(NewName, body, 'display_name_invalid');

      const caller = await findOrCreateStudent(db, identity.sub);
      if (caller.role === 'teacher') {
        throw ApiError.forbidden('only a student sets their own name here');
      }
      const { outcome, user } = await mapTransitionError(() =>
        renameStudent(db, { studentId: caller.id, displayName, eventId: body.eventId }),
      );
      return { outcome, user: { id: user.id, role: user.role, displayName: user.displayName } };
    },
  );
}
