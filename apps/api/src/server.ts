import { createDb } from '@bali/db';

import { buildApp } from './app.js';
import { env } from './env.js';
import { captureFailure, flushMonitoring, initMonitoring } from './monitoring.js';
import { makeShutdown } from './shutdown.js';
import { startSweeping, sweep } from './sweep.js';

// Before the app, so a failure to start is reported too (a bad env fails the
// import above, before Sentry could start). A no-op without SENTRY_DSN.
initMonitoring(env);

// postgres.js connects lazily, so this makes no network call at boot.
const db = createDb(env.DATABASE_URL);
const app = buildApp(env, { db });

// The sweep every minute, run by this process itself (hosting decision 3):
// sessions end at their bell and a quiet phone shows within the minute.
// Railway's cron, at most every five minutes, is only its backup.
startSweeping(app, () => sweep(db));

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
  captureFailure(err, 'boot');
  await flushMonitoring();
  process.exit(1);
}
