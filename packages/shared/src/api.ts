import type { DisplayState } from './state.js';
import type {
  ActivityEventType,
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
  /**
   * What the portal's Home and Classes show of a teacher's own class (PV2, added 2026-10-12,
   * additive). Absent on a student's class.
   */
  summary?: ClassSummary;
}
/** A teacher's own class at a glance (PV2), by the server's clock. */
export interface ClassSummary {
  /** The students enrolled in it now: a join counts, a leave or a removal no longer does. */
  studentCount: number;
  /**
   * Its session running now by the server's clock (A17), and its bell: `liveSession`'s shape,
   * since `liveSession` stays null on a teacher's own class (the app would tell a teacher signed
   * into it to tap in). Null when none runs.
   */
  runningSession: { id: string; endsAt: string } | null;
  /**
   * Its newest session that is over by the server's clock (A17), never the running one: one past
   * its bell is, though the sweep has not marked it yet. When it started, and when it ended: its
   * End, else its bell, the time the sweep stamps. Null when the class has had none. Its figures
   * are its report's (`GET /v1/classes/{id}/reports/sessions/{sessionId}`).
   */
  lastSession: { id: string; startedAt: string; endedAt: string } | null;
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

// DELETE /v1/me — the caller deletes their own account (C3, App Store
// 5.1.1(v)): every class left, their events kept for the class's counts but
// named to no one, their name and sign-in gone. A teacher with a class is
// refused, `409 teacher_has_classes`: theirs goes through the school.
export interface DeleteMeRequest {
  /** Client idempotency key for the account_deleted event (rule 4). */
  eventId: string;
}
/** Every outcome `DELETE /v1/me` answers with (`DeleteMeResponse.outcome`). */
export const DELETE_ME_OUTCOMES = ['deleted', 'already_deleted'] as const;
export type DeleteMeOutcome = (typeof DELETE_ME_OUTCOMES)[number];
export interface DeleteMeResponse {
  /**
   * 'deleted' this call deleted the account; 'already_deleted' this sign-in has
   * no account here — the retry of a deletion that landed, or none was ever
   * made. Either way there is no account: the phone stops asking.
   */
  outcome: DeleteMeOutcome;
}

// GET /v1/me/age-check — whether the caller's account confirmed it is 13 or older
// (C7-server): a read that creates nothing, so the app asks it right after any
// sign-in, before the 13+ question. PUT /v1/me/age-check records the yes. Only
// that the account passed is kept, never a birth date or an age.
export interface AgeCheckResponse {
  /**
   * true once the account's yes is recorded, and always for a teacher's, which
   * comes from the school's invite; false for an account here with none, or no
   * account here at all.
   */
  passed: boolean;
}
export interface RecordAgeCheckRequest {
  /** Client idempotency key (rule 4). */
  eventId: string;
}

// PUT /v1/me/push-token — a student registers its phone's APNs device token
// (N3; ARCHITECTURE, "Push: a doorbell for students"). One phone, one current
// owner: a token another account registered moves to the caller. Students only
// (a teacher is `403`). DELETE /v1/me/push-token removes it again.
/** The APNs environment a token was issued for: `sandbox` (Debug builds) or `production`. */
export const PUSH_ENVIRONMENTS = ['sandbox', 'production'] as const;
export type PushEnvironment = (typeof PUSH_ENVIRONMENTS)[number];
/** The longest device token the API reads, in hex digits: APNs's are 64 today. */
export const PUSH_TOKEN_MAX_LENGTH = 200;
export interface RegisterPushTokenRequest {
  /** The token APNs gave the phone, in hex (either case; stored lower-case). */
  token: string;
  environment: PushEnvironment;
  /** Client idempotency key (rule 4). */
  eventId: string;
}
/** Every outcome `PUT /v1/me/push-token` answers with (`RegisterPushTokenResponse.outcome`). */
export const REGISTER_PUSH_TOKEN_OUTCOMES = ['registered', 'replay'] as const;
export type RegisterPushTokenOutcome = (typeof REGISTER_PUSH_TOKEN_OUTCOMES)[number];
export interface RegisterPushTokenResponse {
  /**
   * 'registered' the token is the caller's now, with `environment`; 'replay'
   * this eventId already registered it — nothing is written again, and
   * `environment` is the token's now.
   */
  outcome: RegisterPushTokenOutcome;
  environment: PushEnvironment;
}

// DELETE /v1/me/push-token — a student removes its phone's token (signing out,
// or notifications turned off). A token not the caller's is never touched.
export interface RemovePushTokenRequest {
  token: string;
  /** Client idempotency key (rule 4). */
  eventId: string;
}
/** Every outcome `DELETE /v1/me/push-token` answers with (`RemovePushTokenResponse.outcome`). */
export const REMOVE_PUSH_TOKEN_OUTCOMES = ['removed', 'not_registered'] as const;
export type RemovePushTokenOutcome = (typeof REMOVE_PUSH_TOKEN_OUTCOMES)[number];
export interface RemovePushTokenResponse {
  /**
   * 'removed' this call removed it; 'not_registered' the caller holds no such
   * token — the retry of a removal that landed, or it moved to another account.
   * Either way it is not the caller's now.
   */
  outcome: RemovePushTokenOutcome;
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
  /**
   * True when one of the student's records in this session came from a phone
   * whose clock read more than `CLOCK_AHEAD_THRESHOLD_MS` ahead of the server
   * (S9, its payload's `clock_ahead_s`). Advisory: the times stay clamped and
   * every order stands. Additive: an older server omits it.
   */
  clockOff?: boolean;
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
  /**
   * The session's open question (Phase 7, L3), so a reloaded portal finds it: null when none is
   * open by the server's clock, so past the bell too. Additive: an older server omits it.
   */
  question?: TeacherQuestion | null;
  /**
   * What the session shows (Phase 7, M3b), so a reloaded presenter finds it and mints its next
   * slide change after the last: null before its first slide change, and once the session is not
   * running by the server's clock. Additive: an older server omits it.
   */
  presentation?: SessionPresentation | null;
}

// POST /v1/sessions/{id}/questions — open a question; POST /v1/questions/{id}/close — close it
// (Phase 7, L3; "Live lesson", decision 6). The class's own teacher only.
/** A live lesson's question as its teacher sees it. */
export interface TeacherQuestion {
  id: string;
  prompt: string;
  /** 2–6; an answer names one by its index. */
  options: string[];
  /** The correct option's index, when the teacher gave one. */
  correctOption: number | null;
  /** Whether its close showed students the correct option. */
  revealed: boolean;
  /**
   * Never closed, and its session running by the server's clock (A17): past the bell it is
   * closed, though the sweep has not yet marked it.
   */
  open: boolean;
}
export interface OpenQuestionRequest {
  eventId: string;
  /** Trimmed, at most `QUESTION_PROMPT_MAX_LENGTH` code points; line breaks allowed. */
  prompt: string;
  /** `QUESTION_OPTIONS_MIN`–`QUESTION_OPTIONS_MAX`, each trimmed, at most `QUESTION_OPTION_MAX_LENGTH`. */
  options: string[];
  correctOption?: number | null;
}
export interface CloseQuestionRequest {
  eventId: string;
  /** Show students the correct option, when the question has one. */
  reveal?: boolean;
}
/**
 * Every outcome an open or a close answers with (`QuestionResponse.outcome`): `opened`, `closed`,
 * or `replay`, which changed nothing — the open's own retry, or a close of a question already
 * closed (by the teacher, a newer question, or its session's end, the bell included).
 */
export const QUESTION_OUTCOMES = ['opened', 'closed', 'replay'] as const;
export type QuestionOutcome = (typeof QUESTION_OUTCOMES)[number];
export interface QuestionResponse {
  outcome: QuestionOutcome;
  /** The question now. */
  question: TeacherQuestion;
}

// GET and POST /v1/saved-questions, PUT and DELETE /v1/saved-questions/{id} — a teacher's drafts of
// questions (Phase 7, L3b; "Live lesson", decision 12), their own only. A save's body is an open's
// (`OpenQuestionRequest`), and a removal's `{ eventId }`.
/** A teacher's draft of a question: never shown to a student until asked. */
export interface SavedQuestion {
  id: string;
  prompt: string;
  /** 2–6, as a question's. */
  options: string[];
  correctOption: number | null;
  /**
   * The id of the write that last wrote it. A save applies only when its `eventId` sorts after this
   * one (UUIDv7 order, as an answer's: decision 4), so a client mints its next save after it.
   */
  eventId: string;
  createdAt: string;
  /** Its last write's time: later than `createdAt` once it was edited. */
  updatedAt: string;
}
/**
 * Every outcome a draft's write answers with (`SavedQuestionResponse.outcome`): `created`,
 * `replaced`, `removed`, or `replay`, which changed nothing: the write's own retry, or a save older
 * than the draft's last write.
 */
export const SAVED_QUESTION_OUTCOMES = ['created', 'replaced', 'removed', 'replay'] as const;
export type SavedQuestionOutcome = (typeof SAVED_QUESTION_OUTCOMES)[number];
export interface SavedQuestionResponse {
  outcome: SavedQuestionOutcome;
  /** The draft now: once removed, as it was removed. */
  savedQuestion: SavedQuestion;
}
export interface SavedQuestionsResponse {
  /** Newest first, by when each was written first; never a removed one. */
  savedQuestions: SavedQuestion[];
}

// GET and POST /v1/decks, DELETE /v1/decks/{id}, POST /v1/decks/{id}/complete — a teacher's slide
// decks (Phase 7, M2; "Live lesson", decision 6), their own only. The PDF goes to the bucket by the
// create's presigned PUT, never through the API; a removal's body and a complete's are `{ eventId }`.
/** Where a deck stands: `pending` until its upload is checked, then `ready` or `rejected`. */
export const DECK_STATUSES = ['pending', 'ready', 'rejected'] as const;
export type DeckStatus = (typeof DECK_STATUSES)[number];
/**
 * Why a deck was rejected (`Deck.rejection`), for its teacher to read: `not_pdf`, no `%PDF-` at its
 * start or nothing PDF.js can read as a PDF with a page; `too_large`, more than `DECK_MAX_BYTES` in
 * the bucket; `mismatch`, not the length or SHA-256 declared, so the upload didn't arrive whole;
 * `too_many_pages`, more than `DECK_MAX_PAGES`; `encrypted`, a password on it, to open it or an
 * owner's; `too_slow`, its parse ran past the check's time limit or out of its memory; `unfinished`,
 * nothing uploaded, or no check asked for within 24 hours (the sweep's, M2b2). Additive-only like
 * the other vocab.
 */
export const DECK_REJECTIONS = [
  'not_pdf',
  'too_large',
  'mismatch',
  'too_many_pages',
  'encrypted',
  'too_slow',
  'unfinished',
] as const;
export type DeckRejection = (typeof DECK_REJECTIONS)[number];
/** A teacher's deck: a PDF in the bucket, which no student sees before it is checked. */
export interface Deck {
  id: string;
  title: string;
  status: DeckStatus;
  /** The file's length, as declared. */
  bytes: number;
  /** The file's SHA-256, lowercase hex: every client checks a download against it. */
  sha256: string;
  /** Once `ready`; null before. */
  pageCount: number | null;
  /** Once `rejected`, why; null otherwise (added M2b). */
  rejection: DeckRejection | null;
  createdAt: string;
}
export interface CreateDeckRequest {
  eventId: string;
  /** Trimmed, one line, at most `DECK_TITLE_MAX_LENGTH` code points. */
  title: string;
  /** The file's exact length, at most `DECK_MAX_BYTES`. */
  bytes: number;
  /** The file's SHA-256, lowercase hex. */
  sha256: string;
}
/**
 * Every outcome a deck's write answers with (`DeckResponse.outcome`): `created`, `removed`,
 * `checked` (its upload checked: `ready` or `rejected`, M2b), or `replay`, which changed nothing:
 * the write's own retry, or a complete of a deck already checked, answered with its verdict.
 */
export const DECK_OUTCOMES = ['created', 'removed', 'checked', 'replay'] as const;
export type DeckOutcome = (typeof DECK_OUTCOMES)[number];
export interface DeckResponse {
  outcome: DeckOutcome;
  /** The deck now: once removed, as it was removed. */
  deck: Deck;
}
export interface CreateDeckResponse extends DeckResponse {
  /**
   * Where the browser PUTs the file, for 5 minutes: exactly `bytes` bytes, sent as
   * `Content-Type: application/pdf`. A replay carries a fresh one.
   */
  uploadUrl: string;
}
export interface DecksResponse {
  /** Newest first; never a removed one. */
  decks: Deck[];
}

// POST /v1/sessions/{id}/slide — show a page of a deck in a running session, or stop presenting
// (Phase 7, M3; "Live lesson", decisions 4–6): the class's own teacher, their own ready decks.
/**
 * A page a running session shows. Never a URL: a client fetches the deck through
 * `GET /v1/decks/{id}/download` and checks the bytes against `sha256` (decision 8).
 */
export interface Slide {
  deckId: string;
  sha256: string;
  /** From 1 to `pageCount`. */
  page: number;
  pageCount: number;
}
export interface ShowSlideRequest {
  eventId: string;
  /** A ready deck of the caller's, or null to stop presenting. */
  deckId: string | null;
  /** From 1 to the deck's `pageCount`; none when `deckId` is null. */
  page?: number | null;
}
/**
 * Every outcome a slide change answers with (`SlideResponse.outcome`): `shown`, or `replay`, which
 * changed nothing — its own retry, or a slide change older than the one shown (decision 4's order).
 */
export const SLIDE_OUTCOMES = ['shown', 'replay'] as const;
export type SlideOutcome = (typeof SLIDE_OUTCOMES)[number];
export interface SlideResponse {
  outcome: SlideOutcome;
  /** The page the session shows now; null once presenting stopped, or the session is over. */
  slide: Slide | null;
  /**
   * The slide change that set what it shows now. One applies only when its `eventId` sorts after
   * this one (UUIDv7 order, as an answer's: decision 4), so a client mints its next after it.
   */
  eventId: string;
}
/** What a running session shows, as its teacher's snapshot reads it (M3b). */
export interface SessionPresentation {
  /** The page shown now; null once presenting stopped. */
  slide: Slide | null;
  /** The slide change that set it, as `SlideResponse.eventId`: a client mints its next after it. */
  eventId: string;
}

// GET /v1/decks/{id}/download — where a deck's PDF is fetched from (Phase 7, M3b; "Live lesson",
// decisions 6 and 8): its own teacher, or a student while a running session of their class shows it.
export interface DeckDownload {
  /**
   * A presigned GET of the PDF, good for minutes and answered `Cache-Control: no-store`: fetched at
   * once, its bytes checked against the slide's `sha256`. Once it has expired, ask again.
   */
  url: string;
}

// GET /v1/questions/{id}/results — a question's totals (Phase 7, L3r; "Live lesson", decisions 3
// and 6), the class's own teacher only. A strong ETag over the body; `If-None-Match` answers `304`.
export interface QuestionResults {
  /** N: everyone with an answer to it, a student removed since included. */
  answered: number;
  /**
   * M: everyone in the class at any time while it could be answered, the session's participants
   * and everyone counted in N, so never below N, and never changed by a removal.
   */
  eligible: number;
  /** As `TeacherQuestion.open`: by the server's clock, so closed past the bell. */
  open: boolean;
  correctOption: number | null;
  revealed: boolean;
  /** Per option, by its index, totalling N; null until at least 3 have answered (the guard). */
  counts: number[] | null;
}

// GET /v1/sessions/{id}/presentation — what a student's phone and the student web show of a live
// lesson (Phase 7, L4; "Live lesson", decision 6), polled about every 2 s; a student enrolled in the
// session's class now. A strong ETag over the body, and `If-None-Match` answers `304`.
export interface Presentation {
  /** The session runs by the server's clock: false tells the client to stop polling. */
  running: boolean;
  /**
   * The open question, or the last closed one until another opens; null when none was asked, and
   * once the session is over: nothing is shown outside one (decision 2).
   */
  question: StudentQuestion | null;
  /**
   * The page the teacher shows (M3b), never a URL: a client fetches a deck it has not cached through
   * `GET /v1/decks/{id}/download`. Null while nothing is shown, and once the session is over.
   */
  slide: Slide | null;
  /**
   * The caller's own phone in this session (W1; decision 13), as the teacher's grid shows it: null
   * while they have no live participation here — not tapped in, or gone to another class — and
   * once the session is over. Never another student's.
   */
  phone: StudentPhone | null;
}
/** A student's own phone in a running session: `deriveDisplayState` at the server's clock (rule 2). */
export interface StudentPhone {
  /** Silent past `SILENCE_THRESHOLD_MS` without a check-in, by the server's clock. */
  state: Exclude<DisplayState, 'ended'>;
  /**
   * When the server last heard from the phone, its last check-in or else its tap, once `silent`;
   * null otherwise, so a check-in short of silence changes nothing here and the poll stays `304`.
   */
  lastSeenAt: string | null;
}
/** A live lesson's question as a student sees it: never anyone's counts. */
export interface StudentQuestion {
  id: string;
  prompt: string;
  /** 2–6; an answer names one by its index. */
  options: string[];
  /** As `TeacherQuestion.open`: an answer counts only while it is. */
  open: boolean;
  /** The correct option's index once its close revealed it; null until then, and when none. */
  correctOption: number | null;
  /** The caller's own answer now, if they gave one. */
  answer: StudentAnswer | null;
}
/** A student's answer now. */
export interface StudentAnswer {
  option: number;
  /**
   * The id it was sent under. An answer replaces it only when its `eventId` sorts after this one
   * (UUIDv7 order: decision 4), so a client mints its next answer after it.
   */
  eventId: string;
}

// POST /v1/questions/{id}/answers — a student answers a live lesson's question (Phase 7, L4;
// "Live lesson", decisions 4–6), sent once and never queued.
export interface AnswerRequest {
  /** A UUIDv7. */
  eventId: string;
  /** The option's index. */
  option: number;
}
/**
 * Every outcome an answer is answered with (`AnswerResponse.outcome`): `answered`, or `replay`,
 * which changed nothing — its own retry, or an answer older than the one held.
 */
export const ANSWER_OUTCOMES = ['answered', 'replay'] as const;
export type AnswerOutcome = (typeof ANSWER_OUTCOMES)[number];
export interface AnswerResponse {
  outcome: AnswerOutcome;
  /** The caller's answer now. */
  answer: StudentAnswer;
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

// GET /v1/classes/{id}/reports/sessions/{sessionId}/questions — the questions a session asked, for
// its report (Phase 7, L3c; "Live lesson", decisions 3 and 6), for the class's own teacher as R2's
// report is. Totals only: each question's are the results route's, through its one guarded count,
// and nothing names a student or carries an answer's time.
/** A question the session asked, with its totals as `QuestionResults` gives them. */
export interface SessionReportQuestion extends TeacherQuestion {
  /** When it was asked, by the server's clock. */
  openedAt: string;
  /** N: everyone with an answer to it, a student removed since included. */
  answered: number;
  /** M, as `QuestionResults.eligible`: never below N, and never changed by a removal. */
  eligible: number;
  /** Per option, by its index, totalling N; null until at least 3 have answered (the guard). */
  counts: number[] | null;
}
export interface SessionReportQuestionsResponse {
  /** In the order asked; empty when it asked none. */
  questions: SessionReportQuestion[];
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

// GET /v1/me/activity — a teacher's Recent activity (PV3, added 2026-10-12): Home's `Main` board.
// From today's sessions of the caller's own live classes, today by the server's clock in the
// school's zone (hosting decision 5). Its unlocks and protection offs are those each session's
// report lists (R2), late ones and ones after the bell included, so the two never disagree.
/** One moment of Recent activity. */
export interface ActivityEvent {
  /** The event's own id: stable across reads. */
  eventId: string;
  /** An Emergency Unlock, protection off, or a session started. */
  type: ActivityEventType;
  /** The device's time clamped into the session's window (rule 1); a start's, when it started. */
  occurredAt: string;
  /** Its class, by its name now. */
  class: MeClass;
  /**
   * Its student, as the report and the grid name them: their display name now, null when their
   * account has none (a deleted account's has none), where the grid shows the first 8 characters
   * of `id`. Null on a session started.
   */
  student: ReportStudent | null;
  /** An unlock's reason now: its latest change's (A20), else the one sent with it; null when none. */
  reason: UnlockReason | null;
}
export interface ActivityResponse {
  /** Newest first, by `occurredAt`; `ACTIVITY_LIMIT` at most. No paging: Home shows these. */
  events: ActivityEvent[];
}
