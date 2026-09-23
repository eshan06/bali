import type { EventType, FeedEvent, ParticipationState, SessionSnapshot } from '@bali/shared';
import { describe, expect, it } from 'vitest';

import {
  applyEvent,
  fromSnapshot,
  gridDisplay,
  mergeSnapshot,
  snapshotIsFresh,
  staleness,
  type Students,
} from './grid-state';

const T0 = '2026-01-01T08:00:00.000Z';
const T1 = '2026-01-01T08:05:00.000Z';

function snapshot(
  latestSeq: number,
  students: { id: string; name?: string; state?: ParticipationState | null }[],
): SessionSnapshot {
  return {
    session: { id: 's1', classId: 'c1', startedAt: T0, endsAt: T1 },
    ended: false,
    latestSeq,
    students: students.map((s) => ({
      enrollmentId: `e-${s.id}`,
      studentId: s.id,
      displayName: s.name ?? s.id,
      state: s.state === undefined ? 'focused' : s.state,
      joinedAt: T0,
      lastSeenAt: T0,
      endedAt: null,
    })),
  };
}

function evt(seq: number, type: EventType, userId: string | null, at = T1): FeedEvent {
  return { seq, eventId: `ev-${seq}`, type, userId, occurredAt: at, payload: null };
}

describe('grid-state', () => {
  it('builds the roster from a snapshot', () => {
    const s = fromSnapshot(snapshot(5, [{ id: 'ana' }, { id: 'ben' }]));
    expect(Object.keys(s).sort()).toEqual(['ana', 'ben']);
    expect(s.ana.state).toBe('focused');
    expect(s.ana.joinedAt).toBeInstanceOf(Date);
  });

  it('applies unlock and refocus to the right student only', () => {
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }, { id: 'ben' }]));
    s = applyEvent(s, evt(6, 'unlock', 'ana'));
    expect(s.ana.state).toBe('unlocked');
    expect(s.ben.state).toBe('focused');
    s = applyEvent(s, evt(7, 'refocus', 'ana'));
    expect(s.ana.state).toBe('focused');
  });

  it('an unlock never softens a live protection off, and a re-tap clears it (mirrors the engine)', () => {
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
    s = applyEvent(s, evt(6, 'protection_off', 'ana'));
    s = applyEvent(s, evt(7, 'unlock', 'ana'));
    expect(s.ana.state).toBe('protection_off');
    s = applyEvent(s, evt(8, 'tap_in', 'ana'));
    expect(s.ana.state).toBe('focused');
  });

  it('ends every live participation on session_ended', () => {
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }, { id: 'ben' }]));
    s = applyEvent(s, evt(9, 'session_ended', null));
    expect(s.ana.endedAt).toBeInstanceOf(Date);
    expect(s.ben.endedAt).toBeInstanceOf(Date);
  });

  it('marks a removed student as ended', () => {
    let s = fromSnapshot(snapshot(5, [{ id: 'cal' }]));
    s = applyEvent(s, evt(6, 'enrollment_removed', 'cal'));
    expect(s.cal.endedAt).toBeInstanceOf(Date);
  });

  it('leaves the roster untouched for went_silent (silence is derived, not stored)', () => {
    const s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
    expect(applyEvent(s, evt(6, 'went_silent', 'ana'))).toBe(s);
  });

  it('leaves the roster untouched for armed_tap_skipped (the student it names never joined)', () => {
    // A Start that declines a waiting tap — the tap it records had already
    // landed elsewhere — records the skip in this session's feed, naming the
    // student. It is history, not a join: painting a chip from it would put a
    // student in a session they are not in. One who is enrolled already shows
    // from the snapshot, as absent.
    const s = fromSnapshot(snapshot(5, [{ id: 'ana', state: null }]));
    expect(applyEvent(s, evt(6, 'armed_tap_skipped', 'ana'))).toBe(s);
    expect(applyEvent(s, evt(7, 'armed_tap_skipped', 'zed'))).toBe(s);
  });

  it('ignores an event with no user', () => {
    const s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
    expect(applyEvent(s, evt(6, 'unlock', null))).toBe(s);
  });

  it('surfaces a student the snapshot never carried rather than dropping the event', () => {
    // A mid-session joiner, or one removed whose phone then unlocks: the record
    // is durable either way, so the grid must not stay silent about it.
    const s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
    const withCal = applyEvent(s, evt(6, 'unlock', 'cal'));
    expect(withCal.cal).toBeDefined();
    expect(withCal.cal.state).toBe('unlocked');

    const joined = applyEvent(s, evt(6, 'tap_in', 'dana'));
    expect(joined.dana.state).toBe('focused');
  });

  it('never rewinds last contact when the overlap replays an old event', () => {
    // The first connect resumes at latestSeq - overlap, so events the snapshot
    // already reflects come back. A stale tap_in must not rewind lastSeenAt and
    // flash "Silent" on a phone that has been checking in all along.
    const snap = snapshot(30, [{ id: 'ana' }]);
    let s = fromSnapshot(snap);
    const fresh = new Date('2026-01-01T08:10:00.000Z');
    s = applyEvent(s, evt(30, 'came_back', 'ana', fresh.toISOString()));
    expect(s.ana.lastSeenAt).toEqual(fresh);

    s = applyEvent(s, evt(12, 'tap_in', 'ana', '2026-01-01T08:00:00.000Z'));
    expect(s.ana.lastSeenAt).toEqual(fresh); // held, not rewound
  });

  it('ends the chip when the phone leaves for another teacher session', () => {
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
    s = applyEvent(s, evt(6, 'left_for_other_session', 'ana'));
    expect(s.ana.endedAt).toBeInstanceOf(Date);
  });

  describe('mergeSnapshot', () => {
    it('keeps a student the refreshed roster no longer carries', () => {
      // Cal was removed mid-session and then his phone unlocked: the roster
      // (active enrollments only) drops him, but the grid must not.
      let s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
      s = applyEvent(s, evt(6, 'unlock', 'cal'));
      const merged = mergeSnapshot(s, snapshot(7, [{ id: 'ana' }]));
      expect(merged.cal).toBeDefined();
      expect(merged.cal.state).toBe('unlocked');
      expect(merged.ana).toBeDefined();
    });

    it('lets the snapshot win for students it does carry', () => {
      let s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
      s = applyEvent(s, evt(6, 'unlock', 'ana'));
      const merged = mergeSnapshot(s, snapshot(7, [{ id: 'ana', state: 'focused' }]));
      expect(merged.ana.state).toBe('focused');
    });
  });

  describe('snapshotIsFresh — the refresh must never roll the grid backwards', () => {
    it('rejects a snapshot older than the newest applied event', () => {
      // The race: the refresh reads at seq 20, Ana unlocks (seq 21) and the
      // stream applies it, then the older snapshot resolves. Applying it would
      // show "Focused" for an unshielded phone, and the stream never re-sends
      // that event.
      expect(snapshotIsFresh(20, 21)).toBe(false);
    });

    it('accepts a snapshot at or newer than what the stream applied', () => {
      expect(snapshotIsFresh(21, 21)).toBe(true);
      expect(snapshotIsFresh(22, 21)).toBe(true);
    });

    it('holds the unlock when the guard is honoured', () => {
      let s: Students = fromSnapshot(snapshot(20, [{ id: 'ana' }]));
      s = applyEvent(s, evt(21, 'unlock', 'ana'));
      const applied = 21; // the stream has applied the unlock
      const stale = snapshot(20, [{ id: 'ana' }]); // in-flight, read before the unlock
      if (snapshotIsFresh(stale.latestSeq, applied)) s = fromSnapshot(stale);
      expect(s.ana.state).toBe('unlocked');
    });
  });
});

