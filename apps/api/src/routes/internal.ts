import { type Database, expireDueSessions, markSilentParticipations } from '@bali/db';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import { ApiError } from '../errors.js';

/**
 * Constant-time secret comparison. Both sides are hashed to a fixed length
 * first, so neither the comparison time nor a length difference leaks anything
 * about the key.
 */
function secretMatches(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Internal, server-to-server routes — guarded by a shared secret, not a user
 * JWT. POST /internal/sweep is the target of the Railway cron (hosting decision
 * 3), the one minute-tick that keeps derived truth honest: it ends every session
 * past its end time, then opens a silence episode for every focused phone that
 * has gone quiet. Both duties are idempotent, so a double-fire (or two overlapping
 * cron runs) is harmless (decision 6 / decision 3).
 */
export function registerInternalRoutes(app: FastifyInstance, db: Database, apiKey: string): void {
  const sweep = async (request: { headers: Record<string, unknown> }) => {
    const presented = request.headers['x-internal-key'];
    if (typeof presented !== 'string' || !secretMatches(presented, apiKey)) {
      throw ApiError.unauthorized('invalid internal key');
    }
    const now = new Date();
    // Expire first: a session ending here also ends its live participations, so
    // the silence pass never opens an episode on a phone that just left.
    const expired = await expireDueSessions(db, now);
    const wentSilent = await markSilentParticipations(db, now);
    return { expired: expired.length, wentSilent };
  };

  app.post('/internal/sweep', sweep);
  // The Phase 1 path, kept as an alias onto the same handler. Without it, the
  // window between this deploy and someone repointing the Railway cron is one
  // where the cron 404s and nothing expires: startSession keeps handing back a
  // stale running session, so a teacher cannot start the next class and every
  // grid shows a session that never ends.
  app.post('/internal/sessions/expire', sweep);
}
