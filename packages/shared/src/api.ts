import type { DisplayState } from './state.js';
import type { EventType, ParticipationState, UnlockRecordedAs, UserRole } from './index.js';
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
export interface CheckInResponse {
  /** 'live' with the current stored state, or 'gone' when there's no live participation. */
  status: 'live' | 'gone';
  state: ParticipationState | null;
  /**
   * The session, for a caller with a live participation in it. Null on 'gone':
   * anyone holding a session id would otherwise learn that class's id and bell
   * window without being enrolled.
   */
  session: SessionView | null;
}

// POST /v1/sessions/{id}/unlock — emergency unlock (never discarded; see UnlockResponse).
export interface UnlockRequest {
  /** Client idempotency key for the unlock event (rule 4). */
  eventId: string;
  deviceTime: string;
}

// POST /v1/sessions/{id}/refocus — return to focus after an unlock (needs a live participation).
export interface RefocusRequest {
  eventId: string;
  deviceTime: string;
}
export interface RefocusResponse {
  outcome: 'applied' | 'replay';
  state: ParticipationState;
  session: SessionView;
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

// GET /v1/sessions/{id} — the grid boot snapshot (decision 5): the session, its
// roster with each student's participation, and the latest event seq to stream
// from, in one round trip.
export interface SnapshotStudent {
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
}
export interface SessionSnapshot {
  session: SessionView & { startedAt: string };
  ended: boolean;
  /** The highest event seq for this session; stream from `latestSeq - EVENT_RESUME_OVERLAP`. */
  latestSeq: number;
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
