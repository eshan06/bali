import { createDb } from '@bali/db';

import { buildApp } from './app.js';
import { env } from './env.js';
import { makeShutdown } from './shutdown.js';

// postgres.js connects lazily, so this makes no network call at boot.
const app = buildApp(env, { db: createDb(env.DATABASE_URL) });

// SIGTERM is how deploy platforms ask a process to stop; the shutdown handler
// drains in-flight requests instead of dropping them mid-response.
const shutdown = makeShutdown(app, { deadlineMs: env.SHUTDOWN_DEADLINE_MS });

// `on`, not `once`: a repeated signal (Ctrl-C twice, a platform re-sending
// SIGTERM) must keep draining, not fall to the default disposition and
// hard-kill mid-response. The shutdown deadline bounds a stuck close, so no
// signal-based force-quit escape hatch is needed.
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err, 'failed to start');
  process.exit(1);
}
