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
