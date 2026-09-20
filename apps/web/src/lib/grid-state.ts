import type { FeedEvent, ParticipationState, SessionSnapshot } from '@bali/shared';

/**
 * The live grid's pure state machine, kept out of the component so it can be
 * tested directly (and so the presentation can be swapped without touching it).
 * Everything here is a pure function of the stored roster plus one streamed
 * event; nothing time-derived is stored — `deriveDisplayState` computes silence
 * from `lastSeenAt` at render.
 */

export interface Student {
  studentId: string;
  displayName: string | null;
  state: ParticipationState | null;
  joinedAt: Date | null;
  lastSeenAt: Date | null;
  endedAt: Date | null;
}

export type Students = Record<string, Student>;

export function fromSnapshot(snap: SessionSnapshot): Students {
  const out: Students = {};
  for (const s of snap.students) {
    out[s.studentId] = {
      studentId: s.studentId,
      displayName: s.displayName,
      state: s.state,
      joinedAt: s.joinedAt ? new Date(s.joinedAt) : null,
      lastSeenAt: s.lastSeenAt ? new Date(s.lastSeenAt) : null,
      endedAt: s.endedAt ? new Date(s.endedAt) : null,
    };
  }
  return out;
}

/**
 * A refreshed snapshot may only be applied when it is at least as new as the
 * newest event the stream has already applied. A snapshot read *before* an
 * event but resolving *after* it would otherwise roll the grid backwards — the
 * teacher would see "Focused" for a phone that just hit Emergency Unlock, and
 * the stream never re-sends that event because its cursor has moved past it.
 */
export function snapshotIsFresh(snapshotLatestSeq: number, appliedSeq: number): boolean {
  return snapshotLatestSeq >= appliedSeq;
}

/** A student the roster hasn't seen yet (mid-session joiner, or one removed). */
function unknownStudent(studentId: string): Student {
  return {
    studentId,
    displayName: null,
    state: null,
    joinedAt: null,
    lastSeenAt: null,
    endedAt: null,
  };
}

/** Apply one streamed event onto a copy of the roster (idempotent for the grid). */
export function applyEvent(prev: Students, e: FeedEvent): Students {
  const at = new Date(e.occurredAt);
  if (e.type === 'session_ended' || e.type === 'session_expired') {
    const next: Students = {};
    for (const [id, s] of Object.entries(prev)) next[id] = s.endedAt ? s : { ...s, endedAt: at };
    return next;
  }
  const id = e.userId;
  if (!id) return prev;
  // A student the snapshot doesn't carry still gets a chip rather than being
  // dropped: a mid-session joiner, or one removed whose phone then unlocks.
  // The record is durable either way; the grid must not stay silent about it.
  const s: Student = { ...(prev[id] ?? unknownStudent(id)) };
  switch (e.type) {
    case 'tap_in':
      s.state = 'focused';
      s.lastSeenAt = at;
      s.endedAt = null;
      s.joinedAt ??= at;
      break;
    case 'unlock':
      s.state = 'unlocked';
      s.lastSeenAt = at;
      break;
    case 'refocus':
      s.state = 'focused';
      s.lastSeenAt = at;
      break;
    case 'protection_off':
      s.state = 'protection_off';
      s.lastSeenAt = at;
      break;
    case 'came_back':
      s.lastSeenAt = at;
      break;
    case 'enrollment_removed':
    case 'enrollment_left':
      s.endedAt = at;
      break;
    default:
      // went_silent is reflected by deriveDisplayState from last_seen_at; other
      // types don't change a chip.
      return prev;
  }
  return { ...prev, [id]: s };
}
