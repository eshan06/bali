import type {
  EventType,
  FeedEvent,
  ParticipationState,
  SessionSnapshot,
  SnapshotUnlock,
} from '@bali/shared';
import { describe, expect, it } from 'vitest';

import {
  applyEvent,
  fromSnapshot,
  gridDisplay,
  mergeSnapshot,
  snapshotIsFresh,
  staleness,
  type Students,
  unlockNote,
} from './grid-state';

const T0 = '2026-01-01T08:00:00.000Z';
const T1 = '2026-01-01T08:05:00.000Z';

function snapshot(
  latestSeq: number,
  students: {
    id: string;
    name?: string;
    state?: ParticipationState | null;
    endedAt?: string;
    unlock?: SnapshotUnlock;
    protectionOffAfterEnd?: boolean;
  }[],
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
      joinedAt: s.state === null ? null : T0,
      lastSeenAt: s.state === null ? null : T0,
      endedAt: s.endedAt ?? null,
      unlock: s.unlock ?? null,
      protectionOffAfterEnd: s.protectionOffAfterEnd ?? false,
    })),
  };
}

function evt(
  seq: number,
  type: EventType,
  userId: string | null,
  at = T1,
  payload: Record<string, unknown> | null = null,
): FeedEvent {
  return { seq, eventId: `ev-${seq}`, type, userId, occurredAt: at, payload };
}

