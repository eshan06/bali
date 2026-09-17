import { runMigrations } from '@bali/db';

/**
 * Deploy-time migration runner (`npm run migrate`). Applies the committed
 * migrations to DATABASE_URL, then exits — run before the API starts.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('migrate: DATABASE_URL is not set');
  process.exit(1);
}

try {
  await runMigrations(databaseUrl);
  console.log('migrate: up to date');
  process.exit(0);
} catch (err) {
  console.error('migrate: failed', err);
  process.exit(1);
}
