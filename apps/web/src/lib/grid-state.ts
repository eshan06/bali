import type {
  DisplayState,
  FeedEvent,
  ParticipationState,
  ProtectionOffRecordedAs,
  ReturnRecordedAs,
  SessionSnapshot,
  UnlockReason,
  UnlockRecordedAs,
} from '@bali/shared';
import {
  deriveDisplayState,
  hasClockNote,
  isUnlockReason,
  PARTICIPATION_STATES,
} from '@bali/shared';

/**
 * The live grid's pure state machine, kept out of the component so it can be
 * tested directly (and so the presentation can be swapped without touching it).
 * Everything here is a pure function of the stored roster plus one streamed
 * event; nothing time-derived is stored — `deriveDisplayState` computes silence
 * from `lastSeenAt` at render.
 *
 * `npm run dev:teacher`'s watch runs it from Node too
 * (apps/api/scripts/demo/dev-teacher.ts), and the API's typecheck compiles it:
 * keep it free of path aliases and browser globals.
 */

export interface Student {
  studentId: string;
  displayName: string | null;
  /**
   * The state the chip shows: the stored one, plus the records the engine
   * keeps without changing the row — an unlock after the participation ended,
   * a protection off reported after the bell.
   */
  state: ParticipationState | null;
  joinedAt: Date | null;
  lastSeenAt: Date | null;
  endedAt: Date | null;
  /**
   * The student's latest unlock since they last tapped in or refocused: the
   * chip shows it, with its reason — a protection-off chip too, which it never
   * relabels. Its event id is what a change of its reason names (A20).
   */
  unlock: { eventId: string; reason: UnlockReason | null } | null;
  /**
   * A record of theirs here came from a phone clock set ahead of the server's
   * (S9): the chip carries a "Clock off" badge beside its state, never instead
   * of it. Advisory only; it changes no state.
   */
  clockOff: boolean;
}

export type Students = Record<string, Student>;

/** Notes that say the engine found no live participation to flip. */
const NOTHING_LIVE: readonly unknown[] = [
  'no_live_participation',
  'after_session_end',
] satisfies UnlockRecordedAs[];

/**
 * One unlock record onto a chip, in place. The streamed event and the
 * snapshot's `unlock` both land here, so the two never read one differently
 * (rule 2 — the grid mirrors the engine):
 * - noted `protection_off`, the engine found protection off and left it so —
 *   and so does the chip, whatever this tab had: never an unlock, never green;
 * - otherwise it reads unlocked, unless it already reads protection off, which
 *   an unlock never softens (the engine's rule, and an out-of-order report's);
 * - noted as finding nothing live, the student is not in the session (removed,
 *   left, switched away, the session over, or never tapped in) — so the chip is
 *   never live, even for a tab that did not see them go;
 * - noted `superseded`, it is late — the student's own refocus or tap went ahead
 *   of it — and the engine left the row as those made it: so does the chip.
 */
function applyUnlock(s: Student, eventId: string, reason: unknown, note: unknown, at: Date): void {
  if (note === ('superseded' satisfies UnlockRecordedAs)) return;
  s.unlock = { eventId, reason: isUnlockReason(reason) ? reason : null };
  s.state =
    note === ('protection_off' satisfies UnlockRecordedAs) || s.state === 'protection_off'
      ? 'protection_off'
      : 'unlocked';
  if (NOTHING_LIVE.includes(note)) s.endedAt ??= at;
}

function payloadOf(e: FeedEvent): Record<string, unknown> {
  return typeof e.payload === 'object' && e.payload !== null
    ? (e.payload as Record<string, unknown>)
    : {};
}

/**
 * A late return (A13): a tap or a refocus the phone made before an unlock of
 * the student's own there that the engine already had — or Screen Time back on
 * made before a protection off it had (#167). It left the row as that unlock or
 * protection off made it, and so does the chip — contact, and nothing more.
 */
function isLateReturn(e: FeedEvent): boolean {
  return (
    (e.type === 'tap_in' || e.type === 'refocus' || e.type === 'protection_on') &&
    payloadOf(e).recorded_as === ('superseded' satisfies ReturnRecordedAs)
  );
}

