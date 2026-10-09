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
 * JWT. POST /internal/sweep runs the sweep (`../sweep.ts`) — the same one the API
 * runs itself every minute — for the Railway cron, its backup (hosting decision
 * 3). Idempotent, so a run beside the API's own, or a double-fire, is harmless.
 */
export function registerInternalRoutes(app: FastifyInstance, apiKey: string): void {
  const handler = async (request: { headers: Record<string, unknown> }) => {
    const presented = request.headers['x-internal-key'];
    if (typeof presented !== 'string' || !secretMatches(presented, apiKey)) {
      throw ApiError.unauthorized('invalid internal key');
    }
    return app.sweep();
  };

  app.post('/internal/sweep', handler);
  // The Phase 1 path, kept as an alias onto the same handler: a cron still
  // pointed at it keeps working, and nothing shipped 404s.
  app.post('/internal/sessions/expire', handler);
}
