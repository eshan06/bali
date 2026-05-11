import * as path from 'path';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  const rows = await pool.query(
    `SELECT id, device_id, friendly_name, student_id, school_id, registered_at
     FROM devices ORDER BY registered_at DESC`
  );
  console.log(`\ndevices (${rows.rows.length}):`);
  for (const r of rows.rows) {
    console.log(
      `  ${r.id}  device_id=${r.device_id}  name=${r.friendly_name ?? '∅'}  student=${r.student_id ?? '∅'}`
    );
  }

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
