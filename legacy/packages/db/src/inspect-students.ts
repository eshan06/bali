import * as path from 'path';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  const args = process.argv.slice(2);
  const deleteIdx = args.indexOf('--delete-orphans');
  const email = deleteIdx >= 0 ? args[deleteIdx + 1] : null;
  const deleteIdIdx = args.indexOf('--delete-id');
  const idToDelete = deleteIdIdx >= 0 ? args[deleteIdIdx + 1] : null;

  const all = await pool.query(
    `SELECT id, school_id, email, first_name, last_name, cognito_sub, created_at
     FROM students ORDER BY created_at DESC`
  );
  console.log(`\nstudents (${all.rows.length}):`);
  for (const r of all.rows) {
    console.log(
      `  ${r.id}  email=${r.email ?? '∅'}  school=${r.school_id ?? '∅'}  sub=${r.cognito_sub ?? '∅'}  ${r.first_name} ${r.last_name}`
    );
  }

  if (idToDelete) {
    const res = await pool.query(
      `DELETE FROM students WHERE id = $1 RETURNING id`,
      [idToDelete]
    );
    console.log(`\nDeleted ${res.rowCount} row(s) with id=${idToDelete}.`);
  }

  if (email) {
    const res = await pool.query(
      `DELETE FROM students WHERE cognito_sub IS NULL AND LOWER(email) = LOWER($1) RETURNING id`,
      [email]
    );
    console.log(`\nDeleted ${res.rowCount} orphan row(s) for ${email}.`);
  }

  if (!idToDelete && !email) {
    console.log(`\n(pass --delete-orphans <email> to remove rows with NULL cognito_sub, or --delete-id <uuid> to remove a specific row)`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
