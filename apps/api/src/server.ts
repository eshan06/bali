import { buildApp } from './app.js';
import { env } from './env.js';

const app = buildApp(env);

// SIGTERM is how deploy platforms ask a process to stop; close() finishes
// in-flight requests instead of dropping them mid-response.
let closing = false;
function shutdown(signal: NodeJS.Signals): void {
  // A second signal (SIGINT then SIGTERM) must not start a second close()
  // racing the first one's exit.
  if (closing) {
    app.log.info({ signal }, 'already shutting down');
    return;
  }
  closing = true;
  app.log.info({ signal }, 'shutting down');
  // close() waits out lingering keep-alive sockets (up to keepAliveTimeout,
  // 72s by default) and platforms SIGKILL well before that — exit on our own
  // terms first. unref'd so the timer never holds an otherwise-finished loop.
  setTimeout(() => {
    app.log.error('shutdown timed out; exiting');
    process.exit(1);
  }, 10_000).unref();
  app.close().then(
    () => process.exit(0),
    (err: unknown) => {
      app.log.error(err, 'shutdown failed');
      process.exit(1);
    },
  );
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err, 'failed to start');
  process.exit(1);
}
