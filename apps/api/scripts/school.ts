import { createDb, parseSchoolCommand, SCHOOL_USAGE, type SchoolCommand } from '@bali/db';

import { analyticsConfig, createAnalytics, ownerEnds } from '../src/analytics.js';
import { detailOf } from './demo/cognito.js';

/*
 * The owner's school commands (`npm run school -- <command>`): add a school,
 * record its data agreement, mint a teacher invite, list them, export one
 * student's record (JSON on standard output, nothing else), dispose of a
 * school's data (C6a), record its year's last day and run its retention
 * (C6b), and end a running lesson. They run against
 * DATABASE_URL, as `npm run migrate` does; the commands are @bali/db's
 * (school-command.ts). The retention run queues the sign-ins it removes under
 * AUTH_ISSUER, this deploy's Cognito pool, and refuses without it. An invite's
 * code is printed to this terminal, once, and nowhere else.
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
// A lesson the owner's command ends is counted for PostHog as the API counts one (A2), with the
// API service's own POSTHOG_KEY in the shell it runs in; off while that is unset. Its failures go
// to standard error, never to the output (an export's JSON).
const analytics = createAnalytics(analyticsConfig(process.env), db, {
  warn: (details, message) => console.error(`school: ${message}`, details),
  error: (details, message) => console.error(`school: ${message}`, details),
});
try {
  await command({
    db,
    print: (line) => console.log(line),
    issuer: process.env.AUTH_ISSUER,
    ended: ownerEnds(analytics),
  });
} catch (err) {
  console.error(`school: ${detailOf(err)}`);
  process.exitCode = 1;
} finally {
  await analytics.settled();
  await db.$client.end();
}
