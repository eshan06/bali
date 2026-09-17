import { armTap, type Database, findOrCreateStudent, resolveTapTarget, tapIn } from '@bali/db';
import type { TapResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { ApiError, parse } from '../errors.js';
import { mapTransitionError } from './errors.js';

const TapBody = z.object({
  tagId: z.string().min(1),
  eventId: z.string().uuid(),
  deviceTime: z.string().datetime(),
});

/** End of the current civil day, UTC — when an armed tap expires (decision 5). */
function endOfDay(now: Date): Date {
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

/**
 * POST /v1/taps — the tap. Resolves the block to its teacher, then either joins
 * the running session the student is enrolled in (tapIn: joined/switched) or,
 * when none is running, saves the tap as armed and waiting (decision 5). The
 * response is the phone's reconciliation channel.
 */
export function registerTapsRoute(app: FastifyInstance, db: Database): void {
  app.post('/v1/taps', { preHandler: app.authenticate }, async (request): Promise<TapResponse> => {
    const identity = requireAuth(request);
    const body = parse(TapBody, request.body);
    const deviceTime = new Date(body.deviceTime);

    const student = await findOrCreateStudent(db, identity.sub);
    const target = await resolveTapTarget(db, body.tagId, student.id);
    if (!target) throw ApiError.notFound('unknown block');

    if (target.session) {
      const result = await mapTransitionError(() =>
        tapIn(db, {
          sessionId: target.session!.id,
          studentId: student.id,
          eventId: body.eventId,
          deviceTime,
        }),
      );
      return {
        outcome: result.outcome,
        session: {
          id: result.session.id,
          classId: result.session.classId,
          endsAt: result.session.endsAt.toISOString(),
        },
        state: result.state,
      };
    }

    const armed = await armTap(db, {
      studentId: student.id,
      teacherId: target.teacherId,
      blockId: target.blockId,
      eventId: body.eventId,
      deviceTime,
      expiresAt: endOfDay(new Date()),
    });
    return { outcome: armed.outcome, session: null, state: null };
  });
}
