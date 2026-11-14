import { type Database, findUserByCognitoId, registerPushToken, removePushToken } from '@bali/db';
import {
  FCM_TOKEN_MAX_LENGTH,
  PUSH_ENVIRONMENTS,
  PUSH_TOKEN_MAX_LENGTH,
  type RegisterPushTokenResponse,
  type RemovePushTokenResponse,
} from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { accountOf } from '../auth/student.js';
import { ApiError, parseRequest } from '../errors.js';
import { refusal } from './errors.js';

/** What an APNs token is: hex, as the phone writes its bytes, 64 digits today (32 bytes). */
const APNS_TOKEN = `[0-9a-fA-F]{64,${PUSH_TOKEN_MAX_LENGTH}}`;
/**
 * An APNs device token, never past `PUSH_TOKEN_MAX_LENGTH`; stored lower-case,
 * so one token has one key whatever case a phone writes it in.
 */
const ApnsToken = z
  .string()
  .regex(new RegExp(`^${APNS_TOKEN}$`), 'is not a device token')
  .toLowerCase();
/**
 * An FCM token (AN11a): letters, digits, `:`, `-` and `_`, kept as sent, since
 * FCM's tell case apart; never past `FCM_TOKEN_MAX_LENGTH`, and never what an
 * APNs token could be, so a token is one service's and keys one row.
 */
const FcmToken = z
  .string()
  .regex(
    new RegExp(`^(?!${APNS_TOKEN}$)[A-Za-z0-9:_-]{1,${FCM_TOKEN_MAX_LENGTH}}$`),
    'is not an FCM token',
  );
const eventId = z.string().uuid();
// No service is APNs's, as every shipped iPhone sends it: today's body, its refusals unchanged.
const apns = { service: z.literal('apns').optional(), token: ApnsToken };
const fcm = { service: z.literal('fcm'), token: FcmToken };
/** A service no branch names is its own refusal; anything else keeps zod's words. */
const unknownService = {
  error: (issue: { code?: string }) =>
    issue.code === 'invalid_union' ? 'is not a push service' : undefined,
};
const RegisterBody = z.discriminatedUnion(
  'service',
  [
    z.object({ ...apns, environment: z.enum(PUSH_ENVIRONMENTS), eventId }),
    // FCM has one endpoint and no sandbox: the Firebase project decides where a token works.
    z.object({ ...fcm, environment: z.literal('production'), eventId }),
  ],
  unknownService,
);
const RemoveBody = z.discriminatedUnion(
  'service',
  [z.object({ ...apns, eventId }), z.object({ ...fcm, eventId })],
  unknownService,
);

const notAStudent = () => ApiError.forbidden('only a student registers a device for notifications');

/**
 * PUT /v1/me/push-token — a student registers its phone's APNs token, with the
 * environment it was issued for (N3; ARCHITECTURE, "Push: a doorbell for
 * students"), or, naming the service `fcm`, its FCM token, whose environment
 * is `production` (AN11a). One phone, one current owner: a token another
 * account holds moves to the caller. At most `PUSH_TOKENS_PER_STUDENT` a
 * student, both services together: a register past it lets the student's
 * oldest go, its answer unchanged (AN11a2). Idempotent on `eventId`
 * (`registerPushToken`), and later wins by its UUIDv7 order: a register older
 * than the row's answers `replay` with the token's environment now, which can
 * mean another account's newer register holds the token (N4).
 *
 * DELETE /v1/me/push-token — the student removes it: `removed`, or
 * `not_registered` when the caller holds no such token (a retry, or it moved
 * on), never touching another account's.
 *
 * Students only, judged in the write's own transaction: anyone else `403`.
 * The token travels in the body, never the URL, so no request log holds it.
 */
export function registerPushTokenRoutes(app: FastifyInstance, db: Database): void {
  app.put(
    '/v1/me/push-token',
    { preHandler: app.authenticate, config: { parses: { body: RegisterBody } } },
    async (request): Promise<RegisterPushTokenResponse> => {
      const identity = requireAuth(request);
      const body = parseRequest(request, 'body', RegisterBody);
      const caller = await accountOf(db, identity);
      const result = await registerPushToken(db, { userId: caller.id, ...body });
      switch (result.outcome) {
        case 'registered':
        case 'replay':
          return { outcome: result.outcome, environment: result.environment };
        case 'not_a_student':
          throw notAStudent();
        case 'event_id_conflict':
          throw refusal('EVENT_ID_CONFLICT');
        case 'account_deleted':
          throw refusal('ACCOUNT_DELETED');
      }
    },
  );

  app.delete(
    '/v1/me/push-token',
    { preHandler: app.authenticate, config: { parses: { body: RemoveBody } } },
    async (request): Promise<RemovePushTokenResponse> => {
      const identity = requireAuth(request);
      const body = parseRequest(request, 'body', RemoveBody);
      // Looked up, never created: an account the server has no row for holds no token.
      const caller = await findUserByCognitoId(db, identity.sub);
      if (!caller) return { outcome: 'not_registered' };
      const result = await removePushToken(db, { userId: caller.id, ...body });
      switch (result.outcome) {
        case 'removed':
        case 'not_registered':
          return { outcome: result.outcome };
        case 'not_a_student':
          throw notAStudent();
        case 'event_id_conflict':
          throw refusal('EVENT_ID_CONFLICT');
      }
    },
  );
}
