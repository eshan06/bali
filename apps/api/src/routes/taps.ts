import { armTap, type Database, findOrCreateStudent, resolveTapTarget, tapIn } from '@bali/db';
import type { TapResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { ApiError, parse } from '../errors.js';
import { mapTransitionError } from './errors.js';
import { DeviceTime } from './schemas.js';

const TapBody = z.object({
  tagId: z.string().min(1),
  eventId: z.string().uuid(),
  deviceTime: DeviceTime,
});

/**
 * End of the current school day — when an armed tap expires (decision 5). Uses
 * the server's local time zone, which the deploy sets to the school's (the
 * hosting doc requires TZ; bell times render in that zone), so a pre-bell tap
 * lasts until that evening rather than a UTC boundary that could fall mid-day.
 */
function endOfDay(now: Date): Date {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
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
