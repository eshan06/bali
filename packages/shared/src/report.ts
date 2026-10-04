import type {
  EventType,
  ParticipationState,
  ProtectionOffRecordedAs,
  UnlockReason,
  UnlockRecordedAs,
} from './index.js';
// From the barrel that re-exports this module, so read inside functions only, never at load.
import { isUnlockReason, PROTECTION_OFF_RECORDED_AS, UNLOCK_RECORDED_AS } from './index.js';
import { clampToWindow } from './state.js';

/*
 * R1 — what a session's report counts (PLAN.md's reports row), from the
 * session's own events: who joined, the class's focus minutes, and its
 * unlocks and protection-off reports. One pure function (rule 2), so every
 * report and recap counts alike. Aggregates only, never rankings: a
 * student's own minutes never leave it.
 *
 * Read in `seq` order, the engine's own: it applied each record as it arrived
 * and noted those it did not apply (`payload.recorded_as`) — an unlock with
 * nothing live, after the end, over protection off or late; a protection off
 * after the end; a late return. So a noted record moves no one, and the rest
 * move each student as the engine moved them. That is how a student's own
 * unlock and return keep the engine's order — the phone's, where both carry
 * one from the same install (A12–A14), since the engine noted the late one —
 * never their times'.
 *
 * The times only measure: each is the stored claim (rule 1), held to the
 * window the session really ran — its start to its end, its bell or `now`,
 * whichever came first, so nothing counts past `ended_at` or the bell — and,
 * along the engine's order, never earlier than the record before it, so a
 * clock turned back adds no time.
 */

/** A session's window as stored — a `sessions` row reads as one. */
export interface ReportWindow {
  startedAt: Date;
  /** Its bell: the scheduled end, which an extend moves on. */
  endsAt: Date;
  /** When it really ended; null while it runs. */
  endedAt: Date | null;
}

/** One of the session's events as stored — an `events` row reads as one. */
export interface ReportEvent {
  eventId: string;
  seq: number;
  type: EventType;
  userId: string | null;
  occurredAt: Date;
  payload: unknown;
}

/** An emergency unlock in the class, listed whatever it changed. */
export interface ReportUnlock {
  eventId: string;
  studentId: string;
  occurredAt: Date;
  /** Its reason now: its latest change's (A20), else the one sent with it; null when none. */
  reason: UnlockReason | null;
  /** Why it changed nothing, when it did not: `superseded` never ended focus. */
  recordedAs: UnlockRecordedAs | null;
}

/** A protection-off ("Screen Time off") report: it ends focus as an unlock does. */
export interface ReportProtectionOff {
  eventId: string;
  studentId: string;
  occurredAt: Date;
  /** `after_session_end`: it reached the server after the end, and changed nothing. */
  recordedAs: ProtectionOffRecordedAs | null;
}

export interface SessionReport {
  /** Who joined, in the order they first did: never a tap a Start declined, nor a late one. */
  joined: string[];
  /** Focused and in contact, the whole class's. Exact: the reader rounds. */
  focusMinutes: number;
  /** `focusMinutes` per student who joined; null when no one did. */
  averageFocusMinutes: number | null;
  /** Focused but gone quiet (`went_silent` until contact): never counted as focus. */
  silentMinutes: number;
  /** Oldest first, each with its note. */
  unlocks: ReportUnlock[];
  /** Oldest first, each with its note. */
  protectionOffs: ReportProtectionOff[];
}

/**
 * Unlocks kept with no class (ISSUES #2: never discarded): in none until filed.
 * Filing records a new unlock in the session, naming the kept one
 * (`unattached_event_id`), and that one counts — the kept one never does.
 */
const UNATTACHED: readonly unknown[] = [
  'unknown_session',
  'not_enrolled',
  'tap_armed',
  'unknown_tap',
] satisfies UnlockRecordedAs[];

/** A late record: no turn (the engine's `latestTurn`), and it moved no one. */
const LATE = 'superseded';

interface Student {
  state: ParticipationState | null;
  silent: boolean;
  /** When the record that last moved them happened, along the engine's order. */
  at: number;
  /** Their latest turn — a tap, a return or an unlock, never a late one. */
  turn: EventType | null;
}

