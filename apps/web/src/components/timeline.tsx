'use client';

import { NAME_BUTTON } from '@/components/button';
import {
  bareTime,
  placement,
  type RecapGroups,
  type RecapStudent,
  type StudentMoment,
} from '@/lib/recap';

/*
 * The recap's timelines (LO7; ClassEnded, ClassEndedOpen, PhonePages' After the bell; lock.css's
 * `.track`, `.key` and `.recap-row`): a student's session as stretches of colour on one thin
 * track, what each colour means in the Key, and the rows of who wasn't focused the whole time,
 * each name opening that student's record. The stretches are read from the recap's own moments
 * (`recapGroups`, the student panel's `studentMoments`), so the two never disagree.
 */

/** What a stretch of a student's track says they were (ClassEnded's Key). */
export type TrackState = 'focused' | 'unlocked' | 'off' | 'silent' | 'notin';

/** One stretch of a track: what they were, from when to when (ms). */
export interface Stretch {
  state: TrackState;
  from: number;
  to: number;
}

/** The Key, in the board's order and words. */
export const KEY: readonly (readonly [TrackState, string])[] = [
  ['focused', 'Focused'],
  ['unlocked', 'Unlocked'],
  ['off', 'Protection off'],
  ['silent', 'Silent'],
  ['notin', 'Not here'],
];

/**
 * A student's track, from the session's start to its end, as stretches: Not here until their tap-in
 * and after they leave, then focused, unlocked or protection off as their moments turn them, the
 * grid's own rules (`applyEvent`): an unlock never softens protection off, and one the engine noted
 * `superseded` (their own return went ahead of it) turns nothing; Screen Time back on returns to
 * unlocked while an unlock is open, else to focused; a tap-in or Back in focus closes an unlock. A
 * silence lasts from going silent to checking in again, or to any moment of theirs, which their
 * phone sent. Moments before their tap-in, or after the bell, change no stretch (the record lists
 * them all the same). Stretches of one state side by side are one.
 */
export function stretchesOf(
  moments: readonly Pick<StudentMoment, 'moment' | 'at' | 'key'>[],
  start: number,
  end: number,
  /** The ids of the unlocks the engine noted `superseded`, which the grid never applies. */
  superseded: ReadonlySet<string> = new Set(),
): Stretch[] {
  const out: Stretch[] = [];
  let base: 'focused' | 'unlocked' | 'off' | null = null;
  let unlockOpen = false;
  let silent = false;
  let at = start;
  const until = (t: number) => {
    const to = Math.min(Math.max(t, start), end);
    if (to <= at) return;
    const state: TrackState = base === null ? 'notin' : silent ? 'silent' : base;
    const last = out.at(-1);
    if (last?.state === state) last.to = to;
    else out.push({ state, from: at, to });
    at = to;
  };
  for (const m of moments) {
    if (m.moment === 'unlock' && superseded.has(m.key)) continue;
    until(m.at.getTime());
    // Their phone was heard: any silence is over. Only a tap-in brings them here.
    if (m.moment !== 'silent') silent = false;
    if (m.moment === 'in') {
      base = 'focused';
      unlockOpen = false;
    } else if (m.moment === 'left') {
      base = null;
      unlockOpen = false;
    } else if (base !== null) {
      if (m.moment === 'unlock') {
        // An unlock never softens protection off (`applyUnlock`): it stays open for Screen Time
        // back on to return to.
        if (base !== 'off') base = 'unlocked';
        unlockOpen = true;
      } else if (m.moment === 'focus') {
        base = 'focused';
        unlockOpen = false;
      } else if (m.moment === 'off') base = 'off';
      else if (m.moment === 'on') base = unlockOpen ? 'unlocked' : 'focused';
      else if (m.moment === 'silent') silent = true;
    }
  }
  until(end);
  return out;
}

/** Each state as a track's words say it. */
const SAID: Record<TrackState, string> = {
  focused: 'focused',
  unlocked: 'unlocked',
  off: 'protection off',
  silent: 'silent',
  notin: 'not here',
};

/**
 * A track in words, for a screen reader, as ClassEnded words them: "Focused from 9:06, unlocked
 * 9:18 to 9:24, then focused to the bell". From their first tap-in to their last stretch here, each
 * time without AM or PM; the session's end is the bell. None at all: Not here.
 */
export function trackWords(
  stretches: readonly Stretch[],
  end: number,
  clock?: Intl.DateTimeFormat,
): string {
  const said = [...stretches];
  while (said[0]?.state === 'notin') said.shift();
  while (said.at(-1)?.state === 'notin') said.pop();
  if (said.length === 0) return 'Not here';
  const time = (t: number) => bareTime(t, clock);
  const until = (t: number) => (t >= end ? 'the bell' : time(t));
  const last = said.length - 1;
  return said
    .map(({ state, from, to }, i) => {
      const words = SAID[state];
      if (i === 0) {
        const first = `${words.charAt(0).toUpperCase()}${words.slice(1)} from ${time(from)}`;
        return last === 0 ? `${first} to ${until(to)}` : first;
      }
      if (i < last) return `${words} ${time(from)} to ${time(to)}`;
      // Right after the first, whose end isn't said, its start is; after another, it was said.
      return i === 1
        ? `${words} from ${time(from)} to ${until(to)}`
        : `then ${words} to ${until(to)}`;
    })
    .join(', ');
}

/**
 * Each stretch's fill on the track (lock.css's `.k-*`): focused green, an unlock's orange and a
 * protection off's red, as v2's marks were, and a silence a dashed line along the middle; Not here
 * is the bare track.
 */
