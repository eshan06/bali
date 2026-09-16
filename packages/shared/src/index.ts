/**
 * @bali/shared — types and constants shared between the API and its clients.
 * DTOs for each endpoint land here as the endpoints get built (Phase 1, step 7).
 */

/** URL version prefix. Additive-only once shipped; see docs/ARCHITECTURE.md "API surface". */
export const API_VERSION = 'v1';

/** Response shape of GET /healthz. */
export interface HealthzResponse {
  status: 'ok';
  version: string;
}

/*
 * Shared vocabulary for the data model (docs/ARCHITECTURE.md "Data model").
 * The DB stores these as text, so the lists are additive-only: renaming or
 * removing a value shipped to phones breaks old app versions mid-flight.
 */

export const USER_ROLES = ['teacher', 'student'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * The state stored on a `participations` row. "Went silent" and "app closed"
 * are deliberately NOT states: they are derived from `last_seen_at` (data-model
 * decision 7), so a check-in gap can never disagree with a stored state.
 * `protection_off` is its own state — never green, never an unlock.
 */
export const PARTICIPATION_STATES = ['focused', 'unlocked', 'protection_off'] as const;
export type ParticipationState = (typeof PARTICIPATION_STATES)[number];

/**
 * Everything the `events` table records — one value per thing that can happen.
 * Every name here is taken from a decided flow in docs/ARCHITECTURE.md.
 */
export const EVENT_TYPES = [
  'tap_in',
  'unlock',
  'refocus',
  'left_for_other_session',
  'went_silent',
  'came_back',
  'protection_off',
  'session_started',
  'session_extended',
  'session_expired',
  'session_ended',
  'enrollment_left',
  'enrollment_removed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