/** The chip as a teacher reads it: the display, and what it adds for an unlock. */
function chip(students: Students, id: string, now = new Date(T1)) {
  const s = students[id];
  const display = gridDisplay(s, now);
  return { display, note: unlockNote(s, display) };
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
    students = applyEvent(students, evt(2, 'protection_off', 'ana'));
    students = applyEvent(students, evt(3, 'enrollment_removed', 'ana'));
    expect(gridDisplay(students.ana, now)).toBe('left_protection_off');
  });

  it('a report recorded after the end is never a live chip, even for a student the roster lost', () => {
    // Owner decision 10: a protection-off that first reaches the server after
    // the session ended is recorded with a note. A tab that saw the end reads it
    // as "Left · protection off" already; one that did not — a student no
    // longer on the active roster, whose end it never applied — must not show a
    // live "Protection off" on a session that is over.
    const late = (seq: number, id: string): FeedEvent => ({
      ...evt(seq, 'protection_off', id),
      payload: { recorded_as: 'after_session_end' },
    });
    let students = fromSnapshot(snapshot(8, [{ id: 'ana' }]));
    // The note decides, not being unknown: a report made in the session still
    // reads live for a joiner the snapshot has not caught up with.
    students = applyEvent(students, evt(9, 'protection_off', 'dan'));
    expect(gridDisplay(students.dan, now)).toBe('protection_off');

    students = applyEvent(students, evt(10, 'session_expired', null));
    students = applyEvent(students, late(11, 'ana'));
    expect(gridDisplay(students.ana, now)).toBe('left_protection_off');
    students = applyEvent(students, late(12, 'cal'));
    expect(gridDisplay(students.cal, now)).toBe('left_protection_off');
  });

  it('names a state this tab does not know rather than guessing a chip', () => {
    // An open tab can outlive a deploy that adds a participation state.
    const students = fromSnapshot(
      snapshot(1, [{ id: 'ana', state: 'teleported' as ParticipationState }]),
    );
    expect(gridDisplay(students.ana, now)).toBe('unknown');
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

describe('the unlock a chip carries (A9)', () => {
  const unlockEvt = (seq: number, id: string, payload: Record<string, unknown> | null) =>
    evt(seq, 'unlock', id, T1, payload);

  it("shows an unlock's reason on the chip, and a return to focus clears it", () => {
    // The privacy contract promises the teacher sees the reason (A1).
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
    s = applyEvent(s, unlockEvt(6, 'ana', { reason: 'bathroom' }));
    expect(chip(s, 'ana')).toEqual({ display: 'unlocked', note: 'bathroom' });

    s = applyEvent(s, evt(7, 'refocus', 'ana'));
    expect(chip(s, 'ana', new Date(T0))).toEqual({ display: 'focused', note: null });

    s = applyEvent(s, unlockEvt(8, 'ana', { reason: 'nurse' }));
    expect(chip(s, 'ana').note).toBe('nurse');
    s = applyEvent(s, unlockEvt(9, 'ana', { reason: 'other' }));
    expect(chip(s, 'ana').note).toBe('other reason');
    // None given, or one this tab does not know (a newer server's): the label alone.
    s = applyEvent(s, unlockEvt(10, 'ana', null));
    expect(chip(s, 'ana')).toEqual({ display: 'unlocked', note: null });
    s = applyEvent(s, unlockEvt(11, 'ana', { reason: 'pass' }));
    expect(chip(s, 'ana')).toEqual({ display: 'unlocked', note: null });

    s = applyEvent(s, unlockEvt(12, 'ana', { reason: 'bathroom' }));
    s = applyEvent(s, evt(13, 'tap_in', 'ana'));
    expect(chip(s, 'ana', new Date(T0))).toEqual({ display: 'focused', note: null });
  });

  it('a tap or a refocus ends the unlock a chip carries', () => {
    // Visible once protection goes off afterwards: that chip must not carry
    // an unlock from before the student was back in focus.
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }, { id: 'ben' }]));
    s = applyEvent(s, unlockEvt(6, 'ana', { reason: 'bathroom' }));
    s = applyEvent(s, evt(7, 'refocus', 'ana'));
    s = applyEvent(s, evt(8, 'protection_off', 'ana'));
    expect(chip(s, 'ana')).toEqual({ display: 'protection_off', note: null });

    s = applyEvent(s, unlockEvt(9, 'ben', { reason: 'nurse' }));
    s = applyEvent(s, evt(10, 'tap_in', 'ben'));
    s = applyEvent(s, evt(11, 'protection_off', 'ben'));
    expect(chip(s, 'ben')).toEqual({ display: 'protection_off', note: null });
  });

  it('keeps the reason when the participation ends unlocked', () => {
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
    s = applyEvent(s, unlockEvt(6, 'ana', { reason: 'nurse' }));
    s = applyEvent(s, evt(7, 'session_expired', null));
    expect(chip(s, 'ana')).toEqual({ display: 'left_unprotected', note: 'nurse' });
  });

  it('shows an unlock recorded against protection off, never softening it', () => {
    // A2: the engine records the unlock and leaves the row in protection off.
    // Today's chip did not change at all, so the unlock showed nowhere.
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }, { id: 'ben' }]));
    s = applyEvent(s, evt(6, 'protection_off', 'ana'));
    s = applyEvent(s, unlockEvt(7, 'ana', { recorded_as: 'protection_off', reason: 'nurse' }));
    expect(chip(s, 'ana')).toEqual({ display: 'protection_off', note: 'unlocked · nurse' });

    s = applyEvent(s, evt(8, 'protection_off', 'ben'));
    s = applyEvent(s, unlockEvt(9, 'ben', { recorded_as: 'protection_off' }));
    expect(chip(s, 'ben')).toEqual({ display: 'protection_off', note: 'unlocked' });

    s = applyEvent(s, evt(10, 'session_expired', null));
    expect(chip(s, 'ana')).toEqual({ display: 'left_protection_off', note: 'unlocked · nurse' });
  });

  it('never reads an unlock noted protection off as an unlock, whatever the tab had', () => {
    // The note is the engine's word that protection is off. A chip the tab
    // still had as focused (the report is out of order) or never had at all
    // must not turn orange off the back of it.
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
    s = applyEvent(s, unlockEvt(6, 'ana', { recorded_as: 'protection_off', reason: 'bathroom' }));
    expect(chip(s, 'ana')).toEqual({ display: 'protection_off', note: 'unlocked · bathroom' });
    s = applyEvent(s, unlockEvt(7, 'eve', { recorded_as: 'protection_off' }));
    expect(chip(s, 'eve')).toEqual({ display: 'protection_off', note: 'unlocked' });
  });

  it('an unlock before protection went off stays on the protection-off chip', () => {
    // It is the unlock since the student was last in focus; protection off
    // goes on top of it, and only a tap or a refocus clears either.
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
    s = applyEvent(s, unlockEvt(6, 'ana', { reason: 'bathroom' }));
    s = applyEvent(s, evt(7, 'protection_off', 'ana'));
    expect(chip(s, 'ana')).toEqual({ display: 'protection_off', note: 'unlocked · bathroom' });
  });

  it('the boot snapshot shows the unlock the stream will not replay', () => {
    // An unlock older than the overlap window reaches a freshly opened tab
    // only through the snapshot.
    const at = '2026-01-01T08:01:00.000Z';
    const s = fromSnapshot(
      snapshot(90, [
        {
          id: 'ana',
          state: 'unlocked',
          unlock: { reason: 'bathroom', recordedAs: null, occurredAt: at },
        },
        {
          id: 'ben',
          state: 'protection_off',
          unlock: { reason: 'nurse', recordedAs: 'protection_off', occurredAt: at },
        },
        { id: 'cal', state: 'unlocked' },
      ]),
    );
    expect(chip(s, 'ana')).toEqual({ display: 'unlocked', note: 'bathroom' });
    expect(chip(s, 'ben')).toEqual({ display: 'protection_off', note: 'unlocked · nurse' });
    expect(chip(s, 'cal')).toEqual({ display: 'unlocked', note: null });
  });

  it('replaying the overlap over the boot snapshot lands where the snapshot was', () => {
    // The first connect resumes at latestSeq - overlap, so the stream re-applies
    // what the snapshot already reflects: the two readings must agree.
    const at = T1;
    const boot = snapshot(9, [
      {
        id: 'ana',
        state: 'unlocked',
        unlock: { reason: 'nurse', recordedAs: null, occurredAt: at },
      },
      {
        id: 'ben',
        state: 'protection_off',
        unlock: { reason: 'other', recordedAs: 'protection_off', occurredAt: at },
      },
      { id: 'cal', state: 'focused' },
    ]);
    let s = fromSnapshot(boot);
    for (const e of [
      unlockEvt(2, 'cal', { reason: 'bathroom' }),
      evt(3, 'refocus', 'cal'),
      evt(4, 'protection_off', 'ben'),
      unlockEvt(5, 'ana', { reason: 'bathroom' }),
      evt(6, 'refocus', 'ana'),
      unlockEvt(7, 'ana', { reason: 'nurse' }),
      unlockEvt(8, 'ben', { recorded_as: 'protection_off', reason: 'other' }),
    ]) {
      s = applyEvent(s, e);
    }
    const booted = fromSnapshot(boot);
    for (const id of ['ana', 'ben']) expect(chip(s, id)).toEqual(chip(booted, id));
    expect(chip(s, 'cal', new Date(T0))).toEqual(chip(booted, 'cal', new Date(T0)));
  });
});

