import { closeDb } from '@bali/db';
import { env } from './env';
import { buildApp } from './app';
import { sweep } from './domain';

const app = await buildApp();

// The bell: end overdue sessions / expire passes. Lazy checks on reads back this up,
// so a missed tick only delays the push, never correctness.
const sweeper = setInterval(() => {
  sweep().catch((err) => app.log.error({ err }, 'sweep failed'));
}, env.SWEEP_INTERVAL_MS);
sweeper.unref();

await app.listen({ port: env.PORT, host: '0.0.0.0' }); // 0.0.0.0: iPhone on LAN reaches it
app.log.info(`bali api v1 on :${env.PORT}`);

// Graceful shutdown: stop the sweeper, drain in-flight requests + SSE streams
// (forceCloseConnections), close the DB pool. A hard timeout guards a stuck close so
// orchestrated restarts (Docker/k8s SIGTERM) never hang the deploy.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`${signal} received — shutting down`);
  clearInterval(sweeper);
  const hardExit = setTimeout(() => {
    app.log.error('graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
  hardExit.unref();
  try {
    await app.close();
    await closeDb();
    app.log.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void shutdown(signal));
}

// An uncaught error leaves process state unknown — log and exit so the orchestrator
// restarts a clean instance rather than serving from a corrupt one.
process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'uncaughtException');
  void shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, 'unhandledRejection');
});