describe('gridDisplay', () => {
  const now = new Date(T1);

  it('shows a removed student whose phone then unlocked as unprotected, not as "Left"', () => {
    // The ISSUES #2 case seen from the teacher's screen: the student is out of
    // the roster, but their phone is unshielded and the record is permanent.
    // deriveDisplayState answers 'ended' for anything with an endedAt, which
    // would put the quietest chip on the grid over exactly the event the rule
    // exists to surface.
    let students = fromSnapshot(snapshot(1, [{ id: 'ana' }]));
    students = applyEvent(students, evt(2, 'enrollment_removed', 'ana'));
    expect(gridDisplay(students.ana, now)).toBe('ended');

    students = applyEvent(students, evt(3, 'unlock', 'ana'));
    expect(gridDisplay(students.ana, now)).toBe('left_unprotected');
  });

  it('shows protection_off after leaving as its own loud chip, never as an unlock', () => {
    let students = fromSnapshot(snapshot(1, [{ id: 'ana' }]));
    students = applyEvent(students, evt(2, 'enrollment_removed', 'ana'));
    students = applyEvent(students, evt(3, 'protection_off', 'ana'));
    expect(gridDisplay(students.ana, now)).toBe('left_protection_off');
  });

  it('keeps protection off through the bell, and an unlock afterwards does not relabel it', () => {
    // Protection off is never an unlock: not while live, not once the
    // participation ends — the engine leaves the stored state alone either way.
    let students = fromSnapshot(snapshot(1, [{ id: 'ana' }]));
    students = applyEvent(students, evt(2, 'protection_off', 'ana'));
    students = applyEvent(students, evt(3, 'session_expired', null));
    expect(gridDisplay(students.ana, now)).toBe('left_protection_off');
    students = applyEvent(students, evt(4, 'unlock', 'ana'));
    expect(students.ana.state).toBe('protection_off');
    expect(gridDisplay(students.ana, now)).toBe('left_protection_off');
  });

  it('leaves the ordinary states alone', () => {
    const students = fromSnapshot(snapshot(1, [{ id: 'ana' }, { id: 'ben', state: null }]));
    // Still enrolled and focused, seen within the threshold.
    expect(gridDisplay(students.ana, new Date(T0))).toBe('focused');
    // Enrolled but never tapped in.
    expect(gridDisplay(students.ben, now)).toBe('absent');
    // A plain departure with no unlock still reads as 'ended'.
    const left = applyEvent(students, evt(2, 'enrollment_left', 'ana'));
    expect(gridDisplay(left.ana, now)).toBe('ended');
  });

  it('derives silence from last contact, unchanged', () => {
    const students = fromSnapshot(snapshot(1, [{ id: 'ana' }]));
    // T0 + 5 minutes with no contact is well past the 90s threshold.
    expect(gridDisplay(students.ana, now)).toBe('silent');
  });
});

