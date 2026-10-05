import { createDb, parseSchoolCommand, SCHOOL_USAGE, type SchoolCommand } from '@bali/db';

import { detailOf } from './demo/cognito.js';

/*
 * The owner's school commands (`npm run school -- <command>`): add a school,
 * record its data agreement, mint a teacher invite, list them, export one
 * student's record (JSON on standard output, nothing else), dispose of a
 * school's data (C6a), record its year's last day and run its retention
 * (C6b). They run against
 * DATABASE_URL, as `npm run migrate` does; the commands are @bali/db's
 * (school-command.ts). An invite's code is printed to this terminal, once, and
 * nowhere else.
 */
let command: SchoolCommand | null;
try {
  command = parseSchoolCommand(process.argv.slice(2));
} catch (err) {
  console.error(`${SCHOOL_USAGE}\n\nschool: ${detailOf(err)}`);
  process.exit(1);
}
if (command === null) {
  console.log(SCHOOL_USAGE);
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('school: DATABASE_URL is not set');
  process.exit(1);
}

const db = createDb(databaseUrl);
try {
  await command({ db, print: (line) => console.log(line) });
} catch (err) {
  console.error(`school: ${detailOf(err)}`);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
