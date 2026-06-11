/**
 * One-time bootstrap: create the `bali_v2` database on the shared RDS instance.
 * Connects with the same credentials as DATABASE_URL but to the legacy `bali`
 * database (which must exist), then CREATE DATABASE bali_v2 if absent.
 * Non-destructive; safe to re-run.
 */
import pg from 'pg';
import { loadRootEnv } from './client';

loadRootEnv();

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL missing');

const target = new URL(url);
const targetDb = target.pathname.replace(/^\//, '') || 'bali_v2';

// Connect to an existing maintenance db with the same creds.
const admin = new URL(url);
admin.pathname = '/bali';

const client = new pg.Client({
  connectionString: admin.toString(),
  ssl: { rejectUnauthorized: false },
});

const main = async () => {
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDb]);
  if (exists.rowCount && exists.rowCount > 0) {
    console.log(`database "${targetDb}" already exists — nothing to do`);
  } else {
    // Identifier can't be parameterized; targetDb comes from our own env file.
    if (!/^[a-z0-9_]+$/.test(targetDb)) throw new Error(`unsafe database name: ${targetDb}`);
    await client.query(`CREATE DATABASE ${targetDb}`);
    console.log(`created database "${targetDb}"`);
  }
  await client.end();
};

main().catch(async (err) => {
  console.error('create-database failed:', err.message);
  await client.end().catch(() => {});
  process.exit(1);
});
