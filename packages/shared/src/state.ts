import type { ParticipationState } from './index.js';

/*
 * Rule 2 — one shared state function. The student app, the teacher grid, and
 * reports all answer "what state is this student in right now" with the code
 * here, so they can never disagree (v2 showed "No device" while the phone said
 * "Focused"). It is a pure function of the stored row plus the current time:
 * everything time-derived (silence) is computed, never stored, so a check-in
 * gap can't contradict a stored state (data-model decision 7).
 */

/** How long without a check-in before a focused student reads as silent. */
export const SILENCE_THRESHOLD_MS = 90_000;

/** The stored slice of a participation the derivation needs. */
export interface ParticipationSnapshot {
  state: ParticipationState;
  joinedAt: Date;
  lastSeenAt: Date | null;
  endedAt: Date | null;
}

/**
 * What a screen shows. The stored states, plus two derived values that are
 * never written to the row: `ended` (the participation is over) and `silent`
 * (a focused phone that has stopped checking in — we've lost contact, so we
 * say so rather than pretending it's still green).
 */
export type DisplayState = ParticipationState | 'ended' | 'silent';

/**
 * Derive the display state. `now` and the threshold are passed in so the
 * function stays pure and identically testable on server and client.
 *
 * Silence overrides only `focused`: that state's promise is "shielded and
 * present", and losing contact breaks it. `unlocked` and `protection_off` are
 * already not-green states that stand on their own regardless of contact.
 */
export function deriveDisplayState(
  p: ParticipationSnapshot,
  now: Date,
  silenceThresholdMs: number = SILENCE_THRESHOLD_MS,
): DisplayState {
  if (p.endedAt !== null) return 'ended';
  if (p.state === 'focused') {
    const lastContact = p.lastSeenAt ?? p.joinedAt;
    if (now.getTime() - lastContact.getTime() > silenceThresholdMs) return 'silent';
  }
  return p.state;
}

/**
 * Rule 1 — the server owns the clock. A device timestamp is trusted only for
 * ordering offline events, and always clamped into the session's real window
 * so a wrong phone clock can't backdate an unlock out of a report or push a
 * tap past the bell. Returns a time within [startedAt, endsAt].
 */
export function clampToWindow(deviceTime: Date, startedAt: Date, endsAt: Date): Date {
  const t = deviceTime.getTime();
  if (t < startedAt.getTime()) return new Date(startedAt);
  if (t > endsAt.getTime()) return new Date(endsAt);
  return new Date(t);
}
