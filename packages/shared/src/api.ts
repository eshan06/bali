import type { DisplayState } from './state.js';
import type { ParticipationState, UserRole } from './index.js';

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
