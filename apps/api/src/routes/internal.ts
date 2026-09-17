import { type Database, expireDueSessions } from '@bali/db';
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
 * JWT. POST /internal/sessions/expire is the target of the Railway cron
 * (hosting decision 3): it ends every session past its end time. Idempotent, so
 * a double-fire is harmless (decision 6).
 */
export function registerInternalRoutes(app: FastifyInstance, db: Database, apiKey: string): void {
  app.post('/internal/sessions/expire', async (request) => {
    const presented = request.headers['x-internal-key'];
    if (typeof presented !== 'string' || !secretMatches(presented, apiKey)) {
      throw ApiError.unauthorized('invalid internal key');
    }
    const expired = await expireDueSessions(db, new Date());
    return { expired: expired.length };
  });
}