describe('a late unlock turns no chip (A10)', () => {
  // Stuck on the phone while the student's own refocus or tap went ahead of
  // it: the engine leaves the row as those made it, and so does the chip.
  const late = (seq: number, id: string, reason: string) =>
    evt(seq, 'unlock', id, T0, { recorded_as: 'superseded', reason });

  it('leaves a chip back in focus as it is', () => {
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
    s = applyEvent(s, evt(6, 'unlock', 'ana', T1, { reason: 'bathroom' }));
    s = applyEvent(s, evt(7, 'refocus', 'ana'));
    s = applyEvent(s, late(8, 'ana', 'nurse'));
    expect(chip(s, 'ana', new Date(T0))).toEqual({ display: 'focused', note: null });
    expect(s.ana.lastSeenAt).toEqual(new Date(T1));
  });

  it('keeps a newer unlock on its chip, never the late one', () => {
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
    s = applyEvent(s, evt(6, 'tap_in', 'ana'));
    s = applyEvent(s, evt(7, 'unlock', 'ana', T1, { reason: 'other' }));
    s = applyEvent(s, late(8, 'ana', 'nurse'));
    expect(chip(s, 'ana')).toEqual({ display: 'unlocked', note: 'other reason' });
  });

  it('reads the same from a snapshot, were one to carry it', () => {
    const unlock: SnapshotUnlock = { reason: 'nurse', recordedAs: 'superseded', occurredAt: T0 };
    const s = fromSnapshot(snapshot(5, [{ id: 'ana', unlock }]));
    expect(chip(s, 'ana', new Date(T0))).toEqual({ display: 'focused', note: null });
  });

  it('landing after the bell, the return ahead of it, leaves a calm Left chip (#76)', () => {
    // Back in focus, and shielded at the bell: the engine notes the stuck
    // unlock `superseded` there too, never "Left · unlocked" over this phone.
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
    s = applyEvent(s, evt(6, 'unlock', 'ana', T0, { reason: 'bathroom' }));
    s = applyEvent(s, evt(7, 'refocus', 'ana'));
    s = applyEvent(s, evt(8, 'session_expired', null));
    s = applyEvent(s, late(9, 'ana', 'nurse'));
    expect(chip(s, 'ana')).toEqual({ display: 'ended', note: null });
    // And the refresh, whose turn looks past it to the refocus, reads the same.
    s = mergeSnapshot(s, snapshot(9, [{ id: 'ana', endedAt: T1 }]));
    expect(chip(s, 'ana')).toEqual({ display: 'ended', note: null });
  });
});

