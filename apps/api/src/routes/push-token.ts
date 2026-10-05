import {
  type Database,
  findOrCreateStudent,
  findUserByCognitoId,
  registerPushToken,
  removePushToken,
} from '@bali/db';
import {
  PUSH_ENVIRONMENTS,
  PUSH_TOKEN_MAX_LENGTH,
  type RegisterPushTokenResponse,
  type RemovePushTokenResponse,
} from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { ApiError, parseRequest } from '../errors.js';
import { refusal } from './errors.js';

/**
 * An APNs device token: hex, as the phone writes its bytes, 64 digits today
 * (32 bytes) and never past `PUSH_TOKEN_MAX_LENGTH`; stored lower-case, so one
 * token has one key whatever case a phone writes it in.
 */
const Token = z
  .string()
  .regex(new RegExp(`^[0-9a-fA-F]{64,${PUSH_TOKEN_MAX_LENGTH}}$`), 'is not a device token')
  .toLowerCase();
const RegisterBody = z.object({
  token: Token,
  environment: z.enum(PUSH_ENVIRONMENTS),
  eventId: z.string().uuid(),
});
const RemoveBody = z.object({ token: Token, eventId: z.string().uuid() });

const notAStudent = () => ApiError.forbidden('only a student registers a device for notifications');

/**
 * PUT /v1/me/push-token — a student registers its phone's APNs token, with the
 * environment it was issued for (N3; ARCHITECTURE, "Push: a doorbell for
 * students"). One phone, one current owner: a token another account holds
 * moves to the caller. Idempotent on `eventId` (`registerPushToken`), and
 * later wins by its UUIDv7 order: a register older than the row's answers
 * `replay` with the token's environment now, which can mean another account's
 * newer register holds the token (N4).
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
      const caller = await findOrCreateStudent(db, identity.sub);
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
