import { createDb } from '@bali/db';

import { type AppDeps, buildApp } from './app.js';
import { env } from './env.js';
import { captureFailure, flushMonitoring, initMonitoring } from './monitoring.js';
import { makeShutdown } from './shutdown.js';
import { startSweeping } from './sweep.js';

/**
 * The API as a process: Sentry, the app on DATABASE_URL, the minute sweep, the shutdown on a
 * signal, and the port. `deps` go to `buildApp` beside the database: a deploy passes none (server.ts),
 * the load harness its storage stand-in (M9) and, for a measurement, its pool's size (#336), which
 * unset is the driver's own 10.
 */
export async function main({
  databasePool,
  ...deps
}: Omit<AppDeps, 'db'> & { databasePool?: number } = {}): Promise<void> {
  // Before the app, so a failure to start is reported too (a bad env fails the
  // import above, before Sentry could start). A no-op without SENTRY_DSN.
  initMonitoring(env);

  // postgres.js connects lazily, so this makes no network call at boot.
  const db = createDb(env.DATABASE_URL, { max: databasePool });
  const app = buildApp(env, { ...deps, db });

  // The sweep every minute, run by this process itself (hosting decision 3):
  // sessions end at their bell and a quiet phone shows within the minute.
  // Railway's cron, at most every five minutes, is only its backup.
  startSweeping(app, () => app.sweep());

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
}
