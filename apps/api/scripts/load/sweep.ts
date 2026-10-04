import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { createDb } from '@bali/db';
import { databaseUrl } from '@bali/db/testing';
import { SILENCE_THRESHOLD_MS } from '@bali/shared';

import { sweep, SWEEP_INTERVAL_MS } from '../../src/sweep.js';
import { harnessServer, SCHOOL_FILE, type SchoolFile } from './school.js';

/*
 * `npm run load:sweep` — the API's own sweep at the bell's size (Phase 4, L2b), timed on what the
 * gate left, once the API has stopped (its minute sweep would race this for the rows): past the
 * silence threshold, so it marks all 600 phones; then past every bell, so it ends all 30 sessions.
 * Postgres's deadlock count says whether the per-row retry (#56's review) ever ran.
 */
const school = JSON.parse(readFileSync(SCHOOL_FILE, 'utf8')) as SchoolFile;
const url = databaseUrl(harnessServer(process.env), school.api.database);
const classes = school.teachers.length + school.teachers.filter((t) => t.secondClassId).length;

/**
 * Postgres's deadlock count for the database, once no other client is connected to it: a backend
 * flushes its pending counts as it exits, before it leaves pg_stat_activity, so none is missed.
 */
async function deadlocks(): Promise<number> {
  const reader = createDb(url);
  try {
    for (let waited = 0; ; waited += 100) {
      const [others] = await reader.$client<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity where datname = current_database()
          and backend_type = 'client backend' and pid <> pg_backend_pid()`;
      if (others!.n === 0) break;
      if (waited >= 10_000) throw new Error('other clients stayed connected to the database');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const [row] = await reader.$client<{ n: number }[]>`
      select deadlocks::int as n from pg_stat_database where datname = current_database()`;
    return row!.n;
  } finally {
    await reader.$client.end();
  }
}

/** The bell the gate left, swept twice and timed. */
async function sweepTheBell() {
  const db = createDb(url);
  const timed = async (now: number) => {
    const startedAt = performance.now();
    const result = await sweep(db, new Date(now));
    return { ...result, ms: Math.round(performance.now() - startedAt) };
  };
  try {
    // Times as epoch milliseconds: Drizzle has the driver hand timestamps over unparsed.
    const [bell] = await db.$client<
      { focused: number; running: number; lastHeard: number; lastEnd: number }[]
    >`
      select
        (select count(*)::int from participations
          where ended_at is null and state = 'focused' and silent_since is null) as focused,
        (select count(*)::int from sessions where ended_at is null) as running,
        (select (extract(epoch from max(coalesce(last_seen_at, joined_at))) * 1000)::float8
          from participations where ended_at is null) as "lastHeard",
        (select (extract(epoch from max(ends_at)) * 1000)::float8
          from sessions where ended_at is null) as "lastEnd"`;
    if (bell!.focused !== school.students.length || bell!.running !== classes) {
      throw new Error(
        `expected the gate's bell, ${school.students.length} phones focused in ${classes} ` +
          `sessions, and found ${bell!.focused} in ${bell!.running}: seed, then run the gate once`,
      );
    }
    const silence = await timed(bell!.lastHeard + SILENCE_THRESHOLD_MS + 1);
    const end = await timed(bell!.lastEnd + 1);
    const [ended] = await db.$client<{ n: number }[]>`
      select count(*)::int as n from participations where ended_reason = 'session_expired'`;
    return { focused: bell!.focused, silence, end, endedParticipations: ended!.n };
  } finally {
    await db.$client.end();
  }
}

const atGate = await deadlocks();
const { focused, silence, end, endedParticipations } = await sweepTheBell();
const inSweep = (await deadlocks()) - atGate;
console.log(
  `load:sweep — silence: ${silence.wentSilent} of ${focused} phones marked in ${silence.ms} ms ` +
    `(${(silence.ms / Math.max(1, silence.wentSilent)).toFixed(2)} ms each); the bell: ` +
    `${end.expired} of ${classes} sessions ended at once, ${endedParticipations} participations ` +
    `with them, in ${end.ms} ms; deadlocks: ${atGate} during the gate, ${inSweep} in the sweep`,
);
// The retry handles a deadlock, so it fails nothing; but L3 is revisited at the first one.
if (atGate + inSweep > 0) console.log('::warning::deadlocks met the gate: revisit L3 (PLAN.md)');
const failures = [
  silence.wentSilent !== focused && 'not every quiet phone was marked silent',
  silence.expired !== 0 && 'a session ended before every phone was quiet',
  end.expired !== classes && 'not every session ended at its bell',
  silence.ms + end.ms >= SWEEP_INTERVAL_MS && 'the sweep no longer fits in its minute',
].filter((failure) => failure !== false);
if (failures.length > 0) {
  console.error(`load:sweep failed: ${failures.join('; ')}`);
  process.exitCode = 1;
}
