import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkIn,
  endSession,
  markSilentParticipations,
  protectionOff,
  refocus,
  startSession,
  tapIn,
  unlock,
} from '../src/transitions.js';
import { classes, enrollments, events, participations, schools, users } from '../src/schema.js';
import { makeTestDb } from '../src/testing.js';
import type { Database } from '../src/types.js';

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await makeTestDb());
});

afterAll(async () => {
  await close();
});

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) throw new Error('expected exactly one row');
  return row;
}

/** A session that started `ago` back (a minute by default), and one enrolled student it focused. */
async function seed(tag: string, ago = 60_000) {
  const school = one(
    await db
      .insert(schools)
      .values({ name: `S ${tag}` })
      .returning(),
  );
  const teacher = one(
    await db
      .insert(users)
      .values({ cognitoId: `t-${tag}`, role: 'teacher', schoolId: school.id })
      .returning(),
  );
  const student = one(
    await db
      .insert(users)
      .values({ cognitoId: `s-${tag}`, role: 'student', schoolId: school.id })
      .returning(),
  );
  const klass = one(
    await db
      .insert(classes)
      .values({
        teacherId: teacher.id,
        schoolId: school.id,
        name: `C ${tag}`,
        joinCode: `J-${tag}`,
      })
      .returning(),
  );
  await db.insert(enrollments).values({ classId: klass.id, studentId: student.id });
  const session = (
    await startSession(db, {
      classId: klass.id,
      startedAt: new Date(Date.now() - ago),
      endsAt: new Date(Date.now() + 25 * 60_000),
    })
  ).session;
  await tapIn(db, {
    sessionId: session.id,
    studentId: student.id,
    eventId: randomUUID(),
    deviceTime: session.startedAt,
  });
  return { session, studentId: student.id };
}

async function backdateContact(sessionId: string, studentId: string, agoMs: number) {
  await db
    .update(participations)
    .set({ lastSeenAt: new Date(Date.now() - agoMs) })
    .where(and(eq(participations.sessionId, sessionId), eq(participations.studentId, studentId)));
}

async function eventsOf(sessionId: string, type: string) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.type, type as 'went_silent')));
}

async function participationOf(sessionId: string, studentId: string) {
  return one(
    await db
      .select()
      .from(participations)
      .where(and(eq(participations.sessionId, sessionId), eq(participations.studentId, studentId))),
  );
}

const SILENT_AGO = 5 * 60_000; // well past the 90s threshold

