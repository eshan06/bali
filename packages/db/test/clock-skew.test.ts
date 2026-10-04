import { CLOCK_AHEAD_THRESHOLD_MS } from '@bali/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import { getSessionRoster } from '../src/queries.js';
import { classes, enrollments, events, schools, users } from '../src/schema.js';
import { makeTestDb } from '../src/testing.js';
import { protectionOff, refocus, startSession, tapIn, unlock } from '../src/transitions.js';
import type { Database } from '../src/types.js';

/*
 * S9: the engine notes a phone clock far ahead of when the server heard it
 * (`clock_ahead_s` on the payload), and changes nothing else. The server hears
 * each record at the real clock, so these lessons run around the real now.
 */

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await makeTestDb());
});

afterAll(async () => {
  await close();
});

const MIN = 60_000;
const fromNow = (ms: number) => new Date(Date.now() + ms);

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) throw new Error('expected exactly one row');
  return row;
}

/** A class with two students and a session running now: 5 minutes in, 40 to go. */
async function liveClass(tag: string) {
  const school = one(
    await db
      .insert(schools)
      .values({ name: `School ${tag}` })
      .returning(),
  );
  const teacher = one(
    await db
      .insert(users)
      .values({ cognitoId: `teacher-${tag}`, role: 'teacher', schoolId: school.id })
      .returning(),
  );
  const [ana, ben] = await db
    .insert(users)
    .values([
      { cognitoId: `ana-${tag}`, role: 'student', schoolId: school.id },
      { cognitoId: `ben-${tag}`, role: 'student', schoolId: school.id },
    ])
    .returning();
  if (!ana || !ben) throw new Error('expected two students');
  const klass = one(
    await db
      .insert(classes)
      .values({ teacherId: teacher.id, schoolId: school.id, name: tag, joinCode: `SKEW-${tag}` })
      .returning(),
  );
  await db.insert(enrollments).values([
    { classId: klass.id, studentId: ana.id },
    { classId: klass.id, studentId: ben.id },
  ]);
  const { session } = await startSession(db, {
    classId: klass.id,
    startedAt: fromNow(-5 * MIN),
    endsAt: fromNow(40 * MIN),
  });
  return { klass, session, ana, ben };
}

async function stored(eventId: string) {
  return one(await db.select().from(events).where(eq(events.eventId, eventId)));
}

describe('clock skew (S9)', () => {
  it('notes a tap from a clock ahead past the threshold; the clamp and the join are unchanged', async () => {
    const { session, ana } = await liveClass('tap');
    const claimed = fromNow(10 * MIN);
    const eventId = newUuidV7();
    const result = await tapIn(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId,
      deviceTime: claimed,
    });
    expect(result.outcome).toBe('joined');

    const e = await stored(eventId);
    const note = (e.payload as Record<string, number>).clock_ahead_s;
    expect(note).toBeGreaterThanOrEqual(595);
    expect(note).toBeLessThanOrEqual(600);
    // Advisory only: the claim inside the window stands as the time, as rule 1 has it.
    expect(e.occurredAt.getTime()).toBe(claimed.getTime());
  });

  it('notes nothing under the threshold, nor for a clock behind (an offline catch-up)', async () => {
    const { session, ana } = await liveClass('under');
    const tap = newUuidV7();
    await tapIn(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId: tap,
      deviceTime: fromNow(CLOCK_AHEAD_THRESHOLD_MS - 30_000),
    });
    const late = newUuidV7();
    await unlock(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId: late,
      deviceTime: fromNow(-30 * MIN),
      reason: 'bathroom',
    });
    expect((await stored(tap)).payload).toBeNull();
    // Timed before the tap, it is late (A10) — and that is all it says.
    expect((await stored(late)).payload).toEqual({ reason: 'bathroom', recorded_as: 'superseded' });
  });

  it('keeps every other note beside it, and a clock far ahead still clamps to the bell', async () => {
    const { session, ana } = await liveClass('beside');
    await tapIn(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId: newUuidV7(),
      deviceTime: new Date(),
    });
    const eventId = newUuidV7();
    const result = await unlock(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId,
      deviceTime: fromNow(3 * 60 * MIN),
      reason: 'nurse',
    });
    expect(result.outcome).toBe('applied');
    const e = await stored(eventId);
    expect(e.payload).toMatchObject({ reason: 'nurse' });
    expect((e.payload as Record<string, number>).clock_ahead_s).toBeGreaterThanOrEqual(
      3 * 3600 - 5,
    );
    expect(e.occurredAt.getTime()).toBe(session.endsAt.getTime());
  });

  it('notes a refocus, a protection off and an orphan unlock the same way', async () => {
    const { session, ana } = await liveClass('every');
    await tapIn(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId: newUuidV7(),
      deviceTime: new Date(),
    });
    const off = newUuidV7();
    await protectionOff(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId: off,
      deviceTime: fromNow(5 * MIN),
    });
    await tapIn(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId: newUuidV7(),
      deviceTime: new Date(),
    });
    await unlock(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId: newUuidV7(),
      deviceTime: new Date(),
    });
    const back = newUuidV7();
    await refocus(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId: back,
      deviceTime: fromNow(5 * MIN),
    });
    const orphan = newUuidV7();
    await unlock(db, {
      sessionId: newUuidV7(),
      studentId: ana.id,
      eventId: orphan,
      deviceTime: fromNow(5 * MIN),
    });
    for (const id of [off, back, orphan]) {
      expect((await stored(id)).payload).toHaveProperty('clock_ahead_s');
    }
    expect((await stored(orphan)).payload).toMatchObject({ recorded_as: 'unknown_session' });
  });

  it('a replay writes nothing new, the note included', async () => {
    const { session, ana } = await liveClass('replay');
    const eventId = newUuidV7();
    const input = { sessionId: session.id, studentId: ana.id, eventId, deviceTime: new Date() };
    await tapIn(db, input);
    const again = await tapIn(db, { ...input, deviceTime: fromNow(30 * MIN) });
    expect(again.outcome).toBe('replay');
    expect((await stored(eventId)).payload).toBeNull();
  });

  it("the grid's roster marks only the student a noted record came from", async () => {
    const { klass, session, ana, ben } = await liveClass('roster');
    await tapIn(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId: newUuidV7(),
      deviceTime: fromNow(15 * MIN),
    });
    await tapIn(db, {
      sessionId: session.id,
      studentId: ben.id,
      eventId: newUuidV7(),
      deviceTime: new Date(),
    });
    const roster = await getSessionRoster(db, session.id, klass.id);
    const byId = new Map(roster.map((r) => [r.studentId, r]));
    expect(byId.get(ana.id)).toMatchObject({ clockOff: true, state: 'focused' });
    expect(byId.get(ben.id)).toMatchObject({ clockOff: false, state: 'focused' });
    const noted = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.userId, ben.id)));
    expect(noted.every((e) => e.payload === null)).toBe(true);
  });
});