/** Where a record moved its student, as the engine moved them; undefined when it moved no one. */
function moved(
  type: EventType,
  note: unknown,
  turn: EventType | null,
): ParticipationState | null | undefined {
  if (note !== null) return undefined;
  switch (type) {
    case 'tap_in':
    case 'refocus':
      return 'focused';
    case 'unlock':
      return 'unlocked';
    case 'protection_off':
      return 'protection_off';
    case 'protection_on': // the state before it, as their latest turn says (#167)
      return turn === 'unlock' ? 'unlocked' : 'focused';
    case 'left_for_other_session': // decision 4: ended, never an unlock
    case 'enrollment_left':
    case 'enrollment_removed':
      return null;
    default:
      return undefined;
  }
}

function payloadOf(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}

/** A session's report from its events, by the server's clock `now`. */
export function sessionReport(
  session: ReportWindow,
  events: readonly ReportEvent[],
  now: Date,
): SessionReport {
  const start = session.startedAt;
  const ran = Math.min(session.endsAt.getTime(), session.endedAt?.getTime() ?? Infinity);
  const end = new Date(Math.max(start.getTime(), Math.min(ran, now.getTime())));
  const students = new Map<string, Student>();
  const joined = new Set<string>();
  const unlocks: ReportUnlock[] = [];
  const protectionOffs: ReportProtectionOff[] = [];
  const reasonChanges = new Map<unknown, unknown>();
  let focusMs = 0;
  let silentMs = 0;

  /** Count a student's time up to `at`, held to the window and their order. */
  function advance(s: Student, at: Date): void {
    const t = Math.max(s.at, clampToWindow(at, start, end).getTime());
    if (s.state === 'focused') {
      if (s.silent) silentMs += t - s.at;
      else focusMs += t - s.at;
    }
    s.at = t;
  }

  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    const payload = payloadOf(e.payload);
    const note = payload.recorded_as ?? null;
    if (e.type === 'unlock_reason_changed') {
      reasonChanges.set(payload.unlock_event_id, payload.reason); // the latest wins
      continue;
    }
    if (e.userId === null || (e.type === 'unlock' && UNATTACHED.includes(note))) continue;

    const { eventId, userId: studentId, occurredAt } = e;
    if (e.type === 'unlock') {
      const reason = isUnlockReason(payload.reason) ? payload.reason : null;
      const recordedAs = UNLOCK_RECORDED_AS.find((known) => known === note) ?? null;
      unlocks.push({ eventId, studentId, occurredAt, reason, recordedAs });
    } else if (e.type === 'protection_off') {
      const recordedAs = PROTECTION_OFF_RECORDED_AS.find((known) => known === note) ?? null;
      protectionOffs.push({ eventId, studentId, occurredAt, recordedAs });
    }

    let s = students.get(studentId);
    if (s === undefined) {
      s = { state: null, silent: false, at: start.getTime(), turn: null };
      students.set(studentId, s);
    }
    const next = moved(e.type, note, s.turn);
    if ((e.type === 'tap_in' || e.type === 'refocus' || e.type === 'unlock') && note !== LATE) {
      s.turn = e.type;
    }
    if (next === undefined && e.type !== 'went_silent' && e.type !== 'came_back') continue;

    advance(s, occurredAt);
    // Silence is a focused phone's, opened by the sweep and closed by any
    // contact — which the engine records as `came_back` — or by the stint's end.
    s.silent = e.type === 'went_silent';
    if (next !== undefined) s.state = next;
    if (e.type === 'tap_in' && next === 'focused') joined.add(studentId);
  }
  for (const s of students.values()) advance(s, end);

  for (const u of unlocks) {
    const changed = reasonChanges.get(u.eventId);
    if (isUnlockReason(changed)) u.reason = changed;
  }
  const oldestFirst = (a: { occurredAt: Date }, b: { occurredAt: Date }) =>
    a.occurredAt.getTime() - b.occurredAt.getTime();
  const focusMinutes = focusMs / 60_000;
  return {
    joined: [...joined],
    focusMinutes,
    averageFocusMinutes: joined.size === 0 ? null : focusMinutes / joined.size,
    silentMinutes: silentMs / 60_000,
    unlocks: unlocks.sort(oldestFirst),
    protectionOffs: protectionOffs.sort(oldestFirst),
  };
}