describe('markSilentParticipations', () => {
  it('opens an episode for a focused phone gone quiet, exactly once', async () => {
    const { session, studentId } = await seed('sil-open');
    await backdateContact(session.id, studentId, SILENT_AGO);

    expect(await markSilentParticipations(db, new Date())).toBe(1);
    expect(await eventsOf(session.id, 'went_silent')).toHaveLength(1);
    expect((await participationOf(session.id, studentId)).silentSince).not.toBeNull();

    // Already open — a second sweep opens nothing and emits nothing.
    expect(await markSilentParticipations(db, new Date())).toBe(0);
    expect(await eventsOf(session.id, 'went_silent')).toHaveLength(1);
  });

  it('a tap on a still-live silent phone closes the episode with one came_back', async () => {
    // The app is force-quit, the sweep opens an episode, then the student
    // reopens and taps the block while the participation is still live. The
    // upsert clears the marker either way — without closing the episode first
    // the went_silent would never be paired and a report would over-count the
    // silence by the rest of the session.
    const { session, studentId } = await seed('sil-live-tap');
    await backdateContact(session.id, studentId, SILENT_AGO);
    expect(await markSilentParticipations(db, new Date())).toBe(1);
    expect(await eventsOf(session.id, 'went_silent')).toHaveLength(1);

    await tapIn(db, {
      sessionId: session.id,
      studentId,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });

    expect((await participationOf(session.id, studentId)).silentSince).toBeNull();
    expect(await eventsOf(session.id, 'came_back')).toHaveLength(1);
  });

  it('a revived participation starts a fresh silence stint, not a stale one', async () => {
    // Regression: the marker must never outlive the participation that opened
    // it. Tap in → go quiet (episode opens) → the stint ends (the student tapped
    // another teacher's block, or was removed) → they tap back in while the
    // session still runs. A surviving silent_since would either fire a came_back
    // for an episode that no longer exists, or suppress the next went_silent
    // forever because the sweep's isNull(silent_since) guard skips the row.
    const { session, studentId } = await seed('sil-revive');
    await backdateContact(session.id, studentId, SILENT_AGO);
    expect(await markSilentParticipations(db, new Date())).toBe(1);
    expect((await participationOf(session.id, studentId)).silentSince).not.toBeNull();

    await db
      .update(participations)
      .set({ endedAt: new Date(), endedReason: 'left_for_other_session' })
      .where(
        and(eq(participations.sessionId, session.id), eq(participations.studentId, studentId)),
      );

    await tapIn(db, {
      sessionId: session.id,
      studentId,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });

    const revived = await participationOf(session.id, studentId);
    expect(revived.endedAt).toBeNull();
    expect(revived.silentSince).toBeNull();

    // A heartbeat now must not claim a return from an episode that is over.
    await checkIn(db, { sessionId: session.id, studentId });
    expect(await eventsOf(session.id, 'came_back')).toHaveLength(0);

    // And going quiet again opens a genuinely new episode.
    await backdateContact(session.id, studentId, SILENT_AGO);
    expect(await markSilentParticipations(db, new Date())).toBe(1);
    expect(await eventsOf(session.id, 'went_silent')).toHaveLength(2);
  });

  it('leaves a phone still in contact alone', async () => {
    const { session } = await seed('sil-fresh'); // lastSeenAt null, joinedAt just now
    expect(await markSilentParticipations(db, new Date())).toBe(0);
    expect(await eventsOf(session.id, 'went_silent')).toHaveLength(0);
  });

  it('never marks an unlocked phone silent — only focused goes silent', async () => {
    const { session, studentId } = await seed('sil-unlocked');
    await unlock(db, {
      sessionId: session.id,
      studentId,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    await backdateContact(session.id, studentId, SILENT_AGO);
    expect(await markSilentParticipations(db, new Date())).toBe(0);
    expect(await eventsOf(session.id, 'went_silent')).toHaveLength(0);
  });

  it('never marks an ended participation silent', async () => {
    const { session, studentId } = await seed('sil-ended');
    await backdateContact(session.id, studentId, SILENT_AGO);
    await endSession(db, { sessionId: session.id, at: new Date(), reason: 'ended' });
    expect(await markSilentParticipations(db, new Date())).toBe(0);
    expect(await eventsOf(session.id, 'went_silent')).toHaveLength(0);
  });
});

describe('checkIn and silence episodes', () => {
  it('a normal heartbeat writes no history (decision 7)', async () => {
    const { session, studentId } = await seed('sil-heartbeat');
    const res = await checkIn(db, { sessionId: session.id, studentId });
    expect(res.status).toBe('live');
    expect(await eventsOf(session.id, 'went_silent')).toHaveLength(0);
    expect(await eventsOf(session.id, 'came_back')).toHaveLength(0);
  });

  it('a check-in that ends a silence episode emits exactly one came_back', async () => {
    const { session, studentId } = await seed('sil-return');
    await backdateContact(session.id, studentId, SILENT_AGO);
    await markSilentParticipations(db, new Date());
    expect((await participationOf(session.id, studentId)).silentSince).not.toBeNull();

    const res = await checkIn(db, { sessionId: session.id, studentId });
    expect(res.status).toBe('live');
    expect((await participationOf(session.id, studentId)).silentSince).toBeNull();
    expect(await eventsOf(session.id, 'came_back')).toHaveLength(1);

    // The episode is closed — a further heartbeat adds no second came_back.
    await checkIn(db, { sessionId: session.id, studentId });
    expect(await eventsOf(session.id, 'came_back')).toHaveLength(1);
  });

  // A check-in takes no time from the phone (decision 7): what a fast or slow
  // clock does to it is pinned where the claim arrives, the route's tests
  // (apps/api/test/session-lifecycle.test.ts).
});

describe('a came_back is the server’s, never the phone’s claim (decision 7)', () => {
  const MINUTE = 60_000;

  /**
   * A phone 20 minutes into a lesson, quiet since 12 minutes ago, which the sweep marked silent 10
   * minutes ago. What it sends next claims 15 minutes ago: a record made out of contact reads so,
   * and so does every record from a clock set back.
   */
  async function wentQuiet(tag: string) {
    const { session, studentId } = await seed(tag, 20 * MINUTE);
    await backdateContact(session.id, studentId, 12 * MINUTE);
    // Counted in this session alone: the suite shares one database.
    await markSilentParticipations(db, new Date(Date.now() - 10 * MINUTE));
    expect(await eventsOf(session.id, 'went_silent')).toHaveLength(1);
    const sent = () => ({
      sessionId: session.id,
      studentId,
      eventId: randomUUID(),
      deviceTime: new Date(Date.now() - 15 * MINUTE),
    });
    return { session, studentId, sent };
  }

  it.each(['tap', 'refocus', 'unlock', 'protection off'] as const)(
    'closed by the phone’s %s, which claims a time before the silence: stamped when the server heard it',
    async (kind) => {
      const { session, sent } = await wentQuiet(`back-${kind.replace(' ', '-')}`);
      const heard = Date.now();
      if (kind === 'tap') await tapIn(db, sent());
      else if (kind === 'refocus') await refocus(db, sent());
      else if (kind === 'unlock') await unlock(db, sent());
      else await protectionOff(db, sent());

      const silent = one(await eventsOf(session.id, 'went_silent'));
      const back = one(await eventsOf(session.id, 'came_back'));
      // Stamped with the claim, it fell 5 minutes before the went_silent it closes.
      expect(back.occurredAt.getTime()).toBeGreaterThan(silent.occurredAt.getTime());
      expect(back.occurredAt.getTime()).toBeGreaterThanOrEqual(heard);
      expect(back.occurredAt.getTime()).toBeLessThanOrEqual(Date.now());
    },
  );

  it('is never before the went_silent it closes, though the sweep’s clock ran ahead', async () => {
    // Two processes sweep and hear phones, each by its own clock: a went_silent stamped a little
    // ahead of the contact that closes it still comes first.
    const { session, studentId } = await seed('back-sweep-ahead');
    await backdateContact(session.id, studentId, SILENT_AGO);
    await markSilentParticipations(db, new Date(Date.now() + 2 * MINUTE));
    await tapIn(db, {
      sessionId: session.id,
      studentId,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });

    const silent = one(await eventsOf(session.id, 'went_silent'));
    expect(one(await eventsOf(session.id, 'came_back')).occurredAt).toEqual(silent.occurredAt);
  });
});