describe('staleness', () => {
  const T0 = 1_000_000;
  /** Both clocks together — the ordinary case, where the stream is the grid. */
  const both = (at: number) => ({
    lastStreamActivityAt: at,
    lastGridActivityAt: at,
    heartbeatMs: 20_000,
  });

  it('says reconnecting whenever the client knows it is disconnected', () => {
    for (const status of ['connecting', 'reconnecting'] as const) {
      expect(staleness({ ...both(T0), status, now: T0 + 4_000 })).toEqual({
        reason: 'reconnecting',
        secondsAgo: 4,
      });
    }
  });

  it('stays quiet on an open stream that is merely between events', () => {
    // Three heartbeats' grace: a quiet class emits no events at all, so the
    // banner must not flap on one slow tick.
    expect(staleness({ ...both(T0), status: 'open', now: T0 + 59_000 })).toBeNull();
  });

  it('says stale when the stream is open but the server has gone silent', () => {
    // The shape the old banner could not see: open, green, and guessing.
    expect(staleness({ ...both(T0), status: 'open', now: T0 + 61_000 })).toEqual({
      reason: 'stale',
      secondsAgo: 61,
    });
  });

  it('reports a dead stream even while the snapshot poll keeps the grid current', () => {
    /*
     * The scenario the feature exists for, and the one a single clock could
     * not see: a wedged proxy or a hub that died without closing the socket.
     * The stream is `open` and has delivered nothing for three minutes, while
     * the 15 s poll keeps answering — so on one shared clock the counter was
     * reset four times per threshold and the banner never appeared at all.
     *
     * Both halves matter here. It warns, AND the age it reports is the grid's
     * (5s, true) rather than the stream's (180s, alarming and wrong).
     */
    expect(
      staleness({
        status: 'open',
        lastStreamActivityAt: T0,
        lastGridActivityAt: T0 + 175_000,
        now: T0 + 180_000,
        heartbeatMs: 20_000,
      }),
    ).toEqual({ reason: 'stale', secondsAgo: 5 });
  });

  it('a stream delivering into a poll that has died is not stale', () => {
    // The mirror, so the two clocks cannot be quietly swapped: the stream is
    // alive, only the poll has stopped. Nothing is wrong with the feed, and
    // the age reported is still the grid's.
    expect(
      staleness({
        status: 'open',
        lastStreamActivityAt: T0 + 180_000,
        lastGridActivityAt: T0 + 180_000,
        now: T0 + 180_500,
        heartbeatMs: 20_000,
      }),
    ).toBeNull();
  });

  it('never reports a negative age when the clock steps backwards', () => {
    expect(staleness({ ...both(T0), status: 'reconnecting', now: T0 - 5_000 })).toEqual({
      reason: 'reconnecting',
      secondsAgo: 0,
    });
  });
});
