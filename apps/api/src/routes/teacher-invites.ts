import {
  type Database,
  findOrCreateStudent,
  INVITE_CODE_PATTERN,
  inviteCodeSymbols,
  type RedeemInviteResult,
  redeemTeacherInvite,
} from '@bali/db';
import type { RedeemTeacherInviteResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { displayNameFromClaims } from '../auth/verify.js';
import { ApiError, parse, parseRequest } from '../errors.js';
import { guessing, type Limiter } from '../limits.js';
import { refusal } from './errors.js';

const RedeemBody = z.object({ code: z.string(), eventId: z.string().uuid() });
/**
 * The code as the owner's command printed it, its case, spaces and dashes set aside
 * (`inviteCodeSymbols`). A code that can't be one is the teacher's to fix, so a reason of its own.
 */
const Code = z.object({
  code: z
    .string()
    .max(64)
    .transform(inviteCodeSymbols)
    .pipe(z.string().regex(INVITE_CODE_PATTERN, 'is not an invite code')),
});

type Refused = Exclude<RedeemInviteResult['outcome'], 'redeemed' | 'replay'>;
/** Each refusal of a redeem, in the one error shape: nothing was changed by any. */
const REFUSED: Record<Refused, () => ApiError> = {
  event_id_conflict: () => refusal('EVENT_ID_CONFLICT'),
  already_teacher: () => ApiError.conflict('this account is a teacher already', 'already_teacher'),
  student_in_class: () =>
    ApiError.conflict(
      'this account is a student in a class: use a separate account for teaching',
      'student_in_class',
    ),
  invite_not_found: () => ApiError.notFound('no invite has that code', 'invite_not_found'),
  invite_used: () => ApiError.conflict('that invite code has been used', 'invite_used'),
  invite_expired: () => ApiError.conflict('that invite code has expired', 'invite_expired'),
  account_deleted: () => refusal('ACCOUNT_DELETED'),
};

/**
 * POST /v1/teacher-invites/redeem — a signed-in account redeems the invite code
 * the owner minted for a school (T1b) and becomes a teacher there, in one
 * transaction (`redeemTeacherInvite`), idempotent on `eventId`: a replay answers
 * the account now. The code travels in the body, never the URL, so no request
 * log holds it. An account whose first sign-in has made no row yet gets one, as
 * the boot call makes it, and is then judged.
 *
 * Each call is a guess at a code (ISSUES #1): tries per account, and a backstop
 * on its address's misses (`Limiter.guess`), as the join's are.
 */
export function registerTeacherInvitesRoute(
  app: FastifyInstance,
  db: Database,
  limits: Limiter,
): void {
  app.post(
    '/v1/teacher-invites/redeem',
    { ...guessing(app, limits, 'invite'), config: { parses: { body: RedeemBody } } },
    async (request): Promise<RedeemTeacherInviteResponse> => {
      const identity = requireAuth(request);
      // A malformed body is a client bug; a code that can't be one is the teacher's.
      const body = parseRequest(request, 'body', RedeemBody, 'invalid_request');
      const { code } = parse(Code, body, 'invite_code_invalid');

      const caller = await findOrCreateStudent(
        db,
        identity.sub,
        displayNameFromClaims(identity.claims),
      );
      const result = await redeemTeacherInvite(db, {
        userId: caller.id,
        code,
        eventId: body.eventId,
      });
      if (result.outcome !== 'redeemed' && result.outcome !== 'replay') {
        throw REFUSED[result.outcome]();
      }
      const { user } = result;
      return {
        outcome: result.outcome,
        user: { id: user.id, role: user.role, displayName: user.displayName },
      };
    },
  );
}
