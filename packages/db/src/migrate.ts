import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb } from './client';

const migrationsFolder = resolve(fileURLToPath(new URL('.', import.meta.url)), '../migrations');

const main = async () => {
  await migrate(getDb(), { migrationsFolder });
  console.log('migrations applied');
  await closeDb();
};

main().catch(async (err) => {
  console.error('migrate failed:', err);
  await closeDb().catch(() => {});
  process.exit(1);
});
