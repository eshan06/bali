import { buildApp } from './app.js';
import { env } from './env.js';

const app = buildApp(env);

// SIGTERM is how deploy platforms ask a process to stop; close() finishes
// in-flight requests instead of dropping them mid-response.
function shutdown(signal: NodeJS.Signals): void {
  app.log.info({ signal }, 'shutting down');
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
