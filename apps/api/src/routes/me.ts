import {
  type CognitoSignIn,
  type Database,
  deleteAccount,
  findOrCreateStudent,
  findUserByCognitoId,
  getEnrolledClasses,
  getLiveParticipation,
  getTaughtClasses,
  hasArmedTap,
  queueCognitoDeletion,
  renameStudent,
  sessionRunning,
} from '@bali/db';
import {
  type DeleteMeResponse,
  deriveDisplayState,
  type MeResponse,
  type UpdateMeResponse,
} from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { type AuthedIdentity, displayNameFromClaims } from '../auth/verify.js';
import type { SignInDeletions } from '../cognito/sign-in-deletion.js';
import { DisplayName } from '../display-name.js';
import { ApiError, parse, parseRequest } from '../errors.js';
import { mapTransitionError } from './errors.js';

const UpdateBody = z.object({ displayName: z.string(), eventId: z.string().uuid() });
const NewName = z.object({ displayName: DisplayName });
const DeleteBody = z.object({ eventId: z.string().uuid() });

/** The caller's sign-in (the verifier checked `iss`); a federated one's username is not its sub. */
function signInOf({ sub, claims: { iss, username } }: AuthedIdentity): CognitoSignIn {
  return {
    issuer: iss ?? '',
    sub,
    username: typeof username === 'string' && username ? username : sub,
  };
}

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
 *
 * DELETE /v1/me — the caller deletes their own account (C3): the engine's
 * `deleteAccount`, idempotent on `eventId`. A teacher with a class or a block
 * is refused `409 teacher_has_classes`. The Cognito sign-in goes too
 * (2026-10-09): queued with the deletion, tried once after it commits, and
 * retried by the sweep until done; the phone's own DeleteUser (C4) is a first try.
 */
export function registerMeRoute(
  app: FastifyInstance,
  db: Database,
  clock: () => Date,
  signIns: SignInDeletions,
): void {
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

  app.delete(
    '/v1/me',
    { preHandler: app.authenticate, config: { parses: { body: DeleteBody } } },
    async (request): Promise<DeleteMeResponse> => {
      const identity = requireAuth(request);
      const { eventId } = parseRequest(request, 'body', DeleteBody);
      const signIn = signInOf(identity);
      // Looked up, never created: a deleted account's sign-in matches no row
      // (`deleteAccount` takes its subject away), so its retry is told the
      // truth, that there is no account, and never makes a new one. Its
      // sign-in is queued all the same — a retry's, or one the server never
      // saw (C7's under-13 fallback) — since that is the caller's to delete.
      const user = await findUserByCognitoId(db, identity.sub);
      let answer: DeleteMeResponse = { outcome: 'already_deleted' };
      if (user) {
        answer = await mapTransitionError(() =>
          deleteAccount(db, { userId: user.id, eventId, at: clock(), signIn }),
        );
      } else {
        await queueCognitoDeletion(db, signIn, clock());
      }
      // After the commit, as the Start's push: the sweep retries what this misses.
      signIns.now();
      return answer;
    },
  );
}