const FILL: Record<Exclude<TrackState, 'notin'>, string> = {
  focused: 'inset-y-0 bg-track-focused',
  unlocked: 'inset-y-0 bg-unlock-edge',
  off: 'inset-y-0 bg-mark-off',
  silent: 'top-0.75 h-0.5 track-dashes',
};

/** A Key's swatch (lock.css's `.sw`): 24 × 8, its state's fill; Not here the track's, edged. */
function Swatch({ state }: { state: TrackState }) {
  if (state === 'notin') {
    return (
      <span
        aria-hidden="true"
        className="h-2 w-6 shrink-0 rounded-full border border-border-strong bg-surface-sunken"
      />
    );
  }
  return (
    <span aria-hidden="true" className="relative h-2 w-6 shrink-0 overflow-hidden rounded-full">
      <span className={`absolute inset-x-0 ${FILL[state]}`} />
    </span>
  );
}

/** What the colours mean (ClassEnded's Key, opened by its button): a swatch each, in its words. */
export function Key({ id }: { id: string }) {
  return (
    <ul
      id={id}
      aria-label="What the colors mean"
      className="flex flex-wrap items-center gap-x-6 gap-y-2"
    >
      {KEY.map(([state, words]) => (
        <li key={state} className="inline-flex items-center gap-2 text-meta text-text-secondary">
          <Swatch state={state} />
          {words}
        </li>
      ))}
    </ul>
  );
}

/**
 * Where a tick between the axis's ends hides, by the axis's own width, so no two labels touch: one
 * beside an end needs about 80 px from it (the end's label carries AM or PM), any other about 40.
 * Ticks are `step` % of the axis apart, a sixth at least (`recapGroups`).
 */
function tickHides(step: number, besideEnd: boolean): string {
  if (step >= 20) return besideEnd ? '@max-[25rem]/axis:hidden' : '@max-[13rem]/axis:hidden';
  return besideEnd ? '@max-[30rem]/axis:hidden' : '@max-[15rem]/axis:hidden';
}

/** Where the axis ends, as `recapGroups` sets it: the session's end, or a later moment drawn on it. */
export function axisEndOf(
  groups: Pick<RecapGroups, 'partTime' | 'notJoined'>,
  end: number,
): number {
  const drawn = [...groups.partTime, ...groups.notJoined].flatMap((s) =>
    s.moments.map((m) => m.at.getTime()),
  );
  return Math.max(end, ...drawn);
}

/** A row and the axis over the rows (`.recap-row`): the name in 180 px, the track beside it; on a phone, under it. */
const ROW =
  'grid grid-cols-[180px_minmax(0,1fr)] items-center gap-6 max-[760px]:grid-cols-1 max-[760px]:gap-2';

/**
 * Who wasn't focused the whole time (ClassEnded): the axis, its times each 10 minutes for 50, none
 * on a phone; then a row each between hairlines, the name, which opens their record, beside their
 * track, its words its label (`trackWords`), the stretches for the eye.
 */
export function RecapRows({
  groups,
  start,
  end,
  superseded,
  opened,
  onOpen,
}: {
  groups: RecapGroups;
  /** The session's start and end (ms), its tracks' own. */
  start: number;
  end: number;
  /** The unlocks the engine noted `superseded` (`stretchesOf`). */
  superseded: ReadonlySet<string>;
  /** Whose record is open, by their id. */
  opened: string | null;
  /** A name pressed: their record, the button pressed for focus to come back to. */
  onOpen: (student: RecapStudent, from: HTMLButtonElement) => void;
}) {
  const axisEnd = axisEndOf(groups, end);
  const x = (t: number) => placement(t, start, axisEnd);
  const last = groups.ticks.length - 1;
  return (
    <div className="flex flex-col">
      <div aria-hidden="true" className={`${ROW} pb-2 max-[760px]:hidden`}>
        <span />
        <span className="@container/axis relative h-4.25">
          {groups.ticks.map((t, i) => (
            <span
              key={i}
              style={{ left: `${t.x}%` }}
              className={`absolute top-0 text-axis whitespace-nowrap text-text-tertiary ${i === 0 ? '' : i === last ? '-translate-x-full' : `-translate-x-1/2 ${tickHides(groups.step, i === 1 || i === last - 1)}`}`}
            >
              {t.label}
            </span>
          ))}
        </span>
      </div>
      <ul>
        {groups.partTime.map((s) => {
          const stretches = stretchesOf(s.moments, start, end, superseded);
          return (
            <li key={s.key} className={`${ROW} border-t border-border-default py-3 last:border-b`}>
              <button
                type="button"
                aria-current={opened === s.key ? 'true' : undefined}
                onClick={(e) => onOpen(s, e.currentTarget)}
                className={`justify-self-start text-body wrap-anywhere ${NAME_BUTTON}`}
              >
                {s.name}
              </button>
              <div
                role="img"
                aria-label={trackWords(stretches, end)}
                className="relative h-2 overflow-hidden rounded-full bg-surface-sunken"
              >
                {stretches.map((stretch) =>
                  stretch.state === 'notin' ? null : (
                    <span
                      key={stretch.from}
                      style={{
                        left: `${x(stretch.from)}%`,
                        width: `${Math.round((x(stretch.to) - x(stretch.from)) * 100) / 100}%`,
                      }}
                      className={`absolute ${FILL[stretch.state]}`}
                    />
                  ),
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