describe('a late return turns no chip (A13)', () => {
  // A tap or a refocus the phone made before an unlock the engine already had:
  // the unlock stands, on the row and on the chip.
  const lateReturn = (seq: number, type: 'tap_in' | 'refocus', id: string, at = T0) =>
    evt(seq, type, id, at, { recorded_as: 'superseded' });

  it('leaves an unlocked chip unlocked, with its reason, and reads as the refresh does', () => {
    for (const type of ['tap_in', 'refocus'] as const) {
      let s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
      s = applyEvent(s, evt(6, 'unlock', 'ana', T0, { reason: 'nurse' }));
      s = applyEvent(s, lateReturn(7, type, 'ana'));
      expect(chip(s, 'ana'), type).toEqual({ display: 'unlocked', note: 'nurse' });
      // The refresh's turn looks past the late return to the unlock before it.
      const unlock: SnapshotUnlock = { reason: 'nurse', recordedAs: null, occurredAt: T0 };
      const booted = fromSnapshot(snapshot(7, [{ id: 'ana', state: 'unlocked', unlock }]));
      expect(chip(s, 'ana'), type).toEqual(chip(booted, 'ana'));
    }
  });

  it('never brings back a chip that has left, nor lifts protection off', () => {
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }, { id: 'ben' }]));
    s = applyEvent(s, evt(6, 'left_for_other_session', 'ana'));
    s = applyEvent(s, lateReturn(7, 'tap_in', 'ana'));
    expect(chip(s, 'ana')).toEqual({ display: 'ended', note: null });
    s = applyEvent(s, evt(8, 'protection_off', 'ben'));
    s = applyEvent(s, evt(9, 'unlock', 'ben', T1, { recorded_as: 'protection_off' }));
    s = applyEvent(s, lateReturn(10, 'tap_in', 'ben'));
    expect(chip(s, 'ben')).toEqual({ display: 'protection_off', note: 'unlocked' });
  });

  it('is contact: last seen moves on, and nothing else does', () => {
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
    s = applyEvent(s, evt(6, 'unlock', 'ana', T0));
    const before = s.ana;
    s = applyEvent(s, lateReturn(7, 'refocus', 'ana', T1));
    expect(s.ana).toEqual({ ...before, lastSeenAt: new Date(T1) });
  });
});

describe('a student the snapshot does not carry (A9)', () => {
  it('whose phone unlocks with no live participation reads Left · unlocked, not Unlocked', () => {
    // Removed before this tab opened — outside the overlap, so it never saw
    // them leave — and then their phone unlocks. The engine's note says there
    // is no live participation; a live orange chip would say there is.
    let s = fromSnapshot(snapshot(80, [{ id: 'ana' }]));
    s = applyEvent(s, evt(81, 'unlock', 'cal', T1, { recorded_as: 'no_live_participation' }));
    expect(chip(s, 'cal')).toEqual({ display: 'left_unprotected', note: null });
    s = applyEvent(
      s,
      evt(82, 'unlock', 'dan', T1, { recorded_as: 'after_session_end', reason: 'nurse' }),
    );
    expect(chip(s, 'dan')).toEqual({ display: 'left_unprotected', note: 'nurse' });
  });

  it('with no participation, reads the same from the stream and from the snapshot', () => {
    // Enrolled, never tapped in, and yet an unlock kept against the session:
    // the phone is unshielded and the student is not in it.
    const unlock: SnapshotUnlock = {
      reason: null,
      recordedAs: 'no_live_participation',
      occurredAt: T1,
    };
    let streamed = fromSnapshot(snapshot(5, [{ id: 'ana', state: null }]));
    streamed = applyEvent(
      streamed,
      evt(6, 'unlock', 'ana', T1, { recorded_as: 'no_live_participation' }),
    );
    const refreshed = fromSnapshot(snapshot(6, [{ id: 'ana', state: null, unlock }]));
    expect(chip(streamed, 'ana')).toEqual({ display: 'left_unprotected', note: null });
    expect(chip(refreshed, 'ana')).toEqual(chip(streamed, 'ana'));
  });
});

