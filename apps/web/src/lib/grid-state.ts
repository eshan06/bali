import type { DisplayState, FeedEvent, ParticipationState, SessionSnapshot } from '@bali/shared';
import { deriveDisplayState } from '@bali/shared';

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

/**
 * Last contact only ever moves forward. The first stream connect resumes at
 * `latestSeq - EVENT_RESUME_OVERLAP`, so events the boot snapshot already
 * reflects are replayed; letting an old `tap_in` rewind `lastSeenAt` would
 * flash a wrong "Silent" chip on a phone that has been checking in all along.
 */
function advance(current: Date | null, at: Date): Date {
  return current !== null && current.getTime() > at.getTime() ? current : at;
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
      s.lastSeenAt = advance(s.lastSeenAt, at);
      s.endedAt = null;
      s.joinedAt ??= at;
      break;
    case 'unlock':
      s.state = 'unlocked';
      s.lastSeenAt = advance(s.lastSeenAt, at);
      break;
    case 'refocus':
      s.state = 'focused';
      s.lastSeenAt = advance(s.lastSeenAt, at);
      break;
    case 'protection_off':
      s.state = 'protection_off';
      s.lastSeenAt = advance(s.lastSeenAt, at);
      break;
    case 'came_back':
      s.lastSeenAt = advance(s.lastSeenAt, at);
      break;
    // left_for_other_session means this phone belongs to another teacher's
    // session now — the engine already ended that participation, so the chip
    // must not stay green until the next snapshot refresh.
    case 'left_for_other_session':
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

/**
 * Fold a refreshed snapshot over the current roster. The snapshot is
 * authoritative for everyone it carries, but `getSessionRoster` joins only
 * *active* enrollments — so a student the stream surfaced who has since left the
 * roster (removed mid-session, whose phone then hit Emergency Unlock) is kept
 * rather than blinking off the grid seconds later. The event record is durable;
 * the screen should agree with it.
 */
export function mergeSnapshot(prev: Students, snap: SessionSnapshot): Students {
  const next = fromSnapshot(snap);
  for (const [id, student] of Object.entries(prev)) if (!(id in next)) next[id] = student;
  return next;
}

/**
 * What the grid shows for one student: `deriveDisplayState`, plus the two cases
 * a participation snapshot alone cannot express.
 *
 * `absent` — enrolled but never tapped in, so there is no state at all.
 *
 * `left_unprotected` — the student's participation ended (removed mid-session,
 * or moved to another teacher's session) and their phone then reported an
 * unlock or protection_off. `deriveDisplayState` answers `ended` for anything
 * with an `endedAt`, which would put the calmest chip on the grid over exactly
 * the event ISSUES #2 exists to surface: an unshielded phone the teacher no
 * longer has in their roster. The record is durable either way; the screen has
 * to agree with it.
 */
export type GridDisplay = DisplayState | 'absent' | 'left_unprotected';

export function gridDisplay(s: Student, now: Date): GridDisplay {
  if (s.state === null) return 'absent';
  if (s.endedAt !== null && (s.state === 'unlocked' || s.state === 'protection_off')) {
    return 'left_unprotected';
  }
  return deriveDisplayState(
    { state: s.state, joinedAt: s.joinedAt ?? now, lastSeenAt: s.lastSeenAt, endedAt: s.endedAt },
    now,
  );
}

/**
 * Whether the grid should say it might be out of date, and why.
 *
 * Rule 3: the screen only claims what was verified. The banner used to appear
 * solely when the client KNEW it had lost the stream — the one case it can
 * already see — so the dangerous shape showed nothing: a connection that stays
 * open and stops delivering (a wedged proxy, a hub that died without closing
 * the socket) left a fully green grid ageing silently, every chip claiming a
 * freshness nothing had checked.
 *
 * TWO clocks, not one, and the first version of this had only the second —
 * which made the `stale` branch unreachable in production, for the exact
 * scenario it was built for.
 *
 * `lastStreamActivityAt` is life on the STREAM: an event, or a heartbeat
 * comment. A heartbeat counts as freshness and not just liveness — a quiet
 * class emits no events for minutes (decision 7: a heartbeat that changes
 * nothing writes no history), so silence on the wire is the normal case and
 * only silence from the SERVER means the stream has stopped working.
 *
 * `lastGridActivityAt` is life anywhere: that, plus the 15 s snapshot refresh.
 * It is what "last updated" honestly means to a teacher.
 *
 * Feeding the refresh into one shared clock is what broke it: the poll runs
 * every 15 s and the threshold is 60 s, so a wedged proxy or a hub that died
 * without closing the socket — stream open, API fine — reset the counter four
 * times per threshold and showed nothing at all. The two clocks keep that
 * visible while still telling the teacher the truth about how old the grid is.
 */

/**
 * How many heartbeats may go missing before the stream is called quiet. Three,
 * so one dropped frame or a slow tick does not flap the banner on a healthy
 * class — and the arithmetic below multiplies by exactly this, because naming
 * it 2 and multiplying by `n + 1` is how the last reader got 60 s from a
 * constant that said 40.
 */
export const STALE_AFTER_MISSED_HEARTBEATS = 3;

export interface Staleness {
  /** `reconnecting` — the client knows it is disconnected. `stale` — the stream is open but silent. */
  reason: 'reconnecting' | 'stale';
  secondsAgo: number;
}

export function staleness(input: {
  status: 'connecting' | 'open' | 'reconnecting';
  /** Last event or heartbeat comment off the stream. */
  lastStreamActivityAt: number;
  /** That, or the last snapshot refresh that came back — how old the grid is. */
  lastGridActivityAt: number;
  now: number;
  heartbeatMs: number;
}): Staleness | null {
  // Always the GRID's age, for both reasons: it is the number a teacher reads
  // as "how stale is what I am looking at", and on a dead stream with a live
  // poll it is the smaller, truer one. The stream's own silence decides
  // WHETHER to warn; it does not get to inflate the number.
  const secondsAgo = Math.round(Math.max(0, input.now - input.lastGridActivityAt) / 1000);
  if (input.status !== 'open') return { reason: 'reconnecting', secondsAgo };
  const quietFor = input.heartbeatMs * STALE_AFTER_MISSED_HEARTBEATS;
  const streamSilentMs = Math.max(0, input.now - input.lastStreamActivityAt);
  return streamSilentMs > quietFor ? { reason: 'stale', secondsAgo } : null;
}
