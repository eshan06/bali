import { writeFileSync } from 'node:fs';

import { harnessServer, harnessTeachers, SCHOOL_FILE, seedSchool } from './school.js';

/*
 * `npm run load:seed` — the load harness's school in a fresh `bali_load` database on this
 * machine's Postgres (TEST_DATABASE_URL), and the file the load script reads (school.ts).
 * LOAD_TEACHERS makes a larger school for the bell's measurement (#336); the gate names none.
 */
const school = await seedSchool(
  harnessServer(process.env),
  undefined,
  harnessTeachers(process.env),
);
// Bearer tokens, if only for this school's API: readable by their owner alone.
writeFileSync(SCHOOL_FILE, `${JSON.stringify(school, null, 2)}\n`, { mode: 0o600 });
console.log(
  `load:seed — ${school.teachers.length} teachers and ${school.students.length} students in ` +
    `the database ${school.api.database}; wrote ${SCHOOL_FILE}`,
);
