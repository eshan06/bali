/**
 * The canonical 7-state system (design doc 01 §"canonical state system" — law).
 * Color is never the only signifier: every state is an icon + label + color triple.
 * This module is the ONE implementation of state derivation; the API serves its
 * output and the Swift mirror is tested against the same fixtures.
 */

/** Stored participation states (DB enum). `not_joined` exists as a stored value so a
 *  teacher can flag `no_device` for a student who never tapped in. */
export type StoredParticipantState =
  | 'not_joined'
  | 'focused'
  | 'pass'
  | 'emergency_unlocked'
  | 'revoked'
  | 'ended';

/** Display states — what every chip on every surface renders. */
export type ChipState =
  | 'not_joined'
  | 'focused'
  | 'pass'
  | 'emergency_unlocked'
  | 'revoked'
  | 'no_device'
  | 'ended';

export interface ChipStateSpec {
  label: string;
  /** Lucide icon name (web). */
  lucide: string;
  /** SF Symbol name (iOS). */
  sfSymbol: string;
}

/** Exact label/icon mapping from the spec table. Labels are final copy. */
export const CHIP_STATES: Record<ChipState, ChipStateSpec> = {
  not_joined: { label: 'Not in', lucide: 'circle', sfSymbol: 'circle' },
  focused: { label: 'Focused', lucide: 'circle-check', sfSymbol: 'checkmark.circle.fill' },
  pass: { label: 'Pass', lucide: 'ticket', sfSymbol: 'ticket' },
  emergency_unlocked: { label: 'Unlocked', lucide: 'lock-open', sfSymbol: 'lock.open' },
  revoked: { label: 'Permission off', lucide: 'shield-off', sfSymbol: 'shield.slash' },
  no_device: { label: 'No device', lucide: 'smartphone', sfSymbol: 'iphone.slash' },
  ended: { label: 'Ended', lucide: 'flag', sfSymbol: 'flag' },
};

/** Staleness becomes a visible badge at this age (design: "threshold badge at ~2–4 min"). */
export const STALE_BADGE_AFTER_SECONDS = 120;

export interface DeriveInput {
  /** null ⇒ the student has no participation row yet (active member, not tapped in). */
  storedState: StoredParticipantState | null;
  noDevice: boolean;
  /** Active pass end, if any (already filtered to ended_at IS NULL). */
  passEndsAt: Date | null;
  lastSeenAt: Date | null;
  session: { endsAt: Date; endedAt: Date | null };
  now: Date;
}

export interface DerivedParticipantState {
  state: ChipState;
  /** Seconds remaining on an active pass (state === 'pass' only). */
  passRemainingSeconds: number | null;
  /** Seconds since last heartbeat; null if never seen. */
  staleSeconds: number | null;
  /** True when the staleness badge should render. */
  isStale: boolean;
}

/**
 * Precedence (WIRING_PLAN §2): ended > revoked > emergency_unlocked > active pass >
 * focused > not_joined; `no_device` replaces the display when flagged; staleness
 * decorates any state and is never a state of its own.
 */
export function deriveParticipantState(input: DeriveInput): DerivedParticipantState {
  const { storedState, noDevice, passEndsAt, lastSeenAt, session, now } = input;

  const sessionOver = session.endedAt !== null || now >= session.endsAt;

  let state: ChipState;
  if (noDevice) {
    state = 'no_device';
  } else if (sessionOver || storedState === 'ended') {
    state = 'ended';
  } else if (storedState === 'revoked') {
    state = 'revoked';
  } else if (storedState === 'emergency_unlocked') {
    state = 'emergency_unlocked';
  } else if (passEndsAt !== null && passEndsAt > now) {
    state = 'pass';
  } else if (storedState === 'focused' || storedState === 'pass') {
    // `pass` stored but expired (sweeper not yet run) ⇒ shields are returning: focused.
    state = 'focused';
  } else {
    state = 'not_joined';
  }

  const passRemainingSeconds =
    state === 'pass' && passEndsAt ? Math.max(0, Math.floor((passEndsAt.getTime() - now.getTime()) / 1000)) : null;

  const staleSeconds = lastSeenAt ? Math.max(0, Math.floor((now.getTime() - lastSeenAt.getTime()) / 1000)) : null;

  // Staleness only matters while the session is live and the student has tapped in;
  // a `not_joined`/`no_device`/`ended` chip never shows a heartbeat badge.
  const stalenessApplies = !sessionOver && (state === 'focused' || state === 'pass' || state === 'emergency_unlocked' || state === 'revoked');
  const isStale = stalenessApplies && staleSeconds !== null && staleSeconds >= STALE_BADGE_AFTER_SECONDS;

  return { state, passRemainingSeconds, staleSeconds: stalenessApplies ? staleSeconds : null, isStale };
}

/** "4m" / "20s" badge text (mock shows both variants). */
export function staleBadgeText(staleSeconds: number): string {
  if (staleSeconds < 60) return `${staleSeconds}s`;
  return `${Math.floor(staleSeconds / 60)}m`;
}

/** "Pass · 4:32" style countdown text. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
