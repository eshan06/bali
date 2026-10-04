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
/** A teacher as a student's phone names them ("with Ms. Rivera"). */
export interface TeacherView {
  /** Null when their account carries none. */
  displayName: string | null;
}
/**
 * A class as `/v1/me` lists it (C2a, additive): with its teacher, whom Home
 * and Me name under it and Focus says "with". A teacher's own classes name the
 * caller themself.
 */
export interface MeClassWithTeacher extends MeClass {
  teacher: TeacherView;
  /**
   * The caller's enrollment in it (A19, additive): what leaving it deletes
   * (`DELETE /v1/enrollments/{id}`). Null on a teacher's own class, which they
   * teach and are not enrolled in.
   */
  enrollmentId: string | null;
  /**
   * Its session running now by the server's clock, and its bell (C3c, additive):
   * Home says the class is in session to a student not in it. Null when none
   * runs, and on a teacher's own class.
   */
  liveSession: { id: string; endsAt: string } | null;
}
export interface MeUser {
  id: string;
  role: UserRole;
  /** What teachers see beside this student; null until a sign-in or the student sets one. */
  displayName: string | null;
}
export interface MeResponse {
  user: MeUser;
  classes: MeClassWithTeacher[];
  /** The caller's live session, if any, with its derived display state. */
  session: (SessionView & { state: DisplayState }) | null;
  /**
   * Whether a tap of the caller's waits for a Start that would join them
   * (decision 5; #166, additive): not taken by a Start, not past the end of
   * its school day by the server's clock, and for a teacher of a class they
   * are in — what a Start converts. False once none does, so a phone waiting
   * for its teacher's Start stops waiting. False for a teacher.
   */
  armed: boolean;
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

// POST /v1/teacher-invites/redeem — a signed-in account redeems the invite code
// the owner minted for a school (T1b), and is a teacher there from then on.
export interface RedeemTeacherInviteRequest {
  /** The code as the owner's command printed it; its case, spaces and dashes are set aside. */
  code: string;
  /** Client idempotency key for the redeem (rule 4). */
  eventId: string;
}
export interface RedeemTeacherInviteResponse {
  /**
   * 'redeemed' made the account a teacher at the code's school; 'replay' this
   * eventId already did — nothing is redeemed again, and `user` is the truth now.
   */
  outcome: 'redeemed' | 'replay';
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
   * unlock is new, the one on record now on a replay — its latest change, if
   * the student changed it since (A20). Null when none was given or the one sent
   * was not recognised — so a phone can tell its reason did not land.
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
   * unlock goes unrecorded (docs/PLAN.md decision log, 2026-09-20). A replay
   * never applies the reason it carries: once the unlock is recorded, its
   * reason changes only through `PATCH /v1/unlocks/{eventId}` (A20).
   */
  reason?: UnlockReason | null;
  /**
   * The phone's own order for this unlock (A12): a return of the student's from the same
   * install is after it only when its `seq` is greater, whatever either clock said. An order
   * the server cannot use is taken as none, never refused.
   */
  order?: ActionOrder | null;
}

// PATCH /v1/unlocks/{eventId} — the student changes their unlock's reason (A20),
// the unlock named by its own event id; recorded as an event of its own. Only
// while it is the unlock the grid shows — no return, tap or unlock of theirs
// there since — and the session runs: else `409 unlock_superseded` / `409
// session_not_running`; no unlock of the caller's in a session, `404
// unlock_not_found`. A refusal records nothing.
export interface UnlockReasonRequest {
  /** One of `UNLOCK_REASONS`; anything else is a 400. */
  reason: UnlockReason;
  /** This change's idempotency key (rule 4); the unlock's own id is in the path. */
  eventId: string;
}
/** Every outcome a reason change answers with (`UnlockReasonResponse.outcome`). */
export const UNLOCK_REASON_OUTCOMES = ['applied', 'replay'] as const;
export type UnlockReasonOutcome = (typeof UNLOCK_REASON_OUTCOMES)[number];
export interface UnlockReasonResponse {
  /** 'applied' recorded the change; 'replay' this eventId already did, and nothing is applied again. */
  outcome: UnlockReasonOutcome;
  /** The unlock's reason on record now: this one when applied; on a replay, the latest since. */
  reason: UnlockReason;
}

// POST /v1/sessions/{id}/refocus — return to focus after an unlock (needs a live participation).
// Refused (409) while protection is off: a re-tap, which re-shields, or Screen Time back on
// (`…/protection-on`, #167) leaves that state.
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
// record). Leaving the state takes a re-tap or Screen Time back on (#167) —
// refocus is refused from it.
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

// POST /v1/sessions/{id}/protection-on — Screen Time back on, in the class the
// student tapped into (#167, the owner's decision 2026-10-02): out of
// protection off to the state before it, with no re-tap — focused, or unlocked
// where their latest turn there is an unlock — recorded as its own event.
// Strict like refocus: a live participation in protection off, in a session
// running by the server's clock, or a 409 (`protection_not_off`, nothing
// recorded, where it is not in protection off). One the phone made before a
// protection off of its own the server already has is late: recorded, never
// applied, and answered as its retry is.
export interface ProtectionOnRequest {
  /** Client idempotency key for the protection_on event (rule 4). */
  eventId: string;
  /** Device clock, ISO 8601; clamped into the session window server-side. */
  deviceTime: string;
  /** The phone's own order (A12): what orders it against the student's protection off. */
  order?: ActionOrder | null;
}
/** Every outcome Screen Time back on answers with (`ProtectionOnResponse.outcome`). */
export const PROTECTION_ON_OUTCOMES = ['applied', 'replay'] as const;
export type ProtectionOnOutcome = (typeof PROTECTION_ON_OUTCOMES)[number];
export interface ProtectionOnResponse {
  /** `replay` is also the answer to a late one, as a late refocus's is (A13). */
  outcome: ProtectionOnOutcome;
  /**
   * The state it returned the student to when applied — `focused` or
   * `unlocked`; the current stored state on a replay. Null on the replay of one
   * whose participation has since ended while the session runs (A4).
   */
  state: ParticipationState | null;
  /** The running session, for reconciliation; null on that replay (`stateChangeDisposition`: 'reread'). */
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
  teacher: TeacherView;
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
  teacher: TeacherView;
  /**
   * Its window: `endsAt` the scheduled end a time is clamped to, `endedAt` the
   * real one (null while it runs). Null for leaving a class while none of its
   * sessions ran.
   */
  session: { id: string; startedAt: string; endsAt: string; endedAt: string | null } | null;
  /** An unlock's reason now: its latest change, if the student changed it (A20). */
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
// GET /v1/blocks — the caller's own live blocks, oldest first (Phase 5 · P3).
export interface BlockListResponse {
  blocks: BlockDetail[];
}

// DELETE /v1/enrollments/{id} — a student leaves their own, or the teacher removes any.
// A student never leaves while the class has a session running by the server's
// clock: `409 class_in_session`, nothing recorded (owner, 2026-09-30; A19).
export interface EndEnrollmentRequest {
  /**
   * Client idempotency key for the leave's event (rule 4, A19). Optional, since
   * the endpoint shipped without a body and `/v1` is additive-only: the server
   * mints one when it is absent. The removal is idempotent on the enrollment
   * either way — a retry of one that landed is `already_removed` — and an id
   * already recorded for another event is `409 event_id_conflict`.
   */
  eventId?: string;
}
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
  /** Its event id (A20, additive): what a streamed `unlock_reason_changed` names. */
  eventId: string;
  /** The reason the student gave (A1) — its latest change, if they changed it (A20); null when none. */
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
   * tapped in or returned to focus — a late record (`superseded`), an unlock or
   * a return, never counts — or null. `state` does not always show it:
   * the engine records an unlock without flipping the row when protection is
   * off (never softened into an unlock), when no participation is live, and
   * after the end — the grid reads it here as it reads the unlock event. One
   * noted `protection_off` can sit on an `unlocked` row too: Screen Time back on
   * (#167) returned the student to it, and there the row is the truth.
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

// GET /v1/classes/{id}/reports/sessions/{sessionId} — one session's report (R2), for the
// class's own teacher: what `sessionReport` counts (R1). Aggregates only, never rankings: no
// student's own minutes. Everyone it names took part — joined, unlocked or turned protection off
// there — so a student removed from the class since is still named.
/** A student as a report names them. */
export interface ReportStudent {
  id: string;
  /** Their display name now; null when their account has none. */
  displayName: string | null;
}
/** An emergency unlock in the session, listed whatever it changed. */
export interface SessionReportUnlock {
  eventId: string;
  student: ReportStudent;
  /** The device's time clamped into the session's window (rule 1). */
  occurredAt: string;
  /** Its reason now: its latest change's (A20), else the one sent with it; null when none. */
  reason: UnlockReason | null;
  /**
   * Why it changed nothing, when it changed nothing: `superseded` (late, so it never ended
   * focus), `protection_off`, `no_live_participation` or `after_session_end`. Null when it has
   * no note this build knows: none, so it took effect; or a newer build's, which changed nothing
   * either, since a note always means the engine did not apply the record. A client reads a note
   * it doesn't know as none.
   */
  recordedAs: UnlockRecordedAs | null;
}
/** A protection-off ("Screen Time off") report in the session: it ends focus as an unlock does. */
export interface SessionReportProtectionOff {
  eventId: string;
  student: ReportStudent;
  occurredAt: string;
  /** `after_session_end`: it reached the server after the end and changed nothing. Null as on an unlock. */
  recordedAs: ProtectionOffRecordedAs | null;
}
/**
 * Minutes are whole, each rounded to the nearest (a half up) from its exact figure: the total
 * from the exact sum of every student's time, never a sum of rounded parts, and the average from
 * the exact total over the students who joined. So the average times who joined can be a minute
 * or so off the total.
 */
export interface SessionReportResponse {
  /**
   * Whether the session is marked over, as the grid's snapshot says it. False while it runs,
   * and past its bell until the sweep marks it: the counts then run to now, or to the bell.
   */
  ended: boolean;
  /** Who joined, in the order they first did: never a tap a Start declined, nor a late one. */
  joined: ReportStudent[];
  /** Focused and in contact: the whole class's. */
  focusMinutes: number;
  /** `focusMinutes` per student who joined; null when no one did. */
  averageFocusMinutes: number | null;
  /** Focused but gone quiet: never counted as focus. */
  silentMinutes: number;
  /** Oldest first. */
  unlocks: SessionReportUnlock[];
  /** Oldest first. */
  protectionOffs: SessionReportProtectionOff[];
}

// GET /v1/classes/{id}/reports/sessions?before=&limit= — the class's sessions (R3), for its own
// teacher, a page at a time, each with its totals: what its report says, counted by the same
// `sessionReport` and rounded the same way, so a row never disagrees with its session's report.
// Aggregates only, never rankings.
export interface SessionReportSummary {
  /** The session: its report is GET /v1/classes/{id}/reports/sessions/{sessionId}. */
  id: string;
  startedAt: string;
  /** Its bell: the scheduled end, which an extend moves on. */
  endsAt: string;
  /** When it was marked over; null until then. */
  endedAt: string | null;
  /** As the report says it: false while it runs, and past its bell until the sweep marks it. */
  ended: boolean;
  /** How many joined: the report's `joined`, counted. */
  joinedCount: number;
  /** The report's, whole minutes each rounded from its exact figure. */
  focusMinutes: number;
  averageFocusMinutes: number | null;
  silentMinutes: number;
  /** How many unlocks and protection offs the report lists, whatever each changed. */
  unlockCount: number;
  protectionOffCount: number;
}
export interface SessionReportsPage {
  /** Newest first, by when each started. */
  sessions: SessionReportSummary[];
  /** Pass as `before` for the next, older page; null at the end. A `400` for it: reload from the top. */
  nextBefore: string | null;
}
