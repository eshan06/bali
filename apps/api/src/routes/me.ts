import {
  type Database,
  findOrCreateStudent,
  getEnrolledClasses,
  getLiveParticipation,
  getTaughtClasses,
  hasArmedTap,
  renameStudent,
  sessionRunning,
} from '@bali/db';
import { deriveDisplayState, type MeResponse, type UpdateMeResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { displayNameFromClaims } from '../auth/verify.js';
import { DisplayName } from '../display-name.js';
import { ApiError, parse, parseRequest } from '../errors.js';
import { mapTransitionError } from './errors.js';

const UpdateBody = z.object({ displayName: z.string(), eventId: z.string().uuid() });
const NewName = z.object({ displayName: DisplayName });

/**
 * GET /v1/me — the boot call: who am I, my classes, my live session, and
 * whether a tap of mine waits for a Start (#166). The first-ever call quietly
 * creates the caller's student row (a teacher's row is provisioned elsewhere;
 * an existing row keeps its real role).
 *
 * PATCH /v1/me — a student sets their own display name (A8), unique within
 * each class they are in (owner decision 8; `renameStudent`). Idempotent on
 * `eventId`: a replay applies nothing and answers the name now. A teacher's
 * name is not set here (403): the ruling is about students in a class.
 */
export function registerMeRoute(app: FastifyInstance, db: Database, clock: () => Date): void {
  app.get('/v1/me', { preHandler: app.authenticate }, async (request): Promise<MeResponse> => {
    const identity = requireAuth(request);
    const user = await findOrCreateStudent(
      db,
      identity.sub,
      displayNameFromClaims(identity.claims),
    );

    // A tap of theirs waiting for a Start, by the server's clock (#166): none,
    // and a phone waiting for its teacher's Start stops waiting. Read before the
    // session, so a Start landing between the two answers with its session —
    // never with no session and no tap waiting (#166's review).
    const armed = user.role === 'student' && (await hasArmedTap(db, user.id, clock()));

    // Each class names its teacher (C2a): a teacher's own, the caller — already
    // in hand; a student's, read with the class in one query, with the
    // enrollment that leaving it deletes (A19).
    const classes: MeResponse['classes'] =
      user.role === 'teacher'
        ? (await getTaughtClasses(db, user.id)).map((c) => ({
            id: c.id,
            name: c.name,
            teacher: { displayName: user.displayName },
            enrollmentId: null,
            liveSession: null,
          }))
        : (await getEnrolledClasses(db, user.id)).map((c) => ({
            id: c.id,
            name: c.name,
            teacher: { displayName: c.teacherDisplayName },
            enrollmentId: c.enrollmentId,
            // Running by the server's clock, the engine's one rule (A17), or none (C3c).
            liveSession:
              c.live && sessionRunning(c.live, clock())
                ? { id: c.live.id, endsAt: c.live.endsAt.toISOString() }
                : null,
          }));

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
      classes,
      session,
      armed,
    };
  });

  app.patch(
    '/v1/me',
    { preHandler: app.authenticate, config: { parses: { body: UpdateBody } } },
    async (request): Promise<UpdateMeResponse> => {
      const identity = requireAuth(request);
      // A malformed body is a client bug; a name that breaks a rule is the
      // student's to change — a reason each.
      const body = parseRequest(request, 'body', UpdateBody, 'invalid_request');
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
