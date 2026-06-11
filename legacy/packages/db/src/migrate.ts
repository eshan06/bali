import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const migrationsDir = path.resolve(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir).sort();

  console.log(`Running ${files.length} migration(s)...`);

  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    console.log(`  Running ${file}...`);
    try {
      await pool.query(sql);
      console.log(`  ✓ ${file}`);
    } catch (err: any) {
      if (err.message?.includes('already exists')) {
        console.log(`  ~ ${file} (already applied)`);
      } else {
        console.error(`  ✗ ${file}: ${err.message}`);
        throw err;
      }
    }
  }

  console.log('Migrations complete.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
