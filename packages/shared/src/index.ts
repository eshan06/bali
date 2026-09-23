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

/**
 * How often a live stream sends an SSE comment so idle connections and proxies
 * stay open — and, on the client, what silence from the server MEANS.
 *
 * Shared because the portal's staleness banner is a statement about this
 * number: it decides the stream has gone quiet once a few of these have failed
 * to arrive. Hand-copied on the client the two drift silently — move the
 * server to 30 s and the banner flaps on healthy classes, move it to 60 s and
 * it never fires at all, with nothing going red either way.
 * `EVENT_RESUME_OVERLAP` is here for the same reason.
 */
export const STREAM_HEARTBEAT_MS = 20_000;

/**
 * The most minutes ONE extension may ask for, and the cap `/v1` puts on a
 * start. Be precise about which of those the ENGINE enforces, because the two
 * are not the same:
 *
 *  - `extendSession` refuses a duration above this itself — the engine does
 *    not trust its caller there, because refusing only what overflows the
 *    `Date` range is a guard at the year 275760, which lets `1e6` minutes
 *    through and ends a lesson in 2028.
 *  - `startSession` takes absolute `startedAt`/`endsAt` and applies no bound
 *    at all. Today the route's zod cap is the only thing holding for starts,
 *    so a non-`/v1` caller could open a session ending in 2028 while the same
 *    caller's 481-minute extend is refused. Nothing unbounded reaches it now
 *    (the route is its only caller), and closing that asymmetry needs a
 *    refusal code `startSession` does not have — recorded in PLAN.md rather
 *    than widened into the PR that found it.
 *
 * Per operation either way, not per session: `extendSession` adds to whatever
 * end it finds, so N presses still move a session arbitrarily far and nothing
 * enforces a total. That is the intended design — a teacher who keeps pressing
 * "add time" means it — but the distinction belongs here, because this comment
 * is what an iOS client mirrors.
 *
 * Eight hours: longer than any school day, so it never refuses a real lesson,
 * and short enough that a bad value is caught as a bad value.
 */
export const MAX_SESSION_MINUTES = 480;

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
  // Decision 5: a Start declined a waiting tap because the tap it records had
  // already landed. Names the student, not a participation — they did not join.
  'armed_tap_skipped',
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
  'not_enrolled',
] as const;
export type UnlockRecordedAs = (typeof UNLOCK_RECORDED_AS)[number];

/**
 * Why a student unlocked, when they chose to say — the launch stand-in for real
 * passes (PLAN.md: unlock with an optional, skippable reason). It lands in the
 * unlock event's `payload.reason`, so it reaches the teacher with the unlock.
 * Never a gate: an unlock with no reason, or one the server does not
 * recognise, is recorded all the same. Additive-only like the other vocab.
 */
export const UNLOCK_REASONS = ['bathroom', 'nurse', 'other'] as const;
export type UnlockReason = (typeof UNLOCK_REASONS)[number];

/** True for one of the known reasons — for reading a stored payload back safely. */
export function isUnlockReason(value: unknown): value is UnlockReason {
  return typeof value === 'string' && (UNLOCK_REASONS as readonly string[]).includes(value);
}

export * from './api.js';
export * from './errors.js';
export * from './state.js';
export * from './unlock-contract.js';
