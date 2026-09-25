import type { DisplayState } from './state.js';
import type {
  EventType,
  HistoryEventType,
  ParticipationEndedReason,
  ParticipationState,
  ProtectionOffRecordedAs,
  ReturnRecordedAs,
  UnlockReason,
  UnlockRecordedAs,
  UserRole,
} from './index.js';
import type { UnlockRecordedOutcome } from './unlock-contract.js';

/*
 * The DTOs for the step-7 endpoints — the wire contract clients depend on, so
 * additive-only once shipped (API-surface decision 2). Timestamps cross the wire
 * as ISO 8601 strings. A closed set of values a response carries is an `as
 * const` list its type derives from, additive-only like the other vocab, so
 * BaliCore's mirror of it is checked against the list itself (B1b).
 */

/**
 * The order the phone acted in (A12, owner ruling 2026-09-24): its outbox numbers everything
 * it does with a counter no clock moves, and the server orders a student's own unlock and
 * their return to focus — a refocus, a tap in — by it. Two actions are compared by it only
 * when both carry one from the same `install`; any other pair keeps the clamped times (rule
 * 1). Optional on every record the outbox sends — old builds send none — and never a reason to
 * refuse one: an order the server cannot use is taken as none (`isActionOrder`).
 */
export interface ActionOrder {
  /** Which counter: a UUID minted once when the phone's outbox file was made. A reinstall mints another. */
  install: string;
  /** This action's place in it: a positive safe integer, never reused or lowered while the file lives. */
  seq: number;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for an order the server can compare: a UUID `install`, a positive safe integer `seq`. */
export function isActionOrder(value: unknown): value is ActionOrder {
  if (typeof value !== 'object' || value === null) return false;
  const { install, seq } = value as Record<string, unknown>;
  return (
    typeof install === 'string' &&
    UUID_SHAPE.test(install) &&
    Number.isSafeInteger(seq) &&
    (seq as number) > 0
  );
}

/** A session as a student's phone sees it for reconciliation (state + end time). */
export interface SessionView {
  id: string;
  classId: string;
  endsAt: string;
}

// GET /v1/me — the boot call.
export interface MeClass {
  id: string;
  name: string;
}
export interface MeUser {
  id: string;
  role: UserRole;
  /** What teachers see beside this student; null until a sign-in or the student sets one. */
  displayName: string | null;
}
export interface MeResponse {
  user: MeUser;
  classes: MeClass[];
  /** The caller's live session, if any, with its derived display state. */
  session: (SessionView & { state: DisplayState }) | null;
}

// PATCH /v1/me — a student sets their own display name (A8). Unique within
// each class: a name a classmate in any shared class already uses, ignoring
// case and spacing, is `409 display_name_taken` (owner decision 8); a name
// that breaks a rule is `400 display_name_invalid`. Stored trimmed, with each
// run of spaces made one.
export interface UpdateMeRequest {
  /** At most `DISPLAY_NAME_MAX_LENGTH` code points once trimmed, and something visible. */
  displayName: string;
  /** Client idempotency key for the display_name_changed event (rule 4). */
  eventId: string;
}
/** Every outcome `PATCH /v1/me` answers with (`UpdateMeResponse.outcome`). */
export const UPDATE_ME_OUTCOMES = ['applied', 'replay'] as const;
export type UpdateMeOutcome = (typeof UPDATE_ME_OUTCOMES)[number];
export interface UpdateMeResponse {
  /**
   * 'applied' set the name; 'replay' this eventId already did — nothing is
   * applied again, and `user` is the truth now, which a later rename may have
   * changed since.
   */
  outcome: UpdateMeOutcome;
  user: MeUser;
}

// POST /v1/taps — the tap.
export interface TapRequest {
  /** The NFC tag id the block broadcasts. */
  tagId: string;
  /** Client idempotency key (a UUID the phone mints). */
  eventId: string;
  /** Device clock, ISO 8601; clamped into the session window server-side. */
  deviceTime: string;
  /** The phone's own order for this tap (A12): what orders it against the student's unlock. */
  order?: ActionOrder | null;
}
export type TapOutcome = 'joined' | 'switched' | 'armed' | 'already_armed' | 'replay';
export interface TapResponse {
  /**
   * `already_armed` is also the answer to the retry of a tap still waiting
   * (A4), so a phone that lost the first answer learns it waits for Start.
   * `replay` is also the answer to a late tap (A13) — one the phone made
   * before an unlock the server already has: recorded, never applied, and
   * answered with the truth now, as its retry is.
   */
  outcome: TapOutcome;
  /**
   * The joined session for `joined` / `switched`, and for the `replay` of a
   * tap whose participation is still live, in a session still running. Null
   * when the tap was armed — and on the `replay` of a tap recorded but no
   * longer current (A4): its participation ended, or its session is over.
   *
   * The session, not the outcome, is what gives a phone a window to shield
   * to: a `replay` with no session means "recorded — delete it, nothing to
   * shield to, re-read the truth" (`tapDisposition`: 'reread').
   */
  session: SessionView | null;
  /**
   * The resulting stored state when joined — `unlocked` when an unlock sent
   * under this tap reached the server first and is filed now (decision 11);
   * null when armed, and on a replay no longer current.
   */
  state: ParticipationState | null;
}

// POST /v1/classes/{id}/sessions — start a session.
export interface StartSessionRequest {
  /** How long the session runs from now. */
  durationMinutes: number;
}
export interface StartSessionResponse {
  outcome: 'created' | 'existing';
  session: SessionView & { startedAt: string };
  /** Armed taps that became participations at this start (decision 5). */
  armedConverted: number;
}

// POST /v1/sessions/{id}/unlock — emergency unlock (ISSUES.md #2: never discarded).
/**
 * The unlock outcome union, derived from the shared source so the DTO, the
 * engine result, and the disposition table can't drift. 'applied' flipped a live
 * participation to unlocked; 'recorded' saved the event with a note and flipped
 * nothing — there was no live participation, its protection is off (never
 * softened into an unlock), or the student came back to focus after it (a late
 * unlock, `superseded`); 'replay' means the event already landed.
 * All three mean "durably recorded" — the phone's outbox stops retrying (see
 * unlockDisposition).
 */
export type UnlockOutcome = UnlockRecordedOutcome;
export interface UnlockResponse {
  outcome: UnlockOutcome;
  /** Why nothing was flipped, on a fresh 'recorded' unlock; null for 'applied' and 'replay'. */
  recordedAs: UnlockRecordedAs | null;
  /**
   * 'unlocked' when a live participation flipped; the live state it left alone
   * when it was recorded, not flipped — 'protection_off', or after a late
   * unlock (`superseded`) what the student's own later changes made it, which
   * the phone applies; null when no participation was live (none, or it had
   * ended — a late unlock landing after the student left the session
   * included); on a replay, the participation's current stored state (which
   * may be an ended participation's last state), or null when there is none.
   */
  state: ParticipationState | null;
  /**
   * The session for reconciliation; null only when the unlock is kept with no
   * session — the session id was unknown, or the tap it was sent under has no
   * session to file it in (`tap_armed`, `unknown_tap`).
   */
  session: SessionView | null;
  /**
   * The reason on record for this unlock: the one this request carried when the
   * unlock is new, the stored one on a replay. Null when none was given or the
   * one sent was not recognised — so a phone can tell its reason did not land.
   */
  reason: UnlockReason | null;
}

// POST /v1/sessions/{id}/end — the class's teacher ends a running session.
export interface EndSessionResponse {
  outcome: 'ended' | 'already_ended';
  /** Live participations ended by this call; 0 on an already-ended session. */
  endedParticipations: number;
}

// POST /v1/sessions/{id}/extend — the teacher adds time.
export interface ExtendSessionRequest {
  /** Minutes to add; the new end is max(now, current end) + this many minutes. */
  durationMinutes: number;
  /**
   * Client-minted UUIDv7 making the extend idempotent (rule 4). Required: the
   * new end is relative to the current one, so a retry without it silently adds
   * the time twice. `/v1` is additive-only, so this cannot be promoted from
   * optional later — it ships required.
   */
  eventId: string;
}
export interface ExtendSessionResponse {
  outcome: 'extended';
  session: SessionView;
}

// POST /v1/sessions/{id}/checkin — the ~30s heartbeat (any enrolled student).
export interface CheckInRequest {
  /** Device clock, ISO 8601; clamped into the session window server-side. */
  deviceTime: string;
}
/** Every status a check-in answers with (`CheckInResponse.status`). */
export const CHECK_IN_STATUSES = ['live', 'gone'] as const;
export type CheckInStatus = (typeof CHECK_IN_STATUSES)[number];
export interface CheckInResponse {
  /** 'live' with the current stored state, or 'gone' when there's no live participation. */
  status: CheckInStatus;
  state: ParticipationState | null;
  /**
   * The session, for a caller with a live participation in it. Null on 'gone':
   * anyone holding a session id would otherwise learn that class's id and bell
   * window without being enrolled.
   */
  session: SessionView | null;
}

// POST /v1/sessions/{id}/unlock — emergency unlock (never discarded; see UnlockResponse).
// POST /v1/taps/{eventId}/unlock — the same unlock, sent under the phone's own
// tap while that tap is unanswered, so the phone cannot name a session (owner
// decision 11): filed in whatever session the tap landed in, under that
// session's rules, or kept with no session and a note. Same body, same answer.
export interface UnlockRequest {
  /** Client idempotency key for the unlock event (rule 4). */
  eventId: string;
  deviceTime: string;
  /**
   * Optional and skippable. A value the server does not recognise is recorded
   * as no reason rather than refused: validation must never be the reason an
   * unlock goes unrecorded (docs/PLAN.md decision log, 2026-09-20). Fixed once
   * recorded — a replay keeps the stored reason — so a phone that asks for one
   * after unlocking has to hold the send until it is answered or skipped.
   */
  reason?: UnlockReason | null;
  /**
   * The phone's own order for this unlock (A12): a return of the student's from the same
   * install is after it only when its `seq` is greater, whatever either clock said. An order
   * the server cannot use is taken as none, never refused.
   */
  order?: ActionOrder | null;
}

// POST /v1/sessions/{id}/refocus — return to focus after an unlock (needs a live participation).
// Refused (409) while protection is off: only a re-tap, which re-shields, leaves that state.
export interface RefocusRequest {
  eventId: string;
  deviceTime: string;
  /** The phone's own order for this return (A12): what orders it against the student's unlock. */
  order?: ActionOrder | null;
}
/** Every outcome a refocus answers with (`RefocusResponse.outcome`). */
export const REFOCUS_OUTCOMES = ['applied', 'replay'] as const;
export type RefocusOutcome = (typeof REFOCUS_OUTCOMES)[number];
export interface RefocusResponse {
  /**
   * `replay` is also the answer to a late refocus (A13) — one the phone made
   * before an unlock the server already has: recorded, never applied, and
   * answered with the truth now, as its retry is.
   */
  outcome: RefocusOutcome;
  /**
   * The current stored state. Null on the `replay` of a refocus whose
   * participation has since ended while the session runs — removed, left the
   * class, switched away (A4).
   */
  state: ParticipationState | null;
  /**
   * The running session, for reconciliation. Null on that replay: the student
   * is no longer in it, so no answer hands the phone its window to shield to
   * (`stateChangeDisposition`: 'reread').
   */
  session: SessionView | null;
}

// POST /v1/sessions/{id}/protection-off — the phone found its Screen Time
// permission revoked (iOS has already dropped every shield). Strict like
// refocus while the session runs: a 409 is a refusal — nothing live to mark, or
// an id already used by another event. A retry is refused too once the student
// has left the session (removed, left the class, or switched away) — never a
// replay naming a session they are no longer in. Once the session has ended, a
// report from a student who was in it at the end is recorded with a note
// instead (owner decision 10): 'recorded', with no session and no state —
// nothing to shield to. Every other report after the end is still a 409,
// including the retry of one that landed while the session ran (it is on
// record). Leaving the state takes a re-tap — refocus is refused from it.
export interface ProtectionOffRequest {
  /** Client idempotency key for the protection_off event (rule 4). */
  eventId: string;
  /** Device clock, ISO 8601; clamped into the session window server-side. */
  deviceTime: string;
  /** The phone's own order (A12), sent with every outbox record: stored, not yet read here. */
  order?: ActionOrder | null;
}
/** Every outcome a protection-off report answers with (`ProtectionOffResponse.outcome`). */
export const PROTECTION_OFF_OUTCOMES = ['applied', 'recorded', 'replay'] as const;
export type ProtectionOffOutcome = (typeof PROTECTION_OFF_OUTCOMES)[number];
export interface ProtectionOffResponse {
  /**
   * 'applied' marked a live participation; 'recorded' saved a report that first
   * reached the server after the session ended and marked nothing (owner
   * decision 10 — saved like a late unlock); 'replay' the report already landed.
   */
  outcome: ProtectionOffOutcome;
  /** Why nothing was marked, on a fresh 'recorded' report; null for 'applied' and 'replay', as on an unlock. */
  recordedAs: ProtectionOffRecordedAs | null;
  /**
   * 'protection_off' when applied; the current stored state on a replay while
   * the session runs. Null once the session has ended: nothing is live.
   */
  state: ParticipationState | null;
  /**
   * The running session, for reconciliation. Null once it has ended: after an
   * early end its endsAt is still ahead, and no answer may hand a phone a
   * window to shield to.
   */
  session: SessionView | null;
}

// POST /v1/enrollments — join a class by code (auth decision 3).
export interface EnrollmentJoinRequest {
  joinCode: string;
  /** Client idempotency key for the enrollment_joined event. */
  eventId: string;
  /** Device clock, ISO 8601 — the join event's occurredAt. */
  deviceTime: string;
}
/** Every outcome a join answers with (`EnrollmentJoinResponse.outcome`). */
export const ENROLLMENT_JOIN_OUTCOMES = ['joined', 'already_enrolled'] as const;
export type EnrollmentJoinOutcome = (typeof ENROLLMENT_JOIN_OUTCOMES)[number];
export interface EnrollmentJoinResponse {
  outcome: EnrollmentJoinOutcome;
  enrollmentId: string;
  class: MeClass;
}

// GET /v1/join-codes/{code} — what a join code opens, before joining it (A6).
// Matched as the join matches it, so the two never name different classes; a
// code no live class holds is the join's 404 `class_not_found`.
export interface JoinCodePreviewResponse {
  /** The class the code names — the one POST /v1/enrollments would join. */
  class: MeClass;
  /**
   * Its teacher, as the consent screen names them ("What Ms. Rivera sees").
   * `displayName` is null when their account carries none.
   */
  teacher: { displayName: string | null };
  /** True when the caller is in this class already: a join would answer `already_enrolled`. */
  alreadyEnrolled: boolean;
}

// GET /v1/me/history?before=&limit= — the student's own timeline (A7), in
// every class they have been in, left ones too.
export interface HistoryEvent {
  /** Stable across pages and reloads: a phone de-duplicates on it. */
  eventId: string;
  /**
   * `armed_tap_skipped`: a tap a Start declined, having counted in `countedIn`
   * already — never a join. `session_ended` / `session_expired`: the class
   * ended while the student was in it.
   */
  type: HistoryEventType;
  /** The device's time clamped into the session's window (rule 1), else the server's. */
  occurredAt: string;
  class: MeClass;
  /** `displayName` is null when the teacher's account carries none. */
  teacher: { displayName: string | null };
  /**
   * Its window: `endsAt` the scheduled end a time is clamped to, `endedAt` the
   * real one (null while it runs). Null for leaving a class while none of its
   * sessions ran.
   */
  session: { id: string; startedAt: string; endsAt: string; endedAt: string | null } | null;
  reason: UnlockReason | null;
  /**
   * Why an unlock, a protection off or a return to focus changed nothing —
   * `after_session_end`: it came after the end; `superseded`: it is late, a
   * later action of the student's own there having reached the server first.
   */
  recordedAs: UnlockRecordedAs | ProtectionOffRecordedAs | ReturnRecordedAs | null;
  countedIn: MeClass | null;
}
export interface HistoryPage {
  /**
   * Newest first. At one instant a leave is older than the join it caused, so
   * a phone showing a day oldest first reverses the page — never re-sorts on
   * `occurredAt`, which ties there.
   */
  events: HistoryEvent[];
  /** Pass as `before` for the next, older page; null at the end. A `400` for it: reload from the top. */
  nextBefore: string | null;
}

// GET /v1/classes/{id}/roster — the teacher's roster of active students.
export interface RosterStudent {
  enrollmentId: string;
  studentId: string;
  displayName: string | null;
  joinedAt: string;
}
export interface RosterResponse {
  students: RosterStudent[];
}

// POST /v1/classes — a teacher creates a class (the join code is server-generated).
export interface CreateClassRequest {
  name: string;
}

/** A class as its owning teacher manages it — the POST/GET/PATCH /v1/classes/{id} body. */
export interface ClassDetail {
  id: string;
  name: string;
  /** Server-generated, unique among live classes; students type it to join. */
  joinCode: string;
  createdAt: string;
  /**
   * The class's running session, or null when none is running. Lets a screen
   * recover the live grid on reload instead of showing "start a session" for a
   * lesson that is already under way.
   */
  liveSessionId: string | null;
}

// PATCH /v1/classes/{id} — rename and/or regenerate the join code (at least one).
export interface UpdateClassRequest {
  name?: string;
  /** True to mint a fresh join code (the old one stops working immediately). */
  regenerateCode?: boolean;
}

// POST /v1/blocks — a teacher registers a physical NFC tag to themselves.
export interface CreateBlockRequest {
  /** The id the physical tag broadcasts. */
  tagId: string;
}
export interface BlockDetail {
  id: string;
  tagId: string;
  createdAt: string;
}

// DELETE /v1/enrollments/{id} — a student leaves their own, or the teacher removes any.
/** Every outcome ending an enrollment answers with (`EndEnrollmentResponse.outcome`). */
export const END_ENROLLMENT_OUTCOMES = ['ended', 'already_removed'] as const;
export type EndEnrollmentOutcome = (typeof END_ENROLLMENT_OUTCOMES)[number];
/** Every `EndEnrollmentResponse.reason`: how the caller's action was classified. */
export const END_ENROLLMENT_REASONS = [
  'left_class',
  'removed_from_class',
] as const satisfies readonly ParticipationEndedReason[];
export type EndEnrollmentReason = (typeof END_ENROLLMENT_REASONS)[number];
export interface EndEnrollmentResponse {
  outcome: EndEnrollmentOutcome;
  /**
   * How this caller's action was classified: 'left_class' (the student left) or
   * 'removed_from_class' (the class's teacher removed them). On 'ended' it is how
   * the event was recorded; on 'already_removed' (a no-op) it is only this
   * caller's intent — the earlier removal recorded its own reason.
   */
  reason: EndEnrollmentReason;
  /** True when a live participation was ended too (the mid-session removal case). */
  endedParticipation: boolean;
}

// GET /v1/sessions/{id} — the grid boot snapshot (decision 5): the session, its
// roster with each student's participation, and the latest event seq to stream
// from, in one round trip.
/** An emergency unlock as the grid shows it on a student's chip (A9). */
export interface SnapshotUnlock {
  /** The reason the student gave (A1); null when none. */
  reason: UnlockReason | null;
  /**
   * Why it flipped nothing, when it flipped nothing (`payload.recorded_as`); null
   * when it flipped the row. Never `superseded`: a late unlock the student's own
   * return to focus went ahead of is on no chip.
   */
  recordedAs: UnlockRecordedAs | null;
  occurredAt: string;
}
export interface SnapshotStudent {
  /** Their live enrollment in the class; for a student who has since left it, their last. */
  enrollmentId: string;
  studentId: string;
  displayName: string | null;
  /** The stored participation state in THIS session, or null if the student never joined it. */
  state: ParticipationState | null;
  /**
   * All null when the student has no participation in this session. The client
   * derives the display state (including `silent`/`ended`) from these with its
   * own clock (rule 2), so the server ships the stored slice, not a derived label.
   */
  joinedAt: string | null;
  lastSeenAt: string | null;
  endedAt: string | null;
  /**
   * The student's latest emergency unlock in this session since they last
   * tapped in or returned to focus — a late one (`superseded`) never counts —
   * or null. `state` does not always show it:
   * the engine records an unlock without flipping the row when protection is
   * off (never softened into an unlock), when no participation is live, and
   * after the end — the grid reads it here as it reads the unlock event.
   */
  unlock: SnapshotUnlock | null;
  /**
   * True when a protection-off report first reached the server after this
   * session ended (A2c, noted `after_session_end`): recorded, while the ended
   * row stays as the end left it.
   */
  protectionOffAfterEnd: boolean;
}
export interface SessionSnapshot {
  session: SessionView & { startedAt: string };
  ended: boolean;
  /** The highest event seq for this session; stream from `latestSeq - EVENT_RESUME_OVERLAP`. */
  latestSeq: number;
  /**
   * Every student the session's feed can name: the class's active roster, and
   * anyone it holds a participation or an unlock for who has since left the
   * class — so each chip's name and state come back with every snapshot.
   */
  students: SnapshotStudent[];
}

/**
 * One event as the catch-up feed and the live stream carry it. On the SSE stream
 * this JSON is the `data:` frame, with `seq` echoed in the SSE `id:` line so a
 * reconnect can resume from it.
 */
export interface FeedEvent {
  seq: number;
  eventId: string;
  type: EventType;
  /** The user the event is about (the tapping/unlocking student), if any. */
  userId: string | null;
  occurredAt: string;
  payload: unknown;
}

// GET /v1/sessions/{id}/events?after=seq — the catch-up page, seq-ascending.
export interface EventsPage {
  events: FeedEvent[];
  /** Resume after this: the max seq returned, or the requested `after` when the page is empty. */
  nextAfter: number;
}
