import type { ChipState } from '@bali/shared';

/** The demo walkthrough's cast. One canonical set of names, times and classes so
 *  every screen tells the same story — the same set the landing hero already uses
 *  (Ms. Rivera / Period 3 — Algebra II / a 10:45 bell).
 *
 *  Everything here is fictional. No real roster, school or student appears. */

export const DEMO = {
  teacher: 'Ms. Rivera',
  className: 'Period 3 — Algebra II',
  policyName: 'Focus',
  bell: '10:45 AM',
  bellShort: '10:45',
  /** Shipped join codes are [A-Z0-9]{8} — no hyphen (joinBodySchema). */
  joinCode: 'R4K2QP7M',
  tagCode: 'T7XK2M9QPF',
  date: 'Friday, September 13',
  sessionStart: '9:55',
  /** Seconds remaining when the walkthrough opens — the arc reads 49:07. */
  sessionSeconds: 49 * 60 + 7,
  sessionTotalSeconds: 50 * 60,
  /** The one student whose period doesn't go to plan. The grid uses shortName;
   *  server-rendered events and the T3 header use the full name. */
  student: { short: 'Jordan P.', full: 'Jordan Pierce', first: 'Jordan' },
} as const;

/** Counts derived from ROSTER below, stated once so no screen can disagree:
 *  28 members → 2 never joined → 26 tapped in → 24 focused + 1 pass + 1 unlocked. */
export const TALLY = {
  members: 28,
  tappedIn: 26,
  neverJoined: 2,
  stayedFocused: 24,
  passes: 1,
  emergencies: 1,
  permissionOff: 0,
  medianFocusMinutes: 47,
} as const;

export interface DemoStudent {
  name: string;
  state: ChipState;
}

/** 28 students — the distribution the summary strip reports as
 *  "24 Focused · 2 Not in · 1 Pass · 1 Unlocked" once Jordan unlocks in scene 5. */
export const ROSTER: DemoStudent[] = [
  { name: 'Jordan P.', state: 'focused' },
  { name: 'Lena W.', state: 'focused' },
  { name: 'Aisha K.', state: 'focused' },
  { name: 'Sam T.', state: 'focused' },
  { name: 'Noor H.', state: 'focused' },
  { name: 'Maya R.', state: 'not_joined' },
  { name: 'Tavi O.', state: 'focused' },
  { name: 'Ethan C.', state: 'focused' },
  { name: 'Zoe B.', state: 'focused' },
  { name: 'Devin S.', state: 'pass' },
  { name: 'Priya N.', state: 'focused' },
  { name: 'Marcus L.', state: 'focused' },
  { name: 'Ivy F.', state: 'focused' },
  { name: 'Omar D.', state: 'focused' },
  { name: 'Talia G.', state: 'focused' },
  { name: 'Ben A.', state: 'not_joined' },
  { name: 'Rosa M.', state: 'focused' },
  { name: 'Kai J.', state: 'focused' },
  { name: 'Freya V.', state: 'focused' },
  { name: 'Andre P.', state: 'focused' },
  { name: 'Simone E.', state: 'focused' },
  { name: 'Wes H.', state: 'focused' },
  { name: 'Nina Q.', state: 'focused' },
  { name: 'Luca B.', state: 'focused' },
  { name: 'Hana S.', state: 'focused' },
  { name: 'Theo R.', state: 'focused' },
  { name: 'Amara T.', state: 'focused' },
  { name: 'Yusuf K.', state: 'focused' },
];

/** The student who uses the emergency exit in scene 5. */
export const EMERGENCY_STUDENT = 'Jordan P.';

/** Counts derived from the roster, so the strip can never disagree with the grid. */
export function countsFor(roster: DemoStudent[]): Record<ChipState, number> {
  const base: Record<ChipState, number> = {
    focused: 0,
    not_joined: 0,
    pass: 0,
    emergency_unlocked: 0,
    revoked: 0,
    no_device: 0,
    ended: 0,
  };
  for (const s of roster) base[s.state] += 1;
  return base;
}

/** Roster with Jordan flipped to emergency — scene 5's "after" state. */
export function rosterWithEmergency(): DemoStudent[] {
  return ROSTER.map((s) =>
    s.name === EMERGENCY_STUDENT ? { ...s, state: 'emergency_unlocked' as ChipState } : s,
  );
}

/** M:SS — the same shape the iOS app's `countdownText` produces. */
export function mmss(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
