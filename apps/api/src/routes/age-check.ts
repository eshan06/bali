import { ageCheckPassed, type Database, findOrCreateStudent, recordAgeCheck } from '@bali/db';
import type { AgeCheckResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { parseRequest } from '../errors.js';
import { refusal } from './errors.js';

const RecordBody = z.object({ eventId: z.string().uuid() });

/**
 * GET /v1/me/age-check — whether the caller's account confirmed it is 13 or
 * older (C7-server; ARCHITECTURE, Auth, "Under 13"). A read that creates
 * nothing: the app asks it right after any sign-in, one made through Cognito's
 * own sign-up link too, before the 13+ question, so an under-13 leaves no
 * record in Bali. A teacher's account is always `passed`.
 *
 * PUT /v1/me/age-check — the caller's yes, recorded (`recordAgeCheck`):
 * idempotent on `eventId`, the account's row made as the boot call makes it.
 * Answered `{ passed: true }`, a teacher's too, which records nothing.
 */
export function registerAgeCheckRoutes(app: FastifyInstance, db: Database): void {
  app.get(
    '/v1/me/age-check',
    { preHandler: app.authenticate },
    async (request): Promise<AgeCheckResponse> => ({
      passed: await ageCheckPassed(db, requireAuth(request).sub),
    }),
  );

  app.put(
    '/v1/me/age-check',
    { preHandler: app.authenticate, config: { parses: { body: RecordBody } } },
    async (request): Promise<AgeCheckResponse> => {
      const identity = requireAuth(request);
      const { eventId } = parseRequest(request, 'body', RecordBody);
      const caller = await findOrCreateStudent(db, identity.sub);
      switch (await recordAgeCheck(db, { userId: caller.id, eventId })) {
        case 'passed':
          return { passed: true };
        case 'event_id_conflict':
          throw refusal('EVENT_ID_CONFLICT');
        case 'account_deleted':
          throw refusal('ACCOUNT_DELETED');
      }
    },
  );
}