describe('a late record survives the snapshot refresh (A9)', () => {
  // A late record — noted `after_session_end` — leaves the ended row as the end
  // left it (A2c), so the refresh reads a plain ended row: the snapshot carries
  // the record beside it, and the grid reads it as the stream did.
  const lateUnlock: SnapshotUnlock = {
    reason: 'nurse',
    recordedAs: 'after_session_end',
    occurredAt: T1,
  };

  it('a late unlock keeps its Left · unlocked chip', () => {
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
    s = applyEvent(s, evt(6, 'session_expired', null));
    s = applyEvent(
      s,
      evt(7, 'unlock', 'ana', T1, { recorded_as: 'after_session_end', reason: 'nurse' }),
    );
    expect(chip(s, 'ana')).toEqual({ display: 'left_unprotected', note: 'nurse' });

    s = mergeSnapshot(s, snapshot(7, [{ id: 'ana', endedAt: T1, unlock: lateUnlock }]));
    expect(chip(s, 'ana')).toEqual({ display: 'left_unprotected', note: 'nurse' });
  });

  it('a late protection off keeps its Left · protection off chip', () => {
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }]));
    s = applyEvent(s, evt(6, 'session_expired', null));
    s = applyEvent(s, evt(7, 'protection_off', 'ana', T1, { recorded_as: 'after_session_end' }));
    expect(chip(s, 'ana').display).toBe('left_protection_off');

    s = mergeSnapshot(s, snapshot(7, [{ id: 'ana', endedAt: T1, protectionOffAfterEnd: true }]));
    expect(chip(s, 'ana')).toEqual({ display: 'left_protection_off', note: null });
  });

  it('a late protection off and a late unlock read protection off in either order', () => {
    // Never softened, from the stream or from the snapshot: the row ended
    // unlocked, and neither late record changed it.
    const ended = snapshot(5, [{ id: 'ana', state: 'unlocked', endedAt: T1 }]);
    const off = evt(6, 'protection_off', 'ana', T1, { recorded_as: 'after_session_end' });
    const unlock = evt(7, 'unlock', 'ana', T1, {
      recorded_as: 'after_session_end',
      reason: 'nurse',
    });
    const want = { display: 'left_protection_off', note: 'unlocked · nurse' };
    expect(chip(applyEvent(applyEvent(fromSnapshot(ended), off), unlock), 'ana')).toEqual(want);
    expect(chip(applyEvent(applyEvent(fromSnapshot(ended), unlock), off), 'ana')).toEqual(want);
    const refreshed = snapshot(7, [
      {
        id: 'ana',
        state: 'unlocked',
        endedAt: T1,
        unlock: lateUnlock,
        protectionOffAfterEnd: true,
      },
    ]);
    expect(chip(fromSnapshot(refreshed), 'ana')).toEqual(want);
  });
});

describe('names reach the grid (A9)', () => {
  it('a rename reaches every chip at the next snapshot refresh', () => {
    // `display_name_changed` names no session, so no stream carries it.
    let s = fromSnapshot(snapshot(5, [{ id: 'ana', name: 'Ana' }]));
    s = applyEvent(s, evt(6, 'tap_in', 'dan'));
    expect(s.dan.displayName).toBeNull();
    s = mergeSnapshot(
      s,
      snapshot(6, [
        { id: 'ana', name: 'Ana R.' },
        { id: 'dan', name: 'Dan' },
      ]),
    );
    expect(s.ana.displayName).toBe('Ana R.');
    expect(s.dan.displayName).toBe('Dan');
  });

  it('drops an absent student the refresh no longer carries, rather than keep a stale chip', () => {
    // Enrolled, never tapped in, then left the class: nothing on record for
    // this session, so nothing to keep — and a kept chip's name never refreshes.
    let s = fromSnapshot(snapshot(5, [{ id: 'ana' }, { id: 'ben', state: null }]));
    s = mergeSnapshot(s, snapshot(6, [{ id: 'ana' }]));
    expect(s.ben).toBeUndefined();
    expect(s.ana).toBeDefined();
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
