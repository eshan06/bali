import type { EventType, FeedEvent, ParticipationState, SessionSnapshot } from '@bali/shared';
import { describe, expect, it } from 'vitest';

import { applyEvent, fromSnapshot, snapshotIsFresh, type Students } from './grid-state';

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
