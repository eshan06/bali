import type { DisplayState } from './state.js';
import type { ParticipationState, UnlockRecordedAs, UserRole } from './index.js';
import type { UnlockRecordedOutcome } from './unlock-contract.js';

/*
 * The DTOs for the step-7 endpoints — the wire contract clients depend on, so
 * additive-only once shipped (API-surface decision 2). Timestamps cross the wire
 * as ISO 8601 strings.
 */

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
export interface MeResponse {
  user: { id: string; role: UserRole; displayName: string | null };
  classes: MeClass[];
  /** The caller's live session, if any, with its derived display state. */
  session: (SessionView & { state: DisplayState }) | null;
}

// POST /v1/taps — the tap.
export interface TapRequest {
  /** The NFC tag id the block broadcasts. */
  tagId: string;
  /** Client idempotency key (a UUID the phone mints). */
  eventId: string;
  /** Device clock, ISO 8601; clamped into the session window server-side. */
  deviceTime: string;
}
export type TapOutcome = 'joined' | 'switched' | 'armed' | 'already_armed' | 'replay';
export interface TapResponse {
  outcome: TapOutcome;
  /** The joined session (joined/switched/replay); null when the tap was armed. */
  session: SessionView | null;
  /** The resulting stored state when joined; null when armed. */
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
 * participation to unlocked; 'recorded' saved the event with a note when there
 * was no live participation to flip; 'replay' means the event already landed.
 * All three mean "durably recorded" — the phone's outbox stops retrying (see
 * unlockDisposition).
 */
export type UnlockOutcome = UnlockRecordedOutcome;
export interface UnlockResponse {
  outcome: UnlockOutcome;
  /** Why nothing was flipped, on a fresh 'recorded' unlock; null for 'applied' and 'replay'. */
  recordedAs: UnlockRecordedAs | null;
  /**
   * 'unlocked' when a live participation flipped; on a replay, the participation's
   * current stored state (which may be an ended participation's last state); null
   * when nothing is or was participating.
   */
  state: ParticipationState | null;
  /** The session for reconciliation; null only when the session id was unknown. */
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
export interface EnrollmentJoinResponse {
  outcome: 'joined' | 'already_enrolled';
  enrollmentId: string;
  class: MeClass;
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
export interface EndEnrollmentResponse {
  outcome: 'ended' | 'already_removed';
  /**
   * How this caller's action was classified: 'left_class' (the student left) or
   * 'removed_from_class' (the class's teacher removed them). On 'ended' it is how
   * the event was recorded; on 'already_removed' (a no-op) it is only this
   * caller's intent — the earlier removal recorded its own reason.
   */
  reason: 'left_class' | 'removed_from_class';
  /** True when a live participation was ended too (the mid-session removal case). */
  endedParticipation: boolean;
}