export function fromSnapshot(snap: SessionSnapshot): Students {
  const out: Students = {};
  for (const s of snap.students) {
    const student: Student = {
      studentId: s.studentId,
      displayName: s.displayName,
      state: s.state,
      joinedAt: s.joinedAt ? new Date(s.joinedAt) : null,
      lastSeenAt: s.lastSeenAt ? new Date(s.lastSeenAt) : null,
      endedAt: s.endedAt ? new Date(s.endedAt) : null,
      unlock: null,
      clockOff: s.clockOff === true,
    };
    // What the stored row does not show, read as the stream reads it (A9). A
    // late report leaves the ended row alone (A2c), so without these the 15 s
    // refresh put a late record's chip back to plain "Left".
    if (s.protectionOffAfterEnd) student.state = 'protection_off';
    if (s.unlock) {
      const { eventId, reason, recordedAs, occurredAt } = s.unlock;
      applyUnlock(student, eventId, reason, recordedAs, new Date(occurredAt));
      // Noted protection off, it moved nothing when it landed — and Screen Time back on (#167)
      // may since have returned the row to the unlocked it says: the stored row is the truth.
      if (recordedAs === 'protection_off' && s.state === 'unlocked' && !s.protectionOffAfterEnd) {
        student.state = 'unlocked';
      }
    }
    out[s.studentId] = student;
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

/** A student the roster hasn't seen yet (a mid-session joiner). */
function unknownStudent(studentId: string): Student {
  return {
    studentId,
    displayName: null,
    state: null,
    joinedAt: null,
    lastSeenAt: null,
    endedAt: null,
    unlock: null,
    clockOff: false,
  };
}

/**
 * Whether an event ends the session itself: the teacher's End, or the sweep at the bell (and a
 * Start past it, A18). Only the server marks a session over, so the grid and the recap card wait
 * for one of these, never the tab's own clock.
 */
export function endsSession(e: Pick<FeedEvent, 'type'>): boolean {
  return e.type === 'session_ended' || e.type === 'session_expired';
}

/** Apply one streamed event onto a copy of the roster (idempotent for the grid). */
export function applyEvent(prev: Students, e: FeedEvent): Students {
  const at = new Date(e.occurredAt);
  if (endsSession(e)) {
    const next: Students = {};
    for (const [id, s] of Object.entries(prev)) next[id] = s.endedAt ? s : { ...s, endedAt: at };
    return next;
  }
  const id = e.userId;
  if (!id) return prev;
  // A student the snapshot doesn't carry yet still gets a chip rather than
  // being dropped. The record is durable; the grid must not stay silent about
  // it, and the next snapshot carries them.
  const s: Student = { ...(prev[id] ?? unknownStudent(id)) };
  // Any of their records can carry the clock note, a late one too (S9).
  if (hasClockNote(e.payload)) s.clockOff = true;
  if (isLateReturn(e)) {
    s.lastSeenAt = advance(s.lastSeenAt, at);
    return { ...prev, [id]: s };
  }
  switch (e.type) {
    case 'tap_in':
      s.state = 'focused';
      s.lastSeenAt = advance(s.lastSeenAt, at);
      s.endedAt = null;
      s.joinedAt ??= at;
      s.unlock = null; // back in focus: an earlier unlock is history
      break;
    case 'unlock': {
      const payload = payloadOf(e);
      applyUnlock(s, e.eventId, payload.reason, payload.recorded_as, at);
      s.lastSeenAt = advance(s.lastSeenAt, at);
      break;
    }
    case 'unlock_reason_changed': {
      // The latest reason the teacher sees (A20), on the unlock it names — and
      // only that one, should the chip carry another by now. One this tab does
      // not know reads as none, as the refresh reads it.
      const { unlock_event_id: of, reason } = payloadOf(e);
      if (s.unlock === null || s.unlock.eventId !== of) return prev;
      s.unlock = { ...s.unlock, reason: isUnlockReason(reason) ? reason : null };
      break;
    }
    case 'refocus':
      s.state = 'focused';
      s.lastSeenAt = advance(s.lastSeenAt, at);
      s.unlock = null;
      break;
    case 'protection_off':
      s.state = 'protection_off';
      s.lastSeenAt = advance(s.lastSeenAt, at);
      // A report recorded after the session ended (owner decision 10) is never
      // a live chip, even for a tab that never saw the end: a student the
      // snapshot no longer carries would otherwise read "Protection off", live.
      if (payloadOf(e).recorded_as === ('after_session_end' satisfies ProtectionOffRecordedAs)) {
        s.endedAt ??= at;
      }
      break;
    case 'protection_on':
      // Screen Time back on (#167): the state before protection off, as the
      // engine reads it — the latest turn, which the chip's unlock mirrors.
      s.state = s.unlock === null ? 'focused' : 'unlocked';
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
 * authoritative for everyone it carries — names included, which no stream
 * event carries (a rename names no session) — and it carries every student
 * the session's feed can name, removed ones too. A chip the stream painted
 * that it does not carry yet (a snapshot from an older server) is kept rather
 * than blinking off the grid: the record is durable, and the screen should
 * agree with it. An absent student it no longer carries has left the class
 * with nothing on record here, so they go — kept, their name would never
 * refresh again. A chip with no state reads "Not here" whatever else the
 * stream set (`gridDisplay`), so dropping one loses nothing it showed: an
 * event that has something to show sets a state.
 */
export function mergeSnapshot(prev: Students, snap: SessionSnapshot): Students {
  const next = fromSnapshot(snap);
  for (const [id, student] of Object.entries(prev)) {
    if (!(id in next) && student.state !== null) next[id] = student;
  }
  return next;
}

/**
 * What the grid shows for one student: `deriveDisplayState`, plus the four
 * cases a participation snapshot alone cannot express.
 *
 * `absent` — enrolled but never tapped in, so there is no state at all.
 *
 * `left_unprotected` — the student's participation ended (at the bell, on
 * removal, on a switch to another session) while unlocked, or their phone
 * reported an unlock after it ended. `deriveDisplayState` answers `ended` for
 * anything with an `endedAt`, which would put the calmest chip on the grid over
 * exactly the event ISSUES #2 exists to surface: an unshielded phone the
 * teacher no longer has in their roster. The record is durable either way; the
 * screen has to agree with it.
 *
 * `left_protection_off` — the same, for a student whose Screen Time permission
 * was off when the participation ended. Never labelled as an unlock: protection
 * off is "never green, never an unlock" (ARCHITECTURE, iOS rules), and a later
 * unlock leaves it as it is.
 *
 * `unknown` — a state this tab has no chip for. An open tab can be older than
 * the server it reads (it outlives a deploy that adds a state), so it says so
 * and asks for a refresh rather than crash the grid or guess a calm chip.
 */
export type GridDisplay =
  DisplayState | 'absent' | 'left_unprotected' | 'left_protection_off' | 'unknown';

export function gridDisplay(s: Student, now: Date): GridDisplay {
  if (s.state === null) return 'absent';
  if (!(PARTICIPATION_STATES as readonly string[]).includes(s.state)) return 'unknown';
  if (s.endedAt !== null && s.state === 'protection_off') return 'left_protection_off';
  if (s.endedAt !== null && s.state === 'unlocked') return 'left_unprotected';
  return deriveDisplayState(
    { state: s.state, joinedAt: s.joinedAt ?? now, lastSeenAt: s.lastSeenAt, endedAt: s.endedAt },
    now,
  );
}

/** Whole minutes since the server last heard from the phone: its last check-in, or its tap. */
export function minutesSinceContact(s: Student, now: Date): number {
  const last = s.lastSeenAt ?? s.joinedAt;
  return last === null ? 0 : Math.max(0, Math.floor((now.getTime() - last.getTime()) / 60_000));
}

/** What a Silent chip adds after its label (DESIGN.md §2): how long since the phone was heard. */
export function silentNote(s: Student, now: Date): string {
  return `${minutesSinceContact(s, now)} min`;
}

/**
 * Staleness short of silence (DESIGN.md §2): under a live chip whose phone hasn't been heard from
 * for a minute or more, how long ago it was, as a caption, never a colour change. A focused phone
 * reads Silent at 90 s, its label saying how long from then; an unlocked or protection-off phone
 * never does, so for those this is the one place it shows.
 */
export function lastSeenNote(s: Student, display: GridDisplay, now: Date): string | null {
  if (display !== 'focused' && display !== 'unlocked' && display !== 'protection_off') return null;
  const minutes = minutesSinceContact(s, now);
  return minutes < 1 ? null : `last seen ${minutes} min ago`;
}

/**
 * `bali-softpulse`'s cue (DESIGN.md §7): an unlock the stream brings after the grid booted. The
 * stream's first connect replays the events the boot snapshot already holds (`bootSeq` and
 * below), and those never pulse.
 */
export function landsLive(e: Pick<FeedEvent, 'type' | 'seq'>, bootSeq: number): boolean {
  return e.type === 'unlock' && e.seq > bootSeq;
}

/**
 * Whether a chip pulses: the unlock it carries landed live (`landsLive`, by event id), and it
 * shows it in emergency orange. An unlock left on a protection-off chip, or a late one the chip
 * never took, stays still.
 */
export function softpulses(s: Student, display: GridDisplay, live: ReadonlySet<string>): boolean {
  return (
    s.unlock !== null &&
    live.has(s.unlock.eventId) &&
    (display === 'unlocked' || display === 'left_unprotected')
  );
}

const REASON_TEXT: Record<UnlockReason, string> = {
  bathroom: 'bathroom',
  nurse: 'nurse',
  other: 'other reason',
};

/**
 * What the line under a chip says of the unlock it carries (A9): the reason
 * under a chip that already says unlocked, and under a protection-off chip the
 * unlock itself — a detail under the state, never the state, so protection
 * off is never relabelled an unlock nor shown green. Null when it adds nothing.
 * In Present (`present`), the projector the class can see, never the reason: the
 * consent card promises it to the teacher alone (A1).
 */
export function unlockNote(s: Student, display: GridDisplay, present = false): string | null {
  if (s.unlock === null) return null;
  const reason = present || s.unlock.reason === null ? null : REASON_TEXT[s.unlock.reason];
  if (display === 'unlocked' || display === 'left_unprotected') return reason;
  if (display === 'protection_off' || display === 'left_protection_off') {
    return reason === null ? 'unlocked' : `unlocked · ${reason}`;
  }
  return null;
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

/**
 * The grid's health line (ARCHITECTURE, Web portal, decision 4) in words: why it may be out of
 * date, and how old it is, in seconds for the first minute and in minutes from then on.
 */
export function staleWords({ reason, secondsAgo }: Staleness): string {
  const ago = secondsAgo < 60 ? `${secondsAgo}s` : `${Math.floor(secondsAgo / 60)} min`;
  return reason === 'reconnecting'
    ? `Reconnecting… last updated ${ago} ago`
    : `Live feed has gone quiet. Last updated ${ago} ago.`;
}
