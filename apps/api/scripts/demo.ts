import {
  armTap,
  blocks,
  checkIn,
  classes,
  endSession,
  enrollments,
  events,
  MIGRATIONS_DIR,
  participations,
  refocus,
  resolveTapTarget,
  schema,
  schools,
  startSession,
  tapIn,
  unlock,
  users,
} from '@bali/db';
import { deriveDisplayState } from '@bali/shared';
import { PGlite } from '@electric-sql/pglite';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { randomUUID } from 'node:crypto';

/*
 * A runnable end-to-end demo of the Phase-1 core, against an in-process
 * Postgres (PGlite) — no external services. It walks the classroom flow the
 * architecture doc describes and prints the state after each step, so the whole
 * tap → arm → start → join → unlock → refocus → end path is visible at once.
 * Run with `npm run demo`.
 */

function line(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  const one = <T>(rows: T[]): T => {
    const r = rows[0];
    if (!r) throw new Error('expected a row');
    return r;
  };

  line('seed a classroom');
  const school = one(await db.insert(schools).values({ name: 'Demo School' }).returning());
  const teacher = one(
    await db
      .insert(users)
      .values({
        cognitoId: 'demo-teacher',
        role: 'teacher',
        schoolId: school.id,
        displayName: 'Ms. Rivera',
      })
      .returning(),
  );
  const ana = one(
    await db
      .insert(users)
      .values({ cognitoId: 'demo-ana', role: 'student', schoolId: school.id, displayName: 'Ana' })
      .returning(),
  );
  const ben = one(
    await db
      .insert(users)
      .values({ cognitoId: 'demo-ben', role: 'student', schoolId: school.id, displayName: 'Ben' })
      .returning(),
  );
  const klass = one(
    await db
      .insert(classes)
      .values({ teacherId: teacher.id, schoolId: school.id, name: 'Period 1', joinCode: 'ABC123' })
      .returning(),
  );
  await db.insert(enrollments).values([
    { classId: klass.id, studentId: ana.id },
    { classId: klass.id, studentId: ben.id },
  ]);
  const block = one(
    await db.insert(blocks).values({ tagId: 'BLOCK-TAG-1', teacherId: teacher.id }).returning(),
  );
  console.log(`Ms. Rivera teaches "Period 1"; Ana and Ben are enrolled. Block tag: ${block.tagId}`);

  line('7:58am — Ana taps the block before class (armed)');
  const anaTarget = await resolveTapTarget(db, block.tagId, ana.id);
  console.log(
    `resolveTapTarget → running session: ${anaTarget?.session ? 'yes' : 'none (will arm)'}`,
  );
  const armed = await armTap(db, {
    studentId: ana.id,
    teacherId: teacher.id,
    blockId: block.id,
    eventId: randomUUID(),
    deviceTime: new Date(),
    expiresAt: new Date(Date.now() + 6 * 60 * 60_000),
  });
  console.log(`Ana's tap → ${armed.outcome} (waiting for the teacher)`);

  line('8:00am — the teacher starts the session');
  const started = await startSession(db, {
    classId: klass.id,
    startedAt: new Date(),
    endsAt: new Date(Date.now() + 25 * 60_000),
  });
  console.log(
    `session ${started.outcome}; armed taps converted: ${started.armedConverted} (Ana is now focused)`,
  );
  const session = started.session;

  line('8:01am — Ben taps in');
  const benTarget = await resolveTapTarget(db, block.tagId, ben.id);
  if (benTarget?.session) {
    const r = await tapIn(db, {
      sessionId: benTarget.session.id,
      studentId: ben.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    console.log(`Ben's tap → ${r.outcome} (${r.state})`);
  }

  line('8:05am — Ana hits emergency unlock, then refocuses');
  await unlock(db, {
    sessionId: session.id,
    studentId: ana.id,
    eventId: randomUUID(),
    deviceTime: new Date(),
  });
  await checkIn(db, { sessionId: session.id, studentId: ana.id, deviceTime: new Date() });
  await refocus(db, {
    sessionId: session.id,
    studentId: ana.id,
    eventId: randomUUID(),
    deviceTime: new Date(),
  });

  line('the live grid (derived display state)');
  const live = await db
    .select()
    .from(participations)
    .where(eq(participations.sessionId, session.id));
  const now = new Date();
  for (const p of live) {
    const who = p.studentId === ana.id ? 'Ana' : 'Ben';
    console.log(
      `  ${who}: ${deriveDisplayState({ state: p.state, joinedAt: p.joinedAt, lastSeenAt: p.lastSeenAt, endedAt: p.endedAt }, now)}`,
    );
  }

  line('8:25am — the session ends');
  const ended = await endSession(db, { sessionId: session.id, at: new Date(), reason: 'ended' });
  console.log(`ended; participations closed: ${ended.endedParticipations}`);

  line('the permanent event log (rule 6)');
  const log = await db
    .select()
    .from(events)
    .where(eq(events.sessionId, session.id))
    .orderBy(asc(events.seq));
  for (const e of log) {
    const who = e.userId === ana.id ? 'Ana' : e.userId === ben.id ? 'Ben' : '—';
    console.log(`  #${e.seq}  ${e.type.padEnd(24)} ${who}`);
  }

  await pg.close();
  console.log('\ndemo complete.');
}

await main();
