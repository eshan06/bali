import { armTap, type Database, findOrCreateStudent, resolveTapTarget, tapIn } from '@bali/db';
import type { TapResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { ApiError, parse } from '../errors.js';
import { mapTransitionError } from './errors.js';
import { DeviceTime, Order } from './schemas.js';

const TapBody = z.object({
  tagId: z.string().min(1),
  eventId: z.string().uuid(),
  deviceTime: DeviceTime,
  order: Order,
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
 * response is the phone's reconciliation channel: a retry names its session
 * only while it is live there, and names none once it is not (A4).
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
          order: body.order ?? null,
        }),
      );
      return {
        outcome: result.outcome,
        session: result.session && {
          id: result.session.id,
          classId: result.session.classId,
          endsAt: result.session.endsAt.toISOString(),
        },
        state: result.state,
      };
    }

    // Mapped, exactly like the tapIn call above. `armTap` refuses an event_id
    // that is not this caller's tap — another student's, another event
    // type's, or one spent under another teacher — and a TransitionError
    // carries no statusCode, so unmapped it falls through every branch of the
    // handler in errors.ts to the catch-all and ships as `500 internal`. A 500
    // reads to any outbox as a transient server fault; the 409 this maps to
    // says what is actually wrong, a permanent conflict, which is what
    // `tapDisposition` (@bali/shared) needs in order to surface it. Pinned
    // by "is a 409 when the event_id belongs to another student's armed
    // tap" — an engine test cannot catch this, because the throw is right
    // and only the status is wrong.
    //
    // Its order is kept with it (A12), for the `tap_in` the Start records.
    const armed = await mapTransitionError(() =>
      armTap(db, {
        studentId: student.id,
        teacherId: target.teacherId,
        blockId: target.blockId,
        eventId: body.eventId,
        deviceTime,
        order: body.order ?? null,
        expiresAt: endOfDay(new Date()),
      }),
    );
    return { outcome: armed.outcome, session: null, state: null };
  });
}
