/**
 * @bali/shared — types and constants shared between the API and its clients.
 * DTOs for each endpoint land here as the endpoints get built (Phase 1, step 7).
 */

/** URL version prefix. Additive-only once shipped; see docs/ARCHITECTURE.md "API surface". */
export const API_VERSION = 'v1';

/**
 * The live-updates overlap window (decision 2). An event's `seq` is handed out
 * when its row is inserted but only becomes visible on commit, so a slow
 * transaction can make a lower seq appear AFTER a higher one. Both the stream's
 * own re-read and a client reconnect therefore resume from
 * `lastSeq - EVENT_RESUME_OVERLAP` and dedupe by `event_id`, so a late-committing
 * event is still delivered exactly once. 50 covers far more concurrent in-flight
 * writers than a classroom ever has.
 */
export const EVENT_RESUME_OVERLAP = 50;

/** Max events one catch-up page (or one stream re-read) returns; the feed is paged. */
export const EVENT_PAGE_LIMIT = 200;

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
 * Why a participation ended. Reports branch on this — decision 4's promise is
 * that `left_for_other_session` is never counted as an emergency unlock, which
 * only holds if the value can't be misspelled.
 */
export const PARTICIPATION_ENDED_REASONS = [
  'left_for_other_session',
  'session_ended',
  'session_expired',
  'removed_from_class',
  'left_class',
] as const;
export type ParticipationEndedReason = (typeof PARTICIPATION_ENDED_REASONS)[number];

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
  'enrollment_joined',
  'enrollment_left',
  'enrollment_removed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Why an emergency unlock was recorded without a live participation to flip
 * (ISSUES.md #2 — the record must never be lost). It lands in the unlock event's
 * `payload.recorded_as`, and reports read it to explain a "recorded" unlock that
 * moved no student state. Additive-only like the other vocab.
 */
export const UNLOCK_RECORDED_AS = [
  'no_live_participation',
  'after_session_end',
  'unknown_session',
] as const;
export type UnlockRecordedAs = (typeof UNLOCK_RECORDED_AS)[number];

export * from './api.js';
export * from './errors.js';
export * from './state.js';
export * from './unlock-contract.js';
